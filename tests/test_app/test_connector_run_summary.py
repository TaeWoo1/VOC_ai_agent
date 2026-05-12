"""Tests for ConnectorRunSummary additive fields (I-OY-RETRY-INTENT-SUMMARY-FIELDS).

Step 1 of the multi-session resume policy. Covers only the schema-level
behavior of `retry_intent` + `retry_after_minutes`:

  - default values
  - serialization shape (`.model_dump()` includes both keys)
  - backward compatibility (pre-patch JSON without the keys deserializes
    cleanly into the new schema)
  - value handling (documented retry_intent values + forward-compat
    tolerance; None / 0 / positive ints for retry_after_minutes)

NO classifier behavior is exercised — `classify_status` is unchanged at
this step and will be wired in I-B.
"""

from __future__ import annotations

from datetime import datetime

from src.voc.app.connector_run_summary import ConnectorRunSummary


def _summary(**overrides) -> ConnectorRunSummary:
    """Build a minimal valid ConnectorRunSummary, mirroring test_quality_gates."""
    base = {
        "run_id": "r1",
        "channel": "test",
        "requested_target": "fixture",
        "started_at": datetime(2026, 1, 1),
        "finished_at": datetime(2026, 1, 1, 0, 0, 1),
    }
    base.update(overrides)
    return ConnectorRunSummary(**base)


def test_connector_run_summary_defaults_retry_intent_none_and_minutes_none():
    """Default-constructed summary has retry_intent='none' and retry_after_minutes=None."""
    summary = _summary()

    assert summary.retry_intent == "none"
    assert summary.retry_after_minutes is None


def test_connector_run_summary_serialization_includes_retry_intent_fields():
    """`.model_dump()` includes both new keys at their default values."""
    summary = _summary()
    dumped = summary.model_dump()

    assert "retry_intent" in dumped
    assert "retry_after_minutes" in dumped
    assert dumped["retry_intent"] == "none"
    assert dumped["retry_after_minutes"] is None


def test_connector_run_summary_legacy_summary_without_retry_fields_deserializes_with_defaults():
    """Pre-patch JSON (omitting both new keys) deserializes into the new schema.

    Simulates a `batch_summary.json` written before this ticket landed: only
    the legacy required fields are present, neither `retry_intent` nor
    `retry_after_minutes` is in the payload. Round-tripping through
    ConnectorRunSummary must succeed and produce the documented defaults.
    """
    legacy_payload = {
        "run_id": "legacy-r0",
        "channel": "oliveyoung_browser_api",
        "requested_target": "A000000225736",
        "started_at": "2026-05-12T17:11:00",
        "finished_at": "2026-05-12T18:47:00",
        # ---- pre-patch fields, kept for realism; none of these are new ----
        "raw_records_seen": 610,
        "records_parsed": 610,
        "blocked": True,
        "auth_error": False,
        "cursor_api_rate_limited": True,
        "cursor_rate_limit_exhausted": True,
        # NOTE: no retry_intent, no retry_after_minutes.
    }

    summary = ConnectorRunSummary(**legacy_payload)

    assert summary.retry_intent == "none"
    assert summary.retry_after_minutes is None
    # Sanity: the legacy fields we did supply still round-trip correctly,
    # so the defaults above are not masking a deserialization bug.
    assert summary.raw_records_seen == 610
    assert summary.cursor_api_rate_limited is True
    assert summary.cursor_rate_limit_exhausted is True


def test_connector_run_summary_retry_intent_accepts_documented_values():
    """Each of the three by-convention values constructs cleanly.

    The three documented values come from the resume-policy plan §5:
      - "none"
      - "retry_after_cooldown"
      - "manual_review_required"

    A fourth, non-documented string is also accepted because the field is
    typed `str` (forward compatibility for future taxonomy extensions);
    readers SHOULD treat unknown values as equivalent to "none" until the
    taxonomy is extended. The test asserts construction succeeds; it does
    NOT assert any reader interprets the unknown value — no reader exists
    yet in this ticket.
    """
    for documented in ("none", "retry_after_cooldown", "manual_review_required"):
        summary = _summary(retry_intent=documented)
        assert summary.retry_intent == documented

    # Forward-compat: unknown string is tolerated at the schema layer.
    forward_compat = _summary(retry_intent="some_future_intent")
    assert forward_compat.retry_intent == "some_future_intent"


def test_connector_run_summary_retry_after_minutes_accepts_int_or_none():
    """retry_after_minutes accepts None, 0, and positive integers.

    None is the canonical default (used whenever retry_intent != "retry_after_cooldown").
    0 is a valid hint ("resume immediately"); positive ints are the typical
    operator-cadence values (60 for general OY SKUs, 90 for Ilso-class per
    the resume-policy plan §6).

    Pydantic's default config coerces numeric strings into ints; this test
    does not exercise coercion (no caller in this ticket emits string ints),
    but the behavior is documented here so I-B / I-C do not need to
    re-derive it.
    """
    assert _summary(retry_after_minutes=None).retry_after_minutes is None
    assert _summary(retry_after_minutes=0).retry_after_minutes == 0
    assert _summary(retry_after_minutes=60).retry_after_minutes == 60
    assert _summary(retry_after_minutes=90).retry_after_minutes == 90
