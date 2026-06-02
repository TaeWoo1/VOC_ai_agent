"""Discord message formatting helpers (v0.2) — pure, read-only, no discord.py.

These functions wrap the v0.1 read-only core (status_reader / prompt_builder /
followups) and return compact, operator-friendly strings that the Discord
transport posts back. They have NO discord.py dependency so they can be unit
tested without a network/bot connection.

Nothing here writes to a packet folder. The only thing v0.2 ever writes is the
append-only approvals log (approval_log.py) and, when a generated prompt is too
long for one Discord message, a copy under generated_prompts/ (NOT a packet
folder).
"""

from __future__ import annotations

import datetime as _dt
import re
from pathlib import Path
from typing import Optional

import followups as _followups
import prompt_builder as _pb
import status_reader as _sr
# Reuse the CLI's single source of truth for packet validation rules.
from cli import _REQUIRED_AT, _ordinal  # noqa: E402

# Discord hard-caps a message at 2000 chars; leave headroom for code fences.
DISCORD_LIMIT = 2000
_PROMPT_INLINE_LIMIT = 1900


def _generated_dir(repo_root: Optional[Path] = None) -> Path:
    root = repo_root or _sr.find_repo_root()
    return root / "ops" / "discord_outreach_bot" / "generated_prompts"


def format_list(targets_dir=None) -> str:
    """All targets with gate, state, and recipient / follow-up if available."""
    targets = _sr.discover_targets(targets_dir)
    if not targets:
        return "No outreach targets found."
    lines = [f"**Outreach targets ({len(targets)})**"]
    for t in targets:
        gate = _pb.step_for(t.state).gate
        extra = []
        if t.recipient:
            extra.append(f"→ {t.recipient}")
        if t.follow_up_due:
            extra.append(f"follow-up {t.follow_up_due}")
        tail = f"  ({'; '.join(extra)})" if extra else ""
        lines.append(f"{gate} `{t.state}` — {t.brand} `{t.slug}`{tail}")
    return "\n".join(lines)


def format_status(slug: str, targets_dir=None) -> str:
    t = _sr.get_target(slug, targets_dir)
    if not t:
        return f"No packet matching `{slug}`."
    step = _pb.step_for(t.state)
    lines = [f"**{t.brand}** `{t.slug}`", f"{step.gate} state: `{t.state}`"]
    if t.corpus_unique is not None:
        lines.append(f"corpus: {t.corpus_unique}")
    if t.approved_angle:
        lines.append(f"angle: {_pb._angle_str(t.approved_angle)}")
    if t.recipient:
        lines.append(f"recipient: {t.recipient}")
    if t.scheduled_or_sent:
        lines.append(f"scheduled/sent: {t.scheduled_or_sent}")
    if t.follow_up_due:
        lines.append(f"follow-up due: {t.follow_up_due}")
    lines.append(f"response: {t.response if t.response else '(none yet)'}")
    if not t.has_status_json:
        lines.append("_legacy packet — state inferred from send_log.md_")
    lines.append(f"next: {_pb.next_action_line(t.state)}")
    return "\n".join(lines)


def format_next(slug: str, targets_dir=None) -> str:
    t = _sr.get_target(slug, targets_dir)
    if not t:
        return f"No packet matching `{slug}`."
    step = _pb.step_for(t.state)
    lines = [
        f"**{t.brand}** `{t.slug}` is at {step.gate} `{t.state}`",
        f"next: {_pb.next_action_line(t.state)}",
        "",
        step.instruction,
    ]
    if step.gate == _pb.RED and step.command:
        lines.append(f"\n⛔ `{step.command}` needs operator approval: {step.gate_note}")
    return "\n".join(lines)


def format_followups(today: Optional[_dt.date] = None, targets_dir=None) -> str:
    today = today or _dt.date.today()
    rows = _followups.collect_followups(today, targets_dir)
    return _followups.format_followups(rows, today)


def format_validate(slug: str, targets_dir=None) -> str:
    """Compact packet validation (mirrors the CLI; never raises/exits)."""
    t = _sr.get_target(slug, targets_dir)
    if not t:
        return f"No packet matching `{slug}`."
    ord_state = _ordinal(t.state)
    lines = [f"**validate** {t.brand} `{t.slug}` @ `{t.state}`"]
    problems = 0
    if not t.has_status_json:
        lines.append("⚠ status.json missing (legacy) — state inferred from send_log.md")
    checked = False
    for req_state, files in _REQUIRED_AT.items():
        if ord_state >= _ordinal(req_state):
            checked = True
            for f in files:
                ok = (f in t.present_files) or (
                    f.startswith("*.") and bool(list(t.path.glob(f))))
                if not ok:
                    problems += 1
                lines.append(f"{'✅' if ok else '❌'} `{f}` (req ≥ {req_state})")
    if not checked:
        lines.append("(no packet files required yet at this state)")
    lines.append(
        "RESULT: " + ("✅ OK" if problems == 0 else f"❌ {problems} file(s) MISSING"))
    return "\n".join(lines)


# --- prompt delivery ---------------------------------------------------------

def _safe_stage(stage: Optional[str]) -> str:
    if not stage:
        return "auto"
    return re.sub(r"[^A-Za-z0-9_]+", "_", stage.replace("outreach:", "")).strip("_") or "auto"


def save_prompt(slug: str, stage: Optional[str], prompt: str,
                generated_dir: Optional[Path] = None) -> Path:
    """Write a generated prompt under generated_prompts/ (NOT a packet folder)."""
    gdir = Path(generated_dir) if generated_dir else _generated_dir()
    gdir.mkdir(parents=True, exist_ok=True)
    fname = f"{slug}__{_safe_stage(stage)}.md"
    path = gdir / fname
    path.write_text(prompt, encoding="utf-8")
    return path


def build_prompt_delivery(slug: str, stage: Optional[str] = None, targets_dir=None,
                          generated_dir: Optional[Path] = None,
                          inline_limit: int = _PROMPT_INLINE_LIMIT) -> dict:
    """Generate the next prompt and decide how Discord should deliver it.

    Returns a dict:
      {"ok": False, "message": "..."}                      # target not found
      {"ok": True, "kind": "inline", "prompt": "...",
       "message": "<copyable block>"}                       # short enough
      {"ok": True, "kind": "file", "prompt": "...",
       "path": "...", "message": "..."}                     # saved to disk
    """
    t = _sr.get_target(slug, targets_dir)
    if not t:
        return {"ok": False, "message": f"No packet matching `{slug}`."}
    prompt = _pb.build_prompt(t, stage=stage)
    if len(prompt) <= inline_limit:
        return {
            "ok": True,
            "kind": "inline",
            "prompt": prompt,
            "message": f"```\n{prompt}\n```",
        }
    path = save_prompt(t.slug, stage, prompt, generated_dir=generated_dir)
    return {
        "ok": True,
        "kind": "file",
        "prompt": prompt,
        "path": str(path),
        "message": (f"Prompt for `{t.slug}` is {len(prompt)} chars (over the "
                    f"{DISCORD_LIMIT}-char Discord limit). Saved to:\n`{path}`\n"
                    "Open it locally and copy into Claude Code."),
    }
