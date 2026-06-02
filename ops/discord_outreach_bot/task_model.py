"""Task + TaskRequest data model for the v0.3 orchestration core (M1).

Pure data layer — NO I/O, no imports of other bot modules, no tool execution.
A `TaskRequest` is the normalized input that any adapter (slash command, future
NL handler, system trigger) emits. The orchestrator turns one request into a
parent `Task` plus dependent child `Task`s.

Storage (task_store.py) is snapshot-append JSONL: every mutation appends the
FULL task via `to_record()`, and the current view is the last snapshot per
`task_id`. This module only knows how to (de)serialize and validate — it never
touches the filesystem.
"""

from __future__ import annotations

import datetime as _dt
import uuid
from dataclasses import asdict, dataclass, field
from typing import Any, Callable, Optional

# --- closed vocabularies -----------------------------------------------------
WORKFLOWS = ("outreach", "instagram", "ops")
TASK_STATUSES = (
    "queued", "running", "blocked", "needs_approval", "pending_review",
    "done", "failed", "cancelled",
)
GATES = ("green", "red")
SOURCES = ("slash", "discord_nl", "system", "test")


def utc_now_str(now: Optional[Callable[[], _dt.datetime]] = None) -> str:
    """UTC timestamp string, matching approval_log's format. `now` injectable."""
    ts = now() if now else _dt.datetime.now(_dt.timezone.utc)
    return ts.astimezone(_dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def gen_id(prefix: str = "t") -> str:
    """Short unique id. Tests assert structure/relationships, not literal ids."""
    return f"{prefix}_{uuid.uuid4().hex[:12]}"


@dataclass
class TaskRequest:
    """Normalized request entering the orchestrator (input-adapter output)."""

    goal: str
    workflow: str = "outreach"
    source: str = "system"
    requested_by: str = "system"
    raw_text: Optional[str] = None
    target_ref: Optional[str] = None
    slots: dict[str, Any] = field(default_factory=dict)
    request_id: str = field(default_factory=lambda: gen_id("req"))
    ts_utc: str = field(default_factory=utc_now_str)

    def validate(self) -> None:
        if self.workflow not in WORKFLOWS:
            raise ValueError(f"workflow must be one of {WORKFLOWS}, got {self.workflow!r}")
        if self.source not in SOURCES:
            raise ValueError(f"source must be one of {SOURCES}, got {self.source!r}")
        if not self.goal:
            raise ValueError("TaskRequest.goal must be non-empty")

    def to_record(self) -> dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_record(cls, rec: dict[str, Any]) -> "TaskRequest":
        known = {f for f in cls.__dataclass_fields__}  # noqa: C416
        return cls(**{k: v for k, v in rec.items() if k in known})


@dataclass
class Task:
    """One unit of orchestrated work. Snapshot-serialized via to_record()."""

    goal: str
    workflow: str = "outreach"
    assigned_agent: str = ""
    requested_by: str = "system"
    parent_task_id: Optional[str] = None
    target_slug: Optional[str] = None
    intended_stage: Optional[str] = None
    status: str = "queued"
    gate: str = "green"
    approval_required: bool = False
    dependencies: list[str] = field(default_factory=list)
    inputs: dict[str, Any] = field(default_factory=dict)
    expected_outputs: list[str] = field(default_factory=list)
    result_summary: Optional[str] = None
    artifact_paths: list[str] = field(default_factory=list)
    approval_ref: Optional[str] = None
    task_id: str = field(default_factory=lambda: gen_id("task"))
    created_at: str = field(default_factory=utc_now_str)
    updated_at: str = field(default_factory=utc_now_str)

    # ---- validation ----
    def validate(self) -> None:
        if self.workflow not in WORKFLOWS:
            raise ValueError(f"workflow must be one of {WORKFLOWS}, got {self.workflow!r}")
        if self.status not in TASK_STATUSES:
            raise ValueError(f"status must be one of {TASK_STATUSES}, got {self.status!r}")
        if self.gate not in GATES:
            raise ValueError(f"gate must be one of {GATES}, got {self.gate!r}")
        if not self.assigned_agent:
            raise ValueError("Task.assigned_agent must be set")
        if self.gate == "red" and not self.approval_required:
            raise ValueError("a red-gate task must have approval_required=True")

    # ---- lifecycle helpers (pure; caller persists the snapshot) ----
    def touch(self, now: Optional[Callable[[], _dt.datetime]] = None) -> "Task":
        self.updated_at = utc_now_str(now)
        return self

    def is_terminal(self) -> bool:
        return self.status in ("done", "failed", "cancelled")

    # ---- (de)serialization ----
    def to_record(self) -> dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_record(cls, rec: dict[str, Any]) -> "Task":
        known = {f for f in cls.__dataclass_fields__}  # noqa: C416
        return cls(**{k: v for k, v in rec.items() if k in known})
