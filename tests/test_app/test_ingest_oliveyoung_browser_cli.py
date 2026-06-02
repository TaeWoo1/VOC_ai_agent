"""CLI argparse tests for scripts/ingest_oliveyoung_browser_phase1.py.

Covers PR-1 hardening: the new --cold-start-timeout / --continuation-timeout
/ --scroll-attempts flags must parse, default to None, and pass through to
the connector's constructor unchanged. No live scraping, no DB writes — these
tests only exercise argparse and verify the wiring contract.
"""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[2]
SCRIPT_PATH = REPO_ROOT / "scripts" / "ingest_oliveyoung_browser_phase1.py"


@pytest.fixture(scope="module")
def script_module():
    """Load the script as a module so we can call _parse_args directly.

    The script is intended as a CLI entrypoint and is not installed as a
    package, so we use importlib.util to load it from disk.
    """
    spec = importlib.util.spec_from_file_location(
        "ingest_oliveyoung_browser_phase1_under_test", SCRIPT_PATH,
    )
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


_PRODUCT_URL = (
    "https://www.oliveyoung.co.kr/store/goods/getGoodsDetail.do"
    "?goodsNo=A000000238828&tab=review"
)


def test_minimal_args_default_new_flags_to_none(script_module):
    """A run with just product_url leaves the new PR-1 flags at their defaults.

    The connector constructor treats None as "use class constants" so
    behavior matches today's pre-PR-1 behavior.
    """
    args = script_module._parse_args([_PRODUCT_URL])
    assert args.product_url == _PRODUCT_URL
    assert args.max_results == 20  # legacy default
    assert args.headful is False  # legacy default
    # PR-1 flags: all default to None
    assert args.cold_start_timeout_s is None
    assert args.page_n_timeout_s is None
    assert args.max_scroll_attempts is None
    # PR-2 flags: all off / default by design
    assert args.debug_dir is None
    assert args.capture_partial_on_invalid is False
    assert args.auth_retry == 0


def test_cold_start_timeout_flag(script_module):
    args = script_module._parse_args([_PRODUCT_URL, "--cold-start-timeout", "60"])
    assert args.cold_start_timeout_s == 60.0


def test_continuation_timeout_flag(script_module):
    args = script_module._parse_args([_PRODUCT_URL, "--continuation-timeout", "12.5"])
    assert args.page_n_timeout_s == 12.5


def test_scroll_attempts_flag(script_module):
    args = script_module._parse_args([_PRODUCT_URL, "--scroll-attempts", "5"])
    assert args.max_scroll_attempts == 5


def test_all_pr1_flags_combine(script_module):
    args = script_module._parse_args([
        _PRODUCT_URL,
        "--max", "50",
        "--cold-start-timeout", "45",
        "--continuation-timeout", "10",
        "--scroll-attempts", "4",
    ])
    assert args.max_results == 50
    assert args.cold_start_timeout_s == 45.0
    assert args.page_n_timeout_s == 10.0
    assert args.max_scroll_attempts == 4


def test_legacy_flags_unchanged(script_module):
    """Legacy flags still parse exactly as before PR-1."""
    args = script_module._parse_args([
        _PRODUCT_URL,
        "--max", "100",
        "--headful",
        "--cookies-json", "/tmp/cookies.json",
        "--cdp-endpoint", "http://localhost:9222",
    ])
    assert args.max_results == 100
    assert args.headful is True
    # cookies_json is parsed as Path
    assert str(args.cookies_json) == "/tmp/cookies.json"
    assert args.cdp_endpoint == "http://localhost:9222"


def test_help_includes_new_pr1_flags(script_module, capsys):
    """The --help output mentions each new PR-1 flag so operators discover them.

    argparse exits the process via SystemExit on --help; the help text lands
    on stdout via capsys.
    """
    with pytest.raises(SystemExit):
        script_module._parse_args([_PRODUCT_URL, "--help"])
    captured = capsys.readouterr()
    help_text = captured.out + captured.err
    assert "--cold-start-timeout" in help_text
    assert "--continuation-timeout" in help_text
    assert "--scroll-attempts" in help_text


# ---------------------------------------------------------------------------
# PR-2 CLI flags: debug-dir, capture-partial-on-invalid, auth-retry
# ---------------------------------------------------------------------------

def test_debug_dir_flag(script_module):
    args = script_module._parse_args([_PRODUCT_URL, "--debug-dir", "/tmp/oy_naming"])
    # Path is parsed as a Path object
    assert str(args.debug_dir) == "/tmp/oy_naming"


def test_capture_partial_on_invalid_flag(script_module):
    args = script_module._parse_args([_PRODUCT_URL, "--capture-partial-on-invalid"])
    assert args.capture_partial_on_invalid is True


def test_auth_retry_flag(script_module):
    args = script_module._parse_args([_PRODUCT_URL, "--auth-retry", "1"])
    assert args.auth_retry == 1


def test_all_pr2_flags_combine(script_module):
    args = script_module._parse_args([
        _PRODUCT_URL,
        "--debug-dir", "/tmp/oy_naming",
        "--capture-partial-on-invalid",
        "--auth-retry", "2",
    ])
    assert str(args.debug_dir) == "/tmp/oy_naming"
    assert args.capture_partial_on_invalid is True
    assert args.auth_retry == 2


def test_pr1_and_pr2_flags_compose(script_module):
    """All PR-1 + PR-2 flags can coexist on a single invocation."""
    args = script_module._parse_args([
        _PRODUCT_URL,
        "--max", "200",
        "--headful",
        "--cold-start-timeout", "60",
        "--continuation-timeout", "12",
        "--scroll-attempts", "5",
        "--debug-dir", "/tmp/oy_naming",
        "--capture-partial-on-invalid",
        "--auth-retry", "1",
    ])
    assert args.max_results == 200
    assert args.headful is True
    assert args.cold_start_timeout_s == 60.0
    assert args.page_n_timeout_s == 12.0
    assert args.max_scroll_attempts == 5
    assert str(args.debug_dir) == "/tmp/oy_naming"
    assert args.capture_partial_on_invalid is True
    assert args.auth_retry == 1


def test_help_includes_pr2_flags(script_module, capsys):
    """`--help` output mentions each PR-2 flag."""
    with pytest.raises(SystemExit):
        script_module._parse_args([_PRODUCT_URL, "--help"])
    captured = capsys.readouterr()
    help_text = captured.out + captured.err
    assert "--debug-dir" in help_text
    assert "--capture-partial-on-invalid" in help_text
    assert "--auth-retry" in help_text
