"""OliveYoung multi-product batch runner.

Sequentially runs N OliveYoung products through the existing authenticated
CDP collection path (`scripts/ingest_oliveyoung_browser_phase1.py`),
classifies per-product results, halts the batch on auth/anti-bot failures,
and emits a per-batch report (JSON + Markdown).

This is a thin orchestrator. **It does NOT modify the underlying connector,
pipeline, or detection code.** Per-product execution shells out to the
existing CLI; the runner reads the CLI's stdout JSON, derives status from
the standard `ConnectorRunSummary` shape, and writes the report.

Boundary discipline (matches the operations note):
  - Canonical v1.14 baseline scope is preserved (this runner targets only
    products NOT in `scripts/eval_phase1_baseline.sh`'s 8-product list, by
    operator convention).
  - `phase1_reviews` rows accumulate from the underlying ingest; this
    module never inserts to DB itself.
  - All artifacts (per-product trace + partial JSONLs, batch reports) live
    under `data/collection_artifacts/<batch_id>/...` — outside `/tmp/`
    where artifacts are volatile.

Test surface:
  - `classify_status(summary_dict) -> str` is pure; tested with synthetic
    summaries for every status in §C below.
  - `_run_one_product` accepts an injectable `runner_fn` so tests can
    bypass real subprocess invocation.
"""

from __future__ import annotations

import json
import logging
import random
import subprocess
import sys
import time
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Any, Callable, Iterable

logger = logging.getLogger(__name__)

REPO_ROOT = Path(__file__).resolve().parent.parent.parent.parent
DEFAULT_ARTIFACT_ROOT = REPO_ROOT / "data" / "collection_artifacts"


# ---------------------------------------------------------------------------
# Status taxonomy (ordered by priority — most-specific first)
# ---------------------------------------------------------------------------

# Halt-causing statuses. When any of these fires, the batch should stop
# immediately and the operator should re-establish auth (or wait out the
# anti-bot escalation) before resuming.
HALT_STATUSES: frozenset[str] = frozenset({
    "anti_bot",
    "anonymous_auth_wall",
    "auth_expired_mid_batch",
})

# All possible statuses the classifier can return.
ALL_STATUSES: frozenset[str] = frozenset({
    "anti_bot",
    "anonymous_auth_wall",
    "auth_expired_mid_batch",
    "blocked_or_empty_state",
    # Added 2026-05-07 — `_click_sort_button_robust` exhausted its
    # hunt deadline without finding the target sort-tab label, even
    # after the widening probe (scroll-into-view + scope-limited
    # disclosure-affordance click). Distinct from
    # `blocked_or_empty_state` (anti-bot soft block) — this is a
    # UI-shape signal that OY moved or hid the rating tabs. The batch
    # runner should NOT halt and the operator should NOT re-login;
    # the recovery is connector-side selector / probe maintenance.
    "sort_control_unreachable",
    "partial_artifact_only",
    "parser_error",
    "unknown_failure",
    # Added 2026-05-01 — review meta APIs (stats / options / photo
    # / goods-extra) fired and the page DOM shows a review count,
    # but the main review list/cursor API never fired. This is NOT
    # anti-bot, NOT a profile/session failure, NOT a login wall. The
    # trigger gesture (tab click + scroll + 리뷰 더보기) didn't wake
    # the lazy-load. The orchestrator should NOT halt the batch and
    # should NOT reset the profile.
    "review_list_api_not_seen_but_review_meta_seen",
    # Added 2026-05-01 — Playwright `connect_over_cdp` raised before
    # any body was parsed (typically the Chrome 147 / Playwright 1.58
    # `Browser.setDownloadBehavior` wall — see
    # docs/oy_cdp_attach_compatibility.md). Distinct from
    # `unknown_failure` so the batch summary surfaces the cause
    # without operator detective work.
    "cdp_attach_failed",
    # Added 2026-05-01 — `page.goto` raised after CDP attach succeeded.
    # Distinct from cdp_attach_failed so the operator looks at network
    # / DNS / URL, not the browser session.
    "page_open_failed",
    # Added 2026-05-01 — neither meta nor list review APIs fired even
    # though the page opened. Different from
    # `review_list_api_not_seen_but_review_meta_seen` (where meta
    # fired): nothing fired at all. Implies the trigger cascade
    # (tab click + scroll + 더보기) never woke any review-related
    # endpoint.
    "review_api_not_seen",
    # Added 2026-05-01 — the cursor list API fired and contained
    # review content, but the connector kept zero rows because all
    # were filtered out by goods_no (typical for 기획-set products
    # whose cursor response interleaves sibling sub-product reviews)
    # or unparseable. The fix is per-product targeting, not session /
    # profile / anti-bot work.
    "review_list_api_seen_but_no_rows_kept",
    "complete",
    "max_cap_reached",
    "duplicate_only",
    "authenticated_ok",
})


def classify_status(summary: dict[str, Any]) -> str:
    """Map a ConnectorRunSummary dict to one of the taxonomy statuses.

    Priority order (most-severe / most-specific first):
      1. cdp_attach_failed     — Playwright `connect_over_cdp` raised
      2. page_open_failed      — `page.goto` raised after attach succeeded
      3. anti_bot              — blocked / 403 / 429 observed
      4. anonymous_auth_wall   — auth_error fired AND login was logged_out (or unknown)
      5. auth_expired_mid_batch — auth_error fired AND login was logged_in
      6. partial_artifact_only — invalid run with parsed rows on disk
      7. parser_error          — invalid run primarily caused by parse warnings
      8. review_list_api_seen_but_no_rows_kept — list API fired with content,
                                                  filter dropped all rows
      9. review_list_api_not_seen_but_review_meta_seen — meta-yes / list-no
      10. review_api_not_seen   — neither API fired despite trigger cascade
      11. unknown_failure       — invalid run with no specific tag
      12. complete              — pagination_exhausted=True (full history)
      13. max_cap_reached       — last_observed_has_next=True (more available)
      14. duplicate_only        — successful run with 0 inserts (all deduped)
      15. authenticated_ok      — fallback success
    """
    # Earliest, most-specific failures first. These short-circuit before
    # the legacy blocked/auth_error checks so a CDP attach wall doesn't
    # masquerade as anti-bot just because both leave the connector with
    # zero rows.
    if bool(summary.get("cdp_attach_failed")):
        return "cdp_attach_failed"
    if bool(summary.get("page_open_failed")):
        return "page_open_failed"
    # 2026-05-01 fallback: defensive scan of `sample_dropped_reasons`
    # for the canonical CDP-wall markers. Catches the case where a
    # legacy summary (or a connector that bypassed Phase1Pipeline._error_summary)
    # carries the error string only in the dropped-reasons list. The
    # explicit flags above are the preferred path; this branch keeps
    # us from regressing to `unknown_failure` if upstream forgets one.
    sample_reasons = summary.get("sample_dropped_reasons") or []
    if isinstance(sample_reasons, list) and sample_reasons:
        joined = " ".join(str(r) for r in sample_reasons)
        cdp_markers = (
            "setDownloadBehavior",
            "Browser context management is not supported",
            "connect_over_cdp",
        )
        if any(m in joined for m in cdp_markers):
            return "cdp_attach_failed"
    blocked = bool(summary.get("blocked"))
    http_403 = bool(summary.get("http_403_seen"))
    http_429 = bool(summary.get("http_429_seen"))
    # Sort-control-unreachable comes BEFORE the generic false-empty /
    # anti-bot checks. The connector sets this flag only when its
    # widened sort-row probe (scroll-into-view + scope-limited
    # disclosure-affordance click) failed to surface the requested
    # rating tab AND the deadline poll never matched. The page's
    # cursor API then naturally times out (because the connector's
    # `_expected_sort_type` filter rejects default-sort responses),
    # which in turn trips the false-empty marker — so without this
    # branch the run would masquerade as `blocked_or_empty_state`
    # (an anti-bot signal) when the actual cause is OY's UI moving
    # the tabs out of inline view. A real HTTP block (403/429) still
    # wins; that strictly indicates the connector reached the API.
    sort_unreachable = bool(summary.get("sort_control_unreachable"))
    if sort_unreachable and not http_403 and not http_429:
        return "sort_control_unreachable"
    # False-empty review-state must classify BEFORE generic anti_bot,
    # because the connector sets `blocked=True` when its false-empty
    # retry budget is exhausted. Without this branch, all false-empty
    # exhaustions would masquerade as anti_bot, halt the batch, and
    # block the multi-sort runner from retrying. We only branch here
    # when there are no real anti-bot signals (HTTP 403/429); a
    # genuine HTTP block always wins (operator must back off).
    false_empty_detected = bool(summary.get("false_empty_state_detected"))
    if false_empty_detected and not http_403 and not http_429:
        return "blocked_or_empty_state"
    if blocked or http_403 or http_429:
        return "anti_bot"

    auth_error = bool(summary.get("auth_error"))
    mid_stream = bool(summary.get("mid_stream_auth_break"))
    login_state = summary.get("login_state_observed")

    if auth_error:
        # When mid_stream_auth_break is True, the auth wall fired during
        # pagination (the canonical case). When it's False, auth fired on
        # cold-start (rarer; same operational treatment — re-login).
        if mid_stream and login_state == "logged_in":
            return "auth_expired_mid_batch"
        return "anonymous_auth_wall"

    quality_status = summary.get("quality_status")

    # Non-halt invalid states
    if quality_status == "invalid":
        if summary.get("partial_debug_artifact_path"):
            return "partial_artifact_only"
        if int(summary.get("parse_warnings") or 0) > 0:
            return "parser_error"
        # Reclassify "no rows but the page knew there were reviews"
        # as the more specific status. Signals required:
        #   - review_api_response_count == 0 (the cursor API never fired)
        #   - the connector's lazy-load cascade actually ran
        #     (scrolled_to_review_area OR review_more_button_clicked)
        #   - total_review_count_available > 0 (the page DOM badge
        #     surfaced a count, so review META endpoints fired)
        # All three together pinpoint the meta-yes / list-no condition.
        # Falls through to `unknown_failure` only when at least one of
        # these signals is missing.
        review_api_count = int(summary.get("review_api_response_count") or 0)
        cascade_ran = bool(
            summary.get("scrolled_to_review_area")
            or summary.get("review_more_button_clicked"),
        )
        meta_seen = (
            int(summary.get("total_review_count_available") or 0) > 0
        )
        # 2026-05-01 — list API fired with real review content but the
        # connector kept 0 rows. Typical for 기획-set products whose
        # cursor responses interleave sibling sub-product reviews that
        # the goods-filter (correctly) drops. Signals:
        #   - review_api_response_count > 0 (at least one cursor call)
        #   - records_parsed == 0 (post-filter rows kept)
        #   - rows_filtered_by_goods_no > 0 OR rows_dropped_unparseable > 0
        # This precedes meta-yes/list-no because list-API-yes is the
        # stronger discriminator.
        rows_filtered = int(summary.get("rows_filtered_by_goods_no") or 0)
        rows_dropped_unparseable = int(
            summary.get("rows_dropped_unparseable") or 0,
        )
        records_parsed = int(summary.get("records_parsed") or 0)
        if (
            review_api_count > 0
            and records_parsed == 0
            and (rows_filtered > 0 or rows_dropped_unparseable > 0)
        ):
            return "review_list_api_seen_but_no_rows_kept"
        if review_api_count == 0 and cascade_ran and meta_seen:
            return "review_list_api_not_seen_but_review_meta_seen"
        # 2026-05-01 — page opened, cascade ran, but neither meta nor
        # list endpoint fired. Distinct from the meta-yes case above.
        # Requires the cascade to have run (otherwise this is just an
        # early-failure case already handled above).
        if review_api_count == 0 and cascade_ran and not meta_seen:
            return "review_api_not_seen"
        return "unknown_failure"

    # Successful states (quality_status in {"ok", "degraded"})
    if summary.get("pagination_exhausted") is True:
        return "complete"
    if summary.get("last_observed_has_next") is True:
        return "max_cap_reached"
    rows_inserted = int(summary.get("rows_inserted") or 0)
    records_parsed = int(summary.get("records_parsed") or 0)
    if rows_inserted == 0 and records_parsed > 0:
        return "duplicate_only"
    return "authenticated_ok"


# ---------------------------------------------------------------------------
# Manifest model
# ---------------------------------------------------------------------------

@dataclass
class BatchDefaults:
    max_reviews: int = 200
    cdp_endpoint: str = "http://localhost:9222"
    cold_start_timeout: float = 60.0
    continuation_timeout: float = 12.0
    scroll_attempts: int = 5
    # Phase 2E sort-aware crawl. None = legacy (page-default sort, no
    # oy_sort_type stamp). One of the validated sortType values opts in.
    sort_type: str | None = None
    # Human-check (anti-bot CAPTCHA) wait knobs. Forwarded to the
    # ingest CLI; the connector polls the DOM until either the
    # interstitial clears or the timeout fires.
    human_check_timeout_seconds: int = 900
    human_check_poll_seconds: int = 5
    fail_on_human_check_timeout: bool = False
    # Force a fresh CDP context (cookies/localStorage NOT reused).
    # Set by the multi-sort orchestrator's
    # --strict-reset-session-on-block path on the relaunch after a
    # sticky failure. Default False = legacy reuse-default-context
    # behavior.
    force_fresh_context: bool = False


@dataclass
class ProductSpec:
    name: str
    oy_goods_no: str
    # Per-product overrides; if None, defaults from BatchDefaults apply.
    max_reviews: int | None = None
    cdp_endpoint: str | None = None
    cold_start_timeout: float | None = None
    continuation_timeout: float | None = None
    scroll_attempts: int | None = None
    sort_type: str | None = None
    human_check_timeout_seconds: int | None = None
    human_check_poll_seconds: int | None = None
    fail_on_human_check_timeout: bool | None = None
    force_fresh_context: bool | None = None


@dataclass
class BatchManifest:
    batch_id: str
    defaults: BatchDefaults
    products: list[ProductSpec]


def load_manifest(path: Path | str) -> BatchManifest:
    raw = json.loads(Path(path).read_text(encoding="utf-8"))
    if "batch_id" not in raw:
        raise ValueError("manifest missing required field: batch_id")
    if "products" not in raw or not isinstance(raw["products"], list) or not raw["products"]:
        raise ValueError("manifest missing or empty 'products' list")
    defaults = BatchDefaults(**(raw.get("defaults") or {}))
    products = []
    for entry in raw["products"]:
        if "oy_goods_no" not in entry or "name" not in entry:
            raise ValueError(
                f"product entry missing 'oy_goods_no' or 'name': {entry!r}",
            )
        products.append(ProductSpec(
            name=entry["name"],
            oy_goods_no=entry["oy_goods_no"],
            max_reviews=entry.get("max_reviews"),
            cdp_endpoint=entry.get("cdp_endpoint"),
            cold_start_timeout=entry.get("cold_start_timeout"),
            continuation_timeout=entry.get("continuation_timeout"),
            scroll_attempts=entry.get("scroll_attempts"),
            sort_type=entry.get("sort_type"),
            human_check_timeout_seconds=entry.get("human_check_timeout_seconds"),
            human_check_poll_seconds=entry.get("human_check_poll_seconds"),
            fail_on_human_check_timeout=entry.get("fail_on_human_check_timeout"),
            force_fresh_context=entry.get("force_fresh_context"),
        ))
    return BatchManifest(
        batch_id=raw["batch_id"], defaults=defaults, products=products,
    )


def _resolve(spec: ProductSpec, defaults: BatchDefaults) -> dict[str, Any]:
    """Return resolved per-product config (spec overrides take precedence)."""
    return {
        "max_reviews": spec.max_reviews if spec.max_reviews is not None else defaults.max_reviews,
        "cdp_endpoint": spec.cdp_endpoint or defaults.cdp_endpoint,
        "cold_start_timeout": spec.cold_start_timeout if spec.cold_start_timeout is not None else defaults.cold_start_timeout,
        "continuation_timeout": spec.continuation_timeout if spec.continuation_timeout is not None else defaults.continuation_timeout,
        "scroll_attempts": spec.scroll_attempts if spec.scroll_attempts is not None else defaults.scroll_attempts,
        # sort_type: None means "do not pass --sort-type" (legacy). Any
        # validated sortType string is forwarded to the ingest CLI.
        "sort_type": spec.sort_type if spec.sort_type is not None else defaults.sort_type,
        # Human-check knobs.
        "human_check_timeout_seconds": (
            spec.human_check_timeout_seconds
            if spec.human_check_timeout_seconds is not None
            else defaults.human_check_timeout_seconds
        ),
        "human_check_poll_seconds": (
            spec.human_check_poll_seconds
            if spec.human_check_poll_seconds is not None
            else defaults.human_check_poll_seconds
        ),
        "fail_on_human_check_timeout": (
            spec.fail_on_human_check_timeout
            if spec.fail_on_human_check_timeout is not None
            else defaults.fail_on_human_check_timeout
        ),
        "force_fresh_context": (
            spec.force_fresh_context
            if spec.force_fresh_context is not None
            else defaults.force_fresh_context
        ),
    }


def _product_url(oy_goods_no: str) -> str:
    return f"https://www.oliveyoung.co.kr/store/goods/getGoodsDetail.do?goodsNo={oy_goods_no}"


# ---------------------------------------------------------------------------
# Per-product runner (subprocess by default; injectable for tests)
# ---------------------------------------------------------------------------

# RunnerFn signature: (cmd_argv: list[str]) -> (returncode: int, stdout_text: str, stderr_text: str)
RunnerFn = Callable[[list[str]], tuple[int, str, str]]


def _default_subprocess_runner(argv: list[str]) -> tuple[int, str, str]:
    """Default per-product runner: shell out to the existing ingest CLI.

    Returns (returncode, stdout_text, stderr_text). Never raises on non-zero
    returncode — the caller decides what to do with failures based on the
    parsed summary.
    """
    proc = subprocess.run(
        argv,
        capture_output=True,
        text=True,
        check=False,
    )
    return proc.returncode, proc.stdout, proc.stderr


def _build_ingest_command(
    *,
    spec: ProductSpec,
    defaults: BatchDefaults,
    debug_dir: Path,
    python_exe: str | None = None,
) -> list[str]:
    """Construct the actual subprocess argv to invoke the existing ingest CLI."""
    cfg = _resolve(spec, defaults)
    py = python_exe or sys.executable
    argv = [
        py,
        str(REPO_ROOT / "scripts" / "ingest_oliveyoung_browser_phase1.py"),
        _product_url(spec.oy_goods_no),
        "--max", str(cfg["max_reviews"]),
        "--cdp-endpoint", str(cfg["cdp_endpoint"]),
        "--cold-start-timeout", str(cfg["cold_start_timeout"]),
        "--continuation-timeout", str(cfg["continuation_timeout"]),
        "--scroll-attempts", str(cfg["scroll_attempts"]),
        "--debug-dir", str(debug_dir),
        "--capture-partial-on-invalid",
    ]
    # Only emit --sort-type when explicitly configured. Omitting it
    # preserves the ingest CLI's legacy behavior (page-default sort,
    # no oy_sort_type stamp).
    if cfg["sort_type"] is not None:
        argv.extend(["--sort-type", str(cfg["sort_type"])])
    # Human-check flags: emit only when a non-default value is set so
    # legacy invocations stay unchanged. Defaults match the ingest
    # CLI's defaults.
    argv.extend([
        "--human-check-timeout-seconds",
        str(int(cfg["human_check_timeout_seconds"])),
        "--human-check-poll-seconds",
        str(int(cfg["human_check_poll_seconds"])),
    ])
    if cfg["fail_on_human_check_timeout"]:
        argv.append("--fail-on-human-check-timeout")
    if cfg["force_fresh_context"]:
        argv.append("--force-fresh-context")
    return argv


@dataclass
class ProductResult:
    name: str
    oy_goods_no: str
    started_at: str
    finished_at: str | None = None
    status: str = "unknown_failure"
    quality_status: str | None = None
    rows_inserted: int = 0
    raw_records_seen: int = 0
    records_parsed: int = 0
    duplicate_count: int = 0  # derived: records_parsed - rows_inserted - rows_skipped_by_normalize
    login_state_observed: str | None = None
    last_observed_has_next: bool | None = None
    pagination_exhausted: bool = False
    auth_header_present: bool | None = None  # derived from trace artifact when available
    trace_artifact_path: str | None = None
    partial_debug_artifact_path: str | None = None
    error: str | None = None
    halt_reason: str | None = None
    run_id: str | None = None
    # Multi-sort membership: when a per-product run was invoked with a
    # configured sort_type AND the ingest CLI returned a non-empty
    # collected_review_ids list, the runner writes a sidecar JSON at this
    # path. None when sort-aware mode is off OR when the run failed
    # before producing any review_ids (membership is meaningless then).
    sort_membership_sidecar_path: str | None = None
    # Phase 2E coverage-signal capture (additive). Mirrors the connector's
    # `ConnectorRunSummary.total_review_count_available`. None when the
    # connector didn't surface a value — must NOT be synthesized.
    total_review_count_available: int | None = None

    # 2026-05-01 — diagnostic fields surfaced on every per-product run
    # (not only on failures, so successful runs still report e.g.
    # "list API fired N times"). Defaults match an empty / pre-2026-05-01
    # summary so old fixtures deserialize unchanged.
    cdp_attach_failed: bool = False
    cdp_attach_error: str | None = None
    page_open_failed: bool = False
    page_open_error: str | None = None
    review_meta_api_seen: bool = False
    review_list_api_seen: bool = False
    review_api_response_count: int = 0
    review_more_button_clicked: bool = False
    scrolled_to_review_area: bool = False
    false_empty_state_detected: bool = False
    raw_records_seen_total_before_filter: int = 0
    rows_kept_after_goods_no_filter: int = 0
    rows_filtered_by_goods_no: int = 0
    rows_dropped_unparseable: int = 0
    sample_dropped_reasons: list[str] = field(default_factory=list)
    available_sort_button_labels: list[str] = field(default_factory=list)

    # v2.4.7 — full connector summary dict carried verbatim. The
    # pipeline reads `prod.get("summary")` from the batch artifact
    # to scan for warm-session image-capture diagnostics, CDP
    # propagation audit, etc. Pre-v2.4.7, this dict was discarded
    # by the dataclass because there was no field to hold it: the
    # batch's stdout-reader populated all the EXPLICIT ProductResult
    # fields (status, rows_inserted, ...) from the connector dict
    # but the dict itself was never assigned anywhere, so
    # `BatchReport.to_dict() → [p.__dict__ ...]` emitted no `summary`
    # key for any product. That looked like an upstream propagation
    # bug ("connector never populated v2.4.5 fields") when actually
    # the data was always there — just not stored on ProductResult.
    #
    # Defaults to None so older fixtures (and tests that don't go
    # through `_build_product_result`) deserialize unchanged.
    summary: dict | None = None


def _infer_auth_header_present(trace_path: str | None) -> bool | None:
    """Read the trace JSONL (if present) and return whether ALL captured
    requests had auth_header_present=True. Returns None if no trace or no
    captured requests.
    """
    if not trace_path:
        return None
    p = Path(trace_path)
    if not p.exists():
        return None
    try:
        lines = p.read_text(encoding="utf-8").splitlines()
        if not lines:
            return None
        flags = []
        for line in lines:
            try:
                entry = json.loads(line)
                flags.append(bool(entry.get("request", {}).get("auth_header_present")))
            except Exception:
                continue
        if not flags:
            return None
        return all(flags)
    except Exception as e:
        logger.warning("Failed to read trace artifact %s: %s", trace_path, e)
        return None


def _write_sort_membership_sidecar(
    *,
    batch_dir: Path,
    spec: "ProductSpec",
    sort_type: str,
    role: str,
    review_ids: list[str],
) -> Path | None:
    """Write the per-sort membership sidecar JSON in the rank-aware
    `items` format.

    Convention (matches the multi-sort plan spec): one file per
    (goodsNo, sort_type), placed at the batch_dir root so the orchestrator
    can scan with a single glob across per-sort batch dirs:

        <batch_dir>/<goodsNo>_<sort_type>_review_ids.json

    The connector preserves the order of records as the page's API
    returns them — i.e., highest-ranked first — so the 1-based index in
    `review_ids` IS the per-sort rank. We write that explicitly so the
    membership merger can carry it through to raw_metadata.oy_sort_ranks
    without re-deriving it from list position.

    Filename keeps the legacy `_review_ids.json` suffix so already-deployed
    `find_sidecars()` globs continue to match without a coordinated change.

    Returns the written path on success, None when there is nothing to
    write (no review_ids — e.g., the run failed before producing rows;
    skipping avoids polluting the artifact dir with empty sidecars).
    """
    if not review_ids:
        return None
    path = batch_dir / f"{spec.oy_goods_no}_{sort_type}_review_ids.json"
    items = [
        {"review_id": str(rid), "rank": idx + 1}
        for idx, rid in enumerate(review_ids)
    ]
    payload = {
        "goodsNo": spec.oy_goods_no,
        "sort_type": sort_type,
        "role": role,
        "items": items,
    }
    path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    return path


# Mirrors src/voc/app/sort_membership.SORT_ROLE_BY_SORT_TYPE — duplicated
# (not imported) so this module's imports stay narrow and the role
# attribution survives even if the membership module is removed later.
# Both lookups share a single source of truth: the Phase 2E plan in
# scripts/run_phase2e_pipeline.py and the connector's
# _SORT_ROLE_BY_SORT_TYPE.
_SORT_ROLE_BY_SORT_TYPE_FOR_SIDECAR: dict[str, str] = {
    "DATETIME_DESC":     "primary",
    "RATING_ASC":        "signal",
    "RATING_DESC":       "signal",
    "USEFUL_SCORE_DESC": "signal",
    "RECOMMENDED_DESC":  "signal",
}


def _build_product_result(
    *,
    spec: ProductSpec,
    started_at: str,
    finished_at: str,
    stdout_json: dict[str, Any] | None,
    error: str | None,
    defaults: BatchDefaults | None = None,
) -> ProductResult:
    """Build a ProductResult from the ingest CLI's parsed stdout JSON.

    `defaults` (v2.4.7, optional) is used to resolve the effective
    cdp_endpoint when the early-error path stamps a synthetic summary —
    the per-spec override may be None, in which case the manifest's
    defaults block holds the value. Passing None falls back to
    spec.cdp_endpoint only, which preserves the legacy behavior."""
    effective_cdp_endpoint = (
        (spec.cdp_endpoint or (defaults.cdp_endpoint if defaults else None))
    )
    if stdout_json is None:
        # 2026-05-01 — when the CLI crashed before emitting JSON, parse
        # the stderr tail (carried in `error`) for the same hints the
        # CLI itself uses (`classify_early_failure`). Routes the
        # crashed-too-early case to `cdp_attach_failed` /
        # `page_open_failed` instead of the generic `unknown_failure`.
        # Hints duplicated locally to keep this module independent of
        # the CLI script's import path.
        err_text = (error or "").lower()
        cdp_hints = (
            "setdownloadbehavior",
            "browser context management is not supported",
            "connect_over_cdp",
            "browser closed",
            "target closed",
            "econnrefused 127.0.0.1",
        )
        page_hints = (
            "page.goto",
            "err_name_not_resolved",
            "err_connection_refused",
            "navigation failed",
        )
        if any(h in err_text for h in cdp_hints):
            return ProductResult(
                name=spec.name,
                oy_goods_no=spec.oy_goods_no,
                started_at=started_at,
                finished_at=finished_at,
                status="cdp_attach_failed",
                error=error or "no stdout JSON parsed",
                cdp_attach_failed=True,
                cdp_attach_error=error,
                # v2.4.7 — even with no stdout JSON, surface the
                # cdp_endpoint that was passed via the manifest so
                # the pipeline scan sees a non-null requested_cdp_endpoint
                # (and the failure_reason classifier can correctly land
                # on "cdp_attach_failed" rather than mis-diagnose as
                # "cdp_endpoint_not_forwarded").
                summary={
                    "cdp_attach_failed": True,
                    "cdp_attach_error": error,
                    "requested_cdp_endpoint": effective_cdp_endpoint,
                    "connector_received_cdp_endpoint": effective_cdp_endpoint,
                    "product_image_capture_error": (
                        f"early_failure:cdp_attach_failed:{(error or '')[:120]}"
                    ),
                },
            )
        if any(h in err_text for h in page_hints):
            return ProductResult(
                name=spec.name,
                oy_goods_no=spec.oy_goods_no,
                started_at=started_at,
                finished_at=finished_at,
                status="page_open_failed",
                error=error or "no stdout JSON parsed",
                page_open_failed=True,
                page_open_error=error,
                summary={
                    "page_open_failed": True,
                    "page_open_error": error,
                    "requested_cdp_endpoint": effective_cdp_endpoint,
                    "connector_received_cdp_endpoint": effective_cdp_endpoint,
                    "product_image_capture_error": (
                        f"early_failure:page_open_failed:{(error or '')[:120]}"
                    ),
                },
            )
        return ProductResult(
            name=spec.name,
            oy_goods_no=spec.oy_goods_no,
            started_at=started_at,
            finished_at=finished_at,
            status="unknown_failure",
            error=error or "no stdout JSON parsed",
            summary={
                "requested_cdp_endpoint": effective_cdp_endpoint,
                "connector_received_cdp_endpoint": effective_cdp_endpoint,
                "product_image_capture_error": (
                    f"early_failure:unknown_failure:{(error or '')[:120]}"
                ),
            },
        )
    summary = stdout_json.get("summary") or {}
    rows_inserted = int(stdout_json.get("rows_inserted") or 0)
    rows_skipped = int(stdout_json.get("rows_skipped_by_normalize") or 0)
    records_parsed = int(summary.get("records_parsed") or 0)
    duplicate_count = max(0, records_parsed - rows_inserted - rows_skipped)
    status = classify_status({
        # The ingest CLI surfaces quality_status at the top level AND inside summary;
        # the top-level wins because it's the pipeline's final classification.
        "quality_status": stdout_json.get("quality_status") or summary.get("quality_status"),
        "rows_inserted": rows_inserted,
        "records_parsed": records_parsed,
        "blocked": summary.get("blocked"),
        "auth_error": summary.get("auth_error"),
        "mid_stream_auth_break": summary.get("mid_stream_auth_break"),
        "http_403_seen": summary.get("http_403_seen"),
        "http_429_seen": summary.get("http_429_seen"),
        "login_state_observed": summary.get("login_state_observed"),
        "pagination_exhausted": summary.get("pagination_exhausted"),
        "last_observed_has_next": summary.get("last_observed_has_next"),
        "partial_debug_artifact_path": summary.get("partial_debug_artifact_path"),
        "parse_warnings": summary.get("parse_warnings") or 0,
        # 2026-05-01 — diagnostic signals routed into classify_status
        # so the new statuses (cdp_attach_failed, page_open_failed,
        # review_list_api_seen_but_no_rows_kept, review_api_not_seen)
        # can fire when the connector / ingest CLI populates them.
        "cdp_attach_failed": summary.get("cdp_attach_failed"),
        "page_open_failed": summary.get("page_open_failed"),
        "false_empty_state_detected": summary.get("false_empty_state_detected"),
        "review_api_response_count": summary.get("review_api_response_count"),
        "scrolled_to_review_area": summary.get("scrolled_to_review_area"),
        "review_more_button_clicked": summary.get("review_more_button_clicked"),
        "total_review_count_available": summary.get("total_review_count_available"),
        # v2.4.3 — captured during the warm OY session's initial page
        # load. Pipeline-start product metadata collector consumes this
        # to skip its standalone HTTP detail-page fetch.
        "product_image_url": summary.get("product_image_url"),
        # v2.4.4 — image-capture diagnostic for operator audit when
        # the warm capture didn't yield a URL.
        "product_image_capture_attempted": summary.get("product_image_capture_attempted"),
        "product_image_capture_page_url": summary.get("product_image_capture_page_url"),
        "product_image_capture_html_length": summary.get("product_image_capture_html_length"),
        "product_image_capture_og_count": summary.get("product_image_capture_og_count"),
        "product_image_capture_jsonld_count": summary.get("product_image_capture_jsonld_count"),
        "product_image_capture_twitter_count": summary.get("product_image_capture_twitter_count"),
        "product_image_capture_link_image_src_count": summary.get(
            "product_image_capture_link_image_src_count",
        ),
        "product_image_capture_oy_thumbnail_img_count": summary.get(
            "product_image_capture_oy_thumbnail_img_count",
        ),
        "product_image_capture_selected_source": summary.get(
            "product_image_capture_selected_source",
        ),
        "product_image_capture_error": summary.get("product_image_capture_error"),
        # v2.4.4 — CDP / browser session telemetry. When the operator's
        # CDP attach didn't take effect (subprocess launched its own
        # browser instead) this is the audit trail that surfaces the
        # mismatch.
        "cdp_endpoint_used": summary.get("cdp_endpoint_used"),
        "connected_via_cdp": summary.get("connected_via_cdp"),
        "browser_user_agent": summary.get("browser_user_agent"),
        # v2.4.5 — session lifecycle + identity diagnostics.
        # Distinguishes "open never ran" vs "open ran but capture
        # didn't fire" vs "capture fired but found nothing".
        "product_image_session_id": summary.get("product_image_session_id"),
        "product_image_diagnostic_session_id": summary.get(
            "product_image_diagnostic_session_id",
        ),
        "product_image_session_class": summary.get("product_image_session_class"),
        "product_image_session_open_called": summary.get(
            "product_image_session_open_called",
        ),
        "product_image_session_open_url_at_start": summary.get(
            "product_image_session_open_url_at_start",
        ),
        "product_image_capture_hook_reached": summary.get(
            "product_image_capture_hook_reached",
        ),
        "product_image_session_received_cdp_endpoint": summary.get(
            "product_image_session_received_cdp_endpoint",
        ),
        # v2.4.5 — CDP propagation audit fields.
        "requested_cdp_endpoint": summary.get("requested_cdp_endpoint"),
        "connector_received_cdp_endpoint": summary.get(
            "connector_received_cdp_endpoint",
        ),
        "rows_filtered_by_goods_no": summary.get("rows_filtered_by_goods_no"),
        "rows_dropped_unparseable": summary.get("rows_dropped_unparseable"),
    })
    return ProductResult(
        name=spec.name,
        oy_goods_no=spec.oy_goods_no,
        started_at=started_at,
        finished_at=finished_at,
        status=status,
        quality_status=stdout_json.get("quality_status") or summary.get("quality_status"),
        rows_inserted=rows_inserted,
        raw_records_seen=int(summary.get("raw_records_seen") or 0),
        records_parsed=records_parsed,
        duplicate_count=duplicate_count,
        login_state_observed=summary.get("login_state_observed"),
        last_observed_has_next=summary.get("last_observed_has_next"),
        pagination_exhausted=bool(summary.get("pagination_exhausted")),
        trace_artifact_path=summary.get("trace_artifact_path"),
        partial_debug_artifact_path=summary.get("partial_debug_artifact_path"),
        auth_header_present=_infer_auth_header_present(summary.get("trace_artifact_path")),
        run_id=stdout_json.get("run_id") or summary.get("run_id"),
        error=error,
        total_review_count_available=summary.get(
            "total_review_count_available"
        ),
        # 2026-05-01 — diagnostic surfacing.
        cdp_attach_failed=bool(summary.get("cdp_attach_failed")),
        cdp_attach_error=summary.get("cdp_attach_error"),
        page_open_failed=bool(summary.get("page_open_failed")),
        page_open_error=summary.get("page_open_error"),
        review_meta_api_seen=bool(summary.get("review_meta_api_seen")),
        review_list_api_seen=bool(summary.get("review_list_api_seen")),
        review_api_response_count=int(
            summary.get("review_api_response_count") or 0,
        ),
        review_more_button_clicked=bool(
            summary.get("review_more_button_clicked"),
        ),
        scrolled_to_review_area=bool(summary.get("scrolled_to_review_area")),
        false_empty_state_detected=bool(
            summary.get("false_empty_state_detected"),
        ),
        raw_records_seen_total_before_filter=int(
            summary.get("raw_records_seen_total_before_filter") or 0,
        ),
        rows_kept_after_goods_no_filter=int(
            summary.get("rows_kept_after_goods_no_filter") or 0,
        ),
        rows_filtered_by_goods_no=int(
            summary.get("rows_filtered_by_goods_no") or 0,
        ),
        rows_dropped_unparseable=int(
            summary.get("rows_dropped_unparseable") or 0,
        ),
        sample_dropped_reasons=list(
            summary.get("sample_dropped_reasons") or [],
        ),
        available_sort_button_labels=list(
            summary.get("available_sort_button_labels") or [],
        ),
        # v2.4.7 — carry the FULL connector summary dict on the
        # ProductResult so it survives `BatchReport.to_dict()` and
        # reaches the pipeline's prod_summary scan with all v2.4.x
        # diagnostic fields intact. Pre-v2.4.7 the connector summary
        # was used to populate the explicit ProductResult fields and
        # then thrown away — fields like `requested_cdp_endpoint`,
        # `product_image_capture_attempted`, etc. that the pipeline
        # depends on for the warm-image-capture audit were never
        # serialized into batch_summary.json.
        summary=dict(summary) if isinstance(summary, dict) else None,
    )


# ---------------------------------------------------------------------------
# Batch driver
# ---------------------------------------------------------------------------

@dataclass
class BatchReport:
    batch_id: str
    started_at: str
    finished_at: str | None = None
    halted: bool = False
    halt_reason: str | None = None
    products: list[ProductResult] = field(default_factory=list)
    artifact_root: str = ""
    # v2.4.5 — manifest audit trail. Records the cdp_endpoint /
    # browser-mode values pulled from the manifest's defaults at
    # run-batch start so operators can see what the batch actually
    # received vs what they intended in the manifest file.
    manifest_audit: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {
            "batch_id": self.batch_id,
            "started_at": self.started_at,
            "finished_at": self.finished_at,
            "halted": self.halted,
            "halt_reason": self.halt_reason,
            "artifact_root": self.artifact_root,
            "product_count_attempted": len(self.products),
            "manifest_audit": self.manifest_audit,
            "products": [p.__dict__ for p in self.products],
        }


def render_batch_markdown(report: BatchReport) -> str:
    lines: list[str] = []
    lines.append(f"# OY collection batch report — `{report.batch_id}`")
    lines.append("")
    lines.append(f"- started_at: `{report.started_at}`")
    lines.append(f"- finished_at: `{report.finished_at or '(in progress / halted)'}`")
    lines.append(f"- halted: {report.halted}")
    if report.halted:
        lines.append(f"- halt_reason: `{report.halt_reason}`")
    lines.append(f"- artifact_root: `{report.artifact_root}`")
    lines.append(f"- products attempted: {len(report.products)}")
    lines.append("")
    lines.append("## Per-product outcomes")
    lines.append("")
    lines.append(
        "| product | goodsNo | status | quality | rows_inserted | parsed | duplicates | login_state | has_next | exhausted | run_id |"
    )
    lines.append(
        "|---|---|---|---|---:|---:|---:|---|:---:|:---:|---|"
    )
    for p in report.products:
        lines.append(
            f"| {p.name} | `{p.oy_goods_no}` | `{p.status}` | "
            f"{p.quality_status or '-'} | {p.rows_inserted} | "
            f"{p.records_parsed} | {p.duplicate_count} | "
            f"{p.login_state_observed or '-'} | "
            f"{'-' if p.last_observed_has_next is None else p.last_observed_has_next} | "
            f"{p.pagination_exhausted} | "
            f"{p.run_id or '-'} |"
        )
    lines.append("")
    if report.products:
        lines.append("## Per-product artifact paths")
        lines.append("")
        for p in report.products:
            lines.append(f"### {p.name} (`{p.oy_goods_no}`)")
            lines.append(f"- trace_artifact: `{p.trace_artifact_path or '(none)'}`")
            lines.append(f"- partial_artifact: `{p.partial_debug_artifact_path or '(none)'}`")
            if p.error:
                lines.append(f"- error: {p.error}")
            if p.halt_reason:
                lines.append(f"- halt_reason: {p.halt_reason}")
            # 2026-05-01 — diagnostic block. Always emit on non-success
            # statuses so the operator can see what the connector
            # observed (or didn't) without opening the trace JSONL.
            # `_NON_DIAGNOSTIC_STATUSES` is the small set of clean-exit
            # outcomes; every other status (failure or partial) triggers
            # the block so the operator never has to crack the JSON
            # to understand `unknown_failure`-shaped runs.
            _NON_DIAGNOSTIC_STATUSES = {
                "complete", "max_cap_reached",
                "duplicate_only", "authenticated_ok",
            }
            if p.status not in _NON_DIAGNOSTIC_STATUSES:
                lines.append("- diagnostic:")
                lines.append(f"  - cdp_attach_failed: {p.cdp_attach_failed}")
                if p.cdp_attach_error:
                    lines.append(f"  - cdp_attach_error: `{p.cdp_attach_error}`")
                lines.append(f"  - page_open_failed: {p.page_open_failed}")
                if p.page_open_error:
                    lines.append(f"  - page_open_error: `{p.page_open_error}`")
                lines.append(f"  - review_meta_api_seen: {p.review_meta_api_seen}")
                lines.append(f"  - review_list_api_seen: {p.review_list_api_seen}")
                lines.append(
                    f"  - review_api_response_count: "
                    f"{p.review_api_response_count}"
                )
                lines.append(
                    f"  - scrolled_to_review_area: "
                    f"{p.scrolled_to_review_area}"
                )
                lines.append(
                    f"  - review_more_button_clicked: "
                    f"{p.review_more_button_clicked}"
                )
                lines.append(
                    f"  - false_empty_state_detected: "
                    f"{p.false_empty_state_detected}"
                )
                lines.append(
                    f"  - raw_records_seen_total_before_filter: "
                    f"{p.raw_records_seen_total_before_filter}"
                )
                lines.append(
                    f"  - rows_kept_after_goods_no_filter: "
                    f"{p.rows_kept_after_goods_no_filter}"
                )
                lines.append(
                    f"  - rows_filtered_by_goods_no: "
                    f"{p.rows_filtered_by_goods_no}"
                )
                lines.append(
                    f"  - rows_dropped_unparseable: "
                    f"{p.rows_dropped_unparseable}"
                )
                if p.available_sort_button_labels:
                    lines.append(
                        f"  - available_sort_button_labels: "
                        f"{p.available_sort_button_labels}"
                    )
                if p.sample_dropped_reasons:
                    lines.append(
                        f"  - sample_dropped_reasons: "
                        f"{p.sample_dropped_reasons[:5]}"
                    )
            lines.append("")
    return "\n".join(lines) + "\n"


def _write_batch_outputs(report: BatchReport, batch_dir: Path) -> None:
    batch_dir.mkdir(parents=True, exist_ok=True)
    (batch_dir / "batch_summary.json").write_text(
        json.dumps(report.to_dict(), ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    (batch_dir / "batch_summary.md").write_text(
        render_batch_markdown(report), encoding="utf-8",
    )


def run_batch(
    *,
    manifest: BatchManifest,
    artifact_root: Path | str = DEFAULT_ARTIFACT_ROOT,
    jitter_min: float = 0.0,
    jitter_max: float = 0.0,
    runner_fn: RunnerFn | None = None,
    sleep_fn: Callable[[float], None] = time.sleep,
    rng: random.Random | None = None,
) -> BatchReport:
    """Execute the batch sequentially. Halts on auth/anti-bot statuses.

    `runner_fn` is the per-product subprocess invocation. The default shells
    out to `scripts/ingest_oliveyoung_browser_phase1.py`. Tests inject a
    stub that returns a synthetic stdout JSON without touching the network
    or DB.

    Jitter sleep happens between products (not before the first one).
    `jitter_min=0` and `jitter_max=0` disables the sleep entirely (default
    for tests).

    Returns a populated `BatchReport`. Always writes
    `data/collection_artifacts/<batch_id>/batch_summary.{json,md}` before
    returning, even when halted mid-batch.
    """
    runner = runner_fn or _default_subprocess_runner
    rng = rng or random.Random()
    artifact_root = Path(artifact_root)
    batch_dir = artifact_root / manifest.batch_id
    batch_dir.mkdir(parents=True, exist_ok=True)

    # v2.4.5 — record what the manifest's defaults block actually
    # carried for the cdp/browser settings. This is the FIRST audit
    # point in the propagation chain (manifest → batch → connector
    # → session → page). When this differs from what the connector
    # later reports as `requested_cdp_endpoint`, the gap is between
    # batch-defaults read and `_build_ingest_command`.
    report = BatchReport(
        batch_id=manifest.batch_id,
        started_at=datetime.now().isoformat(),
        artifact_root=str(batch_dir),
        manifest_audit={
            "cdp_endpoint_in_defaults": manifest.defaults.cdp_endpoint,
            "force_fresh_context_in_defaults": manifest.defaults.force_fresh_context,
            "sort_type_in_defaults": manifest.defaults.sort_type,
            "max_reviews_in_defaults": manifest.defaults.max_reviews,
            "per_product_cdp_overrides": [
                {
                    "oy_goods_no": p.oy_goods_no,
                    "cdp_endpoint_override": p.cdp_endpoint,
                }
                for p in manifest.products
                if p.cdp_endpoint is not None
            ],
        },
    )

    for i, spec in enumerate(manifest.products):
        # Jitter sleep before product 2..N
        if i > 0 and (jitter_min > 0 or jitter_max > 0):
            delay = rng.uniform(jitter_min, jitter_max)
            logger.info("Sleeping %.1fs before product %s", delay, spec.oy_goods_no)
            sleep_fn(delay)

        debug_dir = batch_dir / spec.oy_goods_no
        debug_dir.mkdir(parents=True, exist_ok=True)
        argv = _build_ingest_command(
            spec=spec, defaults=manifest.defaults, debug_dir=debug_dir,
        )
        started_at = datetime.now().isoformat()
        logger.info(
            "Running product %s/%s: %s (%s)",
            i + 1, len(manifest.products), spec.name, spec.oy_goods_no,
        )
        rc, stdout, stderr = runner(argv)
        finished_at = datetime.now().isoformat()

        stdout_json: dict[str, Any] | None = None
        parse_error: str | None = None
        if stdout.strip():
            try:
                stdout_json = json.loads(stdout)
            except json.JSONDecodeError as e:
                parse_error = f"stdout JSON decode failed: {e}; raw stderr tail: {stderr[-500:]}"

        if rc != 0 and stdout_json is None:
            parse_error = (
                f"ingest CLI exited rc={rc} with no parseable stdout. "
                f"stderr tail: {stderr[-500:]}"
            )

        result = _build_product_result(
            spec=spec,
            defaults=manifest.defaults,
            started_at=started_at,
            finished_at=finished_at,
            stdout_json=stdout_json,
            error=parse_error,
        )

        # Multi-sort membership sidecar — only when the per-product
        # config carries a configured sort_type AND the ingest CLI
        # surfaced a non-empty collected_review_ids list. The sort_type
        # we write into the sidecar comes from stdout_json (truth from
        # the connector's actual --sort-type arg) and falls back to the
        # spec's resolved sort_type if absent. Failures here are
        # logged-and-continue: a missing sidecar is not worth aborting
        # the batch, since the legacy oy_sort_type / oy_sort_role stamping
        # already covers single-membership for the scrape that ran.
        try:
            cfg = _resolve(spec, manifest.defaults)
            configured_sort = cfg["sort_type"]
            if configured_sort and stdout_json is not None:
                rids = stdout_json.get("collected_review_ids") or []
                if isinstance(rids, list) and rids:
                    role = _SORT_ROLE_BY_SORT_TYPE_FOR_SIDECAR.get(
                        configured_sort, "unknown",
                    )
                    written = _write_sort_membership_sidecar(
                        batch_dir=batch_dir,
                        spec=spec,
                        sort_type=str(configured_sort),
                        role=role,
                        review_ids=[str(x) for x in rids],
                    )
                    if written is not None:
                        result.sort_membership_sidecar_path = str(written)
        except Exception as e:
            logger.warning(
                "sort-membership sidecar write failed for %s/%s: %s",
                spec.oy_goods_no, configured_sort if 'configured_sort' in dir() else '?', e,
            )

        report.products.append(result)

        # Persist after every product so a crash mid-batch leaves a partial report.
        _write_batch_outputs(report, batch_dir)

        if result.status in HALT_STATUSES:
            report.halted = True
            report.halt_reason = (
                f"product '{spec.oy_goods_no}' classified as '{result.status}'"
            )
            result.halt_reason = report.halt_reason
            report.finished_at = datetime.now().isoformat()
            _write_batch_outputs(report, batch_dir)
            logger.warning(
                "Batch halted: %s — re-establish auth and rerun this product",
                report.halt_reason,
            )
            return report

    report.finished_at = datetime.now().isoformat()
    _write_batch_outputs(report, batch_dir)
    return report
