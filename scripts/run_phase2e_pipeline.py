"""End-to-end Phase 2E pipeline: OliveYoung URL → V2 PDF report.

Single-command orchestrator. Wires existing components without modification:
  1. Parse `goodsNo` from URL
  2. Build single-product manifest, invoke `scripts/run_oy_collection_batch.py`
     via subprocess (reuses CDP-auth flow, halt-on-auth orchestration)
  3. Reviews persist to `voc_data.db` automatically (Phase1Pipeline)
  4. Fetch reviews → run Stage 1 → Stage 2 → Stage 3 in-process
  5. Aggregate via `report.aggregate_product`
  6. Render PDF via `render_pdf_v2`

Usage:
    PYTHONPATH=. python3 scripts/run_phase2e_pipeline.py "<product_url>"
    PYTHONPATH=. python3 scripts/run_phase2e_pipeline.py "<url>" --product-name "MyProduct"
    PYTHONPATH=. python3 scripts/run_phase2e_pipeline.py "<url>" --skip-scrape  # use existing DB rows
    PYTHONPATH=. python3 scripts/run_phase2e_pipeline.py "<url>" --max-reviews 50
    PYTHONPATH=. python3 scripts/run_phase2e_pipeline.py "<url>" --out-pdf /path/to/output.pdf

NO detector changes. NO report-renderer changes. NO scraper changes.
Pure orchestration glue.
"""
from __future__ import annotations
import argparse
import json
import os
import random
import re
import sqlite3
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO))

# Pipeline modules (read-only imports)
from src.voc.reporting.phase2e.stage1 import extract as stage1_extract  # noqa: E402
from src.voc.reporting.phase2e.stage2 import (  # noqa: E402
    OpenAIClassifier,
    PROMPT_VERSION_V2_SKINCARE,
    StubClassifier,
    extract_narrow_clause,
)
from src.voc.reporting.phase2e.aggregate import aggregate as stage3_aggregate  # noqa: E402
from src.voc.reporting.phase2e.report import aggregate_product  # noqa: E402
from src.voc.content.adapters.from_phase2e import (  # noqa: E402
    productreportdata_to_analysis_report,
)
from src.voc.content.paths import slugify as _content_slugify  # noqa: E402
from src.voc.content.profiles import (  # noqa: E402
    select_profile_id as _select_profile_id,
    suppressed_attributes_for as _suppressed_attributes_for,
)
from src.voc.connectors.oliveyoung_browser_api import (  # noqa: E402
    normalize_breadcrumb_path as _normalize_breadcrumb_path,
    parse_breadcrumb_text as _parse_breadcrumb_text,
)
from src.voc.reporting.phase2e.snapshots import (  # noqa: E402
    PRIMARY_SORT_TYPE as SNAPSHOT_PRIMARY_SORT_TYPE,
    CorpusProvenance,
    aggregate_primary_only,
    build_snapshot,
    compare_snapshots,
    compute_coverage_ratio,
    load_previous_snapshot,
    save_snapshot,
)

# Reuse v2 PDF builder. Import the module so we can call its render fn.
sys.path.insert(0, str(REPO / "scripts"))
import generate_phase2e_pdf_v2 as pdf_v2  # noqa: E402


DB_PATH = REPO / "voc_data.db"
OUT_DIR = REPO / "docs"
PIPELINE_CACHE = "/tmp/phase2e_pipeline_cache.json"
SNAPSHOTS_ROOT = REPO / "data" / "phase2e_snapshots"

# When the operator passes `--max-reviews all` or `0`, we substitute this
# effective cap in the scraper manifest. The OliveYoung connector stops
# scrolling once it returns `has_next=false` (pagination exhausted), so a
# sufficiently-large number behaves as "unlimited" subject to the
# authenticated session's natural quota. The connector does not have a
# first-class `unlimited` mode.
UNLIMITED_SENTINEL = 100000

# Multi-sort merge plan, redesigned around a primary/signal split.
#
# Rationale (see docs/oliveyoung_sort_crawl_probe.md §5):
#   - Sort *content* is identical across sorts — every review is reachable
#     under each sort. Sort *order* is metadata, not content. Therefore
#     ONE sort run with cap=all is the canonical content corpus; the
#     other four sorts only add ranking signal.
#   - Each sort-button click is an anti-bot fingerprint trigger. Reducing
#     per-sort request volume reduces the soft-block surface area.
#
# Roles:
#   - "primary"  — the corpus sort. ALL distribution and time-series
#                  analysis MUST be derived from this sort's reviews
#                  (filtered via raw_metadata.oy_sort_type at fetch time).
#                  Cap is intentionally "all" so the corpus is exhaustive.
#   - "signal"   — top-N tail probes. Surface the highest-ranked reviews
#                  under non-default orderings to help operators discover
#                  representative complaints (RATING_ASC, RECOMMENDED_DESC)
#                  and selling points (RATING_DESC, USEFUL_SCORE_DESC).
#                  These reviews MUST NOT be used to claim overall
#                  distribution — only as an evidence pool.
#
# Order matters: primary runs first so the corpus is in place before any
# anti-bot escalation. Signal sorts run with a small cap (default 50) and
# are individually expendable — a per-sort failure is recorded but does
# not abort the multi-sort plan.
PRIMARY_CORPUS_SORT_TYPE: str = "DATETIME_DESC"
SIGNAL_SORT_DEFAULT_CAP: int = 50
SIGNAL_SORT_TYPES: list[str] = [
    "RATING_ASC",         # negative-evidence pool (low-rating tail)
    "RATING_DESC",        # positive-evidence pool (high-rating tail)
    "USEFUL_SCORE_DESC",  # page-default helpful pool (top-ranked)
    "RECOMMENDED_DESC",   # operator-recommended pool
]
MULTI_SORT_PLAN: list[dict] = [
    {"sort_type": PRIMARY_CORPUS_SORT_TYPE, "role": "primary", "cap": "all"},
    *(
        {"sort_type": st, "role": "signal", "cap": SIGNAL_SORT_DEFAULT_CAP}
        for st in SIGNAL_SORT_TYPES
    ),
]
_MULTI_SORT_TYPES_IN_PLAN: list[str] = [e["sort_type"] for e in MULTI_SORT_PLAN]

# Statuses we retry once before accepting the failure. These are
# transient signals (anti-bot rate-limit window, false-empty render
# state, generic failure with no rows seen) where a second attempt
# often succeeds because the page state recovers.
_MULTI_SORT_RETRY_STATUSES: frozenset[str] = frozenset({
    "anti_bot",
    "blocked_or_empty_state",
    "unknown_failure",
})

# Auth-wall-like statuses: hitting the anonymous-auth wall mid-scrape
# is a different failure shape than a transient render glitch. The
# correct recovery is NOT a fast retry — repeating the same action
# inside the same anti-bot window almost always fails again. Instead
# we DEFER these failures to the end of the multi-sort plan and try
# them after the other sorts have completed (giving the page state a
# longer window to recover + letting the operator re-confirm login).
# Run-003 QA pass-5 finding.
_MULTI_SORT_DEFERRED_RETRY_STATUSES: frozenset[str] = frozenset({
    "anonymous_auth_wall",
    "scraper_subprocess_failed",
    "human_check_timeout",
})

# Random jitter (seconds, uniform) between sequential multi-sort
# subprocess invocations. Avoids hammering OY with back-to-back
# sort-button clicks, which the empirical record shows triggers
# anti-bot more readily.
_MULTI_SORT_JITTER_RANGE_S = (2.0, 5.0)
# Slightly longer jitter before a retry — give the page state a chance
# to settle past the transient that caused the first attempt to fail.
_MULTI_SORT_RETRY_JITTER_RANGE_S = (3.0, 6.0)
# Backoff window before revisiting a deferred (auth-wall-class) sort.
# Significantly longer than the transient retry jitter — the goal is
# for the auth wall to clear on its own / for the operator to log
# back in via the CDP-attached browser before we attempt again.
_MULTI_SORT_DEFERRED_BACKOFF_RANGE_S = (15.0, 25.0)
# Patient mode — Run-003 pass-7. Used when an operator explicitly
# wants the pipeline to wait long enough for an OY anti-bot window
# to clear (the empirical 60s+ window). Quick mode keeps the prior
# default; this is a strict superset.
_MULTI_SORT_DEFERRED_BACKOFF_PATIENT_S = (120.0, 180.0)


def _sort_specific_recovery_actions(
    sort_type: str, recovery_attempt: int,
) -> list[str]:
    """Per-sort recovery action sequence (Run-003 pass-7 spec).

    Each call returns the list of action labels that the recovery
    pass will record for the upcoming retry. The labels themselves
    don't currently drive connector behaviour (the connector receives
    the same `_run_one_sort_attempt` invocation), but they DO ride
    on the per-sort summary's `recovery_actions` log so the operator
    can read which strategy was tried.

    Future connector work can read this list to dispatch DOM-state
    changes (re-wake the review tab, page reload, etc.) — pass-7
    keeps the contract documentary.
    """
    if recovery_attempt == 1:
        if sort_type == "RATING_ASC":
            return [
                "review_tab_rewake",
                "open_sort_menu",
                "capture_available_sort_button_labels",
                "click_rating_asc_label",
                "wait_for_review_list_api",
            ]
        if sort_type == "RECOMMENDED_DESC":
            return [
                "review_tab_rewake",
                "match_recommended_label_against_available_buttons",
                "click_matched_recommended_label",
                "wait_for_review_list_api",
            ]
        return [
            "review_tab_rewake",
            "wait_for_review_list_api",
        ]
    # Second attempt: more aggressive — page reload + direct URL.
    if sort_type == "RATING_ASC":
        return [
            "page_reload",
            "open_review_tab_via_url",
            "click_rating_asc_label",
            "wait_for_review_list_api",
        ]
    if sort_type == "RECOMMENDED_DESC":
        return [
            "page_reload",
            "open_review_tab_via_url",
            "compare_against_useful_score_desc_endpoint",
            "wait_for_review_list_api",
        ]
    return ["page_reload", "wait_for_review_list_api"]


def _is_auth_wall_failure(result: dict) -> bool:
    """Recognise an auth-wall-class failure on a per-sort outcome dict.

    The connector layer surfaces auth-wall failures via the per-sort
    `status` field OR through `error` strings carrying the connector's
    own `anonymous_auth_wall` classifier. Callers use the result to
    decide whether to defer the sort to a recovery pass instead of
    retrying it immediately.
    """
    status = (result or {}).get("status") or ""
    if status in _MULTI_SORT_DEFERRED_RETRY_STATUSES:
        return True
    err = (result or {}).get("error") or ""
    if "anonymous_auth_wall" in err:
        return True
    return False


def parse_max_reviews_arg(raw: str) -> tuple[int, bool]:
    """Parse `--max-reviews` arg.

    Returns `(effective_limit, finite_limit_was_set)`.
      - 'all', 'unlimited', or '0' → (UNLIMITED_SENTINEL, False)
      - integer ≥ 1 → (int, True)
      - other → ValueError
    """
    s = (raw or "").strip().lower()
    if s in ("all", "unlimited", "0"):
        return UNLIMITED_SENTINEL, False
    try:
        n = int(s)
    except ValueError as exc:
        raise ValueError(
            f"--max-reviews must be a positive integer or 'all' / 'unlimited' / '0' — got {raw!r}"
        ) from exc
    if n < 0:
        raise ValueError("--max-reviews cannot be negative")
    if n == 0:
        return UNLIMITED_SENTINEL, False
    return n, True


# ---------------------------------------------------------------------------
# Step 1 — URL → goodsNo
# ---------------------------------------------------------------------------

GOODS_NO_RE = re.compile(r"goodsNo=([A-Z]\d{10,})", re.IGNORECASE)


def parse_goods_no_from_url(url: str) -> str:
    """Extract OliveYoung goodsNo from a product detail URL.

    Accepts both `www.oliveyoung.co.kr/store/goods/getGoodsDetail.do?goodsNo=A...`
    and `m.oliveyoung.co.kr/m/store/goods/getGoodsDetail.do?goodsNo=A...` URL forms.
    Also accepts a bare goodsNo for convenience.
    """
    url = url.strip()
    # Bare goodsNo (e.g. "A000000152396") — accept any case
    if re.fullmatch(r"[A-Za-z]\d{10,}", url):
        return url.upper()
    m = GOODS_NO_RE.search(url)
    if not m:
        raise ValueError(
            f"Could not parse goodsNo from URL: {url!r}\n"
            f"Expected an OliveYoung product URL containing 'goodsNo=...'"
        )
    return m.group(1).upper()


# ---------------------------------------------------------------------------
# Step 2 — Single-product manifest + scraper invocation
# ---------------------------------------------------------------------------


def build_manifest(
    goods_no: str,
    product_name: str,
    max_reviews: int,
    sort_type: str | None = None,
    suffix: str = "",
    human_check_timeout_seconds: int = 900,
    human_check_poll_seconds: int = 5,
    fail_on_human_check_timeout: bool = False,
    force_fresh_context: bool = False,
    cdp_endpoint: str = "http://127.0.0.1:9222",
) -> Path:
    """Build a single-product manifest JSON. `sort_type` (when set) is forwarded
    to the ingest CLI so every collected row is stamped with `oy_sort_type` in
    raw_metadata. `suffix` differentiates per-sort manifests in multi-sort
    mode so concurrent batch_ids never collide. Human-check knobs are
    forwarded to the per-product runner so anti-bot CAPTCHA waits use
    operator-supplied timeouts rather than defaults.
    """
    sort_tag = f"_{sort_type}" if sort_type else ""
    batch_id = (
        f"phase2e_pipeline_{goods_no}{sort_tag}{suffix}_"
        f"{datetime.now().strftime('%Y%m%d_%H%M%S')}"
    )
    defaults: dict = {
        "max_reviews": max_reviews,
        "cdp_endpoint": cdp_endpoint,
        "cold_start_timeout": 60,
        "continuation_timeout": 12,
        "scroll_attempts": 5,
        "human_check_timeout_seconds": int(human_check_timeout_seconds),
        "human_check_poll_seconds": int(human_check_poll_seconds),
        "fail_on_human_check_timeout": bool(fail_on_human_check_timeout),
        "force_fresh_context": bool(force_fresh_context),
    }
    if sort_type is not None:
        defaults["sort_type"] = sort_type
    manifest = {
        "batch_id": batch_id,
        "defaults": defaults,
        "products": [
            {"name": product_name, "oy_goods_no": goods_no},
        ],
    }
    path = Path(
        f"/tmp/phase2e_pipeline_{goods_no}{sort_tag}{suffix}_manifest.json",
    )
    path.write_text(json.dumps(manifest, indent=2, ensure_ascii=False))
    # v2.4.6 — log the manifest path AND the cdp_endpoint that landed
    # in defaults. Without this, operators see only the abbreviated
    # "→ invoking scraper: run_oy_collection_batch.py --manifest ..."
    # in stdout and can't directly inspect what the scraper subprocess
    # will receive. Failed image-collection runs now self-document.
    print(
        f"  manifest written → {path} "
        f"(defaults.cdp_endpoint={cdp_endpoint!r}, "
        f"sort_type={sort_type!r}, max_reviews={max_reviews})"
    )
    return path


def _run_one_sort_attempt(
    *, goods_no: str, product_name: str, sort_type: str, cap: int | str,
    suffix: str,
    human_check_timeout_seconds: int = 900,
    human_check_poll_seconds: int = 5,
    fail_on_human_check_timeout: bool = False,
    force_fresh_context: bool = False,
    cdp_endpoint: str = "http://127.0.0.1:9222",
) -> dict:
    """Run a single sort scrape (one manifest invocation). Returns a per-sort
    result dict. Catches RuntimeError from `run_scraper` (rc != 0 / halt) and
    encodes it as `status='scraper_subprocess_failed'` so the multi-sort
    orchestrator can decide whether to retry.
    """
    eff_max, _finite = parse_max_reviews_arg(str(cap))
    manifest_path = build_manifest(
        goods_no, product_name, eff_max,
        sort_type=sort_type, suffix=suffix,
        human_check_timeout_seconds=human_check_timeout_seconds,
        human_check_poll_seconds=human_check_poll_seconds,
        fail_on_human_check_timeout=fail_on_human_check_timeout,
        force_fresh_context=force_fresh_context,
        cdp_endpoint=cdp_endpoint,
    )
    try:
        summary = run_scraper(manifest_path)
    except RuntimeError as e:
        # rc=1 typically = batch halted on anti_bot / auth wall.
        # Encode rather than propagate so caller can try the next sort.
        return {
            "sort_type": sort_type,
            "max_reviews_arg": str(cap),
            "summary": None,
            "rows_inserted": 0,
            "raw_records_seen": 0,
            "status": "scraper_subprocess_failed",
            "error": str(e)[:300],
        }
    prod = summary.get("products", [{}])[0]
    prod_summary = prod.get("summary") if isinstance(prod, dict) else None
    # v2.4.7 — diagnostic print: confirms whether prod.summary actually
    # carries the v2.4.x diagnostic fields after the subprocess returns.
    # When this prints `keys=0` for every sort, the gap is in the
    # batch_summary.json serialization (ProductResult.summary missing).
    # When it prints `keys=N` but `requested_cdp_endpoint=None`, the
    # gap is in the connector's last_run_summary assembly. The
    # difference is observable here without a full live re-run.
    if isinstance(prod_summary, dict):
        diag_keys = sorted(prod_summary.keys())
        print(
            f"  [batch-result-diagnostic] sort={sort_type} "
            f"prod_summary_keys={len(diag_keys)} "
            f"requested_cdp_endpoint={prod_summary.get('requested_cdp_endpoint')!r} "
            f"connector_received_cdp_endpoint={prod_summary.get('connector_received_cdp_endpoint')!r} "
            f"product_image_session_open_called={prod_summary.get('product_image_session_open_called')!r} "
            f"product_image_capture_attempted={prod_summary.get('product_image_capture_attempted')!r}"
        )
    else:
        print(
            f"  [batch-result-diagnostic] sort={sort_type} "
            f"prod_summary=None — ProductResult.summary serialization "
            f"likely dropped the connector dict."
        )
    return {
        "sort_type": sort_type,
        "max_reviews_arg": str(cap),
        "summary": summary,
        "rows_inserted": int(prod.get("rows_inserted") or 0),
        "raw_records_seen": int(prod.get("raw_records_seen") or 0),
        "status": prod.get("status"),
        "quality_status": prod.get("quality_status"),
        "prod_summary": prod_summary,
        # Path the batch runner used as its artifact root for THIS sort.
        # The sort-membership sidecar lives directly under this dir as
        # <goodsNo>_<sort_type>_review_ids.json (when the run produced
        # any review_ids). Captured here so the orchestrator can scan
        # every sort's batch_dir at the end of multi-sort.
        "artifact_root": summary.get("artifact_root"),
    }


def _print_attempt_diagnostics(attempt_result: dict, attempt_label: str) -> None:
    """Print one line per attempt summarizing core counts + sort-aware
    telemetry. Prints both on success and failure paths.
    """
    sort_type = attempt_result.get("sort_type")
    print(
        f"    [{attempt_label}] sort={sort_type} "
        f"status={attempt_result.get('status')} "
        f"rows_inserted={attempt_result.get('rows_inserted')} "
        f"raw_records_seen={attempt_result.get('raw_records_seen')} "
        f"quality={attempt_result.get('quality_status')}",
    )
    if attempt_result.get("error"):
        print(f"      subprocess_error: {attempt_result['error']}")
    ps = attempt_result.get("prod_summary")
    if isinstance(ps, dict):
        observed = ps.get("observed_sort_types")
        filtered = ps.get("responses_filtered_out_by_sort")
        api_resp = ps.get("review_api_response_count")
        false_empty = ps.get("false_empty_state_detected")
        fe_retries = ps.get("false_empty_retry_count")
        avail_labels = ps.get("available_sort_button_labels")
        print(
            f"      telemetry: observed_sort_types={observed} "
            f"filtered_out_by_sort={filtered} "
            f"api_response_count={api_resp} "
            f"false_empty_state_detected={false_empty} "
            f"false_empty_retry_count={fe_retries}",
        )
        if avail_labels:
            print(f"      available_sort_buttons: {avail_labels}")


def run_multi_sort_scrape(
    goods_no: str,
    product_name: str,
    *,
    per_sort_cap_override: str | None = None,
    human_check_timeout_seconds: int = 900,
    human_check_poll_seconds: int = 5,
    fail_on_human_check_timeout: bool = False,
    wait_until_sort_loaded: bool = False,
    retry_queue_path: "Path | str | None" = None,
    product_url: str | None = None,
    run_dir: "Path | str | None" = None,
    strict_retry_backoff_profile: str = "conservative",
    strict_max_attempts: int = 0,
    strict_confirm_before_retry: bool = False,
    strict_reset_session_on_block: bool = False,
    cdp_endpoint: str = "http://127.0.0.1:9222",
    only_sort_types: list[str] | None = None,
    auth_wall_recovery_mode: str = "quick",
    auth_wall_backoff_seconds: float | None = None,
    auth_wall_max_recovery_attempts: int = 1,
    manual_auth_wall_recovery: bool = False,
    diagnostic_artifact_dir: "Path | str | None" = None,
) -> list[dict]:
    """Run the 5-sort multi-sort plan sequentially via manifest invocations.

    Per-sort behavior depends on `wait_until_sort_loaded`:

    Non-strict mode (default):
      - Random jitter `_MULTI_SORT_JITTER_RANGE_S` BETWEEN sorts (not
        before the first) so OY's anti-bot heuristics don't see
        back-to-back sort-button clicks.
      - On a transient failure (status in `_MULTI_SORT_RETRY_STATUSES` or
        `scraper_subprocess_failed`), retry the sort once after a longer
        jitter `_MULTI_SORT_RETRY_JITTER_RANGE_S`. The result of the more
        successful attempt is what's recorded for the sort.
      - A FAIL on a single sort does NOT abort the multi-sort plan —
        the orchestrator continues to the next sort and the failed
        sort is appended to `retry_queue.json` (when
        `retry_queue_path` is set) so it can be re-run later via
        `scripts/retry_queue_drain.py`.

    Strict mode (`wait_until_sort_loaded=True`):
      - The same sort is retried indefinitely (without bound) until
        it returns a success status. Subprocess invocations get
        `human_check_timeout_seconds=0` so the connector itself
        waits indefinitely for the operator to clear any anti-bot /
        login wall in the CDP-attached Chrome.
      - The retry queue is NOT touched.
      - `KeyboardInterrupt` propagates out cleanly so Ctrl+C aborts
        the whole multi-sort plan without partial corruption.
      - `_print_attempt_diagnostics` is called per attempt so the
        operator sees a clear progress line each time.

    `per_sort_cap_override`, when set, replaces the default per-entry
    cap from `MULTI_SORT_PLAN`. Used by `--corpus-mode=observable_multi_sort`
    + `--max-reviews-per-sort` to give every sort the same budget.

    Reviews persist into the same `voc_data.db`; INSERT OR IGNORE on
    review_id deduplicates across sorts (raw_metadata.oy_sort_type
    carries the sort that first surfaced each row).
    """
    # Local import keeps the module-import cost low for tests that
    # don't exercise the queue path.
    from src.voc.app import retry_queue as _retry_queue
    summaries: list[dict] = []
    # Run-003 QA pass-5: per-sort deferred-recovery queue. Entries are
    # (idx, sort_type, cap, role, partial_result) tuples — the partial
    # result already carries `recovery_actions=["wait_after_auth_wall"]`.
    # The main loop appends every deferred sort to `summaries` as a
    # placeholder; the post-loop recovery pass updates that placeholder
    # in-place with the final outcome.
    deferred_queue: list[tuple[int, str, str | int, str | None, dict]] = []
    n_sorts = len(MULTI_SORT_PLAN)
    # Strict mode forces indefinite human-check wait so the
    # connector also doesn't time out under us.
    effective_hc_timeout = (
        0 if wait_until_sort_loaded else int(human_check_timeout_seconds)
    )

    def _is_failure(res: dict) -> bool:
        status = res.get("status")
        if status == "scraper_subprocess_failed":
            return True
        if status in _MULTI_SORT_RETRY_STATUSES:
            return True
        if (res.get("rows_inserted", 0) or 0) <= 0 \
                and (res.get("raw_records_seen", 0) or 0) <= 0:
            # Zero rows AND zero seen → treat as failure regardless
            # of label (covers `human_check_skipped`, blocked variants).
            return True
        return False

    # Run-003 QA pass-5: when `only_sort_types` is set (operator
    # passed --retry-failed-from-summary), filter the plan down to
    # only the failed sorts. Successful sorts from the prior run
    # are skipped — the operator already has those rows in the DB.
    plan = MULTI_SORT_PLAN
    if only_sort_types is not None:
        wanted = set(only_sort_types)
        plan = [e for e in MULTI_SORT_PLAN if e["sort_type"] in wanted]
        print(
            f"  [retry-only] running {len(plan)} of "
            f"{len(MULTI_SORT_PLAN)} sorts: {[e['sort_type'] for e in plan]}",
            flush=True,
        )
    n_sorts_effective = len(plan)
    for idx, entry in enumerate(plan, start=1):
        sort_type = entry["sort_type"]
        cap = per_sort_cap_override if per_sort_cap_override is not None else entry["cap"]
        role = entry["role"]
        # Jitter between sorts (skip before the first).
        if idx > 1:
            jitter = random.uniform(*_MULTI_SORT_JITTER_RANGE_S)
            print(
                f"  [multi-sort jitter] sleeping {jitter:.1f}s before next sort",
                flush=True,
            )
            time.sleep(jitter)

        print(
            f"  [multi-sort {idx}/{n_sorts}] role={role} sort={sort_type} cap={cap}"
            f"{' (STRICT — will retry until loaded)' if wait_until_sort_loaded else ''}",
            flush=True,
        )

        if wait_until_sort_loaded:
            # ---- Strict-mode loop ----
            # Adaptive backoff: every retry samples the
            # `strict_backoff_band(...)` for the current attempt
            # band + failure reason floor, then applies ±20% jitter.
            # Default profile is `conservative` so anti-bot /
            # auth-wall failures wait 10–15+ minutes between
            # subprocess relaunches — empirically OY recovers within
            # that window and the operator can also clear the wall.
            #
            # `strict_max_attempts == 0` keeps the legacy infinite
            # contract; positive values cap the loop and surface a
            # clear giveup message so the orchestrator can move on.
            #
            # `strict_confirm_before_retry` skips the timed wait and
            # blocks on an Enter prompt — for interactive sessions
            # where the operator wants to gate every retry manually.
            from src.voc.app.strict_backoff import (
                JITTER_PCT as _STRICT_JITTER_PCT,
                format_eta as _strict_format_eta,
                is_reset_worthy_reason as _is_reset_worthy,
                strict_backoff_band as _strict_backoff_band,
            )
            attempt_count = 0
            result: dict = {}
            giveup_reason: str | None = None
            # Reset signal carried into the NEXT attempt only — set
            # to True after a reset-worthy failure when the operator
            # opted into --strict-reset-session-on-block, cleared
            # after the next attempt either succeeds or fails with
            # a non-reset-worthy reason.
            force_fresh_for_next_attempt = False
            while True:
                attempt_count += 1
                try:
                    result = _run_one_sort_attempt(
                        goods_no=goods_no, product_name=product_name,
                        sort_type=sort_type, cap=cap,
                        suffix=f"_step{idx}_strict{attempt_count}",
                        human_check_timeout_seconds=effective_hc_timeout,
                        human_check_poll_seconds=human_check_poll_seconds,
                        fail_on_human_check_timeout=False,
                        force_fresh_context=force_fresh_for_next_attempt,
                        cdp_endpoint=cdp_endpoint,
                    )
                except KeyboardInterrupt:
                    print(
                        f"\n  [strict] Ctrl+C received during sort={sort_type} "
                        f"(attempt {attempt_count}); aborting cleanly.",
                        flush=True,
                    )
                    raise
                _print_attempt_diagnostics(
                    result, f"strict attempt {attempt_count}",
                )
                if not _is_failure(result):
                    break
                # Failure → cap?
                if (
                    strict_max_attempts > 0
                    and attempt_count >= strict_max_attempts
                ):
                    giveup_reason = (
                        f"reached --strict-max-attempts="
                        f"{strict_max_attempts}"
                    )
                    print(
                        f"  [strict] {giveup_reason}; giving up on "
                        f"sort={sort_type} (last status="
                        f"{result.get('status')!r}).",
                        flush=True,
                    )
                    break
                # Operator-facing diagnostics for the next wait.
                reason = str(
                    result.get("status") or result.get("quality_status") or ""
                )
                # Also consult `error` / sample_dropped strings so we
                # match `anti_bot` even when status is the generic
                # `scraper_subprocess_failed` envelope.
                reason_for_reset = " ".join([
                    reason,
                    str(result.get("error") or ""),
                    str(result.get("quality_status") or ""),
                ])
                # Session reset signal — opt-in via
                # --strict-reset-session-on-block. Triggered ONLY
                # for sticky session-level failures (anti_bot,
                # anonymous_auth_wall, human_check_timeout). Plain
                # scraper failures and false_empty do NOT trigger.
                if (
                    strict_reset_session_on_block
                    and _is_reset_worthy(reason_for_reset)
                ):
                    print(
                        f"  [strict] Resetting browser session due to "
                        f"{reason_for_reset.strip() or reason}",
                        flush=True,
                    )
                    force_fresh_for_next_attempt = True
                else:
                    force_fresh_for_next_attempt = False
                if strict_confirm_before_retry:
                    prompt = (
                        f"  [strict] Blocked by {reason!r} on attempt "
                        f"{attempt_count} (sort={sort_type}). "
                        f"Press Enter to retry, or Ctrl+C to abort: "
                    )
                    try:
                        # `input()` raises EOFError when stdin is
                        # closed (non-TTY) — treat that as "go
                        # ahead" rather than crashing.
                        input(prompt)
                    except EOFError:
                        print(
                            f"  [strict] stdin closed; proceeding to retry.",
                            flush=True,
                        )
                    except KeyboardInterrupt:
                        print(
                            f"\n  [strict] Ctrl+C at confirm prompt; aborting.",
                            flush=True,
                        )
                        raise
                else:
                    lo, hi = _strict_backoff_band(
                        attempt=attempt_count,
                        profile=strict_retry_backoff_profile,
                        failure_reason=reason,
                    )
                    base = random.uniform(lo, hi)
                    jitter_factor = random.uniform(
                        1.0 - _STRICT_JITTER_PCT,
                        1.0 + _STRICT_JITTER_PCT,
                    )
                    wait_s = max(0.0, base * jitter_factor)
                    print(
                        f"  [strict] Blocked by {reason}. "
                        f"Waiting {_strict_format_eta(wait_s)} before "
                        f"retry (attempt {attempt_count + 1}, "
                        f"profile={strict_retry_backoff_profile}). "
                        f"Please recover Chrome/login if needed.",
                        flush=True,
                    )
                    try:
                        time.sleep(wait_s)
                    except KeyboardInterrupt:
                        print(
                            f"\n  [strict] Ctrl+C during inter-attempt "
                            f"sleep; aborting.",
                            flush=True,
                        )
                        raise
            result["attempts"] = attempt_count
            result["role"] = role
            if giveup_reason is not None:
                result["strict_recovered"] = False
                result["strict_giveup_reason"] = giveup_reason
            else:
                result["strict_recovered"] = True
            summaries.append(result)
            continue

        # ---- Non-strict mode (existing behavior + queue write on fail) ----
        # Attempt 1
        result = _run_one_sort_attempt(
            goods_no=goods_no, product_name=product_name,
            sort_type=sort_type, cap=cap, suffix=f"_step{idx}",
            human_check_timeout_seconds=effective_hc_timeout,
            human_check_poll_seconds=human_check_poll_seconds,
            fail_on_human_check_timeout=fail_on_human_check_timeout,
            cdp_endpoint=cdp_endpoint,
        )
        _print_attempt_diagnostics(result, "attempt 1/2")
        attempt_count = 1

        # Retry once on transient signals.
        is_transient = (
            result.get("status") in _MULTI_SORT_RETRY_STATUSES
            or result.get("status") == "scraper_subprocess_failed"
        )
        if is_transient:
            jitter = random.uniform(*_MULTI_SORT_RETRY_JITTER_RANGE_S)
            print(
                f"    retrying sort={sort_type} once after {jitter:.1f}s "
                f"(prior status={result.get('status')!r})",
            )
            time.sleep(jitter)
            retry_result = _run_one_sort_attempt(
                goods_no=goods_no, product_name=product_name,
                sort_type=sort_type, cap=cap, suffix=f"_step{idx}_retry",
                human_check_timeout_seconds=effective_hc_timeout,
                human_check_poll_seconds=human_check_poll_seconds,
                fail_on_human_check_timeout=fail_on_human_check_timeout,
                cdp_endpoint=cdp_endpoint,
            )
            _print_attempt_diagnostics(retry_result, "attempt 2/2")
            attempt_count = 2
            # Keep the better attempt (more rows is the simplest signal).
            if retry_result.get("rows_inserted", 0) > result.get("rows_inserted", 0) \
                    or retry_result.get("raw_records_seen", 0) > result.get("raw_records_seen", 0):
                result = retry_result
            elif retry_result.get("status") not in (
                _MULTI_SORT_RETRY_STATUSES | {"scraper_subprocess_failed"}
            ) and result.get("status") in (
                _MULTI_SORT_RETRY_STATUSES | {"scraper_subprocess_failed"}
            ):
                # First attempt was transient-failure; retry was at least
                # a non-transient outcome — prefer it.
                result = retry_result
        result["attempts"] = attempt_count
        result["role"] = role

        # Run-003 QA pass-5: deferred recovery for auth-wall-class
        # failures. If this sort hit an anonymous_auth_wall (or a
        # subprocess-level scraper failure carrying the same root
        # cause), do NOT enqueue and do NOT mark final yet — instead
        # remember it on the deferred queue so we can revisit AFTER
        # the rest of the plan. The longer waiting window plus a
        # fresh page state often clears the auth-wall.
        if _is_auth_wall_failure(result):
            recovery_actions = list(result.get("recovery_actions") or [])
            recovery_actions.append("wait_after_auth_wall")
            result["recovery_actions"] = recovery_actions
            result["deferred_for_recovery"] = True
            # Diagnostic artifact + subreason for the failed initial
            # attempt. Run-003 pass-7: every failed attempt emits a
            # JSON the operator can read without grep'ing logs.
            try:
                from src.voc.reporting.phase2e import (
                    auth_wall_diagnostics as _awd,
                )
                diag = _awd.build_diagnostic_summary(
                    sort_type=sort_type,
                    attempt_index=int(result.get("attempts") or 1),
                    sort_result=result,
                )
                result["auth_wall_subreason"] = diag.subreason
                result["auth_wall_next_action_hint_ko"] = (
                    diag.next_action_hint_ko
                )
                if diagnostic_artifact_dir is not None:
                    diag_path = _awd.write_diagnostic_artifact(
                        artifact=diag,
                        out_dir=Path(diagnostic_artifact_dir),
                    )
                    result["diagnostic_artifact_path"] = str(diag_path)
            except Exception as _e:  # noqa: BLE001 — best-effort
                print(f"    [diag] best-effort failed: {_e}", flush=True)
            deferred_queue.append((idx, sort_type, cap, role, result))
            summaries.append(result)
            continue

        # Append to retry queue if this sort failed and a queue path
        # is configured. Best-effort: queue write failure must NOT
        # abort the multi-sort plan.
        if retry_queue_path is not None and _is_failure(result) and product_url:
            try:
                queue_entry = _retry_queue.make_entry(
                    product_url=product_url,
                    goods_no=goods_no,
                    sort_type=sort_type,
                    failure_reason=str(result.get("status") or "unknown_failure"),
                    last_status=result.get("quality_status") or result.get("status"),
                    run_dir=run_dir,
                    extra={
                        "cap": str(cap),
                        "role": role,
                        "attempts": attempt_count,
                    },
                )
                _retry_queue.append(retry_queue_path, queue_entry)
                print(
                    f"    [retry-queue] enqueued sort={sort_type} "
                    f"(reason={queue_entry['failure_reason']!r}) → "
                    f"{retry_queue_path}",
                )
            except Exception as e:
                print(
                    f"    [retry-queue] write failed (benign): {e}",
                    flush=True,
                )
        summaries.append(result)

    # ---- Deferred-recovery pass (Run-003 QA pass-5) ----
    # Auth-wall-class failures aren't safely retried in-place — the
    # bot rate-limit window stays open for several seconds and a
    # fast retry repeats the same outcome. Instead we wait once,
    # then attempt each deferred sort one more time.
    if deferred_queue:
        print(
            f"  [recovery] {len(deferred_queue)} sort(s) failed with "
            f"auth-wall-class status; deferred to recovery pass "
            f"(mode={auth_wall_recovery_mode!r}, "
            f"max_attempts={auth_wall_max_recovery_attempts}, "
            f"manual={manual_auth_wall_recovery}).",
            flush=True,
        )
        # Backoff resolution (Run-003 pass-7):
        #   1. Explicit `auth_wall_backoff_seconds` wins.
        #   2. patient mode → 120-180s window.
        #   3. quick mode (default) → 15-25s window.
        if auth_wall_backoff_seconds is not None:
            backoff = float(auth_wall_backoff_seconds)
        elif auth_wall_recovery_mode == "patient":
            backoff = random.uniform(*_MULTI_SORT_DEFERRED_BACKOFF_PATIENT_S)
        else:
            backoff = random.uniform(*_MULTI_SORT_DEFERRED_BACKOFF_RANGE_S)
        print(
            f"  [recovery] backoff {backoff:.1f}s before retry pass.",
            flush=True,
        )
        time.sleep(backoff)
        for idx, sort_type, cap, role, prior_result in deferred_queue:
            recovery_attempt_count = 0
            recovery_actions = list(prior_result.get("recovery_actions") or [])
            recovery_result: dict | None = None
            still_failed = True
            while recovery_attempt_count < max(
                1, int(auth_wall_max_recovery_attempts)
            ):
                recovery_attempt_count += 1
                # Manual mode: pause for operator intervention before
                # the FIRST recovery attempt of each sort. The
                # operator inspects the CDP browser, fixes login /
                # taps the review tab, and presses Enter.
                if (
                    manual_auth_wall_recovery
                    and recovery_attempt_count == 1
                ):
                    print(
                        f"\n  [manual] {sort_type} 복구 대기 중.",
                        flush=True,
                    )
                    print(
                        "  [manual] CDP 브라우저에서 OliveYoung 리뷰가 "
                        "보이는지 확인하세요. 보이지 않으면 로그인 / "
                        "새로고침 후 Enter.",
                        flush=True,
                    )
                    try:
                        input("  [manual] Enter to continue → ")
                    except (KeyboardInterrupt, EOFError):
                        print("\n  [manual] aborted by operator.", flush=True)
                        break
                    recovery_actions.append("manual_visible_recovery")
                # Sort-specific recovery sequence: each sort gets a
                # tailored set of actions. The connector layer is
                # unchanged — these strings document what we DID
                # ahead of the retry call so the diagnostic artifact
                # carries an audit trail.
                sort_actions = _sort_specific_recovery_actions(
                    sort_type, recovery_attempt_count,
                )
                recovery_actions.extend(sort_actions)

                print(
                    f"  [recovery] retrying sort={sort_type} "
                    f"(recovery attempt {recovery_attempt_count}/"
                    f"{auth_wall_max_recovery_attempts}, actions={sort_actions})",
                    flush=True,
                )
                recovery_result = _run_one_sort_attempt(
                    goods_no=goods_no, product_name=product_name,
                    sort_type=sort_type, cap=cap,
                    suffix=f"_step{idx}_recover{recovery_attempt_count}",
                    human_check_timeout_seconds=effective_hc_timeout,
                    human_check_poll_seconds=human_check_poll_seconds,
                    fail_on_human_check_timeout=fail_on_human_check_timeout,
                    cdp_endpoint=cdp_endpoint,
                )
                _print_attempt_diagnostics(
                    recovery_result,
                    f"recovery attempt {recovery_attempt_count}",
                )
                still_failed = _is_failure(recovery_result)
                if not still_failed:
                    break
                # Inter-attempt cooldown — same backoff window.
                if recovery_attempt_count < auth_wall_max_recovery_attempts:
                    cooldown = backoff * 0.6
                    print(
                        f"  [recovery] cooldown {cooldown:.1f}s before "
                        f"next recovery attempt.",
                        flush=True,
                    )
                    time.sleep(cooldown)
            if recovery_result is None:
                # All recovery attempts skipped (e.g. manual abort).
                # Treat the prior result as final.
                recovery_result = prior_result
                still_failed = True
            recovery_actions.append("retry_after_other_sorts")
            recovery_result["recovery_actions"] = recovery_actions
            recovery_result["role"] = role
            recovery_result["attempts"] = (
                int(prior_result.get("attempts") or 1) + recovery_attempt_count
            )
            if still_failed:
                final_actions = recovery_actions + ["final_failed"]
                recovery_result["recovery_actions"] = final_actions
                # Final-attempt diagnostic artifact.
                try:
                    from src.voc.reporting.phase2e import (
                        auth_wall_diagnostics as _awd,
                    )
                    diag = _awd.build_diagnostic_summary(
                        sort_type=sort_type,
                        attempt_index=int(recovery_result.get("attempts") or 1),
                        sort_result=recovery_result,
                    )
                    recovery_result["auth_wall_subreason"] = diag.subreason
                    recovery_result["auth_wall_next_action_hint_ko"] = (
                        diag.next_action_hint_ko
                    )
                    if diagnostic_artifact_dir is not None:
                        diag_path = _awd.write_diagnostic_artifact(
                            artifact=diag,
                            out_dir=Path(diagnostic_artifact_dir),
                        )
                        recovery_result["diagnostic_artifact_path"] = str(
                            diag_path,
                        )
                except Exception as _e:  # noqa: BLE001 — best-effort
                    print(f"  [diag] recovery artifact emit failed: {_e}",
                          flush=True)
            # Replace the placeholder summary entry in-place so the
            # final summaries list reflects the recovery outcome.
            for i, s in enumerate(summaries):
                if (
                    s.get("sort_type") == sort_type
                    and s.get("deferred_for_recovery") is True
                ):
                    summaries[i] = recovery_result
                    break
            # Late-stage retry-queue write: only after the recovery
            # attempt also failed do we enqueue for a future drain.
            if (
                still_failed
                and retry_queue_path is not None
                and product_url
            ):
                try:
                    queue_entry = _retry_queue.make_entry(
                        product_url=product_url,
                        goods_no=goods_no,
                        sort_type=sort_type,
                        failure_reason=str(
                            recovery_result.get("status") or "unknown_failure"
                        ),
                        last_status=(
                            recovery_result.get("quality_status")
                            or recovery_result.get("status")
                        ),
                        run_dir=run_dir,
                        extra={
                            "cap": str(cap),
                            "role": role,
                            "attempts": recovery_result.get("attempts"),
                            "recovery_actions":
                                recovery_result.get("recovery_actions") or [],
                        },
                    )
                    _retry_queue.append(retry_queue_path, queue_entry)
                    print(
                        f"  [recovery] enqueued sort={sort_type} after "
                        f"final_failed → {retry_queue_path}",
                        flush=True,
                    )
                except Exception as e:  # noqa: BLE001 — defensive
                    print(
                        f"  [recovery] retry-queue write failed (benign): {e}",
                        flush=True,
                    )

    return summaries


def run_scraper(manifest_path: Path) -> dict:
    """Invoke existing batch runner via subprocess. Returns the parsed
    `batch_summary.json` dict, or raises RuntimeError on failure / halt.
    """
    cmd = [
        sys.executable,
        str(REPO / "scripts/run_oy_collection_batch.py"),
        "--manifest", str(manifest_path),
        "--jitter-min", "0",
        "--jitter-max", "5",
    ]
    env = os.environ.copy()
    env["PYTHONPATH"] = str(REPO)
    # Force unbuffered Python stdout in the scraper subprocess so
    # per-page connector progress reaches the parent's captured
    # output live (the parent uses capture_output=True). Without
    # this, slow sorts (e.g. fwee step5 RECOMMENDED_DESC ~14 min)
    # produce no observable progress until the subprocess exits.
    # See ops/agent_handoffs/O-002-FWEE-WEDGE-TRIAGE.md.
    env["PYTHONUNBUFFERED"] = "1"
    print(f"  → invoking scraper: {' '.join(cmd[:3])} ... (this may take 30-60 seconds)")
    result = subprocess.run(cmd, env=env, capture_output=True, text=True, cwd=str(REPO))
    print(f"  scraper exit={result.returncode}")
    if result.stdout:
        for line in result.stdout.strip().splitlines()[-8:]:
            print(f"    {line}")
    if result.returncode != 0:
        # exit code 1 = halted; exit code 2 = startup error
        raise RuntimeError(
            f"Scraper failed (exit {result.returncode}). "
            f"stderr: {result.stderr[-500:]}\n"
            f"stdout: {result.stdout[-500:]}"
        )
    # Locate batch_summary.json
    manifest = json.loads(manifest_path.read_text())
    batch_id = manifest["batch_id"]
    summary_path = REPO / f"data/collection_artifacts/{batch_id}/batch_summary.json"
    if not summary_path.exists():
        raise RuntimeError(f"batch_summary.json not found at {summary_path}")
    return json.loads(summary_path.read_text())


# ---------------------------------------------------------------------------
# Step 3-4 — Fetch reviews from DB and run Stage 1+2+3 per review
# ---------------------------------------------------------------------------


def fetch_reviews(
    goods_no: str,
    *,
    primary_sort_type: str | None = None,
) -> list[dict]:
    """Load reviews for a goodsNo from phase1_reviews.

    When `primary_sort_type` is set, only rows whose
    raw_metadata.oy_sort_type equals it are returned. This is the
    invariant for multi-sort mode: distribution and time-series MUST be
    derived from the primary corpus only — signal-sort rows are evidence,
    not corpus.

    Falls back to the unfiltered query when:
      - `primary_sort_type` is None (single-sort / default / skip-scrape mode),
      - the filtered query returns zero rows (legacy DB with no
        oy_sort_type tags or pre-multi-sort runs).

    Returns: list of dicts ready for run_pipeline / aggregation.
    """
    con = sqlite3.connect(str(DB_PATH))
    cur = con.cursor()
    base_sql = (
        "SELECT review_id, text, rating_normalized, review_date, "
        "       source_channel, raw_metadata_json "
        "FROM phase1_reviews "
        "WHERE product_external_id = ?"
    )

    def _materialize(rows: list) -> list[dict]:
        out: list[dict] = []
        for r in rows:
            out.append({
                "review_id": r[0],
                "text": r[1] or "",
                "rating_normalized": r[2],
                "review_date": r[3],
                "source_channel": r[4] or "oliveyoung",
                "raw_metadata_json": r[5],
            })
        return out

    if primary_sort_type is not None:
        # SQLite's json_extract is the cleanest cross-version path; the
        # column is JSON text on disk. Fallback (below) handles legacy
        # rows where the field is absent.
        cur.execute(
            base_sql + " AND json_extract(raw_metadata_json, '$.oy_sort_type') = ?",
            (goods_no, primary_sort_type),
        )
        filtered = _materialize(cur.fetchall())
        if filtered:
            con.close()
            return filtered
        # No primary-tagged rows — likely legacy DB (rows pre-date the
        # oy_sort_type stamping) OR primary scrape failed entirely. Fall
        # through to the unfiltered query so the downstream pipeline still
        # has data to work with; the operator-facing log line below
        # makes the fallback explicit.
        print(
            f"  ⚠ multi-sort fetch: zero rows tagged "
            f"oy_sort_type={primary_sort_type!r}; falling back to "
            f"unfiltered fetch (legacy / unstamped DB)",
        )

    cur.execute(base_sql, (goods_no,))
    rows = cur.fetchall()
    con.close()
    return _materialize(rows)


def derive_breadcrumb(reviews: list[dict]) -> dict | None:
    """Extract the per-product breadcrumb from `raw_metadata_json`.

    OY scraper stamps every review row with the same breadcrumb dict
    (oy_breadcrumb_ko / oy_category_path / oy_category_leaf_ko /
    oy_breadcrumb_source). We pull the first row that carries a
    non-empty `oy_category_path`. Returns None when no row has it
    (legacy scrape / breadcrumb DOM was missing).

    Defensively normalizes the path: dedupes preserving order, strips
    each node, drops empties, and re-derives `ko` / `leaf_ko` from
    the cleaned path. This is load-bearing for legacy DB rows
    written before the connector enforced normalization at capture
    time — they may carry duplicates ("패드", "패드") or newline
    contamination ("마스크팩\\n패드").

    Shape: {"ko": str, "path": list[str], "leaf_ko": str | None,
            "source": str}
    """
    for r in reviews:
        raw = r.get("raw_metadata_json")
        if not raw:
            continue
        try:
            md = json.loads(raw)
        except Exception:
            continue
        path_raw = md.get("oy_category_path")
        if not (isinstance(path_raw, list) and path_raw):
            # Fall back to the joined string field for very old rows
            # that wrote `oy_breadcrumb_ko` only.
            ko_raw = md.get("oy_breadcrumb_ko")
            if not isinstance(ko_raw, str) or not ko_raw.strip():
                continue
            path = _parse_breadcrumb_text(ko_raw)
        else:
            path = _normalize_breadcrumb_path(path_raw)
        if not path:
            continue
        ko = " > ".join(path)
        return {
            "ko": ko,
            "path": list(path),
            "leaf_ko": path[-1],
            "source": md.get("oy_breadcrumb_source") or "raw_metadata",
        }
    return None


def derive_product_name(reviews: list[dict], fallback: str) -> str:
    """Best-effort product name derivation from raw_metadata_json.

    OY scraper stores product metadata (incl. goodsName) in raw_metadata_json
    on the review row. Falls back to `fallback` if not extractable.
    """
    for r in reviews:
        raw = r.get("raw_metadata_json")
        if not raw:
            continue
        try:
            md = json.loads(raw)
        except Exception:
            continue
        # Common OY fields
        for key in ("oy_goods_name", "goodsName", "product_name"):
            v = md.get(key)
            if v:
                return str(v)
        nested = md.get("goodsDto") or {}
        if isinstance(nested, dict) and nested.get("goodsName"):
            return str(nested["goodsName"])
    return fallback


def run_pipeline(
    reviews: list[dict],
    classifier,
) -> list[dict]:
    """Run Stage 1 → Stage 2 → Stage 3 on a list of reviews.

    Returns the per-review structure consumed by `report.aggregate_product`:
      [{review_id, mixed_review_flag, tradeoff_pair, records: [...]}]
    """
    out = []
    n_total = len(reviews)
    for i, r in enumerate(reviews, 1):
        rid = r["review_id"]
        text = r["text"]

        # Stage 1
        candidates = stage1_extract(rid, text)

        # Stage 2: per-candidate polarity
        polarity_records = []
        for cand in candidates:
            clause = extract_narrow_clause(text, cand.matched_text, max_chars=80)
            rec = classifier.classify(clause, cand.attribute)
            if rec and not rec.drop:
                polarity_records.append(rec)

        # Stage 3: per-review aggregation
        agg = stage3_aggregate(rid, polarity_records, review_text=text)

        # Surface the evidence-scoring inputs alongside the polarity
        # records so report.aggregate_product can attach them to each
        # sample evidence. None when raw_metadata_json is missing /
        # malformed — the downstream selector treats missing values as
        # neutral and falls back to legacy ordering.
        ev_score: float | None = None
        sort_ranks: dict[str, int | None] | None = None
        raw_md_json = r.get("raw_metadata_json")
        if raw_md_json:
            try:
                raw_md = json.loads(raw_md_json)
                if isinstance(raw_md, dict):
                    s = raw_md.get("oy_evidence_score")
                    if isinstance(s, (int, float)) and not isinstance(s, bool):
                        ev_score = float(s)
                    sr = raw_md.get("oy_sort_ranks")
                    if isinstance(sr, dict):
                        sort_ranks = sr
            except (TypeError, ValueError):
                pass

        out.append({
            "review_id": rid,
            "mixed_review_flag": agg.mixed_review_flag,
            "tradeoff_pair": agg.tradeoff_pair,
            "records": [
                {
                    "attribute": rec.attribute,
                    "polarity": rec.polarity,
                    "intensity": rec.intensity,
                    "evidence_span": rec.evidence_span,
                    "confidence": rec.confidence,
                    "delivery_condition_flag": False,
                }
                for rec in agg.records
            ],
            # Per-review fields used by the evidence selector. These are
            # additive — aggregator copies them verbatim into each
            # sample_evidence dict; legacy callers that don't pass them
            # see the existing behavior with neutral score contributions.
            "oy_evidence_score": ev_score,
            "oy_sort_ranks": sort_ranks,
            "rating_normalized": r.get("rating_normalized"),
            "review_date": r.get("review_date"),
        })

        if i % 25 == 0 or i == n_total:
            print(f"    pipeline progress: {i}/{n_total}")

    return out


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n", 1)[0])
    ap.add_argument("url", help="OliveYoung product URL or bare goodsNo")
    ap.add_argument("--product-name", default=None,
                    help="override product name (otherwise derived from DB metadata)")
    ap.add_argument("--max-reviews", default="200",
                    help=("max reviews per product (passed to scraper). Default 200. "
                          "Pass 'all' / 'unlimited' / '0' to lift the artificial cap "
                          f"(effectively scrape until pagination exhausted; uses "
                          f"sentinel {UNLIMITED_SENTINEL}). The OliveYoung connector "
                          "does not have a first-class unlimited mode."))
    ap.add_argument("--skip-scrape", action="store_true",
                    help="skip scraping; use whatever rows are already in DB for this goodsNo")
    ap.add_argument(
        "--reuse-collection-summary", default=None,
        help=(
            "Path to an existing collection_summary.json whose "
            "sorts_succeeded / sorts_failed / partial_success / per_sort "
            "state must be preserved across the run. Use after a "
            "successful retry to re-run Stage 1/2/3 + analysis_report "
            "+ seller PDF + buyer cardnews on the existing DB rows "
            "WITHOUT clobbering the retry-success state. Implies "
            "--skip-scrape."
        ),
    )
    ap.add_argument(
        "--retry-failed-from-summary", default=None,
        help=(
            "Path to a previous collection_summary.json. When set, "
            "the multi-sort plan is filtered down to ONLY the sorts "
            "this summary recorded as `sorts_failed`. Used to recover "
            "after a partial_success run without re-scraping the "
            "successful sorts. Implies --multi-sort."
        ),
    )
    # Run-003 QA pass-7: auth-wall recovery knobs.
    ap.add_argument(
        "--auth-wall-recovery-mode",
        choices=("quick", "patient"),
        default="quick",
        help=(
            "Quick (default): 15-25s deferred backoff. Patient: 120-180s "
            "backoff for cases where the OY anti-bot window outlasts a "
            "fast retry. Patient mode noticeably extends total run time."
        ),
    )
    ap.add_argument(
        "--auth-wall-backoff-seconds", type=float, default=None,
        help=(
            "Override the deferred backoff with an exact value (in "
            "seconds). Wins over --auth-wall-recovery-mode."
        ),
    )
    ap.add_argument(
        "--auth-wall-max-recovery-attempts", type=int, default=1,
        help=(
            "How many times the recovery pass will retry each "
            "auth-wall-failed sort before giving up. Default 1. "
            "Higher values pair best with --auth-wall-recovery-mode "
            "patient."
        ),
    )
    ap.add_argument(
        "--manual-auth-wall-recovery", action="store_true",
        help=(
            "Pause for operator intervention before each recovery "
            "attempt of an auth-wall-failed sort. The operator inspects "
            "the CDP browser, fixes login / re-wakes the review tab, "
            "then presses Enter. Useful when automated recovery has "
            "exhausted itself and a human can confirm the page state."
        ),
    )
    ap.add_argument(
        "--diagnostic-artifact-dir", default=None,
        help=(
            "Directory to write per-failed-attempt diagnostic_summary "
            "JSON files into. Default: data/collection_artifacts/"
            "<batch_id>/. Pass-7 surfaces auth-wall subreason + the "
            "connector signals that drove the classification."
        ),
    )
    ap.add_argument("--out-pdf", default=None,
                    help="output PDF path (default: docs/phase2e_report_<goodsNo>_pipeline_v2.pdf)")
    ap.add_argument(
        "--emit-analysis-report-json", default=None,
        help=(
            "Optional path to write the v3.0 analysis_report.json shaped "
            "for the content engine. When set, a Python adapter is run "
            "after aggregation (no analysis logic changes) and the JSON "
            "is written to this path. Use this to feed scripts/run_content.py."
        ),
    )
    ap.add_argument(
        "--analysis-report-source-url", default=None,
        help=(
            "Source URL recorded inside the emitted analysis_report.json "
            "(default: the URL passed positionally)."
        ),
    )
    ap.add_argument(
        "--analysis-report-product-slug", default=None,
        help=(
            "Filesystem-safe product slug recorded inside the emitted "
            "analysis_report.json. Default: derived via slugify() from "
            "product_name + URL."
        ),
    )
    ap.add_argument(
        "--emit-collection-summary-json", default=None,
        help=(
            "Optional path to write the per-run scrape provenance "
            "sidecar (collection_summary.json). Captures per-sort "
            "outcomes, attempt counts, anti-bot flags, raw record "
            "counts. The manifest writer in run_content.py probes "
            "for this file at <run_dir>/shared/collection_summary.json "
            "to populate the manifest's `collection.sorts_*` fields."
        ),
    )
    ap.add_argument(
        "--no-collect-product-image", action="store_true",
        help=(
            "Disable pipeline-start product image collection. "
            "By default, when --emit-analysis-report-json is set, the "
            "pipeline detects the source from the URL, extracts a "
            "representative product image (OY: detail-page og:image / "
            "JSON-LD), caches it under <run>/assets/, and threads "
            "image_local_path through to analysis_report.product. "
            "Pass this flag to skip that step (e.g. for offline "
            "tests). Image collection failures are warnings, not "
            "errors — this flag is for explicit opt-out only."
        ),
    )
    ap.add_argument("--stub-llm", action="store_true",
                    help="use deterministic stub classifier (no API calls; for testing only)")
    ap.add_argument("--llm-model", default="gpt-4o-mini",
                    help="OpenAI model for Stage 2 polarity classification")
    # ---- Phase 2E sort-aware crawl flags ----
    ap.add_argument(
        "--sort-type", dest="sort_type",
        choices=_MULTI_SORT_TYPES_IN_PLAN,
        default=None,
        help=(
            "Single-sort mode: scrape one OliveYoung review sort (default: not "
            "set — page-default sort). When set, every collected row is "
            "stamped with raw_metadata.oy_sort_type. Mutually exclusive with "
            "--multi-sort."
        ),
    )
    ap.add_argument(
        "--multi-sort", dest="multi_sort", action="store_true",
        help=(
            "Run a primary corpus scrape (DATETIME_DESC, cap=all) followed "
            f"by 4 signal-sort top-{SIGNAL_SORT_DEFAULT_CAP} probes "
            "(RATING_ASC, RATING_DESC, USEFUL_SCORE_DESC, RECOMMENDED_DESC). "
            "Default semantics (corpus-mode=primary_only): the primary run "
            "is the analysis corpus; signal sorts are an evidence pool only "
            "and DO NOT contribute to distribution or time-series numbers. "
            "With --corpus-mode=observable_multi_sort, ALL collected rows "
            "across every sort are merged (deduped by review_id) and drive "
            "analysis. Mutually exclusive with --sort-type."
        ),
    )
    ap.add_argument(
        "--corpus-mode", dest="corpus_mode",
        choices=("primary_only", "observable_multi_sort"),
        default="primary_only",
        help=(
            "How to interpret the multi-sort scrape:\n"
            "  primary_only         — analysis corpus is the DATETIME_DESC "
            "rows only. Signal sorts are evidence pool. (default; legacy)\n"
            "  observable_multi_sort — analysis corpus is the union of every "
            "sort's rows after dedup-by-review_id. Reflects the observable "
            "review space a consumer can reach by switching sorts. Implies "
            "--multi-sort."
        ),
    )
    ap.add_argument(
        "--max-reviews-per-sort", dest="max_reviews_per_sort", default=None,
        help=(
            "Per-sort cap when --corpus-mode=observable_multi_sort. Defaults "
            f"to {SIGNAL_SORT_DEFAULT_CAP} for signal sorts and 'all' for the "
            "primary (DATETIME_DESC) sort. Pass an integer to apply uniformly."
        ),
    )
    ap.add_argument(
        "--max-total-reviews", dest="max_total_reviews", type=int, default=None,
        help=(
            "Optional cap on the merged corpus size after dedup. Applied "
            "only with --corpus-mode=observable_multi_sort. None = no cap. "
            "When set, oldest rows by review_date are kept (most-recent-first)."
        ),
    )
    # ---- Human-check (anti-bot CAPTCHA) wait-and-resume ----
    ap.add_argument(
        "--human-check-timeout-seconds",
        dest="human_check_timeout_seconds",
        type=int, default=900,
        help=(
            "Maximum seconds to wait for an operator to clear an "
            "anti-bot / human-verification page in Chrome. Default 900 "
            "(15 min). Set higher for unattended overnight runs."
        ),
    )
    ap.add_argument(
        "--human-check-poll-seconds",
        dest="human_check_poll_seconds",
        type=int, default=5,
        help=(
            "DOM poll interval (seconds) while waiting for the human "
            "check to clear. Default 5."
        ),
    )
    ap.add_argument(
        "--fail-on-human-check-timeout",
        dest="fail_on_human_check_timeout",
        action="store_true",
        help=(
            "Mark the sort as blocked on human-check timeout. Default "
            "off — the timed-out sort is marked partial / skipped and "
            "the orchestrator continues to the next sort."
        ),
    )
    # ---- Strict no-skip multi-sort mode ----
    ap.add_argument(
        "--wait-until-sort-loaded",
        "--no-skip-sorts",
        dest="wait_until_sort_loaded",
        action="store_true",
        help=(
            "Strict per-sort retry: every sort is retried until it "
            "loads. Implies indefinite human-check wait "
            "(--human-check-timeout-seconds 0). Disables the retry "
            "queue (the orchestrator never gives up on a sort, so "
            "there is nothing to enqueue). Ctrl+C aborts the run. "
            "Designed for small manual batches with operator-attended "
            "CAPTCHA solving."
        ),
    )
    ap.add_argument(
        "--retry-queue-path",
        dest="retry_queue_path",
        type=Path,
        default=REPO / "retry_queue.json",
        help=(
            "Path to the JSON file the orchestrator appends failed "
            "sorts to when running in non-strict mode. Drain via "
            "scripts/retry_queue_drain.py. Default: "
            "<repo>/retry_queue.json. Ignored when "
            "--wait-until-sort-loaded is set."
        ),
    )
    ap.add_argument(
        "--strict-retry-backoff-profile",
        dest="strict_retry_backoff_profile",
        choices=("conservative", "normal", "fast"),
        default="conservative",
        help=(
            "Strict-mode retry backoff schedule. "
            "`conservative` (default) waits 45–90s on attempts 1–2, "
            "3–5min on 3–5, 10–15min on 6–10, and 20–30min on 11+. "
            "`normal` is roughly 4× shorter at every band. "
            "`fast` mirrors the legacy 3–6s loop and should ONLY be "
            "used against ephemeral test fixtures — it is empirically "
            "anti-bot-triggering against real OY traffic. All "
            "profiles enforce per-failure-reason floors: anti_bot ≥ "
            "900s, anonymous_auth_wall ≥ 600s, human_check ≥ 900s, "
            "false_empty >= 120s. Plus minus 20 percent jitter applied on top."
        ),
    )
    ap.add_argument(
        "--strict-max-attempts",
        dest="strict_max_attempts",
        type=int,
        default=0,
        help=(
            "Cap on per-sort retry attempts in strict mode. 0 (the "
            "default) preserves the original infinite-retry contract "
            "for manual operator-attended runs. Positive values let "
            "the orchestrator give up on a stuck sort after N attempts "
            "and continue with the next sort."
        ),
    )
    ap.add_argument(
        "--strict-confirm-before-retry",
        dest="strict_confirm_before_retry",
        action="store_true",
        help=(
            "Skip the timed backoff and instead prompt the operator "
            "to press Enter before each strict-mode retry. Useful for "
            "interactive sessions where the operator wants to gate "
            "every relaunch manually after recovering Chrome / login. "
            "Mutually compatible with --strict-max-attempts."
        ),
    )
    ap.add_argument(
        "--strict-reset-session-on-block",
        dest="strict_reset_session_on_block",
        action="store_true",
        help=(
            "On sticky session-level failures (anti_bot, "
            "anonymous_auth_wall, human_check_timeout) under "
            "strict mode, force the next subprocess to create a "
            "fresh Playwright context. Cookies / localStorage are "
            "NOT carried over so the operator must re-login "
            "manually. Backoff alone often fails to clear OY's "
            "session-level fingerprint; this flag does. Does NOT "
            "trigger on false_empty (transient render race) or "
            "plain scraper failures."
        ),
    )
    # ---- Browser CDP endpoint plumbing ----
    # The OY scraper attaches over CDP. The orchestrator runs a
    # mode-aware preflight that selects between system Chrome and
    # the Playwright-bundled Chromium, then passes the resulting
    # endpoint here so the per-sort manifest pins it explicitly
    # rather than baking in `localhost:9222`.
    ap.add_argument(
        "--cdp-endpoint", dest="cdp_endpoint",
        default="http://127.0.0.1:9222",
        help=(
            "CDP endpoint the OY scraper attaches to. Default "
            "http://127.0.0.1:9222. The orchestrator (`run_all.py`) "
            "passes this through after the browser preflight; you "
            "only need to set it manually when running this script "
            "outside the orchestrator."
        ),
    )
    # ---- Category formatting for analysis_report.product.category ----
    ap.add_argument(
        "--category-mode", dest="category_mode",
        choices=["leaf", "full_path"], default="leaf",
        help=(
            "How to render the product category in analysis_report: "
            "`leaf` (default) writes only the deepest breadcrumb node "
            "(e.g. \"패드\"); `full_path` writes the full \" > \"-joined "
            "path (e.g. \"뷰티 > 스킨케어 > 토너패드\"). The full path "
            "is always available under raw_metadata.oy_category_path "
            "for filtering — this flag controls only the user-facing "
            "category string."
        ),
    )
    args = ap.parse_args()

    # --reuse-collection-summary implies --skip-scrape and is only
    # meaningful when the prior summary exists. Validate up-front so
    # the operator gets a fast, clear error instead of mid-run.
    if args.reuse_collection_summary:
        prior_path = Path(args.reuse_collection_summary)
        if not prior_path.is_file():
            print(
                f"  ⚠ --reuse-collection-summary points to a missing file: "
                f"{prior_path}",
                file=sys.stderr,
            )
            sys.exit(2)
        if not args.skip_scrape:
            args.skip_scrape = True
            print(
                "  [reuse-summary] --reuse-collection-summary implies "
                "--skip-scrape; enabling automatically.",
                flush=True,
            )

    # OPENAI_API_KEY fail-fast. Without --stub-llm the pipeline calls
    # the real classifier; missing the key leads to a confusing late
    # failure deep in Stage 2. Refuse early with a clear message.
    if not args.stub_llm and not os.environ.get("OPENAI_API_KEY"):
        print(
            "  ⚠ OPENAI_API_KEY is not set. Set it in your environment "
            "before running without --stub-llm. Aborting before any "
            "DB / network work.",
            file=sys.stderr,
        )
        sys.exit(2)

    # observable_multi_sort implies multi-sort
    if args.corpus_mode == "observable_multi_sort":
        args.multi_sort = True

    if args.multi_sort and args.sort_type is not None:
        print("  ⚠ --multi-sort and --sort-type are mutually exclusive",
              file=sys.stderr)
        sys.exit(2)
    if args.multi_sort and args.skip_scrape:
        # Allow --skip-scrape under observable_multi_sort: the operator
        # may have already collected all 5 sorts in a prior run and want
        # to re-aggregate from DB without re-scraping.
        if args.corpus_mode != "observable_multi_sort":
            print("  ⚠ --multi-sort and --skip-scrape are mutually exclusive "
                  "(--multi-sort exists to run scrapes)", file=sys.stderr)
            sys.exit(2)

    started = time.time()

    # Parse --max-reviews
    try:
        effective_max, finite_limit_set = parse_max_reviews_arg(args.max_reviews)
    except ValueError as e:
        print(f"  ⚠ {e}", file=sys.stderr)
        sys.exit(2)
    max_reviews_display = "all (no cap)" if not finite_limit_set else str(effective_max)

    # Step 1
    print(f"[1/6] Parsing URL → goodsNo")
    goods_no = parse_goods_no_from_url(args.url)
    print(f"  goodsNo = {goods_no}")

    # Step 2 — Scrape (unless skipped)
    collection_started_at: str | None = None
    collection_completed_at: str | None = None
    multi_sort_summaries: list[dict] | None = None
    if args.skip_scrape:
        print(f"[2/6] Scrape skipped (--skip-scrape); using existing DB rows")
    elif args.multi_sort:
        print(
            f"[2/6] Multi-sort scrape: 1 primary corpus "
            f"({PRIMARY_CORPUS_SORT_TYPE}, cap=all) + "
            f"{len(SIGNAL_SORT_TYPES)} signal probes "
            f"(top-{SIGNAL_SORT_DEFAULT_CAP} each: "
            f"{', '.join(SIGNAL_SORT_TYPES)})",
        )
        product_name_for_manifest = args.product_name or f"Product {goods_no}"
        collection_started_at = datetime.now().isoformat(timespec="seconds")
        # `run_multi_sort_scrape` no longer raises on per-sort failure;
        # it records each outcome and continues. Failure aggregation
        # happens here so we can distinguish "all 5 transient-failed"
        # (likely CDP / anti-bot — fail-fast) from "1-2 hit anti-bot
        # but at least one succeeded" (proceed with partial data).
        # Run-003 QA pass-5: --retry-failed-from-summary lets the
        # operator re-run ONLY the sorts a prior run recorded as
        # `sorts_failed`. The successful sorts' rows are reused from
        # the DB (already inserted via INSERT OR IGNORE).
        only_sort_types: list[str] | None = None
        if args.retry_failed_from_summary:
            try:
                prior = json.loads(
                    Path(args.retry_failed_from_summary)
                    .read_text(encoding="utf-8")
                )
                only_sort_types = list(prior.get("sorts_failed") or [])
                if not only_sort_types:
                    print(
                        f"  [retry-only] {args.retry_failed_from_summary} "
                        f"reports no sorts_failed — running the full plan "
                        f"to be safe.",
                        flush=True,
                    )
                    only_sort_types = None
                else:
                    print(
                        f"  [retry-only] re-running failed sorts from "
                        f"{args.retry_failed_from_summary}: {only_sort_types}",
                        flush=True,
                    )
            except (OSError, json.JSONDecodeError) as e:
                print(
                    f"  [retry-only] couldn't read prior summary "
                    f"({e}); running the full plan.",
                    flush=True,
                )

        multi_sort_summaries = run_multi_sort_scrape(
            goods_no, product_name_for_manifest,
            per_sort_cap_override=args.max_reviews_per_sort,
            human_check_timeout_seconds=args.human_check_timeout_seconds,
            human_check_poll_seconds=args.human_check_poll_seconds,
            fail_on_human_check_timeout=args.fail_on_human_check_timeout,
            wait_until_sort_loaded=args.wait_until_sort_loaded,
            retry_queue_path=(
                None if args.wait_until_sort_loaded else args.retry_queue_path
            ),
            product_url=args.url,
            run_dir=None,  # the pipeline script doesn't own a run_dir; run_all does
            strict_retry_backoff_profile=args.strict_retry_backoff_profile,
            strict_max_attempts=args.strict_max_attempts,
            strict_confirm_before_retry=args.strict_confirm_before_retry,
            strict_reset_session_on_block=args.strict_reset_session_on_block,
            cdp_endpoint=args.cdp_endpoint,
            only_sort_types=only_sort_types,
            auth_wall_recovery_mode=args.auth_wall_recovery_mode,
            auth_wall_backoff_seconds=args.auth_wall_backoff_seconds,
            auth_wall_max_recovery_attempts=args.auth_wall_max_recovery_attempts,
            manual_auth_wall_recovery=args.manual_auth_wall_recovery,
            diagnostic_artifact_dir=args.diagnostic_artifact_dir,
        )
        collection_completed_at = datetime.now().isoformat(timespec="seconds")

        # Run-003 QA pass-6: when only-failed retry was used, the
        # plan ran ONLY the previously-failed sorts. The new sidecar
        # would otherwise lose history of the prior-run successes.
        # Merge synthetic per-sort summaries from the prior file so
        # the new collection_summary.json stays a complete record:
        # successful sorts carry their old counts; retried sorts
        # carry the recovery_actions log.
        if only_sort_types is not None and args.retry_failed_from_summary:
            try:
                prior_summary = json.loads(
                    Path(args.retry_failed_from_summary)
                    .read_text(encoding="utf-8"),
                )
                prior_per_sort = prior_summary.get("per_sort") or {}
                retried_set = set(only_sort_types)
                merged: list[dict] = []
                seen: set[str] = set()
                # First pass: walk the canonical multi-sort plan order
                # so the merged list mirrors MULTI_SORT_PLAN ordering.
                for entry in MULTI_SORT_PLAN:
                    st = entry["sort_type"]
                    if st in retried_set:
                        # Use the freshly-retried summary.
                        for s in multi_sort_summaries:
                            if s.get("sort_type") == st and st not in seen:
                                merged.append(s)
                                seen.add(st)
                                break
                    else:
                        # Reuse the prior-run summary, marked so a
                        # future pass can spot the carry-over.
                        prior_entry = prior_per_sort.get(st)
                        if isinstance(prior_entry, dict):
                            carryover = dict(prior_entry)
                            carryover["sort_type"] = st
                            actions = list(
                                carryover.get("recovery_actions") or []
                            )
                            if "carryover_from_prior_run" not in actions:
                                actions.insert(0, "carryover_from_prior_run")
                            carryover["recovery_actions"] = actions
                            merged.append(carryover)
                            seen.add(st)
                # Append any retried sorts not in the canonical plan
                # (defensive — should never fire today).
                for s in multi_sort_summaries:
                    st = s.get("sort_type")
                    if st and st not in seen:
                        merged.append(s)
                        seen.add(st)
                multi_sort_summaries = merged
                print(
                    f"  [retry-merge] merged {len(retried_set)} retried "
                    f"sort(s) with {len(merged) - len(retried_set)} "
                    f"prior-run successe(s) into the new sidecar.",
                    flush=True,
                )
            except (OSError, json.JSONDecodeError) as e:
                print(
                    f"  [retry-merge] couldn't merge prior summary "
                    f"({e}); the new sidecar will only carry retried sorts.",
                    flush=True,
                )

        # Fail-fast: if every sort returned 0 raw_records_seen AND 0
        # inserted rows, the pipeline would silently fall back to
        # whatever was already in the DB and produce a misleading PDF.
        # Abort instead. We use raw_records_seen instead of just
        # rows_inserted because re-runs commonly insert 0 (all dups)
        # but still SAW reviews via the API — that's success.
        total_inserted = sum(
            int(s.get("rows_inserted") or 0) for s in multi_sort_summaries
        )
        total_seen = sum(
            int(s.get("raw_records_seen") or 0) for s in multi_sort_summaries
        )
        n_sorts_with_progress = sum(
            1 for s in multi_sort_summaries
            if int(s.get("raw_records_seen") or 0) > 0
        )
        if total_seen == 0 and total_inserted == 0:
            print()
            print("=" * 70, file=sys.stderr)
            # Detect the specific "review list API not triggered" condition
            # so the operator gets a clear pointer to the diagnostic
            # script instead of a generic "unknown_failure" message.
            list_api_not_triggered = any(
                (s.get("status") or "")
                == "review_list_api_not_seen_but_review_meta_seen"
                for s in multi_sort_summaries
            )
            if list_api_not_triggered:
                print(
                    "✗ Multi-sort scrape: review list API not triggered "
                    "on any sort. The page knows there are reviews "
                    "(meta APIs fired) but the main cursor API never "
                    "woke up. This is NOT anti-bot and NOT a profile "
                    "reset case.",
                    file=sys.stderr,
                )
                print(
                    "  Run the diagnostic to see which gesture wakes "
                    "the API in the CDP Chrome:",
                    file=sys.stderr,
                )
                print(
                    "    PYTHONPATH=. python3 scripts/diagnose_oy_review_access.py "
                    "--product-url \"<your URL>\"",
                    file=sys.stderr,
                )
                print(
                    "  Then read outputs/diagnostics/<UTC ts>_oy_access/"
                    "diagnostic_summary.json — the `summary."
                    "trigger_step_that_woke_list_api` field tells you "
                    "which step worked.",
                    file=sys.stderr,
                )
            else:
                # Run-003 pass-7: retry-only context tells a different
                # story. Saying "ALL 5 sorts saw 0" is inaccurate —
                # only the previously-failed sorts were re-attempted;
                # the prior successful sorts kept their DB rows.
                if args.retry_failed_from_summary:
                    n_attempted = len(multi_sort_summaries)
                    print(
                        f"✗ Retry-only run attempted {n_attempted} failed "
                        f"sort(s) and saw 0 review records "
                        f"(total raw_records_seen=0, rows_inserted=0). "
                        f"Prior successful sorts were not re-scraped. "
                        f"Aborting before analysis to avoid generating a "
                        f"misleading report.",
                        file=sys.stderr,
                    )
                else:
                    print(
                        "✗ Multi-sort scrape: ALL 5 sorts saw 0 review "
                        "records (total raw_records_seen=0, "
                        "rows_inserted=0). "
                        "Aborting before pipeline to avoid generating a "
                        "misleading report from stale DB state.",
                        file=sys.stderr,
                    )
            print("Per-sort outcomes:", file=sys.stderr)
            for s in multi_sort_summaries:
                print(
                    f"  sort={s.get('sort_type')} status={s.get('status')} "
                    f"attempts={s.get('attempts',1)} "
                    f"raw_records_seen={s.get('raw_records_seen')} "
                    f"rows_inserted={s.get('rows_inserted')}",
                    file=sys.stderr,
                )
                if s.get("error"):
                    print(f"    error: {s['error']}", file=sys.stderr)
            if not list_api_not_triggered:
                print(
                    "Common causes: CDP Chrome not running / not logged "
                    "in; OY anti-bot block (try waiting 10-30 min); "
                    "false-empty render state (check "
                    "false_empty_state_detected in per-sort "
                    "batch_summary.json); sort-button selectors "
                    "changed (check available_sort_button_labels). "
                    "If meta APIs fired but the list API did not, "
                    "see scripts/diagnose_oy_review_access.py.",
                    file=sys.stderr,
                )
            print("=" * 70, file=sys.stderr)
            sys.exit(4)
        # Partial success — log how many sorts produced progress.
        if n_sorts_with_progress < len(multi_sort_summaries):
            print(
                f"  ⚠ Multi-sort partial success: "
                f"{n_sorts_with_progress}/{len(multi_sort_summaries)} sorts "
                f"saw review data; proceeding with merged DB. "
                f"total_raw_records_seen={total_seen} "
                f"total_rows_inserted={total_inserted}",
            )

        # ---- Multi-sort membership tracking ----
        # Each per-sort batch_dir contains a sidecar listing the
        # review_ids that sort observed (when the run produced any).
        # We merge across all of them and additively update raw_metadata
        # on each row so cross-sort memberships (e.g., "this primary
        # review also appeared in RATING_ASC top 50") are preserved.
        #
        # This ONLY enriches metadata; it does NOT change which rows are
        # in the analysis corpus — fetch_reviews() still filters to
        # oy_sort_type == DATETIME_DESC. The membership fields are
        # additive and idempotent (re-running yields the same lists).
        from src.voc.app.sort_membership import (
            apply_to_db as _membership_apply,
            find_sidecars as _membership_find_sidecars,
            merge_sidecars as _membership_merge,
        )
        batch_dirs = [
            Path(s["artifact_root"])
            for s in multi_sort_summaries
            if s.get("artifact_root")
        ]
        sidecars = _membership_find_sidecars(batch_dirs, goods_no)
        if not sidecars:
            print(
                f"  ⚠ multi-sort membership: no sidecars found across "
                f"{len(batch_dirs)} per-sort artifact dirs — skipping "
                f"membership enrichment",
            )
        else:
            print(
                f"  multi-sort membership: merging "
                f"{len(sidecars)} sidecar(s) → DB raw_metadata",
            )
            membership = _membership_merge(sidecars)
            stats = _membership_apply(
                DB_PATH, goods_no=goods_no, membership=membership,
            )
            print(
                f"  membership applied: examined={stats.rows_examined} "
                f"updated={stats.rows_updated} no_op={stats.rows_no_op} "
                f"missing_in_db={stats.rows_missing_in_db}",
            )

        # ---- Evidence scoring (depends on the membership pass above) ----
        # Compute oy_evidence_score for every row of this product. The
        # score reads rating_normalized + raw_metadata.oy_sort_ranks, both
        # of which are now in their final state for this run. Idempotent
        # under stable weights — re-running yields rows_no_op==N.
        from src.voc.app.evidence_scoring import (
            apply_evidence_scores_to_db as _apply_scores,
        )
        score_stats = _apply_scores(DB_PATH, goods_no=goods_no)
        print(
            f"  evidence scoring: examined={score_stats.rows_examined} "
            f"updated={score_stats.rows_updated} "
            f"no_op={score_stats.rows_no_op} "
            f"skipped_no_metadata={score_stats.rows_skipped_no_metadata}",
        )
    else:
        print(
            f"[2/6] Scraping OliveYoung "
            f"(max_reviews={max_reviews_display}"
            f"{', sort=' + args.sort_type if args.sort_type else ''})",
        )
        product_name_for_manifest = args.product_name or f"Product {goods_no}"
        manifest_path = build_manifest(
            goods_no, product_name_for_manifest, effective_max,
            sort_type=args.sort_type,
            human_check_timeout_seconds=args.human_check_timeout_seconds,
            human_check_poll_seconds=args.human_check_poll_seconds,
            fail_on_human_check_timeout=args.fail_on_human_check_timeout,
            cdp_endpoint=args.cdp_endpoint,
        )
        collection_started_at = datetime.now().isoformat(timespec="seconds")
        try:
            summary = run_scraper(manifest_path)
        except RuntimeError as e:
            print(f"  ⚠ Scraper failed: {e}", file=sys.stderr)
            print(f"  Tip: ensure CDP Chrome is running on localhost:9222 and logged into OliveYoung",
                  file=sys.stderr)
            print(f"       — OR use --skip-scrape if you've already collected reviews",
                  file=sys.stderr)
            sys.exit(2)
        collection_completed_at = datetime.now().isoformat(timespec="seconds")
        prod_summary = summary.get("products", [{}])[0]
        print(f"  scrape status={prod_summary.get('status')} "
              f"rows_inserted={prod_summary.get('rows_inserted')} "
              f"quality={prod_summary.get('quality_status')}")

    # Step 3-4 — Fetch reviews from DB.
    #
    # Multi-sort mode invariant: the analysis corpus is the PRIMARY sort
    # only (DATETIME_DESC). Signal-sort rows persist in the DB but are
    # excluded here so distribution and time-series numbers are not
    # biased by the sort-tail probes. See requirement #5 of the
    # 2026-04-28 multi-sort redesign: signal sorts are an evidence pool,
    # not a corpus basis.
    if args.multi_sort and args.corpus_mode == "primary_only":
        print(
            f"[3/6] Fetching reviews from DB "
            f"(corpus_mode=primary_only; filter oy_sort_type="
            f"{PRIMARY_CORPUS_SORT_TYPE})",
        )
        reviews = fetch_reviews(
            goods_no, primary_sort_type=PRIMARY_CORPUS_SORT_TYPE,
        )
    elif args.multi_sort and args.corpus_mode == "observable_multi_sort":
        # Merged corpus: every row collected across all sort scrapes,
        # already deduplicated by review_id at INSERT time. The
        # `oy_observed_sort_types` field on each row records which
        # sorts surfaced it (additive metadata).
        print(
            f"[3/6] Fetching reviews from DB "
            f"(corpus_mode=observable_multi_sort; merged across all sorts)",
        )
        reviews = fetch_reviews(goods_no)
        # Optional post-merge cap. When set, keep the most recent rows
        # by review_date (DESC). Conservative tie-break: review_id ASC.
        if args.max_total_reviews and len(reviews) > args.max_total_reviews:
            reviews = sorted(
                reviews,
                key=lambda r: (r.get("review_date") or "", r.get("review_id") or ""),
                reverse=True,
            )[: args.max_total_reviews]
            print(
                f"  capped merged corpus at --max-total-reviews="
                f"{args.max_total_reviews} (most-recent-first)",
            )
    else:
        print(f"[3/6] Fetching reviews from DB")
        reviews = fetch_reviews(goods_no)
    if not reviews:
        print(f"  ⚠ No reviews in DB for {goods_no}. "
              f"{'Re-run without --skip-scrape.' if args.skip_scrape else 'Scraper completed but inserted 0 rows.'}",
              file=sys.stderr)
        sys.exit(3)
    print(f"  {len(reviews)} reviews available")

    product_name = args.product_name or derive_product_name(reviews, fallback=f"Product {goods_no}")
    print(f"  product_name = {product_name}")

    # ─── Initial collection_summary.json emit ─────────────────────────────
    # Two-phase commit: write a `analysis_status="pending"` sidecar
    # right after merge / DB fetch. If Stage 1/2/3 or aggregation
    # crashes, this pending sidecar survives — the operator can
    # re-run with `--skip-scrape` to retry analysis without losing
    # per-sort scrape provenance. The final update flips the status
    # to "completed" after the PDF + analysis_report.json land.
    cs_path: Path | None = None
    cs_initial: dict | None = None
    if args.emit_collection_summary_json or args.emit_analysis_report_json:
        from src.voc.app.collection_summary import (
            ANALYSIS_STATUS_PENDING as _CS_PENDING,
            build_collection_summary as _build_collection_summary,
            write_collection_summary as _write_collection_summary,
        )
        if args.emit_collection_summary_json:
            cs_path = Path(args.emit_collection_summary_json)
        else:
            cs_path = (
                Path(args.emit_analysis_report_json).parent
                / "collection_summary.json"
            )
        # Per-sort summaries: same shape derivation as before.
        per_sort_initial: list[dict] | None
        sorts_plan_initial: list[str] | None
        if args.skip_scrape:
            per_sort_initial = None
            sorts_plan_initial = None
        elif args.multi_sort and multi_sort_summaries is not None:
            per_sort_initial = list(multi_sort_summaries)
            sorts_plan_initial = list(_MULTI_SORT_TYPES_IN_PLAN)
        else:
            single_sort = args.sort_type or "PAGE_DEFAULT"
            try:
                single_prod = summary.get("products", [{}])[0]  # type: ignore[name-defined]
            except NameError:
                single_prod = {}
            per_sort_initial = [{
                "sort_type": single_sort,
                "status": single_prod.get("status"),
                "quality_status": single_prod.get("quality_status"),
                "rows_inserted": int(single_prod.get("rows_inserted") or 0),
                "raw_records_seen": int(
                    single_prod.get("raw_records_seen") or 0,
                ),
                "attempts": 1,
                "prod_summary": single_prod.get("summary"),
            }]
            sorts_plan_initial = [single_sort]
        if args.reuse_collection_summary:
            # Carry the prior retry-success state forward verbatim.
            # Skip the rebuild: build_collection_summary with empty
            # per-sort data would zero out sorts_succeeded /
            # partial_success / per_sort, which is exactly the state
            # the operator chose this flag to preserve.
            prior_cs = json.loads(
                Path(args.reuse_collection_summary).read_text(
                    encoding="utf-8",
                ),
            )
            if not isinstance(prior_cs, dict):
                print(
                    f"  ⚠ --reuse-collection-summary file is not a "
                    f"JSON object: {args.reuse_collection_summary}",
                    file=sys.stderr,
                )
                sys.exit(2)
            cs_initial = dict(prior_cs)
            # Flip status back to pending for this analysis pass; the
            # final two-phase commit at the end will set it to
            # completed and update review_count_analyzed + paths.
            cs_initial["analysis_status"] = _CS_PENDING
            # Refresh the analyzed-row pool count to match the actual
            # rows fetched from DB this run.
            cs_initial["review_count_available_after_merge"] = len(reviews)
            _write_collection_summary(cs_path, cs_initial)
            print(
                f"  collection_summary.json (reused; pending) → {cs_path} "
                f"(analysis_status=pending, "
                f"sorts_succeeded={cs_initial.get('sorts_succeeded')}, "
                f"partial_success={cs_initial.get('partial_success')})"
            )
        else:
            cs_initial = _build_collection_summary(
                product_url=args.url,
                goods_no=goods_no,
                product_name=product_name,
                corpus_mode=args.corpus_mode,
                primary_sort=(
                    "DATETIME_DESC" if args.multi_sort or not args.sort_type
                    else args.sort_type
                ),
                per_sort_summaries=per_sort_initial,
                sorts_attempted_plan=sorts_plan_initial,
                review_count_available_after_merge=len(reviews),
                review_count_analyzed=None,  # filled in at completion
                collection_started_at=collection_started_at,
                collection_completed_at=collection_completed_at,
                skipped_scrape=bool(args.skip_scrape),
                analysis_status=_CS_PENDING,
            )
            _write_collection_summary(cs_path, cs_initial)
            print(
                f"  collection_summary.json (pending) → {cs_path} "
                f"(analysis_status=pending, "
                f"sorts_succeeded={cs_initial['sorts_succeeded']}, "
                f"partial_success={cs_initial['partial_success']})"
            )

    # Step 5 — Pipeline
    print(f"[4/6] Running Stage 1 → Stage 2 → Stage 3 ({len(reviews)} reviews)")
    if args.stub_llm:
        print(f"  classifier = StubClassifier (deterministic; LOW QUALITY — for testing only)")
        classifier = StubClassifier()
    else:
        # Pipeline pins prompt_version to v2 explicitly so a future
        # default-flip in stage2.py doesn't silently change pipeline
        # behavior. v2 is the production default since 2026-05-01;
        # see docs/phase2e_stage2_improvement_plan.md.
        prompt_version = PROMPT_VERSION_V2_SKINCARE
        print(
            f"  classifier = OpenAIClassifier(model={args.llm_model}, "
            f"prompt_version={prompt_version})"
        )
        classifier = OpenAIClassifier(
            model=args.llm_model, cache_path=PIPELINE_CACHE,
            prompt_version=prompt_version,
        )

    pipeline_started = time.time()
    review_blocks = run_pipeline(reviews, classifier)
    pipeline_secs = time.time() - pipeline_started
    n_records_total = sum(len(rb["records"]) for rb in review_blocks)
    print(f"  pipeline complete in {pipeline_secs:.1f}s — {n_records_total} polarity records")

    # ─── Pipeline-start product metadata + image collection ──────────────
    # The product image is captured here (after we know goods_no +
    # product_name, before report build) so analysis_report.product
    # carries image_url / image_local_path / image_source. The cache
    # writes ONLY under <run>/assets/; failures are warnings, never
    # block the pipeline.
    #
    # Anti-bot priority (v2.4.3):
    #   1. Reuse the URL captured during the warm OY Playwright session
    #      (per-sort `prod_summary.product_image_url`). Source label:
    #      `oliveyoung_detail_page_playwright`. No extra HTTP fetch.
    #   2. Standalone HTTP detail-page fetch (extract_oy_product_image_url).
    #      Source label: `oliveyoung_detail_page_http`.
    #   3. Coupang CSV row column mapping. Source label: `coupang_csv`.
    #   4. Nothing — image stays None. Source label: `none`.
    product_metadata: dict | None = None
    if (
        not args.no_collect_product_image
        and args.emit_analysis_report_json
    ):
        try:
            from src.voc.app.product_metadata import collect_product_metadata

            run_dir_for_image = Path(args.emit_analysis_report_json).parent.parent

            # ── v2.4.4 — image-warm-scan: log every prod_summary's
            # capture diagnostic so the operator can see exactly where
            # the chain broke. Picks the first non-empty
            # product_image_url across sorts (image is product-level).
            warm_image_url: str | None = None
            warm_image_sort: str | None = None
            inspected_summaries: list[dict] = []
            if args.multi_sort and multi_sort_summaries:
                for s in multi_sort_summaries:
                    inspected_summaries.append({
                        "sort_type": s.get("sort_type"),
                        "prod_summary": s.get("prod_summary") or {},
                    })
            else:
                ps = locals().get("prod_summary") or {}
                if isinstance(ps, dict):
                    inspected_summaries.append({
                        "sort_type": args.sort_type or "PAGE_DEFAULT",
                        "prod_summary": ps,
                    })

            print(
                f"  image-warm-scan: inspected {len(inspected_summaries)} "
                f"prod_summaries"
            )
            # Track diagnostic context across the scan so the
            # failure_reason classifier (below) can pick the right
            # sentinel without re-reading the summaries.
            any_capture_attempted = False
            any_via_cdp = False
            any_session_open_called = False
            any_capture_hook_reached = False
            any_connector_received_cdp = False
            any_session_id_mismatch = False
            scan_diag: list[dict] = []
            for entry in inspected_summaries:
                sort = entry["sort_type"]
                ps = entry["prod_summary"] or {}
                cand_url = ps.get("product_image_url")
                cand_url_str = (
                    str(cand_url) if isinstance(cand_url, str) and cand_url.strip()
                    else None
                )
                attempted = bool(ps.get("product_image_capture_attempted"))
                open_called = bool(ps.get("product_image_session_open_called"))
                hook_reached = bool(ps.get("product_image_capture_hook_reached"))
                received_cdp = ps.get("connector_received_cdp_endpoint")
                ses_id = ps.get("product_image_session_id")
                diag_ses_id = ps.get("product_image_diagnostic_session_id")
                if attempted:
                    any_capture_attempted = True
                if open_called:
                    any_session_open_called = True
                if hook_reached:
                    any_capture_hook_reached = True
                if isinstance(received_cdp, str) and received_cdp.strip():
                    any_connector_received_cdp = True
                if ps.get("connected_via_cdp"):
                    any_via_cdp = True
                if (
                    ses_id is not None and diag_ses_id is not None
                    and ses_id != diag_ses_id
                ):
                    any_session_id_mismatch = True
                row = {
                    "sort": sort,
                    "attempted": attempted,
                    "session_open_called": open_called,
                    "capture_hook_reached": hook_reached,
                    "session_class": ps.get("product_image_session_class"),
                    "session_id": ses_id,
                    "diag_session_id": diag_ses_id,
                    "image_url": cand_url_str,
                    "selected_source": ps.get("product_image_capture_selected_source"),
                    "og": int(ps.get("product_image_capture_og_count") or 0),
                    "jsonld": int(ps.get("product_image_capture_jsonld_count") or 0),
                    "twitter": int(ps.get("product_image_capture_twitter_count") or 0),
                    "link_image_src": int(
                        ps.get("product_image_capture_link_image_src_count") or 0,
                    ),
                    "oy_thumbnail_img": int(
                        ps.get("product_image_capture_oy_thumbnail_img_count") or 0,
                    ),
                    "html_length": ps.get("product_image_capture_html_length"),
                    "page_url": ps.get("product_image_capture_page_url"),
                    "error": ps.get("product_image_capture_error"),
                    "connected_via_cdp": bool(ps.get("connected_via_cdp")),
                    "ua": ps.get("browser_user_agent"),
                    "requested_cdp_endpoint": ps.get("requested_cdp_endpoint"),
                    "connector_received_cdp_endpoint": received_cdp,
                    "session_received_cdp_endpoint": ps.get(
                        "product_image_session_received_cdp_endpoint",
                    ),
                }
                scan_diag.append(row)
                print(
                    f"    sort={row['sort']:<22} "
                    f"open_called={row['session_open_called']!s:<5} "
                    f"hook_reached={row['capture_hook_reached']!s:<5} "
                    f"attempted={row['attempted']!s:<5} "
                    f"og={row['og']} jsonld={row['jsonld']} "
                    f"twitter={row['twitter']} link={row['link_image_src']} "
                    f"oy_thumb={row['oy_thumbnail_img']} "
                    f"src={row['selected_source']} url={row['image_url']!r}"
                )
                print(
                    f"      cdp: connector={row['connector_received_cdp_endpoint']!r} "
                    f"session={row['session_received_cdp_endpoint']!r} "
                    f"connected_via_cdp={row['connected_via_cdp']!s:<5} "
                    f"session_class={row['session_class']!r} "
                    f"session_id={row['session_id']} diag_id={row['diag_session_id']}"
                )
                if cand_url_str and warm_image_url is None:
                    warm_image_url = cand_url_str
                    warm_image_sort = sort

            if warm_image_url:
                print(
                    f"  image-warm-scan: SELECTED warm_image_url from sort="
                    f"{warm_image_sort} → {warm_image_url[:80]}…"
                )
                product_metadata = collect_product_metadata(
                    product_url=args.url,
                    run_dir=run_dir_for_image,
                    goods_no=goods_no,
                    product_name_raw=product_name,
                    image_url_hint=warm_image_url,
                    image_source_hint="oliveyoung_detail_page_playwright",
                )
            else:
                # Classify why the warm scan didn't surface a URL —
                # used by the failure_reason classifier below.
                if not inspected_summaries:
                    print(
                        "  image-warm-scan: NO PROD_SUMMARIES — "
                        "warm capture not attempted (skip-scrape or empty)"
                    )
                elif any_capture_attempted:
                    print(
                        "  image-warm-scan: capture attempted but no markers "
                        "matched — falling back to standalone HTTP extractor"
                    )
                else:
                    print(
                        "  image-warm-scan: capture NOT attempted in any "
                        "prod_summary — propagation gap or non-Playwright session"
                    )

                product_metadata = collect_product_metadata(
                    product_url=args.url,
                    run_dir=run_dir_for_image,
                    goods_no=goods_no,
                    product_name_raw=product_name,
                )

            # v2.4.5 — refined failure_reason classifier with
            # propagation-layer sentinels. Each sentinel pinpoints a
            # specific layer in the chain so the operator can fix the
            # right thing without replaying the run.
            #
            # Sentinel ladder (most specific first):
            #   cdp_endpoint_not_forwarded
            #     manifest had a value but the connector's
            #     `requested_cdp_endpoint` is empty → batch defaults
            #     read failed OR _build_ingest_command dropped it.
            #   connector_did_not_receive_cdp_endpoint
            #     connector got the kwarg but session shows no
            #     received_cdp_endpoint → connector→session wiring gap.
            #   session_open_not_called
            #     connector ran but `_PlaywrightReviewSession.open()`
            #     never executed (early raise / different session).
            #   capture_hook_not_reached
            #     open() ran but the capture block was never entered
            #     (likely an exception between goto and the hook).
            #   session_id_mismatch
            #     diagnostic was read from a different session object
            #     than the one that ran open() — orchestration bug.
            #   capture_attempted_but_no_marker
            #     capture_hook reached, extractor returned None for
            #     all five fallback sources.
            #   capture_succeeded_but_not_propagated
            #     warm URL exists in prod_summary but the pipeline's
            #     hint loop missed it — local logic bug.
            #   http_403
            #     warm capture failed, standalone HTTP fallback got
            #     403 (anti-bot block on this orchestrator IP).
            #   cache_failed
            #     URL in hand but `fetch_and_cache_product_image`
            #     returned None (write failure / oversize / etc.).
            #   warm_capture_not_attempted
            #     no prod_summaries at all (skip-scrape).
            local_path = product_metadata.get("product_image_local_path")
            image_url = product_metadata.get("product_image_url")
            image_source = product_metadata.get("product_image_source")

            # Manifest-side audit: did the URL we passed into the pipeline
            # carry the cdp_endpoint we expected? Read from the first
            # prod_summary's `requested_cdp_endpoint` (all sorts share
            # the same manifest defaults block). v2.4.7 — also fall
            # back to the CLI-arg value when prod_summary is empty so
            # the audit field never reads null when the operator did
            # pass the flag (eliminates false `cdp_endpoint_not_forwarded`
            # readings caused by ProductResult.summary serialization gaps).
            manifest_cdp_for_log: str | None = None
            for r in scan_diag:
                if r.get("requested_cdp_endpoint"):
                    manifest_cdp_for_log = r["requested_cdp_endpoint"]
                    break
            if manifest_cdp_for_log is None:
                # The operator-supplied --cdp-endpoint always exists at
                # this layer (argparse default is the canonical OY URL).
                manifest_cdp_for_log = args.cdp_endpoint

            # v2.4.7 — detect the "ProductResult.summary serialization
            # dropped the v2.4.x fields" path: prod_summaries exist
            # but every one of them is empty / lacks the propagation
            # diagnostic fields the connector should have populated.
            prod_summary_diagnostic_fields_missing = False
            if inspected_summaries and not any_connector_received_cdp:
                # Check whether ANY prod_summary carried meaningful keys
                # beyond the legacy explicit fields. If every entry's
                # `prod_summary` dict is empty or lacks the new keys,
                # the propagation gap is the dataclass→batch_summary
                # serialization, NOT manifest forwarding.
                expected_keys = {
                    "requested_cdp_endpoint",
                    "connector_received_cdp_endpoint",
                    "product_image_capture_attempted",
                    "product_image_session_open_called",
                }
                any_expected_key_present = False
                for entry in inspected_summaries:
                    ps = entry.get("prod_summary") or {}
                    if expected_keys & set(ps.keys()):
                        any_expected_key_present = True
                        break
                if not any_expected_key_present:
                    prod_summary_diagnostic_fields_missing = True

            failure_reason: str | None = None
            if not local_path:
                if image_url and image_source != "none":
                    failure_reason = "cache_failed"
                elif not inspected_summaries:
                    failure_reason = "warm_capture_not_attempted"
                # v2.4.7 — distinguish "manifest didn't carry it" from
                # "ProductResult.summary serialization dropped the
                # v2.4.x diagnostic fields". The latter is the actual
                # bug v2.4.7 fixes; keeping the sentinel surfaces any
                # future regression at the same layer.
                elif prod_summary_diagnostic_fields_missing:
                    failure_reason = "prod_summary_diagnostic_fields_missing"
                # Propagation-layer sentinels — most specific first.
                elif (
                    inspected_summaries
                    and not any_connector_received_cdp
                ):
                    failure_reason = "cdp_endpoint_not_forwarded"
                elif (
                    any_connector_received_cdp
                    and not any(
                        r.get("session_received_cdp_endpoint")
                        for r in scan_diag
                    )
                ):
                    failure_reason = "connector_did_not_receive_cdp_endpoint"
                elif inspected_summaries and not any_session_open_called:
                    failure_reason = "session_open_not_called"
                elif any_session_open_called and not any_capture_hook_reached:
                    failure_reason = "capture_hook_not_reached"
                elif any_session_id_mismatch:
                    failure_reason = "session_id_mismatch"
                elif any_capture_hook_reached and not warm_image_url:
                    failure_reason = "capture_attempted_but_no_marker"
                elif warm_image_url and not image_url:
                    # Warm URL surfaced in scan but didn't reach product_metadata.
                    failure_reason = "capture_succeeded_but_not_propagated"
                # Legacy sentinels still recognized for compatibility.
                elif inspected_summaries and not any_capture_attempted:
                    failure_reason = "warm_capture_not_propagated"
                elif any_capture_attempted and not warm_image_url:
                    failure_reason = "warm_capture_no_image_marker"
                else:
                    failure_reason = "unknown"
            # Stamp the diagnostic + failure_reason onto the sidecar
            # so the operator-facing audit trail is complete.
            product_metadata["product_image_failure_reason"] = failure_reason
            product_metadata["image_warm_scan"] = {
                "inspected_count": len(inspected_summaries),
                "any_capture_attempted": any_capture_attempted,
                "any_via_cdp": any_via_cdp,
                "any_session_open_called": any_session_open_called,
                "any_capture_hook_reached": any_capture_hook_reached,
                "any_connector_received_cdp": any_connector_received_cdp,
                "any_session_id_mismatch": any_session_id_mismatch,
                # v2.4.7 — true when prod_summary is present but missing
                # the v2.4.x diagnostic field set (root cause = batch
                # summary serialization gap, not manifest forwarding).
                "prod_summary_diagnostic_fields_missing": (
                    prod_summary_diagnostic_fields_missing
                ),
                "manifest_cdp_endpoint": manifest_cdp_for_log,
                # The CLI-arg value the operator passed — useful for
                # cross-checking that propagation actually started.
                "pipeline_args_cdp_endpoint": args.cdp_endpoint,
                "selected_sort": warm_image_sort,
                "per_sort": scan_diag,
            }
            # Re-write the sidecar with the enriched fields (the
            # initial write inside collect_product_metadata happened
            # before failure_reason was known).
            try:
                shared_dir = run_dir_for_image / "shared"
                shared_dir.mkdir(parents=True, exist_ok=True)
                (shared_dir / "product_metadata.json").write_text(
                    json.dumps(product_metadata, ensure_ascii=False, indent=2),
                    encoding="utf-8",
                )
            except Exception as e:  # noqa: BLE001
                print(
                    f"  ⚠ product_metadata.json re-emit failed: {e!r}",
                    file=sys.stderr,
                )

            if local_path:
                print(
                    f"  product image cached → "
                    f"{run_dir_for_image}/{local_path} "
                    f"(source={image_source})"
                )
            elif image_url:
                print(
                    f"  product image URL found but cache failed: "
                    f"{image_url} (source={image_source}, "
                    f"failure_reason={failure_reason})"
                )
            else:
                print(
                    "  product image not found — analysis_report stays "
                    f"text-only (failure_reason={failure_reason})"
                )
        except Exception as e:  # noqa: BLE001 — never block pipeline
            print(
                f"  ⚠ product metadata collection raised: {e!r} — continuing",
                file=sys.stderr,
            )
            product_metadata = None

    # Step 6 — Aggregate + render PDF
    print(f"[5/6] Aggregating per-product summary")
    data = aggregate_product(
        product_id=goods_no,
        product_name=product_name,
        reviews=review_blocks,
    )
    # Thread image fields onto ProductReportData so the adapter sees
    # them (it reads via `getattr(data, "product_image_*", None)`).
    if isinstance(product_metadata, dict):
        data.product_image_url = product_metadata.get("product_image_url")
        data.product_image_local_path = product_metadata.get("product_image_local_path")
        data.product_image_source = product_metadata.get("product_image_source")

    # Optional: emit v3.0 analysis_report.json for the content engine.
    # This is a pure read-over `data`; analysis logic is untouched.
    if args.emit_analysis_report_json:
        ar_source_url = (
            args.analysis_report_source_url
            or args.url
        )
        ar_slug = args.analysis_report_product_slug or _content_slugify(
            product_name, source_url=ar_source_url,
        )
        # Sampling strategy is now corpus-mode aware:
        #   observable_multi_sort  → "observable_multi_sort_corpus" (merged)
        #   primary_only + multi   → "latest_plus_signal" (legacy: signal as evidence)
        #   single sort / default  → "latest_only"
        if args.corpus_mode == "observable_multi_sort":
            ar_strategy = "observable_multi_sort_corpus"
        elif args.multi_sort:
            ar_strategy = "latest_plus_signal"
        else:
            ar_strategy = "latest_only"
        # Derive breadcrumb / category from raw_metadata. Best-effort:
        # legacy rows without breadcrumb stamping yield None, in which
        # case the profile selector falls back to "default" (no
        # attribute suppression). NEVER raises — breadcrumb is
        # informational metadata, not a precondition.
        breadcrumb = derive_breadcrumb(reviews)
        category_path = breadcrumb["path"] if breadcrumb else None
        category_leaf = breadcrumb["leaf_ko"] if breadcrumb else None
        # Render the user-facing category string per --category-mode.
        # Defaults to leaf so analysis_report.product.category stays
        # short for downstream UX / filtering. The full path is
        # always available under raw_metadata.oy_category_path for
        # operators that need the deeper hierarchy.
        if breadcrumb and args.category_mode == "full_path":
            category_for_report: str | None = " > ".join(category_path or [])
        else:
            category_for_report = category_leaf
        profile_id = _select_profile_id(
            category_path=category_path,
            product_name=product_name,
        )
        suppress_set = _suppressed_attributes_for(profile_id)
        if breadcrumb:
            print(
                f"  category: {breadcrumb['ko']!r} (source={breadcrumb['source']}) "
                f"→ profile={profile_id} mode={args.category_mode} "
                f"out={category_for_report!r}"
            )
            if suppress_set:
                print(
                    f"  suppressing attributes for {profile_id}: "
                    f"{sorted(suppress_set)}"
                )
        else:
            print(
                "  category: (no breadcrumb in raw_metadata) "
                f"→ profile={profile_id}"
            )
        # Per-sort outcome plumbing → confidence_axes. When the
        # pipeline ran with --emit-collection-summary-json (the
        # standard run_all path), the sidecar dict carries
        # sorts_attempted / sorts_succeeded / sorts_failed /
        # partial_success — feed them into the adapter so the
        # four-axis breakdown reflects RATING_ASC failures etc.
        _cs = cs_initial if cs_initial is not None else {}
        analysis_report_dict = productreportdata_to_analysis_report(
            data,
            source_url=ar_source_url,
            primary_sort=("DATETIME_DESC" if args.multi_sort or not args.sort_type else args.sort_type),
            sampling_strategy=ar_strategy,
            corpus_type="observed_scrape",
            product_slug=ar_slug,
            product_category=category_for_report,
            suppress_attributes=suppress_set,
            selected_profile_id=profile_id,
            sorts_attempted=_cs.get("sorts_attempted"),
            sorts_succeeded=_cs.get("sorts_succeeded"),
            sorts_failed=_cs.get("sorts_failed"),
            partial_success=_cs.get("partial_success"),
        )
        ar_path = Path(args.emit_analysis_report_json)
        ar_path.parent.mkdir(parents=True, exist_ok=True)
        ar_path.write_text(
            json.dumps(analysis_report_dict, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        print(f"  analysis_report.json → {ar_path}")


    if args.out_pdf:
        out_path = Path(args.out_pdf)
    else:
        out_path = OUT_DIR / f"phase2e_report_{goods_no}_pipeline_v2.pdf"
    out_path.parent.mkdir(parents=True, exist_ok=True)

    print(f"[6/6] Rendering PDF → {out_path}")
    # Build review_dates so the v2 PDF renders §7 (time-series trend)
    review_dates = {r["review_id"]: r.get("review_date") for r in reviews}
    # Build corpus metadata for the "분석 범위" disclosure box + methodology phrasing
    collected = len(reviews)
    # Sort-mode metadata for the PDF "분석 범위" disclosure box. Three
    # mutually exclusive cases:
    #   - multi_sort=True  → "다중 정렬 머지" + plan list
    #   - sort_type set    → single-sort label
    #   - else (legacy)    → None (renderer falls back to silent default)
    sort_mode: str
    sort_types_included: list[str] | None
    if args.multi_sort:
        sort_mode = "multi"
        sort_types_included = list(_MULTI_SORT_TYPES_IN_PLAN)
    elif args.sort_type is not None:
        sort_mode = "single"
        sort_types_included = [args.sort_type]
    else:
        sort_mode = "default"
        sort_types_included = None

    # Total review count surfaced by the connector (DOM badge or API
    # response). Best-effort metadata; None when the connector did not
    # capture a value OR when --skip-scrape bypassed the scraper this
    # run. The contract is "do not fake it" — we only record what the
    # scraper actually observed in this exact run.
    #
    # Multi-sort mode picks the value from the PRIMARY sort's batch
    # summary (DATETIME_DESC); signal-sort batches are evidence pools,
    # not corpus authorities, so even if they happened to capture a
    # total we don't propagate it from there.
    total_review_count_available: int | None = None
    if not args.skip_scrape:
        if args.multi_sort:
            for s in multi_sort_summaries:
                if s.get("sort_type") != PRIMARY_CORPUS_SORT_TYPE:
                    continue
                inner = s.get("summary") or {}
                products = inner.get("products") or []
                if products and isinstance(products[0], dict):
                    cand = products[0].get("total_review_count_available")
                    if isinstance(cand, int) and cand > 0:
                        total_review_count_available = cand
                break
        else:
            cand = prod_summary.get("total_review_count_available")
            if isinstance(cand, int) and cand > 0:
                total_review_count_available = cand

    corpus_metadata = {
        "scrape_skipped": args.skip_scrape,
        "collection_started_at": collection_started_at,
        "collection_completed_at": collection_completed_at,
        "max_reviews_arg": args.max_reviews,
        "max_reviews_effective": effective_max if finite_limit_set else None,
        "finite_limit_set": finite_limit_set,
        "collected_review_count": collected,
        "processed_review_count": len(reviews),
        "polarity_record_count": n_records_total,
        "corpus_limited": (finite_limit_set
                            and not args.skip_scrape
                            and not args.multi_sort
                            and collected >= effective_max),
        "model_name": "stub (heuristic)" if args.stub_llm else args.llm_model,
        # Sort-aware crawl metadata. The PDF renderer chooses the right
        # 정렬 기준 row based on these fields.
        "sort_mode": sort_mode,
        "sort_types_included": sort_types_included,
        "multi_sort_plan": (
            [
                {
                    "sort_type": e["sort_type"],
                    "role": e["role"],
                    "max_reviews_arg": str(e["cap"]),
                }
                for e in MULTI_SORT_PLAN
            ]
            if args.multi_sort else None
        ),
        # Primary/signal split fields. Present only in multi-sort mode.
        # The PDF renderer uses these to write the dual "주 코퍼스 정렬"
        # + "신호 정렬" rows in the 분석 범위 box and to clarify in the
        # methodology paragraph that signal sorts are NOT a corpus basis.
        "primary_corpus_sort_type": (
            PRIMARY_CORPUS_SORT_TYPE if args.multi_sort else None
        ),
        "signal_sort_types": (
            list(SIGNAL_SORT_TYPES) if args.multi_sort else None
        ),
        "signal_sort_cap": (
            SIGNAL_SORT_DEFAULT_CAP if args.multi_sort else None
        ),
        # Coverage signal — picked up by CorpusProvenance below to
        # compute coverage_ratio and confidence_level.
        "total_review_count_available": total_review_count_available,
    }
    # Per-sort outcome plumbing for the PDF "분석 범위" disclosure.
    # The collection_summary sidecar already classifies each attempted
    # sort as succeeded / failed / blocked using `_is_success_entry`
    # and friends. Surface those classifications so the PDF can render
    # "수집 성공한 정렬" vs "수집 실패한 정렬" instead of implying
    # every attempted sort contributed evidence. None entries fall
    # through silently when the cs_initial sidecar wasn't built.
    if cs_initial is not None:
        corpus_metadata["sorts_attempted"] = list(
            cs_initial.get("sorts_attempted") or []
        )
        corpus_metadata["sorts_succeeded"] = list(
            cs_initial.get("sorts_succeeded") or []
        )
        corpus_metadata["sorts_failed"] = list(
            cs_initial.get("sorts_failed") or []
        )
        corpus_metadata["sorts_blocked_or_anti_bot"] = list(
            cs_initial.get("sorts_blocked_or_anti_bot") or []
        )
        corpus_metadata["partial_success"] = bool(
            cs_initial.get("partial_success")
        )
    # Cross-snapshot trend comparison.
    #
    # Sampling-bias safeguard (per .claude/skills/phase2e_pipeline_change_
    # discipline.md and the locked invariant in snapshots.py):
    #   - The snapshot's corpus is filtered to DATETIME_DESC primary rows
    #     ONLY via aggregate_primary_only (defense-in-depth on top of
    #     fetch_reviews's SQL-level filter).
    #   - CorpusProvenance is attached so compare_snapshots can refuse
    #     to compare across mismatched sort/cap.
    #   - In multi-sort mode the primary sort is DATETIME_DESC and cap
    #     is "all" (the multi-sort plan); in single-sort mode we record
    #     the user's chosen sort + cap; in default/legacy mode the
    #     sort is unknown and the snapshot module will refuse to compute
    #     deltas (status="non_primary_sort"). The snapshot is still
    #     saved so future runs have history once provenance lines up.
    #
    # Order: load previous BEFORE saving current; save AFTER comparison.
    #
    # --skip-scrape edge case: collection_completed_at is None when no
    # fresh scrape ran this invocation. The snapshot still needs a
    # collected_at timestamp for filename ordering + provenance, so
    # fall back to the current UTC wall-clock time. We do NOT
    # fabricate corpus_metadata.collection_completed_at — that
    # field stays None to honor the "do not fake scrape metadata"
    # contract; only the snapshot's own as-of timestamp is filled in.
    if collection_completed_at is None:
        snapshot_collected_at = datetime.now(timezone.utc)
    else:
        snapshot_collected_at = datetime.fromisoformat(collection_completed_at)
    if args.corpus_mode == "observable_multi_sort":
        # Merged-across-sorts corpus. The snapshot records this as a
        # distinct strategy so compare_snapshots refuses to compare
        # across mode boundaries (incomparable_strategy).
        snapshot_primary_sort = SNAPSHOT_PRIMARY_SORT_TYPE
        snapshot_cap_policy = "all"
        snapshot_strategy = "observable_multi_sort_corpus"
    elif args.multi_sort:
        snapshot_primary_sort = SNAPSHOT_PRIMARY_SORT_TYPE
        snapshot_cap_policy = "all"
        snapshot_strategy = "latest_plus_signal"
    elif args.sort_type is not None:
        snapshot_primary_sort = args.sort_type
        snapshot_cap_policy = str(args.max_reviews)
        # Single-sort mode collects ONE sort axis with no signal probes —
        # latest_only by definition (regardless of which sort axis).
        snapshot_strategy = "latest_only"
    else:
        # Default mode — page-default sort. Conservative: record an
        # explicit sentinel so compare_snapshots refuses to surface
        # trend numbers from a biased corpus.
        snapshot_primary_sort = "PAGE_DEFAULT"
        snapshot_cap_policy = str(args.max_reviews)
        snapshot_strategy = "latest_only"

    snapshot_data = aggregate_primary_only(
        raw_reviews=reviews,
        review_blocks=review_blocks,
        product_id=goods_no,
        product_name=product_name,
    )
    primary_review_count = snapshot_data.n_reviews
    # total_review_count_available is reserved for a future
    # connector-level capture; pipeline currently has no signal for it.
    total_available = corpus_metadata.get("total_review_count_available")
    provenance = CorpusProvenance(
        # Runner produces observed scrapes only; partner ingest will
        # land via a separate endpoint that constructs its own
        # provenance with corpus_type=partner_*.
        corpus_type="observed_scrape",
        sampling_strategy=snapshot_strategy,
        primary_sort_type=snapshot_primary_sort,
        cap_policy=snapshot_cap_policy,
        collected_primary_review_count=primary_review_count,
        total_review_count_available=total_available,
        coverage_ratio=compute_coverage_ratio(
            primary_review_count, total_available,
        ),
        is_full_corpus=False,
    )
    current_snapshot = build_snapshot(
        snapshot_data,
        collected_at=snapshot_collected_at,
        provenance=provenance,
    )
    previous_snapshot = load_previous_snapshot(
        goods_no, current_snapshot.collected_at, SNAPSHOTS_ROOT,
    )
    snapshot_comparison = compare_snapshots(
        current_snapshot, previous_snapshot,
    )
    saved_snapshot_path = save_snapshot(current_snapshot, SNAPSHOTS_ROOT)
    print(
        f"  [snapshot] saved → {saved_snapshot_path.relative_to(REPO)} "
        f"(primary_sort={provenance.primary_sort_type}, "
        f"strategy={provenance.sampling_strategy}, "
        f"cap={provenance.cap_policy}, "
        f"n_primary={primary_review_count}, "
        f"confidence={provenance.confidence_level})"
    )
    if previous_snapshot is None:
        print("  [snapshot] previous: none (first compatible run)")
    else:
        print(
            f"  [snapshot] previous: {previous_snapshot.collected_at} "
            f"(status={snapshot_comparison.comparability_status})"
        )

    # ---- Seller-PDF: apply analysis_report-side filters -----------
    # The PDF renderer consumes `data` (ProductReportData), not the
    # analysis_report dict directly. Apply three editorial-layer
    # adjustments here so the renderer doesn't have to know about
    # profile-aware semantics:
    #
    # 1. Suppressed attributes — drop from data.attribute_summaries
    #    so makeup-coded keys (pigmentation, color_tone_matching, …)
    #    cannot leak into a skincare_pad PDF.
    #
    # 2. Profile-aware display labels — temporarily extend
    #    ATTRIBUTE_LABELS_KO with the skincare_pad / makeup_blush
    #    overrides the adapter wrote into analysis_report.attributes.
    #    Restored in the finally block so the mutation is scoped to
    #    this render call.
    #
    # 3. Interview hooks — pass through as a new kwarg so the
    #    monitoring section consumes them in place of the legacy
    #    "왜 중요한가 / 내부 확인 질문" template.
    interview_hooks: dict[str, str] = {}
    label_override_applied: dict[str, str] = {}
    original_labels_snapshot: dict[str, str] = {}
    # `analysis_report_dict` is built earlier inside the
    # `--emit-analysis-report-json` branch. Only access it when
    # that branch ran.
    if args.emit_analysis_report_json:
        ar_dict = analysis_report_dict
        if isinstance(ar_dict, dict):
            suppressed_attrs = set(
                (ar_dict.get("product") or {}).get("suppressed_attributes")
                or [],
            )
            if suppressed_attrs and data.attribute_summaries:
                data.attribute_summaries = {
                    k: v for k, v in data.attribute_summaries.items()
                    if k not in suppressed_attrs
                       and (v.attribute or k) not in suppressed_attrs
                }
            # Also filter `data.tradeoff_pairs` — keys are
            # `attr_a:pol -> attr_b:pol`; any pair touching a
            # suppressed key drops out so suppressed labels don't
            # leak into the §9 tradeoff appendix.
            if suppressed_attrs and getattr(data, "tradeoff_pairs", None):
                from collections import Counter as _Counter
                kept = _Counter()
                import re as _re
                _pair_re = _re.compile(
                    r"^([a-z_]+):[a-z_]+\s*->\s*([a-z_]+):[a-z_]+$"
                )
                for pair, n in data.tradeoff_pairs.items():
                    m = _pair_re.match(pair or "")
                    if not m:
                        kept[pair] = n
                        continue
                    if m.group(1) in suppressed_attrs or m.group(2) in suppressed_attrs:
                        continue
                    kept[pair] = n
                data.tradeoff_pairs = kept
            # Filter `review_blocks` records — the usage_patterns
            # detector reads them for context bucketing. Without
            # this filter, suppressed-attribute labels surface in
            # §6 even though §3/§5 are clean.
            if suppressed_attrs and review_blocks:
                for rb in review_blocks:
                    recs = rb.get("records") or []
                    rb["records"] = [
                        r for r in recs
                        if r.get("attribute") not in suppressed_attrs
                    ]
            # Coverage count: prefer `n_reviews_analyzed` from the
            # analysis_report (the actual analyzed corpus, 2029)
            # over the snapshot's per-sort primary_review_count
            # (494) which reflects only the latest-only sub-corpus.
            try:
                n_analyzed = int(
                    (ar_dict.get("corpus") or {}).get("n_reviews_analyzed") or 0,
                )
                if n_analyzed > 0 and n_analyzed != primary_review_count:
                    # CorpusProvenance is frozen; replace() rebuilds.
                    from dataclasses import replace as _dc_replace
                    new_coverage = (
                        compute_coverage_ratio(n_analyzed, total_available)
                        if total_available
                        else provenance.coverage_ratio
                    )
                    provenance = _dc_replace(
                        provenance,
                        collected_primary_review_count=n_analyzed,
                        coverage_ratio=new_coverage,
                    )
            except (AttributeError, TypeError, ValueError):
                pass
            # Build profile-aware label overrides from the report.
            from src.voc.reporting.phase2e.report import (
                ATTRIBUTE_LABELS_KO as _LABELS_KO,
            )
            original_labels_snapshot = dict(_LABELS_KO)
            for a in (ar_dict.get("attributes") or []):
                key = a.get("key")
                lbl = a.get("label_ko")
                if key and isinstance(lbl, str) and lbl.strip():
                    if _LABELS_KO.get(key) != lbl:
                        label_override_applied[key] = lbl
                        _LABELS_KO[key] = lbl
            # Interview hooks: monitoring_candidates[].interview_hook_ko.
            for m in (ar_dict.get("monitoring_candidates") or []):
                key = m.get("attribute_key")
                hook = m.get("interview_hook_ko")
                if key and isinstance(hook, str) and hook.strip():
                    interview_hooks[key] = hook.strip()
    # Confidence wording lock — analysis_report.corpus.confidence_level
    # is the single source of truth for downstream surfaces (CLAUDE.md
    # §4 — analysis_report is the contract). Provenance has its own
    # rubric (snapshots.compute_confidence_level) that can disagree
    # with the adapter's size-based rubric — e.g. for n=200 with
    # unknown total, provenance says "medium" while the adapter says
    # "low". When the adapter has produced a verdict, prefer it so the
    # PDF's "신뢰도" chip and the analysis_report don't contradict.
    pdf_confidence_level = provenance.confidence_level
    pdf_signal_stability = provenance.signal_stability
    if args.emit_analysis_report_json:
        try:
            ar_corpus = (analysis_report_dict or {}).get("corpus") or {}
            ar_conf = ar_corpus.get("confidence_level")
            if ar_conf in ("high", "medium", "low"):
                pdf_confidence_level = ar_conf
            ar_stab = ar_corpus.get("signal_stability")
            if ar_stab in ("high", "medium", "low"):
                pdf_signal_stability = ar_stab
        except (AttributeError, TypeError):
            pass
    try:
        # Pass-13: pipeline now uses the SAME renderer the republish
        # path uses (`render_seller_business_report_v3`). Previously
        # pipeline emitted a v2 PDF and republish overwrote it with a
        # different v3 layout — operators ended up shipping the v3
        # while every test / pass-12 wording fix targeted v2. Unifying
        # on v3 makes the pipeline's PDF byte-for-byte equivalent to
        # the republish PDF (modulo timestamp), so what tests verify
        # is what ships.
        v3_collection_summary = dict(cs_initial or {})
        # The two-phase commit hasn't run yet, so review_count_analyzed
        # is still null in cs_initial. Inject the analyzed count so
        # the appendix prints the correct "처리 리뷰 수" value.
        v3_collection_summary["review_count_analyzed"] = len(reviews)
        if analysis_report_dict is not None:
            pdf_v2.render_seller_business_report_v3(
                analysis_report=analysis_report_dict,
                collection_summary=v3_collection_summary,
                out_path=out_path,
                run_id=Path(out_path).parent.parent.name,
                generated_at=datetime.now(timezone.utc).strftime(
                    "%Y-%m-%dT%H:%M:%SZ",
                ),
            )
        else:
            # Fallback: legacy pipeline invocations that don't emit
            # analysis_report still get the v2 layout.
            pdf_v2.render_pdf_v2(
                data, out_path,
                source_label=f"Phase 2E pipeline run on {goods_no}",
                reviews=review_blocks,
                review_dates=review_dates,
                corpus_metadata=corpus_metadata,
                snapshot_comparison=snapshot_comparison,
                current_snapshot_confidence=pdf_confidence_level,
                current_snapshot_provenance=provenance,
                current_snapshot_signal_stability=pdf_signal_stability,
                interview_hooks=interview_hooks,
            )
    finally:
        # Restore the global label dict so subsequent runs in the
        # same process (tests, batch jobs) start from a clean state.
        if original_labels_snapshot:
            from src.voc.reporting.phase2e.report import (
                ATTRIBUTE_LABELS_KO as _LABELS_KO,
            )
            _LABELS_KO.clear()
            _LABELS_KO.update(original_labels_snapshot)

    elapsed = time.time() - started
    size_kb = out_path.stat().st_size / 1024

    # ─── Final collection_summary.json update ─────────────────────────
    # Phase 2 of the two-phase commit. We reach this point only when
    # Stage 1/2/3 + aggregation + analysis_report emit + PDF render
    # all succeeded. The pending sidecar written earlier is now flipped
    # to `analysis_status="completed"` with the analyzed-row count and
    # the artifact paths.
    #
    # If anything between the initial write and this point raised, the
    # pending sidecar survives unchanged — that's the failure mode this
    # lifecycle is designed to handle (operator can re-run with
    # --skip-scrape to retry analysis without losing scrape provenance).
    if cs_path is not None and cs_path.is_file():
        from src.voc.app.collection_summary import (
            ANALYSIS_STATUS_COMPLETED as _CS_COMPLETED,
            update_collection_summary as _update_collection_summary,
        )
        _update_collection_summary(
            cs_path,
            analysis_status=_CS_COMPLETED,
            review_count_analyzed=len(reviews),
            analysis_report_path=(
                str(args.emit_analysis_report_json)
                if args.emit_analysis_report_json else None
            ),
            seller_pdf_path=str(out_path) if out_path.is_file() else None,
            completed_at=datetime.now(timezone.utc).strftime(
                "%Y-%m-%dT%H:%M:%SZ",
            ),
        )
        print(f"  collection_summary.json (completed) → {cs_path}")

    print()
    print("=" * 70)
    print(f"✓ Pipeline complete in {elapsed:.1f}s")
    print(f"  product:     {product_name}")
    print(f"  goodsNo:     {goods_no}")
    print(f"  reviews:     {len(reviews)}")
    print(f"  records:     {n_records_total}")
    print(f"  PDF:         {out_path} ({size_kb:.1f} KB)")
    print("=" * 70)


if __name__ == "__main__":
    main()
