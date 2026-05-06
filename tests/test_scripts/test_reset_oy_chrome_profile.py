"""Tests for the `scripts/reset_oy_chrome_profile.sh` workflow and the
profile-detection helper in `scripts/diagnose_oy_access.py`.

Bash script tests use subprocess so we exercise the actual shell that
operators will invoke. Profile-detection tests use the pure Python
helper directly.

Hard rules
----------
- Never touch the real `~/chrome-oy-profile` or `/tmp/chrome-debug-oy`
  on the developer's machine. Every test runs against a `tmp_path`
  fixture and overrides the candidate list via `--profile-dir`.
- The reset script's `mv` step is destructive only to the test's
  fixture directory; pytest's tmp_path is auto-cleaned.
"""
from __future__ import annotations

import importlib.util
import os
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[2]
RESET_SCRIPT = REPO / "scripts" / "reset_oy_chrome_profile.sh"
DIAGNOSE_SCRIPT = REPO / "scripts" / "diagnose_oy_access.py"


@pytest.fixture(scope="module")
def diag():
    """Load `diagnose_oy_access.py` as an importable module."""
    sys.path.insert(0, str(REPO))
    spec = importlib.util.spec_from_file_location(
        "diag_reset_test", DIAGNOSE_SCRIPT,
    )
    assert spec is not None and spec.loader is not None
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def _populate_fake_profile(profile_dir: Path) -> None:
    """Create a fake Chrome profile dir tree so `du -sh` and the
    reset script's checks behave normally."""
    profile_dir.mkdir(parents=True)
    (profile_dir / "Default").mkdir()
    (profile_dir / "Default" / "Cookies").write_bytes(b"fake-cookie-jar")
    (profile_dir / "Default" / "Local Storage").mkdir()
    (profile_dir / "Default" / "Local Storage" / "leveldb").mkdir()
    (profile_dir / "Local State").write_text('{"profile":{}}')


# ---------------------------------------------------------------------------
# Reset script — non-destructive archive workflow.
# ---------------------------------------------------------------------------


class TestResetScript:
    def test_help_exits_clean(self):
        r = subprocess.run(
            ["bash", str(RESET_SCRIPT), "--help"],
            capture_output=True, text=True,
        )
        assert r.returncode == 0
        assert "Usage" in r.stdout or "operator-safe" in r.stdout

    def test_explicit_missing_profile_dir_exits_3(self):
        r = subprocess.run(
            ["bash", str(RESET_SCRIPT), "--profile-dir"],
            capture_output=True, text=True,
        )
        assert r.returncode == 3

    def test_unknown_argument_rejected(self):
        r = subprocess.run(
            ["bash", str(RESET_SCRIPT), "--no-such-flag"],
            capture_output=True, text=True,
        )
        assert r.returncode == 3

    def test_archive_and_recreate_happy_path(self, tmp_path: Path):
        """Explicit profile dir → script archives it under `_broken_<ts>`
        and creates a fresh empty dir at the original path."""
        profile = tmp_path / "chrome-oy-profile"
        _populate_fake_profile(profile)
        # Sanity check the fixture.
        assert (profile / "Default" / "Cookies").is_file()

        r = subprocess.run(
            ["bash", str(RESET_SCRIPT),
             "--profile-dir", str(profile),
             "--port", "59222",  # immune to real Chrome on 9222
             "--yes"],
            capture_output=True, text=True,
        )
        assert r.returncode == 0, (
            f"reset failed: stdout={r.stdout!r}\nstderr={r.stderr!r}"
        )

        # Original path now exists but is empty.
        assert profile.is_dir()
        assert list(profile.iterdir()) == []

        # An archive sibling exists with the fingerprint suffix.
        archives = sorted(tmp_path.glob("chrome-oy-profile_broken_*"))
        assert len(archives) == 1
        archive = archives[0]
        # Archive preserves the original tree byte-for-byte.
        assert (archive / "Default" / "Cookies").read_bytes() == b"fake-cookie-jar"
        assert (archive / "Local State").is_file()

    def test_archive_path_format_includes_utc_timestamp(self, tmp_path: Path):
        profile = tmp_path / "chrome-oy-profile"
        _populate_fake_profile(profile)

        subprocess.run(
            ["bash", str(RESET_SCRIPT),
             "--profile-dir", str(profile),
             "--port", "59222",  # immune to real Chrome on 9222
             "--yes"],
            capture_output=True, text=True, check=True,
        )

        archive = next(tmp_path.glob("chrome-oy-profile_broken_*"))
        suffix = archive.name.rsplit("_broken_", 1)[1]
        # Format: YYYYMMDDTHHMMSSZ
        assert len(suffix) == 16
        assert suffix.endswith("Z")
        assert suffix[8] == "T"
        # Year prefix sanity check.
        assert suffix[:4].isdigit()

    def test_decline_confirmation_makes_no_changes(self, tmp_path: Path):
        """When the operator answers anything other than y/Y/yes/YES,
        nothing on disk should change."""
        profile = tmp_path / "chrome-oy-profile"
        _populate_fake_profile(profile)

        # Pipe a "no" response to the prompt.
        r = subprocess.run(
            ["bash", str(RESET_SCRIPT),
             "--profile-dir", str(profile),
             "--port", "59222"],
            input="n\n", capture_output=True, text=True,
        )
        assert r.returncode == 0
        assert "Aborted by operator" in r.stdout
        # Profile untouched, no archive sibling.
        assert (profile / "Default" / "Cookies").is_file()
        archives = list(tmp_path.glob("chrome-oy-profile_broken_*"))
        assert archives == []

    def test_no_input_pipe_defaults_to_abort(self, tmp_path: Path):
        """Defensive: subprocess invocation with no stdin must default
        to 'no' rather than hanging forever."""
        profile = tmp_path / "chrome-oy-profile"
        _populate_fake_profile(profile)

        r = subprocess.run(
            ["bash", str(RESET_SCRIPT),
             "--profile-dir", str(profile),
             "--port", "59222"],
            stdin=subprocess.DEVNULL,
            capture_output=True, text=True, timeout=10,
        )
        assert r.returncode == 0
        assert "Aborted" in r.stdout
        assert (profile / "Default" / "Cookies").is_file()

    def test_yes_flag_skips_prompt(self, tmp_path: Path):
        profile = tmp_path / "chrome-oy-profile"
        _populate_fake_profile(profile)
        r = subprocess.run(
            ["bash", str(RESET_SCRIPT),
             "--profile-dir", str(profile),
             "--port", "59222",  # immune to real Chrome on 9222
             "--yes"],
            stdin=subprocess.DEVNULL, capture_output=True, text=True,
        )
        assert r.returncode == 0
        assert (tmp_path / "chrome-oy-profile").is_dir()
        archives = list(tmp_path.glob("chrome-oy-profile_broken_*"))
        assert len(archives) == 1

    def test_explicit_dir_does_not_exist_exits_1(self, tmp_path: Path):
        """When --profile-dir points at a path that doesn't exist AND
        no candidate paths exist on the test machine's filesystem, the
        script falls through to exit 1. We verify by passing a
        guaranteed-missing path."""
        missing = tmp_path / "definitely_does_not_exist"
        # NOTE: the script's auto-detection would still find any real
        # candidate path on the dev machine. The explicit override
        # short-circuits that. But the script only checks `[ -d ]` on
        # the candidate path — passing a missing explicit dir means it
        # short-circuits BUT the path doesn't exist. Behavior: it
        # treats the path as the resolved target; subsequent `cd`
        # would fail. Test by inspecting exit code.
        r = subprocess.run(
            ["bash", str(RESET_SCRIPT),
             "--profile-dir", str(missing),
             "--yes"],
            capture_output=True, text=True,
        )
        assert r.returncode != 0


# ---------------------------------------------------------------------------
# Profile path detection helper.
# ---------------------------------------------------------------------------


class TestDetectChromeProfilePath:
    def test_returns_none_when_no_candidates_and_no_cdp(
        self, diag, monkeypatch, tmp_path: Path,
    ):
        # Override the candidate list so real dev-machine paths don't
        # leak in.
        monkeypatch.setattr(
            diag, "_PROFILE_CANDIDATES",
            (str(tmp_path / "doesnotexist1"),
             str(tmp_path / "doesnotexist2")),
        )
        path, method = diag.detect_chrome_profile_path(None)
        assert path is None
        assert method is None

    def test_candidate_match_returns_existing_path(
        self, diag, monkeypatch, tmp_path: Path,
    ):
        cand_a = tmp_path / "fake_profile_a"
        cand_a.mkdir()
        monkeypatch.setattr(
            diag, "_PROFILE_CANDIDATES",
            (str(cand_a), str(tmp_path / "missing")),
        )
        path, method = diag.detect_chrome_profile_path(None)
        assert path == str(cand_a)
        assert method == "candidate_match"

    def test_candidate_match_picks_most_recently_modified(
        self, diag, monkeypatch, tmp_path: Path,
    ):
        older = tmp_path / "older_profile"
        newer = tmp_path / "newer_profile"
        older.mkdir()
        newer.mkdir()
        # Force older to have an older mtime.
        old_time = newer.stat().st_mtime - 3600
        os.utime(older, (old_time, old_time))
        monkeypatch.setattr(
            diag, "_PROFILE_CANDIDATES",
            (str(older), str(newer)),
        )
        path, _method = diag.detect_chrome_profile_path(None)
        assert path == str(newer)

    def test_cdp_unreachable_falls_back_to_candidates(
        self, diag, monkeypatch, tmp_path: Path,
    ):
        """A CDP endpoint that can't be reached must NOT crash; the
        helper falls back silently to candidate matching."""
        cand = tmp_path / "fallback_profile"
        cand.mkdir()
        monkeypatch.setattr(
            diag, "_PROFILE_CANDIDATES", (str(cand),),
        )
        path, method = diag.detect_chrome_profile_path(
            "http://localhost:1",  # nothing listens here
        )
        assert path == str(cand)
        assert method == "candidate_match"

    def test_tilde_expansion_works(
        self, diag, monkeypatch, tmp_path: Path,
    ):
        """Candidate paths starting with `~` must be expanded."""
        # Create a tilde-pattern candidate by faking HOME.
        fake_home = tmp_path / "homedir"
        fake_home.mkdir()
        (fake_home / "myprofile").mkdir()
        monkeypatch.setenv("HOME", str(fake_home))
        monkeypatch.setattr(
            diag, "_PROFILE_CANDIDATES",
            ("~/myprofile",),
        )
        path, method = diag.detect_chrome_profile_path(None)
        assert path == str(fake_home / "myprofile")
        assert method == "candidate_match"


# ---------------------------------------------------------------------------
# Diagnose summary surfaces profile context.
# ---------------------------------------------------------------------------


class TestDiagnoseSummarySurfacesProfile:
    def test_summary_prints_profile_path(self, diag, capsys):
        result = {
            "verdict": "review_load_race",
            "verdict_reason": "test",
            "next_actions": [],
            "browser_attach": {
                "profile_path": "/tmp/test-profile",
                "profile_detection_method": "candidate_match",
            },
            "review_tab_visible": True,
            "review_card_visible": False,
            "review_api_observed": {
                "fired": False, "first_status": None, "elapsed_ms": None,
            },
            "login_wall_detected": False,
            "human_check_detected": False,
            "interstitial_markers_seen": [],
            "artifacts": {
                "out_dir": "/tmp/x",
                "screenshot_path": "/tmp/x/screenshot.png",
            },
        }
        diag._print_summary(result)
        out = capsys.readouterr().out
        assert "/tmp/test-profile" in out
        assert "candidate_match" in out

    def test_summary_suggests_reset_on_false_empty_pattern(
        self, diag, capsys,
    ):
        """When verdict is review_load_race AND DOM visible AND API
        not fired, the summary must point to the reset playbook."""
        result = {
            "verdict": "review_load_race",
            "verdict_reason": "test",
            "next_actions": [],
            "browser_attach": {
                "profile_path": "/tmp/test", "profile_detection_method": "candidate_match",
            },
            "review_tab_visible": True,
            "review_card_visible": True,
            "review_api_observed": {
                "fired": False, "first_status": None, "elapsed_ms": None,
            },
            "login_wall_detected": False,
            "human_check_detected": False,
            "interstitial_markers_seen": [],
            "artifacts": {"out_dir": "/tmp/x"},
        }
        diag._print_summary(result)
        out = capsys.readouterr().out
        assert "reset_oy_chrome_profile.sh" in out
        assert "30 minutes" in out
        assert "oy_chrome_profile_reset.md" in out

    def test_summary_does_not_suggest_reset_for_ok_verdict(
        self, diag, capsys,
    ):
        result = {
            "verdict": "ok",
            "verdict_reason": "all good",
            "next_actions": [],
            "browser_attach": {
                "profile_path": "/tmp/test",
                "profile_detection_method": "candidate_match",
            },
            "review_tab_visible": True,
            "review_card_visible": True,
            "review_api_observed": {
                "fired": True, "first_status": 200, "elapsed_ms": 1234,
            },
            "login_wall_detected": False,
            "human_check_detected": False,
            "interstitial_markers_seen": [],
            "artifacts": {"out_dir": "/tmp/x"},
        }
        diag._print_summary(result)
        out = capsys.readouterr().out
        assert "reset_oy_chrome_profile.sh" not in out

    def test_summary_does_not_suggest_reset_for_anti_bot_verdict(
        self, diag, capsys,
    ):
        """anti_bot verdict has its own remediation — solve CAPTCHA,
        not reset profile. The reset hint must not appear here."""
        result = {
            "verdict": "anti_bot",
            "verdict_reason": "human-check interstitial",
            "next_actions": [],
            "browser_attach": {
                "profile_path": "/tmp/test",
                "profile_detection_method": "candidate_match",
            },
            "review_tab_visible": False,
            "review_card_visible": False,
            "review_api_observed": {
                "fired": False, "first_status": None, "elapsed_ms": None,
            },
            "login_wall_detected": False,
            "human_check_detected": True,
            "interstitial_markers_seen": ["본인 확인"],
            "artifacts": {"out_dir": "/tmp/x"},
        }
        diag._print_summary(result)
        out = capsys.readouterr().out
        assert "reset_oy_chrome_profile.sh" not in out
