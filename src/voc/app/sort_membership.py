"""Multi-sort membership tracking — sidecar merge + DB apply.

Background
----------
The Phase 2E multi-sort plan runs one primary scrape (DATETIME_DESC) plus
several signal-sort top-N probes. Each per-sort scrape persists rows into
phase1_reviews via INSERT OR IGNORE, which means only the FIRST sort to
surface a given review_id stamps `oy_sort_type` / `oy_sort_role` on the
row. If the same review later appears in a signal sort, that membership
is lost.

This module recovers the lost memberships by reading per-sort sidecar
files (one per sort, listing the review_ids the connector observed —
plus their per-sort rank) and applying an additive merge to
phase1_reviews.raw_metadata_json. The merge is:

  - additive — never removes existing fields
  - idempotent — rerunning with the same sidecars doesn't duplicate
    sort entries; the lists are stored sorted and deduped, and ranks
    only ever improve (smaller is better)
  - non-destructive to the row's content fields (text, rating, date,
    source_*); only raw_metadata_json is updated

Per-row fields written (all owned by this module):
  - oy_observed_sort_types: sorted list of every sort that observed the row
  - oy_signal_sort_types:   sorted list of signal-role sorts only
  - oy_is_primary_corpus:   True iff DATETIME_DESC is in observed sorts
  - oy_sort_ranks:          {sort_type: rank | null}
                            1-based rank within the sort's result list when
                            available; null when the sidecar didn't carry
                            rank info (legacy `review_ids` format).
                            Smaller rank = stronger evidence.

Sidecar JSON shapes
-------------------
New (rank-aware) format:
    {
      "goodsNo": "A0001",
      "sort_type": "RATING_ASC",
      "role": "signal",
      "items": [
        {"review_id": "abc...", "rank": 1},
        {"review_id": "def...", "rank": 2},
        ...
      ]
    }

Legacy format (still readable for backward compat with on-disk artifacts):
    {
      "goodsNo": "A0001",
      "sort_type": "RATING_ASC",
      "role": "signal",
      "review_ids": ["abc...", "def...", ...]
    }
Legacy entries are merged with rank=None — we don't fabricate ranks from
list position, since the contract is "rank is null when unavailable."

Out of scope
------------
- Detector / report logic — unchanged.
- Filtering analysis corpus — orchestrator still filters
  fetch_reviews to oy_sort_type == DATETIME_DESC. This module only
  enriches existing rows; it does NOT change which rows are corpus.
- PDF / report rendering — rank is exposed in raw_metadata for future
  evidence selection but no report-level consumer is added in this PR.
"""

from __future__ import annotations

import json
import logging
import sqlite3
from collections.abc import Iterable
from dataclasses import dataclass, field
from pathlib import Path

logger = logging.getLogger(__name__)

# Mirrors `_SORT_ROLE_BY_SORT_TYPE` in the connector module — duplicated
# here (not imported) so this module has zero connector dependency and
# can be exercised by tests without loading playwright/CDP code.
SORT_ROLE_BY_SORT_TYPE: dict[str, str] = {
    "DATETIME_DESC":     "primary",
    "RATING_ASC":        "signal",
    "RATING_DESC":       "signal",
    "USEFUL_SCORE_DESC": "signal",
    "RECOMMENDED_DESC":  "signal",
}
PRIMARY_SORT_TYPE: str = "DATETIME_DESC"


def _merge_rank(existing: int | None, new: int | None) -> int | None:
    """Combine two rank observations under the "min wins, non-null wins" rule.

    Truth table:
      None,  None  → None
      None,  k     → k
      k,     None  → k     (don't downgrade a known rank to null)
      a,     b     → min(a, b)   (smaller rank = better evidence)

    This is the conflict-resolution rule for both the same sidecar
    (duplicate review_id within one sort, e.g., due to retry pagination)
    AND across sidecars (re-runs accumulating membership over time).
    """
    if existing is None:
        return new
    if new is None:
        return existing
    return min(existing, new)


@dataclass
class ReviewMembership:
    """Per-review accumulated sort memberships across one merge pass.

    `observed` maps each sort_type the review appeared under to the best
    (smallest) rank seen so far. `None` means "we know it appeared but
    don't have a rank for it" (legacy sidecar). `add_sort` is idempotent
    on duplicate (sort_type, rank) input and applies the min-rank rule
    when the same sort_type is added a second time with a different rank.
    """
    review_id: str
    observed: dict[str, int | None] = field(default_factory=dict)

    def add_sort(self, sort_type: str, rank: int | None = None) -> None:
        if sort_type in self.observed:
            self.observed[sort_type] = _merge_rank(
                self.observed[sort_type], rank,
            )
        else:
            self.observed[sort_type] = rank

    @property
    def observed_sorted(self) -> list[str]:
        return sorted(self.observed.keys())

    @property
    def signal_sorts(self) -> list[str]:
        return sorted(
            s for s in self.observed
            if SORT_ROLE_BY_SORT_TYPE.get(s) == "signal"
        )

    @property
    def is_primary_corpus(self) -> bool:
        return PRIMARY_SORT_TYPE in self.observed

    @property
    def ranks(self) -> dict[str, int | None]:
        """Snapshot of {sort_type: rank | None} for serialization."""
        return dict(self.observed)


def _coerce_rank(raw: object) -> int | None:
    """Accept int, None, or numeric string; reject everything else.

    OY rank ordinals are positive integers, but we tolerate None / missing
    so legacy sidecars (no rank info) round-trip cleanly. Bad shapes log
    a warning and become None — preferable to crashing the merge over a
    typo in one item.
    """
    if raw is None:
        return None
    if isinstance(raw, bool):
        # bool is a subclass of int in Python; reject explicitly so
        # accidental True/False values don't become rank=1/0.
        return None
    if isinstance(raw, int):
        return raw if raw > 0 else None
    return None


def merge_sidecars(
    sidecar_paths: Iterable[Path],
) -> dict[str, ReviewMembership]:
    """Read per-sort sidecar JSONs and merge into a review_id → membership map.

    Supports BOTH the rank-aware `items` format and the legacy
    `review_ids` format on the same input — a directory of mixed-format
    sidecars merges cleanly. New sidecars carry explicit ranks; legacy
    entries contribute rank=None (we don't fabricate).

    Bad / missing files are logged and skipped; one corrupt sidecar does
    not abort the merge. Sort-type values absent from
    SORT_ROLE_BY_SORT_TYPE are still recorded in `observed` (so future
    sort-type additions don't silently drop) but cannot be classified
    into primary / signal until the role mapping is updated.
    """
    out: dict[str, ReviewMembership] = {}
    for path in sidecar_paths:
        try:
            payload = json.loads(Path(path).read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            logger.warning(
                "Skipping unreadable sort-membership sidecar %s: %s", path, exc,
            )
            continue
        sort_type = payload.get("sort_type")
        if not isinstance(sort_type, str):
            logger.warning(
                "Skipping sidecar %s: missing/invalid sort_type (%r)",
                path, sort_type,
            )
            continue

        # Prefer the new `items` format when present; fall back to
        # legacy `review_ids` for backward compat with sidecars on disk
        # written by pre-rank-tracking versions of the batch runner.
        items_field = payload.get("items")
        legacy_field = payload.get("review_ids")
        if isinstance(items_field, list):
            for item in items_field:
                if not isinstance(item, dict):
                    continue
                rid = item.get("review_id")
                if not isinstance(rid, str) or not rid:
                    continue
                rank = _coerce_rank(item.get("rank"))
                membership = out.setdefault(
                    rid, ReviewMembership(review_id=rid),
                )
                membership.add_sort(sort_type, rank)
        elif isinstance(legacy_field, list):
            for rid in legacy_field:
                if not isinstance(rid, str) or not rid:
                    continue
                membership = out.setdefault(
                    rid, ReviewMembership(review_id=rid),
                )
                # Legacy: rank unavailable → record None.
                membership.add_sort(sort_type, None)
        else:
            logger.warning(
                "Skipping sidecar %s: neither `items` nor `review_ids` "
                "is a list (items=%s, review_ids=%s)",
                path, type(items_field).__name__, type(legacy_field).__name__,
            )
            continue
    return out


# Reserved keys this module owns inside raw_metadata_json. Any other
# pre-existing keys are passed through unchanged. Documented here so a
# future refactor can audit what raw_metadata fields the membership pass
# is allowed to touch.
_OWNED_KEYS: tuple[str, ...] = (
    "oy_observed_sort_types",
    "oy_signal_sort_types",
    "oy_is_primary_corpus",
    "oy_sort_ranks",
)


def _merge_into_metadata(
    existing_meta: dict,
    membership: ReviewMembership,
) -> dict:
    """Return a new metadata dict with this module's owned keys updated.

    Idempotency: pre-existing values for the owned keys are unioned with
    the new membership instead of overwritten — re-running on the same
    sidecars yields the same lists and ranks, and re-running with NEW
    sidecars only adds new sort_types or improves existing ranks.

    Rank resolution per sort:
      - prior null + new value → take value (improvement)
      - prior value + new null → keep value (don't downgrade)
      - prior value + new value → take min (smaller is better evidence)

    All non-owned existing keys (oy_sort_type, oy_sort_role, skin_type,
    nicknames, etc.) are passed through verbatim.
    """
    merged = dict(existing_meta)  # copy; do not mutate caller's dict

    # ---- observed / signal / is_primary (set-style merge) ----
    prior_observed = merged.get("oy_observed_sort_types") or []
    if not isinstance(prior_observed, list):
        prior_observed = []
    observed_union = sorted(set(prior_observed) | set(membership.observed.keys()))

    signal_union = sorted(
        s for s in observed_union
        if SORT_ROLE_BY_SORT_TYPE.get(s) == "signal"
    )
    is_primary = PRIMARY_SORT_TYPE in observed_union

    # ---- ranks (per-sort min, null-tolerant merge) ----
    prior_ranks = merged.get("oy_sort_ranks") or {}
    if not isinstance(prior_ranks, dict):
        prior_ranks = {}
    new_ranks: dict[str, int | None] = {}
    # Sort keys for deterministic JSON serialization (test stability +
    # so the no-op short-circuit in apply_to_db can compare dicts cleanly).
    for sort_type in observed_union:
        existing_rank = prior_ranks.get(sort_type)
        # Defensive: accept only int / None from existing JSON.
        if not (existing_rank is None or isinstance(existing_rank, int)):
            existing_rank = None
        if isinstance(existing_rank, bool):
            # bool subclasses int; treat as missing.
            existing_rank = None
        new_rank = membership.observed.get(sort_type)  # may be missing → None
        new_ranks[sort_type] = _merge_rank(existing_rank, new_rank)

    merged["oy_observed_sort_types"] = observed_union
    merged["oy_signal_sort_types"] = signal_union
    merged["oy_is_primary_corpus"] = is_primary
    merged["oy_sort_ranks"] = new_ranks
    return merged


@dataclass
class ApplyStats:
    """Diagnostic counts from one apply_to_db pass."""
    rows_examined: int = 0
    rows_updated: int = 0
    rows_no_op: int = 0  # row had identical owned keys already; skipped UPDATE
    rows_missing_in_db: int = 0  # sidecar had a review_id absent from DB


def apply_to_db(
    db_path: str | Path,
    *,
    goods_no: str,
    membership: dict[str, ReviewMembership],
) -> ApplyStats:
    """Update phase1_reviews.raw_metadata_json for the given goodsNo.

    For each review_id in `membership`:
      - SELECT the existing raw_metadata_json (skip if row missing)
      - merge in the four owned keys (additive — see _merge_into_metadata)
      - UPDATE only the raw_metadata_json column

    DOES NOT touch text, rating_normalized, review_date, source_*,
    review_id, product_external_id, or any other column. The contract is
    "enrich metadata only".

    Idempotent: a second invocation with the same membership produces
    no DB changes (the no-op count rises, rows_updated stays 0).
    """
    stats = ApplyStats()
    if not membership:
        return stats

    con = sqlite3.connect(str(db_path))
    try:
        cur = con.cursor()
        for review_id, mem in membership.items():
            cur.execute(
                "SELECT raw_metadata_json FROM phase1_reviews "
                "WHERE review_id = ? AND product_external_id = ?",
                (review_id, goods_no),
            )
            row = cur.fetchone()
            stats.rows_examined += 1
            if row is None:
                stats.rows_missing_in_db += 1
                continue
            existing_json = row[0] or "{}"
            try:
                existing_meta = json.loads(existing_json)
                if not isinstance(existing_meta, dict):
                    existing_meta = {}
            except json.JSONDecodeError:
                logger.warning(
                    "raw_metadata_json for review_id=%s is not valid JSON; "
                    "treating as empty for membership merge",
                    review_id,
                )
                existing_meta = {}

            new_meta = _merge_into_metadata(existing_meta, mem)
            if new_meta == existing_meta:
                stats.rows_no_op += 1
                continue
            cur.execute(
                "UPDATE phase1_reviews SET raw_metadata_json = ? "
                "WHERE review_id = ? AND product_external_id = ?",
                (json.dumps(new_meta, ensure_ascii=False),
                 review_id, goods_no),
            )
            stats.rows_updated += 1
        con.commit()
    finally:
        con.close()
    return stats


def find_sidecars(batch_dirs: Iterable[Path], goods_no: str) -> list[Path]:
    """Locate sort-membership sidecars across one product's per-sort batch dirs.

    Convention: `<batch_dir>/<goodsNo>_<sortType>_review_ids.json`. We
    look for any matching filename and return the paths in a stable
    order; missing or non-existent batch dirs are silently skipped (a
    per-sort failure may have produced no sidecar — that's fine).
    """
    found: list[Path] = []
    for d in batch_dirs:
        d = Path(d)
        if not d.is_dir():
            continue
        for p in sorted(d.glob(f"{goods_no}_*_review_ids.json")):
            found.append(p)
    return found
