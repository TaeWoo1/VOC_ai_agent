#!/usr/bin/env python3
"""CLI: ensure a Chrome debug session is running for OliveYoung scraping.

Default behavior:
  - If the CDP endpoint is already reachable on the configured
    port, print "ready" and exit 0.
  - Otherwise, launch Chrome with the configured profile + debug
    flags and exit 0.

Usage
-----

    PYTHONPATH=. python3 scripts/open_oy_chrome_debug.py
    PYTHONPATH=. python3 scripts/open_oy_chrome_debug.py --reset-profile
    PYTHONPATH=. python3 scripts/open_oy_chrome_debug.py \\
        --url "https://www.oliveyoung.co.kr/" --wait

Exit codes
----------
  0  ready (already running OR launched and waited successfully if --wait)
  2  reset failed (Chrome still running, archive collision, …)
  3  port collision under --force-new
  4  Chrome / Chromium binary not found
  5  --wait timed out

Read-only on the operator's environment by default. The reset path
is non-destructive (move-aside, never delete) and only fires when
`--reset-profile` is explicitly passed.
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO))

from src.voc.connectors.oy_chrome_debug import (  # noqa: E402
    DEFAULT_CDP_PORT,
    DEFAULT_TIMEOUT_SEC,
    ChromeDebugError,
    find_chrome_binary,
    get_attached_profile_dir,
    is_chrome_debug_running,
    launch_chrome_debug,
    reset_profile,
    wait_for_chrome_debug,
)


def _parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    p = argparse.ArgumentParser(
        prog="open_oy_chrome_debug",
        description=__doc__.split("\n\n")[0],
    )
    p.add_argument(
        "--profile-dir", type=Path,
        default=Path.home() / "chrome-oy-profile",
        help="Chrome user-data-dir for the OY debug session "
             "(default: ~/chrome-oy-profile).",
    )
    p.add_argument(
        "--port", type=int, default=DEFAULT_CDP_PORT,
        help=f"CDP debug port (default: {DEFAULT_CDP_PORT}).",
    )
    p.add_argument(
        "--url", default=None,
        help="Optional initial URL for the launched Chrome window. "
             "Useful as `--url https://www.oliveyoung.co.kr/` so the "
             "operator lands on the login page directly.",
    )
    p.add_argument(
        "--reset-profile", action="store_true",
        help="Archive the current profile dir to "
             "`<dir>_broken_<UTC ts>` and create a fresh one before "
             "launching. Refuses if Chrome is running on the port. "
             "Never deletes — archive is preserved for audit.",
    )
    p.add_argument(
        "--force-new", action="store_true",
        help="Refuse to attach if the CDP port is already in use. "
             "Useful for catching ghost / orphan Chrome processes "
             "that aren't the debug session you expect.",
    )
    p.add_argument(
        "--wait", action="store_true",
        help="After launching, poll the CDP endpoint until it "
             "responds, up to --timeout-sec.",
    )
    p.add_argument(
        "--timeout-sec", type=int, default=DEFAULT_TIMEOUT_SEC,
        help=f"How long to wait for CDP readiness when --wait is "
             f"set (default: {DEFAULT_TIMEOUT_SEC}).",
    )
    p.add_argument(
        "--chrome-binary", default=None,
        help="Override the auto-detected Chrome / Chromium path.",
    )
    return p.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = _parse_args(argv)
    profile_dir: Path = args.profile_dir.expanduser().resolve()
    cdp_url = f"http://127.0.0.1:{args.port}/json/version"

    # ---- Reset path ------------------------------------------------------
    if args.reset_profile:
        if not profile_dir.is_dir():
            print(
                f"  profile dir does not exist: {profile_dir} "
                f"— nothing to reset (will be created on launch)"
            )
        else:
            try:
                archive = reset_profile(profile_dir)
            except (FileNotFoundError, ChromeDebugError) as e:
                print(f"✗ reset failed: {e}", file=sys.stderr)
                return 2
            print(f"✓ archived previous profile → {archive}")
            print(f"  fresh profile at {profile_dir}")

    # ---- Reachability + force-new gate ----------------------------------
    already_running = is_chrome_debug_running(args.port)
    if already_running and args.force_new:
        print(
            f"⚠ CDP port {args.port} already in use — refusing to "
            f"launch a second instance (--force-new). Quit the "
            f"existing Chrome first.",
            file=sys.stderr,
        )
        return 3
    if already_running:
        attached = get_attached_profile_dir(args.port)
        if attached is None:
            print(
                "⚠ CDP is already running, but profile_dir could not "
                "be verified."
            )
            print(
                f"  If this is not your intended {profile_dir}, "
                f"quit Chrome and rerun."
            )
            print(f"  CDP endpoint: {cdp_url}")
            return 0
        if attached.resolve() == profile_dir.resolve():
            print(f"✓ Chrome debug already running (profile matches)")
            print(f"  CDP endpoint  : {cdp_url}")
            print(f"  attached      : {attached}")
            return 0
        # Mismatched.
        print(
            "✗ Chrome debug is running with a DIFFERENT profile "
            "than requested.",
            file=sys.stderr,
        )
        print(f"  requested: {profile_dir}", file=sys.stderr)
        print(f"  attached : {attached}", file=sys.stderr)
        print(
            "  Quit Chrome (Cmd+Q on macOS, fully) and rerun.",
            file=sys.stderr,
        )
        return 6

    # ---- Launch ---------------------------------------------------------
    try:
        binary = args.chrome_binary or find_chrome_binary()
    except FileNotFoundError as e:
        print(f"✗ {e}", file=sys.stderr)
        return 4

    print(f"  launching Chrome debug...")
    print(f"    binary       : {binary}")
    print(f"    port         : {args.port}")
    print(f"    profile_dir  : {profile_dir}")
    if args.url:
        print(f"    initial URL  : {args.url}")

    proc = launch_chrome_debug(
        profile_dir,
        port=args.port,
        chrome_binary=binary,
        url=args.url,
    )

    if not args.wait:
        print(f"  Chrome launched (pid {proc.pid}); not polling for ready")
        print(f"  Verify with: curl -s {cdp_url} | python3 -m json.tool")
        return 0

    ok = wait_for_chrome_debug(args.port, timeout_sec=args.timeout_sec)
    if not ok:
        print(
            f"✗ Chrome did not become ready on {cdp_url} within "
            f"{args.timeout_sec}s",
            file=sys.stderr,
        )
        return 5
    print(f"✓ Chrome debug ready (pid {proc.pid})")
    print(f"  CDP endpoint: {cdp_url}")
    print(f"  profile_dir : {profile_dir}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
