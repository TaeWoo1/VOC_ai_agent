"""CLI argparse tests for scripts/scrape_coupang_reviews.py.

Covers the `--chrome-major` flag (added to support Chrome / chromedriver
version-skew via undetected_chromedriver's `version_main` parameter):

- `--chrome-major` parses as int
- default is None
- value is wired through Config(...) and reaches uc.Chrome's kwargs

The script imports `undetected_chromedriver` at module load. On systems
without the [scraping] extra installed, the import fails and the script
does sys.exit(2) — these tests skip cleanly via importorskip in that case.
The default repo-test environment (Python 3.14) does not ship the extras;
running pytest there will skip this file. Running pytest under
/opt/homebrew/opt/python@3.13/bin/python3.13 (which has the extras
installed) executes the tests for real.

No live scraping. No Chrome launch. uc.Chrome / uc.ChromeOptions are
monkeypatched with stubs that capture kwargs.
"""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path
from unittest.mock import MagicMock

import pytest

# Skip the entire file when the [scraping] extra is missing — the script
# does sys.exit(2) at import time without it, which would crash pytest's
# collection step.
pytest.importorskip("undetected_chromedriver")
pytest.importorskip("selenium")


REPO_ROOT = Path(__file__).resolve().parents[2]
SCRIPT_PATH = REPO_ROOT / "scripts" / "scrape_coupang_reviews.py"


@pytest.fixture(scope="module")
def script_module():
    """Load the script as a module so we can call _parse_args / get_driver
    directly. The script is a CLI entry point, not an importable package.
    """
    spec = importlib.util.spec_from_file_location(
        "scrape_coupang_reviews_under_test", SCRIPT_PATH,
    )
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


_PRODUCT_URL = "https://www.coupang.com/vp/products/7164394503"


# ---------------------------------------------------------------------------
# CLI parsing — --chrome-major
# ---------------------------------------------------------------------------

def test_chrome_major_default_is_none(script_module):
    """No --chrome-major flag → args.chrome_major is None (preserves
    pre-existing behavior of letting uc.Chrome auto-detect)."""
    args = script_module._parse_args(["--product-url", _PRODUCT_URL])
    assert args.chrome_major is None


def test_chrome_major_parses_as_int(script_module):
    args = script_module._parse_args([
        "--product-url", _PRODUCT_URL, "--chrome-major", "147",
    ])
    assert args.chrome_major == 147
    assert isinstance(args.chrome_major, int)


def test_chrome_major_in_combined_invocation(script_module):
    """--chrome-major coexists with the other CLI flags without conflict."""
    args = script_module._parse_args([
        "--product-url", _PRODUCT_URL,
        "--max-reviews", "50",
        "--output-csv", "/tmp/_probe.csv",
        "--debug-dir", "/tmp/coupang_probe",
        "--chrome-major", "147",
    ])
    assert args.chrome_major == 147
    assert args.max_reviews == 50
    assert args.product_urls == [_PRODUCT_URL]


def test_help_includes_chrome_major(script_module, capsys):
    """--help mentions --chrome-major so operators discover the flag."""
    with pytest.raises(SystemExit):
        script_module._parse_args(["--help"])
    captured = capsys.readouterr()
    help_text = captured.out + captured.err
    assert "--chrome-major" in help_text


# ---------------------------------------------------------------------------
# Config dataclass — chrome_major field
# ---------------------------------------------------------------------------

def test_config_has_chrome_major_field(script_module):
    fields = script_module.Config.__dataclass_fields__
    assert "chrome_major" in fields
    # Default value is None
    instance = script_module.Config(
        search_url="https://example/search",
        top_n_products=None,
        max_reviews=None,
        out_csv=Path("/tmp/x.csv"),
        out_jsonl=None,
        headless=True,
        debug_dir=Path("/tmp/d"),
    )
    assert instance.chrome_major is None


def test_config_accepts_chrome_major_value(script_module):
    instance = script_module.Config(
        search_url="https://example/search",
        top_n_products=None,
        max_reviews=None,
        out_csv=Path("/tmp/x.csv"),
        out_jsonl=None,
        headless=True,
        debug_dir=Path("/tmp/d"),
        chrome_major=147,
    )
    assert instance.chrome_major == 147


# ---------------------------------------------------------------------------
# get_driver — value reaches uc.Chrome
# ---------------------------------------------------------------------------

def _build_cfg(script_module, *, chrome_major):
    return script_module.Config(
        search_url="https://example/search",
        top_n_products=None,
        max_reviews=None,
        out_csv=Path("/tmp/x.csv"),
        out_jsonl=None,
        headless=True,
        debug_dir=Path("/tmp/d"),
        chrome_major=chrome_major,
    )


def test_get_driver_passes_version_main_when_set(script_module, monkeypatch):
    """When cfg.chrome_major is an int, get_driver passes
    version_main=<int> in the uc.Chrome kwargs."""
    captured: dict = {}

    def fake_chrome(**kwargs):
        captured.update(kwargs)
        # Return a stub driver — get_driver calls .maximize_window() inside
        # a try/except, so any object that raises is fine.
        stub = MagicMock()
        return stub

    fake_options = MagicMock()
    fake_options_cls = MagicMock(return_value=fake_options)

    monkeypatch.setattr(script_module.uc, "Chrome", fake_chrome)
    monkeypatch.setattr(script_module.uc, "ChromeOptions", fake_options_cls)

    cfg = _build_cfg(script_module, chrome_major=147)
    script_module.get_driver(cfg)

    assert captured.get("version_main") == 147
    assert "options" in captured  # confirms kwargs path is intact
    assert captured.get("use_subprocess") is True


def test_get_driver_omits_version_main_when_none(script_module, monkeypatch):
    """When cfg.chrome_major is None (default), version_main must NOT be
    passed — preserving the prior auto-detect behavior. Regression check."""
    captured: dict = {}

    def fake_chrome(**kwargs):
        captured.update(kwargs)
        return MagicMock()

    monkeypatch.setattr(script_module.uc, "Chrome", fake_chrome)
    monkeypatch.setattr(script_module.uc, "ChromeOptions", MagicMock(return_value=MagicMock()))

    cfg = _build_cfg(script_module, chrome_major=None)
    script_module.get_driver(cfg)

    assert "version_main" not in captured, (
        "version_main must not be passed when chrome_major is None — "
        "doing so could pin the driver against the wrong Chrome major"
    )
    assert "options" in captured
    assert captured.get("use_subprocess") is True
