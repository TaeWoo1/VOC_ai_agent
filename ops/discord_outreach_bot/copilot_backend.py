"""D6-2a: local Claude Code responder backend for the operator copilot (SELF —
security-critical). UNWIRED in this slice: nothing imports it yet and
task_discord_adapter._COPILOT_RESPONDER stays None until D6-2b.

A pure text->text subprocess wrapper, sibling of intent_planner_backend (which
it deliberately does NOT modify or import). It receives the FINISHED prompt
from operator_copilot.build_prompt and returns the model's display text. It
builds no context, parses no actions, reads no repo files (the only
filesystem-ish probe is shutil.which for the binary), and writes nothing.

Hardening mirrors intent_planner_backend, plus two strengthenings:
  - neutral cwd: spawn from tempfile.gettempdir() so the child cannot pick up
    this repo's .claude/ settings/hooks or CLAUDE.md;
  - resource cap: raw stdout is truncated to ~16k chars before unwrap (the
    1800-char display cap stays in operator_copilot).
Drive the LOCAL Claude Code session (no Anthropic API key): plan mode, ALL
tools disabled (`--tools ""`), no session persistence, no slash commands,
never `--bare`. Explicit argv, shell=False, prompt via stdin (no temp prompt
files), scrubbed env (provider keys + the bot's own DISCORD_BOT_TOKEN never
reach the child; token VALUES are never printed), own process group with a
Python-enforced timeout + group kill.

On ANY failure (missing binary, spawn error, timeout, nonzero exit, empty
output) respond() returns "" and never raises — operator_copilot maps empty to
None, so the 0d hook falls through to the deterministic flow unchanged.
"""

from __future__ import annotations

import json
import os
import signal
import subprocess
import tempfile
from shutil import which
from typing import Optional

CLAUDE_BIN = "claude"

# narrow subprocess seam: tests patch THIS (not subprocess.Popen globally).
_COPILOT_POPEN = subprocess.Popen

_TIMEOUT_ENV = "AGENT_OPERATOR_COPILOT_TIMEOUT_SECONDS"
_DEFAULT_TIMEOUT_S = 30
_GRACE_S = 5

# resource cap on raw stdout (display cap lives in operator_copilot).
_MAX_STDOUT_CHARS = 16_000

# env vars scrubbed before spawn (rely on the logged-in OAuth/keychain
# session). Names only — values are never read into this module's output.
_SCRUBBED_ENV_VARS = (
    "ANTHROPIC_API_KEY",
    "ANTHROPIC_AUTH_TOKEN",
    "ANTHROPIC_BASE_URL",
    "CLAUDE_CODE_API_KEY",
    "OPENAI_API_KEY",
    "GOOGLE_API_KEY",
    "GEMINI_API_KEY",
    "DISCORD_BOT_TOKEN",
)
# ...plus a deterministic suffix sweep for future provider credentials.
_SCRUBBED_SUFFIXES = ("_API_KEY", "_AUTH_TOKEN", "_SECRET", "_PASSWORD")


def is_available() -> bool:
    """True iff the `claude` binary is on PATH. Cheap; never invokes claude."""
    return which(CLAUDE_BIN) is not None


def build_argv() -> list[str]:
    """Read-only, no-tools, plan-mode advisory responder argv. No `--bare`."""
    return [
        CLAUDE_BIN, "-p",
        "--permission-mode", "plan",
        "--output-format", "json",
        "--tools", "",                      # disable ALL tools (pure text out)
        "--no-session-persistence",
        "--disable-slash-commands",
    ]


def scrub_env(env: Optional[dict[str, str]] = None) -> dict[str, str]:
    """Copy of the env with provider/bot credentials removed (denylist +
    suffix sweep). Unrelated vars are preserved."""
    src = dict(os.environ if env is None else env)
    for key in _SCRUBBED_ENV_VARS:
        src.pop(key, None)
    for key in [k for k in src if k.endswith(_SCRUBBED_SUFFIXES)]:
        src.pop(key, None)
    return src


def _timeout_s(timeout_seconds: Optional[int]) -> int:
    if timeout_seconds is not None and timeout_seconds > 0:
        return timeout_seconds
    raw = os.environ.get(_TIMEOUT_ENV, "")
    try:
        val = int(raw)
        return val if val > 0 else _DEFAULT_TIMEOUT_S
    except ValueError:
        return _DEFAULT_TIMEOUT_S


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

    {"type":"result","result":"<text>",...} -> "<text>". Non-JSON stdout is
    returned stripped (already resource-capped by the caller)."""
    text = (stdout or "").strip()
    if not text:
        return ""
    try:
        env = json.loads(text)
    except json.JSONDecodeError:
        return text
    if isinstance(env, dict):
        res = env.get("result")
        if isinstance(res, str):
            return res.strip()
    return text


def respond(prompt: str, *, timeout_seconds: Optional[int] = None) -> str:
    """Spawn local Claude Code as an advisory text responder.

    Returns the model's display text, or "" on ANY failure. Never raises."""
    if not isinstance(prompt, str) or not prompt.strip():
        return ""
    if not is_available():
        return ""
    try:
        proc = _COPILOT_POPEN(  # noqa: S603 - explicit argv, shell=False
            build_argv(),
            env=scrub_env(),
            cwd=tempfile.gettempdir(),       # neutral: no repo .claude/ pickup
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            start_new_session=True,
        )
    except (OSError, ValueError):
        return ""
    try:
        stdout, _stderr = proc.communicate(
            input=prompt, timeout=_timeout_s(timeout_seconds))
    except subprocess.TimeoutExpired:
        _kill_group(proc)
        try:
            proc.communicate(timeout=_GRACE_S)
        except subprocess.TimeoutExpired:
            pass
        return ""
    except Exception:
        _kill_group(proc)
        return ""
    if proc.returncode not in (0, None):
        return ""
    return _unwrap((stdout or "")[:_MAX_STDOUT_CHARS])
