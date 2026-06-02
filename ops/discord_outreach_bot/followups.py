"""Follow-up due tracking across all packets (read-only).

Scans every target, picks the ones that have been SCHEDULED/SENT, and reports
each one's follow-up due date and days remaining relative to `today`. The
agent never acts on these — it surfaces them so the operator decides whether
to authorize an outreach:follow_up (a 🔴 gate).
"""

from __future__ import annotations

import datetime as _dt
import re
from dataclasses import dataclass
from typing import Optional

from status_reader import discover_targets

_SCHEDULED_STATES = {"SCHEDULED", "SENT", "FOLLOW_UP_DUE"}


@dataclass
class FollowUp:
    slug: str
    brand: str
    state: str
    recipient: Optional[str]
    follow_up_due: Optional[str]
    due_date: Optional[_dt.date]
    days_remaining: Optional[int]   # negative = overdue
    has_response: bool


def _parse_date(raw: Optional[str]) -> Optional[_dt.date]:
    if not raw:
        return None
    m = re.search(r"(20\d{2})[.\-/](\d{1,2})[.\-/](\d{1,2})", raw)
    if not m:
        return None
    try:
        return _dt.date(int(m.group(1)), int(m.group(2)), int(m.group(3)))
    except ValueError:
        return None


def collect_followups(today: _dt.date, targets_dir=None) -> list[FollowUp]:
    rows: list[FollowUp] = []
    for t in discover_targets(targets_dir):
        if t.state not in _SCHEDULED_STATES:
            continue
        due_raw = t.follow_up_due
        due_date = _parse_date(due_raw)
        days = (due_date - today).days if due_date else None
        rows.append(
            FollowUp(
                slug=t.slug,
                brand=t.brand,
                state=t.state,
                recipient=t.recipient,
                follow_up_due=due_raw,
                due_date=due_date,
                days_remaining=days,
                has_response=bool(t.response),
            )
        )
    # Soonest-due first; undated last.
    rows.sort(key=lambda r: (r.due_date is None, r.due_date or _dt.date.max))
    return rows


def format_followups(rows: list[FollowUp], today: _dt.date) -> str:
    if not rows:
        return "No SCHEDULED/SENT packets with a follow-up date found."
    lines = [f"Follow-ups (today = {today.isoformat()}):", ""]
    for r in rows:
        if r.has_response:
            tag = "↩ replied"
        elif r.days_remaining is None:
            tag = "  no due date"
        elif r.days_remaining < 0:
            tag = f"⚠ OVERDUE by {-r.days_remaining}d"
        elif r.days_remaining == 0:
            tag = "● DUE TODAY"
        else:
            tag = f"  in {r.days_remaining}d"
        due = r.follow_up_due or "—"
        rcpt = f" → {r.recipient}" if r.recipient else ""
        lines.append(f"  [{tag}] {r.brand} ({r.slug})  due {due}  [{r.state}]{rcpt}")
    lines.append("")
    lines.append("outreach:follow_up is a 🔴 gate — surface only; operator authorizes any re-send.")
    return "\n".join(lines)
