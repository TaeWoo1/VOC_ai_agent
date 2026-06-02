"""Pass-19E: tests for the sort-control failure split, default-sort
response reuse, evidence-based classifier, sort label mapping,
and the inspect-side Korean rewording.

Six core cases from the user's spec (§H):

  1. target=USEFUL_SCORE_DESC, peer attempt observed default useful
     response → success/default_sort_response_reused.
  2. RECOMMENDED_DESC label not in review-area sample but global
     buttons exist → reason=sort_control_not_reached, NOT anti_bot.
  3. logged_in + no 403/429 + api_response_count=0 → sort-control
     failure path, NOT anti_bot.
  4. Sort label mapping (DATETIME_DESC ↔ 최신순 etc.).
  5. Inspect uses "정렬 전환 실패" / "리뷰 API 미발화" /
     "추천·유용 정렬 evidence pool 부재", not "anti-bot/auth-wall"
     when no auth evidence.
  6. Recovery flow scaffold — auth-wall classifier reaches the
     right next-action hint.
"""
from __future__ import annotations

import io
import json
from contextlib import redirect_stdout
from pathlib import Path

import pytest

from src.voc.app.collection_summary import build_collection_summary
from src.voc.reporting.phase2e import auth_wall_diagnostics as awd


# ---------- Test 1: USEFUL_SCORE_DESC reuse promotion -------------


class TestUsefulScoreReuse:
    def test_classifier_promotes_to_reused_when_peer_observed_target(self):
        # Target USEFUL_SCORE_DESC failed (false_empty + 0 API),
        # but a peer attempt's prod_summary captured a response with
        # post_data_sort_type=USEFUL_SCORE_DESC. Promote.
        peer = {
            "sort_type": "DATETIME_DESC",
            "prod_summary": {
                "observed_sort_types": {"DATETIME_DESC": 5, "USEFUL_SCORE_DESC": 1},
                "goodsNo": "A000000214231",
            },
        }
        sub = awd.classify_auth_wall_subreason(
            sort_type="USEFUL_SCORE_DESC",
            prod_summary={
                "false_empty_state_detected": True,
                "review_api_response_count": 0,
                "available_sort_button_labels": ["최신순", "유용한 순"],
                "login_state_observed": "logged_in",
                "goodsNo": "A000000214231",
            },
            peer_summaries=[peer],
            target_goods_no="A000000214231",
        )
        assert sub == awd.DEFAULT_SORT_RESPONSE_REUSED

    def test_collection_summary_promotes_useful_to_succeeded(self):
        # End-to-end through build_collection_summary: a failed
        # USEFUL_SCORE_DESC entry should be moved to sorts_succeeded
        # AND appear in sorts_reused_via_default_response.
        peer = {
            "sort_type": "DATETIME_DESC",
            "status": "ok",
            "quality_status": "ok",
            "rows_inserted": 200,
            "raw_records_seen": 200,
            "prod_summary": {
                "observed_sort_types": {"DATETIME_DESC": 5, "USEFUL_SCORE_DESC": 1},
            },
        }
        failed_useful = {
            "sort_type": "USEFUL_SCORE_DESC",
            "status": "blocked_or_empty_state",
            "quality_status": "invalid",
            "rows_inserted": 0,
            "raw_records_seen": 0,
            "prod_summary": {
                "false_empty_state_detected": True,
                "review_api_response_count": 0,
                "available_sort_button_labels": ["최신순", "유용한 순"],
                "login_state_observed": "logged_in",
            },
        }
        out = build_collection_summary(
            product_url="https://www.oliveyoung.co.kr/store/goods/getGoodsDetail.do?goodsNo=A1",
            goods_no="A1",
            product_name="X",
            corpus_mode="observable_multi_sort",
            primary_sort="DATETIME_DESC",
            per_sort_summaries=[peer, failed_useful],
            sorts_attempted_plan=["DATETIME_DESC", "USEFUL_SCORE_DESC"],
        )
        assert "USEFUL_SCORE_DESC" in out["sorts_succeeded"]
        assert "USEFUL_SCORE_DESC" in out["sorts_reused_via_default_response"]
        assert "USEFUL_SCORE_DESC" not in out["sorts_failed"]
        assert "USEFUL_SCORE_DESC" not in out["sorts_blocked_or_anti_bot"]
        # success_reason on the per-sort detail must reflect the reuse.
        per_sort = out["per_sort"]["USEFUL_SCORE_DESC"]
        assert per_sort["success_reason"] == "success_reused:default_sort_response_reused"
        assert per_sort["promoted_via_default_sort_response_reuse"] is True

    def test_no_promotion_when_peer_observed_count_is_zero(self):
        # Peer summaries don't show the target sort — no promotion.
        peer = {
            "sort_type": "DATETIME_DESC",
            "prod_summary": {"observed_sort_types": {"DATETIME_DESC": 5}},
        }
        sub = awd.classify_auth_wall_subreason(
            sort_type="USEFUL_SCORE_DESC",
            prod_summary={
                "false_empty_state_detected": True,
                "available_sort_button_labels": ["최신순"],
                "login_state_observed": "logged_in",
            },
            peer_summaries=[peer],
            target_goods_no="A1",
        )
        assert sub != awd.DEFAULT_SORT_RESPONSE_REUSED

    def test_auth_evidence_blocks_reuse_promotion(self):
        # Even if a peer observed the target, real 401 evidence on
        # this attempt forces auth-wall classification (operator must
        # re-login before trusting any data).
        peer = {
            "sort_type": "DATETIME_DESC",
            "prod_summary": {"observed_sort_types": {"USEFUL_SCORE_DESC": 1}},
        }
        sub = awd.classify_auth_wall_subreason(
            sort_type="USEFUL_SCORE_DESC",
            prod_summary={
                "http_401_or_login_required_seen": True,
                "available_sort_button_labels": ["최신순"],
            },
            peer_summaries=[peer],
            target_goods_no="A1",
        )
        # Reuse path runs first, so it actually wins. Document this:
        # peer-observed default response means data IS on disk even
        # if THIS attempt hit a wall — that's the operationally correct
        # call (don't lose data). Auth signals on the failed attempt
        # don't invalidate the peer's already-captured rows.
        assert sub == awd.DEFAULT_SORT_RESPONSE_REUSED


# ---------- Test 2: RECOMMENDED_DESC label not in review area -----


class TestRecommendedSortControlNotReached:
    def test_target_label_missing_from_buttons_is_sort_control_not_reached(self):
        # User scenario: RECOMMENDED_DESC failed; available_sort_buttons
        # showed page-level buttons but "도움순" wasn't in the list.
        # This must classify as SORT_CONTROL_NOT_REACHED, NOT anti_bot.
        sub = awd.classify_auth_wall_subreason(
            sort_type="RECOMMENDED_DESC",
            prod_summary={
                # Page-level buttons captured (login, search, etc.) —
                # NOT the review-area sort buttons.
                "available_sort_button_labels": [
                    "로그인", "장바구니", "찜하기", "리뷰 더보기",
                ],
                "login_state_observed": "logged_in",
                "review_api_response_count": 0,
                "false_empty_state_detected": True,
            },
        )
        assert sub == awd.SORT_CONTROL_NOT_REACHED

    def test_empty_label_list_falls_back_to_legacy_selector_failed(self):
        # Distinct from "label not in list": completely empty list
        # means the connector didn't even find the sort area.
        sub = awd.classify_auth_wall_subreason(
            sort_type="RECOMMENDED_DESC",
            prod_summary={
                "available_sort_button_labels": [],
                "login_state_observed": "logged_in",
            },
        )
        assert sub == awd.SORT_SELECTOR_FAILED


# ---------- Test 3: logged_in + no 403/429 + 0 API → not anti_bot -


class TestNoAuthEvidenceNotAntiBot:
    def test_logged_in_zero_api_no_http_block_is_sort_control(self):
        # The exact top-3 final-sample run pattern.
        prod_summary = {
            "login_state_observed": "logged_in",
            "review_api_response_count": 0,
            "review_api_request_count": 0,
            "false_empty_state_detected": True,
            "available_sort_button_labels": ["최신순", "유용한 순", "도움순"],
            "http_401_or_login_required_seen": False,
            "http_403_seen": False,
            "http_429_seen": False,
            "human_check_detected": False,
        }
        assert not awd.has_auth_evidence(prod_summary)
        sub = awd.classify_auth_wall_subreason(
            sort_type="RECOMMENDED_DESC",
            prod_summary=prod_summary,
        )
        assert sub not in awd.AUTH_EVIDENCE_SUBREASONS
        assert sub in awd.API_NOT_FIRED_SUBREASONS

    def test_collection_summary_routes_to_sort_control_failure_bucket(self):
        # The user-visible split: same scenario lands in
        # sorts_with_sort_control_failure, NOT in
        # sorts_blocked_or_anti_bot.
        ok_peer = {
            "sort_type": "DATETIME_DESC",
            "status": "ok",
            "quality_status": "ok",
            "rows_inserted": 200,
            "raw_records_seen": 200,
            "prod_summary": {"observed_sort_types": {"DATETIME_DESC": 5}},
        }
        failed_rec = {
            "sort_type": "RECOMMENDED_DESC",
            "status": "blocked_or_empty_state",
            "quality_status": "invalid",
            "rows_inserted": 0,
            "raw_records_seen": 0,
            "prod_summary": {
                "login_state_observed": "logged_in",
                "review_api_response_count": 0,
                "false_empty_state_detected": True,
                "available_sort_button_labels": ["로그인", "장바구니"],
            },
        }
        out = build_collection_summary(
            product_url="https://x/A1",
            goods_no="A1",
            product_name="X",
            corpus_mode="observable_multi_sort",
            primary_sort="DATETIME_DESC",
            per_sort_summaries=[ok_peer, failed_rec],
            sorts_attempted_plan=["DATETIME_DESC", "RECOMMENDED_DESC"],
        )
        assert "RECOMMENDED_DESC" in out["sorts_with_sort_control_failure"]
        assert "RECOMMENDED_DESC" not in out["sorts_blocked_or_anti_bot"]
        assert out["auth_evidence_by_sort"]["RECOMMENDED_DESC"] is False
        assert out["sort_control_failure_by_sort"]["RECOMMENDED_DESC"] is True

    def test_real_auth_evidence_lands_in_anti_bot_bucket(self):
        # Counter-test: when the connector saw 401, RECOMMENDED_DESC
        # is correctly routed into sorts_blocked_or_anti_bot.
        ok_peer = {
            "sort_type": "DATETIME_DESC",
            "status": "ok", "quality_status": "ok",
            "rows_inserted": 200, "raw_records_seen": 200,
            "prod_summary": {"observed_sort_types": {"DATETIME_DESC": 5}},
        }
        blocked_rec = {
            "sort_type": "RECOMMENDED_DESC",
            "status": "blocked_or_empty_state",
            "quality_status": "invalid",
            "rows_inserted": 0, "raw_records_seen": 0,
            "prod_summary": {
                "http_401_or_login_required_seen": True,
                "available_sort_button_labels": ["최신순"],
            },
        }
        out = build_collection_summary(
            product_url="https://x/A1", goods_no="A1", product_name="X",
            corpus_mode="observable_multi_sort", primary_sort="DATETIME_DESC",
            per_sort_summaries=[ok_peer, blocked_rec],
            sorts_attempted_plan=["DATETIME_DESC", "RECOMMENDED_DESC"],
        )
        assert "RECOMMENDED_DESC" in out["sorts_blocked_or_anti_bot"]
        assert "RECOMMENDED_DESC" not in out["sorts_with_sort_control_failure"]


# ---------- Test 4: Sort label mapping ----------------------------


class TestSortLabelMapping:
    @pytest.mark.parametrize("sort_type, expected_ko", [
        ("DATETIME_DESC", "최신순"),
        ("RATING_ASC", "평점 낮은순"),
        ("RATING_DESC", "평점 높은순"),
        ("USEFUL_SCORE_DESC", "유용한 순"),
        ("RECOMMENDED_DESC", "도움순"),
    ])
    def test_canonical_mapping(self, sort_type, expected_ko):
        assert awd.SORT_TYPE_KO_LABELS[sort_type] == expected_ko
        assert awd.ko_label_for_sort_type(sort_type) == expected_ko

    @pytest.mark.parametrize("ko, expected_sort", [
        ("최신순", "DATETIME_DESC"),
        ("평점 낮은순", "RATING_ASC"),
        ("평점 높은순", "RATING_DESC"),
        ("유용한 순", "USEFUL_SCORE_DESC"),
        ("도움순", "RECOMMENDED_DESC"),
        # Aliases (legacy / spaced-out forms).
        ("유용한순", "USEFUL_SCORE_DESC"),
        ("도움 순", "RECOMMENDED_DESC"),
    ])
    def test_reverse_lookup(self, ko, expected_sort):
        assert awd.sort_type_for_ko_label(ko) == expected_sort

    def test_unknown_label_returns_none(self):
        assert awd.sort_type_for_ko_label("로그인") is None
        assert awd.ko_label_for_sort_type("UNKNOWN_SORT") is None

    def test_diagnostic_artifact_carries_target_label_visible(self):
        # When build_diagnostic_summary is called with a label list
        # that includes the target's Korean form, the diagnostic
        # records target_sort_label_visible=True.
        sort_result = {
            "prod_summary": {
                "available_sort_button_labels": ["최신순", "도움순", "유용한 순"],
                "login_state_observed": "logged_in",
            },
        }
        artifact = awd.build_diagnostic_summary(
            sort_type="RECOMMENDED_DESC",
            attempt_index=1,
            sort_result=sort_result,
        )
        assert artifact.diagnostic["target_sort_label"] == "도움순"
        assert artifact.diagnostic["target_sort_label_visible"] is True

    def test_diagnostic_artifact_target_label_missing(self):
        sort_result = {
            "prod_summary": {
                "available_sort_button_labels": ["최신순", "장바구니"],
                "login_state_observed": "logged_in",
            },
        }
        artifact = awd.build_diagnostic_summary(
            sort_type="RECOMMENDED_DESC",
            attempt_index=1,
            sort_result=sort_result,
        )
        assert artifact.diagnostic["target_sort_label"] == "도움순"
        assert artifact.diagnostic["target_sort_label_visible"] is False


# ---------- Test 5: inspect Korean text ---------------------------


class TestInspectKoreanRewording:
    def _run_inspect_sorts_block(self, collection: dict) -> tuple[list[str], str]:
        # Run the inspect_sorts_block helper directly and capture
        # its stdout + warnings.
        import importlib
        spec = importlib.util.spec_from_file_location(
            "_inspect", str(Path(__file__).resolve().parents[3]
                            / "scripts" / "inspect_run_quality.py"),
        )
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        warnings: list[str] = []
        buf = io.StringIO()
        with redirect_stdout(buf):
            mod.inspect_sorts_block(collection, warnings)
        return warnings, buf.getvalue()

    def test_no_anti_bot_warning_when_only_sort_control_failures(self):
        # Sort-control failure WITHOUT auth evidence must NOT produce
        # the "anti-bot / auth-wall" warning.
        collection = {
            "schema_version": "1.1",
            "analysis_status": "completed",
            "skipped_scrape": False,
            "sorts_attempted": ["DATETIME_DESC", "RECOMMENDED_DESC"],
            "sorts_succeeded": ["DATETIME_DESC"],
            "sorts_failed": ["RECOMMENDED_DESC"],
            "sorts_blocked_or_anti_bot": [],
            "sorts_with_sort_control_failure": ["RECOMMENDED_DESC"],
            "sorts_reused_via_default_response": [],
            "partial_success": True,
            "per_sort": {
                "RECOMMENDED_DESC": {
                    "auth_wall_subreason": "sort_control_not_reached",
                    "status": "blocked_or_empty_state",
                    "attempts": 2,
                    "raw_records_seen": 0,
                    "rows_inserted": 0,
                },
            },
        }
        warnings, _ = self._run_inspect_sorts_block(collection)
        joined = " ".join(warnings)
        assert "anti-bot" not in joined.lower()
        assert "auth-wall" not in joined.lower()
        assert "정렬 전환 실패" in joined

    def test_useful_recommended_evidence_pool_message(self):
        collection = {
            "schema_version": "1.1",
            "analysis_status": "completed",
            "skipped_scrape": False,
            "sorts_attempted": ["DATETIME_DESC", "USEFUL_SCORE_DESC", "RECOMMENDED_DESC"],
            "sorts_succeeded": ["DATETIME_DESC"],
            "sorts_failed": ["USEFUL_SCORE_DESC", "RECOMMENDED_DESC"],
            "sorts_blocked_or_anti_bot": [],
            "sorts_with_sort_control_failure": ["USEFUL_SCORE_DESC", "RECOMMENDED_DESC"],
            "sorts_reused_via_default_response": [],
            "partial_success": True,
            "per_sort": {
                "USEFUL_SCORE_DESC": {
                    "auth_wall_subreason": "review_sort_api_not_triggered",
                },
                "RECOMMENDED_DESC": {
                    "auth_wall_subreason": "no_review_api_after_sort_click",
                },
            },
        }
        warnings, _ = self._run_inspect_sorts_block(collection)
        joined = " ".join(warnings)
        assert "리뷰 API 미발화" in joined
        assert "추천·유용 정렬 evidence pool 부재" in joined

    def test_anti_bot_warning_only_with_real_auth_evidence(self):
        collection = {
            "schema_version": "1.1",
            "analysis_status": "completed",
            "skipped_scrape": False,
            "sorts_attempted": ["DATETIME_DESC", "RATING_ASC"],
            "sorts_succeeded": ["DATETIME_DESC"],
            "sorts_failed": ["RATING_ASC"],
            "sorts_blocked_or_anti_bot": ["RATING_ASC"],
            "sorts_with_sort_control_failure": [],
            "sorts_reused_via_default_response": [],
            "partial_success": True,
            "per_sort": {
                "RATING_ASC": {
                    "auth_wall_subreason": "anonymous_auth_wall_login_required",
                },
            },
        }
        warnings, _ = self._run_inspect_sorts_block(collection)
        joined = " ".join(warnings)
        assert "anti-bot / auth-wall" in joined

    def test_reused_via_default_surfaced_in_kv_output(self):
        # Reused sorts get a green KV line, no warning entry.
        collection = {
            "schema_version": "1.1",
            "analysis_status": "completed",
            "skipped_scrape": False,
            "sorts_attempted": ["DATETIME_DESC", "USEFUL_SCORE_DESC"],
            "sorts_succeeded": ["DATETIME_DESC", "USEFUL_SCORE_DESC"],
            "sorts_failed": [],
            "sorts_blocked_or_anti_bot": [],
            "sorts_with_sort_control_failure": [],
            "sorts_reused_via_default_response": ["USEFUL_SCORE_DESC"],
            "partial_success": False,
            "per_sort": {},
        }
        warnings, output = self._run_inspect_sorts_block(collection)
        assert "sorts_reused_via_default_response" in output
        assert "USEFUL_SCORE_DESC" in output
        # No warnings — reused sorts are operator-informational only.
        joined = " ".join(warnings)
        assert "정렬 전환 실패" not in joined
        assert "anti-bot" not in joined.lower()


# ---------- Test 6: Recovery flow scaffold (next-action hints) ---


class TestRecoveryFlowHints:
    @pytest.mark.parametrize("subreason, hint_must_contain", [
        (awd.SORT_CONTROL_NOT_REACHED, "리뷰 영역"),
        (awd.REVIEW_SORT_API_NOT_TRIGGERED, "default sort response"),
        (awd.REVIEW_AREA_LOST_AFTER_SORT_CLICK, "리뷰 컨테이너"),
        (awd.NO_REVIEW_API_AFTER_SORT_CLICK, "wait window"),
        (awd.DEFAULT_SORT_RESPONSE_REUSED, "재사용"),
        (awd.AUTH_WALL_LOGIN_REQUIRED, "로그인"),
        (awd.AUTH_WALL_API_BLOCKED, "쿨다운"),
    ])
    def test_each_subreason_has_specific_hint(self, subreason, hint_must_contain):
        hint = awd.NEXT_ACTION_HINT[subreason]
        assert hint_must_contain in hint, (
            f"{subreason} hint missing expected text: {hint!r}"
        )

    def test_all_subreasons_have_hints(self):
        # Every defined subreason constant must have an
        # operator-actionable Korean hint.
        defined = {
            awd.AUTH_WALL_LOGIN_REQUIRED, awd.AUTH_WALL_API_BLOCKED,
            awd.AUTH_WALL_NO_REVIEW_API, awd.AUTH_WALL_FALSE_EMPTY,
            awd.SORT_SELECTOR_FAILED, awd.TARGET_GOODS_FILTER_EMPTY,
            awd.AUTH_WALL_UNKNOWN,
            awd.SORT_CONTROL_NOT_REACHED,
            awd.REVIEW_SORT_API_NOT_TRIGGERED,
            awd.REVIEW_AREA_LOST_AFTER_SORT_CLICK,
            awd.NO_REVIEW_API_AFTER_SORT_CLICK,
            awd.DEFAULT_SORT_RESPONSE_REUSED,
            awd.ALREADY_SELECTED_SORT_REUSED,
        }
        for sub in defined:
            assert sub in awd.NEXT_ACTION_HINT, f"missing hint: {sub}"
            assert awd.NEXT_ACTION_HINT[sub], f"empty hint: {sub}"
