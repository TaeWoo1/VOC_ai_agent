"""Launch Playwright's bundled Chromium with --remote-debugging-port.

Workaround for the Playwright/Chrome CDP `Browser.setDownloadBehavior`
wall (see `docs/oy_cdp_attach_compatibility.md`). The system Chrome
(147.x) rejects Playwright's browser-level setDownloadBehavior call;
the Chromium bundled with Playwright (Chrome for Testing 143.x) still
accepts it.

USAGE
-----

    PYTHONPATH=. python3 scripts/open_oy_chromium_debug.py \
        --profile-dir ~/chrome-oy-profile-pw \
        --port 9222 \
        --wait

Then re-run `scripts/diagnose_oy_review_access.py` against the same
port. The verdict should shift away from `cdp_attach_failed`.

PROFILE DIR
-----------

Defaults to `~/chrome-oy-profile-pw` — distinct from the system Chrome
profile at `~/chrome-oy-profile`. The bundled Chromium is a SEPARATE
browser; the OY login session does NOT carry over from the system
Chrome window. The operator must log in once inside the Chromium
window before scraping.

EXIT CODES
----------

  0  ready (already running OR newly launched and verified)
  2  Playwright not installed / bundled Chromium binary not found
  3  invalid CLI argument
  4  Chrome already running on the target port (refuse to clash)
  5  launched but `wait_for_chrome_debug` did not see it within timeout
"""

from __future__ import annotations

import argparse
import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT))

from src.voc.connectors.oy_chrome_debug import (  # noqa: E402
    DEFAULT_CDP_PORT,
    is_chrome_debug_running,
    wait_for_chrome_debug,
)


def find_playwright_chromium() -> str | None:
    """Return the absolute path to Playwright's bundled Chromium binary,
    or None if Playwright isn't installed / hasn't downloaded a browser.

    Uses Playwright's own `executable_path` accessor — robust across
    Playwright versions and OS layouts. We do NOT shell out to
    `playwright install` here; the operator runs that themselves.
    """
    try:
        from playwright.sync_api import sync_playwright  # type: ignore
    except ImportError:
        return None
    try:
        with sync_playwright() as p:
            path = p.chromium.executable_path
    except Exception:
        return None
    if not path:
        return None
    p = Path(path)
    return str(p) if p.exists() else None


def launch_playwright_chromium(
    profile_dir: Path,
    binary: str,
    port: int = DEFAULT_CDP_PORT,
    url: str | None = None,
) -> subprocess.Popen:
    """Spawn the bundled Chromium with our CDP flags. Mirrors
    `launch_chrome_debug` in src/voc/connectors/oy_chrome_debug.py
    but does NOT call `find_chrome_binary` — we want the bundled
    Chromium specifically, not the system Chrome.

    Detached so the next pipeline run can reuse the same instance.
    """
    profile_dir = Path(profile_dir).expanduser().resolve()
    profile_dir.mkdir(parents=True, exist_ok=True)
    cmd: list[str] = [
        binary,
        f"--remote-debugging-port={int(port)}",
        f"--user-data-dir={profile_dir}",
        "--no-first-run",
        "--no-default-browser-check",
    ]
    if url:
        cmd.append(url)
    return subprocess.Popen(
        cmd,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        start_new_session=True,
    )


def _parse_args(argv: list[str] | None) -> argparse.Namespace:
    p = argparse.ArgumentParser(
        prog="open_oy_chromium_debug",
        description=(
            "Launch Playwright's bundled Chromium with --remote-debugging-port. "
            "Workaround for the Playwright/Chrome 147 CDP "
            "Browser.setDownloadBehavior wall. See "
            "docs/oy_cdp_attach_compatibility.md."
        ),
    )
    p.add_argument(
        "--profile-dir",
        type=Path,
        default=Path.home() / "chrome-oy-profile-pw",
        help=(
            "Persistent profile dir for the bundled Chromium. Default: "
            "~/chrome-oy-profile-pw (distinct from the system Chrome "
            "profile at ~/chrome-oy-profile)."
        ),
    )
    p.add_argument(
        "--port", type=int, default=DEFAULT_CDP_PORT,
        help=f"CDP port (default {DEFAULT_CDP_PORT}).",
    )
    p.add_argument(
        "--url", type=str, default=None,
        help="Optional initial URL to open in the launched window.",
    )
    p.add_argument(
        "--binary", type=str, default=None,
        help=(
            "Override Playwright's bundled Chromium path. Use only when "
            "Playwright's auto-detect picks the wrong binary; otherwise "
            "leave unset and let the script auto-detect."
        ),
    )
    p.add_argument(
        "--wait", action="store_true",
        help=(
            "After launching, poll the CDP endpoint until it answers "
            "(or `--wait-timeout` elapses). Recommended."
        ),
    )
    p.add_argument(
        "--wait-timeout", type=int, default=20,
        help="Seconds to wait when --wait is set (default 20).",
    )
    return p.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = _parse_args(argv)

    if is_chrome_debug_running(args.port):
        print(
            f"  CDP already listening on port {args.port} — not launching a "
            "second browser. Quit any existing window before re-running "
            "if you want a fresh start.",
        )
        return 4

    binary = args.binary or find_playwright_chromium()
    if not binary:
        print(
            "  ✗ Playwright's bundled Chromium not found.\n"
            "    Install it:\n"
            "        python3 -m pip install 'playwright<1.58'\n"
            "        python3 -m playwright install chromium\n"
            "    Or pass --binary <path> explicitly.",
            file=sys.stderr,
        )
        return 2

    print(f"  binary      : {binary}")
    print(f"  profile_dir : {args.profile_dir.expanduser()}")
    print(f"  port        : {args.port}")
    if args.url:
        print(f"  url         : {args.url}")
    print()
    print("  launching Playwright-bundled Chromium...")

    proc = launch_playwright_chromium(
        profile_dir=args.profile_dir,
        binary=binary,
        port=args.port,
        url=args.url,
    )

    if not args.wait:
        print(f"  Chromium launched (pid {proc.pid}); not polling for ready.")
        return 0

    print(f"  Chromium launched (pid {proc.pid}); waiting up to "
          f"{args.wait_timeout}s for CDP...")
    if not wait_for_chrome_debug(args.port, timeout_sec=args.wait_timeout):
        print(
            f"  ✗ CDP did not come up on port {args.port} within "
            f"{args.wait_timeout}s. Check `ps -ef | grep -i chromium`.",
            file=sys.stderr,
        )
        return 5

    print(f"  ✓ CDP ready on port {args.port}.")
    print()
    print("  Next step:")
    print(
        "    PYTHONPATH=. python3 scripts/diagnose_oy_review_access.py \\\n"
        "      --product-url 'https://www.oliveyoung.co.kr/store/goods/"
        f"getGoodsDetail.do?goodsNo=A000000171427' --port {args.port}"
    )
    print()
    print(
        "  Note: this is the Playwright-bundled Chromium, NOT your system\n"
        "  Chrome. The OY session does NOT carry over — log into OliveYoung\n"
        "  once inside this window before scraping."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
