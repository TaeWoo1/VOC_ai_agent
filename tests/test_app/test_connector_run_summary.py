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


# =====================================================================
# I-OY-RETRY-INTENT-CLASSIFICATION-WIRING (I-B of multi-session resume).
# =====================================================================
# These tests exercise the `derive_retry_intent()` classifier method on
# ConnectorRunSummary. They are scoped to the schema layer: the method
# reads existing flag fields and writes `retry_intent` +
# `retry_after_minutes`. NO call site is exercised here; the
# connector-side wiring (one call at the end of `collect()`) is covered
# by `tests/test_connectors/test_oliveyoung_browser_api_runtime.py`
# already running through `collect()` and observing the populated
# fields on `c.last_run_summary` (no assertion modification needed —
# `retry_intent` is additive, the existing assertions on
# `cursor_api_rate_limited` etc. are untouched).
#
# Operator-defined classification (resume-policy plan §5):
#   1. cursor_api_rate_limited=True       → retry_after_cooldown / 90
#   2. auth-wall / human-check / 403      → manual_review_required / None
#   3. otherwise                           → none / None
# Rule 4: cursor 429 wins over auth-wall when both fire.
# Rule 5: final_status is NOT touched anywhere by this method.


def test_retry_intent_cursor_api_rate_limited_emits_retry_after_cooldown_90m():
    """Rule 1 — cursor_api_rate_limited=True maps to retry_after_cooldown / 90.

    Ilso-class halt path. The 90-minute cadence comes from resume-policy
    plan §6 (live evidence: gaps of >= ~90m restored the boundary to
    ~610 records; shorter gaps dropped it to 540).
    """
    summary = _summary(cursor_api_rate_limited=True)
    summary.derive_retry_intent()

    assert summary.retry_intent == "retry_after_cooldown"
    assert summary.retry_after_minutes == 90


def test_retry_intent_auth_error_emits_manual_review_required():
    """Rule 2 — auth_error=True (no cursor flag) maps to manual_review_required.

    auth_error is the canonical auth-wall signal already used by the
    Phase 1 quality gate to short-circuit a run to `invalid`; the same
    signal also flags the run as not-time-recoverable here.
    """
    summary = _summary(auth_error=True)
    summary.derive_retry_intent()

    assert summary.retry_intent == "manual_review_required"
    assert summary.retry_after_minutes is None


def test_retry_intent_mid_stream_auth_break_emits_manual_review_required():
    """Rule 2 — mid_stream_auth_break=True alone trips manual_review_required.

    Distinct from cold-start auth_error: the session was authenticated
    when collection started but lost auth partway through. Operator
    must re-authenticate before any retry can extend coverage.
    """
    summary = _summary(mid_stream_auth_break=True)
    summary.derive_retry_intent()

    assert summary.retry_intent == "manual_review_required"
    assert summary.retry_after_minutes is None


def test_retry_intent_human_check_detected_emits_manual_review_required():
    """Rule 2 — human_check_detected=True AND human_check_recovered=False.

    The CAPTCHA wait fired AND timed out without the operator clearing
    it. Re-running the collection immediately produces the same wall.
    Operator action (refresh the browser, solve the CAPTCHA manually)
    is required before any retry can possibly help.
    """
    summary = _summary(
        human_check_detected=True,
        human_check_recovered=False,
    )
    summary.derive_retry_intent()

    assert summary.retry_intent == "manual_review_required"
    assert summary.retry_after_minutes is None


def test_retry_intent_human_check_recovered_true_does_not_emit_manual_review_required():
    """human_check_detected=True AND human_check_recovered=True → no manual review.

    Recovery succeeded — the operator-facing CAPTCHA wait cleared and
    the session continued normally. There is no operator action
    pending; classifying this as `manual_review_required` would burn
    operator attention on a run that already self-recovered. With no
    cursor-rate-limit signal either, the summary stays at the default
    `retry_intent="none"`.
    """
    summary = _summary(
        human_check_detected=True,
        human_check_recovered=True,
    )
    summary.derive_retry_intent()

    assert summary.retry_intent == "none"
    assert summary.retry_after_minutes is None


def test_retry_intent_http_403_seen_emits_manual_review_required():
    """Rule 2 — http_403_seen=True (CDN-level hard block) trips manual_review.

    HTTP 403 is the canonical hard-block signal (Cloudflare / Akamai /
    OY's own anti-bot layer). Unlike cursor 429, it is not just a
    sliding-window throttle — operator must change their IP, clear
    cookies, or re-authenticate.
    """
    summary = _summary(http_403_seen=True)
    summary.derive_retry_intent()

    assert summary.retry_intent == "manual_review_required"
    assert summary.retry_after_minutes is None


def test_retry_intent_normal_complete_remains_none():
    """Rule 3 — clean exit (pagination_exhausted=True, no failure flags).

    The natural-end-of-corpus shape: server returned hasNext=False, no
    rate-limit, no auth issue. Operator should not be prompted to retry.
    """
    summary = _summary(
        pagination_exhausted=True,
        # ALL failure flags explicitly at False to make the test
        # self-documenting (the defaults already match, but spelling
        # them out guards against future field additions that might
        # land a non-False default).
        cursor_api_rate_limited=False,
        auth_error=False,
        mid_stream_auth_break=False,
        http_403_seen=False,
        human_check_detected=False,
        human_check_recovered=False,
    )
    summary.derive_retry_intent()

    assert summary.retry_intent == "none"
    assert summary.retry_after_minutes is None


def test_retry_intent_cursor_429_takes_precedence_over_auth_wall():
    """Rule 4 — cursor_api_rate_limited=True wins over concurrent auth_error.

    When BOTH a cursor 429 and an auth-wall signal are present, the
    cooldown-driven retry path takes priority because:
      (a) the 429 is wall-clock recoverable in isolation,
      (b) the auth-wall signal may itself be a downstream consequence
          of the throttle (the page returns a login wall when the
          throttle has burned the session), and
      (c) operators reading the dashboard should be told the
          mechanically-cheaper recovery path first.

    This test pins the precedence: even with auth_error=True
    coincident, the output is retry_after_cooldown / 90, NOT
    manual_review_required.
    """
    summary = _summary(
        cursor_api_rate_limited=True,
        auth_error=True,
    )
    summary.derive_retry_intent()

    assert summary.retry_intent == "retry_after_cooldown"
    assert summary.retry_after_minutes == 90


def test_retry_intent_classifier_is_idempotent():
    """Calling derive_retry_intent() twice yields the same result.

    The method reads flag fields and writes retry_intent /
    retry_after_minutes; the flags are not mutated by the call, so the
    second invocation reads the same inputs and writes the same
    outputs. Idempotency matters because future call paths (e.g.
    re-rendering a Markdown summary after a partial-summary write)
    may invoke derive twice on the same instance.
    """
    summary = _summary(cursor_api_rate_limited=True)

    summary.derive_retry_intent()
    first_intent = summary.retry_intent
    first_minutes = summary.retry_after_minutes

    summary.derive_retry_intent()
    second_intent = summary.retry_intent
    second_minutes = summary.retry_after_minutes

    assert first_intent == second_intent == "retry_after_cooldown"
    assert first_minutes == second_minutes == 90


def test_retry_intent_default_construction_remains_none():
    """I-A invariant guard — default-constructed summary, BEFORE derive call.

    Pre-existing I-A test
    `test_connector_run_summary_defaults_retry_intent_none_and_minutes_none`
    asserts the same thing for the schema layer; this one re-asserts it
    in the I-B test block as a regression guard: even after the
    classifier method lands, the field defaults are unchanged and the
    method MUST be called explicitly to populate them. No call site
    other than the connector's `collect()` finalize hook reads or
    writes these fields.
    """
    summary = _summary()

    # No derive call invoked — fields stay at documented defaults.
    assert summary.retry_intent == "none"
    assert summary.retry_after_minutes is None


def test_retry_intent_derive_method_must_be_called_explicitly():
    """Direct field setting does NOT auto-populate retry_intent fields.

    This is the explicit-method variant of the "validator fires on
    construction" test from the ticket spec. Because the classifier is
    a method (not a pydantic `model_validator`), constructing a summary
    with `cursor_api_rate_limited=True` directly via the constructor
    leaves `retry_intent` at its default "none" until
    `derive_retry_intent()` is called. This is the I-A invariant
    (legacy JSON payloads with `cursor_api_rate_limited=True` MUST
    still deserialize with `retry_intent="none"`); the I-B test
    `test_connector_run_summary_legacy_summary_without_retry_fields_deserializes_with_defaults`
    above directly relies on this property.
    """
    summary = _summary(cursor_api_rate_limited=True)

    # No derive call — defaults must hold even though the rate-limit
    # flag is True.
    assert summary.retry_intent == "none"
    assert summary.retry_after_minutes is None

    # After explicit call, the rule 1 classification takes effect.
    summary.derive_retry_intent()
    assert summary.retry_intent == "retry_after_cooldown"
    assert summary.retry_after_minutes == 90
