"""Diagnose `anonymous_auth_wall` failures and produce structured
artifacts an operator can act on.

Background
----------
Run-003 pass-6 live retry confirmed the retry framework runs cleanly
(initial 2 attempts + 1 deferred recovery = 3 total) but couldn't
distinguish *why* the auth wall fired. Both RATING_ASC and
RECOMMENDED_DESC failed identically with `raw_records_seen=0`; the
operator could not tell whether it was a login break, an API block,
a sort-button mismatch, or a false-empty render.

This module is the diagnostic layer that sits ABOVE the connector
and BELOW the orchestrator. For each failed attempt:

  1. Read the connector's per-attempt `prod_summary`.
  2. Apply a 6-state subreason classifier on the available signals.
  3. Emit a `diagnostic_summary.json` with all the spec keys
     (some may be null when the connector hasn't captured them yet —
     additive contract; the dict is open to future fields).

Hard rules
----------
- Pure: no I/O outside `write_diagnostic_artifact`. No browser hooks.
- Connector-agnostic: the classifier reads only fields the connector
  already populates today. New connector fields (current_url,
  document.title, screenshot path) are scaffolded as nullable so
  they flow through automatically once the connector emits them.
- Subreason classification is conservative — when signals don't
  point to a specific subreason, returns `anonymous_auth_wall_unknown`
  and the operator is told to inspect manually.
"""
from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


# ---------------------------------------------------------------------------
# Subreason taxonomy
# ---------------------------------------------------------------------------
#
# Distinct subreasons require distinct recovery actions. A single
# "anonymous_auth_wall" lumps them all together — pass-7 splits.

AUTH_WALL_LOGIN_REQUIRED: str = "anonymous_auth_wall_login_required"
"""HTTP 401 / login_required marker observed. Operator must re-login
in the CDP browser before retry."""

AUTH_WALL_API_BLOCKED: str = "anonymous_auth_wall_api_blocked"
"""Operator is logged in BUT the review-list API returned 401/403/429
or a block payload. Auth-bot / rate-limit; needs longer cooldown."""

AUTH_WALL_NO_REVIEW_API: str = "anonymous_auth_wall_no_review_api"
"""Review tab / sort button visible but the review-list API never
fires. The page state diverged from the click handler — usually a
DOM-state retry helps."""

AUTH_WALL_FALSE_EMPTY: str = "anonymous_auth_wall_false_empty"
"""Review-count badge or meta API present but the list rendered
empty. Connector retry logic sometimes recovers this; operator
visibility helps."""

SORT_SELECTOR_FAILED: str = "sort_selector_failed"
"""Sort button label mismatch — couldn't find the requested label,
clicked a different one, or the label list was empty."""

TARGET_GOODS_FILTER_EMPTY: str = "target_goods_filter_empty"
"""Review list responded but every record was filtered out for the
target goodsNo (cross-product API result). Usually a connector
state-leak issue."""

AUTH_WALL_UNKNOWN: str = "anonymous_auth_wall_unknown"
"""Fallback when the available signals don't point to one of the
specific subreasons. Operator must inspect the diagnostic_summary
artifact manually."""


# ---------------------------------------------------------------------------
# Pass-19E: sort-control failure subreasons (NO auth evidence)
# ---------------------------------------------------------------------------
#
# These reasons describe failures that look superficially like an
# auth-wall (zero rows, false-empty marker) but lack any of the hard
# auth signals (401/403/429/captcha/login_required/logged_out). They
# are sort-CONTROL failures — the page is reachable, the user is
# authenticated, the review tab is visible, but the connector either
# couldn't find the target sort label, clicked it but the API didn't
# fire, or lost the review area between attempts.
#
# Operationally these need DOM/click recovery, not re-login or
# cooldown. Surfacing them as "anti-bot / auth-wall" misled operators
# in the top3 final-sample run.

SORT_CONTROL_NOT_REACHED: str = "sort_control_not_reached"
"""Sort target label was not visible inside the review-area sort
container. Either the connector's sort-button discovery picked up
non-review buttons (page-level), or the review section was not
scrolled into view at click time."""

REVIEW_SORT_API_NOT_TRIGGERED: str = "review_sort_api_not_triggered"
"""Sort label was clicked (or click was attempted) but no new
review-list XHR fired afterwards. The selected sort may have been
already-active; the click was a no-op."""

REVIEW_AREA_LOST_AFTER_SORT_CLICK: str = "review_area_lost_after_sort_click"
"""Sort click altered the page state away from the review section
(e.g. navigated to a different tab or anchor). No review API was
captured because the connector left the review DOM."""

NO_REVIEW_API_AFTER_SORT_CLICK: str = "no_review_api_after_sort_click"
"""Click occurred, the review area is still focused, but the API
never came in within the wait window. Often transient; differs from
REVIEW_SORT_API_NOT_TRIGGERED in that the click definitely was the
sort target."""

DEFAULT_SORT_RESPONSE_REUSED: str = "default_sort_response_reused"
"""Target sort matches the page's default selected sort, and a peer
attempt's review-tab wake-up captured at least one response with
this sortType for the target goodsNo. The data is already on disk;
classifying this as failure was wrong. Promoted to success."""

ALREADY_SELECTED_SORT_REUSED: str = "already_selected_sort_reused"
"""Target sort is currently selected when this attempt starts; no
new click is needed and the in-flight tab response carries the
target sort. Promoted to success."""


# Recovery hint per subreason. Surfaced in the inspector output and
# the per-sort summary so the operator knows what to try next without
# re-reading the docs.
NEXT_ACTION_HINT: dict[str, str] = {
    AUTH_WALL_LOGIN_REQUIRED: (
        "CDP 브라우저에서 OliveYoung 로그인 상태를 확인 후 재실행하세요."
    ),
    AUTH_WALL_API_BLOCKED: (
        "쿨다운 후 재시도하세요. --auth-wall-recovery-mode patient "
        "(120-180s backoff) 권장."
    ),
    AUTH_WALL_NO_REVIEW_API: (
        "리뷰 탭 재-wake가 필요합니다. --manual-auth-wall-recovery로 "
        "사람이 리뷰 탭을 직접 클릭한 뒤 재개하세요."
    ),
    AUTH_WALL_FALSE_EMPTY: (
        "false-empty render이므로 페이지를 새로 고침한 뒤 재시도. "
        "patient mode + 1회 추가 시도가 효과적입니다."
    ),
    SORT_SELECTOR_FAILED: (
        "available_sort_button_labels를 진단 artifact에서 확인하고, "
        "label mismatch가 있으면 connector의 sort label 매핑을 점검하세요."
    ),
    TARGET_GOODS_FILTER_EMPTY: (
        "review_list_reviews_for_target_goods_no=0인 경우 connector의 "
        "goodsNo 필터 / page reset 경로를 검증하세요."
    ),
    AUTH_WALL_UNKNOWN: (
        "diagnostic_summary.json을 열고 review_meta/list API, login_state, "
        "available_sort_button_labels를 직접 확인하세요."
    ),
    # Pass-19E sort-control failure hints (no auth evidence).
    SORT_CONTROL_NOT_REACHED: (
        "리뷰 영역으로 스크롤한 뒤 리뷰 정렬 컨테이너 안에서만 "
        "버튼을 탐색하도록 connector를 점검하세요. 현재는 페이지 "
        "전역 버튼이 후보로 잡히고 있을 가능성이 큽니다."
    ),
    REVIEW_SORT_API_NOT_TRIGGERED: (
        "이미 선택된 정렬일 가능성이 큽니다. default sort response의 "
        "sortType/goodsNo가 target과 일치하면 재사용 처리하세요."
    ),
    REVIEW_AREA_LOST_AFTER_SORT_CLICK: (
        "정렬 클릭 후 리뷰 영역을 벗어났습니다. 리뷰 컨테이너 안에서만 "
        "정렬 버튼을 클릭하도록 selector를 좁혀주세요."
    ),
    NO_REVIEW_API_AFTER_SORT_CLICK: (
        "정렬 클릭은 발생했으나 review API가 늦게 오거나 누락됐습니다. "
        "wait window를 연장하고 한번 더 클릭하는 recovery flow가 효과적입니다."
    ),
    DEFAULT_SORT_RESPONSE_REUSED: (
        "기본 정렬이 이미 target과 일치합니다. 추가 클릭 없이 default "
        "response를 재사용하므로 별도 조치 불필요."
    ),
    ALREADY_SELECTED_SORT_REUSED: (
        "이미 활성화된 정렬을 그대로 사용했습니다. 별도 조치 불필요."
    ),
}


# ---------------------------------------------------------------------------
# Sort label mapping (UI Korean ↔ API sortType)
# ---------------------------------------------------------------------------
#
# Authoritative mapping between OliveYoung review-tab UI labels and
# the API's sortType enum. Diagnostic artifacts reference this so an
# operator can spot label/enum drift without re-reading connector
# code. If OY ever rewords the UI ("도움순" → "추천순" etc.), updating
# this map is the single line of code that needs to change.

SORT_TYPE_KO_LABELS: dict[str, str] = {
    "DATETIME_DESC": "최신순",
    "RATING_ASC": "평점 낮은순",
    "RATING_DESC": "평점 높은순",
    "USEFUL_SCORE_DESC": "유용한 순",
    "RECOMMENDED_DESC": "도움순",
}

# Legacy / synonym labels operators or older OY UI may produce.
# Used only by the diagnostic to recognize that a captured label
# corresponds to a known sort type even if the canonical form drifts.
SORT_TYPE_KO_LABEL_ALIASES: dict[str, str] = {
    "유용한순": "USEFUL_SCORE_DESC",
    "도움 순": "RECOMMENDED_DESC",
    "최신 순": "DATETIME_DESC",
    "별점 낮은순": "RATING_ASC",
    "별점 높은순": "RATING_DESC",
}


def ko_label_for_sort_type(sort_type: str | None) -> str | None:
    """Look up the canonical Korean UI label for a sortType. Returns
    None when sort_type is unknown or not yet mapped."""
    if not sort_type:
        return None
    return SORT_TYPE_KO_LABELS.get(sort_type)


def sort_type_for_ko_label(label: str | None) -> str | None:
    """Reverse lookup. Accepts canonical labels and known aliases.
    Returns the API sortType enum or None."""
    if not label:
        return None
    label_clean = label.strip()
    for st, ko in SORT_TYPE_KO_LABELS.items():
        if ko == label_clean:
            return st
    return SORT_TYPE_KO_LABEL_ALIASES.get(label_clean)


# Subreason groups for inspect-side messaging. The inspector buckets
# per-sort failures by these groups to print the right Korean text:
#
#   AUTH_EVIDENCE_SUBREASONS    "anti-bot / auth-wall" (the hard cases)
#   SORT_CONTROL_SUBREASONS     "정렬 전환 실패"
#   API_NOT_FIRED_SUBREASONS    "리뷰 API 미발화"
#   REUSE_SUBREASONS            promoted to success — operator informational

AUTH_EVIDENCE_SUBREASONS: frozenset[str] = frozenset({
    AUTH_WALL_LOGIN_REQUIRED,
    AUTH_WALL_API_BLOCKED,
})

SORT_CONTROL_SUBREASONS: frozenset[str] = frozenset({
    SORT_CONTROL_NOT_REACHED,
    SORT_SELECTOR_FAILED,
    REVIEW_AREA_LOST_AFTER_SORT_CLICK,
})

API_NOT_FIRED_SUBREASONS: frozenset[str] = frozenset({
    REVIEW_SORT_API_NOT_TRIGGERED,
    NO_REVIEW_API_AFTER_SORT_CLICK,
    AUTH_WALL_NO_REVIEW_API,
    AUTH_WALL_FALSE_EMPTY,
})

REUSE_SUBREASONS: frozenset[str] = frozenset({
    DEFAULT_SORT_RESPONSE_REUSED,
    ALREADY_SELECTED_SORT_REUSED,
})


# ---------------------------------------------------------------------------
# Classifier
# ---------------------------------------------------------------------------


def _coerce_bool(value: Any) -> bool:
    if value is None:
        return False
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return bool(value)
    if isinstance(value, str):
        return value.strip().lower() in ("true", "1", "yes", "y")
    return bool(value)


def has_auth_evidence(
    prod_summary: dict | None,
    *,
    error: str | None = None,
) -> bool:
    """Return True only when the connector observed HARD evidence of
    an auth-wall or anti-bot block: HTTP 401/403/429, captcha /
    human-check interstitial, explicit auth_error, or
    login_state_observed='logged_out'.

    "Soft" signals (false_empty_state_detected, zero API responses,
    empty available_sort_button_labels) do NOT count — those are
    sort-control failures the operator must fix differently.

    The top-3 final-sample run failures (USEFUL_SCORE_DESC,
    RECOMMENDED_DESC) had:
      logged_in + no 401/403/429/captcha + review tab visible +
      api_response_count=0 + false_empty_state_detected=True.
    Those must NOT count as auth evidence — they are
    `sort_control_*` / `review_sort_api_*` reasons.
    """
    ps: dict = prod_summary or {}
    if _coerce_bool(ps.get("http_401_or_login_required_seen")):
        return True
    if _coerce_bool(ps.get("http_403_seen")):
        return True
    if _coerce_bool(ps.get("http_429_seen")):
        return True
    if _coerce_bool(ps.get("auth_error")):
        return True
    if _coerce_bool(ps.get("human_check_detected")):
        return True
    if _coerce_bool(ps.get("interstitial_detected")):
        return True
    if ps.get("login_state_observed") == "logged_out":
        return True
    if isinstance(error, str):
        e = error.lower()
        if "login_required" in e or "401" in e or "auth_error" in e:
            return True
        if "403" in e or "429" in e:
            return True
        if "captcha" in e or "human_check" in e:
            return True
    return False


def _peer_observed_target_sort(
    *,
    sort_type: str,
    peer_summaries: list[dict] | None,
    target_goods_no: str | None,
) -> bool:
    """Pass-19E (B): True if any peer per-sort summary captured at
    least one review-list response with `post_data_sort_type ==
    sort_type`. Used to detect default-sort response reuse:
    USEFUL_SCORE_DESC may be the OY default selected sort, so it
    fires during a different attempt's review-tab wake-up; the data
    is on disk under that other attempt's insertion.

    `target_goods_no` is consulted only when the peer summary
    explicitly carries a goodsNo. Within one product run all peer
    summaries share the same goodsNo, so missing goodsNo on a peer
    summary is treated as "matches" by default.
    """
    if not peer_summaries:
        return False
    for peer in peer_summaries:
        if not isinstance(peer, dict):
            continue
        peer_ps = peer.get("prod_summary") or {}
        if not isinstance(peer_ps, dict):
            continue
        observed = peer_ps.get("observed_sort_types") or {}
        if not isinstance(observed, dict):
            continue
        try:
            count = int(observed.get(sort_type) or 0)
        except (TypeError, ValueError):
            count = 0
        if count <= 0:
            continue
        # goodsNo guard, when available.
        peer_goods = peer_ps.get("goodsNo") or peer.get("goodsNo")
        if target_goods_no and peer_goods and peer_goods != target_goods_no:
            continue
        return True
    return False


def classify_auth_wall_subreason(
    *,
    sort_type: str,
    prod_summary: dict | None,
    error: str | None = None,
    peer_summaries: list[dict] | None = None,
    target_goods_no: str | None = None,
) -> str:
    """Classify one failed-attempt outcome into a subreason.

    Inputs
    ------
    `prod_summary` is the connector's per-product `ConnectorRunSummary`-
    shape dict that `run_phase2e_pipeline.py:_run_one_sort_attempt`
    forwards under the `prod_summary` key. We read only fields the
    connector already populates so the classifier doesn't introduce
    a tight coupling to in-flight connector work.

    `peer_summaries` is an optional list of OTHER per-sort summaries
    from the same product run. When provided, the classifier checks
    whether peers captured a response with the target sort_type — if
    so, this attempt is reclassified as
    DEFAULT_SORT_RESPONSE_REUSED (success). Pass it empty / None to
    suppress the reuse check (the legacy single-attempt path).

    Returns the subreason string. Never raises.

    Pass-19E split:
      AUTH-EVIDENCE branch (401/403/429/captcha/login_required/
      logged_out) → AUTH_WALL_*. Operator must re-login or cool down.

      NO-AUTH-EVIDENCE branch → SORT_CONTROL_NOT_REACHED /
      REVIEW_SORT_API_NOT_TRIGGERED / NO_REVIEW_API_AFTER_SORT_CLICK
      / DEFAULT_SORT_RESPONSE_REUSED. Operator must fix
      connector-side click / scroll / wait logic.
    """
    ps: dict = prod_summary or {}

    # ----- Pass-19E (B): default-sort response reuse promotion ------
    # If a peer attempt captured a response with this sort_type for
    # the target goodsNo, the data is already on disk and this
    # attempt's "blocked_or_empty_state" is a false negative. Promote
    # to a success-reuse subreason ahead of all failure branches so
    # downstream summary code can move it from `sorts_failed` to
    # `sorts_succeeded`.
    if _peer_observed_target_sort(
        sort_type=sort_type,
        peer_summaries=peer_summaries,
        target_goods_no=target_goods_no,
    ):
        return DEFAULT_SORT_RESPONSE_REUSED

    # ----- AUTH-EVIDENCE branch -------------------------------------
    auth = has_auth_evidence(ps, error=error)

    if auth:
        # 401 / login_required wins over 403 / 429 because the operator
        # action differs (re-login vs. cooldown).
        if (
            _coerce_bool(ps.get("http_401_or_login_required_seen"))
            or _coerce_bool(ps.get("auth_error"))
            or (isinstance(error, str) and (
                "login_required" in error.lower()
                or "401" in error
                or "auth_error" in error.lower()
            ))
        ):
            return AUTH_WALL_LOGIN_REQUIRED
        if (
            _coerce_bool(ps.get("http_403_seen"))
            or _coerce_bool(ps.get("http_429_seen"))
        ):
            return AUTH_WALL_API_BLOCKED
        # captcha / interstitial / logged_out — still auth-evidence,
        # so use the API-blocked recovery (cooldown) hint as the
        # closest match. AUTH_WALL_UNKNOWN would lose the operator
        # the cooldown context.
        return AUTH_WALL_API_BLOCKED

    # ----- NO-AUTH-EVIDENCE branch (Pass-19E sort-control) -----------
    # From here on, the user is logged in and no 401/403/429/captcha
    # is observed. Failures are CONNECTOR-SIDE click / DOM problems.

    # Review list responded but everything was filtered for goodsNo.
    # This is connector-side state-leak — keep the existing reason.
    target_filter = ps.get("review_list_reviews_for_target_goods_no")
    response_count_for_filter = (
        ps.get("review_api_response_count")
        or ps.get("review_list_api_response_count")
        or 0
    )
    if target_filter is not None and response_count_for_filter > 0 and int(
        target_filter or 0,
    ) == 0:
        return TARGET_GOODS_FILTER_EMPTY

    # Sort-button selector failed: either no labels at all, or the
    # connector explicitly reported a label-not-found error. We
    # SPLIT this case into:
    #   SORT_CONTROL_NOT_REACHED — labels exist but target is missing
    #     from the review-area sample (the user's RECOMMENDED_DESC
    #     scenario where available_sort_buttons looked like the
    #     full page button list).
    #   SORT_SELECTOR_FAILED — labels fully empty (connector did not
    #     find the sort area at all).
    sort_labels = ps.get("available_sort_button_labels")
    target_label = ko_label_for_sort_type(sort_type)
    if isinstance(sort_labels, list) and not sort_labels:
        return SORT_SELECTOR_FAILED
    if (
        isinstance(sort_labels, list)
        and target_label is not None
        and target_label not in sort_labels
    ):
        # We have a label list but the target isn't in it — connector
        # likely sampled outside the review-sort container.
        return SORT_CONTROL_NOT_REACHED
    if isinstance(error, str) and (
        "sort_label_not_found" in error.lower()
        or "sort_button_missing" in error.lower()
    ):
        return SORT_CONTROL_NOT_REACHED

    # The clicked_target_sort signal (when emitted by the connector)
    # tells us whether a click actually happened. If yes but no API
    # came in → NO_REVIEW_API_AFTER_SORT_CLICK. If unclear / not
    # clicked → REVIEW_SORT_API_NOT_TRIGGERED.
    clicked = ps.get("clicked_target_sort")
    request_count = int(ps.get("review_api_request_count") or 0)
    response_count = int(ps.get("review_api_response_count") or 0)
    if clicked is True and response_count == 0:
        return NO_REVIEW_API_AFTER_SORT_CLICK
    if clicked is False:
        return REVIEW_SORT_API_NOT_TRIGGERED

    # Connector indicated review-area was lost mid-attempt.
    if _coerce_bool(ps.get("review_area_lost_after_sort_click")):
        return REVIEW_AREA_LOST_AFTER_SORT_CLICK

    # False-empty marker without auth evidence → API didn't fire for
    # the target sort. This is the user's USEFUL_SCORE_DESC failure
    # pattern (false_empty_state_detected=True, no auth signals).
    if _coerce_bool(ps.get("false_empty_state_detected")):
        return REVIEW_SORT_API_NOT_TRIGGERED

    if request_count == 0 and response_count == 0:
        return REVIEW_SORT_API_NOT_TRIGGERED

    # Fallback — operator must inspect manually.
    return AUTH_WALL_UNKNOWN


# ---------------------------------------------------------------------------
# Diagnostic-summary shape
# ---------------------------------------------------------------------------
#
# Required keys per pass-7 spec. Every key is present in the emitted
# JSON; missing values are explicit `null` so a downstream consumer
# can tell "this signal isn't observable yet" from "this signal was
# false". Future connector work fills in the nullable slots.

DIAGNOSTIC_KEYS: tuple[str, ...] = (
    # Page state (connector to populate when it captures DOM state)
    "current_url",
    "document_title",
    "login_state_observed",
    "review_tab_visible",
    "review_count_badge",
    "empty_review_marker_present",
    "available_sort_button_labels",
    "selected_sort_label",
    "selected_sort_type",
    # Network / API
    "review_meta_api_seen",
    "review_list_api_seen",
    "review_list_api_response_count",
    "review_list_reviews_seen_in_body",
    "review_list_reviews_for_target_goods_no",
    "http_401_or_login_required_seen",
    "http_403_seen",
    "http_429_seen",
    # Anti-bot / interstitial
    "human_check_detected",
    "interstitial_detected",
    "false_empty_state_detected",
    # Artifacts (paths relative to run_dir or absolute)
    "screenshot_path_before_sort_click",
    "screenshot_path_after_sort_click",
    "page_text_path_after_failure",
    "network_candidates_path",
    # Pass-19E sort-control diagnostics. Connector-emitted when
    # available; nullable so legacy connectors flow through. The
    # inspector surfaces these alongside the subreason.
    "review_area_visible",
    "sort_control_container_found",
    "target_sort_label",
    "target_sort_label_visible",
    "clicked_target_sort",
    "was_target_sort_already_selected",
    "review_api_wait_timeout_s",
    "review_api_response_count_after_click",
    "available_sort_labels_in_review_area",
    "available_buttons_global_sample",
    "review_area_lost_after_sort_click",
)


@dataclass
class DiagnosticArtifact:
    sort_type: str
    attempt_index: int
    subreason: str
    next_action_hint_ko: str
    diagnostic: dict
    artifact_path: Path | None = None

    def to_dict(self) -> dict:
        return {
            "sort_type": self.sort_type,
            "attempt_index": self.attempt_index,
            "subreason": self.subreason,
            "next_action_hint_ko": self.next_action_hint_ko,
            "generated_at": datetime.now(timezone.utc).strftime(
                "%Y-%m-%dT%H:%M:%SZ",
            ),
            "diagnostic": self.diagnostic,
        }


def build_diagnostic_summary(
    *,
    sort_type: str,
    attempt_index: int,
    sort_result: dict | None,
    extra_diagnostics: dict | None = None,
    peer_summaries: list[dict] | None = None,
    target_goods_no: str | None = None,
) -> DiagnosticArtifact:
    """Build a per-attempt diagnostic dict from the orchestrator's
    `_run_one_sort_attempt` result + optional explicit diagnostics
    (e.g. data captured by a manual-recovery operator step).

    `peer_summaries` enables Pass-19E (B) default-sort response
    reuse: when other per-sort attempts captured a response with
    this sort_type, the classifier promotes the subreason to
    `DEFAULT_SORT_RESPONSE_REUSED` (success).
    """
    res: dict = sort_result or {}
    ps: dict = res.get("prod_summary") or {}
    error = res.get("error")
    subreason = classify_auth_wall_subreason(
        sort_type=sort_type, prod_summary=ps, error=error,
        peer_summaries=peer_summaries,
        target_goods_no=target_goods_no,
    )
    diagnostic: dict[str, Any] = {key: None for key in DIAGNOSTIC_KEYS}

    # Map connector-known signals into the spec keys.
    diagnostic["http_401_or_login_required_seen"] = ps.get(
        "http_401_or_login_required_seen",
    )
    diagnostic["http_403_seen"] = ps.get("http_403_seen")
    diagnostic["http_429_seen"] = ps.get("http_429_seen")
    diagnostic["false_empty_state_detected"] = ps.get(
        "false_empty_state_detected",
    )
    diagnostic["human_check_detected"] = ps.get("human_check_detected")
    diagnostic["available_sort_button_labels"] = ps.get(
        "available_sort_button_labels",
    )
    diagnostic["selected_sort_type"] = ps.get("requested_sort_type") or sort_type
    diagnostic["review_list_api_response_count"] = ps.get(
        "review_api_response_count",
    )
    diagnostic["login_state_observed"] = ps.get("login_state_observed")

    # Pass-19E sort-control diagnostics. Pulled from connector keys
    # when present; left None when the connector hasn't emitted them
    # yet so the operator can spot at a glance which signals are
    # observable for this run.
    diagnostic["target_sort_label"] = ko_label_for_sort_type(sort_type)
    sort_labels = ps.get("available_sort_button_labels") or []
    if isinstance(sort_labels, list) and diagnostic["target_sort_label"]:
        diagnostic["target_sort_label_visible"] = (
            diagnostic["target_sort_label"] in sort_labels
        )
    for connector_field in (
        "review_area_visible",
        "review_tab_visible",
        "sort_control_container_found",
        "clicked_target_sort",
        "was_target_sort_already_selected",
        "review_api_wait_timeout_s",
        "review_api_response_count_after_click",
        "available_sort_labels_in_review_area",
        "available_buttons_global_sample",
        "review_area_lost_after_sort_click",
        "current_url",
        "document_title",
        "review_count_badge",
        "empty_review_marker_present",
        "interstitial_detected",
    ):
        if connector_field in ps:
            diagnostic[connector_field] = ps.get(connector_field)

    # Splice through whatever the caller wants to override.
    if isinstance(extra_diagnostics, dict):
        for k, v in extra_diagnostics.items():
            if k in DIAGNOSTIC_KEYS:
                diagnostic[k] = v

    return DiagnosticArtifact(
        sort_type=sort_type,
        attempt_index=attempt_index,
        subreason=subreason,
        next_action_hint_ko=NEXT_ACTION_HINT.get(
            subreason, NEXT_ACTION_HINT[AUTH_WALL_UNKNOWN],
        ),
        diagnostic=diagnostic,
    )


def write_diagnostic_artifact(
    *,
    artifact: DiagnosticArtifact,
    out_dir: Path,
) -> Path:
    """Persist the diagnostic to `out_dir / diagnostic_summary_<sort>_<n>.json`.

    `out_dir` is typically `data/collection_artifacts/<batch>/` so the
    artifact lives next to the per-product summary the connector
    writes for the same batch.
    """
    out_dir.mkdir(parents=True, exist_ok=True)
    safe_sort = (artifact.sort_type or "UNKNOWN").replace("/", "_")
    fname = (
        f"diagnostic_summary_{safe_sort}_attempt{artifact.attempt_index}.json"
    )
    path = out_dir / fname
    path.write_text(
        json.dumps(artifact.to_dict(), ensure_ascii=False, indent=2)
        + "\n",
        encoding="utf-8",
    )
    artifact.artifact_path = path
    return path


__all__ = [
    "AUTH_WALL_LOGIN_REQUIRED",
    "AUTH_WALL_API_BLOCKED",
    "AUTH_WALL_NO_REVIEW_API",
    "AUTH_WALL_FALSE_EMPTY",
    "SORT_SELECTOR_FAILED",
    "TARGET_GOODS_FILTER_EMPTY",
    "AUTH_WALL_UNKNOWN",
    # Pass-19E sort-control reasons (no auth evidence)
    "SORT_CONTROL_NOT_REACHED",
    "REVIEW_SORT_API_NOT_TRIGGERED",
    "REVIEW_AREA_LOST_AFTER_SORT_CLICK",
    "NO_REVIEW_API_AFTER_SORT_CLICK",
    "DEFAULT_SORT_RESPONSE_REUSED",
    "ALREADY_SELECTED_SORT_REUSED",
    # Subreason groups (used by inspector for Korean messaging)
    "AUTH_EVIDENCE_SUBREASONS",
    "SORT_CONTROL_SUBREASONS",
    "API_NOT_FIRED_SUBREASONS",
    "REUSE_SUBREASONS",
    # Sort label mapping
    "SORT_TYPE_KO_LABELS",
    "SORT_TYPE_KO_LABEL_ALIASES",
    "ko_label_for_sort_type",
    "sort_type_for_ko_label",
    # Existing
    "DIAGNOSTIC_KEYS",
    "DiagnosticArtifact",
    "NEXT_ACTION_HINT",
    "build_diagnostic_summary",
    "classify_auth_wall_subreason",
    "has_auth_evidence",
    "write_diagnostic_artifact",
]
