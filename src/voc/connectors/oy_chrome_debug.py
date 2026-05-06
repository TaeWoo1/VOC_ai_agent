"""Chrome CDP debug-launcher utilities for the OliveYoung scrape workflow.

Operator preflight: ensure a Chrome process is listening on the
configured CDP port (default 9222) with the configured profile,
before scraping starts. Reset the profile when explicitly asked.

Hard rules
----------
- Never kill an existing Chrome process. The caller's responsibility.
- Never delete a profile permanently. Reset = move-aside (archive
  with a UTC timestamp), then create a fresh empty dir.
- Pure Python stdlib (urllib, subprocess, shutil, pathlib). No new
  third-party dependencies.
- Long-lived child Chrome process. `launch_chrome_debug` uses
  `start_new_session=True` so the browser survives the orchestrator
  that started it — the next pipeline run can reuse the session.
- macOS first (the operator's actual platform). Linux/WSL fallbacks
  are provided but not the primary target.

Companion files
---------------
- `scripts/open_oy_chrome_debug.py` — standalone CLI wrapper.
- `scripts/reset_oy_chrome_profile.sh` — POSIX shell equivalent of
  the `reset_profile()` step. Both paths produce identical archive
  layouts.
- `docs/oliveyoung_chrome_debug_workflow.md` — operator playbook.
- `docs/oy_chrome_profile_reset.md` — 30-minute false-empty rule
  (when to reset).
"""
from __future__ import annotations

import json
import re
import shutil
import subprocess
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

DEFAULT_CDP_PORT: int = 9222
DEFAULT_TIMEOUT_SEC: int = 20

# Profile candidates, priority order. Mirrors
# `scripts/reset_oy_chrome_profile.sh` so the two paths agree on
# what "the OY profile" means.
PROFILE_CANDIDATES: tuple[Path, ...] = (
    Path("/tmp/chrome-debug-oy"),
    Path.home() / "Library" / "Chrome-OY-debug",
    Path.home() / "chrome-oy-profile",
    Path("/tmp/chrome-oy-profile"),
)

# Browser-mode constants. The OY scrape path attaches over CDP and
# Playwright's `Browser.setDownloadBehavior` call has been observed to
# fail against system Chrome 147 — see docs/oy_cdp_attach_compatibility.md.
# `playwright_chromium` (Chrome for Testing, bundled with Playwright)
# is the working path; `system_chrome` is kept as an opt-in for legacy
# cases or non-OY scrapes.
BROWSER_MODE_SYSTEM_CHROME: str = "system_chrome"
BROWSER_MODE_PLAYWRIGHT_CHROMIUM: str = "playwright_chromium"
BROWSER_MODES: tuple[str, ...] = (
    BROWSER_MODE_SYSTEM_CHROME,
    BROWSER_MODE_PLAYWRIGHT_CHROMIUM,
)
DEFAULT_BROWSER_MODE: str = BROWSER_MODE_PLAYWRIGHT_CHROMIUM

# Default profile dirs by mode. Distinct paths so the two browsers
# don't share login state or extension installs.
DEFAULT_PROFILE_DIR_BY_MODE: dict[str, Path] = {
    BROWSER_MODE_SYSTEM_CHROME: Path.home() / "chrome-oy-profile",
    BROWSER_MODE_PLAYWRIGHT_CHROMIUM: Path.home() / "chrome-oy-profile-pw",
}

# Chrome major versions known to break Playwright's CDP attach for the
# OY scrape path (browser-level `setDownloadBehavior`). Endpoints whose
# Browser string falls in this set are refused under
# `playwright_chromium` mode. Add majors here as compatibility
# regressions are observed.
SYSTEM_CHROME_BAD_MAJORS: frozenset[int] = frozenset({147})

_BROWSER_VERSION_RE = re.compile(
    r"Chrome/(?P<major>\d+)\.(?P<minor>\d+)\.(?P<build>\d+)\.(?P<patch>\d+)",
)
_CHROME_FOR_TESTING_RE = re.compile(
    r"chrome[-_ ]for[-_ ]testing|playwright|HeadlessChrome",
    re.IGNORECASE,
)


class ChromeDebugError(RuntimeError):
    """Raised when a preflight step refuses to proceed safely. Tests
    assert on the message prefix; do not change without updating
    callers."""


# ---------------------------------------------------------------------------
# Reachability probes
# ---------------------------------------------------------------------------


def fetch_json_version(port: int = DEFAULT_CDP_PORT) -> dict | None:
    """Read `/json/version` and return the parsed dict, or None on
    any failure. Pure stdlib; same probe surface as
    `is_chrome_debug_running` but returns the full payload so callers
    can inspect `Browser`, `userDataDir`, etc."""
    url = f"http://127.0.0.1:{int(port)}/json/version"
    try:
        with urllib.request.urlopen(url, timeout=2.0) as resp:  # nosec B310
            payload = json.loads(resp.read().decode("utf-8"))
    except (
        urllib.error.URLError,
        OSError,
        json.JSONDecodeError,
        TimeoutError,
    ):
        return None
    if not isinstance(payload, dict):
        return None
    return payload


def get_browser_version_string(port: int = DEFAULT_CDP_PORT) -> str | None:
    """Return the `Browser` field from `/json/version`, or None when
    the endpoint is unreachable / does not look like Chrome."""
    payload = fetch_json_version(port)
    if not payload:
        return None
    browser = payload.get("Browser")
    if not isinstance(browser, str) or not browser.strip():
        return None
    return browser


def classify_browser(browser_string: str | None) -> dict:
    """Classify a `/json/version` Browser string.

    Returns a dict:
      - raw                : the input string (or "")
      - major              : int Chrome major version, or None
      - version            : "MAJOR.MINOR.BUILD.PATCH" or None
      - is_chrome_for_testing : True when the Browser string includes
                                a "Chrome for Testing" / Playwright /
                                HeadlessChrome marker
      - is_system_chrome   : True when major version is set AND the
                                CfT marker is absent
    Defensive: empty / non-Chrome strings return all None / False.
    """
    raw = browser_string or ""
    out: dict = {
        "raw": raw,
        "major": None,
        "version": None,
        "is_chrome_for_testing": False,
        "is_system_chrome": False,
    }
    if not raw:
        return out
    m = _BROWSER_VERSION_RE.search(raw)
    if m:
        major = int(m.group("major"))
        out["major"] = major
        out["version"] = (
            f"{m.group('major')}.{m.group('minor')}."
            f"{m.group('build')}.{m.group('patch')}"
        )
    if _CHROME_FOR_TESTING_RE.search(raw):
        out["is_chrome_for_testing"] = True
    elif out["major"] is not None:
        out["is_system_chrome"] = True
    return out


def is_endpoint_compatible_with_mode(
    browser_string: str | None,
    mode: str,
) -> tuple[bool, str | None]:
    """Decide whether a CDP endpoint is acceptable for the requested
    browser mode.

    Returns `(ok, reason)`. `reason` is a short operator-readable
    string when `ok=False`; None otherwise.

    Rules:
      - `system_chrome` mode: any Chrome-shaped endpoint passes
        (legacy compatibility — caller chose to use system Chrome).
      - `playwright_chromium` mode:
          * Chrome for Testing endpoints pass.
          * System Chrome endpoints with major version in
            SYSTEM_CHROME_BAD_MAJORS are REJECTED (CDP attach is
            known to break — see docs/oy_cdp_attach_compatibility.md).
          * Other system Chrome endpoints emit a soft warning but
            still pass (operator chose to override).
      - Endpoint not reachable / non-Chrome → False, reason.
      - Unknown mode → False, reason.
    """
    if mode not in BROWSER_MODES:
        return False, f"unknown browser mode: {mode!r}"
    cls = classify_browser(browser_string)
    if not cls["raw"] or cls["major"] is None:
        return False, "endpoint did not return a Chrome-shaped Browser string"
    if mode == BROWSER_MODE_SYSTEM_CHROME:
        return True, None
    # mode == BROWSER_MODE_PLAYWRIGHT_CHROMIUM
    if cls["is_chrome_for_testing"]:
        return True, None
    if cls["major"] in SYSTEM_CHROME_BAD_MAJORS:
        return False, (
            f"system Chrome {cls['version']} on this CDP endpoint "
            f"is a known-bad attach path under playwright_chromium "
            f"mode (Browser.setDownloadBehavior wall — see "
            f"docs/oy_cdp_attach_compatibility.md). Quit Chrome "
            f"and let the preflight launch the bundled Chromium, "
            f"or pass --chrome-debug-browser system_chrome to opt "
            f"into the legacy path."
        )
    # System Chrome on a non-blocked major — soft pass with a hint.
    return True, None


def is_chrome_debug_running(port: int = DEFAULT_CDP_PORT) -> bool:
    """Probe `http://127.0.0.1:{port}/json/version`.

    Returns True only when the response is a Chrome-shaped JSON
    object (the `Browser` field is present and contains the literal
    "chrome", case-insensitive). A bare HTTP listener on the port
    will not satisfy this — important so we don't false-positive on
    unrelated services.
    """
    url = f"http://127.0.0.1:{int(port)}/json/version"
    try:
        with urllib.request.urlopen(url, timeout=2.0) as resp:  # nosec B310
            payload = json.loads(resp.read().decode("utf-8"))
    except (
        urllib.error.URLError,
        OSError,
        json.JSONDecodeError,
        TimeoutError,
    ):
        return False
    if not isinstance(payload, dict):
        return False
    browser = payload.get("Browser")
    if not isinstance(browser, str):
        return False
    return "chrome" in browser.lower()


def wait_for_chrome_debug(
    port: int = DEFAULT_CDP_PORT,
    timeout_sec: int = DEFAULT_TIMEOUT_SEC,
) -> bool:
    """Poll `is_chrome_debug_running(port)` every 0.5s until it
    returns True or `timeout_sec` elapses. Returns the final state."""
    deadline = time.monotonic() + max(0.0, float(timeout_sec))
    while time.monotonic() < deadline:
        if is_chrome_debug_running(port):
            return True
        time.sleep(0.5)
    # Final check — gives back the truthy value if Chrome came up
    # right at the boundary.
    return is_chrome_debug_running(port)


# ---------------------------------------------------------------------------
# Attached-profile discovery
# ---------------------------------------------------------------------------
#
# When CDP is already running on the configured port, the operator
# wants to know which profile dir Chrome is actually using — not
# just "something on the port answers". The preflight uses this to
# warn when:
#   - the attached profile differs from the requested one
#     (`already_running_mismatched_profile`), OR
#   - we couldn't determine which profile is attached
#     (`already_running_unverified`).
#
# Strategy is two-tier:
#   1. CDP `/json/version` exposes `userDataDir` on Chromium ≥ 119.
#   2. Fall back to `lsof -nP -iTCP:PORT -sTCP:LISTEN -Fp` →
#      `ps -ww -o args= -p <pid>` and parse `--user-data-dir=…`
#      from the command line.
#
# Both tiers are best-effort; a None return is "we couldn't tell"
# (NOT "the profile is empty"). Path normalization uses
# `Path.resolve()` on both attached and requested paths so
# /var/folders ↔ /private/var/folders symlink dance on macOS
# doesn't cause spurious mismatches.

_USER_DATA_DIR_RE = re.compile(r"--user-data-dir=(\S+)")


def _attached_profile_via_cdp(port: int) -> Path | None:
    """Try to read `userDataDir` from `/json/version`. Returns None
    when the field is absent (older Chromium) or the probe fails."""
    url = f"http://127.0.0.1:{int(port)}/json/version"
    try:
        with urllib.request.urlopen(url, timeout=2.0) as resp:  # nosec B310
            payload = json.loads(resp.read().decode("utf-8"))
    except (
        urllib.error.URLError,
        OSError,
        json.JSONDecodeError,
        TimeoutError,
    ):
        return None
    if not isinstance(payload, dict):
        return None
    udd = payload.get("userDataDir")
    if not isinstance(udd, str) or not udd.strip():
        return None
    try:
        return Path(udd).expanduser().resolve()
    except (OSError, ValueError):
        return None


def _attached_profile_via_lsof(port: int) -> Path | None:
    """Fallback: find the listening PID via lsof, then read its
    command line via ps and grep --user-data-dir= out. Returns None
    on any failure (lsof missing, no listener, no flag in cmdline,
    ps unavailable, etc.). Best-effort — never raises."""
    try:
        r = subprocess.run(
            ["lsof", "-nP", f"-iTCP:{int(port)}", "-sTCP:LISTEN", "-Fp"],
            capture_output=True, text=True, timeout=3.0, check=False,
        )
    except (FileNotFoundError, subprocess.TimeoutExpired, OSError):
        return None
    if r.returncode != 0:
        return None
    pids: list[str] = []
    for line in r.stdout.splitlines():
        # `-Fp` formats lines as `p<PID>`.
        if line.startswith("p") and line[1:].isdigit():
            pids.append(line[1:])
    for pid in pids:
        try:
            r2 = subprocess.run(
                ["ps", "-ww", "-o", "args=", "-p", pid],
                capture_output=True, text=True, timeout=3.0, check=False,
            )
        except (FileNotFoundError, subprocess.TimeoutExpired, OSError):
            continue
        if r2.returncode != 0:
            continue
        m = _USER_DATA_DIR_RE.search(r2.stdout)
        if not m:
            continue
        try:
            return Path(m.group(1)).expanduser().resolve()
        except (OSError, ValueError):
            continue
    return None


def get_attached_profile_dir(port: int = DEFAULT_CDP_PORT) -> Path | None:
    """Best-effort lookup of the user-data-dir backing the Chrome
    process listening on `port`. CDP `/json/version` first, then
    `lsof + ps` fallback. Returns None when not discoverable.
    """
    p = _attached_profile_via_cdp(port)
    if p is not None:
        return p
    return _attached_profile_via_lsof(port)


def check_profile_path_consistency(requested: Path) -> dict:
    """Detect ambiguous profile paths.

    Common confusion: `~/chrome-oy-profile` (absolute, $HOME) vs
    `./chrome-oy-profile` (relative to cwd) — they're separate
    Chrome profiles. If both exist, the orchestrator may be
    pointing at the unintended one depending on how `--chrome-
    profile-dir` was passed.

    Returns a dict suitable for logging:
      - `requested`           : resolved path of the caller's input
      - `home_variant`        : ~/chrome-oy-profile (resolved)
      - `home_exists`         : bool
      - `cwd_variant`         : ./chrome-oy-profile (resolved)
      - `cwd_exists`          : bool
      - `both_exist`          : both home + cwd variants exist AND
                                point to different inodes
      - `warnings`            : list[str] suitable for surfacing
                                straight to the operator
    """
    requested = Path(requested).expanduser().resolve()
    home_variant = (Path.home() / "chrome-oy-profile").resolve()
    cwd_variant = (Path.cwd() / "chrome-oy-profile").resolve()
    home_exists = home_variant.is_dir()
    cwd_exists = cwd_variant.is_dir()
    both_distinct = (
        home_exists
        and cwd_exists
        and home_variant != cwd_variant
    )
    warnings: list[str] = []
    if both_distinct:
        warnings.append(
            f"both ~/chrome-oy-profile ({home_variant}) and "
            f"./chrome-oy-profile ({cwd_variant}) exist as separate "
            f"directories. The orchestrator is using {requested}. "
            f"Confirm this is the right one."
        )
    if home_exists and requested == cwd_variant and home_variant != cwd_variant:
        warnings.append(
            f"using ./chrome-oy-profile ({cwd_variant}) but "
            f"~/chrome-oy-profile ({home_variant}) also exists — "
            f"did you mean the home variant?"
        )
    return {
        "requested": str(requested),
        "home_variant": str(home_variant),
        "home_exists": home_exists,
        "cwd_variant": str(cwd_variant),
        "cwd_exists": cwd_exists,
        "both_exist": both_distinct,
        "warnings": warnings,
    }


def _profiles_match(attached: Path, requested: Path) -> bool:
    """Path-normalized equality. Both arguments are resolved, so a
    macOS `/var/folders/…` ↔ `/private/var/folders/…` symlink does
    not cause a spurious mismatch."""
    try:
        return attached.resolve() == requested.resolve()
    except (OSError, ValueError):
        return False


# ---------------------------------------------------------------------------
# Binary discovery
# ---------------------------------------------------------------------------


_MACOS_CHROME_PATH: str = (
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
)
_LINUX_BINARIES: tuple[str, ...] = (
    "google-chrome",
    "google-chrome-stable",
    "chromium",
    "chromium-browser",
    "chrome",
)


def find_chrome_binary() -> str:
    """Resolve a Chrome / Chromium executable path. Raises
    `FileNotFoundError` when none is found.

    macOS: prefers the app-bundle Chrome, which is what the
    operator's setup uses. Linux/WSL: falls through to PATH lookups
    in priority order.
    """
    if sys.platform == "darwin" and Path(_MACOS_CHROME_PATH).is_file():
        return _MACOS_CHROME_PATH
    for cand in _LINUX_BINARIES:
        which = shutil.which(cand)
        if which:
            return which
    raise FileNotFoundError(
        "Could not locate a Chrome / Chromium executable. Install "
        "Google Chrome, OR pass the path via --chrome-binary, OR add "
        "the binary to PATH."
    )


# ---------------------------------------------------------------------------
# Launch
# ---------------------------------------------------------------------------


def launch_chrome_debug(
    profile_dir: Path,
    port: int = DEFAULT_CDP_PORT,
    chrome_binary: str | None = None,
    url: str | None = None,
    headless: bool = False,
) -> subprocess.Popen:
    """Spawn a Chrome debug process in its own session.

    Always passes `--remote-debugging-port`, `--user-data-dir`,
    `--no-first-run`, `--no-default-browser-check`. The child is
    started with `start_new_session=True` so it outlives the
    orchestrator — the next pipeline run can reuse the same Chrome
    instance.

    Caller should verify readiness with `wait_for_chrome_debug` if
    the call is part of a preflight chain.
    """
    binary = chrome_binary or find_chrome_binary()
    profile_dir = Path(profile_dir).expanduser().resolve()
    profile_dir.mkdir(parents=True, exist_ok=True)
    cmd: list[str] = [
        binary,
        f"--remote-debugging-port={int(port)}",
        f"--user-data-dir={profile_dir}",
        "--no-first-run",
        "--no-default-browser-check",
    ]
    if headless:
        # Chromium ≥112 stable headless mode. Older versions accept
        # `--headless` (no `=new`); we use the stable form.
        cmd.append("--headless=new")
    if url:
        cmd.append(url)
    return subprocess.Popen(
        cmd,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        start_new_session=True,
    )


# ---------------------------------------------------------------------------
# Playwright-bundled-Chromium launcher
# ---------------------------------------------------------------------------
#
# Mirrors the system-Chrome `launch_chrome_debug` path but uses
# Playwright's bundled Chromium (Chrome for Testing) — the working
# CDP attach path for OY scraping. Standalone CLI wrapper at
# `scripts/open_oy_chromium_debug.py`; this function exists so the
# orchestrator preflight can call it without subprocessing the wrapper.


def find_playwright_chromium_binary() -> str | None:
    """Resolve the absolute path of Playwright's bundled Chromium
    binary, or None when Playwright isn't installed / hasn't
    downloaded a browser yet.

    Uses Playwright's own `executable_path` accessor — robust across
    versions and OS layouts. Never raises; ImportError or any
    runtime error is caught and converted to None so callers can
    decide whether the absence is fatal.
    """
    try:
        from playwright.sync_api import sync_playwright  # type: ignore
    except ImportError:
        return None
    try:
        with sync_playwright() as p:
            path = p.chromium.executable_path
    except Exception:  # noqa: BLE001 — Playwright raises various typed errors
        return None
    if not path:
        return None
    p = Path(path)
    return str(p) if p.exists() else None


def launch_playwright_chromium_debug(
    profile_dir: Path,
    port: int = DEFAULT_CDP_PORT,
    binary: str | None = None,
    url: str | None = None,
) -> subprocess.Popen:
    """Spawn Playwright's bundled Chromium with CDP enabled.

    Same flag shape as `launch_chrome_debug`, but the binary is the
    Playwright-bundled Chromium (Chrome for Testing) instead of
    system Chrome. The child runs with `start_new_session=True` so
    it survives the orchestrator.

    Raises `FileNotFoundError` when Playwright's bundled Chromium
    cannot be located (and `binary` was not supplied).
    """
    bin_path = binary or find_playwright_chromium_binary()
    if not bin_path:
        raise FileNotFoundError(
            "Playwright's bundled Chromium not found. Install it: "
            "`python3 -m pip install 'playwright<1.58' && python3 -m "
            "playwright install chromium` — or pass --chrome-binary."
        )
    profile_dir = Path(profile_dir).expanduser().resolve()
    profile_dir.mkdir(parents=True, exist_ok=True)
    cmd: list[str] = [
        bin_path,
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


# ---------------------------------------------------------------------------
# Profile reset
# ---------------------------------------------------------------------------


def reset_profile(profile_dir: Path) -> Path:
    """Archive `profile_dir` to `<dir>_broken_<UTC ts>` and create a
    fresh empty `profile_dir` at the same path.

    Never deletes anything. If the CDP port appears to be in use
    (Chrome holds open file handles inside the profile), refuses
    with `ChromeDebugError` — operator must quit Chrome first.

    Returns the archive path. Raises `FileNotFoundError` when
    `profile_dir` does not exist; raises `ChromeDebugError` when
    the archive path already exists or Chrome is running.
    """
    src = Path(profile_dir).expanduser().resolve()
    if not src.is_dir():
        raise FileNotFoundError(
            f"profile_dir does not exist: {src}"
        )
    if is_chrome_debug_running():
        raise ChromeDebugError(
            "Chrome debug is currently running on port 9222 — quit "
            "Chrome (Cmd+Q on macOS, fully — not just close window) "
            "before resetting the profile."
        )
    ts = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    archive = src.with_name(f"{src.name}_broken_{ts}")
    if archive.exists():
        raise ChromeDebugError(
            f"archive path already exists: {archive}. Wait one second "
            f"and re-run, or move the existing archive aside."
        )
    src.rename(archive)
    src.mkdir(parents=True, exist_ok=False)
    return archive


# ---------------------------------------------------------------------------
# High-level preflight
# ---------------------------------------------------------------------------


def ensure_chrome_debug_running(
    *,
    profile_dir: Path,
    port: int = DEFAULT_CDP_PORT,
    reset: bool = False,
    timeout_sec: int = DEFAULT_TIMEOUT_SEC,
    chrome_binary: str | None = None,
    url: str | None = None,
    headless: bool = False,
) -> dict:
    """One-call preflight. Returns a status dict:

    - state: one of
        - `already_running` — CDP reachable, attached profile matches
          the requested `profile_dir`
        - `already_running_mismatched_profile` — CDP reachable,
          attached profile is a *different* dir than requested
          (`attached_profile_dir` populated)
        - `already_running_unverified` — CDP reachable, attached
          profile could not be determined (older Chromium without
          `userDataDir` in `/json/version` AND no `lsof`/`ps`
          available). The operator must judge.
        - `launched` — we spawned Chrome and it became ready
        - `failed` — we spawned Chrome but it didn't become ready
    - port, profile_dir (always; `profile_dir` is the REQUESTED dir)
    - attached_profile_dir (when state starts with `already_running`)
    - pid (when state in launched / failed)
    - archive_path (when reset=True and an archive was created)
    - error (when state=failed)

    Reset path: if `reset=True` AND the profile dir exists, archive
    it BEFORE attempting to launch. Refuses to reset while Chrome
    is running (that's a `ChromeDebugError`).

    Launch path: only fires when CDP is not already reachable. The
    spawned child uses `start_new_session=True` so it persists.
    """
    profile_dir = Path(profile_dir).expanduser().resolve()
    archive_str: str | None = None
    if reset and profile_dir.is_dir():
        archive = reset_profile(profile_dir)
        archive_str = str(archive)

    if is_chrome_debug_running(port):
        attached = get_attached_profile_dir(port)
        if attached is None:
            return {
                "state": "already_running_unverified",
                "port": int(port),
                "profile_dir": str(profile_dir),
                "attached_profile_dir": None,
                "archive_path": archive_str,
            }
        if _profiles_match(attached, profile_dir):
            return {
                "state": "already_running",
                "port": int(port),
                "profile_dir": str(profile_dir),
                "attached_profile_dir": str(attached),
                "archive_path": archive_str,
            }
        return {
            "state": "already_running_mismatched_profile",
            "port": int(port),
            "profile_dir": str(profile_dir),
            "attached_profile_dir": str(attached),
            "archive_path": archive_str,
        }

    proc = launch_chrome_debug(
        profile_dir,
        port=port,
        chrome_binary=chrome_binary,
        url=url,
        headless=headless,
    )
    ok = wait_for_chrome_debug(port, timeout_sec=timeout_sec)
    if not ok:
        return {
            "state": "failed",
            "port": int(port),
            "profile_dir": str(profile_dir),
            "pid": proc.pid,
            "archive_path": archive_str,
            "error": (
                f"Chrome did not become ready on CDP port {port} "
                f"within {timeout_sec}s"
            ),
        }
    return {
        "state": "launched",
        "port": int(port),
        "profile_dir": str(profile_dir),
        "pid": proc.pid,
        "archive_path": archive_str,
    }


def ensure_browser_for_mode(
    *,
    mode: str,
    profile_dir: Path,
    port: int = DEFAULT_CDP_PORT,
    timeout_sec: int = DEFAULT_TIMEOUT_SEC,
    url: str | None = None,
    binary: str | None = None,
    reset: bool = False,
    headless: bool = False,
) -> dict:
    """Mode-aware preflight. Wraps `ensure_chrome_debug_running` with
    a browser-mode compatibility check.

    Resolves the following operator scenarios:
      1. CDP already running, mode-compatible → reuse (state="already_running").
      2. CDP already running, mode-incompatible (e.g. system Chrome 147
         under playwright_chromium) → state="incompatible_endpoint",
         the caller decides (fail-fast / quit Chrome / relaunch).
      3. CDP not running → launch the right binary for the mode.

    Returns a status dict that always carries:
      - `mode`              : the requested mode
      - `state`             : one of
          - already_running
          - already_running_unverified
          - already_running_mismatched_profile
          - incompatible_endpoint
          - launched
          - failed
      - `port`              : int
      - `profile_dir`       : str (resolved)
      - `attached_profile_dir` : when CDP is up; else None
      - `browser_string`    : `/json/version` Browser field (when CDP
                              is up); else None
      - `browser_class`     : classify_browser() output (when CDP up)
      - `incompatible_reason` : populated only on state=incompatible_endpoint
      - `pid`               : when state in {launched, failed}
      - `archive_path`      : when reset=True archived a prior profile
      - `error`             : when state=failed
    """
    if mode not in BROWSER_MODES:
        raise ChromeDebugError(
            f"unknown browser mode: {mode!r}. Expected one of {BROWSER_MODES}."
        )
    profile_dir = Path(profile_dir).expanduser().resolve()
    archive_str: str | None = None
    if reset and profile_dir.is_dir():
        archive = reset_profile(profile_dir)
        archive_str = str(archive)

    # Reuse path: CDP already up. Inspect Browser, decide compatibility.
    if is_chrome_debug_running(port):
        browser_string = get_browser_version_string(port)
        cls = classify_browser(browser_string)
        attached = get_attached_profile_dir(port)
        ok, reason = is_endpoint_compatible_with_mode(browser_string, mode)
        if not ok:
            return {
                "mode": mode,
                "state": "incompatible_endpoint",
                "port": int(port),
                "profile_dir": str(profile_dir),
                "attached_profile_dir": str(attached) if attached else None,
                "browser_string": browser_string,
                "browser_class": cls,
                "incompatible_reason": reason,
                "archive_path": archive_str,
            }
        # Profile-match logic mirrors ensure_chrome_debug_running.
        if attached is None:
            state = "already_running_unverified"
        elif _profiles_match(attached, profile_dir):
            state = "already_running"
        else:
            state = "already_running_mismatched_profile"
        return {
            "mode": mode,
            "state": state,
            "port": int(port),
            "profile_dir": str(profile_dir),
            "attached_profile_dir": str(attached) if attached else None,
            "browser_string": browser_string,
            "browser_class": cls,
            "incompatible_reason": None,
            "archive_path": archive_str,
        }

    # Launch path. Pick the binary appropriate for the mode.
    if mode == BROWSER_MODE_PLAYWRIGHT_CHROMIUM:
        try:
            proc = launch_playwright_chromium_debug(
                profile_dir=profile_dir, port=port,
                binary=binary, url=url,
            )
        except FileNotFoundError as e:
            return {
                "mode": mode,
                "state": "failed",
                "port": int(port),
                "profile_dir": str(profile_dir),
                "attached_profile_dir": None,
                "browser_string": None,
                "browser_class": None,
                "incompatible_reason": None,
                "pid": None,
                "archive_path": archive_str,
                "error": str(e),
            }
    else:
        proc = launch_chrome_debug(
            profile_dir, port=port,
            chrome_binary=binary, url=url, headless=headless,
        )

    ok = wait_for_chrome_debug(port, timeout_sec=timeout_sec)
    if not ok:
        return {
            "mode": mode,
            "state": "failed",
            "port": int(port),
            "profile_dir": str(profile_dir),
            "attached_profile_dir": None,
            "browser_string": None,
            "browser_class": None,
            "incompatible_reason": None,
            "pid": proc.pid,
            "archive_path": archive_str,
            "error": (
                f"browser did not become ready on CDP port {port} "
                f"within {timeout_sec}s"
            ),
        }
    # Re-probe so the caller's log reflects the actually-attached browser.
    browser_string = get_browser_version_string(port)
    cls = classify_browser(browser_string)
    return {
        "mode": mode,
        "state": "launched",
        "port": int(port),
        "profile_dir": str(profile_dir),
        "attached_profile_dir": str(profile_dir),
        "browser_string": browser_string,
        "browser_class": cls,
        "incompatible_reason": None,
        "pid": proc.pid,
        "archive_path": archive_str,
    }


__all__ = [
    "BROWSER_MODE_PLAYWRIGHT_CHROMIUM",
    "BROWSER_MODE_SYSTEM_CHROME",
    "BROWSER_MODES",
    "DEFAULT_BROWSER_MODE",
    "DEFAULT_CDP_PORT",
    "DEFAULT_PROFILE_DIR_BY_MODE",
    "DEFAULT_TIMEOUT_SEC",
    "PROFILE_CANDIDATES",
    "SYSTEM_CHROME_BAD_MAJORS",
    "ChromeDebugError",
    "check_profile_path_consistency",
    "classify_browser",
    "ensure_browser_for_mode",
    "ensure_chrome_debug_running",
    "fetch_json_version",
    "find_chrome_binary",
    "find_playwright_chromium_binary",
    "get_attached_profile_dir",
    "get_browser_version_string",
    "is_chrome_debug_running",
    "is_endpoint_compatible_with_mode",
    "launch_chrome_debug",
    "launch_playwright_chromium_debug",
    "reset_profile",
    "wait_for_chrome_debug",
]
