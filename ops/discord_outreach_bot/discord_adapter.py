"""Discord adapter — ORIGINAL v0.1 DESIGN STUB. SUPERSEDED by discord_bot.py.

The implemented v0.2 transport now lives in:
  - discord_bot.py          (slash commands + guarded discord.py wiring)
  - discord_formatting.py   (compact, testable Discord strings)
  - approval_log.py         (append-only approvals log)

This file is kept only as the original design note. Prefer the modules above.

`discord.py` is intentionally NOT a dependency in v0.1 (it is not installed in
this repo's environment). v0.1 is the CLI in cli.py. This module documents,
in code, exactly how Discord slash commands will call the SAME read-only
functions later — so v0.2 is a thin transport layer, not a rewrite.

The hard invariant carried into v0.2: the bot stays READ-ONLY and approval-
gated. Discord buttons may *capture an operator decision*, but the actual
🔴 actions (live collection, PDF render, send, follow-up) still run as
operator-authorized Claude Code turns — the bot never performs them itself.
"""

from __future__ import annotations

import datetime as _dt

import followups as _followups
import prompt_builder as _pb
import status_reader as _sr

# --- Planned slash command -> existing function mapping ----------------------
# Each Discord command is a thin wrapper that returns a string to post back.
# These functions already work today (they power the CLI); v0.2 only adds the
# Discord transport around them.

SLASH_COMMANDS = {
    "/targets": "list_targets",          # -> render_list_targets()
    "/status <slug>": "show_status",     # -> render_status(slug)
    "/next <slug>": "next_action",       # -> render_next_action(slug)
    "/prompt <slug> [stage]": "build_prompt",   # -> render_prompt(slug, stage)
    "/followups": "followups",           # -> render_followups()
    "/validate <slug>": "validate_packet",
}


def render_list_targets(targets_dir=None) -> str:
    lines = []
    for t in _sr.discover_targets(targets_dir):
        gate = _pb.step_for(t.state).gate
        lines.append(f"{gate} `{t.state}` — {t.brand} (`{t.slug}`)")
    return "\n".join(lines) or "No targets found."


def render_next_action(slug: str, targets_dir=None) -> str:
    t = _sr.get_target(slug, targets_dir)
    if not t:
        return f"No packet matching `{slug}`."
    return f"**{t.brand}** is at `{t.state}`\nNext: {_pb.next_action_line(t.state)}"


def render_prompt(slug: str, stage: str | None = None, targets_dir=None) -> str:
    t = _sr.get_target(slug, targets_dir)
    if not t:
        return f"No packet matching `{slug}`."
    # Discord messages cap at 2000 chars; v0.2 will post long prompts as a file
    # attachment or split into chunks. Placeholder returns the raw prompt.
    return _pb.build_prompt(t, stage=stage)


def render_followups(targets_dir=None) -> str:
    today = _dt.date.today()
    rows = _followups.collect_followups(today, targets_dir)
    return _followups.format_followups(rows, today)


# --- v0.2 approval-button flow (design note, not implemented) ----------------
#
# For a 🔴 gate (collect_execute / render_pdf / prepare_send / follow_up):
#   1. Bot posts the generated prompt + an "Approve / Hold" button pair.
#   2. On Approve, the bot records WHO approved + WHEN to an append-only
#      approvals log (NOT into the packet status.json — that stays the agent's
#      job, written during the authorized Claude Code turn).
#   3. The operator (or a future local Claude Code runner) runs the move in a
#      real turn. The bot never executes the 🔴 action itself.
#
# This keeps every human approval gate intact while removing the copy-paste.
def run_bot() -> None:  # pragma: no cover - intentionally unimplemented in v0.1
    raise NotImplementedError(
        "Discord transport is deferred to v0.2. v0.1 ships the CLI (cli.py). "
        "discord.py is not a v0.1 dependency. See README.md 'Next steps for v0.2'."
    )
