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

parse_yield denominator note (added 2026-05-08, fix for
I-PARSE-YIELD-GATE-CONTAMINATION): the denominator subtracts
`rows_filtered_by_goods_no` from `raw_records_seen` so 기획-set / multi-option
OY pages whose API returns heavy cross-product contamination are not
penalized as if the parser had failed. The connector's `goods_no` filter is
deliberate, not a parse failure. When `rows_filtered_by_goods_no == 0` (the
canonical pre-기획 case) the denominator collapses back to `raw_records_seen`
and the gate's verdict is byte-identical to the legacy rule. True parser
failures (records arriving on the right goodsNumber but the per-record
parser rejecting them — counted into `rows_dropped_unparseable` /
`records_parsed` shortfall WITHOUT being attributed to the goods_no filter)
still trip parse_yield < 0.5 → invalid, because the dropped count remains in
the effective denominator.

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

    # ---- I-OY-CURSOR-API-RATE-LIMIT-HANDLING (additive) ----
    # True iff the connector observed at least one cursor API rate-limit
    # event during the run. The two trip conditions:
    #   1. Response with status=429 on a URL containing
    #      `/review/api/v2/reviews/cursor`.
    #   2. `requestfailed` event with `failure.errorText="net::ERR_FAILED"`
    #      on the same URL substring (CORS-blocked 429 surfaces here on
    #      Chromium because the browser drops the response before
    #      `page.on("response")` fires).
    # Distinct from `http_429_seen` (which is also set on path #1 only —
    # path #2 cannot observe an HTTP status because the response was
    # CORS-blocked). When this flag is True, the connector clean-stops
    # the sort instead of entering the reload-first / page-recreate
    # recovery cascade — those branches reset page state and burn more
    # cursor requests, which on a deep-corpus product (~27k reviews,
    # Ilso A000000225736) compounds the throttle into a wedge that the
    # cascade misclassifies as `sort_control_unreachable`.
    # NOT routed through the auth-wall or human-check classifier paths.
    cursor_api_rate_limited: bool = False

    # ---- I-OY-CURSOR-RATE-LIMIT-PACING-POLICY (additive) ----
    # Pacing + bounded cooldown/retry telemetry. All counters are
    # cumulative across the run. Defaults are zero / False so legacy
    # callers (and pre-patch serialized summaries) deserialize unchanged.
    #   `cursor_pacing_sleeps_count` — number of per-cycle pacing sleeps
    #     executed in the cursor continuation loop. 0 when pacing is
    #     disabled (`OY_CURSOR_PACING_MS=0` or `cursor_pacing_ms=0`).
    #   `cursor_rate_limit_cooldowns_count` — number of times the
    #     bounded post-429 cooldown sleep ran. 0 when cooldown is
    #     disabled (default), 1 when the run hit a single 429 and the
    #     operator opted in.
    #   `cursor_rate_limit_retries_count` — number of post-429 retry
    #     attempts that re-entered the scroll loop. Bounded by
    #     `OY_CURSOR_RATE_LIMIT_MAX_RETRIES` (default 0, hard cap 2).
    #   `cursor_rate_limit_exhausted` — True iff the connector exhausted
    #     its bounded retry budget AND the cursor API was still 429.
    #     Distinct from `cursor_api_rate_limited` (which is True whenever
    #     429 was observed even once, regardless of retry outcome).
    cursor_pacing_sleeps_count: int = 0
    cursor_rate_limit_cooldowns_count: int = 0
    cursor_rate_limit_retries_count: int = 0
    cursor_rate_limit_exhausted: bool = False

    # ---- I-OY-CURSOR-API-SILENCED-RETRY-INTENT (additive) ----
    # True iff a cold-start timeout fired AFTER the lazy-load review
    # ‘more’ button click had succeeded, the sort area was healthy
    # (`sort_control_unreachable=False`), and the page issued ZERO
    # cursor API requests AND received ZERO cursor API responses —
    # i.e., the click landed but the underlying XHR was suppressed
    # before a single body was emitted. Computed by
    # ``derive_retry_intent()`` from existing connector fields; no
    # connector code path stamps this directly. Used by the retry
    # classifier to mark this failure shape as wall-clock-recoverable
    # (`retry_after_cooldown`) and by `_derive_resume_state` to render
    # an operator hint that distinguishes silenced-cursor from the
    # explicit cursor-429 path.
    #
    # The AND-gate is conservative — a false positive would re-classify
    # a genuine anti-bot block as retryable, masking real auth
    # failures. See `derive_retry_intent` docstring for the exact
    # predicate.
    cursor_api_silenced: bool = False

    # ---- I-OY-RETRY-INTENT-SUMMARY-FIELDS (Step 1 of multi-session resume) ----
    # Operator-facing hint for whether and when to re-run a halted collection.
    # ADDITIVE ONLY — no classifier or call site populates these in this
    # ticket; both fields stay at their defaults until I-B wires
    # `classify_status` to derive them from existing rate-limit / auth-wall
    # signals. Pre-patch JSON summaries (without these keys) deserialize
    # cleanly into the new schema at the documented defaults.
    #
    # `retry_intent` — string for forward compatibility (more intents may be
    # added later); by-convention allowed values:
    #   "none"                   — Clean exits and non-retryable terminal
    #                              states (complete, duplicate_only,
    #                              authenticated_ok, true max_cap_reached,
    #                              DOM-shape failures like
    #                              sort_control_unreachable /
    #                              cdp_attach_failed / page_open_failed —
    #                              these are NOT time-spacing-recoverable).
    #   "retry_after_cooldown"   — Cursor-rate-limited: wall-clock spacing
    #                              between sessions is expected to recover
    #                              coverage. Companion field
    #                              `retry_after_minutes` carries an
    #                              operator-confidence cadence hint.
    #   "manual_review_required" — Auth-wall / human-check / 403: operator
    #                              must re-authenticate (or clear CAPTCHA)
    #                              before any retry can help. No cadence
    #                              hint is meaningful here.
    # Strings other than the three above are tolerated by Pydantic for
    # forward compatibility, but readers SHOULD treat unknown values as
    # equivalent to "none" until the taxonomy is extended.
    #
    # `retry_after_minutes` — operator-confidence cadence hint, NOT a
    # contract. Only meaningful when `retry_intent == "retry_after_cooldown"`;
    # otherwise None. No connector or batch-driver code path performs an
    # auto-retry based on this value — the multi-session resume policy
    # (I-OY-RATE-LIMITED-MULTI-SESSION-RESUME-POLICY-PLAN §1) explicitly
    # forbids auto-retry; the field exists to populate operator dashboards
    # and the next-pass scheduling surface in I-C.
    retry_intent: str = "none"
    retry_after_minutes: int | None = None

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
    # True iff `_click_sort_button_robust` exhausted its hunt deadline
    # without locating the target sort-tab label, after the widening
    # probe (scroll-into-view + scope-limited disclosure-affordance
    # click). Distinct from `false_empty_state_detected` — this signals
    # OY's PDP review-sort row did not render the requested rating tab
    # (a UI-shape signal, NOT an anti-bot signal). Routed by
    # `collection_batch.classify_status` to the terminal status
    # `sort_control_unreachable`, which `collection_summary.py` then
    # promotes to `sort_control_failure_by_sort: true` without flipping
    # `auth_evidence_by_sort` or `anti_bot_or_blocked_by_sort`.
    sort_control_unreachable: bool = False

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

    # ---- I-OY-SCROLL-CONTINUATION-IMPL telemetry (additive) ----
    # When the per-page scroll budget is exhausted but the server still
    # signals `hasNext=True`, the connector now optionally invokes a
    # bounded number of `reload_and_reopen_review_tab` recreates and
    # re-enters the continuation loop. The fields below surface that
    # behavior so collection_summary.json + downstream audits can
    # distinguish three previously-conflated outcomes:
    #
    #   (a) `pagination_exhausted=True`  — the server returned hasNext=False,
    #       i.e. the run reached the natural end of the corpus.
    #   (b) `incomplete_collection=True` AND
    #       `scroll_continuation_terminated_with_has_next=True` — the run
    #       gave up while the server still had more rows AND the recovery
    #       budget was exhausted (or recovery was disabled).
    #   (c) `incomplete_collection=False` AND `last_observed_has_next=True`
    #       — the operator-set quota actually fired (true max_cap_reached).
    #
    # All four fields default to safe values so pre-patch summaries
    # deserialize unchanged. Quality-gate decisions for canonical runs are
    # byte-identical to the pre-patch rule (the gate already reads
    # `incomplete_collection`; the new fields are observation-only).
    scroll_continuation_recovery_attempts: int = 0
    scroll_continuation_recovery_recovered: bool = False
    scroll_continuation_terminated_with_has_next: bool = False
    # `cursor_depth_at_termination` mirrors `len(cursor_sequence)` at
    # end-of-run so operators can see depth-vs-time tradeoff without
    # walking the (potentially long) cursor list.
    cursor_depth_at_termination: int = 0
    # Connector-construction values, surfaced for audit. Pre-patch
    # callers had to derive these from the manifest; the connector now
    # emits them so the per-run summary is self-describing.
    max_scroll_attempts_per_page: int = 0
    max_scroll_recovery_recreates: int = 0

    # ---- Pipeline-level (set by Phase1Pipeline AFTER the connector returns) ----
    pipeline_normalize_rejections: int = 0

    # ------------------------------------------------------------------
    # I-OY-RETRY-INTENT-CLASSIFICATION-WIRING (Step I-B of multi-session resume)
    # ------------------------------------------------------------------
    def derive_retry_intent(self) -> "ConnectorRunSummary":
        """Populate ``retry_intent`` + ``retry_after_minutes`` from the
        rate-limit / auth-wall signals already on the summary.

        Operator-defined classification (resume-policy plan §5):

          1. ``cursor_api_rate_limited == True``  →
             ``retry_intent="retry_after_cooldown"``,
             ``retry_after_minutes=90``.
             Wall-clock spacing between sessions is expected to recover
             coverage (Ilso-class default cadence per plan §6; general
             OY SKUs may eventually want 60 — kept uniform at 90 here
             because the only live evidence we have is from Ilso and a
             higher cadence is the safer default).

          2. ELSE IF any auth-wall / human-check / hard-block signal is
             True →
             ``retry_intent="manual_review_required"``,
             ``retry_after_minutes=None``.
             Trip conditions (OR):
               - ``auth_error``
               - ``mid_stream_auth_break``
               - ``http_403_seen``
               - ``human_check_detected and not human_check_recovered``
             ``human_check_detected and human_check_recovered`` is NOT a
             trip condition: recovery succeeded, no operator action
             needed.

          3. ELSE IF the cursor-silenced cold-start AND-gate holds
             (I-OY-CURSOR-API-SILENCED-RETRY-INTENT) →
             ``retry_intent="retry_after_cooldown"``,
             ``retry_after_minutes=90``,
             and ``cursor_api_silenced=True`` is stamped on the
             summary. The AND-gate (all required) is:
               - ``cold_start_timed_out``  (run gave up at cold-start)
               - ``review_more_button_clicked``  (lazy-load click DID land —
                 distinguishes this from generic cold-start failures
                 where the click never fired)
               - NOT ``sort_control_unreachable``  (sort area was healthy,
                 i.e., the failure is on the XHR side, not the DOM side)
               - ``review_api_request_count == 0``  (page never even
                 issued a single cursor request)
               - ``review_api_response_count == 0``  (and never got a
                 single response back)
             Rule 1 already short-circuits cursor-429 ahead of this
             branch; rule 2 short-circuits auth-wall ahead. So the
             AND-gate cannot fire concurrently with either of those —
             the precedence is enforced structurally by the if/elif
             ordering below.

          4. ELSE →
             ``retry_intent="none"``, ``retry_after_minutes=None``.

        Rule 5 (precedence): cursor-API 429 wins over auth-wall when
        both are present; cursor-API 429 also wins over the silenced
        AND-gate (a positive rate-limit signal is the stronger
        evidence). Auth-wall wins over silenced — if any auth-wall
        signal is present, that is the canonical operator action even
        if the silenced AND-gate would also have held.

        Rule 6 (out of scope): ``final_status`` classification is NOT
        modified by this method. ``retry_intent`` is an additive
        operator-facing column that lives alongside ``final_status``,
        never replaces it. The silenced AND-gate adds a third retry
        intent SHAPE but does not introduce a new ``final_status``
        value — the canonical anti-bot/cold-start ``final_status`` is
        preserved.

        Idempotency: re-invoking the method on the same instance
        produces the same result (the method reads the flag fields,
        which are not mutated here; it writes ``retry_intent`` and
        ``retry_after_minutes`` deterministically from those flags).

        Default-construction invariant (I-A): a summary whose
        rate-limit / auth-wall flags are all at their defaults stays
        at ``retry_intent="none"`` / ``retry_after_minutes=None`` —
        which is exactly what the defaults already say. Pre-existing
        tests that construct a summary directly (without calling this
        method) see no change to the retry_intent fields.

        Returns ``self`` so callers may chain
        ``summary.derive_retry_intent()`` at the end of ``collect()``
        without an extra statement.
        """
        # Auth-wall / human-check / hard-block predicate, shared between
        # Rule 2 below and the silenced AND-gate. ``human_check_recovered``
        # is the load-bearing distinction: True means the operator's
        # CAPTCHA wait cleared the page and the session continued; False
        # paired with ``human_check_detected`` means the wait timed out
        # and the operator must intervene.
        manual_review_required = (
            self.auth_error
            or self.mid_stream_auth_break
            or self.http_403_seen
            or (self.human_check_detected and not self.human_check_recovered)
        )

        # Silenced cold-start AND-gate. Computed once up-front so the
        # field is always set deterministically from the current input
        # flags (idempotent: a re-invocation with the same flags writes
        # the same value). The gate REQUIRES:
        #   - cold-start timed out
        #   - lazy-load 'more' click actually landed
        #   - sort area healthy (not a DOM-shape failure)
        #   - ZERO cursor API requests AND ZERO cursor API responses
        #   - no positive auth-wall signal (reused predicate above)
        #   - no observed cursor 429 (rate-limited has its own branch)
        # The auth/rate-limit clauses keep the field FALSE on runs that
        # actually have a higher-precedence shape; the operator hint
        # in `_derive_resume_state` then reads only one canonical
        # discriminator per run.
        self.cursor_api_silenced = (
            self.cold_start_timed_out
            and self.review_more_button_clicked
            and not self.sort_control_unreachable
            and self.review_api_request_count == 0
            and self.review_api_response_count == 0
            and not manual_review_required
            and not self.cursor_api_rate_limited
        )

        # Rule 1: cursor 429 path — precedence over auth-wall and over
        # the silenced AND-gate (rule 5).
        if self.cursor_api_rate_limited:
            self.retry_intent = "retry_after_cooldown"
            self.retry_after_minutes = 90
            return self

        # Rule 2: auth-wall / human-check / hard-block.
        if manual_review_required:
            self.retry_intent = "manual_review_required"
            self.retry_after_minutes = None
            return self

        # Rule 3: silenced cold-start. The AND-gate above already
        # excluded rate-limited and auth-wall, so reaching this branch
        # with cursor_api_silenced=True means the run was a pure
        # silenced-cursor cold-start. A false positive here would
        # re-classify a real anti-bot block as retryable, so each
        # clause of the gate is required.
        if self.cursor_api_silenced:
            self.retry_intent = "retry_after_cooldown"
            self.retry_after_minutes = 90
            return self

        # Rule 4: clean exit / non-retryable terminal / nothing to do.
        self.retry_intent = "none"
        self.retry_after_minutes = None
        return self


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

    # Subtract goodsNo-filtered rows (cross-product contamination the
    # connector deliberately drops on 기획 / multi-option OY pages) from
    # the parse_yield denominator. When `rows_filtered_by_goods_no == 0`
    # the effective denominator collapses back to `raw_records_seen` and
    # the gate's verdict is byte-identical to the legacy rule. See
    # ops/agent_handoffs/I-PARSE-YIELD-GATE-CONTAMINATION.md.
    effective_raw = max(
        summary.raw_records_seen - summary.rows_filtered_by_goods_no, 1,
    )
    parse_yield = summary.records_parsed / effective_raw
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
