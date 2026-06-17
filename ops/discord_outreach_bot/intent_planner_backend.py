"""D4-2b: live local-Claude intent-planner backend (SELF — security-critical).

Drives the LOCAL Claude Code session (no Anthropic API, no ANTHROPIC_API_KEY) to
turn operator NL into a strict-JSON intent. It is a READ-ONLY classifier: plan
mode, ALL tools disabled (`--tools ""`), no session persistence, no slash
commands — the model may only emit JSON, never read/edit files or run bash.

Safety mirrors claude_code_local: explicit argv, `shell=False`, prompt via
stdin, scrubbed env, own process group with a Python-enforced timeout + group
kill, never `--bare`. On ANY failure (missing binary, timeout, nonzero exit,
unparseable output) it returns "" so the caller (intent_planner.plan_and_act)
falls back to the deterministic shortcut. It NEVER executes project code, edits,
sends, collects, renders, or publishes — it only asks for an intent JSON.
"""

from __future__ import annotations

import json
import os
import signal
import subprocess
from shutil import which
from typing import Optional

CLAUDE_BIN = "claude"

# narrow subprocess seam: tests patch THIS (not subprocess.Popen globally).
_PLANNER_POPEN = subprocess.Popen

_DEFAULT_TIMEOUT_S = 30
_GRACE_S = 5

# env vars scrubbed before spawn (rely on the logged-in OAuth/keychain session).
_SCRUBBED_ENV_VARS = (
    "ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_BASE_URL",
    "CLAUDE_CODE_API_KEY",
)


def is_available() -> bool:
    """True iff the `claude` binary is on PATH. Cheap; never invokes claude."""
    return which(CLAUDE_BIN) is not None


def build_argv() -> list[str]:
    """Read-only, no-tools, plan-mode intent classifier argv. No `--bare`."""
    return [
        CLAUDE_BIN, "-p",
        "--permission-mode", "plan",
        "--output-format", "json",
        "--tools", "",                      # disable ALL tools (pure text -> JSON)
        "--no-session-persistence",
        "--disable-slash-commands",
    ]


def scrub_env(env: Optional[dict] = None) -> dict:
    src = dict(os.environ if env is None else env)
    for key in _SCRUBBED_ENV_VARS:
        src.pop(key, None)
    return src


def _kill_group(proc: subprocess.Popen) -> None:
    try:
        os.killpg(os.getpgid(proc.pid), signal.SIGKILL)
    except (ProcessLookupError, PermissionError, OSError):
        try:
            proc.kill()
        except OSError:
            pass


def _unwrap(stdout: str) -> str:
    """Extract the model's text from claude's --output-format json envelope.

    {"type":"result","result":"<text>",...} -> "<text>". If stdout isn't that
    envelope, return it unchanged (caller parses it as the intent JSON).
    """
    text = (stdout or "").strip()
    if not text:
        return ""
    try:
        env = json.loads(text)
    except json.JSONDecodeError:
        return text
    if isinstance(env, dict):
        if "intent" in env:          # already the bare intent JSON
            return text
        res = env.get("result")
        if isinstance(res, str):
            return res.strip()
    return text


def run_planner(prompt_text: str, *, timeout_s: int = _DEFAULT_TIMEOUT_S
                ) -> Optional[str]:
    """Spawn claude as a JSON intent classifier. Returns the model's inner text
    (the intent JSON), or None on any failure."""
    if not is_available():
        return None
    try:
        proc = _PLANNER_POPEN(  # noqa: S603 - explicit argv, shell=False
            build_argv(),
            env=scrub_env(),
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            start_new_session=True,
        )
    except (OSError, ValueError):
        return None
    try:
        stdout, _stderr = proc.communicate(input=prompt_text, timeout=timeout_s)
    except subprocess.TimeoutExpired:
        _kill_group(proc)
        try:
            proc.communicate(timeout=_GRACE_S)
        except subprocess.TimeoutExpired:
            pass
        return None
    if proc.returncode not in (0, None):
        return None
    return _unwrap(stdout)


def local_claude_responder(messages: list[dict[str, str]]) -> str:
    """A `responder`-shaped callable for intent_planner.plan_and_act.

    Builds the classifier prompt (system instruction + operator text), runs the
    local planner, and returns the inner intent-JSON string. Returns "" on any
    failure so plan_and_act treats it as unparseable -> deterministic fallback.
    """
    import intent_planner as _ip  # lazy: avoid import cycle
    user_text = messages[-1]["content"] if messages else ""
    prompt = f"{_ip.INTENT_SYSTEM_PROMPT}\n\n[operator message]\n{user_text}"
    out = run_planner(prompt)
    return out or ""
