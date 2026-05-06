"""Tests for browser-mode awareness in `oy_chrome_debug`.

Background: System Chrome 147+ exposes /json/version but breaks
Playwright's `Browser.setDownloadBehavior` CDP attach used by the OY
scraper. The working path is Playwright's bundled Chromium (Chrome
for Testing). The orchestrator must:

  1. Default to playwright_chromium for OY scraping.
  2. Inspect /json/version and reject system Chrome 147 when the
     requested mode is playwright_chromium.
  3. Launch the bundled Chromium when no CDP endpoint is up.
  4. Reuse a healthy Chrome for Testing endpoint silently.

These tests are hermetic — no real Chrome is launched, no network
hits the wire.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

from src.voc.connectors import oy_chrome_debug as ocd


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


class _FakeUrlopenContext:
    def __init__(self, body_bytes: bytes):
        self._body = body_bytes

    def read(self) -> bytes:
        return self._body

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


def _patch_json_version(monkeypatch, payload: dict | None) -> None:
    """Make urlopen return the given JSON payload, or raise OSError
    (simulating an unreachable port) when payload is None."""
    if payload is None:
        def _raise(*a, **kw):
            raise OSError("connection refused")
        monkeypatch.setattr(ocd.urllib.request, "urlopen", _raise)
        return
    body = json.dumps(payload).encode("utf-8")
    monkeypatch.setattr(
        ocd.urllib.request, "urlopen",
        lambda *a, **kw: _FakeUrlopenContext(body),
    )


# ---------------------------------------------------------------------------
# classify_browser
# ---------------------------------------------------------------------------


class TestClassifyBrowser:
    def test_system_chrome_147_classified_as_system(self):
        cls = ocd.classify_browser("Chrome/147.0.7727.138")
        assert cls["major"] == 147
        assert cls["version"] == "147.0.7727.138"
        assert cls["is_system_chrome"] is True
        assert cls["is_chrome_for_testing"] is False

    def test_chrome_for_testing_marker(self):
        cls = ocd.classify_browser(
            "Chrome/143.0.7106.0 (Chrome for Testing)"
        )
        assert cls["major"] == 143
        assert cls["is_chrome_for_testing"] is True
        assert cls["is_system_chrome"] is False

    def test_headless_chrome_marker_is_chrome_for_testing(self):
        cls = ocd.classify_browser("HeadlessChrome/143.0.7106.0")
        assert cls["is_chrome_for_testing"] is True

    def test_empty_input_returns_falsy(self):
        cls = ocd.classify_browser("")
        assert cls["major"] is None
        assert cls["is_system_chrome"] is False
        assert cls["is_chrome_for_testing"] is False

    def test_none_input_returns_falsy(self):
        cls = ocd.classify_browser(None)
        assert cls["major"] is None
        assert cls["raw"] == ""


# ---------------------------------------------------------------------------
# is_endpoint_compatible_with_mode — the rejection rule
# ---------------------------------------------------------------------------


class TestEndpointCompatibility:
    def test_chrome_147_rejected_under_playwright_chromium_mode(self):
        ok, reason = ocd.is_endpoint_compatible_with_mode(
            "Chrome/147.0.7727.138", ocd.BROWSER_MODE_PLAYWRIGHT_CHROMIUM,
        )
        assert ok is False
        # Reason must explain the bad-attach contract so the operator
        # knows what to do.
        assert "Chrome" in reason
        assert "147" in reason
        assert "playwright_chromium" in reason

    def test_chrome_for_testing_accepted_under_playwright_chromium_mode(self):
        ok, reason = ocd.is_endpoint_compatible_with_mode(
            "Chrome/143.0.7106.0 (Chrome for Testing)",
            ocd.BROWSER_MODE_PLAYWRIGHT_CHROMIUM,
        )
        assert ok is True
        assert reason is None

    def test_chrome_147_accepted_under_system_chrome_mode(self):
        # Legacy compatibility: if the operator opts into system_chrome,
        # we don't double-block on the major version.
        ok, reason = ocd.is_endpoint_compatible_with_mode(
            "Chrome/147.0.7727.138", ocd.BROWSER_MODE_SYSTEM_CHROME,
        )
        assert ok is True
        assert reason is None

    def test_unknown_mode_rejected(self):
        ok, reason = ocd.is_endpoint_compatible_with_mode(
            "Chrome/147.0.7727.138", "system_safari_lol",
        )
        assert ok is False
        assert "unknown browser mode" in reason

    def test_non_chrome_endpoint_rejected(self):
        ok, reason = ocd.is_endpoint_compatible_with_mode(
            "", ocd.BROWSER_MODE_PLAYWRIGHT_CHROMIUM,
        )
        assert ok is False

    def test_older_system_chrome_passes_with_soft_warning(self):
        # Major < 147 not in the bad set: pass even under playwright_chromium.
        # (Operator may have explicit reasons; the bad-major list is the
        # authoritative gate.)
        ok, _reason = ocd.is_endpoint_compatible_with_mode(
            "Chrome/127.0.6533.99", ocd.BROWSER_MODE_PLAYWRIGHT_CHROMIUM,
        )
        assert ok is True

    def test_real_bundled_chromium_143_accepted_under_playwright_mode(self):
        """Regression for the actual observed Playwright bundled
        Chromium endpoint. The Browser field reads 'Chrome/143.0.7499.4'
        with NO 'Chrome for Testing' marker — yet this is the working
        path for OY scraping. Compatibility check must accept it.

        Confirmed working endpoint shape:
            Browser: 'Chrome/143.0.7499.4'
            (no CfT / Playwright suffix in the Browser field)

        If this regresses (e.g. someone tightens the rule to require
        the 'Chrome for Testing' marker), the orchestrator would
        wrongly refuse to attach to the only working CDP endpoint —
        breaking every OY run that relies on the bundled Chromium.
        """
        ok, reason = ocd.is_endpoint_compatible_with_mode(
            "Chrome/143.0.7499.4", ocd.BROWSER_MODE_PLAYWRIGHT_CHROMIUM,
        )
        assert ok is True, (
            f"Real bundled-Chromium 143 endpoint rejected under "
            f"playwright_chromium mode: {reason!r}"
        )
        assert reason is None

    def test_chrome_147_still_rejected_after_143_acceptance(self):
        """Anchor: the 143 acceptance above must NOT relax the
        Chrome 147 rejection. Both rules co-exist."""
        ok, reason = ocd.is_endpoint_compatible_with_mode(
            "Chrome/147.0.7727.138", ocd.BROWSER_MODE_PLAYWRIGHT_CHROMIUM,
        )
        assert ok is False
        assert reason is not None
        assert "147" in reason


# ---------------------------------------------------------------------------
# ensure_browser_for_mode — the high-level preflight
# ---------------------------------------------------------------------------


class TestEnsureBrowserForMode:
    def test_chrome_147_endpoint_rejected_under_playwright_mode(
        self, monkeypatch, tmp_path,
    ):
        """Existing Chrome 147 endpoint MUST NOT be silently reused
        under playwright_chromium mode. Returns state=incompatible_endpoint
        with a populated reason."""
        _patch_json_version(monkeypatch, {
            "Browser": "Chrome/147.0.7727.138",
            "userDataDir": str(tmp_path / "system-profile"),
        })
        result = ocd.ensure_browser_for_mode(
            mode=ocd.BROWSER_MODE_PLAYWRIGHT_CHROMIUM,
            profile_dir=tmp_path / "wanted-pw-profile",
            port=9222,
        )
        assert result["state"] == "incompatible_endpoint"
        assert result["browser_string"] == "Chrome/147.0.7727.138"
        assert result["incompatible_reason"]
        assert "147" in result["incompatible_reason"]
        # Must NOT report state=already_running — silent reuse is the
        # specific failure mode this guard prevents.
        assert result["state"] != "already_running"

    def test_chrome_for_testing_endpoint_reused_under_playwright_mode(
        self, monkeypatch, tmp_path,
    ):
        """Healthy bundled-Chromium endpoint with a matching profile
        is reused (state=already_running)."""
        profile = tmp_path / "pw-profile"
        profile.mkdir()
        _patch_json_version(monkeypatch, {
            "Browser": "Chrome/143.0.7106.0 (Chrome for Testing)",
            "userDataDir": str(profile),
        })
        result = ocd.ensure_browser_for_mode(
            mode=ocd.BROWSER_MODE_PLAYWRIGHT_CHROMIUM,
            profile_dir=profile,
            port=9222,
        )
        assert result["state"] == "already_running"
        assert result["browser_class"]["is_chrome_for_testing"] is True
        assert result["incompatible_reason"] is None

    def test_chrome_147_endpoint_reused_under_system_chrome_mode(
        self, monkeypatch, tmp_path,
    ):
        """Operator opted into system_chrome mode → Chrome 147 is
        accepted (the user took the responsibility)."""
        profile = tmp_path / "sys-profile"
        profile.mkdir()
        _patch_json_version(monkeypatch, {
            "Browser": "Chrome/147.0.7727.138",
            "userDataDir": str(profile),
        })
        result = ocd.ensure_browser_for_mode(
            mode=ocd.BROWSER_MODE_SYSTEM_CHROME,
            profile_dir=profile,
            port=9222,
        )
        assert result["state"] == "already_running"
        assert result["incompatible_reason"] is None

    def test_missing_endpoint_launches_bundled_chromium_for_pw_mode(
        self, monkeypatch, tmp_path,
    ):
        """When CDP is down and mode=playwright_chromium, the helper
        launches via launch_playwright_chromium_debug — NOT via
        launch_chrome_debug (system Chrome path)."""
        # Mock the "is up" probe at function level so the order of
        # urlopen calls doesn't matter.
        monkeypatch.setattr(ocd, "is_chrome_debug_running", lambda port: False)
        monkeypatch.setattr(
            ocd, "wait_for_chrome_debug", lambda port, timeout_sec=20: True,
        )
        monkeypatch.setattr(
            ocd, "get_browser_version_string",
            lambda port: "Chrome/143.0.7106.0 (Chrome for Testing)",
        )
        called_pw = {"n": 0}
        called_sys = {"n": 0}

        def fake_pw_launch(*, profile_dir, port, binary=None, url=None):
            called_pw["n"] += 1
            mock = MagicMock()
            mock.pid = 4242
            return mock

        def fake_sys_launch(*a, **kw):
            called_sys["n"] += 1
            raise AssertionError(
                "system Chrome launcher must NOT be called under "
                "playwright_chromium mode"
            )

        monkeypatch.setattr(
            ocd, "launch_playwright_chromium_debug", fake_pw_launch,
        )
        monkeypatch.setattr(ocd, "launch_chrome_debug", fake_sys_launch)

        result = ocd.ensure_browser_for_mode(
            mode=ocd.BROWSER_MODE_PLAYWRIGHT_CHROMIUM,
            profile_dir=tmp_path / "pw",
            port=9222,
            timeout_sec=1,
            url="https://example/test",
        )
        assert result["state"] == "launched"
        assert result["pid"] == 4242
        assert called_pw["n"] == 1
        assert called_sys["n"] == 0
        assert result["browser_class"]["is_chrome_for_testing"] is True

    def test_missing_endpoint_launches_system_chrome_for_system_mode(
        self, monkeypatch, tmp_path,
    ):
        """When mode=system_chrome and CDP is down, the system Chrome
        launcher is used."""
        monkeypatch.setattr(ocd, "is_chrome_debug_running", lambda port: False)
        monkeypatch.setattr(
            ocd, "wait_for_chrome_debug", lambda port, timeout_sec=20: True,
        )
        monkeypatch.setattr(
            ocd, "get_browser_version_string",
            lambda port: "Chrome/147.0.7727.138",
        )
        called_sys = {"n": 0}
        called_pw = {"n": 0}

        def fake_sys_launch(profile_dir, port=9222, chrome_binary=None,
                            url=None, headless=False):
            called_sys["n"] += 1
            mock = MagicMock()
            mock.pid = 7777
            return mock

        def fake_pw_launch(*a, **kw):
            called_pw["n"] += 1
            raise AssertionError(
                "bundled Chromium launcher must NOT be called under "
                "system_chrome mode"
            )

        monkeypatch.setattr(ocd, "launch_chrome_debug", fake_sys_launch)
        monkeypatch.setattr(
            ocd, "launch_playwright_chromium_debug", fake_pw_launch,
        )

        result = ocd.ensure_browser_for_mode(
            mode=ocd.BROWSER_MODE_SYSTEM_CHROME,
            profile_dir=tmp_path / "sys",
            port=9222,
            timeout_sec=1,
        )
        assert result["state"] == "launched"
        assert called_sys["n"] == 1
        assert called_pw["n"] == 0

    def test_unknown_mode_raises_chrome_debug_error(self, tmp_path):
        with pytest.raises(ocd.ChromeDebugError):
            ocd.ensure_browser_for_mode(
                mode="totally_not_a_mode",
                profile_dir=tmp_path,
                port=9222,
            )

    def test_playwright_binary_missing_returns_failed(
        self, monkeypatch, tmp_path,
    ):
        """When Playwright's bundled Chromium isn't installed, the
        helper does NOT raise — it returns state=failed with a
        helpful error string. Operator decides how to react."""
        _patch_json_version(monkeypatch, None)
        monkeypatch.setattr(
            ocd, "find_playwright_chromium_binary", lambda: None,
        )
        result = ocd.ensure_browser_for_mode(
            mode=ocd.BROWSER_MODE_PLAYWRIGHT_CHROMIUM,
            profile_dir=tmp_path / "pw",
            port=9222,
            timeout_sec=1,
        )
        assert result["state"] == "failed"
        assert "Playwright" in result["error"]
        assert "playwright install chromium" in result["error"].lower() \
            or "playwright" in result["error"].lower()


# ---------------------------------------------------------------------------
# run_all integration: --chrome-debug-browser / profile defaults / passthrough
# ---------------------------------------------------------------------------


class TestRunAllBrowserMode:
    @pytest.fixture(scope="class")
    def run_all(self):
        import importlib.util
        repo = Path(__file__).resolve().parents[2]
        spec = importlib.util.spec_from_file_location(
            "run_all_for_browser_mode_test",
            repo / "scripts" / "run_all.py",
        )
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        return mod

    def test_default_browser_mode_is_playwright_chromium(self, run_all):
        ns = run_all._parse_args(["--product-url", "A000000171427"])
        assert ns.chrome_debug_browser == "playwright_chromium"

    def test_default_profile_dir_resolves_to_pw_under_playwright_mode(
        self, run_all,
    ):
        ns = run_all._parse_args(["--product-url", "A000000171427"])
        resolved = run_all._resolve_profile_dir(ns)
        assert resolved == Path.home() / "chrome-oy-profile-pw"

    def test_default_profile_dir_resolves_to_legacy_under_system_chrome_mode(
        self, run_all,
    ):
        ns = run_all._parse_args([
            "--product-url", "A000000171427",
            "--chrome-debug-browser", "system_chrome",
        ])
        resolved = run_all._resolve_profile_dir(ns)
        assert resolved == Path.home() / "chrome-oy-profile"

    def test_explicit_profile_dir_wins_over_mode_default(self, run_all):
        ns = run_all._parse_args([
            "--product-url", "A000000171427",
            "--chrome-profile-dir", "/tmp/explicit",
        ])
        resolved = run_all._resolve_profile_dir(ns)
        assert resolved == Path("/tmp/explicit")

    def test_preflight_rejects_chrome_147_under_playwright_mode(
        self, run_all, monkeypatch, capsys,
    ):
        """End-to-end on the orchestrator side: when /json/version
        returns Chrome/147 and the operator asked for playwright_chromium,
        the preflight prints the rejection and exits 2 — does NOT
        silently proceed."""
        ns = run_all._parse_args([
            "--product-url",
            "https://www.oliveyoung.co.kr/store/goods/getGoodsDetail.do?goodsNo=A000000171427",
            "--ensure-chrome-debug",
            "--chrome-debug-browser", "playwright_chromium",
        ])
        from src.voc.connectors import oy_chrome_debug as ocd_mod

        def fake_ensure(**kw):
            assert kw["mode"] == "playwright_chromium"
            return {
                "mode": kw["mode"],
                "state": "incompatible_endpoint",
                "port": 9222,
                "profile_dir": str(kw["profile_dir"]),
                "attached_profile_dir": "/Users/op/chrome-oy-profile",
                "browser_string": "Chrome/147.0.7727.138",
                "browser_class": ocd_mod.classify_browser(
                    "Chrome/147.0.7727.138"
                ),
                "incompatible_reason": (
                    "system Chrome 147.0.7727.138 on this CDP "
                    "endpoint is a known-bad attach path under "
                    "playwright_chromium mode."
                ),
                "archive_path": None,
            }

        monkeypatch.setattr(ocd_mod, "ensure_browser_for_mode", fake_ensure)
        with pytest.raises(SystemExit) as ei:
            run_all._run_chrome_debug_preflight(ns)
        assert ei.value.code == 2
        captured = capsys.readouterr()
        combined = captured.out + captured.err
        # Rejection log surfaces the bad version and the recovery hint.
        # action="rejected" is printed to stderr alongside the reason
        # so the operator's terminal shows the error path clearly.
        assert "rejected" in combined
        assert "147" in combined
        assert "open_oy_chromium_debug.py" in captured.err

    def test_preflight_passes_url_into_ensure_browser_for_mode(
        self, run_all, monkeypatch,
    ):
        """The product URL is forwarded as the initial URL to the
        launched browser — the operator lands on the product detail
        page and not chrome://newtab."""
        url = (
            "https://www.oliveyoung.co.kr/store/goods/getGoodsDetail.do"
            "?goodsNo=A000000171427"
        )
        ns = run_all._parse_args([
            "--product-url", url,
            "--ensure-chrome-debug",
        ])
        from src.voc.connectors import oy_chrome_debug as ocd_mod
        captured: dict = {}

        def fake_ensure(**kw):
            captured.update(kw)
            return {
                "mode": kw["mode"],
                "state": "already_running",
                "port": kw["port"],
                "profile_dir": str(kw["profile_dir"]),
                "attached_profile_dir": str(kw["profile_dir"]),
                "browser_string": "Chrome/143.0 (Chrome for Testing)",
                "browser_class": ocd_mod.classify_browser(
                    "Chrome/143.0 (Chrome for Testing)"
                ),
                "incompatible_reason": None,
                "archive_path": None,
            }

        monkeypatch.setattr(ocd_mod, "ensure_browser_for_mode", fake_ensure)
        run_all._run_chrome_debug_preflight(ns)
        assert captured["url"] == url
        assert captured["mode"] == "playwright_chromium"

    def test_preflight_reuses_real_bundled_chromium_143_endpoint(
        self, run_all, monkeypatch, capsys,
    ):
        """End-to-end regression for the actual working setup:
        port 9222 is up, Browser='Chrome/143.0.7499.4', mode is the
        default playwright_chromium. The preflight must REUSE the
        endpoint and exit normally — not reject it for missing the
        'Chrome for Testing' marker.

        Locks the behavior the operator confirmed works:
            cdp_attach_failed=false, review_api_response_count=1.
        """
        ns = run_all._parse_args([
            "--product-url",
            "https://www.oliveyoung.co.kr/store/goods/getGoodsDetail.do?goodsNo=A000000171427",
            "--ensure-chrome-debug",
        ])
        from src.voc.connectors import oy_chrome_debug as ocd_mod

        # Stub the in-process CDP probe + classifier path so we don't
        # need a real listener on 9222. The fake records what arguments
        # the orchestrator passed and reports a healthy 143 endpoint.
        called: dict = {}

        def fake_ensure(**kw):
            called["mode"] = kw.get("mode")
            return {
                "mode": kw["mode"],
                "state": "already_running",
                "port": kw["port"],
                "profile_dir": str(kw["profile_dir"]),
                "attached_profile_dir": str(kw["profile_dir"]),
                "browser_string": "Chrome/143.0.7499.4",
                "browser_class": ocd_mod.classify_browser(
                    "Chrome/143.0.7499.4"
                ),
                "incompatible_reason": None,
                "archive_path": None,
            }

        monkeypatch.setattr(ocd_mod, "ensure_browser_for_mode", fake_ensure)
        # Must NOT raise.
        run_all._run_chrome_debug_preflight(ns)
        # The fake was called with the default playwright_chromium mode.
        assert called["mode"] == "playwright_chromium"
        captured = capsys.readouterr()
        combined = captured.out + captured.err
        assert "browser       : Chrome/143.0.7499.4" in combined
        assert "action        : reused" in combined
        # No rejection language anywhere.
        assert "rejected" not in combined
        assert "incompatible" not in combined.lower()
        assert "147" not in combined

    def test_preflight_logs_full_block(
        self, run_all, monkeypatch, capsys,
    ):
        """The required preflight log block — browser_mode / profile_dir /
        cdp_endpoint / browser / action — must be printed."""
        ns = run_all._parse_args([
            "--product-url", "A000000171427",
            "--ensure-chrome-debug",
        ])
        from src.voc.connectors import oy_chrome_debug as ocd_mod
        monkeypatch.setattr(
            ocd_mod, "ensure_browser_for_mode",
            lambda **kw: {
                "mode": kw["mode"],
                "state": "already_running",
                "port": kw["port"],
                "profile_dir": str(kw["profile_dir"]),
                "attached_profile_dir": str(kw["profile_dir"]),
                "browser_string": "Chrome/143.0.7106.0 (Chrome for Testing)",
                "browser_class": ocd_mod.classify_browser(
                    "Chrome/143.0.7106.0 (Chrome for Testing)"
                ),
                "incompatible_reason": None,
                "archive_path": None,
            },
        )
        run_all._run_chrome_debug_preflight(ns)
        out = capsys.readouterr().out
        assert "browser_mode  : playwright_chromium" in out
        assert "profile_dir   :" in out
        assert "cdp_endpoint  : http://127.0.0.1:9222" in out
        assert "browser       : Chrome/143.0.7106.0" in out
        assert "action        : reused" in out


# ---------------------------------------------------------------------------
# run_all → phase2e plumbing: cdp endpoint passthrough
# ---------------------------------------------------------------------------


class TestRunAllPhase2eCDPPlumbing:
    @pytest.fixture(scope="class")
    def run_all(self):
        import importlib.util
        repo = Path(__file__).resolve().parents[2]
        spec = importlib.util.spec_from_file_location(
            "run_all_for_phase2e_plumb_test",
            repo / "scripts" / "run_all.py",
        )
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        return mod

    def test_phase2e_subprocess_receives_cdp_endpoint(
        self, run_all, monkeypatch, tmp_path,
    ):
        """The orchestrator must forward `--cdp-endpoint` to the
        phase2e subprocess so the manifest pins the right port."""
        seen: dict = {}

        class _FakeProc:
            def __init__(self, cmd, env=None, cwd=None, check=True):
                seen["cmd"] = cmd

        def fake_run(cmd, env=None, cwd=None, check=False):
            seen["cmd"] = list(cmd)

            class _R:
                returncode = 0
            return _R()

        monkeypatch.setattr(run_all.subprocess, "run", fake_run)
        run_dir = tmp_path / "run"
        run_dir.mkdir()
        run_all._run_phase2e_pipeline(
            url="A000000171427",
            run_dir=run_dir,
            product_name=None,
            product_slug="product-deadbeef",
            skip_scrape=True,
            stub_llm=True,
            max_reviews="50",
            multi_sort=False,
            sort_type=None,
            corpus_mode="observable_multi_sort",
            cdp_port=9333,
        )
        cmd = seen["cmd"]
        assert "--cdp-endpoint" in cmd
        idx = cmd.index("--cdp-endpoint")
        assert cmd[idx + 1] == "http://127.0.0.1:9333"

    def test_phase2e_runner_accepts_cdp_endpoint_arg(self):
        """Smoke check: the phase2e runner's argparse exposes
        `--cdp-endpoint` and threads it into `build_manifest`."""
        import importlib.util
        repo = Path(__file__).resolve().parents[2]
        spec = importlib.util.spec_from_file_location(
            "run_phase2e_pipeline_for_test",
            repo / "scripts" / "run_phase2e_pipeline.py",
        )
        mod = importlib.util.module_from_spec(spec)
        # Loading the module is heavy; just assert the source contains
        # the expected wiring so we don't spin up sqlalchemy etc.
        src = (repo / "scripts" / "run_phase2e_pipeline.py").read_text()
        assert '"--cdp-endpoint"' in src
        assert "cdp_endpoint=args.cdp_endpoint" in src

    def test_build_manifest_uses_cdp_endpoint(self, tmp_path, monkeypatch):
        """build_manifest must persist the caller's cdp_endpoint into
        the manifest's `defaults.cdp_endpoint` slot — that's what the
        scraper subprocess reads."""
        import importlib.util
        repo = Path(__file__).resolve().parents[2]
        spec = importlib.util.spec_from_file_location(
            "run_phase2e_pipeline_build_manifest_test",
            repo / "scripts" / "run_phase2e_pipeline.py",
        )
        # Avoid heavy imports inside run_phase2e_pipeline by stubbing
        # the parts that try to connect to OpenAI etc. We execute the
        # module in a fresh namespace.
        mod = importlib.util.module_from_spec(spec)
        try:
            spec.loader.exec_module(mod)
        except Exception:
            pytest.skip(
                "run_phase2e_pipeline import requires runtime deps not "
                "available in this test environment"
            )
        manifest_path = mod.build_manifest(
            "A0001", "Test", 5,
            cdp_endpoint="http://127.0.0.1:9444",
        )
        try:
            payload = json.loads(manifest_path.read_text())
            assert payload["defaults"]["cdp_endpoint"] == "http://127.0.0.1:9444"
        finally:
            try:
                manifest_path.unlink()
            except FileNotFoundError:
                pass
