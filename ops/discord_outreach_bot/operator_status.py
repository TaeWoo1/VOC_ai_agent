"""D5-1: read-only operator status / indexer for the guarded action console.

Purpose
-------
Give the Discord operator a concise, read-only view of what guarded-action
artifacts exist on disk and what needs attention, *before* any real provider is
added. This module never mutates anything — it only reads `outputs/` and
summarises.

Hard invariants (enforced by tests + review):
  - No write/mkdir/unlink/rename — only `read_text`, `json.loads`, `glob`,
    `iterdir`, `exists`.
  - Never mutates packets, status.json, send_log.md, publish_log.md, previews,
    or staging.
  - Never runs collect / render / send / publish; no Gmail/SMTP/IG/network.
  - Never deletes or cleans smoke artifacts (they are labelled, not removed).
  - Total function: malformed/absent artifacts degrade to a flagged record;
    `build_operator_status` does not raise on bad input.
  - No Discord coupling. `format_status_card` is pure (no I/O, deterministic).

D5-2 (out of scope here) will import `build_operator_status` /
`format_status_card` and bind them to a Discord command.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Optional

import status_reader  # flat import (bot is not a src.* package; see conftest)

# --------------------------------------------------------------------------- #
# Constants
# --------------------------------------------------------------------------- #

# Lanes
LANE_RENDER = "render"
LANE_COLLECT = "collect"
LANE_SEND = "send"
LANE_PUBLISH = "publish"

# Categories
CAT_READY = "ready_for_review"
CAT_PENDING = "pending_confirmation"
CAT_BLOCKED = "blocked"
CAT_COMPLETED_FAKE = "completed_fake"
CAT_COMPLETED_REAL = "completed_real"
CAT_NEEDS_ATTENTION = "needs_attention"
# D5-3a: visible-but-not-urgent hygiene bucket for outreach packets that lack
# status.json. Split from needs_attention so the urgent list stays for genuine
# problems (parse errors, orphan ledgers, collisions, blocked actions).
CAT_LEGACY = "legacy"

CATEGORIES = (
    CAT_READY,
    CAT_PENDING,
    CAT_BLOCKED,
    CAT_COMPLETED_FAKE,
    CAT_COMPLETED_REAL,
    CAT_NEEDS_ATTENTION,
    CAT_LEGACY,
)

# D5-3a legacy reasons (record-level, machine-checkable).
REASON_LEGACY_SEND_LOG_ONLY = "legacy_send_log_only"  # send_log.md, no status.json
REASON_INCOMPLETE_DRAFT = "incomplete_draft"  # neither status.json nor send_log.md

# Tokens marking a path as a smoke / superseded / transient artifact.
_SMOKE_TOKENS = ("smoke", "_prev_", "_pre_", "_hung_", "_dryrun")

# Agent action workspaces are top-level dirs under outputs/ matching this glob.
# This bounds the scan to known guarded-action roots (agent_send_*,
# agent_publish_*, agent_collect_*, agent_*_smoke, ...).
_AGENT_WORKSPACE_GLOB = "agent_*"

# Recognised artifact filenames.
_SEND_PREVIEW = "send_preview.json"
_SEND_LOG = "send_log.md"
_PUBLISH_PREVIEW = "publish_preview.json"
_PUBLISH_LOG = "publish_log.md"
_COLLECT_PLAN = "collect_plan.json"
_RUNNER_STDOUT = "runner_stdout.log"

_FAKE_PREFIX = "fake-"

# Pipe-format append-only ledger line, e.g.
#   - 2026-06-04T09:47:03Z | result=sent | content_hash=sha256:ab.. | to=.. \
#     | message_id=fake-ab.. | operator=.. | stage=send_final
_LEDGER_TS_RE = re.compile(r"^\s*-\s*(\S+)\s*\|")
_RESULT_RE = re.compile(r"result=(\w+)")
_CONTENT_HASH_RE = re.compile(r"content_hash=(sha256:[0-9a-fA-F]+)")
_MESSAGE_ID_RE = re.compile(r"message_id=(\S+)")
_POST_ID_RE = re.compile(r"post_id=(\S+)")


# --------------------------------------------------------------------------- #
# Schema
# --------------------------------------------------------------------------- #


@dataclass(frozen=True)
class ActionRecord:
    """One guarded-action artifact group, read from disk."""

    lane: str
    id: str
    path: str  # repo-relative path to the record's primary artifact / dir
    category: str
    is_smoke: bool = False
    is_legacy: bool = False  # D5-3a: legacy/incomplete outreach packet
    reason: Optional[str] = None  # e.g. legacy_send_log_only / incomplete_draft
    blocked: bool = False
    blocked_reason: Optional[str] = None
    idempotency: Optional[str] = None  # content_hash or run id, if any
    already_completed: bool = False
    prerequisites_missing: tuple[str, ...] = ()
    last_outcome: Optional[str] = None  # sent / published / parse_error / ...
    last_outcome_at: Optional[str] = None  # ISO ts parsed from a ledger line
    summary: str = ""

    def sort_key(self) -> tuple[str, str, str]:
        return (self.lane, self.id, self.path)


@dataclass(frozen=True)
class OperatorStatus:
    """A read-only snapshot of guarded-action artifacts."""

    generated_note: str
    counts: dict[str, int]
    records: tuple[ActionRecord, ...]
    attention: tuple[ActionRecord, ...]
    smoke_excluded: int
    roots_scanned: tuple[str, ...]


# --------------------------------------------------------------------------- #
# Small read-only helpers
# --------------------------------------------------------------------------- #


def _rel(repo_root: Path, path: Path) -> str:
    try:
        return str(path.relative_to(repo_root))
    except ValueError:
        return str(path)


def _is_smoke(rel_path: str) -> bool:
    return any(tok in rel_path for tok in _SMOKE_TOKENS)


def _safe_load_json(path: Path) -> tuple[Optional[dict[str, Any]], Optional[str]]:
    """Read + parse JSON. Returns (data, None) or (None, error_str). Never raises."""
    try:
        text = path.read_text(encoding="utf-8")
    except OSError as exc:
        return None, f"read_error: {exc}"
    try:
        data = json.loads(text)
    except (json.JSONDecodeError, ValueError) as exc:
        return None, f"parse_error: {exc}"
    if not isinstance(data, dict):
        return None, "parse_error: top-level JSON is not an object"
    return data, None


def _safe_read_text(path: Path) -> Optional[str]:
    try:
        return path.read_text(encoding="utf-8")
    except OSError:
        return None


def _parse_ledger(text: Optional[str], id_field: str) -> list[dict[str, Optional[str]]]:
    """Parse append-only pipe-format ledger lines that carry result=... .

    `id_field` is the per-line id key, "message_id" (send) or "post_id"
    (publish). Returns one dict per `result=` line.
    """
    entries: list[dict[str, Optional[str]]] = []
    if not text:
        return entries
    id_re = _MESSAGE_ID_RE if id_field == "message_id" else _POST_ID_RE
    for line in text.splitlines():
        result_m = _RESULT_RE.search(line)
        if not result_m:
            continue
        ts_m = _LEDGER_TS_RE.search(line)
        hash_m = _CONTENT_HASH_RE.search(line)
        id_m = id_re.search(line)
        entries.append(
            {
                "result": result_m.group(1),
                "ts": ts_m.group(1) if ts_m else None,
                "content_hash": hash_m.group(1) if hash_m else None,
                id_field: id_m.group(1) if id_m else None,
            }
        )
    return entries


# --------------------------------------------------------------------------- #
# Scanners — each returns a list[ActionRecord]; none raise.
# --------------------------------------------------------------------------- #


def _agent_workspaces(outputs_dir: Path) -> list[Path]:
    if not outputs_dir.exists():
        return []
    return sorted(p for p in outputs_dir.glob(_AGENT_WORKSPACE_GLOB) if p.is_dir())


def _scan_send_in_workspace(repo_root: Path, ws: Path) -> list[ActionRecord]:
    records: list[ActionRecord] = []

    # 1) Collect previews keyed by task_id.
    previews: list[dict[str, Any]] = []
    seen_hashes: dict[str, int] = {}
    for preview_path in sorted(ws.rglob(_SEND_PREVIEW)):
        data, err = _safe_load_json(preview_path)
        rel = _rel(repo_root, preview_path)
        if err is not None or data is None:
            records.append(
                ActionRecord(
                    lane=LANE_SEND,
                    id=preview_path.parent.name,
                    path=rel,
                    category=CAT_NEEDS_ATTENTION,
                    is_smoke=_is_smoke(rel),
                    last_outcome="parse_error",
                    summary=f"malformed {_SEND_PREVIEW}: {err}",
                )
            )
            continue
        if data.get("kind") != "send_preview":
            continue
        chash = data.get("content_hash")
        if isinstance(chash, str):
            seen_hashes[chash] = seen_hashes.get(chash, 0) + 1
        previews.append({"path": preview_path, "rel": rel, "data": data})

    # 2) Collect ledger entries (result=sent) across the workspace.
    ledger: list[dict[str, Optional[str]]] = []
    for log_path in sorted(ws.rglob(_SEND_LOG)):
        ledger.extend(_parse_ledger(_safe_read_text(log_path), "message_id"))
    sent_by_hash: dict[str, dict[str, Optional[str]]] = {
        e["content_hash"]: e
        for e in ledger
        if e.get("result") == "sent" and e.get("content_hash")
    }
    matched_hashes: set[str] = set()

    # 3) Reconcile previews against the ledger.
    for pv in previews:
        data = pv["data"]
        rel = pv["rel"]
        packet_dir = pv["path"].parent
        task_id = str(data.get("task_id") or packet_dir.name)
        chash = data.get("content_hash") if isinstance(data.get("content_hash"), str) else None
        subject = str(data.get("subject") or "")
        recipient = str(data.get("recipient_email") or "")
        is_smoke = _is_smoke(rel)

        prereqs = _missing_send_attachments(ws, data)
        blocked_marker = _blocked_reason(packet_dir, "send.blocked") or _blocked_reason(
            ws, "send.blocked"
        )

        if chash and seen_hashes.get(chash, 0) > 1:
            records.append(
                ActionRecord(
                    lane=LANE_SEND,
                    id=task_id,
                    path=rel,
                    category=CAT_NEEDS_ATTENTION,
                    is_smoke=is_smoke,
                    idempotency=chash,
                    last_outcome="idempotency_collision",
                    summary=f"duplicate preview content_hash ({subject})",
                )
            )
            continue

        sent = sent_by_hash.get(chash) if chash else None
        if sent is not None:
            matched_hashes.add(chash)  # type: ignore[arg-type]
            message_id = sent.get("message_id") or ""
            is_fake = message_id.startswith(_FAKE_PREFIX)
            records.append(
                ActionRecord(
                    lane=LANE_SEND,
                    id=task_id,
                    path=rel,
                    category=CAT_COMPLETED_FAKE if is_fake else CAT_COMPLETED_REAL,
                    is_smoke=is_smoke,
                    idempotency=chash,
                    already_completed=True,
                    last_outcome="sent",
                    last_outcome_at=sent.get("ts"),
                    summary=f"{recipient or '?'} — {subject}",
                )
            )
            continue

        if blocked_marker is not None:
            records.append(
                ActionRecord(
                    lane=LANE_SEND,
                    id=task_id,
                    path=rel,
                    category=CAT_BLOCKED,
                    is_smoke=is_smoke,
                    blocked=True,
                    blocked_reason=blocked_marker,
                    idempotency=chash,
                    prerequisites_missing=prereqs,
                    summary=f"{recipient or '?'} — {subject}",
                )
            )
            continue

        if prereqs:
            records.append(
                ActionRecord(
                    lane=LANE_SEND,
                    id=task_id,
                    path=rel,
                    category=CAT_BLOCKED,
                    is_smoke=is_smoke,
                    blocked=True,
                    blocked_reason="missing_prerequisites",
                    idempotency=chash,
                    prerequisites_missing=prereqs,
                    summary=f"{recipient or '?'} — {subject}",
                )
            )
            continue

        records.append(
            ActionRecord(
                lane=LANE_SEND,
                id=task_id,
                path=rel,
                category=CAT_READY,
                is_smoke=is_smoke,
                idempotency=chash,
                summary=f"{recipient or '?'} — {subject}",
            )
        )

    # 4) Orphan ledger entries (sent hash with no matching preview).
    for chash, entry in sorted(sent_by_hash.items()):
        if chash in matched_hashes:
            continue
        rel = _rel(repo_root, ws)
        records.append(
            ActionRecord(
                lane=LANE_SEND,
                id=f"orphan:{chash[:19]}",
                path=rel,
                category=CAT_NEEDS_ATTENTION,
                is_smoke=_is_smoke(rel),
                idempotency=chash,
                last_outcome="orphan_ledger_entry",
                last_outcome_at=entry.get("ts"),
                summary="send_log entry has no matching preview",
            )
        )

    return records


def _scan_publish_in_workspace(repo_root: Path, ws: Path) -> list[ActionRecord]:
    records: list[ActionRecord] = []

    previews: list[dict[str, Any]] = []
    seen_hashes: dict[str, int] = {}
    for preview_path in sorted(ws.rglob(_PUBLISH_PREVIEW)):
        data, err = _safe_load_json(preview_path)
        rel = _rel(repo_root, preview_path)
        if err is not None or data is None:
            records.append(
                ActionRecord(
                    lane=LANE_PUBLISH,
                    id=preview_path.parent.name,
                    path=rel,
                    category=CAT_NEEDS_ATTENTION,
                    is_smoke=_is_smoke(rel),
                    last_outcome="parse_error",
                    summary=f"malformed {_PUBLISH_PREVIEW}: {err}",
                )
            )
            continue
        if data.get("kind") != "publish_preview":
            continue
        chash = data.get("content_hash")
        if isinstance(chash, str):
            seen_hashes[chash] = seen_hashes.get(chash, 0) + 1
        previews.append({"path": preview_path, "rel": rel, "data": data})

    ledger: list[dict[str, Optional[str]]] = []
    for log_path in sorted(ws.rglob(_PUBLISH_LOG)):
        ledger.extend(_parse_ledger(_safe_read_text(log_path), "post_id"))
    pub_by_hash: dict[str, dict[str, Optional[str]]] = {
        e["content_hash"]: e
        for e in ledger
        if e.get("result") == "published" and e.get("content_hash")
    }
    matched_hashes: set[str] = set()

    for pv in previews:
        data = pv["data"]
        rel = pv["rel"]
        package_dir = pv["path"].parent
        package_id = str(data.get("package_id") or package_dir.name)
        chash = data.get("content_hash") if isinstance(data.get("content_hash"), str) else None
        caption = str(data.get("caption") or "")
        is_smoke = _is_smoke(rel)

        if chash and seen_hashes.get(chash, 0) > 1:
            records.append(
                ActionRecord(
                    lane=LANE_PUBLISH,
                    id=package_id,
                    path=rel,
                    category=CAT_NEEDS_ATTENTION,
                    is_smoke=is_smoke,
                    idempotency=chash,
                    last_outcome="idempotency_collision",
                    summary="duplicate preview content_hash",
                )
            )
            continue

        published = pub_by_hash.get(chash) if chash else None
        if published is not None:
            matched_hashes.add(chash)  # type: ignore[arg-type]
            post_id = published.get("post_id") or ""
            is_fake = post_id.startswith(_FAKE_PREFIX)
            records.append(
                ActionRecord(
                    lane=LANE_PUBLISH,
                    id=package_id,
                    path=rel,
                    category=CAT_COMPLETED_FAKE if is_fake else CAT_COMPLETED_REAL,
                    is_smoke=is_smoke,
                    idempotency=chash,
                    already_completed=True,
                    last_outcome="published",
                    last_outcome_at=published.get("ts"),
                    summary=_clip(caption),
                )
            )
            continue

        blocked_marker = _blocked_reason(package_dir, "publish.blocked") or _blocked_reason(
            ws, "publish.blocked"
        )
        gate_missing = _publish_gate_failures(data)

        if blocked_marker is not None:
            records.append(
                ActionRecord(
                    lane=LANE_PUBLISH,
                    id=package_id,
                    path=rel,
                    category=CAT_BLOCKED,
                    is_smoke=is_smoke,
                    blocked=True,
                    blocked_reason=blocked_marker,
                    idempotency=chash,
                    prerequisites_missing=gate_missing,
                    summary=_clip(caption),
                )
            )
            continue

        if gate_missing:
            records.append(
                ActionRecord(
                    lane=LANE_PUBLISH,
                    id=package_id,
                    path=rel,
                    category=CAT_BLOCKED,
                    is_smoke=is_smoke,
                    blocked=True,
                    blocked_reason="publish_gate",
                    idempotency=chash,
                    prerequisites_missing=gate_missing,
                    summary=_clip(caption),
                )
            )
            continue

        records.append(
            ActionRecord(
                lane=LANE_PUBLISH,
                id=package_id,
                path=rel,
                category=CAT_READY,
                is_smoke=is_smoke,
                idempotency=chash,
                summary=_clip(caption),
            )
        )

    for chash, entry in sorted(pub_by_hash.items()):
        if chash in matched_hashes:
            continue
        rel = _rel(repo_root, ws)
        records.append(
            ActionRecord(
                lane=LANE_PUBLISH,
                id=f"orphan:{chash[:19]}",
                path=rel,
                category=CAT_NEEDS_ATTENTION,
                is_smoke=_is_smoke(rel),
                idempotency=chash,
                last_outcome="orphan_ledger_entry",
                last_outcome_at=entry.get("ts"),
                summary="publish_log entry has no matching preview",
            )
        )

    return records


def _scan_collect_in_workspace(repo_root: Path, ws: Path) -> list[ActionRecord]:
    records: list[ActionRecord] = []

    # A completed collect run leaves a runner_stdout.log. Recognising it is
    # read-only — it does NOT mean we ran collect.
    for log_path in sorted(ws.rglob(_RUNNER_STDOUT)):
        run_dir = log_path.parent
        rel = _rel(repo_root, run_dir)
        blocked = _blocked_reason(run_dir, "collect.blocked")
        records.append(
            ActionRecord(
                lane=LANE_COLLECT,
                id=run_dir.name,
                path=rel,
                category=CAT_BLOCKED if blocked else CAT_COMPLETED_REAL,
                is_smoke=_is_smoke(rel),
                blocked=blocked is not None,
                blocked_reason=blocked,
                last_outcome="collect_run" if not blocked else None,
                summary="collect run artifact",
            )
        )

    # A collect_plan.json with no run alongside it is a staged plan.
    for plan_path in sorted(ws.rglob(_COLLECT_PLAN)):
        plan_dir = plan_path.parent
        if (plan_dir / _RUNNER_STDOUT).exists():
            continue  # already represented by the run record above
        data, err = _safe_load_json(plan_path)
        rel = _rel(repo_root, plan_path)
        if err is not None:
            records.append(
                ActionRecord(
                    lane=LANE_COLLECT,
                    id=plan_dir.name,
                    path=rel,
                    category=CAT_NEEDS_ATTENTION,
                    is_smoke=_is_smoke(rel),
                    last_outcome="parse_error",
                    summary=f"malformed {_COLLECT_PLAN}: {err}",
                )
            )
            continue
        goods = str((data or {}).get("goods_no") or plan_dir.name)
        records.append(
            ActionRecord(
                lane=LANE_COLLECT,
                id=goods,
                path=rel,
                category=CAT_READY,
                is_smoke=_is_smoke(rel),
                summary="collect plan staged (no run yet)",
            )
        )

    return records


def _scan_render_in_workspace(repo_root: Path, ws: Path) -> list[ActionRecord]:
    """Render produces PDFs into a `staging/` dir only (never the packet)."""
    records: list[ActionRecord] = []
    for pdf_path in sorted(ws.rglob("*.pdf")):
        if "staging" not in {part for part in pdf_path.parts}:
            continue
        rel = _rel(repo_root, pdf_path)
        blocked = _blocked_reason(pdf_path.parent, "render.blocked")
        records.append(
            ActionRecord(
                lane=LANE_RENDER,
                id=pdf_path.stem,
                path=rel,
                category=CAT_BLOCKED if blocked else CAT_READY,
                is_smoke=_is_smoke(rel),
                blocked=blocked is not None,
                blocked_reason=blocked,
                summary="staged render PDF",
            )
        )
    return records


def _scan_outreach_packets(repo_root: Path) -> list[ActionRecord]:
    """Real outreach packets under outputs/outreach/new_targets/.

    Reuses status_reader (the existing read-only packet loader) rather than
    re-parsing status.json. These are operator-driven manual sends, mapped
    conservatively onto the shared category vocabulary.
    """
    records: list[ActionRecord] = []
    targets_dir = status_reader.default_targets_dir(repo_root)
    for target in status_reader.discover_targets(targets_dir):
        rel = _rel(repo_root, target.path)
        is_smoke = _is_smoke(rel)
        state = target.state

        # Prefer a pipe-format ledger result if the packet has one; most
        # new_targets packets use prose, so fall back to status.json state.
        ledger = _parse_ledger(target.send_log_text, "message_id")
        sent = next((e for e in ledger if e.get("result") == "sent"), None)

        category: str
        last_outcome: Optional[str] = None
        last_outcome_at: Optional[str] = None
        prereqs: tuple[str, ...] = ()
        is_legacy = False
        reason: Optional[str] = None

        if state == "STATUS_JSON_PARSE_ERROR":
            category = CAT_NEEDS_ATTENTION
            last_outcome = "parse_error"
        elif not target.has_status_json:
            # D5-3a: missing status.json is a hygiene state, not an urgent
            # problem. Deliberately checked BEFORE any send_log-derived state:
            # a legacy send_log's SENT/SCHEDULED words must NOT classify the
            # packet as ready/completed in this slice — that inference (and any
            # status.json backfill) is the separately authorized D5-3b.
            category = CAT_LEGACY
            is_legacy = True
            if target.send_log_text is not None:
                reason = REASON_LEGACY_SEND_LOG_ONLY
                prereqs = ("status.json",)
            else:
                reason = REASON_INCOMPLETE_DRAFT
                prereqs = ("status.json", "send_log.md")
        elif sent is not None:
            message_id = sent.get("message_id") or ""
            category = (
                CAT_COMPLETED_FAKE if message_id.startswith(_FAKE_PREFIX) else CAT_COMPLETED_REAL
            )
            last_outcome = "sent"
            last_outcome_at = sent.get("ts")
        elif state in ("SENT", "CLOSED"):
            category = CAT_COMPLETED_REAL
            last_outcome = "sent"
        elif state in ("SCHEDULED", "FOLLOW_UP_DUE", "PARKED"):
            category = CAT_READY
        else:  # status.json present but state unrecognised
            category = CAT_NEEDS_ATTENTION

        records.append(
            ActionRecord(
                lane=LANE_SEND,
                id=target.slug,
                path=rel,
                category=category,
                is_smoke=is_smoke,
                is_legacy=is_legacy,
                reason=reason,
                prerequisites_missing=prereqs,
                last_outcome=last_outcome,
                last_outcome_at=last_outcome_at,
                summary=f"{target.brand} [{state}]",
            )
        )
    return records


# --------------------------------------------------------------------------- #
# Inference helpers
# --------------------------------------------------------------------------- #


def _blocked_reason(directory: Path, marker_name: str) -> Optional[str]:
    """Return the marker's text (or a sentinel) if a `*.blocked` marker exists."""
    marker = directory / marker_name
    if marker.exists():
        text = _safe_read_text(marker)
        return (text.strip() if text and text.strip() else marker_name)
    return None


def _missing_send_attachments(ws: Path, preview: dict[str, Any]) -> tuple[str, ...]:
    """Attachments referenced by a send preview but absent on disk."""
    attachments = preview.get("attachments")
    if not isinstance(attachments, list):
        return ()
    task_id = str(preview.get("task_id") or "")
    missing: list[str] = []
    for att in attachments:
        if not isinstance(att, str):
            continue
        # Look for the attachment in the packet dir (sibling of staging/).
        candidates = list(ws.rglob(att))
        if not candidates:
            missing.append(att)
    if missing:
        return tuple(sorted(set(missing)))
    _ = task_id  # reserved for future packet-scoped lookup
    return ()


def _publish_gate_failures(preview: dict[str, Any]) -> tuple[str, ...]:
    """Publish requires rights cleared AND safety pass. Return missing gates."""
    missing: list[str] = []
    rights = preview.get("rights_review")
    if not isinstance(rights, dict) or rights.get("status") != "cleared":
        missing.append("rights_review_cleared")
    safety = preview.get("safety_check")
    if not isinstance(safety, dict) or safety.get("status") != "pass":
        missing.append("safety_check_pass")
    return tuple(missing)


def _clip(text: str, width: int = 60) -> str:
    text = text.replace("\n", " ").strip()
    return text if len(text) <= width else text[: width - 1] + "…"


# --------------------------------------------------------------------------- #
# Public API
# --------------------------------------------------------------------------- #


def build_operator_status(
    repo_root: Optional[Path] = None,
    include_smoke: bool = False,
) -> OperatorStatus:
    """Index guarded-action artifacts under outputs/ (read-only).

    Args:
        repo_root: repo root; defaults to status_reader.find_repo_root().
        include_smoke: when False (default), smoke / superseded / transient
            artifacts are quarantined — dropped from `records`/`counts` and
            tallied in `smoke_excluded`. When True they are surfaced with
            `is_smoke=True`.
    """
    root = (repo_root or status_reader.find_repo_root()).resolve()
    outputs_dir = root / "outputs"

    roots_scanned: list[str] = []
    all_records: list[ActionRecord] = []

    # Real outreach packets (canonical send packets).
    targets_dir = status_reader.default_targets_dir(root)
    if targets_dir.exists():
        roots_scanned.append(_rel(root, targets_dir))
        all_records.extend(_scan_outreach_packets(root))

    # Agent action workspaces (send/publish/collect/render staging + smoke).
    for ws in _agent_workspaces(outputs_dir):
        roots_scanned.append(_rel(root, ws))
        all_records.extend(_scan_send_in_workspace(root, ws))
        all_records.extend(_scan_publish_in_workspace(root, ws))
        all_records.extend(_scan_collect_in_workspace(root, ws))
        all_records.extend(_scan_render_in_workspace(root, ws))

    all_records.sort(key=ActionRecord.sort_key)

    smoke_excluded = sum(1 for r in all_records if r.is_smoke)
    if include_smoke:
        visible = tuple(all_records)
    else:
        visible = tuple(r for r in all_records if not r.is_smoke)

    counts = {cat: 0 for cat in CATEGORIES}
    for r in visible:
        counts[r.category] = counts.get(r.category, 0) + 1

    attention = tuple(
        r for r in visible if r.category in (CAT_BLOCKED, CAT_NEEDS_ATTENTION)
    )

    note = (
        "read-only snapshot; no packet/status/log/preview mutated, "
        "nothing collected/rendered/sent/published"
    )

    return OperatorStatus(
        generated_note=note,
        counts=counts,
        records=visible,
        attention=attention,
        smoke_excluded=smoke_excluded,
        roots_scanned=tuple(roots_scanned),
    )


def format_status_card(status: OperatorStatus) -> str:
    """Render an OperatorStatus as a deterministic plain-text card.

    Pure: no filesystem access, no Discord imports, no clock reads. Same input
    always yields the same string.
    """
    lines: list[str] = []
    lines.append("📋 Operator status (read-only)")
    lines.append(status.generated_note)
    lines.append("")

    # Counts line — fixed category order for determinism.
    count_parts = [f"{cat}={status.counts.get(cat, 0)}" for cat in CATEGORIES]
    lines.append("counts: " + "  ".join(count_parts))
    lines.append(f"total={len(status.records)}  smoke_excluded={status.smoke_excluded}")
    lines.append("")

    if status.attention:
        lines.append(f"⚠️ needs attention ({len(status.attention)}):")
        for r in status.attention:  # already deterministically sorted
            detail = r.blocked_reason or r.last_outcome or ""
            prereq = (
                f" missing={','.join(r.prerequisites_missing)}"
                if r.prerequisites_missing
                else ""
            )
            lines.append(f"  - [{r.lane}/{r.category}] {r.id} — {detail}{prereq}".rstrip())
    else:
        lines.append("⚠️ needs attention (0): none")
    lines.append("")

    # D5-3a: legacy / incomplete packets — visible but not urgent. Filtered
    # from records (not a separate field) so any OperatorStatus renders
    # consistently.
    legacy_records = [r for r in status.records if r.category == CAT_LEGACY]
    if legacy_records:
        lines.append(f"🗂 legacy / incomplete ({len(legacy_records)}):")
        for r in legacy_records:  # already deterministically sorted
            prereq = (
                f" missing={','.join(r.prerequisites_missing)}"
                if r.prerequisites_missing
                else ""
            )
            lines.append(f"  - [{r.lane}/legacy] {r.id} — {r.reason or ''}{prereq}".rstrip())
    else:
        lines.append("🗂 legacy / incomplete (0): none")
    lines.append("")

    # Per-lane roll-up of all visible records.
    for lane in (LANE_RENDER, LANE_COLLECT, LANE_SEND, LANE_PUBLISH):
        lane_records = [r for r in status.records if r.lane == lane]
        if not lane_records:
            continue
        lines.append(f"{lane} ({len(lane_records)}):")
        for r in lane_records:
            tag = " [smoke]" if r.is_smoke else ""
            done = " ↻done" if r.already_completed else ""
            summary = f" — {r.summary}" if r.summary else ""
            lines.append(f"  - {r.category}: {r.id}{done}{tag}{summary}")
        lines.append("")

    return "\n".join(lines).rstrip() + "\n"
