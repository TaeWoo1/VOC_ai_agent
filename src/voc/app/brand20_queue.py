"""Brand-20 OY collection queue / checkpoint / coverage state.

This module is a pure data + state-transition layer for the Brand-20
OliveYoung review collection campaign. It DOES NOT generate any
report, PDF, or cardnews artifact. Report / PDF / cardnews generation
is a separate operator action — coverage must be inspected (via
`scripts/inspect_brand20_collection_status.py`) BEFORE triggering any
analysis/publishing pipeline.

This module does NOT run live collection. Live collection requires
explicit per-turn operator authorization, and is launched only via
`scripts/run_oy_collection_batch.py` after the operator confirms CDP
attachment and per-product checkpoints (login / Cloudflare /
human-check).

Design boundaries
-----------------
- Pure Python. No DB access, no network, no subprocess invocation.
- No connector imports — keep this module free of any path that
  could be mistaken for a "collection trigger".
- JSON-on-disk only; the queue file is the source of truth for which
  (goods_no, sort_type) pairs are being tracked. New rows are NEVER
  created implicitly from an incoming batch_summary — `apply_batch_summary`
  raises on an unknown target, because the queue defines the campaign
  scope and a stray batch run must not silently extend it.
- Each (goods_no, sort_type) row is independent. Per CLAUDE.md OY
  collection rules, DATETIME_DESC is the primary corpus; signal sorts
  (RATING_ASC, RATING_DESC, USEFUL_SCORE_DESC, RECOMMENDED_DESC) are
  metadata-only and never auto-advanced. The operator decides when to
  enqueue signal sorts after primary coverage is achieved.

Status taxonomy
---------------
- "pending"               — not yet attempted.
- "ready"                 — eligible for the next operator-authorized
                            run (manual checkpoint cleared, or cooldown
                            elapsed and operator chose to refresh).
- "running"               — currently being collected (operator-set;
                            this module does not flip into running on
                            its own).
- "retry_after_cooldown"  — cursor API was rate-limited; wall-clock
                            spacing is the recovery. `next_run_after`
                            carries the cooldown-elapsed timestamp.
- "manual_checkpoint"     — auth wall / human-check / 403 observed;
                            operator must re-authenticate in CDP
                            Chrome before any retry can help.
- "done"                  — collection completed cleanly (final_status
                            in {complete, ok}).
- "inconclusive"          — connector returned an indeterminate result
                            (e.g. quality_status=inconclusive); operator
                            must triage before next attempt.

Status transition precedence (CLAUDE.md OY rate-limit policy I-A→I-D
chain): retry_after_cooldown > manual_checkpoint > done > inconclusive.
A batch_summary that simultaneously carries final_status="complete"
AND retry_intent="retry_after_cooldown" lands as retry_after_cooldown
— the cursor-throttle signal wins.
"""
from __future__ import annotations

import json
import os
import tempfile
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Iterable, Literal

from pydantic import BaseModel, Field


# ---------------------------------------------------------------------------
# Type aliases
# ---------------------------------------------------------------------------

TargetType = Literal["primary", "signal"]

QueueStatus = Literal[
    "pending",
    "ready",
    "running",
    "retry_after_cooldown",
    "manual_checkpoint",
    "done",
    "inconclusive",
]

# Per CLAUDE.md: DATETIME_DESC is the only primary corpus on OY; the
# other four sorts are signal/metadata corpora. The signal-sort names
# below are the canonical OliveYoung sortType identifiers used by the
# Brand-20 seed file (ops/brand20_collection_queue.json) and by the
# connector batch_summary contracts; ordering matches the seed so the
# dashboard PER-SORT table renders signals in their natural sequence.
PRIMARY_SORT: str = "DATETIME_DESC"
SIGNAL_SORTS: tuple[str, ...] = (
    "RATING_ASC",
    "RATING_DESC",
    "USEFUL_SCORE_DESC",
    "RECOMMENDED_DESC",
)
ALL_SORTS: tuple[str, ...] = (PRIMARY_SORT, *SIGNAL_SORTS)

# Operator hint surfaced verbatim on manual_checkpoint items. Kept
# here as a module-level constant so tests can assert exact text
# without grepping templates.
MANUAL_CHECKPOINT_HINT: str = (
    "operator action required: open CDP Chrome, login/verify, then mark certified"
)

# Live-collection authorization reminder appended to every generated
# next-run prompt. Verbatim, single line.
LIVE_COLLECTION_AUTH_REMINDER: str = (
    "REMINDER: live collection requires explicit per-turn operator "
    "authorization. This script does NOT launch collection."
)


# ---------------------------------------------------------------------------
# Pydantic models
# ---------------------------------------------------------------------------


class QueueItem(BaseModel):
    """One (goods_no, sort_type) row in the Brand-20 queue.

    Every operator-visible field from the ticket spec is present. Most
    are optional and default to None / 0 so a freshly-seeded queue (no
    runs yet) deserializes cleanly.
    """

    goods_no: str
    product_name: str
    sort_type: str
    target_type: TargetType

    status: QueueStatus = "pending"

    # Run-history fields (populated by apply_batch_summary).
    last_run_id: str | None = None
    last_attempt_at: str | None = None
    next_run_after: str | None = None
    attempts: int = 0

    raw_records_seen_last: int | None = None
    records_parsed_last: int | None = None
    rows_inserted_last: int | None = None

    # Coverage-tracking placeholders. The queue itself does NOT inspect
    # voc_data.db; these are populated externally (e.g. by a future
    # `--include-coverage` flag on the inspector that calls a read-only
    # SELECT). For now they remain None and the dashboard surfaces a
    # gap note.
    total_db_rows_for_goods: int | None = None
    observed_sort_membership_count: int | None = None

    # Operator/connector signal fields.
    retry_intent: str | None = None
    retry_after_minutes: int | None = None
    checkpoint_reason: str | None = None
    operator_note: str | None = None


class QueueMeta(BaseModel):
    """Top-level metadata block. `seed_complete=False` marks that the
    Brand-20 master list is incomplete; a follow-up ticket extends to
    the full 20 brands once the list is available.
    """

    schema_version: int = 1
    seed_complete: bool = False
    seeded_brands: list[str] = Field(default_factory=list)
    pending_brands_count: int = 0
    notes: str = ""


class Brand20Queue(BaseModel):
    """In-memory queue document. Wraps `_meta` + `items`."""

    meta: QueueMeta = Field(default_factory=QueueMeta, alias="_meta")
    items: list[QueueItem] = Field(default_factory=list)

    model_config = {"populate_by_name": True}

    # ------------------------------------------------------------------
    # Lookup helpers
    # ------------------------------------------------------------------
    def find(self, goods_no: str, sort_type: str) -> QueueItem | None:
        """Return the matching item or None. O(n); the queue is small
        (20 × 5 = 100 rows at full Brand-20 seed)."""
        for it in self.items:
            if it.goods_no == goods_no and it.sort_type == sort_type:
                return it
        return None

    def require(self, goods_no: str, sort_type: str) -> QueueItem:
        """Find-or-raise. Used by apply_batch_summary so an unknown
        (goods_no, sort_type) pair fails loud instead of silently
        extending the campaign scope.
        """
        it = self.find(goods_no, sort_type)
        if it is None:
            raise KeyError(
                f"queue has no row for goods_no={goods_no!r} "
                f"sort_type={sort_type!r}; refusing to auto-create. "
                f"Add the row to the queue file before re-running."
            )
        return it


# ---------------------------------------------------------------------------
# JSON load / save
# ---------------------------------------------------------------------------


def load_queue(path: Path | str) -> Brand20Queue:
    """Read the queue file. Raises if the file is absent or malformed
    — unlike `retry_queue.load`, this module treats the file as
    authoritative state and a missing file is an operator error, not a
    soft default.
    """
    p = Path(path)
    if not p.is_file():
        raise FileNotFoundError(f"queue file not found: {p}")
    raw = p.read_text(encoding="utf-8")
    data = json.loads(raw)
    # Tolerate both `_meta` (the on-disk key) and `meta` (the model
    # field name) for forward compatibility.
    return Brand20Queue.model_validate(data)


def save_queue(path: Path | str, queue: Brand20Queue) -> Path:
    """Atomic write. Same pattern as `retry_queue.save`: tmpfile +
    os.replace so a crash mid-write leaves the previous file intact.
    """
    p = Path(path)
    p.parent.mkdir(parents=True, exist_ok=True)
    # by_alias=True so the on-disk key is `_meta`, matching the schema
    # the operator sees and tests assert.
    payload = json.dumps(
        queue.model_dump(by_alias=True, mode="json"),
        ensure_ascii=False,
        indent=2,
    )
    fd, tmp_str = tempfile.mkstemp(
        prefix=p.name + ".", suffix=".tmp", dir=str(p.parent),
    )
    tmp = Path(tmp_str)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            f.write(payload)
            f.write("\n")
        os.replace(tmp, p)
    except Exception:
        try:
            tmp.unlink(missing_ok=True)
        except OSError:
            pass
        raise
    return p


# ---------------------------------------------------------------------------
# Timestamp helpers
# ---------------------------------------------------------------------------


def _now_iso(now: datetime | None = None) -> str:
    """ISO 8601 UTC with trailing Z (matches the rest of the codebase)."""
    if now is None:
        now = datetime.now(timezone.utc)
    if now.tzinfo is None:
        now = now.replace(tzinfo=timezone.utc)
    return now.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _parse_iso(s: str | None) -> datetime | None:
    """Parse an ISO 8601 UTC string. Tolerates the trailing Z and
    fractional seconds. Returns None on None / unparseable input."""
    if not s:
        return None
    try:
        # datetime.fromisoformat handles "+00:00" natively in 3.11+;
        # swap the trailing Z for the explicit offset.
        candidate = s.replace("Z", "+00:00")
        return datetime.fromisoformat(candidate)
    except ValueError:
        return None


# ---------------------------------------------------------------------------
# Batch-summary ingestion
# ---------------------------------------------------------------------------


def _extract_target(batch_summary: dict[str, Any]) -> tuple[str, str]:
    """Extract (goods_no, sort_type) from a batch_summary dict.

    Tolerates the two shapes that appear in existing artifacts:
      - top-level: {"goods_no": ..., "sort_type": ...}
      - nested:    products[0].oy_goods_no + manifest_audit.sort_type_in_defaults
                   (or products[0].summary.requested_sort_type)

    Raises KeyError with a clear hint if neither shape carries enough
    information.
    """
    goods_no = batch_summary.get("goods_no")
    sort_type = batch_summary.get("sort_type")

    if not goods_no:
        products = batch_summary.get("products") or []
        if products and isinstance(products, list):
            first = products[0]
            if isinstance(first, dict):
                goods_no = first.get("oy_goods_no") or first.get("goods_no")

    if not sort_type:
        manifest_audit = batch_summary.get("manifest_audit") or {}
        if isinstance(manifest_audit, dict):
            sort_type = manifest_audit.get("sort_type_in_defaults")
        if not sort_type:
            products = batch_summary.get("products") or []
            if products and isinstance(products, list):
                first = products[0]
                if isinstance(first, dict):
                    summary = first.get("summary") or {}
                    if isinstance(summary, dict):
                        sort_type = summary.get("requested_sort_type")

    if not goods_no or not sort_type:
        raise KeyError(
            "batch_summary missing goods_no / sort_type; checked top-level "
            "and products[0].* fallbacks. Cannot locate queue row."
        )
    return str(goods_no), str(sort_type)


def _extract_product_fields(batch_summary: dict[str, Any]) -> dict[str, Any]:
    """Pull the connector-side fields we care about, looking inside the
    top-level dict first and then `products[0]` / `products[0].summary`.
    Missing fields are returned as None so the caller can branch.
    """
    out: dict[str, Any] = {}
    keys_top = [
        "final_status", "quality_status", "status",
        "raw_records_seen", "records_parsed", "rows_inserted",
        "cursor_api_rate_limited", "cursor_api_silenced",
        "retry_intent", "retry_after_minutes",
        "run_id",
    ]
    for k in keys_top:
        out[k] = batch_summary.get(k)

    # Nested products[0] / products[0].summary
    products = batch_summary.get("products") or []
    if products and isinstance(products, list):
        first = products[0]
        if isinstance(first, dict):
            for k in [
                "status", "quality_status",
                "raw_records_seen", "records_parsed", "rows_inserted",
                "run_id",
            ]:
                if out.get(k) is None:
                    out[k] = first.get(k)
            summary = first.get("summary")
            if isinstance(summary, dict):
                for k in [
                    "cursor_api_rate_limited", "cursor_api_silenced",
                    "retry_intent", "retry_after_minutes",
                    "run_id",
                ]:
                    if out.get(k) is None:
                        out[k] = summary.get(k)
                # final_status mirror: connector classifier may surface
                # final_status via the resume_state block.
            resume_state = first.get("resume_state")
            if isinstance(resume_state, dict):
                if out.get("final_status") is None:
                    out["final_status"] = resume_state.get("final_status")
                if out.get("retry_intent") is None:
                    out["retry_intent"] = resume_state.get("retry_intent")
                if out.get("retry_after_minutes") is None:
                    out["retry_after_minutes"] = resume_state.get("retry_after_minutes")
                if out.get("quality_status") is None:
                    out["quality_status"] = resume_state.get("quality_status")

    # Last-resort: if final_status is still None but `status` is set on
    # the product record AND it's a clean terminal (`complete`/`ok`),
    # treat that as final_status.
    if out.get("final_status") is None:
        out["final_status"] = out.get("status")

    return out


def _decide_status(
    *,
    retry_intent: str | None,
    final_status: str | None,
    quality_status: str | None,
) -> tuple[QueueStatus, str | None]:
    """Return (new_status, checkpoint_reason).

    Precedence (CLAUDE.md OY rate-limit policy):
        1. retry_intent == "retry_after_cooldown"   → retry_after_cooldown
        2. retry_intent == "manual_review_required" → manual_checkpoint
        3. final_status in {complete, ok}           → done
        4. quality_status == "inconclusive"
           OR final_status not recognized           → inconclusive
    """
    if retry_intent == "retry_after_cooldown":
        return "retry_after_cooldown", None
    if retry_intent == "manual_review_required":
        return "manual_checkpoint", "auth_or_human_check"
    if final_status in ("complete", "ok"):
        return "done", None
    if quality_status == "inconclusive":
        return "inconclusive", None
    # Unknown / unrecognized terminal: classify as inconclusive so the
    # operator triages explicitly rather than silently advancing.
    return "inconclusive", None


def apply_batch_summary(
    queue: Brand20Queue,
    batch_summary: dict[str, Any],
    *,
    now: datetime | None = None,
) -> QueueItem:
    """Apply one batch_summary to the queue, returning the updated item.

    Mutates `queue` in place. Caller is responsible for persisting via
    `save_queue`. Raises KeyError if the (goods_no, sort_type) is not
    in the queue — by design, since the queue defines the campaign
    scope.
    """
    goods_no, sort_type = _extract_target(batch_summary)
    item = queue.require(goods_no, sort_type)
    fields = _extract_product_fields(batch_summary)

    last_attempt_iso = _now_iso(now)
    item.attempts += 1
    item.last_run_id = fields.get("run_id") or item.last_run_id
    item.last_attempt_at = last_attempt_iso

    if fields.get("raw_records_seen") is not None:
        item.raw_records_seen_last = int(fields["raw_records_seen"])
    if fields.get("records_parsed") is not None:
        item.records_parsed_last = int(fields["records_parsed"])
    if fields.get("rows_inserted") is not None:
        item.rows_inserted_last = int(fields["rows_inserted"])

    retry_intent = fields.get("retry_intent")
    if retry_intent is not None:
        item.retry_intent = str(retry_intent)
    retry_after_minutes = fields.get("retry_after_minutes")
    if retry_after_minutes is not None:
        item.retry_after_minutes = int(retry_after_minutes)

    new_status, checkpoint_reason = _decide_status(
        retry_intent=item.retry_intent,
        final_status=fields.get("final_status"),
        quality_status=fields.get("quality_status"),
    )
    item.status = new_status
    item.checkpoint_reason = checkpoint_reason

    if new_status == "retry_after_cooldown":
        # next_run_after = last_attempt_at + retry_after_minutes.
        # Default to 90 min if the connector didn't report a cadence
        # (matches CLAUDE.md's recommended cooldown).
        minutes = item.retry_after_minutes or 90
        anchor = _parse_iso(item.last_attempt_at) or (now or datetime.now(timezone.utc))
        item.next_run_after = _now_iso(anchor + timedelta(minutes=minutes))
    else:
        # Other transitions clear the cooldown anchor — done /
        # inconclusive / manual_checkpoint don't have a time-based
        # gate.
        item.next_run_after = None

    return item


# ---------------------------------------------------------------------------
# Manual checkpoint certification
# ---------------------------------------------------------------------------


def mark_checkpoint_certified(
    queue: Brand20Queue,
    *,
    goods_no: str,
    sort_type: str,
    note: str,
    now: datetime | None = None,
) -> QueueItem:
    """Flip a manual_checkpoint item to ready. Refuses to operate on
    any other status — the operator should never blindly clear an
    arbitrary row.
    """
    _ = now  # last_attempt_at is intentionally NOT updated here;
    # certification is an operator action, not a collection event.
    item = queue.require(goods_no, sort_type)
    if item.status != "manual_checkpoint":
        raise ValueError(
            f"refusing to certify: row (goods_no={goods_no!r}, "
            f"sort_type={sort_type!r}) is in status {item.status!r}, "
            f"expected 'manual_checkpoint'."
        )
    item.status = "ready"
    item.checkpoint_reason = None
    item.next_run_after = None
    item.operator_note = note
    return item


# ---------------------------------------------------------------------------
# Dashboard view
# ---------------------------------------------------------------------------


class _PerProductRow(BaseModel):
    goods_no: str
    product_name: str
    primary_status: QueueStatus | Literal["missing"]
    signal_done: int
    signal_total: int
    last_attempt: str | None


class _PerSortRow(BaseModel):
    sort_type: str
    pending: int = 0
    ready: int = 0
    running: int = 0
    retry_after_cooldown: int = 0
    manual_checkpoint: int = 0
    done: int = 0
    inconclusive: int = 0


class DashboardView(BaseModel):
    """Typed snapshot of the queue. Pure data — the CLI script formats
    it into terminal text; tests use the structured form directly.
    """

    generated_at: str
    schema_version: int
    queue_path: str

    total_products: int
    total_targets_seeded: int
    total_targets_ideal: int  # 20 brands × 5 sorts = 100

    counts: dict[str, int]  # one per status literal

    ready_now: list[QueueItem]
    waiting: list[QueueItem]
    manual: list[QueueItem]
    done: list[QueueItem]

    per_product: list[_PerProductRow]
    per_sort: list[_PerSortRow]

    suggestions: list[QueueItem]


def _sort_priority(item: QueueItem) -> tuple[int, str]:
    """Sort key: primary first, then signal sorts in canonical order."""
    if item.target_type == "primary":
        return (0, item.sort_type)
    try:
        idx = ALL_SORTS.index(item.sort_type)
    except ValueError:
        idx = 99
    return (1, f"{idx:02d}_{item.sort_type}")


def dashboard_view(
    queue: Brand20Queue,
    *,
    now: datetime | None = None,
    queue_path: str = "",
) -> DashboardView:
    """Produce a structured dashboard snapshot. Pure function; does
    not touch disk or the network."""
    now_dt = now or datetime.now(timezone.utc)
    if now_dt.tzinfo is None:
        now_dt = now_dt.replace(tzinfo=timezone.utc)

    items = queue.items
    statuses: tuple[QueueStatus, ...] = (
        "pending", "ready", "running",
        "retry_after_cooldown", "manual_checkpoint",
        "done", "inconclusive",
    )
    counts: dict[str, int] = {s: 0 for s in statuses}
    for it in items:
        counts[it.status] = counts.get(it.status, 0) + 1

    distinct_products: dict[str, str] = {}
    for it in items:
        distinct_products.setdefault(it.goods_no, it.product_name)

    # Ready Now: status==ready, primary first.
    ready_now = sorted(
        (it for it in items if it.status == "ready"),
        key=_sort_priority,
    )
    # Waiting: status==retry_after_cooldown, ascending by next_run_after.
    waiting = sorted(
        (it for it in items if it.status == "retry_after_cooldown"),
        key=lambda it: (it.next_run_after or "9999"),
    )
    manual = sorted(
        (it for it in items if it.status == "manual_checkpoint"),
        key=_sort_priority,
    )
    done_list = sorted(
        (it for it in items if it.status == "done"),
        key=_sort_priority,
    )

    # Per-product summary.
    per_product: list[_PerProductRow] = []
    for goods_no, name in distinct_products.items():
        primary: QueueItem | None = next(
            (it for it in items
             if it.goods_no == goods_no and it.target_type == "primary"),
            None,
        )
        signals = [it for it in items
                   if it.goods_no == goods_no and it.target_type == "signal"]
        signal_done = sum(1 for it in signals if it.status == "done")
        per_product.append(_PerProductRow(
            goods_no=goods_no,
            product_name=name,
            primary_status=(primary.status if primary else "missing"),
            signal_done=signal_done,
            signal_total=len(signals),
            last_attempt=(primary.last_attempt_at if primary else None),
        ))

    # Per-sort summary.
    per_sort: list[_PerSortRow] = []
    for sort_type in ALL_SORTS:
        row = _PerSortRow(sort_type=sort_type)
        for it in items:
            if it.sort_type != sort_type:
                continue
            setattr(row, it.status, getattr(row, it.status) + 1)
        per_sort.append(row)

    # Runnable-now from waiting (next_run_after in the past).
    runnable_now_from_waiting: list[QueueItem] = []
    for it in waiting:
        nra = _parse_iso(it.next_run_after)
        if nra is not None and nra <= now_dt:
            runnable_now_from_waiting.append(it)

    # Suggestions: Ready Now (primary-first) then runnable cooldowns.
    # Cap at 3 to match the ticket spec.
    suggestions: list[QueueItem] = []
    for it in ready_now:
        if len(suggestions) >= 3:
            break
        suggestions.append(it)
    for it in runnable_now_from_waiting:
        if len(suggestions) >= 3:
            break
        suggestions.append(it)

    return DashboardView(
        generated_at=_now_iso(now_dt),
        schema_version=queue.meta.schema_version,
        queue_path=queue_path,
        total_products=len(distinct_products),
        total_targets_seeded=len(items),
        total_targets_ideal=20 * 5,
        counts=counts,
        ready_now=ready_now,
        waiting=waiting,
        manual=manual,
        done=done_list,
        per_product=per_product,
        per_sort=per_sort,
        suggestions=suggestions,
    )


# ---------------------------------------------------------------------------
# Operator next-run prompt
# ---------------------------------------------------------------------------


def generate_next_run_prompt(item: QueueItem) -> str:
    """Build a copy-pasteable operator block for a queue item.

    The env vars are pinned to the conservative values that worked in
    the brand20 smoke runs (cf. CLAUDE.md OY rate-limit policy).
    The live-collection reminder is appended verbatim — this string is
    NOT a launch command.
    """
    url = (
        "https://www.oliveyoung.co.kr/store/goods/getGoodsDetail.do?"
        f"goodsNo={item.goods_no}"
    )
    return (
        f"=== Next ready: {item.product_name} / {item.sort_type} ===\n"
        f"goods_no: {item.goods_no}\n"
        f"product:  {item.product_name}\n"
        f"sort:     {item.sort_type}\n"
        f"cdp tab:  {url}\n"
        "env:\n"
        "  OY_CURSOR_PACING_MS=500\n"
        "  OY_CURSOR_RATE_LIMIT_COOLDOWN_SEC=120\n"
        "  OY_CURSOR_RATE_LIMIT_MAX_RETRIES=1\n"
        "\n"
        f"{LIVE_COLLECTION_AUTH_REMINDER}\n"
    )


# ---------------------------------------------------------------------------
# Convenience: bulk row construction (used by the seed file generator
# and by tests). Not part of the operator surface.
# ---------------------------------------------------------------------------


def make_full_sort_set(
    *,
    goods_no: str,
    product_name: str,
) -> list[QueueItem]:
    """Return 5 QueueItem rows (primary + 4 signal sorts) all in
    `pending` status. Convenience for seed generation and tests; the
    queue file itself is the source of truth at runtime."""
    rows: list[QueueItem] = []
    rows.append(QueueItem(
        goods_no=goods_no,
        product_name=product_name,
        sort_type=PRIMARY_SORT,
        target_type="primary",
    ))
    for s in SIGNAL_SORTS:
        rows.append(QueueItem(
            goods_no=goods_no,
            product_name=product_name,
            sort_type=s,
            target_type="signal",
        ))
    return rows


def iter_runnable(
    queue: Brand20Queue,
    *,
    now: datetime | None = None,
) -> Iterable[QueueItem]:
    """Yield items the operator could authorize next: status==ready,
    or status==retry_after_cooldown with next_run_after <= now. Primary
    sorts first, then signal sorts. Used by both the inspector script
    and any future scheduler probe (not enabled in this ticket)."""
    now_dt = now or datetime.now(timezone.utc)
    if now_dt.tzinfo is None:
        now_dt = now_dt.replace(tzinfo=timezone.utc)
    ready = sorted(
        (it for it in queue.items if it.status == "ready"),
        key=_sort_priority,
    )
    cooldown_done = sorted(
        (it for it in queue.items if it.status == "retry_after_cooldown"
         and (_parse_iso(it.next_run_after) or now_dt) <= now_dt),
        key=_sort_priority,
    )
    yield from ready
    yield from cooldown_done
