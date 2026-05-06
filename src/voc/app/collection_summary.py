"""Per-run scrape provenance sidecar.

Writes `shared/collection_summary.json` next to `analysis_report.json`
in the run directory. Captures every sort's outcome — success, failure,
attempt count, anti-bot signals, raw record counts — so a post-hoc
audit can reconstruct what happened during scrape without diving back
into per-batch artifacts under `data/collection_artifacts/`.

The manifest writer (`src/voc/content/manifest.py`) probes for this
sidecar and lifts a flat subset (`sorts_attempted`, `sorts_succeeded`,
`partial_success`) into the manifest's `collection` block. The full
sidecar stays under `shared/` for the inspect CLI and for ad-hoc
operator review.

Hard rules
----------
- Pure functions. The builder is deterministic given inputs.
- No DB, no network, no LLM.
- Schema is additive — new fields appear at the end and tolerate
  missing inputs (returns `None` rather than raising).
- Atomic write (write-temp-then-rename) so a partial sidecar never
  appears on disk.
"""
from __future__ import annotations

import json
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterable, Sequence


COLLECTION_SUMMARY_SCHEMA_VERSION = "1.1"

# Analysis lifecycle states.
#   pending   — sidecar emitted post-scrape, BEFORE Stage 1/2/3 / aggregate.
#               If the process crashes during analysis, this state is what
#               survives on disk. The operator can re-run with `--skip-scrape`
#               to retry analysis without losing scrape provenance.
#   completed — sidecar updated after analysis_report.json + seller PDF
#               are written. Final state for a successful run.
#   failed    — reserved for future use; not currently set automatically.
#               (We intentionally do NOT catch + write "failed" because that
#               would mask the underlying exception trace; the operator
#               distinguishes "crashed mid-analysis" from "completed" by the
#               persistent `pending` state.)
ANALYSIS_STATUS_PENDING = "pending"
ANALYSIS_STATUS_COMPLETED = "completed"
ANALYSIS_STATUS_FAILED = "failed"
ANALYSIS_STATUS_VALUES: frozenset[str] = frozenset({
    ANALYSIS_STATUS_PENDING,
    ANALYSIS_STATUS_COMPLETED,
    ANALYSIS_STATUS_FAILED,
})

# Statuses that indicate a sort was blocked by an anti-bot / auth
# signal rather than a routine zero-result outcome. Used to populate
# `anti_bot_or_blocked_by_sort`. Lifted from the connector vocabulary
# at `src/voc/connectors/oliveyoung_browser_api.py`.
BLOCKING_STATUSES: frozenset[str] = frozenset({
    "anti_bot",
    "anonymous_auth_wall",
    "human_check_skipped",
    "human_check_timeout",
    "blocked_or_empty_state",
})

# Subprocess-level transports that mean "the scraper subprocess
# couldn't run to completion" — distinct from "ran but blocked."
SUBPROCESS_FAIL_STATUSES: frozenset[str] = frozenset({
    "scraper_subprocess_failed",
})

# Statuses that count as a successful collection outcome regardless
# of insert counts (e.g. `duplicate_only` succeeds with 0 inserts
# because all rows were already on disk from a prior run; the run
# itself ran cleanly). Anything OUTSIDE this allow-list requires
# `rows_inserted > 0` AND a non-failure status to count as success.
EXPLICIT_SUCCESS_STATUSES: frozenset[str] = frozenset({
    "ok",
    "complete",
    "max_cap_reached",
    "duplicate_only",
    "authenticated_ok",
    # `review_list_api_seen_but_no_rows_kept` is a connector-level
    # "we ran but the goods-filter dropped everything" state. The
    # scrape ITSELF was clean — we treat it as a success-with-zero-
    # inserts so the carousel/seller pipeline can proceed against
    # whatever the DB already has, with the explicit reason recorded.
    "review_list_api_seen_but_no_rows_kept",
})

# Statuses we explicitly exclude from sorts_succeeded even if
# raw_records_seen > 0. `unknown_failure` is the canonical bug from
# v2.4.4: the prior implementation treated raw_seen > 0 as success,
# which is wrong when the connector classified the run as `invalid`.
EXPLICIT_FAILURE_STATUSES: frozenset[str] = frozenset({
    "unknown_failure",
    "cdp_attach_failed",
    "page_open_failed",
    "parser_error",
    "partial_artifact_only",
    "review_list_api_not_seen_but_review_meta_seen",
    "review_api_not_seen",
})

# Legacy alias kept for any external imports.
SUCCESS_STATUSES = EXPLICIT_SUCCESS_STATUSES


def _is_success_entry(entry: dict) -> bool:
    """A per-sort entry counts as success only when it passes ONE of:
      (a) `status` is in EXPLICIT_SUCCESS_STATUSES (the scrape ran
          cleanly; insert counts may be zero for `duplicate_only` /
          carryover cases), OR
      (b) status is unclassified and rows_inserted > 0 — DB-visible
          new rows from a non-failure run.

    Anything in EXPLICIT_FAILURE_STATUSES (including `unknown_failure`
    + `quality=invalid`) is excluded regardless of raw_records_seen.
    """
    status = entry.get("status")
    quality_status = entry.get("quality_status")
    if status in BLOCKING_STATUSES or status in SUBPROCESS_FAIL_STATUSES:
        return False
    if status in EXPLICIT_FAILURE_STATUSES:
        return False
    if quality_status == "invalid":
        # `quality=invalid` is the connector's hard "do not trust this
        # batch" verdict. Reject regardless of raw_records_seen.
        return False
    if status in EXPLICIT_SUCCESS_STATUSES:
        # Soft-block guard: a bare `ok` status with zero raw records
        # AND zero inserts is the canonical "page rendered but review
        # list was empty (often anti-bot)" pattern. Treated as failed.
        # Other success statuses (`duplicate_only`, `max_cap_reached`,
        # `complete`, `review_list_api_seen_but_no_rows_kept`) carry
        # explicit semantics that justify success even with zero
        # inserts (carryover / API-saw-rows-but-filter-dropped-them).
        raw_seen = int(entry.get("raw_records_seen") or 0)
        rows_inserted = int(entry.get("rows_inserted") or 0)
        if status == "ok" and raw_seen == 0 and rows_inserted == 0:
            return False
        return True
    # Unclassified status (e.g. legacy summaries, future taxonomy
    # additions): allow only when rows_inserted > 0 AND quality is
    # ok/degraded (not invalid).
    rows_inserted = int(entry.get("rows_inserted") or 0)
    if rows_inserted > 0 and quality_status in (None, "ok", "degraded"):
        return True
    return False


def _success_reason(entry: dict) -> str:
    """Audit string explaining why a per-sort entry was classified the
    way it was. Recorded on the per_sort dict so operators can see at
    a glance whether the success was a clean pagination, a carryover,
    or whether a failure was a hard block vs. a parser error."""
    status = entry.get("status")
    quality_status = entry.get("quality_status")
    rows_inserted = int(entry.get("rows_inserted") or 0)
    raw_seen = int(entry.get("raw_records_seen") or 0)
    if status in BLOCKING_STATUSES:
        return f"failed_blocked:{status}"
    if status in SUBPROCESS_FAIL_STATUSES:
        return f"failed_subprocess:{status}"
    if status in EXPLICIT_FAILURE_STATUSES:
        return f"failed_status:{status}"
    if quality_status == "invalid":
        return f"failed_quality_invalid:{status or 'no_status'}"
    if status in EXPLICIT_SUCCESS_STATUSES:
        if status == "ok" and raw_seen == 0 and rows_inserted == 0:
            return "failed_soft_block:ok_with_zero_records"
        if rows_inserted == 0:
            return f"success_carryover:{status}"
        return f"success_clean:{status}"
    if rows_inserted > 0:
        return f"success_unclassified_status:{status or 'no_status'}"
    return (
        f"failed_unclassified:status={status or 'no_status'} "
        f"raw_seen={raw_seen} rows_inserted={rows_inserted}"
    )


def _is_blocked_entry(entry: dict) -> bool:
    """True when the per-sort entry indicates an anti-bot / auth
    block. `quality_status` and `status` are both consulted because
    the connector populates them at different layers."""
    if entry.get("status") in BLOCKING_STATUSES:
        return True
    if entry.get("quality_status") in BLOCKING_STATUSES:
        return True
    # `prod_summary` carries connector-level telemetry. A non-zero
    # `false_empty_state_detected` is a soft block.
    ps = entry.get("prod_summary")
    if isinstance(ps, dict):
        if ps.get("false_empty_state_detected"):
            return True
    return False


_AUTH_EVIDENCE_STATUSES: frozenset[str] = frozenset({
    "anti_bot",
    "anonymous_auth_wall",
    "auth_expired_mid_batch",
    "human_check_skipped",
    "human_check_timeout",
})


def _has_auth_evidence_entry(entry: dict) -> bool:
    """Pass-19E: True only when the entry carries HARD auth-wall
    evidence: either a status the connector reserved for real
    auth/anti-bot events (401/403/429/captcha/login_required) OR
    a prod_summary signal observed by the connector.

    The previous BLOCKING_STATUSES grouping was too broad —
    `blocked_or_empty_state` fires for both real anti-bot AND
    sort-control failures. We now exclude `blocked_or_empty_state`
    from the auth-evidence set; the user-visible inspector message
    must distinguish them.

    Reuses `auth_wall_diagnostics.has_auth_evidence` so the
    prod_summary rule lives in one place.
    """
    # The connector's classify_status output is itself a strong
    # signal — when it says `anti_bot`, the connector observed
    # blocked=True / 403 / 429 / auth_error.
    if entry.get("status") in _AUTH_EVIDENCE_STATUSES:
        return True
    if entry.get("quality_status") in _AUTH_EVIDENCE_STATUSES:
        return True

    # Lazy import to avoid a top-level cycle (auth_wall_diagnostics
    # is in the reporting layer).
    from src.voc.reporting.phase2e.auth_wall_diagnostics import (
        has_auth_evidence,
    )

    ps = entry.get("prod_summary")
    error = entry.get("error")
    if has_auth_evidence(ps if isinstance(ps, dict) else None, error=error):
        return True

    # `scraper_subprocess_failed` with an error message that mentions
    # anti-bot is also auth evidence (the legacy
    # `_subprocess_failed("X", error="rc=1 anti_bot")` test fixture
    # represents this case).
    err_str = error or ""
    if isinstance(err_str, str) and (
        "anti_bot" in err_str.lower()
        or "anti-bot" in err_str.lower()
    ):
        return True
    return False


def _peer_observed_target_sort_count(
    *,
    sort_type: str,
    summaries: Sequence[dict],
) -> int:
    """Total observed-sort-types count for `sort_type` across every
    peer entry. Used by the default-sort reuse promotion.
    """
    total = 0
    for peer in summaries or []:
        if not isinstance(peer, dict):
            continue
        # Skip the entry itself when traversing.
        peer_st = peer.get("sort_type")
        if peer_st == sort_type:
            continue
        peer_ps = peer.get("prod_summary")
        if not isinstance(peer_ps, dict):
            continue
        observed = peer_ps.get("observed_sort_types") or {}
        if not isinstance(observed, dict):
            continue
        try:
            total += int(observed.get(sort_type) or 0)
        except (TypeError, ValueError):
            continue
    return total


def _retry_count_from_entry(entry: dict) -> int:
    """Best-effort retry count extraction. The pipeline records
    `attempts` for strict-mode loops; non-strict mode does at most
    one retry which we surface as `retry_count = (attempts - 1)`
    when the field exists."""
    attempts = entry.get("attempts")
    if isinstance(attempts, int) and attempts >= 1:
        return max(0, attempts - 1)
    # Connector-level retry counter for false-empty events.
    ps = entry.get("prod_summary")
    if isinstance(ps, dict):
        fe = ps.get("false_empty_retry_count")
        if isinstance(fe, int):
            return fe
    return 0


def build_collection_summary(
    *,
    product_url: str | None,
    goods_no: str | None,
    product_name: str | None,
    corpus_mode: str,
    primary_sort: str | None,
    per_sort_summaries: Sequence[dict] | None,
    sorts_attempted_plan: Sequence[str] | None = None,
    review_count_available_after_merge: int | None = None,
    review_count_analyzed: int | None = None,
    collection_started_at: str | None = None,
    collection_completed_at: str | None = None,
    skipped_scrape: bool = False,
    analysis_status: str = ANALYSIS_STATUS_PENDING,
    completed_at: str | None = None,
    analysis_report_path: str | None = None,
    seller_pdf_path: str | None = None,
) -> dict:
    """Construct the canonical collection_summary dict.

    Inputs
    ------
    `per_sort_summaries` is the list emitted by
    `run_phase2e_pipeline.run_multi_sort_scrape` (each entry has
    `sort_type`, `status`, `rows_inserted`, `raw_records_seen`,
    `quality_status`, `attempts?`, `error?`, `prod_summary?`).
    Single-sort runs pass a one-element list. Skip-scrape runs pass
    `None` (or empty) along with `skipped_scrape=True`.

    `sorts_attempted_plan` is the canonical sort plan when the run
    was multi-sort. Used when `per_sort_summaries` is None (skip-
    scrape) to emit a stable list shape.

    Output
    ------
    A flat dict matching the schema documented in the task brief —
    top-level fields used by the manifest extractor; nested per_sort
    block kept for the inspect CLI.

    Pure: never raises. Missing inputs become `null` / empty list.
    """
    summaries = list(per_sort_summaries or [])
    sort_types_seen: list[str] = [
        s.get("sort_type") for s in summaries
        if isinstance(s.get("sort_type"), str)
    ]
    # Order: the canonical plan when supplied (preserves declared
    # order even for sorts that never ran), then any sort_types in
    # summaries that the plan didn't declare.
    if sorts_attempted_plan:
        ordered_attempted: list[str] = []
        seen: set[str] = set()
        for st in sorts_attempted_plan:
            if isinstance(st, str) and st not in seen:
                ordered_attempted.append(st)
                seen.add(st)
        for st in sort_types_seen:
            if st not in seen:
                ordered_attempted.append(st)
                seen.add(st)
    else:
        ordered_attempted = list(dict.fromkeys(sort_types_seen))

    # Per-sort detail — keyed by sort_type.
    per_sort_detail: dict[str, dict] = {}
    succeeded: list[str] = []
    failed: list[str] = []
    blocked: list[str] = []
    attempts_by_sort: dict[str, int] = {}
    raw_seen_by_sort: dict[str, int] = {}
    rows_inserted_by_sort: dict[str, int] = {}
    quality_by_sort: dict[str, str | None] = {}
    retry_count_by_sort: dict[str, int] = {}
    blocked_by_sort: dict[str, bool] = {}

    # Pass-19E: split the blocked-status semantics. The legacy
    # `sorts_blocked_or_anti_bot` lumped real auth-wall events with
    # sort-control failures (the user's USEFUL_SCORE_DESC /
    # RECOMMENDED_DESC false_empty_state cases). We now keep
    # `blocked` only for entries with HARD auth evidence; everything
    # else goes into `sort_control_failures`.
    sort_control_failures: list[str] = []
    sort_control_failure_by_sort: dict[str, bool] = {}
    auth_evidence_by_sort: dict[str, bool] = {}
    # Reuse promotions: target sort failed but a peer captured a
    # response with this sortType. We rewrite ok/blocked/failed lists
    # at the end of the loop.
    reused_via_peer: list[str] = []

    for entry in summaries:
        st = entry.get("sort_type")
        if not isinstance(st, str):
            continue
        is_ok = _is_success_entry(entry)
        is_blocked = _is_blocked_entry(entry)
        has_auth = _has_auth_evidence_entry(entry)
        attempts = int(entry.get("attempts") or 1)
        raw_seen = int(entry.get("raw_records_seen") or 0)
        rows_inserted = int(entry.get("rows_inserted") or 0)
        quality = entry.get("quality_status")
        status = entry.get("status")
        retry_count = _retry_count_from_entry(entry)

        # Default-sort response reuse promotion: if this entry would
        # otherwise fail/block, but a peer attempt observed a response
        # with this sort_type, treat it as success (the data is on
        # disk via the peer's insertion).
        peer_observed = (
            _peer_observed_target_sort_count(
                sort_type=st, summaries=summaries,
            )
            if not is_ok else 0
        )
        promoted_via_reuse = (not is_ok) and peer_observed > 0 and not has_auth

        attempts_by_sort[st] = attempts
        raw_seen_by_sort[st] = raw_seen
        rows_inserted_by_sort[st] = rows_inserted
        quality_by_sort[st] = quality
        retry_count_by_sort[st] = retry_count
        # The blocked-or-anti-bot column is now AUTH-EVIDENCE-ONLY.
        # `blocked_by_sort` retains its broader (legacy) meaning for
        # backward compatibility with existing tests; the new column
        # is `auth_evidence_by_sort`.
        blocked_by_sort[st] = is_blocked
        auth_evidence_by_sort[st] = has_auth
        is_sort_control_failure = (
            (not is_ok)
            and (not has_auth)
            and not promoted_via_reuse
        )
        sort_control_failure_by_sort[st] = is_sort_control_failure

        # Final classification (post-reuse-promotion).
        if is_ok or promoted_via_reuse:
            succeeded.append(st)
            if promoted_via_reuse:
                reused_via_peer.append(st)
        else:
            failed.append(st)

        # Auth-evidence bucket — purified meaning.
        if has_auth:
            blocked.append(st)
        if is_sort_control_failure:
            sort_control_failures.append(st)

        per_sort_detail[st] = {
            "status": status,
            "quality_status": quality,
            "attempts": attempts,
            "raw_records_seen": raw_seen,
            "rows_inserted": rows_inserted,
            "retry_count": retry_count,
            # `anti_bot_or_blocked` retains legacy meaning (any block
            # status OR false_empty soft block). New consumers should
            # use `has_auth_evidence` to distinguish.
            "anti_bot_or_blocked": is_blocked,
            "has_auth_evidence": has_auth,
            "is_sort_control_failure": is_sort_control_failure,
            "promoted_via_default_sort_response_reuse": promoted_via_reuse,
            "peer_observed_count_for_this_sort": peer_observed,
            "error": entry.get("error"),
            # v2.4.4 — explicit success/failure reason. Audit string
            # so an operator reading collection_summary.json can see
            # WHY a sort was treated as success or failure without
            # cross-referencing other fields.
            "success_reason": (
                "success_reused:default_sort_response_reused"
                if promoted_via_reuse else _success_reason(entry)
            ),
            # Run-003 QA pass-5: per-sort recovery action history.
            "recovery_actions": list(entry.get("recovery_actions") or []),
            # Run-003 QA pass-7: auth-wall classification + diagnostic
            # artifact pointer.
            "auth_wall_subreason": entry.get("auth_wall_subreason"),
            "auth_wall_next_action_hint_ko": entry.get(
                "auth_wall_next_action_hint_ko",
            ),
            "diagnostic_artifact_path": entry.get(
                "diagnostic_artifact_path",
            ),
        }

    total_raw_seen = sum(raw_seen_by_sort.values())
    total_rows_inserted = sum(rows_inserted_by_sort.values())
    partial_success = (
        len(succeeded) > 0
        and len(succeeded) < len(ordered_attempted)
    ) if ordered_attempted else False

    # Skip-scrape runs surface as a stub sidecar so the inspect CLI
    # has SOMETHING to read; the manifest extractor will see empty
    # sorts lists and skip wiring those fields.
    if skipped_scrape:
        ordered_attempted = []
        succeeded = []
        failed = []
        sort_control_failures = []
        reused_via_peer = []
        partial_success = False

    if analysis_status not in ANALYSIS_STATUS_VALUES:
        raise ValueError(
            f"analysis_status must be one of {sorted(ANALYSIS_STATUS_VALUES)}, "
            f"got {analysis_status!r}"
        )

    return {
        "schema_version": COLLECTION_SUMMARY_SCHEMA_VERSION,
        "generated_at": datetime.now(timezone.utc).strftime(
            "%Y-%m-%dT%H:%M:%SZ",
        ),
        "product_url": product_url,
        "goodsNo": goods_no,
        "product_name": product_name,
        "corpus_mode": corpus_mode,
        "primary_sort": primary_sort,
        "skipped_scrape": bool(skipped_scrape),
        "collection_started_at": collection_started_at,
        "collection_completed_at": collection_completed_at,
        "sorts_attempted": ordered_attempted,
        "sorts_succeeded": succeeded,
        "sorts_failed": failed,
        # `sorts_blocked_or_anti_bot` retains its name for backward
        # compatibility but its meaning is now AUTH-EVIDENCE-ONLY:
        # only sorts with HARD evidence (401/403/429/captcha/
        # login_required/logged_out) appear here. Sort-control
        # failures (USEFUL_SCORE_DESC false_empty_state without auth
        # evidence) live in `sorts_with_sort_control_failure` below.
        "sorts_blocked_or_anti_bot": blocked,
        # Pass-19E: separate bucket for sort-control failures (no
        # auth evidence). These need connector-side recovery, not
        # re-login. The inspector reads BOTH buckets and prints
        # different Korean messages so operators don't get a false
        # "anti-bot" warning when the issue is a click problem.
        "sorts_with_sort_control_failure": sort_control_failures,
        # Pass-19E (B): sorts that were promoted from failure to
        # success because a peer attempt's review-tab wake-up
        # captured a response with the target sort_type. Operator-
        # informational; the data is on disk.
        "sorts_reused_via_default_response": reused_via_peer,
        "partial_success": partial_success,
        "attempts_by_sort": attempts_by_sort,
        "raw_records_seen_by_sort": raw_seen_by_sort,
        "rows_inserted_by_sort": rows_inserted_by_sort,
        "quality_by_sort": quality_by_sort,
        "retry_count_by_sort": retry_count_by_sort,
        "anti_bot_or_blocked_by_sort": blocked_by_sort,
        "auth_evidence_by_sort": auth_evidence_by_sort,
        "sort_control_failure_by_sort": sort_control_failure_by_sort,
        "total_raw_records_seen": total_raw_seen,
        "total_rows_inserted": total_rows_inserted,
        "review_count_available_after_merge": (
            int(review_count_available_after_merge)
            if review_count_available_after_merge is not None else None
        ),
        "review_count_analyzed": (
            int(review_count_analyzed)
            if review_count_analyzed is not None else None
        ),
        "per_sort": per_sort_detail,
        # Lifecycle fields (manifest 1.1) — analysis_status follows
        # the contract documented at the top of this module.
        "analysis_status": analysis_status,
        "completed_at": completed_at,
        "analysis_report_path": analysis_report_path,
        "seller_pdf_path": seller_pdf_path,
    }


def write_collection_summary(path: Path | str, summary: dict) -> Path:
    """Atomically write the collection summary to `path`.

    Creates parent directories as needed. Uses write-temp-then-
    rename so a partial sidecar never appears.
    """
    target = Path(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    tmp = target.with_suffix(target.suffix + ".tmp")
    payload = json.dumps(summary, indent=2, ensure_ascii=False)
    tmp.write_text(payload + "\n", encoding="utf-8")
    os.replace(tmp, target)
    return target


def update_collection_summary(
    path: Path | str,
    **updates: object,
) -> dict:
    """Read an existing sidecar, merge `updates`, write back atomically.

    Lifecycle helper — used to flip an initially-pending sidecar to
    `analysis_status="completed"` after analysis succeeds, without
    losing any per-sort field that the initial write recorded.

    Behavior:
      - Reads the existing JSON. Raises FileNotFoundError when no
        prior sidecar exists (caller must have written initial).
      - Validates `analysis_status` when present in `updates`.
      - Replaces only the keys named in `updates`; every other field
        passes through verbatim.
      - Atomic write (write-temp-then-rename) so the existing file
        is never partially overwritten — readers see either the old
        or the new content, never a torn JSON.

    Returns the merged dict.
    """
    target = Path(path)
    raw = target.read_text(encoding="utf-8")
    summary = json.loads(raw)
    if not isinstance(summary, dict):
        raise ValueError(
            f"collection_summary at {target} is not a JSON object"
        )
    if "analysis_status" in updates:
        new_status = updates["analysis_status"]
        if new_status not in ANALYSIS_STATUS_VALUES:
            raise ValueError(
                f"analysis_status must be one of "
                f"{sorted(ANALYSIS_STATUS_VALUES)}, got {new_status!r}"
            )
    summary.update(updates)
    write_collection_summary(target, summary)
    return summary


__all__ = [
    "COLLECTION_SUMMARY_SCHEMA_VERSION",
    "BLOCKING_STATUSES",
    "ANALYSIS_STATUS_PENDING",
    "ANALYSIS_STATUS_COMPLETED",
    "ANALYSIS_STATUS_FAILED",
    "ANALYSIS_STATUS_VALUES",
    "build_collection_summary",
    "write_collection_summary",
    "update_collection_summary",
]
