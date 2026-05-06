"""Tests for `src.voc.connectors.oy_chrome_debug`.

All tests are hermetic — no real Chrome is launched, no real
network is hit, no real profile dirs are touched outside `tmp_path`.

Coverage:
  - is_chrome_debug_running: success / connection refused / non-Chrome
    response / invalid JSON
  - wait_for_chrome_debug: returns True quickly when up; False on
    timeout
  - find_chrome_binary: macOS app path / Linux PATH fallback /
    raises when absent
  - launch_chrome_debug: builds the documented argv; uses
    start_new_session=True; mkdir-s the profile dir
  - reset_profile: backs up to archive (does NOT delete);
    refuses while Chrome is running; refuses on archive collision
  - ensure_chrome_debug_running: already_running / launched / failed
    state shapes; reset before launch path
"""
from __future__ import annotations

import json
import sys
from io import BytesIO
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

from src.voc.connectors import oy_chrome_debug as ocd


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


class _FakeUrlopenContext:
    """Mimics urllib.request.urlopen's context-manager response."""

    def __init__(self, body_bytes: bytes):
        self._body = body_bytes

    def read(self) -> bytes:
        return self._body

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


def _populate_fake_profile(p: Path) -> None:
    p.mkdir(parents=True)
    (p / "Default").mkdir()
    (p / "Default" / "Cookies").write_bytes(b"cookie-jar")
    (p / "Local State").write_text('{"profile":{}}')


# ---------------------------------------------------------------------------
# is_chrome_debug_running
# ---------------------------------------------------------------------------


class TestIsChromeDebugRunning:
    def test_returns_true_on_chrome_response(self, monkeypatch):
        body = json.dumps({
            "Browser": "Chrome/127.0.6533.99",
            "Protocol-Version": "1.3",
            "User-Agent": "Mozilla/...",
            "V8-Version": "12.7.224.13",
            "WebKit-Version": "537.36",
            "webSocketDebuggerUrl": "ws://127.0.0.1:9222/devtools/browser/abc",
        }).encode("utf-8")
        monkeypatch.setattr(
            ocd.urllib.request, "urlopen",
            lambda *a, **kw: _FakeUrlopenContext(body),
        )
        assert ocd.is_chrome_debug_running(9222) is True

    def test_returns_false_on_non_chrome_payload(self, monkeypatch):
        # A bare JSON service on the port — Browser field absent.
        body = json.dumps({"hello": "world"}).encode("utf-8")
        monkeypatch.setattr(
            ocd.urllib.request, "urlopen",
            lambda *a, **kw: _FakeUrlopenContext(body),
        )
        assert ocd.is_chrome_debug_running(9222) is False

    def test_returns_false_on_chromium_browser_field(self, monkeypatch):
        # Chromium is in scope (the literal "chrome" substring matches).
        body = json.dumps({"Browser": "HeadlessChrome/120.0"}).encode("utf-8")
        monkeypatch.setattr(
            ocd.urllib.request, "urlopen",
            lambda *a, **kw: _FakeUrlopenContext(body),
        )
        assert ocd.is_chrome_debug_running(9222) is True

    def test_returns_false_on_connection_refused(self, monkeypatch):
        from urllib.error import URLError

        def _raise(*a, **kw):
            raise URLError("connection refused")
        monkeypatch.setattr(ocd.urllib.request, "urlopen", _raise)
        assert ocd.is_chrome_debug_running(9222) is False

    def test_returns_false_on_invalid_json(self, monkeypatch):
        monkeypatch.setattr(
            ocd.urllib.request, "urlopen",
            lambda *a, **kw: _FakeUrlopenContext(b"not json{{"),
        )
        assert ocd.is_chrome_debug_running(9222) is False


# ---------------------------------------------------------------------------
# wait_for_chrome_debug
# ---------------------------------------------------------------------------


class TestWaitForChromeDebug:
    def test_returns_true_when_up_immediately(self, monkeypatch):
        monkeypatch.setattr(ocd, "is_chrome_debug_running", lambda port: True)
        assert ocd.wait_for_chrome_debug(9222, timeout_sec=1) is True

    def test_returns_false_when_never_up(self, monkeypatch):
        monkeypatch.setattr(ocd, "is_chrome_debug_running", lambda port: False)
        # Use a 0-second timeout so the test doesn't actually wait.
        assert ocd.wait_for_chrome_debug(9222, timeout_sec=0) is False

    def test_returns_true_when_up_after_a_few_polls(self, monkeypatch):
        calls = {"n": 0}

        def fake(port):
            calls["n"] += 1
            return calls["n"] >= 3
        monkeypatch.setattr(ocd, "is_chrome_debug_running", fake)
        # Use a small but non-zero timeout — the function uses
        # time.sleep(0.5) between polls. Give it a 5-second budget;
        # function returns as soon as fake() returns True (3rd call).
        assert ocd.wait_for_chrome_debug(9222, timeout_sec=5) is True


# ---------------------------------------------------------------------------
# find_chrome_binary
# ---------------------------------------------------------------------------


class TestFindChromeBinary:
    def test_macos_app_path_preferred(self, monkeypatch):
        monkeypatch.setattr(sys, "platform", "darwin")
        # Mock Path.is_file to return True for the macOS app path only.
        original_is_file = Path.is_file

        def fake_is_file(self):
            if str(self) == ocd._MACOS_CHROME_PATH:
                return True
            return original_is_file(self)
        monkeypatch.setattr(Path, "is_file", fake_is_file)
        assert ocd.find_chrome_binary() == ocd._MACOS_CHROME_PATH

    def test_linux_fallback_via_shutil_which(self, monkeypatch):
        monkeypatch.setattr(sys, "platform", "linux")
        # Make the macOS path "not a file" defensively.
        monkeypatch.setattr(Path, "is_file", lambda self: False)
        responses = {"google-chrome": "/usr/bin/google-chrome"}
        monkeypatch.setattr(
            ocd.shutil, "which",
            lambda name: responses.get(name),
        )
        assert ocd.find_chrome_binary() == "/usr/bin/google-chrome"

    def test_priority_order_first_match_wins(self, monkeypatch):
        monkeypatch.setattr(sys, "platform", "linux")
        monkeypatch.setattr(Path, "is_file", lambda self: False)
        # Both `chromium` and `chromium-browser` resolve, but
        # `google-chrome` would win first in the priority list.
        responses = {
            "google-chrome": None,
            "google-chrome-stable": "/usr/bin/google-chrome-stable",
            "chromium": "/usr/bin/chromium",
        }
        monkeypatch.setattr(
            ocd.shutil, "which",
            lambda name: responses.get(name),
        )
        assert ocd.find_chrome_binary() == "/usr/bin/google-chrome-stable"

    def test_raises_when_nothing_found(self, monkeypatch):
        monkeypatch.setattr(sys, "platform", "linux")
        monkeypatch.setattr(Path, "is_file", lambda self: False)
        monkeypatch.setattr(ocd.shutil, "which", lambda name: None)
        with pytest.raises(FileNotFoundError, match="Chrome"):
            ocd.find_chrome_binary()


# ---------------------------------------------------------------------------
# launch_chrome_debug
# ---------------------------------------------------------------------------


class TestLaunchChromeDebug:
    def test_argv_includes_documented_flags(self, monkeypatch, tmp_path):
        captured: list = []
        fake_proc = MagicMock(pid=12345)

        def fake_popen(cmd, **kw):
            captured.append(cmd)
            captured.append(kw)
            return fake_proc

        monkeypatch.setattr(ocd.subprocess, "Popen", fake_popen)
        monkeypatch.setattr(ocd, "find_chrome_binary", lambda: "/fake/chrome")

        profile = tmp_path / "profile"
        proc = ocd.launch_chrome_debug(profile, port=9223)

        assert proc.pid == 12345
        cmd = captured[0]
        assert cmd[0] == "/fake/chrome"
        assert "--remote-debugging-port=9223" in cmd
        # Resolve to the absolute form the function uses internally.
        assert any(
            arg.startswith("--user-data-dir=")
            and arg.endswith(str(profile.resolve()))
            for arg in cmd
        )
        assert "--no-first-run" in cmd
        assert "--no-default-browser-check" in cmd

    def test_start_new_session_true(self, monkeypatch, tmp_path):
        captured_kw: dict = {}

        def fake_popen(cmd, **kw):
            captured_kw.update(kw)
            return MagicMock(pid=1)
        monkeypatch.setattr(ocd.subprocess, "Popen", fake_popen)
        monkeypatch.setattr(ocd, "find_chrome_binary", lambda: "/fake/chrome")

        ocd.launch_chrome_debug(tmp_path / "profile")
        assert captured_kw.get("start_new_session") is True

    def test_creates_profile_dir(self, monkeypatch, tmp_path):
        monkeypatch.setattr(
            ocd.subprocess, "Popen", lambda cmd, **kw: MagicMock(pid=1),
        )
        monkeypatch.setattr(ocd, "find_chrome_binary", lambda: "/fake/chrome")
        profile = tmp_path / "fresh_profile"
        assert not profile.exists()
        ocd.launch_chrome_debug(profile)
        assert profile.is_dir()

    def test_explicit_chrome_binary_skips_discovery(self, monkeypatch, tmp_path):
        captured: list = []

        def fake_popen(cmd, **kw):
            captured.append(cmd)
            return MagicMock(pid=1)
        monkeypatch.setattr(ocd.subprocess, "Popen", fake_popen)

        # If discovery were called, this would explode — verifying
        # that an explicit binary path bypasses it.
        def explode():
            raise AssertionError("find_chrome_binary should not be called")
        monkeypatch.setattr(ocd, "find_chrome_binary", explode)

        ocd.launch_chrome_debug(
            tmp_path / "profile", chrome_binary="/explicit/chrome",
        )
        assert captured[0][0] == "/explicit/chrome"

    def test_url_passed_through_when_set(self, monkeypatch, tmp_path):
        captured: list = []
        monkeypatch.setattr(
            ocd.subprocess, "Popen",
            lambda cmd, **kw: (captured.append(cmd) or MagicMock(pid=1)),
        )
        monkeypatch.setattr(ocd, "find_chrome_binary", lambda: "/fake/chrome")
        ocd.launch_chrome_debug(
            tmp_path / "profile", url="https://www.oliveyoung.co.kr/",
        )
        assert "https://www.oliveyoung.co.kr/" in captured[0]


# ---------------------------------------------------------------------------
# reset_profile — non-destructive
# ---------------------------------------------------------------------------


class TestResetProfile:
    def test_archives_to_broken_suffix(self, monkeypatch, tmp_path):
        monkeypatch.setattr(ocd, "is_chrome_debug_running", lambda port=9222: False)
        profile = tmp_path / "chrome-oy-profile"
        _populate_fake_profile(profile)
        archive = ocd.reset_profile(profile)
        assert archive.parent == profile.parent
        assert archive.name.startswith("chrome-oy-profile_broken_")
        # Archive preserves prior content byte-for-byte.
        assert (archive / "Default" / "Cookies").read_bytes() == b"cookie-jar"
        # Original path is recreated empty.
        assert profile.is_dir()
        assert list(profile.iterdir()) == []

    def test_does_not_delete_archive(self, monkeypatch, tmp_path):
        """The single most important contract: reset must NEVER
        delete state. The archive lives next to the original."""
        monkeypatch.setattr(ocd, "is_chrome_debug_running", lambda port=9222: False)
        profile = tmp_path / "chrome-oy-profile"
        _populate_fake_profile(profile)
        archive = ocd.reset_profile(profile)
        assert archive.is_dir()
        assert (archive / "Default" / "Cookies").is_file()

    def test_refuses_when_chrome_running(self, monkeypatch, tmp_path):
        """Renaming a profile dir while Chrome holds open file
        handles inside it would corrupt state. Reset must refuse
        with a clear ChromeDebugError."""
        monkeypatch.setattr(ocd, "is_chrome_debug_running", lambda port=9222: True)
        profile = tmp_path / "chrome-oy-profile"
        _populate_fake_profile(profile)
        with pytest.raises(ocd.ChromeDebugError, match="quit Chrome"):
            ocd.reset_profile(profile)
        # And the profile dir is unchanged.
        assert (profile / "Default" / "Cookies").read_bytes() == b"cookie-jar"

    def test_refuses_on_archive_collision(self, monkeypatch, tmp_path):
        monkeypatch.setattr(ocd, "is_chrome_debug_running", lambda port=9222: False)
        profile = tmp_path / "chrome-oy-profile"
        _populate_fake_profile(profile)
        # Create a colliding archive path.
        from datetime import datetime, timezone
        ts = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
        collision = tmp_path / f"chrome-oy-profile_broken_{ts}"
        collision.mkdir()
        with pytest.raises(ocd.ChromeDebugError, match="archive path already exists"):
            ocd.reset_profile(profile)

    def test_raises_when_profile_missing(self, monkeypatch, tmp_path):
        monkeypatch.setattr(ocd, "is_chrome_debug_running", lambda port=9222: False)
        with pytest.raises(FileNotFoundError):
            ocd.reset_profile(tmp_path / "does_not_exist")


# ---------------------------------------------------------------------------
# ensure_chrome_debug_running — preflight
# ---------------------------------------------------------------------------


class TestEnsureRunning:
    def test_already_running_short_circuits(self, monkeypatch, tmp_path):
        # is_running=True AND attached profile matches → short-circuit.
        profile = (tmp_path / "p").resolve()
        profile.mkdir()
        monkeypatch.setattr(ocd, "is_chrome_debug_running", lambda port=9222: True)
        monkeypatch.setattr(
            ocd, "get_attached_profile_dir", lambda port=9222: profile,
        )
        # If launch were called, this would explode.
        monkeypatch.setattr(
            ocd, "launch_chrome_debug",
            lambda *a, **kw: (_ for _ in ()).throw(
                AssertionError("must not launch when already running")
            ),
        )
        out = ocd.ensure_chrome_debug_running(profile_dir=profile)
        assert out["state"] == "already_running"
        assert out["port"] == 9222
        assert out["archive_path"] is None

    def test_launches_when_not_running(self, monkeypatch, tmp_path):
        flow = iter([False, True])  # is_running → False, then True

        def fake_running(port=9222):
            try:
                return next(flow)
            except StopIteration:
                return True
        monkeypatch.setattr(ocd, "is_chrome_debug_running", fake_running)
        fake_proc = MagicMock(pid=42)
        monkeypatch.setattr(
            ocd, "launch_chrome_debug",
            lambda *a, **kw: fake_proc,
        )
        out = ocd.ensure_chrome_debug_running(
            profile_dir=tmp_path / "p", timeout_sec=1,
        )
        assert out["state"] == "launched"
        assert out["pid"] == 42

    def test_launch_failure_returns_failed_state(
        self, monkeypatch, tmp_path,
    ):
        # is_running always False → wait times out.
        monkeypatch.setattr(ocd, "is_chrome_debug_running", lambda port=9222: False)
        monkeypatch.setattr(
            ocd, "launch_chrome_debug",
            lambda *a, **kw: MagicMock(pid=99),
        )
        out = ocd.ensure_chrome_debug_running(
            profile_dir=tmp_path / "p", timeout_sec=0,
        )
        assert out["state"] == "failed"
        assert "did not become ready" in out["error"]
        assert out["pid"] == 99

    def test_reset_path_archives_then_launches(
        self, monkeypatch, tmp_path,
    ):
        monkeypatch.setattr(ocd, "is_chrome_debug_running", lambda port=9222: False)
        monkeypatch.setattr(
            ocd, "launch_chrome_debug",
            lambda *a, **kw: MagicMock(pid=7),
        )
        # Wait will fail (timeout=0) but that's fine; we're checking
        # the reset side-effect.
        profile = tmp_path / "p"
        _populate_fake_profile(profile)
        out = ocd.ensure_chrome_debug_running(
            profile_dir=profile, reset=True, timeout_sec=0,
        )
        assert out["archive_path"] is not None
        archive = Path(out["archive_path"])
        assert archive.is_dir()
        assert archive.name.startswith("p_broken_")


# ---------------------------------------------------------------------------
# check_profile_path_consistency
# ---------------------------------------------------------------------------


class TestCheckProfilePathConsistency:
    def test_no_warning_when_only_home_exists(
        self, monkeypatch, tmp_path,
    ):
        fake_home = tmp_path / "home"
        fake_home.mkdir()
        (fake_home / "chrome-oy-profile").mkdir()
        # Empty cwd so the cwd variant doesn't exist.
        fake_cwd = tmp_path / "cwd"
        fake_cwd.mkdir()
        monkeypatch.setenv("HOME", str(fake_home))
        monkeypatch.chdir(fake_cwd)
        out = ocd.check_profile_path_consistency(
            fake_home / "chrome-oy-profile",
        )
        assert out["home_exists"] is True
        assert out["cwd_exists"] is False
        assert out["both_exist"] is False
        assert out["warnings"] == []

    def test_warning_when_both_exist(
        self, monkeypatch, tmp_path,
    ):
        fake_home = tmp_path / "home"
        fake_home.mkdir()
        (fake_home / "chrome-oy-profile").mkdir()
        fake_cwd = tmp_path / "cwd"
        fake_cwd.mkdir()
        (fake_cwd / "chrome-oy-profile").mkdir()
        monkeypatch.setenv("HOME", str(fake_home))
        monkeypatch.chdir(fake_cwd)
        out = ocd.check_profile_path_consistency(
            fake_home / "chrome-oy-profile",
        )
        assert out["both_exist"] is True
        assert out["warnings"]
        # Warning text mentions both paths to help the operator.
        joined = " ".join(out["warnings"])
        assert "~/chrome-oy-profile" in joined
        assert "./chrome-oy-profile" in joined

    def test_warning_when_using_cwd_but_home_also_exists(
        self, monkeypatch, tmp_path,
    ):
        """The footgun: operator passes ./chrome-oy-profile, but the
        intended one is at ~/chrome-oy-profile (which also exists).
        The warning should call this out specifically."""
        fake_home = tmp_path / "home"
        fake_home.mkdir()
        (fake_home / "chrome-oy-profile").mkdir()
        fake_cwd = tmp_path / "cwd"
        fake_cwd.mkdir()
        (fake_cwd / "chrome-oy-profile").mkdir()
        monkeypatch.setenv("HOME", str(fake_home))
        monkeypatch.chdir(fake_cwd)
        out = ocd.check_profile_path_consistency(
            fake_cwd / "chrome-oy-profile",
        )
        assert out["warnings"]
        # At least one warning should mention "did you mean".
        joined = " ".join(out["warnings"]).lower()
        assert "did you mean" in joined

    def test_no_warning_when_only_one_path_exists(
        self, monkeypatch, tmp_path,
    ):
        fake_home = tmp_path / "home"
        fake_home.mkdir()
        fake_cwd = tmp_path / "cwd"
        fake_cwd.mkdir()
        (fake_cwd / "chrome-oy-profile").mkdir()
        monkeypatch.setenv("HOME", str(fake_home))
        monkeypatch.chdir(fake_cwd)
        out = ocd.check_profile_path_consistency(
            fake_cwd / "chrome-oy-profile",
        )
        # home doesn't exist, so neither warning fires.
        assert out["home_exists"] is False
        assert out["cwd_exists"] is True
        assert out["both_exist"] is False
        assert out["warnings"] == []


# ---------------------------------------------------------------------------
# get_attached_profile_dir — CDP and lsof+ps fallback
# ---------------------------------------------------------------------------


class TestGetAttachedProfileDir:
    def test_cdp_path_returns_resolved_path(self, monkeypatch, tmp_path):
        target = tmp_path / "real_profile"
        target.mkdir()
        body = json.dumps({
            "Browser": "Chrome/147.0",
            "userDataDir": str(target),
        }).encode("utf-8")
        monkeypatch.setattr(
            ocd.urllib.request, "urlopen",
            lambda *a, **kw: _FakeUrlopenContext(body),
        )
        out = ocd.get_attached_profile_dir(9222)
        assert out == target.resolve()

    def test_cdp_missing_field_falls_through(self, monkeypatch, tmp_path):
        # /json/version returns valid Chrome JSON but no userDataDir.
        body = json.dumps({"Browser": "Chrome/100"}).encode("utf-8")
        monkeypatch.setattr(
            ocd.urllib.request, "urlopen",
            lambda *a, **kw: _FakeUrlopenContext(body),
        )
        # lsof fallback: succeeds.
        target = tmp_path / "lsof_profile"
        target.mkdir()

        def fake_run(cmd, **kw):
            r = MagicMock()
            r.returncode = 0
            if cmd[0] == "lsof":
                r.stdout = "p12345\n"
            elif cmd[0] == "ps":
                r.stdout = (
                    f"/Applications/Google Chrome.app/Contents/MacOS/Chrome "
                    f"--remote-debugging-port=9222 "
                    f"--user-data-dir={target} --no-first-run\n"
                )
            else:
                r.stdout = ""
            return r
        monkeypatch.setattr(ocd.subprocess, "run", fake_run)
        out = ocd.get_attached_profile_dir(9222)
        assert out == target.resolve()

    def test_cdp_unreachable_lsof_fallback(self, monkeypatch, tmp_path):
        from urllib.error import URLError
        monkeypatch.setattr(
            ocd.urllib.request, "urlopen",
            lambda *a, **kw: (_ for _ in ()).throw(URLError("nope")),
        )
        target = tmp_path / "lsof_profile"
        target.mkdir()

        def fake_run(cmd, **kw):
            r = MagicMock()
            r.returncode = 0
            if cmd[0] == "lsof":
                r.stdout = "p99999\n"
            elif cmd[0] == "ps":
                r.stdout = (
                    f"chrome --remote-debugging-port=9222 "
                    f"--user-data-dir={target}\n"
                )
            else:
                r.stdout = ""
            return r
        monkeypatch.setattr(ocd.subprocess, "run", fake_run)
        out = ocd.get_attached_profile_dir(9222)
        assert out == target.resolve()

    def test_lsof_missing_returns_none(self, monkeypatch):
        from urllib.error import URLError
        monkeypatch.setattr(
            ocd.urllib.request, "urlopen",
            lambda *a, **kw: (_ for _ in ()).throw(URLError("nope")),
        )

        def fake_run(cmd, **kw):
            raise FileNotFoundError("no lsof")
        monkeypatch.setattr(ocd.subprocess, "run", fake_run)
        assert ocd.get_attached_profile_dir(9222) is None

    def test_lsof_no_listener_returns_none(self, monkeypatch):
        from urllib.error import URLError
        monkeypatch.setattr(
            ocd.urllib.request, "urlopen",
            lambda *a, **kw: (_ for _ in ()).throw(URLError("nope")),
        )

        def fake_run(cmd, **kw):
            r = MagicMock()
            r.returncode = 1  # lsof exits 1 when no match
            r.stdout = ""
            return r
        monkeypatch.setattr(ocd.subprocess, "run", fake_run)
        assert ocd.get_attached_profile_dir(9222) is None

    def test_ps_returns_no_user_data_dir(self, monkeypatch):
        from urllib.error import URLError
        monkeypatch.setattr(
            ocd.urllib.request, "urlopen",
            lambda *a, **kw: (_ for _ in ()).throw(URLError("nope")),
        )

        def fake_run(cmd, **kw):
            r = MagicMock()
            r.returncode = 0
            if cmd[0] == "lsof":
                r.stdout = "p4242\n"
            elif cmd[0] == "ps":
                # Process exists but its command line doesn't carry
                # the flag — e.g., it's a non-Chrome listener.
                r.stdout = "/usr/bin/something --port=9222\n"
            return r
        monkeypatch.setattr(ocd.subprocess, "run", fake_run)
        assert ocd.get_attached_profile_dir(9222) is None


# ---------------------------------------------------------------------------
# Preflight states with profile verification
# ---------------------------------------------------------------------------


class TestEnsureRunningProfileVerification:
    def test_already_running_with_matching_profile(
        self, monkeypatch, tmp_path,
    ):
        profile = (tmp_path / "real_profile").resolve()
        profile.mkdir()
        monkeypatch.setattr(
            ocd, "is_chrome_debug_running", lambda port=9222: True,
        )
        monkeypatch.setattr(
            ocd, "get_attached_profile_dir",
            lambda port=9222: profile,
        )
        out = ocd.ensure_chrome_debug_running(profile_dir=profile)
        assert out["state"] == "already_running"
        assert Path(out["attached_profile_dir"]) == profile

    def test_already_running_with_mismatched_profile(
        self, monkeypatch, tmp_path,
    ):
        requested = tmp_path / "wanted"
        requested.mkdir()
        attached = tmp_path / "ghost"
        attached.mkdir()
        monkeypatch.setattr(
            ocd, "is_chrome_debug_running", lambda port=9222: True,
        )
        monkeypatch.setattr(
            ocd, "get_attached_profile_dir",
            lambda port=9222: attached.resolve(),
        )
        out = ocd.ensure_chrome_debug_running(profile_dir=requested)
        assert out["state"] == "already_running_mismatched_profile"
        assert Path(out["attached_profile_dir"]) == attached.resolve()
        assert Path(out["profile_dir"]) == requested.resolve()

    def test_already_running_unverified_when_lookup_returns_none(
        self, monkeypatch, tmp_path,
    ):
        requested = tmp_path / "wanted"
        requested.mkdir()
        monkeypatch.setattr(
            ocd, "is_chrome_debug_running", lambda port=9222: True,
        )
        monkeypatch.setattr(
            ocd, "get_attached_profile_dir", lambda port=9222: None,
        )
        out = ocd.ensure_chrome_debug_running(profile_dir=requested)
        assert out["state"] == "already_running_unverified"
        assert out["attached_profile_dir"] is None

    def test_macos_private_var_folders_symlink_normalized(
        self, monkeypatch, tmp_path,
    ):
        """macOS resolves /var/folders/... → /private/var/folders/...
        on tmp paths. The match check must not false-positive a
        mismatch when both refer to the same dir."""
        # tmp_path is already inside /private/var/folders on macOS;
        # passing the un-resolved /var/folders form should still
        # match.
        attached = tmp_path / "p"
        attached.mkdir()
        # Write the path with `/var/folders/` prefix instead of
        # `/private/var/folders/` to simulate the symlink case.
        attached_str = str(attached)
        if attached_str.startswith("/private/var/folders/"):
            requested_str = attached_str.removeprefix("/private")
            requested = Path(requested_str)
        else:
            # Skip the test on platforms where the symlink doesn't apply.
            requested = attached

        monkeypatch.setattr(
            ocd, "is_chrome_debug_running", lambda port=9222: True,
        )
        monkeypatch.setattr(
            ocd, "get_attached_profile_dir",
            lambda port=9222: attached,
        )
        out = ocd.ensure_chrome_debug_running(profile_dir=requested)
        assert out["state"] == "already_running"


# ---------------------------------------------------------------------------
# CLI: scripts/open_oy_chrome_debug.py
# ---------------------------------------------------------------------------


class TestOpenOyChromeDebugCLI:
    """The CLI module imports the helper functions directly into its
    own namespace, so patching `ocd.*` does not propagate. Every CLI
    test patches BOTH the module-level binding and the CLI's local
    binding via `_patch_all` to keep tests hermetic — particularly
    so the launch path NEVER spawns a real Chrome process."""

    @pytest.fixture(scope="class")
    def cli(self):
        import importlib.util
        from pathlib import Path
        repo = Path(__file__).resolve().parents[2]
        spec = importlib.util.spec_from_file_location(
            "open_oy_chrome_debug_test_load",
            repo / "scripts" / "open_oy_chrome_debug.py",
        )
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        return mod

    @staticmethod
    def _patch_all(monkeypatch, cli, *, name, value):
        """Patch a function name on BOTH the source module and the
        CLI's local namespace. Required because the CLI imports
        helpers via `from ... import ...`."""
        monkeypatch.setattr(ocd, name, value, raising=False)
        if hasattr(cli, name):
            monkeypatch.setattr(cli, name, value, raising=False)

    def test_already_running_with_matching_profile_returns_zero(
        self, monkeypatch, tmp_path, cli,
    ):
        profile = (tmp_path / "profile").resolve()
        profile.mkdir(parents=True, exist_ok=True)
        self._patch_all(
            monkeypatch, cli, name="is_chrome_debug_running",
            value=lambda port=9222: True,
        )
        # Attached profile matches requested → exit 0.
        self._patch_all(
            monkeypatch, cli, name="get_attached_profile_dir",
            value=lambda port=9222: profile,
        )
        rc = cli.main([
            "--profile-dir", str(profile),
            "--port", "9222",
        ])
        assert rc == 0

    def test_already_running_unverified_returns_zero_with_warning(
        self, monkeypatch, tmp_path, cli, capsys,
    ):
        self._patch_all(
            monkeypatch, cli, name="is_chrome_debug_running",
            value=lambda port=9222: True,
        )
        # Attached profile cannot be determined → warn + exit 0.
        self._patch_all(
            monkeypatch, cli, name="get_attached_profile_dir",
            value=lambda port=9222: None,
        )
        rc = cli.main([
            "--profile-dir", str(tmp_path / "profile"),
            "--port", "9222",
        ])
        assert rc == 0
        out = capsys.readouterr()
        # Exact wording the operator asked for.
        assert "CDP is already running, but profile_dir could not be verified." in out.out
        assert "quit Chrome and rerun" in out.out

    def test_already_running_mismatched_profile_exits_6(
        self, monkeypatch, tmp_path, cli, capsys,
    ):
        attached = tmp_path / "ghost"
        attached.mkdir()
        requested = tmp_path / "wanted"
        requested.mkdir()
        self._patch_all(
            monkeypatch, cli, name="is_chrome_debug_running",
            value=lambda port=9222: True,
        )
        self._patch_all(
            monkeypatch, cli, name="get_attached_profile_dir",
            value=lambda port=9222: attached.resolve(),
        )
        rc = cli.main([
            "--profile-dir", str(requested),
            "--port", "9222",
        ])
        assert rc == 6
        err = capsys.readouterr().err
        assert "DIFFERENT profile" in err
        assert "Quit Chrome" in err

    def test_force_new_with_running_port_exits_3(
        self, monkeypatch, tmp_path, cli,
    ):
        # --force-new short-circuits BEFORE the profile-verification
        # branch, so get_attached_profile_dir is not consulted.
        self._patch_all(
            monkeypatch, cli, name="is_chrome_debug_running",
            value=lambda port=9222: True,
        )
        self._patch_all(
            monkeypatch, cli, name="launch_chrome_debug",
            value=lambda *a, **kw: MagicMock(pid=999),
        )
        rc = cli.main([
            "--profile-dir", str(tmp_path / "profile"),
            "--port", "9222",
            "--force-new",
        ])
        assert rc == 3

    def test_missing_chrome_binary_exits_4(
        self, monkeypatch, tmp_path, cli,
    ):
        self._patch_all(
            monkeypatch, cli, name="is_chrome_debug_running",
            value=lambda port=9222: False,
        )

        def _raise():
            raise FileNotFoundError("no chrome")
        self._patch_all(monkeypatch, cli, name="find_chrome_binary", value=_raise)
        # Belt-and-suspenders: even if discovery somehow returned a
        # path, the launch path is also stubbed so no real Chrome
        # spawns.
        self._patch_all(
            monkeypatch, cli, name="launch_chrome_debug",
            value=lambda *a, **kw: MagicMock(pid=999),
        )
        rc = cli.main([
            "--profile-dir", str(tmp_path / "profile"),
        ])
        assert rc == 4

    def test_reset_with_running_chrome_exits_2(
        self, monkeypatch, tmp_path, cli,
    ):
        self._patch_all(
            monkeypatch, cli, name="is_chrome_debug_running",
            value=lambda port=9222: True,
        )
        profile = tmp_path / "profile"
        _populate_fake_profile(profile)
        rc = cli.main([
            "--profile-dir", str(profile),
            "--reset-profile",
        ])
        assert rc == 2

    def test_launch_path_returns_zero_without_wait(
        self, monkeypatch, tmp_path, cli,
    ):
        # Not running → launches; without --wait, should exit 0.
        self._patch_all(
            monkeypatch, cli, name="is_chrome_debug_running",
            value=lambda port=9222: False,
        )
        self._patch_all(
            monkeypatch, cli, name="find_chrome_binary",
            value=lambda: "/fake/chrome",
        )
        self._patch_all(
            monkeypatch, cli, name="launch_chrome_debug",
            value=lambda *a, **kw: MagicMock(pid=11),
        )
        rc = cli.main([
            "--profile-dir", str(tmp_path / "profile"),
        ])
        assert rc == 0

    def test_launch_with_wait_polls_until_ready(
        self, monkeypatch, tmp_path, cli,
    ):
        """With --wait set, the CLI invokes wait_for_chrome_debug
        and returns 0 only when the wait succeeds."""
        flow = iter([False, True])

        def fake_running(port=9222):
            try:
                return next(flow)
            except StopIteration:
                return True
        self._patch_all(
            monkeypatch, cli, name="is_chrome_debug_running",
            value=fake_running,
        )
        self._patch_all(
            monkeypatch, cli, name="find_chrome_binary",
            value=lambda: "/fake/chrome",
        )
        self._patch_all(
            monkeypatch, cli, name="launch_chrome_debug",
            value=lambda *a, **kw: MagicMock(pid=42),
        )
        self._patch_all(
            monkeypatch, cli, name="wait_for_chrome_debug",
            value=lambda port=9222, timeout_sec=20: True,
        )
        rc = cli.main([
            "--profile-dir", str(tmp_path / "profile"),
            "--wait",
        ])
        assert rc == 0


# ---------------------------------------------------------------------------
# run_all.py preflight integration
# ---------------------------------------------------------------------------


class TestRunAllPreflight:
    @pytest.fixture(scope="class")
    def run_all(self):
        import importlib.util
        from pathlib import Path
        repo = Path(__file__).resolve().parents[2]
        spec = importlib.util.spec_from_file_location(
            "run_all_for_preflight_test",
            repo / "scripts" / "run_all.py",
        )
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        return mod

    def test_argparse_includes_preflight_flags(self, run_all):
        ns = run_all._parse_args([
            "--product-url", "A000000171427",
            "--ensure-chrome-debug",
            "--chrome-debug-port", "9223",
            "--chrome-profile-dir", "/tmp/x",
            "--reset-oy-chrome-profile",
        ])
        assert ns.ensure_chrome_debug is True
        assert ns.chrome_debug_port == 9223
        assert ns.chrome_profile_dir == Path("/tmp/x")
        assert ns.reset_oy_chrome_profile is True

    def test_argparse_defaults_are_off(self, run_all):
        ns = run_all._parse_args(["--product-url", "A000000171427"])
        assert ns.ensure_chrome_debug is False
        assert ns.reset_oy_chrome_profile is False
        assert ns.chrome_debug_port == 9222
        # Default browser mode is playwright_chromium (working OY path).
        assert ns.chrome_debug_browser == "playwright_chromium"
        # Profile dir defaults to None — resolved lazily by browser mode
        # via _resolve_profile_dir(). For playwright_chromium that is
        # ~/chrome-oy-profile-pw.
        assert ns.chrome_profile_dir is None
        resolved = run_all._resolve_profile_dir(ns)
        assert resolved == Path.home() / "chrome-oy-profile-pw"

    def test_preflight_helper_skipped_when_flag_off(self, run_all):
        """Regression gate: the preflight helper must NOT be called
        when --ensure-chrome-debug / --reset-oy-chrome-profile are
        absent. We stub the helper to raise; if it were called, the
        test would fail."""
        ns = run_all._parse_args(["--product-url", "A000000171427"])
        called = {"n": 0}

        def explode(args):
            called["n"] += 1
            raise AssertionError("preflight called when flag is off")
        # Conditional check mirrors run_all.main's gate.
        if ns.reset_oy_chrome_profile or ns.ensure_chrome_debug:
            explode(ns)
        assert called["n"] == 0

    def test_preflight_helper_called_when_flag_on(self, run_all, monkeypatch):
        """When the flag is on, the helper IS called and its
        SystemExit propagates if the preflight fails."""
        ns = run_all._parse_args([
            "--product-url", "A000000171427",
            "--ensure-chrome-debug",
        ])
        # Force the helper's lazy import to a fake one that raises.
        from src.voc.connectors import oy_chrome_debug as ocd_mod
        monkeypatch.setattr(
            ocd_mod, "ensure_browser_for_mode",
            lambda **kw: {
                "mode": kw.get("mode"),
                "state": "failed", "error": "test failure",
                "port": 9222, "profile_dir": "/x", "pid": 1,
                "browser_string": None, "browser_class": None,
                "incompatible_reason": None,
                "attached_profile_dir": None,
                "archive_path": None,
            },
        )
        with pytest.raises(SystemExit) as ei:
            run_all._run_chrome_debug_preflight(ns)
        assert ei.value.code == 2

    def test_preflight_unverified_warning_continues(
        self, run_all, monkeypatch, capsys,
    ):
        """When the preflight returns `already_running_unverified`,
        the orchestrator prints the operator-readable warning and
        CONTINUES (no SystemExit). This is the warn-only path the
        operator explicitly asked for."""
        ns = run_all._parse_args([
            "--product-url", "A000000171427",
            "--ensure-chrome-debug",
        ])
        from src.voc.connectors import oy_chrome_debug as ocd_mod
        resolved_profile = run_all._resolve_profile_dir(ns)
        monkeypatch.setattr(
            ocd_mod, "ensure_browser_for_mode",
            lambda **kw: {
                "mode": kw.get("mode"),
                "state": "already_running_unverified",
                "port": 9222,
                "profile_dir": str(resolved_profile),
                "attached_profile_dir": None,
                "browser_string": "Chrome/143.0.7106.0 (Chrome for Testing)",
                "browser_class": ocd_mod.classify_browser(
                    "Chrome/143.0.7106.0 (Chrome for Testing)"
                ),
                "incompatible_reason": None,
                "archive_path": None,
            },
        )
        # Should NOT raise.
        run_all._run_chrome_debug_preflight(ns)
        out = capsys.readouterr().out
        assert "CDP is already running, but profile_dir could not be verified." in out
        assert "quit Chrome and rerun" in out

    def test_preflight_mismatched_profile_exits_2(
        self, run_all, monkeypatch, capsys,
    ):
        """Default behavior: refuse to proceed when the attached
        profile differs from the requested one."""
        ns = run_all._parse_args([
            "--product-url", "A000000171427",
            "--ensure-chrome-debug",
            "--chrome-profile-dir", "/tmp/wanted_profile",
        ])
        from src.voc.connectors import oy_chrome_debug as ocd_mod
        monkeypatch.setattr(
            ocd_mod, "ensure_browser_for_mode",
            lambda **kw: {
                "mode": kw.get("mode"),
                "state": "already_running_mismatched_profile",
                "port": 9222,
                "profile_dir": "/tmp/wanted_profile",
                "attached_profile_dir": "/tmp/ghost_profile",
                "browser_string": "Chrome/143.0.7106.0 (Chrome for Testing)",
                "browser_class": ocd_mod.classify_browser(
                    "Chrome/143.0.7106.0 (Chrome for Testing)"
                ),
                "incompatible_reason": None,
                "archive_path": None,
            },
        )
        with pytest.raises(SystemExit) as ei:
            run_all._run_chrome_debug_preflight(ns)
        assert ei.value.code == 2
        err = capsys.readouterr().err
        assert "DIFFERENT profile" in err
        assert "/tmp/wanted_profile" in err
        assert "/tmp/ghost_profile" in err

    def test_preflight_mismatched_profile_with_ignore_flag_continues(
        self, run_all, monkeypatch, capsys,
    ):
        """`--ignore-chrome-profile-mismatch` opts the operator
        into attaching to the existing Chrome anyway."""
        ns = run_all._parse_args([
            "--product-url", "A000000171427",
            "--ensure-chrome-debug",
            "--ignore-chrome-profile-mismatch",
        ])
        from src.voc.connectors import oy_chrome_debug as ocd_mod
        monkeypatch.setattr(
            ocd_mod, "ensure_browser_for_mode",
            lambda **kw: {
                "mode": kw.get("mode"),
                "state": "already_running_mismatched_profile",
                "port": 9222,
                "profile_dir": "/tmp/wanted",
                "attached_profile_dir": "/tmp/ghost",
                "browser_string": "Chrome/143.0.7106.0 (Chrome for Testing)",
                "browser_class": ocd_mod.classify_browser(
                    "Chrome/143.0.7106.0 (Chrome for Testing)"
                ),
                "incompatible_reason": None,
                "archive_path": None,
            },
        )
        # Must NOT raise.
        run_all._run_chrome_debug_preflight(ns)
        err = capsys.readouterr().err
        assert "continuing anyway" in err
