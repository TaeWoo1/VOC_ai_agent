"""One-shot CLI: ingest OliveYoung reviews via live browser scrape into phase1_reviews.

Usage:
    PYTHONPATH=. python3 scripts/ingest_oliveyoung_browser_phase1.py <product_url>
        [--max N] [--headful]
        [--cold-start-timeout SECS] [--continuation-timeout SECS]
        [--scroll-attempts N]
        [--debug-dir PATH] [--capture-partial-on-invalid]
        [--auth-retry N]
        [--sort-type {USEFUL_SCORE_DESC,RECOMMENDED_DESC,DATETIME_DESC,RATING_DESC,RATING_ASC}]

Arguments:
    product_url   OliveYoung product detail URL. Prefer the form returned by
                  the review-tab landing (`?goodsNo=...&tab=review`), but any
                  product URL works — the connector triggers the review tab.
                  Also used as `phase1_reviews.product_keyword` and
                  `phase1_runs.requested_target` (parity with the CSV ingest
                  script, which does the same thing with the CSV path).

Flags:
    --max                          Hard cap on reviews collected (CollectParams.max_results).
                                   Default 20 — intentionally small so smoke runs don't hammer
                                   OliveYoung. Override consciously for bulk ingest.
    --headful                      Launch Chromium with UI for debugging (slow; do not use for
                                   automated runs).
    --cold-start-timeout S         Seconds to wait for the first /reviews/cursor response
                                   after navigating to the product page. Default 30.0.
                                   Increase for popular / sold-out / heavy-JS product pages
                                   that load slowly.
    --continuation-timeout S       Seconds to wait for each subsequent paginated response.
                                   Default 8.0.
    --scroll-attempts N            Maximum scroll-then-wait attempts before giving up on
                                   the next page during pagination. Default 3.
    --debug-dir PATH               Directory for debug artifacts (currently: the partial-rows
                                   JSONL when --capture-partial-on-invalid is set). Default
                                   None — no artifact written. Recommended: a /tmp/ path so
                                   artifacts never land in the repo.
    --capture-partial-on-invalid   When the run is invalid OR has incomplete_collection AND
                                   parsed rows exist, write them to a JSONL under --debug-dir
                                   for offline inspection. Rows are NEVER inserted into
                                   phase1_reviews via this path.
    --auth-retry N                 Number of session-rebuild retries to attempt on
                                   mid_stream_auth_break. Default 0 (off, PR-1 behavior).
                                   Each retry closes the current Playwright session, opens
                                   a fresh one against the same product URL, and resumes
                                   pagination using a seen-set of source_ids to avoid
                                   duplicating already-collected rows.

Environment:
    PHASE1_DB_PATH       sqlite db path (default: voc_data.db at repo root)
    PHASE1_OY_DICT       product-option dictionary (default:
                         data/option_dictionary/oliveyoung.json)
    PHASE1_OY_CODES      profile-code dictionary (default:
                         data/option_dictionary/oliveyoung_profile_codes.json)

Requires playwright (in the [saas] extra):
    pip install '.[saas]' && python -m playwright install chromium

This script is the browser sibling of scripts/ingest_oliveyoung_phase1.py
(which replays a CSV). Both paths share the same Phase1Pipeline →
phase1_reviews ingest; the only difference is the connector swap and
`source_method='browser_scrape'` so operators can tell the two apart when
querying phase1_reviews / phase1_runs.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import logging
import os
import sys
from datetime import datetime
from pathlib import Path
from typing import Any

from src.voc.app.phase1_pipeline import Phase1Pipeline
from src.voc.connectors.base import CollectParams
from src.voc.connectors.oliveyoung_browser_api import (
    OLIVEYOUNG_PROMOTED_KEYS,
    OliveYoungBrowserAPIConnector,
    ProfileCodeMapper,
    _VALID_SORT_TYPES,
)
from src.voc.persistence.migrations import init_db
from src.voc.persistence.phase1_review_repository import Phase1ReviewRepository
from src.voc.persistence.phase1_run_repository import Phase1RunRepository
from src.voc.processing.segment_normalizer import (
    DictionarySegmentNormalizer,
    SegmentNormalizer,
)
from src.voc.schemas.channel_meta import DerivedAttributes, OliveYoungMeta

REPO_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_DB = os.environ.get("PHASE1_DB_PATH", str(REPO_ROOT / "voc_data.db"))


# 2026-05-01 — exception → diagnostic-flag classifier. The connector's
# `session.open()` calls `pw.chromium.connect_over_cdp(...)` and may
# raise on the Playwright-1.58 / Chrome-147 "setDownloadBehavior" wall
# (see docs/oy_cdp_attach_compatibility.md). Without this translator
# the exception bubbles past the CLI, the subprocess returns rc!=0
# with no parseable stdout, and the batch driver classifies the
# product as `unknown_failure`. Substring matching is intentionally
# loose — we'd rather over-tag than miss the wall.
_CDP_ATTACH_EXC_HINTS: tuple[str, ...] = (
    "setDownloadBehavior",
    "Browser context management is not supported",
    "connect_over_cdp",
    "Browser closed",
    "Target closed",
    "ECONNREFUSED 127.0.0.1",
    "websocket",
)
_PAGE_OPEN_EXC_HINTS: tuple[str, ...] = (
    "page.goto",
    "ERR_NAME_NOT_RESOLVED",
    "ERR_CONNECTION_REFUSED",
    "Navigation failed",
)


def classify_early_failure(exc_str: str) -> tuple[str, str | None]:
    """Inspect a connector-raised exception and return one of:
        ("cdp_attach_failed", verbatim_text)  — Playwright/Chrome attach wall
        ("page_open_failed", verbatim_text)   — page.goto raised after attach
        ("unknown", None)                     — neither hint matched

    Caller emits a synthetic JSON summary with the matching flag set
    so `collection_batch._build_product_result` can route to the
    right `status` instead of `unknown_failure`.
    """
    s = exc_str or ""
    if any(h in s for h in _CDP_ATTACH_EXC_HINTS):
        return ("cdp_attach_failed", s)
    if any(h in s for h in _PAGE_OPEN_EXC_HINTS):
        return ("page_open_failed", s)
    return ("unknown", None)
DEFAULT_OPTION_DICT = os.environ.get(
    "PHASE1_OY_DICT",
    str(REPO_ROOT / "data" / "option_dictionary" / "oliveyoung.json"),
)
DEFAULT_PROFILE_CODES = os.environ.get(
    "PHASE1_OY_CODES",
    str(REPO_ROOT / "data" / "option_dictionary" / "oliveyoung_profile_codes.json"),
)


def make_oy_enrich(normalizer: SegmentNormalizer):
    """Same enrich closure as the CSV ingest path — ensures the two source_methods
    end up with identical `derived` column shape for the same channel_meta."""
    def _enrich(channel_meta, product_external_id):
        if not isinstance(channel_meta, OliveYoungMeta):
            return None
        return DerivedAttributes(
            normalized_skin_type=normalizer.normalize_skin_type(channel_meta.skin_type),
            normalized_age_group=normalizer.normalize_age_group(channel_meta.age_group),
            normalized_product_option=normalizer.normalize_product_option(
                "oliveyoung",
                channel_meta.product_option_raw,
                product_external_id,
            ),
        )
    return _enrich


def _parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Ingest OliveYoung reviews via live browser scrape into phase1_reviews",
    )
    parser.add_argument(
        "product_url",
        help="OliveYoung product detail URL (preferably with tab=review)",
    )
    parser.add_argument(
        "--max", dest="max_results", type=int, default=20,
        help="Hard cap on reviews collected (default: 20)",
    )
    parser.add_argument(
        "--headful", action="store_true",
        help="Show the Chromium window (debug only)",
    )
    parser.add_argument(
        "--cookies-json", dest="cookies_json", type=Path, default=None,
        help=(
            "Playwright storage_state JSON file (cookies/localStorage from a "
            "logged-in OY session — obtained e.g. via a browser-extension "
            "export). Seeds the Playwright-launched context so the review "
            "API treats the scraper as authenticated. Short-term validation "
            "unlock; long-term ingestion is seller-authorized (API/portal/CSV)."
        ),
    )
    parser.add_argument(
        "--cdp-endpoint", dest="cdp_endpoint", type=str, default=None,
        help=(
            "Attach to a user-launched Chrome via remote debugging (e.g. "
            "http://localhost:9222). Scraping runs inside that Chrome's "
            "existing session, with the user's real browser fingerprint — "
            "no Playwright-launched browser. Launch Chrome with: "
            "--remote-debugging-port=9222 --user-data-dir=<some dir>. "
            "Short-term validation unlock; not a long-term backbone."
        ),
    )
    # ---- PR-1 hardening: configurable connector timeouts ----
    parser.add_argument(
        "--cold-start-timeout", dest="cold_start_timeout_s",
        type=float, default=None,
        help=(
            "Seconds to wait for the first /reviews/cursor response after page "
            "load. Default uses the connector's class-level COLD_START_TIMEOUT_S "
            "(30.0). Increase for product pages that load slowly."
        ),
    )
    parser.add_argument(
        "--continuation-timeout", dest="page_n_timeout_s",
        type=float, default=None,
        help=(
            "Seconds to wait for each subsequent paginated response. Default "
            "uses the connector's class-level PAGE_N_TIMEOUT_S (8.0)."
        ),
    )
    parser.add_argument(
        "--scroll-attempts", dest="max_scroll_attempts",
        type=int, default=None,
        help=(
            "Max scroll-then-wait attempts per next-page request before giving "
            "up. Default uses the connector's class-level "
            "MAX_SCROLL_ATTEMPTS_PER_PAGE (3)."
        ),
    )
    # ---- PR-2 hardening: debug artifacts + auth retry ----
    parser.add_argument(
        "--debug-dir", dest="debug_dir", type=Path, default=None,
        help=(
            "Directory for debug artifacts. Default None → no artifact "
            "written. Recommended: a /tmp/ path so artifacts never land "
            "inside the repo or DB."
        ),
    )
    parser.add_argument(
        "--capture-partial-on-invalid", dest="capture_partial_on_invalid",
        action="store_true",
        help=(
            "When the run is invalid (auth_error/blocked) OR has "
            "incomplete_collection AND parsed rows exist, write them to a "
            "JSONL under --debug-dir for offline inspection. Rows are NEVER "
            "inserted into phase1_reviews via this path. Default off."
        ),
    )
    parser.add_argument(
        "--auth-retry", dest="auth_retry", type=int, default=0,
        help=(
            "Number of session-rebuild retries to attempt on "
            "mid_stream_auth_break. Default 0 (off, PR-1 behavior). Retries "
            "use a seen-set of source_ids to avoid duplicating "
            "already-collected rows."
        ),
    )
    # ---- Phase 2E sort-aware crawl: opt-in sort selection ----
    parser.add_argument(
        "--sort-type", dest="sort_type",
        choices=sorted(_VALID_SORT_TYPES),
        default=None,
        help=(
            "OliveYoung review sort to scrape. Default: not set — page-default "
            "(USEFUL_SCORE_DESC / 유용한 순) is used and rows are NOT stamped "
            "with oy_sort_type (legacy behavior). When set, the connector "
            "clicks the matching sort button after the review tab and stamps "
            "every collected row's raw_metadata.oy_sort_type. Use this for "
            "single-sort backfills; --multi-sort on run_phase2e_pipeline.py "
            "is the orchestrator for full multi-sort merges."
        ),
    )
    # ---- Human-check (anti-bot CAPTCHA) wait-and-resume ----
    parser.add_argument(
        "--human-check-timeout-seconds",
        dest="human_check_timeout_seconds",
        type=int, default=900,
        help=(
            "Maximum seconds to wait for an operator to clear an "
            "anti-bot / human-verification interstitial in the "
            "CDP-attached Chrome. Default 900 (15 min). Set higher "
            "for unattended overnight runs."
        ),
    )
    parser.add_argument(
        "--human-check-poll-seconds",
        dest="human_check_poll_seconds",
        type=int, default=5,
        help=(
            "DOM poll interval (seconds) while waiting for the "
            "human check to clear. Default 5."
        ),
    )
    parser.add_argument(
        "--fail-on-human-check-timeout",
        dest="fail_on_human_check_timeout",
        action="store_true",
        help=(
            "If set, a human-check timeout terminates the sort with a "
            "blocked status. Default off — the sort is marked "
            "skipped/partial and the orchestrator continues to the "
            "next sort."
        ),
    )
    parser.add_argument(
        "--force-fresh-context",
        dest="force_fresh_context",
        action="store_true",
        help=(
            "Under --cdp-endpoint, create a fresh Playwright context "
            "instead of reusing the user's existing CDP context. "
            "Cookies / localStorage are NOT carried over — the new "
            "context starts unauthenticated and the operator must "
            "re-login. Used by the multi-sort orchestrator's "
            "--strict-reset-session-on-block to recover from sticky "
            "session-level blocks (anti_bot, anonymous_auth_wall). "
            "No-op when --cdp-endpoint is not set."
        ),
    )
    return parser.parse_args(argv)


async def main(argv: list[str] | None = None) -> int:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(name)s %(levelname)s %(message)s",
    )
    args = _parse_args(argv if argv is not None else sys.argv[1:])

    db = init_db(DEFAULT_DB)
    try:
        review_repo = Phase1ReviewRepository(db)
        run_repo = Phase1RunRepository(db)
        mapper = ProfileCodeMapper(DEFAULT_PROFILE_CODES)
        connector = OliveYoungBrowserAPIConnector(
            product_url=args.product_url,
            code_mapper=mapper,
            headless=not args.headful,
            storage_state_path=args.cookies_json,
            cdp_endpoint=args.cdp_endpoint,
            cold_start_timeout_s=args.cold_start_timeout_s,
            page_n_timeout_s=args.page_n_timeout_s,
            max_scroll_attempts_per_page=args.max_scroll_attempts,
            debug_dir=args.debug_dir,
            capture_partial_on_invalid=args.capture_partial_on_invalid,
            auth_retry=args.auth_retry,
            sort_type=args.sort_type,
            human_check_timeout_s=float(args.human_check_timeout_seconds),
            human_check_poll_s=float(args.human_check_poll_seconds),
            fail_on_human_check_timeout=args.fail_on_human_check_timeout,
            force_fresh_context=args.force_fresh_context,
        )
        pipeline = Phase1Pipeline(review_repo=review_repo, run_repo=run_repo)
        normalizer = DictionarySegmentNormalizer(DEFAULT_OPTION_DICT)

        try:
            result = await pipeline.run(
                connector=connector,
                target=args.product_url,
                channel_meta_class=OliveYoungMeta,
                promoted_keys=OLIVEYOUNG_PROMOTED_KEYS,
                source_method="browser_scrape",
                params=CollectParams(max_results=args.max_results),
                enrich_fn=make_oy_enrich(normalizer),
            )
        except Exception as exc:
            # Translate connector-raised early failures into a structured
            # JSON output so the batch driver classifies the product as
            # `cdp_attach_failed` / `page_open_failed` rather than the
            # generic `unknown_failure`. The CLI still exits non-zero so
            # callers (CI, the multi-sort orchestrator) treat this as a
            # failed run; the difference is observability.
            kind, verbatim = classify_early_failure(
                f"{type(exc).__name__}: {exc}",
            )
            now_iso = datetime.now().isoformat()
            # v2.4.6 — prefer the connector's pre-allocated
            # last_run_summary (set at the START of `collect()`) when
            # available so the CDP-endpoint diagnostic survives the
            # raise. Falls back to a fresh synthetic dict when the
            # connector never assigned `last_run_summary` (e.g. the
            # constructor itself raised before collect() ran).
            preallocated = getattr(connector, "last_run_summary", None)
            preallocated_dict: dict[str, Any] = {}
            if preallocated is not None:
                try:
                    preallocated_dict = preallocated.model_dump(mode="json")
                except Exception:  # noqa: BLE001 — fail-soft
                    preallocated_dict = {}
            synthetic_summary: dict[str, Any] = {
                "run_id": None,
                "channel": "oliveyoung",
                "requested_target": args.product_url,
                "started_at": now_iso,
                "finished_at": now_iso,
                # The pipeline never ran far enough to populate any
                # counters, so all numeric fields are zero. The
                # diagnostic flags below carry the failure shape.
                "raw_records_seen": 0,
                "records_parsed": 0,
                "records_dropped_short_text": 0,
                "records_dropped_unparseable_date": 0,
                "parse_warnings": 0,
                "blocked": False,
                "auth_error": False,
                "sample_dropped_reasons": [verbatim] if verbatim else [],
                "cdp_attach_failed": kind == "cdp_attach_failed",
                "cdp_attach_error": (
                    verbatim if kind == "cdp_attach_failed" else None
                ),
                "page_open_failed": kind == "page_open_failed",
                "page_open_error": (
                    verbatim if kind == "page_open_failed" else None
                ),
                # v2.4.6 — preserve the v2.4.5 propagation diagnostic
                # fields even when the connector raises before
                # assembling `last_run_summary`. Without this, an
                # early failure (CDP attach raise, page open raise)
                # produces a summary with all v2.4.5 fields = null,
                # which the pipeline classifier mis-labels as
                # `cdp_endpoint_not_forwarded` even when the manifest
                # carried the value correctly.
                #
                # `requested_cdp_endpoint` is what the connector was
                # told (CLI arg). `connector_received_cdp_endpoint`
                # mirrors the input. The session-side field stays None
                # because the session never got past construction (or
                # was never constructed), and the diagnostic
                # accurately surfaces that distinction.
                "requested_cdp_endpoint": args.cdp_endpoint,
                "connector_received_cdp_endpoint": args.cdp_endpoint,
                "product_image_session_received_cdp_endpoint": None,
                "product_image_session_open_called": False,
                "product_image_capture_hook_reached": False,
                "product_image_capture_attempted": False,
                "product_image_session_id": None,
                "product_image_diagnostic_session_id": None,
                "product_image_session_class": None,
                "product_image_session_open_url_at_start": None,
                "product_image_capture_error": (
                    f"early_failure:{kind}" if kind else "early_failure:unknown"
                ),
                "product_image_capture_page_url": None,
                "product_image_capture_html_length": None,
                "product_image_capture_og_count": 0,
                "product_image_capture_jsonld_count": 0,
                "product_image_capture_twitter_count": 0,
                "product_image_capture_link_image_src_count": 0,
                "product_image_capture_oy_thumbnail_img_count": 0,
                "product_image_capture_selected_source": None,
                "product_image_url": None,
                "cdp_endpoint_used": None,
                "connected_via_cdp": False,
                "browser_user_agent": None,
            }
            # Overlay the pre-allocated dict — fields the connector
            # actually populated (the cdp endpoints, plus anything
            # else stamped before the raise) win over the synthetic
            # null defaults. Order matters: synthetic first, real
            # second.
            for k, v in preallocated_dict.items():
                if v is not None and v != [] and v != {}:
                    synthetic_summary[k] = v
            print(json.dumps(
                {
                    "run_id": None,
                    "quality_status": "invalid",
                    "rows_inserted": 0,
                    "rows_skipped_by_normalize": 0,
                    "summary": synthetic_summary,
                    "phase1_reviews_count_by_channel": (
                        review_repo.count_by_channel()
                    ),
                    "db_path": DEFAULT_DB,
                    "option_dictionary_path": DEFAULT_OPTION_DICT,
                    "profile_codes_path": DEFAULT_PROFILE_CODES,
                    "product_url": args.product_url,
                    "max_results": args.max_results,
                    "sort_type": args.sort_type,
                    "collected_review_ids": [],
                    "early_failure_kind": kind,
                    "early_failure_text": verbatim,
                },
                ensure_ascii=False,
                indent=2,
            ))
            return 2

        run_row = run_repo.get(result.run_id)
        # Multi-sort membership: the connector accumulates the canonical
        # review_ids it observed during this run. Surface them in stdout
        # so the batch runner can write a per-sort sidecar artifact when
        # --sort-type is set. Empty list when the connector reports
        # nothing — callers should treat that as "no sidecar to write."
        collected_review_ids = list(
            getattr(connector, "last_collected_review_ids", []) or []
        )
        print(json.dumps(
            {
                "run_id": result.run_id,
                "quality_status": result.quality_status,
                "rows_inserted": result.rows_inserted,
                "rows_skipped_by_normalize": result.rows_skipped,
                "summary": run_row["summary"] if run_row else None,
                "phase1_reviews_count_by_channel": review_repo.count_by_channel(),
                "db_path": DEFAULT_DB,
                "option_dictionary_path": DEFAULT_OPTION_DICT,
                "profile_codes_path": DEFAULT_PROFILE_CODES,
                "product_url": args.product_url,
                "max_results": args.max_results,
                # Sort-aware: the sort the run targeted (None on legacy /
                # default-sort runs; matches the connector's _sort_type).
                # Pulled out next to collected_review_ids so the batch
                # runner can write the sidecar without re-parsing the
                # summary.
                "sort_type": args.sort_type,
                "collected_review_ids": collected_review_ids,
            },
            ensure_ascii=False,
            indent=2,
        ))
        return 0
    finally:
        db.close()


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
