"""Per-sort retry queue (Phase 2E).

When the multi-sort orchestrator runs in non-strict mode and a sort
times out / gets blocked / hits anti-bot it can't recover from, the
sort is appended to a JSON queue file the operator can drain later
(via `scripts/retry_queue_drain.py`).

Strict mode (`--wait-until-sort-loaded`) does NOT touch this queue —
it loops the same sort until it loads.

Schema (one entry per failed sort):

    {
      "product_url":      "https://www.oliveyoung.co.kr/...goodsNo=...",
      "goods_no":         "A000000123456",
      "sort_type":        "RATING_ASC",
      "failure_reason":   "human_check_skipped" | "anti_bot" | ...,
      "last_status":      "blocked" | "scraper_subprocess_failed" | ...,
      "attempted_at":     "2026-04-30T12:34:56Z",
      "run_dir":          "/abs/path/to/run/dir" | null,
      "extra":            {...}        # opt-in payload (e.g. cap, suffix)
    }

Hard contracts
--------------
- Atomic: writes via `<path>.tmp` + `os.replace`. A crash mid-write
  leaves the previous file (or absence) intact.
- Pure (apart from the JSON file). No DB, no network.
- Caller-defined location. The orchestrator decides whether to use
  a global queue (`<repo>/retry_queue.json`) or a per-run queue.
- Schema is forward-compat: `additionalProperties: true` semantics —
  extra fields written today survive the next reader unchanged.
"""
from __future__ import annotations

import json
import os
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


REQUIRED_FIELDS: tuple[str, ...] = (
    "product_url",
    "goods_no",
    "sort_type",
    "failure_reason",
    "last_status",
    "attempted_at",
    "run_dir",
)


def _now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def make_entry(
    *,
    product_url: str,
    goods_no: str,
    sort_type: str,
    failure_reason: str,
    last_status: str | None,
    run_dir: str | Path | None = None,
    attempted_at: str | None = None,
    extra: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Construct a queue entry with timestamp defaulted to now-UTC.

    Caller may pass `attempted_at` explicitly to make tests
    deterministic; otherwise the wall clock is used.
    """
    out: dict[str, Any] = {
        "product_url": str(product_url),
        "goods_no": str(goods_no),
        "sort_type": str(sort_type),
        "failure_reason": str(failure_reason),
        "last_status": (str(last_status) if last_status is not None else None),
        "attempted_at": attempted_at or _now_iso(),
        "run_dir": (str(run_dir) if run_dir is not None else None),
    }
    if extra:
        out["extra"] = dict(extra)
    return out


def load(path: Path | str) -> list[dict[str, Any]]:
    """Read the queue file. Returns [] if absent or unreadable.

    Tolerates: missing file, empty file, JSON-decode error, non-list
    top-level. The contract is "load is best-effort" so a corrupt
    queue never blocks the orchestrator from writing fresh entries.
    """
    p = Path(path)
    if not p.is_file():
        return []
    try:
        raw = p.read_text(encoding="utf-8").strip()
    except OSError:
        return []
    if not raw:
        return []
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        return []
    if not isinstance(data, list):
        return []
    out: list[dict[str, Any]] = []
    for item in data:
        if isinstance(item, dict):
            out.append(item)
    return out


def save(path: Path | str, entries: list[dict[str, Any]]) -> Path:
    """Atomic write of `entries` to `path`.

    Writes to `<path>.tmp` then `os.replace` onto `path`. The replace
    is atomic on POSIX and on Windows when both files live in the
    same directory.
    """
    p = Path(path)
    p.parent.mkdir(parents=True, exist_ok=True)
    payload = json.dumps(list(entries), ensure_ascii=False, indent=2)
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


def append(path: Path | str, entry: dict[str, Any]) -> Path:
    """Load → append → save. The most common write path.

    Caller is responsible for de-duplication semantics; this function
    appends unconditionally so a second failure of the same sort
    produces a second entry (the drain CLI can decide how to merge).
    """
    items = load(path)
    items.append(entry)
    return save(path, items)


def remove_matching(
    path: Path | str,
    *,
    goods_no: str | None = None,
    sort_type: str | None = None,
    product_url: str | None = None,
) -> int:
    """Remove every entry whose goods_no/sort_type/product_url all
    match the passed filters (None = wildcard). Returns the number
    of entries removed. Used by the drain CLI after a successful
    re-run.
    """
    items = load(path)
    kept: list[dict[str, Any]] = []
    removed = 0
    for it in items:
        if (
            (goods_no is None or it.get("goods_no") == goods_no)
            and (sort_type is None or it.get("sort_type") == sort_type)
            and (product_url is None or it.get("product_url") == product_url)
        ):
            removed += 1
            continue
        kept.append(it)
    if removed:
        save(path, kept)
    return removed
