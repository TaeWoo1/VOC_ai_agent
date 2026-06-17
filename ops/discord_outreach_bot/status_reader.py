"""Read-only loader for outreach packet state.

Source-of-truth precedence (per docs/ops/outreach_packet_runbook.md):
  1. <packet>/status.json   -> packet state, corpus, angle, send block
  2. <packet>/send_log.md   -> send / follow-up status (also the ONLY record
                               for legacy packets that predate status.json,
                               e.g. Menokin / Dewytree)

Nothing in this module opens a packet file for writing. The bot is read-only
by construction.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Optional

PACKET_FILES = (
    "email_subject.txt",
    "email_body.txt",
    "bait_report.md",
    "internal_notes.md",
)


def find_repo_root(start: Optional[Path] = None) -> Path:
    """Walk up from `start` until a repo marker is found (.git or CLAUDE.md)."""
    here = (start or Path(__file__)).resolve()
    for parent in [here, *here.parents]:
        if (parent / ".git").exists() or (parent / "CLAUDE.md").exists():
            return parent
    # Fallback: two levels up from ops/discord_outreach_bot/
    return Path(__file__).resolve().parents[2]


def default_targets_dir(repo_root: Optional[Path] = None) -> Path:
    root = repo_root or find_repo_root()
    return root / "outputs" / "outreach" / "new_targets"


@dataclass
class Target:
    """A single outreach packet, read from disk."""

    slug: str
    path: Path
    status: Optional[dict[str, Any]] = None          # parsed status.json, or None
    send_log_text: Optional[str] = None              # raw send_log.md, or None
    present_files: set[str] = field(default_factory=set)

    # ---- convenience accessors (defensive: schemas vary across packets) ----
    @property
    def brand(self) -> str:
        val = self._s("brand", default="")
        return val or self._brand_from_send_log() or self.slug

    @property
    def goods_no(self) -> str:
        return self._s("goods_no", default="?")

    @property
    def product_name(self) -> str:
        return self._s("product_name", default="")

    @property
    def product_url(self) -> str:
        return self._s("product_url", default="")

    @property
    def state(self) -> str:
        """Top-level state. Falls back to send_log scan for legacy packets."""
        if self.status and self.status.get("state"):
            return str(self.status["state"])
        scanned = self._state_from_send_log()
        return scanned or "UNKNOWN"

    @property
    def has_status_json(self) -> bool:
        return self.status is not None

    @property
    def send(self) -> dict[str, Any]:
        if self.status and isinstance(self.status.get("send"), dict):
            return self.status["send"]
        return {}

    @property
    def follow_up_due(self) -> Optional[str]:
        """ISO-ish date string if recorded, else None. status.json first."""
        due = self.send.get("follow_up_due")
        if due:
            return str(due)
        return self._follow_up_from_send_log()

    @property
    def scheduled_or_sent(self) -> Optional[str]:
        s = self.send
        for key in ("scheduled_send_time", "scheduled_or_sent", "sent_time"):
            if s.get(key):
                return str(s[key])
        return None

    @property
    def recipient(self) -> Optional[str]:
        s = self.send
        for key in ("recipient_primary", "recipient", "recipient_confirmed"):
            if s.get(key):
                return str(s[key])
        return None

    @property
    def response(self) -> Any:
        if self.status:
            return self.status.get("response")
        return None

    @property
    def history(self) -> list[dict[str, Any]]:
        if self.status and isinstance(self.status.get("history"), list):
            return self.status["history"]
        return []

    @property
    def approved_angle(self) -> Any:
        if self.status:
            return self.status.get("approved_angle")
        return None

    @property
    def corpus_unique(self) -> Optional[int]:
        if self.status and isinstance(self.status.get("corpus"), dict):
            val = self.status["corpus"].get("unique")
            if isinstance(val, int):
                return val
        return None

    # ---- internals ----
    def _s(self, key: str, default: str = "") -> str:
        if self.status and self.status.get(key) is not None:
            return str(self.status[key])
        return default

    def _state_from_send_log(self) -> Optional[str]:
        if not self.send_log_text:
            return None
        # Legacy packets record status as a bold word, e.g. "**SCHEDULED**".
        for word in ("CLOSED", "SCHEDULED", "SENT", "FOLLOW_UP_DUE", "PARKED"):
            if re.search(rf"\b{word}\b", self.send_log_text):
                return word
        return None

    def _follow_up_from_send_log(self) -> Optional[str]:
        if not self.send_log_text:
            return None
        # Matches both prose ("Follow-up due: 2026.06.08") and table cells
        # ("| follow_up_due | **2026-06-05** |").
        m = re.search(
            r"follow[_ \-]?up[_ \-]?due[^0-9]*(20\d{2}[.\-]\d{1,2}[.\-]\d{1,2})",
            self.send_log_text,
            re.IGNORECASE,
        )
        if m:
            return m.group(1).replace(".", "-")
        return None

    def _brand_from_send_log(self) -> Optional[str]:
        if not self.send_log_text:
            return None
        # Prefer the "| brand / product | <brand> / ... |" table cell.
        m = re.search(r"\|\s*brand\s*/\s*product\s*\|\s*([^/|]+?)\s*/", self.send_log_text)
        if m:
            return m.group(1).strip()
        # Else the heading "# Send Log — <brand ...>" (case varies: Log/log).
        m = re.search(r"#\s*Send Log\s*[—\-]\s*(.+)", self.send_log_text, re.IGNORECASE)
        if m:
            return m.group(1).strip()
        return None


def load_target(packet_dir: Path) -> Target:
    """Load one packet directory (read-only)."""
    status: Optional[dict[str, Any]] = None
    status_path = packet_dir / "status.json"
    if status_path.exists():
        try:
            status = json.loads(status_path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError) as exc:  # corrupt -> surface, don't crash
            status = {"state": "STATUS_JSON_PARSE_ERROR", "_error": str(exc)}

    send_log_text: Optional[str] = None
    send_log_path = packet_dir / "send_log.md"
    if send_log_path.exists():
        try:
            send_log_text = send_log_path.read_text(encoding="utf-8")
        except OSError:
            send_log_text = None

    present = {f for f in PACKET_FILES if (packet_dir / f).exists()}
    if send_log_path.exists():
        present.add("send_log.md")
    if status_path.exists():
        present.add("status.json")
    if list(packet_dir.glob("*.pdf")):
        present.add("*.pdf")

    return Target(
        slug=packet_dir.name,
        path=packet_dir,
        status=status,
        send_log_text=send_log_text,
        present_files=present,
    )


def discover_targets(targets_dir: Optional[Path] = None) -> list[Target]:
    """All packet directories under the targets dir, sorted by slug."""
    tdir = targets_dir or default_targets_dir()
    if not tdir.exists():
        return []
    out: list[Target] = []
    for child in sorted(tdir.iterdir()):
        if child.is_dir():
            out.append(load_target(child))
    return out


def get_target(slug: str, targets_dir: Optional[Path] = None) -> Optional[Target]:
    tdir = targets_dir or default_targets_dir()
    packet = tdir / slug
    if packet.is_dir():
        return load_target(packet)
    # tolerant match: allow a unique prefix
    matches = [t for t in discover_targets(tdir) if t.slug.startswith(slug)]
    return matches[0] if len(matches) == 1 else None
