#!/usr/bin/env python3
"""Backfill the Brand-20 queue from historical batch_summary artifacts.

The Brand-20 queue (`ops/brand20_collection_queue.json`) was seeded
AFTER many `phase2e_pipeline`, `phase2e_retry`, `phase2e_pilot`,
`phase2e_proof`, `brand20_runner`, and `brand20_smoke` collection runs
had already produced `batch_summary.json` artifacts under
`data/collection_artifacts/`. Those historical runs match
`(goods_no, sort_type)` rows in the current queue but never flowed
through `apply_batch_summary`, so the dashboard still surfaces them
as `pending`.

This script is a one-shot catch-up tool:

  1. Walks an artifact root (default `data/collection_artifacts`) for
     every `batch_summary.json`.
  2. Extracts `(goods_no, sort_type)` per file via the same helper the
     live updater uses, drops pairs not in the queue or not in the
     canonical 5-sort taxonomy.
  3. Picks the best candidate per `(goods_no, sort_type)` by:
       a. classification rank
          (done > local_cap_partial > manual_required >
           retryable_429_partial > unknown_inconclusive)
       b. higher records_parsed (or raw_records_seen fallback)
       c. newer finished_at (or last_attempted_at / file mtime).
  4. Routes the chosen summary through `apply_batch_summary` so the
     same `_decide_status` precedence (cursor-429 > manual_review
     > done > inconclusive) is honored — guaranteeing the backfill
     stays consistent with live runs.

What this script does NOT do:
  - It does NOT run live collection. Live collection requires explicit
    per-turn operator authorization, and is launched only via
    `scripts/run_oy_collection_batch.py`.
  - It does NOT generate any report, PDF, or cardnews artifact.
  - It does NOT write to `data/voc_data.db`.
  - It does NOT mutate the queue file in `--dry-run` mode (the default).
    Only `--apply` writes the queue via atomic tmpfile+replace.

Usage (read-only preview, default):
    python3 scripts/backfill_brand20_queue_from_artifacts.py

Usage (write the queue):
    python3 scripts/backfill_brand20_queue_from_artifacts.py --apply

Usage (debug one SKU):
    python3 scripts/backfill_brand20_queue_from_artifacts.py \\
        --limit-goods-no A000000149135 --verbose
"""
from __future__ import annotations

import argparse
import json
import sys
from collections import Counter
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable


REPO = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO))

from src.voc.app.brand20_queue import (  # noqa: E402
    ALL_SORTS,
    Brand20Queue,
    QueueItem,
    _extract_product_fields,
    _extract_target,
    apply_batch_summary,
    load_queue,
    save_queue,
)


DEFAULT_QUEUE_PATH = REPO / "ops" / "brand20_collection_queue.json"
DEFAULT_ARTIFACT_ROOT = REPO / "data" / "collection_artifacts"

# Historical-backfill convention: signal sorts (RATING_ASC, RATING_DESC,
# USEFUL_SCORE_DESC, RECOMMENDED_DESC) are metadata-only and were
# intentionally capped at 50 records during the legacy pilot. A signal
# sort that hit this cap is `done` for backfill purposes — there is no
# operator value in re-running it because the metadata is captured.
#
# This threshold lives in the script, NOT in
# `src/voc/app/brand20_queue.py`. The runtime `_decide_status` still
# routes signal-sort `max_cap_reached` to `inconclusive`; aligning the
# runtime policy is a separate, future ticket. Until then the backfill
# applies the cap-done overlay locally (see
# `_apply_signal_sort_cap_overlay` below) so historical artifacts get
# the correct dashboard status without touching the runtime contract.
BRAND20_SIGNAL_SORT_DONE_THRESHOLD: int = 50

# Classification rank (higher = better). Mirrors the ticket's
# best-candidate selection rule: a clean `done` always beats a
# partial, a primary cap beats a 429 partial, etc.
CLASSIFICATION_RANK: dict[str, int] = {
    "done": 5,
    "local_cap_partial": 4,
    "manual_required": 3,
    "retryable_429_partial": 2,
    "unknown_inconclusive": 1,
}

# Auth / human-check / 403 keys that promote a summary to
# `manual_required` even when `retry_intent` isn't explicitly set.
# Each key, if present and truthy on either the top-level product
# block or the summary block, is sufficient.
MANUAL_REQUIRED_SIGNAL_KEYS: tuple[str, ...] = (
    "http_403_seen",
    "http_401_or_login_required_seen",
    "human_check_detected",
    "auth_error",
    "mid_stream_auth_break",
)


# ---------------------------------------------------------------------------
# Candidate record
# ---------------------------------------------------------------------------


@dataclass
class _Candidate:
    """A single batch_summary.json paired with its classification and
    sort-key fields. Kept as a plain dataclass so verbose tracing prints
    cleanly and tests can assert on the structured form."""

    path: Path
    goods_no: str
    sort_type: str
    classification: str
    fields: dict[str, Any]
    finished_at: str | None
    mtime_ns: int

    @property
    def records_parsed_effective(self) -> int:
        """records_parsed if non-null, else raw_records_seen, else 0.
        Used as the within-class tie-break per the ticket spec."""
        rp = self.fields.get("records_parsed")
        if rp is not None:
            try:
                return int(rp)
            except (TypeError, ValueError):
                pass
        rr = self.fields.get("raw_records_seen")
        if rr is not None:
            try:
                return int(rr)
            except (TypeError, ValueError):
                pass
        return 0


# ---------------------------------------------------------------------------
# Classification
# ---------------------------------------------------------------------------


def _max_cap_observed(
    summary: dict[str, Any],
    fields: dict[str, Any],
) -> bool:
    """True when this summary represents a local-cap-stopped run.

    Mirrors the heuristic in `apply_batch_summary`: the connector
    either sets the top-level `products[0].status="max_cap_reached"`
    or surfaces `quality_status="max_cap_reached"`. `_extract_product_fields`
    flattens both into `fields` for us.
    """
    return (
        fields.get("final_status") == "max_cap_reached"
        or fields.get("status") == "max_cap_reached"
        or fields.get("quality_status") == "max_cap_reached"
        or bool(summary.get("max_cap_reached"))
    )


def _has_manual_signal(
    top: dict[str, Any],
    summary: dict[str, Any],
    fields: dict[str, Any],
) -> bool:
    """True iff any auth / captcha / 403 signal is set anywhere in the
    summary, OR the connector explicitly emitted
    `retry_intent="manual_review_required"`.
    """
    if fields.get("retry_intent") == "manual_review_required":
        return True
    for key in MANUAL_REQUIRED_SIGNAL_KEYS:
        if bool(top.get(key)):
            return True
        if bool(summary.get(key)):
            return True
    # Auth-required final_status surfaces on auth-wall runs (cf.
    # brand20_batch_manual_review.json fixture).
    if fields.get("final_status") in {"auth_required", "login_required"}:
        return True
    return False


def classify_candidate(batch_summary: dict[str, Any]) -> str:
    """Return the candidate's class in {done, local_cap_partial,
    manual_required, retryable_429_partial, unknown_inconclusive}.

    Application order (first match wins) — matches the ticket spec
    verbatim. Note this ordering is DIFFERENT from
    `_decide_status` precedence: the classifier ranks "how well did
    the corpus advance", whereas `_decide_status` ranks "what queue
    state should this row be parked in". They agree on the final
    queue state once `apply_batch_summary` runs.
    """
    products = batch_summary.get("products") or []
    top: dict[str, Any] = {}
    summary: dict[str, Any] = {}
    if products and isinstance(products, list) and isinstance(products[0], dict):
        top = products[0]
        s = top.get("summary")
        if isinstance(s, dict):
            summary = s
    fields = _extract_product_fields(batch_summary)

    final_status = fields.get("final_status")
    quality_status = fields.get("quality_status")
    cursor_rate_limited = bool(
        fields.get("cursor_api_rate_limited")
        or summary.get("cursor_api_rate_limited")
        or top.get("cursor_api_rate_limited")
    )
    cursor_silenced = bool(
        fields.get("cursor_api_silenced")
        or summary.get("cursor_api_silenced")
        or top.get("cursor_api_silenced")
    )
    incomplete = bool(
        summary.get("incomplete_collection")
        or top.get("incomplete_collection")
    )
    pagination_exhausted = bool(
        summary.get("pagination_exhausted")
        or top.get("pagination_exhausted")
    )
    last_has_next = (
        summary.get("last_observed_has_next")
        if "last_observed_has_next" in summary
        else top.get("last_observed_has_next")
    )

    # 1) done — clean terminal AND no 429 signals AND not incomplete
    #    AND (has_next False OR pagination_exhausted True).
    if (
        final_status in {"ok", "complete"}
        and quality_status in {None, "ok"}
        and not cursor_rate_limited
        and not cursor_silenced
        and not incomplete
        and (last_has_next is False or pagination_exhausted)
    ):
        return "done"

    # 2) local_cap_partial — connector hit the configured per-product
    #    cap. final_status surfaces as `max_cap_reached` (the
    #    connector's terminal). Distinct from `done` because more
    #    pages exist server-side; the operator may re-run with a
    #    larger cap.
    if _max_cap_observed(summary, fields) and final_status in {
        "ok", "complete", "max_cap_reached",
    }:
        return "local_cap_partial"

    # 3) manual_required — auth wall / captcha / 403 / human-check.
    if _has_manual_signal(top, summary, fields):
        return "manual_required"

    # 4) retryable_429_partial — cursor API was rate-limited or
    #    silenced, OR the connector explicitly emitted
    #    retry_intent=retry_after_cooldown, OR the run halted
    #    mid-pagination (incomplete + still has_next).
    if (
        cursor_rate_limited
        or cursor_silenced
        or fields.get("retry_intent") == "retry_after_cooldown"
        or (incomplete and last_has_next is True)
    ):
        return "retryable_429_partial"

    return "unknown_inconclusive"


# ---------------------------------------------------------------------------
# Scanner
# ---------------------------------------------------------------------------


def _iter_batch_summaries(
    artifact_root: Path,
    *,
    verbose: bool = False,
) -> Iterable[tuple[Path, dict[str, Any]]]:
    """Yield (path, payload) for every readable batch_summary.json
    under `artifact_root`. Malformed / empty files are skipped with a
    stderr warning and the scan continues.
    """
    if not artifact_root.is_dir():
        print(
            f"warning: artifact root not a directory: {artifact_root}",
            file=sys.stderr,
        )
        return
    for path in sorted(artifact_root.rglob("batch_summary.json")):
        try:
            text = path.read_text(encoding="utf-8")
        except OSError as e:
            print(
                f"warning: cannot read {path}: {e}",
                file=sys.stderr,
            )
            continue
        if not text.strip():
            print(
                f"warning: empty batch_summary skipped: {path}",
                file=sys.stderr,
            )
            continue
        try:
            payload = json.loads(text)
        except json.JSONDecodeError as e:
            print(
                f"warning: malformed JSON skipped: {path}: {e}",
                file=sys.stderr,
            )
            continue
        if not isinstance(payload, dict):
            print(
                f"warning: top-level JSON not an object: {path}",
                file=sys.stderr,
            )
            continue
        if verbose:
            print(f"  scanned: {path}", file=sys.stderr)
        yield path, payload


def _extract_finished_at(
    payload: dict[str, Any],
    fields: dict[str, Any],
) -> str | None:
    """Best-effort ISO timestamp for tie-breaking. Prefers the
    top-level `finished_at` (set on every batch_summary), then falls
    back to `products[0].finished_at` and the connector summary's
    `finished_at`.
    """
    if payload.get("finished_at"):
        return str(payload["finished_at"])
    products = payload.get("products") or []
    if products and isinstance(products, list) and isinstance(products[0], dict):
        first = products[0]
        if first.get("finished_at"):
            return str(first["finished_at"])
        summary = first.get("summary")
        if isinstance(summary, dict) and summary.get("finished_at"):
            return str(summary["finished_at"])
    if fields.get("last_attempted_at"):
        return str(fields["last_attempted_at"])
    return None


def collect_candidates(
    artifact_root: Path,
    queue: Brand20Queue,
    *,
    verbose: bool = False,
    limit_goods_no: str | None = None,
) -> dict[tuple[str, str], list[_Candidate]]:
    """Return `(goods_no, sort_type) -> [candidate, ...]`.

    Drops pairs not in the queue or not in the canonical 5-sort
    taxonomy. Malformed files are skipped with a stderr warning.
    """
    known_pairs: set[tuple[str, str]] = {
        (it.goods_no, it.sort_type) for it in queue.items
    }
    sort_taxonomy: set[str] = set(ALL_SORTS)

    out: dict[tuple[str, str], list[_Candidate]] = {}
    for path, payload in _iter_batch_summaries(artifact_root, verbose=verbose):
        try:
            goods_no, sort_type = _extract_target(payload)
        except KeyError:
            if verbose:
                print(
                    f"  skip (no goods_no/sort_type): {path}",
                    file=sys.stderr,
                )
            continue
        if sort_type not in sort_taxonomy:
            if verbose:
                print(
                    f"  skip (sort_type {sort_type!r} not in taxonomy): {path}",
                    file=sys.stderr,
                )
            continue
        if (goods_no, sort_type) not in known_pairs:
            if verbose:
                print(
                    f"  skip ({goods_no}/{sort_type} not in queue): {path}",
                    file=sys.stderr,
                )
            continue
        if limit_goods_no and goods_no != limit_goods_no:
            continue

        fields = _extract_product_fields(payload)
        classification = classify_candidate(payload)
        finished_at = _extract_finished_at(payload, fields)
        try:
            mtime_ns = path.stat().st_mtime_ns
        except OSError:
            mtime_ns = 0
        cand = _Candidate(
            path=path,
            goods_no=goods_no,
            sort_type=sort_type,
            classification=classification,
            fields=fields,
            finished_at=finished_at,
            mtime_ns=mtime_ns,
        )
        out.setdefault((goods_no, sort_type), []).append(cand)
        if verbose:
            print(
                f"  candidate: {goods_no}/{sort_type} "
                f"class={classification} "
                f"records_parsed={cand.records_parsed_effective} "
                f"finished_at={finished_at}",
                file=sys.stderr,
            )
    return out


def pick_best(
    candidates: list[_Candidate],
    *,
    verbose: bool = False,
) -> _Candidate:
    """Apply the three-tier ordering: classification rank, then
    records_parsed, then finished_at (newer wins) and finally file
    mtime. Caller guarantees `candidates` is non-empty."""
    def key(c: _Candidate) -> tuple[int, int, str, int]:
        return (
            CLASSIFICATION_RANK.get(c.classification, 0),
            c.records_parsed_effective,
            # `finished_at` is an ISO 8601 string; lexicographic sort
            # matches chronological sort for the YYYY-MM-DDT… shape
            # the connector emits. Empty string sorts first so files
            # with no finished_at lose tie-breaks.
            c.finished_at or "",
            c.mtime_ns,
        )

    chosen = max(candidates, key=key)
    if verbose:
        print(
            f"  picked: {chosen.goods_no}/{chosen.sort_type} "
            f"class={chosen.classification} "
            f"records_parsed={chosen.records_parsed_effective} "
            f"finished_at={chosen.finished_at} "
            f"from={chosen.path}",
            file=sys.stderr,
        )
    return chosen


# ---------------------------------------------------------------------------
# Signal-sort cap overlay (backfill-only)
# ---------------------------------------------------------------------------


def _apply_signal_sort_cap_overlay(
    item: QueueItem,
    *,
    batch_summary: dict[str, Any],
    classification: str,
) -> bool:
    """Post-mutate `item` IF the signal-sort-at-cap criteria fire.

    Backfill-only deviation from the runtime `_decide_status` contract:
    a signal sort whose historical batch_summary recorded
    `records_parsed >= BRAND20_SIGNAL_SORT_DONE_THRESHOLD` (50) AND a
    clean / cap-stopped terminal is treated as `done` here, because
    Brand-20 signal sorts are metadata-only and were intentionally
    capped at 50 in the legacy pilot. The runtime policy still routes
    such rows to `inconclusive`; that asymmetry is intentional and
    scoped to historical artifacts only. A separate, later ticket may
    align the runtime policy if the operator decides.

    Returns True if the overlay fired (item was bumped to `done`),
    False otherwise. Caller can use this for verbose / counter
    reporting.

    Behaviour:
      - target_type != "signal" → no-op.
      - records_parsed < 50      → no-op.
      - classification not in {done, local_cap_partial} → no-op.
        (A 429 partial above 50 records is still ratelimited; the
        operator may want to re-run. Manual-required stays manual.)
      - else: status="done", clear retry/operator_note slots so the
        row presents as a clean terminal in the dashboard.

    The check uses the chosen batch_summary's records_parsed (with
    raw_records_seen fallback) — not `item.records_parsed_last` —
    because `apply_batch_summary` may not have populated the latter on
    every code path; reading from the summary is the canonical signal.
    """
    if item.target_type != "signal":
        return False
    if classification not in {"done", "local_cap_partial"}:
        return False

    fields = _extract_product_fields(batch_summary)
    rp = fields.get("records_parsed")
    rr = fields.get("raw_records_seen")
    parsed = 0
    if rp is not None:
        try:
            parsed = int(rp)
        except (TypeError, ValueError):
            parsed = 0
    if parsed == 0 and rr is not None:
        try:
            parsed = int(rr)
        except (TypeError, ValueError):
            parsed = 0
    if parsed < BRAND20_SIGNAL_SORT_DONE_THRESHOLD:
        return False

    final_status = fields.get("final_status")
    quality_status = fields.get("quality_status")
    # Allowable OK-class terminals. `max_cap_reached` is the cap
    # terminal; `ok` / `complete` cover the "exactly 50 reviews
    # existed" corner case (the corpus ran out before the cap).
    if final_status not in {"ok", "complete", "max_cap_reached"}:
        return False
    if quality_status not in {None, "ok", "max_cap_reached"}:
        return False

    # All criteria satisfied — bump to done. Clear retry/operator
    # slots so the row presents cleanly in the dashboard. We do NOT
    # touch attempts / last_run_id / last_attempt_at / records_parsed_last;
    # those are run-history bookkeeping that `apply_batch_summary`
    # already populated correctly.
    item.status = "done"
    item.checkpoint_reason = None
    item.operator_note = None
    item.next_run_after = None
    return True


# ---------------------------------------------------------------------------
# Render
# ---------------------------------------------------------------------------


def _render_table(rows: list[dict[str, Any]]) -> str:
    """Render a fixed-column ASCII table. Order matches the ticket spec:
    goods_no | product_name | sort_type | current_status |
    proposed_status | classification | batch_summary path |
    records_parsed.
    """
    headers = [
        "goods_no", "product_name", "sort_type",
        "current_status", "proposed_status",
        "classification", "batch_summary", "records_parsed",
    ]
    # Column widths sized to fit content (cap product_name and path
    # so absurdly long values don't blow the layout out).
    def shorten(s: str, cap: int) -> str:
        if len(s) <= cap:
            return s
        return s[: cap - 1] + "…"

    cooked: list[list[str]] = []
    for r in rows:
        cooked.append([
            str(r["goods_no"]),
            shorten(str(r["product_name"]), 30),
            str(r["sort_type"]),
            str(r["current_status"]),
            str(r["proposed_status"]),
            str(r["classification"]),
            shorten(str(r["batch_summary"]), 70),
            str(r["records_parsed"]),
        ])
    widths = [len(h) for h in headers]
    for line in cooked:
        for i, cell in enumerate(line):
            widths[i] = max(widths[i], len(cell))

    def fmt(line: list[str]) -> str:
        return "  ".join(c.ljust(widths[i]) for i, c in enumerate(line))

    sep = "  ".join("-" * w for w in widths)
    out_lines = [fmt(headers), sep]
    out_lines.extend(fmt(line) for line in cooked)
    return "\n".join(out_lines)


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------


def _parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        prog="backfill_brand20_queue_from_artifacts",
        description=(
            "Scan data/collection_artifacts for historical batch_summary "
            "artifacts and propose (or apply) Brand-20 queue updates. "
            "Does NOT trigger collection or report generation."
        ),
    )
    parser.add_argument(
        "--artifact-root", type=Path, default=DEFAULT_ARTIFACT_ROOT,
        help=(
            "Root directory walked for batch_summary.json files. "
            f"Default: {DEFAULT_ARTIFACT_ROOT.relative_to(REPO)}"
        ),
    )
    parser.add_argument(
        "--queue", type=Path, default=DEFAULT_QUEUE_PATH,
        help=(
            "Path to the Brand-20 queue JSON. "
            f"Default: {DEFAULT_QUEUE_PATH.relative_to(REPO)}"
        ),
    )
    parser.add_argument(
        "--apply", action="store_true",
        help=(
            "Apply the proposed updates to the queue file. "
            "Default is dry-run (no mutation)."
        ),
    )
    parser.add_argument(
        "--limit-goods-no", default=None,
        help="Filter scanning + apply to a single goods_no (debug aid).",
    )
    parser.add_argument(
        "--verbose", action="store_true",
        help="Print per-candidate scoring decisions to stderr.",
    )
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = _parse_args(argv)

    if not args.queue.is_file():
        print(
            f"failed_check: queue file not found: {args.queue}",
            file=sys.stderr,
        )
        print(
            "required_action: pass --queue <existing file> "
            "or seed ops/brand20_collection_queue.json first.",
            file=sys.stderr,
        )
        return 2

    queue: Brand20Queue = load_queue(args.queue)
    by_pair = collect_candidates(
        args.artifact_root,
        queue,
        verbose=args.verbose,
        limit_goods_no=args.limit_goods_no,
    )

    # Resolve best candidate per pair and build the proposed-transition
    # table. We compute the proposed status by running
    # `apply_batch_summary` against an in-memory deepcopy of the queue;
    # the real queue is only mutated under --apply.
    chosen: list[tuple[QueueItem, _Candidate, str, str]] = []
    # ordering: primary first then signals, then goods_no
    sort_index = {s: i for i, s in enumerate(ALL_SORTS)}
    pairs_sorted = sorted(
        by_pair.keys(),
        key=lambda p: (sort_index.get(p[1], 99), p[0]),
    )
    # Build a parallel preview queue so the dry-run accurately mirrors
    # the post-apply state without touching the on-disk queue.
    preview = Brand20Queue.model_validate(queue.model_dump(by_alias=True))
    for pair in pairs_sorted:
        cands = by_pair[pair]
        best = pick_best(cands, verbose=args.verbose)
        item_before = queue.find(*pair)
        if item_before is None:
            # Defensive: collect_candidates already drops unknown pairs.
            continue
        prior_status = item_before.status
        # Apply against the preview queue to compute the resulting
        # status. This re-uses the canonical _decide_status precedence.
        try:
            preview_payload = json.loads(best.path.read_text(encoding="utf-8"))
            updated = apply_batch_summary(preview, preview_payload)
        except KeyError:
            # Should not happen — collect_candidates filtered to known
            # pairs — but stay defensive.
            continue
        # Backfill-only overlay: a signal sort that hit the 50-record
        # legacy cap is `done` for our purposes, not `inconclusive`.
        # See `_apply_signal_sort_cap_overlay` for the rationale.
        _apply_signal_sort_cap_overlay(
            updated,
            batch_summary=preview_payload,
            classification=best.classification,
        )
        chosen.append((item_before, best, prior_status, updated.status))

    rows: list[dict[str, Any]] = []
    proposed_counter: Counter[str] = Counter()
    class_counter: Counter[str] = Counter()
    advanced = 0
    for item_before, best, prior_status, proposed_status in chosen:
        rows.append({
            "goods_no": item_before.goods_no,
            "product_name": item_before.product_name,
            "sort_type": item_before.sort_type,
            "current_status": prior_status,
            "proposed_status": proposed_status,
            "classification": best.classification,
            "batch_summary": str(best.path),
            "records_parsed": best.records_parsed_effective,
        })
        proposed_counter[proposed_status] += 1
        class_counter[best.classification] += 1
        if prior_status != proposed_status:
            advanced += 1

    mode_label = "APPLY" if args.apply else "DRY-RUN"
    print(f"== Brand-20 historical backfill ({mode_label}) ==")
    print(f"artifact_root: {args.artifact_root}")
    print(f"queue:         {args.queue}")
    print(f"matched pairs: {len(chosen)}")
    print()
    if rows:
        print(_render_table(rows))
    else:
        print("(no matching candidates found)")
    print()
    print(f"would_advance: {advanced} rows")
    print("by_classification:")
    for cls, n in sorted(class_counter.items(), key=lambda kv: -kv[1]):
        print(f"  {cls:24s} {n}")
    print("by_proposed_status:")
    for st, n in sorted(proposed_counter.items(), key=lambda kv: -kv[1]):
        print(f"  {st:24s} {n}")

    if not args.apply:
        print()
        print("(dry-run; queue file NOT written. Re-run with --apply to commit.)")
        return 0

    # Apply mode: re-run apply_batch_summary against the REAL queue,
    # then atomically persist. We do a second pass rather than re-using
    # the preview queue so the real queue's pre-apply state is preserved
    # in case we need to abort on an unexpected error.
    for item_before, best, _, _ in chosen:
        try:
            applied_payload = json.loads(best.path.read_text(encoding="utf-8"))
            applied_item = apply_batch_summary(queue, applied_payload)
        except KeyError as e:
            print(
                f"failed_check: apply rejected for "
                f"{item_before.goods_no}/{item_before.sort_type}: {e}",
                file=sys.stderr,
            )
            return 3
        # Re-run the same overlay against the real queue so the persisted
        # file matches what the dry-run table previewed. See
        # `_apply_signal_sort_cap_overlay` for the rationale (backfill-
        # only; runtime contract intact).
        _apply_signal_sort_cap_overlay(
            applied_item,
            batch_summary=applied_payload,
            classification=best.classification,
        )
    save_queue(args.queue, queue)
    print()
    print(f"wrote: {args.queue}")
    # Print post-apply dashboard counts for operator confirmation.
    post_counts: Counter[str] = Counter(it.status for it in queue.items)
    print("post-apply status counts:")
    for st in (
        "pending", "ready", "running",
        "retry_after_cooldown", "manual_checkpoint",
        "done", "inconclusive",
    ):
        print(f"  {st:24s} {post_counts.get(st, 0)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
