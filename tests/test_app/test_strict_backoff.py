"""Tests for src.voc.app.strict_backoff (pure helpers)."""
from __future__ import annotations

import pytest

from src.voc.app import strict_backoff


# ---------------------------------------------------------------------------
# band_for_attempt
# ---------------------------------------------------------------------------


class TestBandForAttempt:
    @pytest.mark.parametrize("n", [1, 2])
    def test_attempts_1_2_band(self, n):
        assert strict_backoff.band_for_attempt(n) == "1-2"

    @pytest.mark.parametrize("n", [3, 4, 5])
    def test_attempts_3_5_band(self, n):
        assert strict_backoff.band_for_attempt(n) == "3-5"

    @pytest.mark.parametrize("n", [6, 7, 8, 9, 10])
    def test_attempts_6_10_band(self, n):
        assert strict_backoff.band_for_attempt(n) == "6-10"

    @pytest.mark.parametrize("n", [11, 25, 100, 9999])
    def test_attempts_11_plus_band(self, n):
        assert strict_backoff.band_for_attempt(n) == "11+"

    def test_zero_or_negative_falls_to_first_band(self):
        # Defensive: attempts should always be ≥ 1 in practice.
        assert strict_backoff.band_for_attempt(0) == "1-2"
        assert strict_backoff.band_for_attempt(-3) == "1-2"


# ---------------------------------------------------------------------------
# floor_for_reason
# ---------------------------------------------------------------------------


class TestFloorForReason:
    def test_none_returns_zero(self):
        assert strict_backoff.floor_for_reason(None) == 0.0

    def test_empty_returns_zero(self):
        assert strict_backoff.floor_for_reason("") == 0.0

    def test_unrelated_reason_returns_zero(self):
        assert strict_backoff.floor_for_reason("unknown_failure") == 0.0

    def test_anti_bot_floor_900s(self):
        assert strict_backoff.floor_for_reason("anti_bot") == 900.0

    def test_anonymous_auth_wall_floor_600s(self):
        assert strict_backoff.floor_for_reason("anonymous_auth_wall") == 600.0

    def test_human_check_floor_900s(self):
        assert strict_backoff.floor_for_reason("human_check_skipped") == 900.0

    def test_false_empty_floor_120s(self):
        assert strict_backoff.floor_for_reason("blocked_or_empty_state false_empty") == 120.0

    def test_case_insensitive(self):
        assert strict_backoff.floor_for_reason("ANTI_BOT") == 900.0

    def test_substring_match(self):
        # The key just needs to appear as a substring; surrounding
        # text is allowed.
        assert strict_backoff.floor_for_reason(
            "scraper_subprocess_failed: anti_bot detected mid-stream",
        ) == 900.0

    def test_multiple_reasons_take_max(self):
        # When multiple keys match, the longest floor wins —
        # cooldown enough to recover the worst one.
        result = strict_backoff.floor_for_reason(
            "anonymous_auth_wall and false_empty observed",
        )
        assert result == 600.0  # max(600, 120)


# ---------------------------------------------------------------------------
# strict_backoff_band
# ---------------------------------------------------------------------------


class TestStrictBackoffBand:
    def test_default_profile_is_conservative(self):
        # Caller can omit profile; gets conservative band.
        explicit = strict_backoff.strict_backoff_band(
            attempt=1, profile="conservative",
        )
        defaulted = strict_backoff.strict_backoff_band(attempt=1)
        assert explicit == defaulted

    def test_conservative_attempts_1_2_returns_45_90(self):
        lo, hi = strict_backoff.strict_backoff_band(
            attempt=1, profile="conservative",
        )
        assert lo == 45.0
        assert hi == 90.0

    def test_conservative_attempts_3_5_returns_180_300(self):
        lo, hi = strict_backoff.strict_backoff_band(
            attempt=4, profile="conservative",
        )
        assert lo == 180.0
        assert hi == 300.0

    def test_conservative_attempts_6_10_returns_600_900(self):
        lo, hi = strict_backoff.strict_backoff_band(
            attempt=8, profile="conservative",
        )
        assert lo == 600.0
        assert hi == 900.0

    def test_conservative_attempts_11_plus_returns_1200_1800(self):
        lo, hi = strict_backoff.strict_backoff_band(
            attempt=15, profile="conservative",
        )
        assert lo == 1200.0
        assert hi == 1800.0

    def test_normal_profile_shorter_than_conservative(self):
        c_lo, _ = strict_backoff.strict_backoff_band(
            attempt=1, profile="conservative",
        )
        n_lo, _ = strict_backoff.strict_backoff_band(
            attempt=1, profile="normal",
        )
        assert n_lo < c_lo

    def test_fast_profile_matches_legacy_3_6(self):
        # fast is opt-in; mirrors the old aggressive jitter.
        lo, hi = strict_backoff.strict_backoff_band(
            attempt=1, profile="fast",
        )
        assert lo == 3.0
        assert hi == 6.0

    def test_unknown_profile_falls_back_to_default(self):
        unknown = strict_backoff.strict_backoff_band(
            attempt=1, profile="nonexistent",
        )
        default = strict_backoff.strict_backoff_band(
            attempt=1, profile="conservative",
        )
        assert unknown == default

    def test_anti_bot_floor_overrides_low_band(self):
        # Conservative attempt-1-2 baseline is 45-90s, but anti_bot
        # forces a 900s floor → both lo and hi raised.
        lo, hi = strict_backoff.strict_backoff_band(
            attempt=1, profile="conservative", failure_reason="anti_bot",
        )
        assert lo >= 900.0
        assert hi >= 900.0

    def test_anonymous_auth_wall_floor_600(self):
        lo, hi = strict_backoff.strict_backoff_band(
            attempt=1, profile="conservative",
            failure_reason="scraper_subprocess_failed anonymous_auth_wall",
        )
        assert lo >= 600.0
        assert hi >= 600.0

    def test_false_empty_floor_120(self):
        lo, hi = strict_backoff.strict_backoff_band(
            attempt=1, profile="conservative",
            failure_reason="false_empty",
        )
        assert lo >= 120.0
        assert hi >= 120.0

    def test_floor_does_not_lower_already_higher_band(self):
        # Conservative attempts 11+ baseline 1200-1800 is already
        # above every floor — band is preserved as-is.
        lo, hi = strict_backoff.strict_backoff_band(
            attempt=15, profile="conservative",
            failure_reason="anti_bot",
        )
        assert lo == 1200.0
        assert hi == 1800.0

    def test_unknown_reason_does_not_change_band(self):
        lo, hi = strict_backoff.strict_backoff_band(
            attempt=1, profile="conservative",
            failure_reason="unknown_random_failure",
        )
        assert (lo, hi) == (45.0, 90.0)

    def test_band_lo_le_hi(self):
        # Sanity across every (profile, attempt, reason) combo.
        for profile in strict_backoff.KNOWN_BACKOFF_PROFILES:
            for attempt in (1, 3, 6, 11, 50):
                for reason in (
                    None, "anti_bot", "anonymous_auth_wall",
                    "human_check", "false_empty", "garbage",
                ):
                    lo, hi = strict_backoff.strict_backoff_band(
                        attempt=attempt, profile=profile,
                        failure_reason=reason,
                    )
                    assert lo <= hi, (profile, attempt, reason, lo, hi)


# ---------------------------------------------------------------------------
# format_eta
# ---------------------------------------------------------------------------


class TestFormatEta:
    def test_seconds_only(self):
        assert strict_backoff.format_eta(0) == "0s"
        assert strict_backoff.format_eta(45) == "45s"

    def test_minutes_seconds(self):
        assert strict_backoff.format_eta(125) == "2m 5s"
        assert strict_backoff.format_eta(1050) == "17m 30s"

    def test_hours_minutes_seconds(self):
        assert strict_backoff.format_eta(3725) == "1h 2m 5s"

    def test_negative_clamped_to_zero(self):
        assert strict_backoff.format_eta(-10) == "0s"

    def test_rounds_to_nearest_second(self):
        assert strict_backoff.format_eta(45.4) == "45s"
        assert strict_backoff.format_eta(45.6) == "46s"


# ---------------------------------------------------------------------------
# Profile dict shape
# ---------------------------------------------------------------------------


class TestIsResetWorthyReason:
    def test_none_is_not_reset_worthy(self):
        assert strict_backoff.is_reset_worthy_reason(None) is False

    def test_empty_is_not_reset_worthy(self):
        assert strict_backoff.is_reset_worthy_reason("") is False

    @pytest.mark.parametrize("reason", [
        "anti_bot",
        "scraper_subprocess_failed: anti_bot detected",
        "ANTI_BOT",  # case-insensitive
    ])
    def test_anti_bot_is_reset_worthy(self, reason):
        assert strict_backoff.is_reset_worthy_reason(reason) is True

    @pytest.mark.parametrize("reason", [
        "anonymous_auth_wall",
        "scraper_subprocess_failed: anonymous_auth_wall observed",
    ])
    def test_anonymous_auth_wall_is_reset_worthy(self, reason):
        assert strict_backoff.is_reset_worthy_reason(reason) is True

    def test_human_check_timeout_is_reset_worthy(self):
        # The orchestrator concatenates `human_check_recovery_action`
        # into the reason string; "human_check_timeout" appears as a
        # substring in both `human_check_failed_on_timeout` and
        # `human_check_skipped_on_timeout` derived strings. We match
        # the bare key the user listed.
        assert strict_backoff.is_reset_worthy_reason(
            "human_check_timeout exceeded",
        ) is True

    @pytest.mark.parametrize("reason", [
        "false_empty",
        "blocked_or_empty_state",
        "scraper_subprocess_failed",  # plain failure → not reset-worthy
        "unknown_failure",
        "rate_limited",
        "auth_error",
    ])
    def test_non_reset_reasons(self, reason):
        assert strict_backoff.is_reset_worthy_reason(reason) is False, reason

    def test_substring_match_in_composite_reason(self):
        # The orchestrator builds composite reasons by joining
        # `status`, `error`, `quality_status` — must still detect
        # the keyword anywhere inside.
        assert strict_backoff.is_reset_worthy_reason(
            "scraper_subprocess_failed Scraper failed (exit 1). "
            "stderr: classified as 'anti_bot' — re-establish ...",
        ) is True

    def test_known_keys_complete(self):
        # The exposed RESET_WORTHY_REASON_KEYS tuple is the source
        # of truth and must include the three classes the user
        # specified.
        for k in ("anti_bot", "anonymous_auth_wall", "human_check_timeout"):
            assert k in strict_backoff.RESET_WORTHY_REASON_KEYS

    def test_false_empty_explicitly_excluded(self):
        # Documented exclusion in the user's spec.
        assert "false_empty" not in strict_backoff.RESET_WORTHY_REASON_KEYS


class TestProfileShape:
    def test_every_profile_has_four_bands(self):
        for name, prof in strict_backoff.BACKOFF_PROFILES.items():
            assert set(prof.keys()) == {"1-2", "3-5", "6-10", "11+"}, name

    def test_every_band_is_lo_hi_pair(self):
        for name, prof in strict_backoff.BACKOFF_PROFILES.items():
            for band, pair in prof.items():
                assert len(pair) == 2, (name, band)
                lo, hi = pair
                assert lo > 0 and hi >= lo, (name, band, pair)

    def test_conservative_bands_grow_monotonically(self):
        prof = strict_backoff.BACKOFF_PROFILES["conservative"]
        seq = ["1-2", "3-5", "6-10", "11+"]
        for a, b in zip(seq, seq[1:]):
            assert prof[a][1] <= prof[b][0], (a, b, prof[a], prof[b])

    def test_default_profile_constant_matches_dict_key(self):
        assert (
            strict_backoff.DEFAULT_BACKOFF_PROFILE
            in strict_backoff.BACKOFF_PROFILES
        )

    def test_known_profiles_tuple_matches_dict(self):
        assert (
            set(strict_backoff.KNOWN_BACKOFF_PROFILES)
            == set(strict_backoff.BACKOFF_PROFILES.keys())
        )
