"""Tests for evaluate_quality_gates boundary classification.

Boundaries (Phase 1 design refinement §F.2):
- INVALID: blocked, OR auth_error, OR parse_yield < 0.5
- DEGRADED: parse_warning_ratio > 0.1, OR 0.5 <= parse_yield < 0.8
- OK: otherwise
- 0.8 yield is OK (boundary inclusive on OK side)
- 0.1 warning ratio is OK (boundary inclusive on OK side)
"""

from __future__ import annotations

from datetime import datetime

from src.voc.app.connector_run_summary import (
    ConnectorRunSummary,
    evaluate_quality_gates,
)


def _summary(**overrides) -> ConnectorRunSummary:
    base = {
        "run_id": "r1",
        "channel": "test",
        "requested_target": "fixture",
        "started_at": datetime(2026, 1, 1),
        "finished_at": datetime(2026, 1, 1, 0, 0, 1),
        "raw_records_seen": 100,
        "records_parsed": 100,
        "records_dropped_short_text": 0,
        "records_dropped_unparseable_date": 0,
        "parse_warnings": 0,
        "blocked": False,
        "auth_error": False,
    }
    base.update(overrides)
    return ConnectorRunSummary(**base)


def test_perfect_run_is_ok():
    assert evaluate_quality_gates(_summary()) == "ok"


def test_blocked_is_invalid():
    assert evaluate_quality_gates(_summary(blocked=True)) == "invalid"


def test_auth_error_is_invalid():
    assert evaluate_quality_gates(_summary(auth_error=True)) == "invalid"


def test_parse_yield_below_half_is_invalid():
    # 49 parsed of 100 seen → 0.49 < 0.5 → invalid
    assert evaluate_quality_gates(
        _summary(raw_records_seen=100, records_parsed=49)
    ) == "invalid"


def test_parse_yield_exactly_half_is_degraded_not_invalid():
    # 50 / 100 = 0.5, NOT < 0.5 → not invalid; 0.5 < 0.8 → degraded
    assert evaluate_quality_gates(
        _summary(raw_records_seen=100, records_parsed=50)
    ) == "degraded"


def test_parse_yield_just_below_eighty_percent_is_degraded():
    # 79 / 100 = 0.79 → degraded
    assert evaluate_quality_gates(
        _summary(raw_records_seen=100, records_parsed=79)
    ) == "degraded"


def test_parse_yield_exactly_eighty_percent_is_ok():
    # 80 / 100 = 0.8 → not < 0.8 → ok (assuming no warnings)
    assert evaluate_quality_gates(
        _summary(raw_records_seen=100, records_parsed=80)
    ) == "ok"


def test_warning_ratio_above_ten_percent_is_degraded():
    # 11 warnings / 100 parsed = 0.11 > 0.1 → degraded (yield is fine at 1.0)
    assert evaluate_quality_gates(
        _summary(raw_records_seen=100, records_parsed=100, parse_warnings=11)
    ) == "degraded"


def test_warning_ratio_exactly_ten_percent_is_ok():
    # 10 / 100 = 0.1 → not > 0.1 → ok
    assert evaluate_quality_gates(
        _summary(raw_records_seen=100, records_parsed=100, parse_warnings=10)
    ) == "ok"


def test_blocked_overrides_perfect_yield():
    # even with everything else perfect, blocked → invalid
    assert evaluate_quality_gates(
        _summary(blocked=True, records_parsed=100, raw_records_seen=100)
    ) == "invalid"


def test_zero_seen_zero_parsed_treated_as_ok():
    # raw_records_seen=0, records_parsed=0 → max(0,1)=1, yield=0/1=0.0 < 0.5 → invalid
    # This protects against a connector that fetched nothing being treated as healthy.
    assert evaluate_quality_gates(
        _summary(raw_records_seen=0, records_parsed=0)
    ) == "invalid"


def test_empty_run_no_warnings_invalid_via_yield_floor():
    # records_parsed=0 means parse_yield is 0/max(0,1)=0 → invalid
    assert evaluate_quality_gates(
        _summary(raw_records_seen=10, records_parsed=0, parse_warnings=0)
    ) == "invalid"


# ---------------------------------------------------------------------------
# PR-1: incomplete_collection downgrade
# ---------------------------------------------------------------------------

def test_incomplete_collection_alone_is_degraded():
    # Otherwise-clean run with incomplete_collection=True → degraded.
    # This is the core PR-1 gate change: pagination terminating mid-product
    # with hasNext=True but no error means we're missing data, even though
    # nothing actively failed.
    assert evaluate_quality_gates(
        _summary(incomplete_collection=True)
    ) == "degraded"


def test_incomplete_collection_does_not_override_invalid():
    # If both incomplete_collection AND blocked fire, blocked wins → invalid.
    assert evaluate_quality_gates(
        _summary(blocked=True, incomplete_collection=True)
    ) == "invalid"


def test_incomplete_collection_does_not_override_auth_error():
    assert evaluate_quality_gates(
        _summary(auth_error=True, incomplete_collection=True)
    ) == "invalid"


def test_incomplete_collection_does_not_override_yield_floor():
    # parse_yield < 0.5 dominates incomplete_collection.
    assert evaluate_quality_gates(
        _summary(raw_records_seen=100, records_parsed=10, incomplete_collection=True)
    ) == "invalid"


def test_canonical_clean_run_with_pagination_exhausted_is_ok():
    # Clean termination: pagination_exhausted=True, no incomplete, no errors.
    # This represents the canonical happy path; pagination_exhausted alone
    # must NOT downgrade quality.
    assert evaluate_quality_gates(
        _summary(pagination_exhausted=True)
    ) == "ok"


def test_pre_pr1_summary_round_trip_preserves_ok():
    """A summary serialized before PR-1 (no new fields) round-trips through
    ConnectorRunSummary and still classifies as 'ok'. Backward compatibility
    of the gate decision under default field values."""
    s = _summary()  # all new fields default to False/None
    payload = s.model_dump()
    s2 = ConnectorRunSummary.model_validate(payload)
    assert evaluate_quality_gates(s2) == "ok"


def test_new_telemetry_flags_default_false_or_none():
    """Confirm the new fields default cleanly when omitted from construction."""
    s = _summary()
    assert s.cold_start_timed_out is False
    assert s.http_403_seen is False
    assert s.http_429_seen is False
    assert s.http_401_or_login_required_seen is False
    assert s.mid_stream_auth_break is False
    assert s.incomplete_collection is False
    assert s.pagination_exhausted is False
    assert s.last_observed_has_next is None
    # PR-2 retry telemetry defaults
    assert s.auth_retry_attempts_used == 0
    assert s.auth_retry_exhausted is False
    assert s.partial_debug_artifact_path is None


# ---------------------------------------------------------------------------
# PR-2: auth_retry_attempts_used downgrade + retry exhaustion
# ---------------------------------------------------------------------------

def test_auth_retry_recovered_is_degraded_not_ok():
    """Successful recovery: auth_error=False (recovered), retries used > 0.
    Even though nothing's actively wrong, the run had a hiccup → degraded.
    """
    assert evaluate_quality_gates(
        _summary(auth_retry_attempts_used=1)
    ) == "degraded"


def test_auth_retry_exhausted_is_invalid():
    """Retry was attempted and final state is auth-blocked → invalid.
    The legacy auth_error path short-circuits before the retry-attempt
    downgrade can fire, which is intentional.
    """
    assert evaluate_quality_gates(
        _summary(
            auth_error=True, auth_retry_attempts_used=1,
            auth_retry_exhausted=True,
        )
    ) == "invalid"


def test_no_retry_path_matches_pr1_behavior():
    """auth_retry not used at all (the PR-1 path): auth_error=True still →
    invalid; no retry → no degraded downgrade by auth_retry_attempts_used."""
    assert evaluate_quality_gates(_summary(auth_error=True)) == "invalid"
    # Also: clean run with all PR-2 fields default → ok (matching pre-PR-2).
    assert evaluate_quality_gates(_summary()) == "ok"


def test_auth_retry_does_not_override_blocked():
    """Even with retry usage, blocked still produces invalid (gate ordering)."""
    assert evaluate_quality_gates(
        _summary(blocked=True, auth_retry_attempts_used=1)
    ) == "invalid"


def test_pre_pr2_summary_round_trip_preserves_classifications():
    """Sanity: round-tripping a pre-PR-2 summary through the schema must
    not silently flip classifications under the extended gate."""
    s = _summary()  # all PR-2 fields at defaults
    payload = s.model_dump()
    s2 = ConnectorRunSummary.model_validate(payload)
    assert evaluate_quality_gates(s2) == "ok"

    s_blocked = _summary(blocked=True)
    payload_b = s_blocked.model_dump()
    s_blocked2 = ConnectorRunSummary.model_validate(payload_b)
    assert evaluate_quality_gates(s_blocked2) == "invalid"


# ---------------------------------------------------------------------------
# PR-4: cursor / request-side fields are observation-only — gate ignores them
# ---------------------------------------------------------------------------

def test_pr4_fields_do_not_change_classification():
    """Setting any PR-4 field MUST not move a clean run off 'ok'. The gate
    is observation-only for these fields."""
    # Clean run with full PR-4 telemetry populated → still ok.
    s = _summary(
        review_api_request_count=10,
        review_api_response_count=10,
        cursor_sequence=["c1", "c2", "c3"],
        last_known_cursor="c3",
        failed_at_request_index=None,
        login_state_observed="logged_in",
        trace_artifact_path="/tmp/foo.jsonl",
    )
    assert evaluate_quality_gates(s) == "ok"

    # An invalid run remains invalid even with rich PR-4 telemetry.
    s2 = _summary(
        blocked=True,
        cursor_sequence=["c1"],
        last_known_cursor="c1",
        failed_at_request_index=2,
        login_state_observed="logged_in",
        trace_artifact_path="/tmp/foo.jsonl",
    )
    assert evaluate_quality_gates(s2) == "invalid"


def test_pre_pr4_summary_round_trip_preserves_defaults():
    """A summary created without any PR-4 fields must round-trip cleanly
    and classify identically before and after."""
    s = _summary()  # all PR-4 fields at defaults
    payload = s.model_dump()
    s2 = ConnectorRunSummary.model_validate(payload)
    # PR-4 defaults
    assert s2.review_api_request_count == 0
    assert s2.review_api_response_count == 0
    assert s2.cursor_sequence == []
    assert s2.last_known_cursor is None
    assert s2.failed_at_request_index is None
    assert s2.login_state_observed is None
    assert s2.trace_artifact_path is None
    assert evaluate_quality_gates(s2) == "ok"
