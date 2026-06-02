"""Tests for `scripts/open_oy_chromium_debug.py`.

Smoke-only: argument parsing, binary detection, the
`is_chrome_debug_running` short-circuit, and the docs-aligned exit
codes. We never actually launch a browser here — the live launch
path is covered manually by the operator.
"""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[2]
SCRIPT_PATH = REPO_ROOT / "scripts" / "open_oy_chromium_debug.py"


@pytest.fixture(scope="module")
def mod():
    spec = importlib.util.spec_from_file_location(
        "open_oy_chromium_debug", SCRIPT_PATH,
    )
    m = importlib.util.module_from_spec(spec)
    sys.modules["open_oy_chromium_debug"] = m
    spec.loader.exec_module(m)  # type: ignore[union-attr]
    return m


def test_help_runs_clean(mod, capsys):
    """`--help` exits 0 with a non-empty usage block."""
    with pytest.raises(SystemExit) as exc:
        mod._parse_args(["--help"])
    assert exc.value.code == 0
    out = capsys.readouterr().out
    assert "remote-debugging-port" in out.lower() or "chromium" in out.lower()


def test_parse_args_defaults(mod):
    args = mod._parse_args([])
    assert args.port == 9222
    assert args.profile_dir.name == "chrome-oy-profile-pw"
    assert args.wait is False
    assert args.binary is None


def test_parse_args_custom(mod, tmp_path):
    args = mod._parse_args([
        "--profile-dir", str(tmp_path / "p"),
        "--port", "9333",
        "--binary", "/tmp/fake-chromium",
        "--wait", "--wait-timeout", "5",
    ])
    assert args.port == 9333
    assert args.binary == "/tmp/fake-chromium"
    assert args.wait is True
    assert args.wait_timeout == 5


def test_refuses_when_port_already_running(mod, monkeypatch, capsys):
    """Refuse-to-clash exit code 4 when CDP is already on the port."""
    monkeypatch.setattr(
        mod, "is_chrome_debug_running", lambda port=9222: True,
    )
    rc = mod.main(["--port", "9222"])
    assert rc == 4
    out = capsys.readouterr().out
    assert "already" in out.lower()


def test_returns_2_when_playwright_chromium_not_found(mod, monkeypatch):
    """Exit code 2 when the bundled binary cannot be located."""
    monkeypatch.setattr(
        mod, "is_chrome_debug_running", lambda port=9222: False,
    )
    monkeypatch.setattr(mod, "find_playwright_chromium", lambda: None)
    rc = mod.main([])
    assert rc == 2


def test_find_playwright_chromium_real_environment_optional(mod):
    """In a dev env Playwright IS installed and the bundled binary
    has been downloaded — confirm the detector returns a path that
    exists. Skip if Playwright is not available; this test exists so
    the detector does not silently regress."""
    p = mod.find_playwright_chromium()
    if p is None:
        pytest.skip("Playwright bundled Chromium not present")
    assert Path(p).is_file() or Path(p).exists()
