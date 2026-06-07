"""D6-2a tests for the local Claude Code copilot backend.

Every test patches the _COPILOT_POPEN seam (and shutil-which / os.killpg where
relevant) — real Claude is NEVER run and no real subprocess is ever spawned.
Token values are never printed; tests assert on key NAMES only.
"""

from __future__ import annotations

import json
import subprocess
import tempfile
from pathlib import Path

import pytest

import copilot_backend as backend


class FakeProc:
    """Records Popen args/kwargs and scripts communicate() behavior."""

    def __init__(self, *, stdout: str = "", returncode: int = 0,
                 timeout_on_first: bool = False):
        self.stdout = stdout
        self.returncode = returncode
        self.timeout_on_first = timeout_on_first
        self.pid = 4242
        self.communicate_calls: list[dict] = []
        self.killed = False

    def communicate(self, input=None, timeout=None):
        self.communicate_calls.append({"input": input, "timeout": timeout})
        if self.timeout_on_first and len(self.communicate_calls) == 1:
            raise subprocess.TimeoutExpired(cmd="claude", timeout=timeout)
        return self.stdout, ""

    def kill(self):
        self.killed = True


def _patch_popen(monkeypatch, proc: FakeProc) -> dict:
    captured: dict = {}

    def _fake_popen(argv, **kwargs):
        captured["argv"] = argv
        captured["kwargs"] = kwargs
        return proc

    monkeypatch.setattr(backend, "_COPILOT_POPEN", _fake_popen)
    monkeypatch.setattr(backend, "which", lambda name: "/usr/local/bin/claude")
    return captured


def _envelope(text: str) -> str:
    return json.dumps({"type": "result", "result": text})


# --------------------------------------------------------------------------- #
# 1./2. argv hardening
# --------------------------------------------------------------------------- #


def test_build_argv_contains_all_hardening_args():
    argv = backend.build_argv()
    assert argv[0] == "claude"
    assert "-p" in argv
    i = argv.index("--permission-mode")
    assert argv[i + 1] == "plan"
    j = argv.index("--output-format")
    assert argv[j + 1] == "json"
    k = argv.index("--tools")
    assert argv[k + 1] == ""                 # ALL tools disabled
    assert "--no-session-persistence" in argv
    assert "--disable-slash-commands" in argv


def test_build_argv_has_no_bare():
    assert "--bare" not in backend.build_argv()


# --------------------------------------------------------------------------- #
# 3.-6. spawn discipline
# --------------------------------------------------------------------------- #


def test_respond_uses_explicit_argv_and_no_shell(monkeypatch):
    proc = FakeProc(stdout=_envelope("ok"))
    captured = _patch_popen(monkeypatch, proc)
    assert backend.respond("질문") == "ok"
    assert isinstance(captured["argv"], list)
    assert captured["argv"] == backend.build_argv()
    assert "shell" not in captured["kwargs"]          # shell=False by default


def test_prompt_goes_through_communicate_stdin(monkeypatch):
    proc = FakeProc(stdout=_envelope("ok"))
    captured = _patch_popen(monkeypatch, proc)
    backend.respond("운영자 프롬프트 본문")
    assert captured["kwargs"]["stdin"] == subprocess.PIPE
    assert proc.communicate_calls[0]["input"] == "운영자 프롬프트 본문"


def test_respond_uses_start_new_session(monkeypatch):
    proc = FakeProc(stdout=_envelope("ok"))
    captured = _patch_popen(monkeypatch, proc)
    backend.respond("질문")
    assert captured["kwargs"]["start_new_session"] is True


def test_respond_cwd_is_neutral_tempdir_not_repo(monkeypatch):
    proc = FakeProc(stdout=_envelope("ok"))
    captured = _patch_popen(monkeypatch, proc)
    backend.respond("질문")
    cwd = Path(captured["kwargs"]["cwd"])
    assert cwd == Path(tempfile.gettempdir())
    repo_root = Path(__file__).resolve().parents[2]
    assert cwd != repo_root


# --------------------------------------------------------------------------- #
# 7.-9. env scrubbing (key NAMES only; values never printed)
# --------------------------------------------------------------------------- #


def test_scrub_env_removes_denylist_secrets():
    env = {k: "x" for k in (
        "ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_BASE_URL",
        "CLAUDE_CODE_API_KEY", "OPENAI_API_KEY", "GOOGLE_API_KEY",
        "GEMINI_API_KEY", "DISCORD_BOT_TOKEN")}
    env["PATH"] = "/usr/bin"
    out = backend.scrub_env(env)
    for k in env:
        if k == "PATH":
            continue
        assert k not in out, f"denylist var survived: {k}"
    assert out["PATH"] == "/usr/bin"


def test_scrub_env_removes_suffix_secrets():
    env = {"FOO_API_KEY": "x", "BAR_AUTH_TOKEN": "x", "BAZ_SECRET": "x",
           "QUX_PASSWORD": "x", "HOME": "/Users/op"}
    out = backend.scrub_env(env)
    assert set(out) == {"HOME"}


def test_scrub_env_preserves_unrelated_vars():
    env = {"PATH": "/usr/bin", "LANG": "ko_KR.UTF-8", "PYENV_VERSION": "3.12",
           "TOKENIZERS_PARALLELISM": "false"}   # not a credential suffix
    assert backend.scrub_env(env) == env


def test_respond_passes_scrubbed_env_to_popen(monkeypatch):
    proc = FakeProc(stdout=_envelope("ok"))
    captured = _patch_popen(monkeypatch, proc)
    monkeypatch.setenv("ANTHROPIC_API_KEY", "x")
    monkeypatch.setenv("DISCORD_BOT_TOKEN", "x")
    monkeypatch.setenv("MY_PROVIDER_API_KEY", "x")
    backend.respond("질문")
    child_env = captured["kwargs"]["env"]
    assert "ANTHROPIC_API_KEY" not in child_env
    assert "DISCORD_BOT_TOKEN" not in child_env
    assert "MY_PROVIDER_API_KEY" not in child_env


# --------------------------------------------------------------------------- #
# 10.-12. output unwrap
# --------------------------------------------------------------------------- #


def test_unwrap_json_result_envelope(monkeypatch):
    proc = FakeProc(stdout=_envelope("조언 본문입니다."))
    _patch_popen(monkeypatch, proc)
    assert backend.respond("질문") == "조언 본문입니다."


def test_non_json_stdout_returned_stripped(monkeypatch):
    proc = FakeProc(stdout="  plain text answer \n")
    _patch_popen(monkeypatch, proc)
    assert backend.respond("질문") == "plain text answer"


def test_empty_stdout_returns_empty(monkeypatch):
    proc = FakeProc(stdout="   ")
    _patch_popen(monkeypatch, proc)
    assert backend.respond("질문") == ""


# --------------------------------------------------------------------------- #
# 13.-16. failure paths -> ""
# --------------------------------------------------------------------------- #


def test_missing_binary_returns_empty(monkeypatch):
    monkeypatch.setattr(backend, "which", lambda name: None)
    called = {"popen": False}

    def _never(*a, **k):
        called["popen"] = True
        raise AssertionError("Popen must not be reached")

    monkeypatch.setattr(backend, "_COPILOT_POPEN", _never)
    assert backend.respond("질문") == ""
    assert called["popen"] is False


def test_popen_oserror_returns_empty(monkeypatch):
    monkeypatch.setattr(backend, "which", lambda name: "/usr/local/bin/claude")

    def _boom(*a, **k):
        raise OSError("spawn failed")

    monkeypatch.setattr(backend, "_COPILOT_POPEN", _boom)
    assert backend.respond("질문") == ""


def test_nonzero_returncode_returns_empty(monkeypatch):
    proc = FakeProc(stdout=_envelope("ignored"), returncode=2)
    _patch_popen(monkeypatch, proc)
    assert backend.respond("질문") == ""


def test_timeout_triggers_group_kill_and_returns_empty(monkeypatch):
    proc = FakeProc(stdout="", timeout_on_first=True)
    _patch_popen(monkeypatch, proc)
    killed = {}
    monkeypatch.setattr(backend.os, "getpgid", lambda pid: 777)
    monkeypatch.setattr(backend.os, "killpg",
                        lambda pgid, sig: killed.update(pgid=pgid, sig=sig))
    assert backend.respond("질문") == ""
    assert killed["pgid"] == 777
    assert killed["sig"] == backend.signal.SIGKILL
    assert len(proc.communicate_calls) == 2     # grace-period reap happened


def test_custom_and_env_timeout_used(monkeypatch):
    proc = FakeProc(stdout=_envelope("ok"))
    _patch_popen(monkeypatch, proc)
    backend.respond("질문", timeout_seconds=7)
    assert proc.communicate_calls[0]["timeout"] == 7

    proc2 = FakeProc(stdout=_envelope("ok"))
    _patch_popen(monkeypatch, proc2)
    monkeypatch.setenv("AGENT_OPERATOR_COPILOT_TIMEOUT_SECONDS", "11")
    backend.respond("질문")
    assert proc2.communicate_calls[0]["timeout"] == 11

    proc3 = FakeProc(stdout=_envelope("ok"))
    _patch_popen(monkeypatch, proc3)
    monkeypatch.setenv("AGENT_OPERATOR_COPILOT_TIMEOUT_SECONDS", "not-an-int")
    backend.respond("질문")
    assert proc3.communicate_calls[0]["timeout"] == 30   # default


# --------------------------------------------------------------------------- #
# 17. resource cap
# --------------------------------------------------------------------------- #


def test_oversized_stdout_truncated_before_unwrap(monkeypatch):
    big = "가" * 50_000
    proc = FakeProc(stdout=big)
    _patch_popen(monkeypatch, proc)
    out = backend.respond("질문")
    assert len(out) <= backend._MAX_STDOUT_CHARS
    assert out == big[: backend._MAX_STDOUT_CHARS]


def test_oversized_json_envelope_falls_back_safely(monkeypatch):
    # Truncation may cut the JSON envelope mid-way; the result must still be a
    # plain (capped) string, never an exception.
    big = _envelope("나" * 30_000)
    proc = FakeProc(stdout=big)
    _patch_popen(monkeypatch, proc)
    out = backend.respond("질문")
    assert isinstance(out, str)
    assert len(out) <= backend._MAX_STDOUT_CHARS


# --------------------------------------------------------------------------- #
# 18. never raises
# --------------------------------------------------------------------------- #


@pytest.mark.parametrize("bad_prompt", [None, "", "   ", 42])
def test_bad_prompt_returns_empty_never_raises(monkeypatch, bad_prompt):
    monkeypatch.setattr(backend, "which", lambda name: "/usr/local/bin/claude")
    assert backend.respond(bad_prompt) == ""  # type: ignore[arg-type]


def test_communicate_unexpected_exception_returns_empty(monkeypatch):
    class WeirdProc(FakeProc):
        def communicate(self, input=None, timeout=None):
            raise RuntimeError("pipe exploded")

    proc = WeirdProc()
    _patch_popen(monkeypatch, proc)
    monkeypatch.setattr(backend.os, "getpgid", lambda pid: 777)
    monkeypatch.setattr(backend.os, "killpg", lambda pgid, sig: None)
    assert backend.respond("질문") == ""


# --------------------------------------------------------------------------- #
# 19. static guards
# --------------------------------------------------------------------------- #


def test_stdlib_only_and_no_forbidden_imports():
    src = Path(backend.__file__).read_text(encoding="utf-8")
    forbidden = (
        "import discord",
        "from discord",
        "action_dispatch",
        "task_runner",
        "task_inputs",
        "agent_dispatch",
        "operator_status",
        "task_store",
        "smtplib",
        "googleapiclient",
        "import requests",
        "import httpx",
        "urllib.request",
        "import socket",
        "anthropic",
        "instagram",
    )
    hits = [tok for tok in forbidden if tok in src]
    assert not hits, f"forbidden import/reference in copilot_backend: {hits}"


def test_no_write_like_calls():
    src = Path(backend.__file__).read_text(encoding="utf-8")
    write_calls = (
        "write_text(",
        "write_bytes(",
        ".mkdir(",
        ".unlink(",
        ".rename(",
        "os.remove",
        "shutil.rmtree",
        "open(",
        "NamedTemporaryFile",
        "TemporaryFile",
        "mkstemp",
    )
    hits = [tok for tok in write_calls if tok in src]
    assert not hits, f"write-like call in copilot_backend: {hits}"


# --------------------------------------------------------------------------- #
# 20. default wiring state (updated for D6-2b)
# --------------------------------------------------------------------------- #


def test_task_discord_adapter_default_state_is_inert():
    """D6-2a pinned 'no copilot_backend reference at all'; D6-2b deliberately
    adds the env-gated resolver. The standing invariant is now: the test seam
    defaults to None and the backend is reachable ONLY via the resolver."""
    import inspect

    import task_discord_adapter as adapter

    assert adapter._COPILOT_RESPONDER is None
    src = inspect.getsource(adapter)
    # backend referenced exactly through the resolver, never called directly
    assert "_copilot_backend.respond" in inspect.getsource(
        adapter._resolve_copilot_responder)
    assert "import subprocess" not in src
