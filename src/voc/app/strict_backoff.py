"""Adaptive backoff for strict-mode multi-sort retries.

Strict mode (`run_phase2e_pipeline.py:run_multi_sort_scrape` with
`wait_until_sort_loaded=True`) loops the same sort until it loads.
The earlier 3–6 second jitter was too aggressive: against
`anonymous_auth_wall` / `anti_bot` it hammered OY without giving
either side time to recover, which empirically WORSENS anti-bot.

This module supplies a pure helper that returns the
`(lo, hi)` seconds band for the next retry. Three things shape
the band:

  1. **Backoff profile** — `conservative` (default), `normal`, `fast`.
     `fast` mirrors the legacy 3–6s loop and is opt-in only.

  2. **Attempt band** — `1-2`, `3-5`, `6-10`, `11+`. The longer the
     sort has been stuck, the longer we wait.

  3. **Failure-reason floor** — known anti-bot / auth-wall classes
     get a minimum wait regardless of profile (`anti_bot` ≥ 900s,
     `anonymous_auth_wall` ≥ 600s, `human_check` ≥ 900s,
     `false_empty` ≥ 120s).

The orchestrator picks an actual seconds value via
`random.uniform(lo, hi)` and applies a separate ±20% jitter on top.
Returning the band rather than a final number lets existing tests
that monkeypatch `random.uniform` keep working unchanged.

Pure: no I/O, no side effects, no global state.
"""
from __future__ import annotations


# Default profile — applied when the operator doesn't pick one.
# `fast` is the legacy 3–6s loop; never the default.
DEFAULT_BACKOFF_PROFILE: str = "conservative"

# `±20%` jitter the orchestrator multiplies the random.uniform(lo,hi)
# result by. Exposed as a module constant so tests can pin it.
JITTER_PCT: float = 0.20

BACKOFF_PROFILES: dict[str, dict[str, tuple[float, float]]] = {
    # Conservative — operator-attended, low blast radius. Default.
    "conservative": {
        "1-2":  (45.0,   90.0),
        "3-5":  (180.0,  300.0),
        "6-10": (600.0,  900.0),
        "11+":  (1200.0, 1800.0),
    },
    # Normal — automated runs that are willing to retry sooner but
    # still avoid hammering. Tuned to OY's observed cooldown windows.
    "normal": {
        "1-2":  (15.0,  30.0),
        "3-5":  (60.0,  120.0),
        "6-10": (180.0, 300.0),
        "11+":  (600.0, 900.0),
    },
    # Fast — opt-in, mirrors the legacy aggressive jitter. Use only
    # for tests / probe runs against ephemeral fixtures.
    "fast": {
        "1-2":  (3.0,  6.0),
        "3-5":  (5.0,  10.0),
        "6-10": (10.0, 20.0),
        "11+":  (30.0, 60.0),
    },
}

KNOWN_BACKOFF_PROFILES: tuple[str, ...] = tuple(BACKOFF_PROFILES.keys())

# Per-failure-reason minimum wait (seconds). Substring match against
# the failure reason string passed in. Multiple matches → take the
# longest floor.
REASON_FLOOR_S: dict[str, float] = {
    "anonymous_auth_wall": 600.0,
    "anti_bot":            900.0,
    "human_check":         900.0,
    "false_empty":         120.0,
}

# Failure classes that justify a full client-side session reset
# (close the connector's Playwright context, create a fresh one with
# no cookies / localStorage). Backoff alone is insufficient for these
# because OY's anti-bot fingerprint is sticky per session — the
# auth wall and anti_bot soft-block both ride on session-level state
# that survives backoff.
#
# Substring match (case-insensitive) — the reason string the
# orchestrator builds is a free-form composite (e.g.
# "scraper_subprocess_failed: anti_bot detected mid-stream"), so
# matching by substring is more robust than equality.
#
# false_empty is intentionally NOT in this list: it's a transient
# render race the existing in-session page-recreate path handles
# without losing the user's auth.
RESET_WORTHY_REASON_KEYS: tuple[str, ...] = (
    "anti_bot",
    "anonymous_auth_wall",
    "human_check_timeout",
)


def is_reset_worthy_reason(failure_reason: str | None) -> bool:
    """True when the failure reason indicates a sticky session-level
    block that warrants closing the Playwright context and starting
    a fresh one. False for transient or unrelated failures."""
    if not failure_reason:
        return False
    s = str(failure_reason).lower()
    for key in RESET_WORTHY_REASON_KEYS:
        if key in s:
            return True
    return False


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def band_for_attempt(attempt: int) -> str:
    """Map a 1-indexed attempt number to its backoff band key."""
    if attempt <= 2:
        return "1-2"
    if attempt <= 5:
        return "3-5"
    if attempt <= 10:
        return "6-10"
    return "11+"


def floor_for_reason(failure_reason: str | None) -> float:
    """Minimum seconds wait dictated by the failure reason.

    Substring match (case-insensitive). Multiple matching keys take
    the longest floor — the most recoverable-with-cooldown class
    wins.
    """
    if not failure_reason:
        return 0.0
    s = str(failure_reason).lower()
    floor = 0.0
    for key, val in REASON_FLOOR_S.items():
        if key in s:
            if val > floor:
                floor = val
    return floor


def strict_backoff_band(
    *,
    attempt: int,
    profile: str = DEFAULT_BACKOFF_PROFILE,
    failure_reason: str | None = None,
) -> tuple[float, float]:
    """Return the `(lo, hi)` seconds band the orchestrator samples
    `random.uniform` from.

    Unknown `profile` falls back to the default. The reason floor
    is applied AFTER the profile / band lookup so a normal-profile
    user attacked by anti-bot still waits ≥ 900s.
    """
    if profile not in BACKOFF_PROFILES:
        profile = DEFAULT_BACKOFF_PROFILE
    band = band_for_attempt(attempt)
    lo, hi = BACKOFF_PROFILES[profile][band]
    floor = floor_for_reason(failure_reason)
    if floor > 0.0:
        lo = max(lo, floor)
        hi = max(hi, floor)
    # Defensive: if a tester sets a profile entry where lo > hi,
    # swap so random.uniform doesn't error.
    if lo > hi:
        lo, hi = hi, lo
    return (float(lo), float(hi))


def format_eta(seconds: float) -> str:
    """Format a wait duration for the operator-visible banner.

    Examples:
        45     → "45s"
        125    → "2m 5s"
        1050   → "17m 30s"
        3725   → "1h 2m 5s"
    """
    s = max(0, int(round(seconds)))
    h, rem = divmod(s, 3600)
    m, sec = divmod(rem, 60)
    if h > 0:
        return f"{h}h {m}m {sec}s"
    if m > 0:
        return f"{m}m {sec}s"
    return f"{sec}s"
