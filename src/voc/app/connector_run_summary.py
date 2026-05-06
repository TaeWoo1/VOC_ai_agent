"""ConnectorRunSummary + quality-gate evaluator (Phase 1).

Per-run observability record. Despite the historical name, this struct now
carries BOTH connector-level counters AND pipeline-level counters; the names
of the fields disambiguate which is which:

  Connector-level (set by the connector during `collect()`; counts what the
  CONNECTOR did with the source rows):
    - raw_records_seen
    - records_parsed
    - records_dropped_short_text     ← raw content was empty at the connector
    - records_dropped_unparseable_date
    - parse_warnings                 ← e.g. clamped rating, mixed-value label
    - blocked, auth_error
    - sample_dropped_reasons

  Pipeline-level (set by `Phase1Pipeline.run()` AFTER the connector returns;
  counts what NORMALIZATION rejected from the connector's parsed rows):
    - pipeline_normalize_rejections  ← e.g. cleaned text < 10-char floor

The split is load-bearing for the bait report: a Coupang CSV row with empty
content is a CONNECTOR drop (records_dropped_short_text); a row with text "굿"
that the connector parsed but normalize() rejects is a PIPELINE rejection
(pipeline_normalize_rejections). Conflating them would obscure where data
loss is happening.

`evaluate_quality_gates` uses ONLY connector-level counters (per Phase 1 plan
refinement §F.2); pipeline rejections are observability-only and do not
influence quality_status.

Boundary rules (§F.2 + Phase 2 OY hardening PR-1 + PR-2):
  - INVALID: blocked, OR auth_error, OR parse_yield < 0.5
  - DEGRADED: parse_warning_ratio > 0.1, OR 0.5 <= parse_yield < 0.8,
              OR incomplete_collection,
              OR auth_retry_attempts_used > 0 (recovery happened — even when
              fully successful, the run had a hiccup worth flagging)
  - OK: otherwise

Boundaries are inclusive on the OK side: parse_yield == 0.8 → ok,
parse_warning_ratio == 0.1 → ok.

PR-1 telemetry expansion (additive, backward-compatible):
The summary now carries distinct boolean flags for each failure-class so
operators can tell e.g. an HTTP 403 ban from a cold-start timeout — both
collapse to `blocked=True` for the gate, but the underlying cause was lost
in the legacy schema. All new fields default to False/None so old summaries
deserialize unchanged. Quality-gate decisions for canonical runs (all new
fields at defaults) are byte-identical to the pre-PR-1 rule.

PR-2 retry + debug-artifact telemetry (additive):
  - auth_retry_attempts_used / auth_retry_exhausted record opt-in retry usage.
  - partial_debug_artifact_path captures the JSONL filename when the connector
    writes a debug artifact (NEVER points at a file inside voc_data.db scope —
    the artifact lives in the operator-supplied debug_dir).

PR-4 request-side capture + cursor persistence (additive):
  - review_api_request_count / review_api_response_count expose how many
    /reviews/cursor API calls fired and how many responses came back. A
    mismatch is itself a finding (e.g., the page issued requests we never
    saw return).
  - cursor_sequence records `nextCursorId` from each successful body in
    order, and last_known_cursor is the most recent one. These are the
    inputs a future cursor-direct replay PR would need.
  - failed_at_request_index records which API call (1-indexed) was the
    first to return blocked / auth_error / rate_limited / malformed. None
    means no failure was observed.
  - login_state_observed is a best-effort DOM probe result:
    "logged_in" | "logged_out" | "unknown" | None. Informational only; the
    quality gate ignores this field.
  - trace_artifact_path is the JSONL of per-API-call records when the
    operator supplied --debug-dir. Cookies and authorization headers are
    redacted by default; presence/absence is recorded as booleans.

Quality gate is UNCHANGED by PR-4. All new fields are observation-only.
"""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field


QualityStatus = Literal["ok", "degraded", "invalid"]


class ConnectorRunSummary(BaseModel):
    run_id: str
    channel: str
    requested_target: str
    started_at: datetime
    finished_at: datetime | None = None

    # ---- Connector-level (populated by connector.collect) ----
    raw_records_seen: int = 0
    records_parsed: int = 0
    records_dropped_short_text: int = 0
    records_dropped_unparseable_date: int = 0
    parse_warnings: int = 0
    blocked: bool = False
    auth_error: bool = False
    sample_dropped_reasons: list[str] = Field(default_factory=list)

    # ---- Connector-level distinct telemetry (PR-1, additive) ----
    # All default False/None so pre-PR-1 serialized summaries deserialize
    # cleanly. blocked/auth_error remain the canonical gate inputs; these
    # fields say WHICH underlying cause produced them.
    cold_start_timed_out: bool = False
    http_403_seen: bool = False
    http_429_seen: bool = False
    http_401_or_login_required_seen: bool = False
    mid_stream_auth_break: bool = False
    incomplete_collection: bool = False
    pagination_exhausted: bool = False
    last_observed_has_next: bool | None = None

    # ---- Connector-level retry + debug telemetry (PR-2, additive) ----
    # Default off / unused so any caller who doesn't opt into retry sees
    # PR-1-equivalent serialization.
    auth_retry_attempts_used: int = 0
    auth_retry_exhausted: bool = False
    partial_debug_artifact_path: str | None = None

    # ---- Connector-level request-side capture + cursor persistence (PR-4) ----
    # All additive, defaulting to safe values so pre-PR-4 summaries deserialize
    # cleanly. Populated when the underlying session reports request metadata
    # (real Playwright sessions always do; FakeBrowserReviewSession-based tests
    # may leave them at default unless the test explicitly populates them).
    review_api_request_count: int = 0
    review_api_response_count: int = 0
    cursor_sequence: list[str] = Field(default_factory=list)
    last_known_cursor: str | None = None
    failed_at_request_index: int | None = None
    # login_state_observed: "logged_in" | "logged_out" | "unknown" | None.
    # None means the probe was not run (e.g., non-CDP mode). Strings other
    # than the four expected literals are tolerated by Pydantic but should be
    # treated as "unknown" by readers.
    login_state_observed: str | None = None
    # trace_artifact_path is the JSONL of per-API-call records (request URL,
    # query params, redacted headers, response cursor metadata). Lands under
    # the operator-supplied --debug-dir when set; never inside voc_data.db
    # scope.
    trace_artifact_path: str | None = None

    # ---- Sort-aware crawl telemetry (Phase 2E, additive) ----
    # `requested_sort_type` is what the operator asked for via the
    # `sort_type=` constructor param. None = legacy default (page-default
    # sort, no oy_sort_type stamping).
    # `observed_sort_types` tallies what sortType values the page's
    # request bodies actually carried during the run, regardless of
    # whether they were forwarded to the consumer queue. Used to detect
    # cases where a sort-button click failed to take effect.
    # `responses_filtered_out_by_sort` counts responses dropped by the
    # request-side filter (i.e., observed sortType ≠ requested). A
    # non-zero value with raw_records_seen=0 means the page never
    # produced a matching-sort response — usually a failed sort-button
    # click or a stale page state.
    requested_sort_type: str | None = None
    observed_sort_types: dict[str, int] = Field(default_factory=dict)
    responses_filtered_out_by_sort: int = 0
    # Diagnostic: deduped list of normalized button labels the connector
    # enumerated while looking for the requested sort button. Populated
    # only when sort-button click succeeded OR failed (to surface what
    # the page actually rendered). Empty list when sort-aware mode is
    # not engaged.
    available_sort_button_labels: list[str] = Field(default_factory=list)

    # ---- False-empty review-state recovery telemetry (Phase 2E, additive) ----
    # `false_empty_state_detected` is True if at least one DOM probe
    # during the run found OY's false empty-review marker (e.g.
    # "등록된 리뷰가 없어요"). Even if a subsequent reload-retry
    # recovered, the flag stays True — operators want to know the
    # transient state appeared.
    # `false_empty_retry_count` is the total number of in-session
    # reload-and-recheck cycles executed. 0 when the marker was never
    # observed.
    false_empty_state_detected: bool = False
    false_empty_retry_count: int = 0

    # ---- Anti-bot / interstitial recovery telemetry (Phase 2E, additive) ----
    # `interstitial_detected` is True if at least one DOM probe during
    # the run found a human-verification / auth-wall / login-required
    # marker on the page (e.g. "로봇이 아닙니다", "잠시만 기다려 주세요",
    # "로그인이 필요합니다"). Distinct from `false_empty_state_detected`
    # because the recovery action differs (re-click review tab + wait
    # vs. page-recreate). Stays True even if a later retry cleared it.
    # `interstitial_wait_s` is the cumulative time spent sleeping in
    # the interstitial-recovery backoff (NOT including time inside the
    # tab re-click). `retry_after_interstitial` is the count of times
    # the review-tab re-click ran in response to a positive
    # interstitial probe.
    interstitial_detected: bool = False
    interstitial_wait_s: float = 0.0
    retry_after_interstitial: int = 0

    # ---- Human-check (operator-driven CAPTCHA wait) telemetry ----
    # Distinct from the short-jitter `interstitial_*` retries above:
    # those auto-recover within a few tens of seconds. Human-check
    # is the long-poll path the operator solves manually in a
    # CDP-attached Chrome window. Populated by
    # `OliveYoungBrowserAPIConnector._wait_for_human_check`.
    #   `human_check_detected`           — at least one wait was triggered.
    #   `human_check_waited_seconds`     — cumulative seconds spent polling.
    #   `human_check_recovered`          — True if the page cleared the
    #                                       interstitial markers within
    #                                       the timeout. False on timeout.
    #   `human_check_recovery_action`    — terminal verb describing what
    #                                       happened. One of:
    #                                       "recovered", "skipped_on_timeout",
    #                                       "failed_on_timeout", "not_detected".
    human_check_detected: bool = False
    human_check_waited_seconds: int = 0
    human_check_recovered: bool = False
    human_check_recovery_action: str | None = None

    # ---- Phase 2E coverage-signal capture (additive) ----
    # Total review count surfaced by the product page DOM badge or by
    # an API response that populated `totalCnt`. None when neither
    # source produced a value — downstream code reads None as
    # "coverage unknown" and emits no spurious coverage_ratio. Never
    # synthesized or estimated; this is metadata for interpretation
    # only and MUST NOT be used to claim full-corpus representativeness
    # unless paired with `is_full_corpus=True` in CorpusProvenance.
    total_review_count_available: int | None = None

    # ---- v2.4.3 product-image capture (additive) ----
    # Representative product image URL captured opportunistically from
    # the detail page during the connector's warm session — typically
    # via og:image / JSON-LD. None when the connector didn't run with
    # a real session (e.g. CSV connectors) or when no image markers
    # matched. Pipeline-start product metadata collection consumes
    # this URL via `image_url_hint` so it can skip the standalone
    # HTTP detail-page fetch and avoid anti-bot escalation. Never
    # used to gate scraping behavior; absence is acceptable.
    product_image_url: str | None = None

    # ---- v2.4.4 image-capture diagnostic (additive) ----
    # When the warm-session image capture didn't produce a URL,
    # operators need to know WHY. These fields surface structural
    # counts from the HTML extractor so the pipeline can classify
    # the failure path (warm_capture_no_image_marker vs
    # warm_capture_not_attempted vs propagation gap).
    #
    # NEVER carries HTML or cookies — only counts + the page URL +
    # the eventually-extracted URL (which is public anyway).
    product_image_capture_attempted: bool = False
    product_image_capture_page_url: str | None = None
    product_image_capture_html_length: int | None = None
    product_image_capture_og_count: int = 0
    product_image_capture_jsonld_count: int = 0
    product_image_capture_twitter_count: int = 0
    product_image_capture_link_image_src_count: int = 0
    product_image_capture_oy_thumbnail_img_count: int = 0
    product_image_capture_selected_source: str | None = None
    product_image_capture_error: str | None = None

    # ---- v2.4.5 session lifecycle + identity diagnostics ----
    # Distinguishes "open() never ran" from "open() ran but the
    # capture hook didn't fire" from "capture fired but extractor
    # returned nothing". Without these, `attempted=False` is
    # ambiguous.
    #
    # `session_id` is `id(self)` recorded by the session itself.
    # `diagnostic_session_id` is the same value read by the connector
    # at diagnostic-collection time. They MUST match — when they
    # differ, the connector queried a different session object than
    # the one that ran open() (orchestration bug).
    product_image_session_id: int | None = None
    product_image_diagnostic_session_id: int | None = None
    product_image_session_class: str | None = None
    product_image_session_open_called: bool = False
    product_image_session_open_url_at_start: str | None = None
    product_image_capture_hook_reached: bool = False
    # The cdp_endpoint the SESSION received in its constructor.
    # Distinct from `cdp_endpoint_used` (where attach actually went).
    product_image_session_received_cdp_endpoint: str | None = None

    # ---- v2.4.4/v2.4.5 CDP / browser session diagnostic (additive) ----
    # When the operator runs a CDP-attached browser separately and
    # the pipeline subprocess fails to attach, the warm capture path
    # silently falls back to a fresh launch. That's exactly what
    # produced the "image_url=null but warm path expected" bug. These
    # fields surface what session the connector actually used so the
    # operator can confirm CDP attach succeeded before debugging the
    # capture logic itself.
    #
    # v2.4.5 — `requested_cdp_endpoint` is what the connector was
    # constructed with (its `__init__` arg). `connector_received_cdp_endpoint`
    # mirrors `requested_cdp_endpoint` and exists so layered logs
    # ("manifest had X, connector got X") read symmetrically. They
    # SHOULD match; when they differ, the connector mutated the value
    # internally.
    requested_cdp_endpoint: str | None = None
    connector_received_cdp_endpoint: str | None = None
    cdp_endpoint_used: str | None = None
    connected_via_cdp: bool = False
    browser_user_agent: str | None = None

    # ---- Lazy-load trigger telemetry (added 2026-05-01) ----
    # Captures whether the connector's cascade in
    # `_trigger_review_list_api` actually executed each fallback step.
    # Used by `evaluate_quality_gates` AND `collection_batch.py`'s
    # status mapper to recognize the
    # "review-meta-yes / review-list-no" condition and emit a clear
    # status code instead of `unknown_failure`.
    review_more_button_clicked: bool = False
    scrolled_to_review_area: bool = False

    # ---- Goods-number filter telemetry (added 2026-05-01) ----
    # 기획 set / multi-option OY products return reviews from multiple
    # sub-product goodsNumbers in a single cursor response. The
    # parser filters those — these counters surface the filter
    # rate so the operator can recognize "the API fired and
    # returned reviews, but they belonged to OTHER goodsNumbers".
    # Sum invariant:
    #   raw_records_seen_total_before_filter ==
    #     rows_kept_after_goods_no_filter +
    #     rows_filtered_by_goods_no +
    #     rows_dropped_unparseable
    raw_records_seen_total_before_filter: int = 0
    rows_kept_after_goods_no_filter: int = 0
    rows_filtered_by_goods_no: int = 0
    rows_dropped_unparseable: int = 0

    # ---- Early-failure telemetry (added 2026-05-01) ----
    # `cdp_attach_failed` and `page_open_failed` distinguish two early
    # failure modes that previously both surfaced as `unknown_failure`
    # in batch summaries. They are populated by the ingest CLI's
    # exception-translator: when `connector.collect()` raises before any
    # body was parsed, the CLI inspects the exception text and sets the
    # appropriate flag, then emits a synthetic JSON summary so the
    # batch driver's `_build_product_result` can route to the right
    # status. The corresponding `*_error` fields hold the verbatim
    # exception string for operator inspection.
    cdp_attach_failed: bool = False
    cdp_attach_error: str | None = None
    page_open_failed: bool = False
    page_open_error: str | None = None

    # ---- Pipeline-level (set by Phase1Pipeline AFTER the connector returns) ----
    pipeline_normalize_rejections: int = 0


def evaluate_quality_gates(summary: ConnectorRunSummary) -> QualityStatus:
    """Classify a run using ONLY connector-level counters.

    Pipeline-level rejections are observability-only and do not affect the gate.

    PR-1 addition: incomplete_collection (hasNext=True on last parsed body but
    pagination terminated below quota for non-error reasons) → "degraded".
    Strictly additive — only triggers a status downgrade when the connector
    explicitly sets the flag, which requires the new telemetry path.

    PR-2 addition: auth_retry_attempts_used > 0 (recovery happened, even if it
    was fully successful) → "degraded". This guarantees the operator notices a
    hiccup that the legacy gate would have lumped into "ok". Note that an
    auth_error that the retry FAILED to recover keeps `summary.auth_error=True`
    and short-circuits via the legacy "invalid" path; this branch only fires
    when retry recovered successfully (auth_error=False on exit).
    """
    if summary.blocked or summary.auth_error:
        return "invalid"

    parse_yield = summary.records_parsed / max(summary.raw_records_seen, 1)
    if parse_yield < 0.5:
        return "invalid"

    parse_warning_ratio = summary.parse_warnings / max(summary.records_parsed, 1)
    if parse_warning_ratio > 0.1:
        return "degraded"
    if parse_yield < 0.8:
        return "degraded"

    if summary.incomplete_collection:
        return "degraded"

    if summary.auth_retry_attempts_used > 0:
        return "degraded"

    return "ok"
