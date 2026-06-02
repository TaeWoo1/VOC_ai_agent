"""Tests for the auth-wall diagnostics layer (pass-7).

Covers:
  - Subreason classifier — 6 distinct paths + unknown fallback.
  - Diagnostic artifact shape — every required key present.
  - CLI plumbing — pipeline accepts the new flags.
  - Recovery dispatcher — sort-specific action sequences.
  - Retry-only fail-fast wording.
  - Inspector surfaces subreason + recommended next action.
"""
from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[3]


# ---------------------------------------------------------------------------
# 1. Subreason classifier
# ---------------------------------------------------------------------------


from src.voc.reporting.phase2e import auth_wall_diagnostics as awd


class TestClassifier:
    def test_login_required_when_401_seen(self):
        sub = awd.classify_auth_wall_subreason(
            sort_type="RATING_ASC",
            prod_summary={"http_401_or_login_required_seen": True},
        )
        assert sub == awd.AUTH_WALL_LOGIN_REQUIRED

    def test_login_required_when_auth_error_in_error_string(self):
        sub = awd.classify_auth_wall_subreason(
            sort_type="RATING_ASC",
            prod_summary={},
            error="Scraper failed: anonymous_auth_wall login_required",
        )
        assert sub == awd.AUTH_WALL_LOGIN_REQUIRED

    def test_api_blocked_when_403(self):
        sub = awd.classify_auth_wall_subreason(
            sort_type="RECOMMENDED_DESC",
            prod_summary={"http_403_seen": True},
        )
        assert sub == awd.AUTH_WALL_API_BLOCKED

    def test_api_blocked_when_429(self):
        sub = awd.classify_auth_wall_subreason(
            sort_type="RECOMMENDED_DESC",
            prod_summary={"http_429_seen": True},
        )
        assert sub == awd.AUTH_WALL_API_BLOCKED

    def test_target_goods_filter_empty(self):
        sub = awd.classify_auth_wall_subreason(
            sort_type="RATING_DESC",
            prod_summary={
                "review_api_response_count": 5,
                "review_list_reviews_for_target_goods_no": 0,
            },
        )
        assert sub == awd.TARGET_GOODS_FILTER_EMPTY

    def test_sort_selector_failed_when_label_list_empty(self):
        sub = awd.classify_auth_wall_subreason(
            sort_type="RATING_ASC",
            prod_summary={"available_sort_button_labels": []},
        )
        assert sub == awd.SORT_SELECTOR_FAILED

    def test_false_empty_without_auth_evidence_is_sort_control(self):
        # Pass-19E: false_empty_state_detected WITHOUT auth evidence
        # is no longer classified as AUTH_WALL_FALSE_EMPTY. The user
        # is logged in, no 401/403/429/captcha — this is a sort-
        # control failure (the API didn't fire for the target sort).
        sub = awd.classify_auth_wall_subreason(
            sort_type="RATING_ASC",
            prod_summary={
                "false_empty_state_detected": True,
                "available_sort_button_labels": ["평점 낮은순", "최신순"],
                "login_state_observed": "logged_in",
            },
        )
        assert sub == awd.REVIEW_SORT_API_NOT_TRIGGERED

    def test_false_empty_with_auth_evidence_is_auth_wall(self):
        # When 401 IS observed, false_empty + auth signals still
        # indicate an auth-class problem. Different recovery path.
        sub = awd.classify_auth_wall_subreason(
            sort_type="RATING_ASC",
            prod_summary={
                "false_empty_state_detected": True,
                "available_sort_button_labels": ["평점 낮은순", "최신순"],
                "http_401_or_login_required_seen": True,
            },
        )
        assert sub == awd.AUTH_WALL_LOGIN_REQUIRED

    def test_no_review_api_without_auth_is_sort_control(self):
        # Pass-19E: zero API + no auth evidence → connector-side click
        # / wait failure, not auth-wall.
        sub = awd.classify_auth_wall_subreason(
            sort_type="RATING_ASC",
            prod_summary={
                "review_api_request_count": 0,
                "review_api_response_count": 0,
                "available_sort_button_labels": ["평점 낮은순", "최신순"],
                "login_state_observed": "logged_in",
            },
        )
        assert sub == awd.REVIEW_SORT_API_NOT_TRIGGERED

    def test_unknown_fallback(self):
        # All signals quiet: API fired, no auth flags, label list non-empty,
        # no false-empty, no goods-filter — falls through to unknown.
        sub = awd.classify_auth_wall_subreason(
            sort_type="RATING_ASC",
            prod_summary={
                "available_sort_button_labels": ["평점 낮은순"],
                "review_api_request_count": 1,
                "review_api_response_count": 1,
                "review_list_reviews_for_target_goods_no": 5,
            },
        )
        assert sub == awd.AUTH_WALL_UNKNOWN


# ---------------------------------------------------------------------------
# 2. Diagnostic artifact shape
# ---------------------------------------------------------------------------


class TestDiagnosticArtifact:
    def test_artifact_carries_all_required_keys(self, tmp_path):
        sort_result = {
            "sort_type": "RATING_ASC",
            "status": "scraper_subprocess_failed",
            "attempts": 2,
            "prod_summary": {
                "http_401_or_login_required_seen": True,
                "available_sort_button_labels": ["평점 낮은순", "최신순"],
                "false_empty_state_detected": False,
                "human_check_detected": False,
                "review_api_request_count": 0,
                "review_api_response_count": 0,
                "login_state_observed": "anonymous",
                "requested_sort_type": "RATING_ASC",
            },
        }
        artifact = awd.build_diagnostic_summary(
            sort_type="RATING_ASC",
            attempt_index=2,
            sort_result=sort_result,
        )
        path = awd.write_diagnostic_artifact(
            artifact=artifact, out_dir=tmp_path,
        )
        assert path.is_file()
        payload = json.loads(path.read_text(encoding="utf-8"))
        assert payload["sort_type"] == "RATING_ASC"
        assert payload["attempt_index"] == 2
        assert payload["subreason"] == awd.AUTH_WALL_LOGIN_REQUIRED
        assert payload["next_action_hint_ko"]
        diag = payload["diagnostic"]
        # Every spec key must be present (some null is fine).
        for k in awd.DIAGNOSTIC_KEYS:
            assert k in diag, f"missing diagnostic key: {k}"
        # Connector-known signals propagated into the artifact.
        assert diag["http_401_or_login_required_seen"] is True
        assert diag["available_sort_button_labels"] == ["평점 낮은순", "최신순"]
        assert diag["selected_sort_type"] == "RATING_ASC"

    def test_subreason_appears_on_every_artifact(self, tmp_path):
        # No prod_summary at all → no auth evidence, zero API counts
        # → REVIEW_SORT_API_NOT_TRIGGERED is the new fallback.
        artifact = awd.build_diagnostic_summary(
            sort_type="RECOMMENDED_DESC",
            attempt_index=1,
            sort_result={"status": "scraper_subprocess_failed",
                         "prod_summary": None},
        )
        assert artifact.subreason in (
            awd.REVIEW_SORT_API_NOT_TRIGGERED,
            awd.AUTH_WALL_UNKNOWN,
        )
        assert artifact.next_action_hint_ko


# ---------------------------------------------------------------------------
# 3. Pipeline CLI accepts the new flags
# ---------------------------------------------------------------------------


def test_pipeline_help_includes_new_auth_wall_flags():
    proc = subprocess.run(
        [sys.executable, str(REPO / "scripts" / "run_phase2e_pipeline.py"),
         "--help"],
        capture_output=True, text=True, cwd=str(REPO),
        env={"PYTHONPATH": str(REPO), "PATH": ""},
    )
    assert proc.returncode == 0
    out = proc.stdout
    for flag in (
        "--auth-wall-recovery-mode",
        "--auth-wall-backoff-seconds",
        "--auth-wall-max-recovery-attempts",
        "--manual-auth-wall-recovery",
        "--diagnostic-artifact-dir",
    ):
        assert flag in out, f"missing CLI flag in --help: {flag}"


# ---------------------------------------------------------------------------
# 4. Sort-specific recovery dispatcher
# ---------------------------------------------------------------------------


class TestSortSpecificRecovery:
    @pytest.fixture(scope="class")
    def pipeline_mod(self):
        import importlib.util
        name = "_pipeline_for_pass7"
        if name in sys.modules:
            return sys.modules[name]
        spec = importlib.util.spec_from_file_location(
            name, REPO / "scripts" / "run_phase2e_pipeline.py",
        )
        mod = importlib.util.module_from_spec(spec)
        sys.modules[name] = mod
        spec.loader.exec_module(mod)
        return mod

    def test_rating_asc_first_attempt_includes_review_tab_rewake(
        self, pipeline_mod,
    ):
        actions = pipeline_mod._sort_specific_recovery_actions(
            "RATING_ASC", recovery_attempt=1,
        )
        assert "review_tab_rewake" in actions
        assert "click_rating_asc_label" in actions
        assert "wait_for_review_list_api" in actions

    def test_recommended_desc_first_attempt_matches_label(
        self, pipeline_mod,
    ):
        actions = pipeline_mod._sort_specific_recovery_actions(
            "RECOMMENDED_DESC", recovery_attempt=1,
        )
        assert "match_recommended_label_against_available_buttons" in actions

    def test_second_attempt_falls_back_to_page_reload(self, pipeline_mod):
        actions = pipeline_mod._sort_specific_recovery_actions(
            "RATING_ASC", recovery_attempt=2,
        )
        assert "page_reload" in actions
        assert "open_review_tab_via_url" in actions


# ---------------------------------------------------------------------------
# 5. Retry-only fail-fast wording
# ---------------------------------------------------------------------------


def test_retry_only_fail_fast_message_present_in_source():
    """The fail-fast branch under --retry-failed-from-summary must
    say "Retry-only run attempted N failed sort(s)" — not the legacy
    "ALL 5 sorts saw 0" line."""
    src = (REPO / "scripts" / "run_phase2e_pipeline.py").read_text()
    assert "Retry-only run attempted" in src
    assert "Prior successful sorts were not re-scraped" in src


# ---------------------------------------------------------------------------
# 6. inspect_run_quality surfaces auth-wall subreason
# ---------------------------------------------------------------------------


class TestInspectorAuthWallView:
    def _write_run(
        self, base: Path, *, subreason: str, diagnostic_path: str,
    ) -> Path:
        run_dir = base / "synthetic_pass7_run"
        (run_dir / "shared").mkdir(parents=True, exist_ok=True)
        (run_dir / "buyer_content" / "ko").mkdir(parents=True, exist_ok=True)
        (run_dir / "buyer_content" / "ko" / "buyer_journey_cardnews.json").write_text(
            json.dumps({"slide_count": 14, "slides": []},
                       ensure_ascii=False),
        )
        manifest = {
            "artifacts": {
                "seller_report_ko_pdf": {
                    "status": "ok",
                    "path": "seller_report/seller_report_ko.pdf",
                },
                "buyer_content": {
                    "ko": {
                        "buyer_journey_cardnews_json": {
                            "status": "ok",
                            "path": "buyer_content/ko/buyer_journey_cardnews.json",
                        },
                    },
                },
            },
            "presentation": {
                "ko": {
                    "primary_kind": "buyer_journey_cardnews_json",
                    "primary_path": "buyer_content/ko/buyer_journey_cardnews.json",
                    "legacy_fallbacks_present": [],
                },
            },
        }
        (run_dir / "manifest.json").write_text(
            json.dumps(manifest, ensure_ascii=False),
        )
        summary = {
            "sorts_attempted": ["RATING_ASC"],
            "sorts_succeeded": [],
            "sorts_failed": ["RATING_ASC"],
            "partial_success": True,
            "review_count_analyzed": 1000,
            "per_sort": {
                "RATING_ASC": {
                    "status": "scraper_subprocess_failed",
                    "attempts": 3,
                    "raw_records_seen": 0,
                    "rows_inserted": 0,
                    "recovery_actions": [
                        "wait_after_auth_wall",
                        "review_tab_rewake",
                        "retry_after_other_sorts",
                        "final_failed",
                    ],
                    "auth_wall_subreason": subreason,
                    "auth_wall_next_action_hint_ko":
                        "TEST hint — please run patient mode.",
                    "diagnostic_artifact_path": diagnostic_path,
                },
            },
        }
        (run_dir / "shared" / "collection_summary.json").write_text(
            json.dumps(summary, ensure_ascii=False),
        )
        # Minimal valid analysis_report so the inspector doesn't crash.
        (run_dir / "shared" / "analysis_report.json").write_text(
            json.dumps({
                "schema_version": "3.0",
                "product": {"slug": "p"},
                "corpus": {"n_reviews_total": 1000, "n_reviews_analyzed": 1000,
                           "primary_sort": "DATETIME_DESC",
                           "confidence_level": "high",
                           "signal_stability": "high"},
                "attributes": [], "polarity_audit": {
                    "n_total_quotes": 0, "n_total_suspect": 0,
                    "n_total_suspect_share": 0.0,
                    "by_attribute": {}, "samples": [],
                },
            }, ensure_ascii=False),
        )
        # Copy canonical schema.
        canonical = (
            REPO / "src" / "voc" / "content" / "schemas"
            / "analysis_report.schema.json"
        )
        (run_dir / "shared" / "analysis_report.schema.json").write_text(
            canonical.read_text(),
        )
        # PDF stub so the cross-check passes.
        (run_dir / "seller_report").mkdir(exist_ok=True)
        (run_dir / "seller_report" / "seller_report_ko.pdf").write_bytes(
            b"%PDF-1.4\nstub\n%%EOF",
        )
        return run_dir

    def test_inspector_prints_subreason_and_diagnostic(self, tmp_path):
        run_dir = self._write_run(
            tmp_path,
            subreason=awd.AUTH_WALL_NO_REVIEW_API,
            diagnostic_path="data/collection_artifacts/x/diagnostic.json",
        )
        proc = subprocess.run(
            [sys.executable, str(REPO / "scripts" / "inspect_run_quality.py"),
             "--run-dir", str(run_dir)],
            capture_output=True, text=True, cwd=str(REPO),
            env={"PYTHONPATH": str(REPO), "PATH": ""},
        )
        out = proc.stdout
        assert "Auth-wall subreason" in out
        assert awd.AUTH_WALL_NO_REVIEW_API in out
        assert "data/collection_artifacts/x/diagnostic.json" in out
        # Recommended next action surfaces too.
        assert "patient" in out or "TEST hint" in out
        # Inspector exits non-zero because final_failed was recorded.
        assert proc.returncode == 1


# ---------------------------------------------------------------------------
# 7. validate_retry_recovery preflight + new flag forwarding
# ---------------------------------------------------------------------------


def test_validator_help_includes_pass7_flags():
    proc = subprocess.run(
        [sys.executable, str(REPO / "scripts" / "validate_retry_recovery.py"),
         "--help"],
        capture_output=True, text=True, cwd=str(REPO),
        env={"PYTHONPATH": str(REPO), "PATH": ""},
    )
    assert proc.returncode == 0
    for flag in (
        "--auth-wall-recovery-mode",
        "--auth-wall-max-recovery-attempts",
        "--auth-wall-backoff-seconds",
        "--manual-auth-wall-recovery",
        "--diagnostic-artifact-dir",
    ):
        assert flag in proc.stdout, f"missing flag in validator --help: {flag}"


def _import_validator_module():
    """Import validate_retry_recovery as a module so we can call
    `_build_retry_command` directly without spawning a subprocess.

    The script lives under `scripts/` (no package); load it by path.
    """
    import importlib.util

    spec = importlib.util.spec_from_file_location(
        "validate_retry_recovery_under_test",
        REPO / "scripts" / "validate_retry_recovery.py",
    )
    assert spec and spec.loader
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def test_build_retry_command_forwards_explicit_backoff_seconds(tmp_path):
    """When the operator passes --auth-wall-backoff-seconds, the
    composed retry command must forward the same value verbatim."""
    mod = _import_validator_module()
    run_dir = tmp_path / "run-fixture"
    (run_dir / "shared").mkdir(parents=True)
    cmd = mod._build_retry_command(
        run_dir=run_dir,
        product_url="https://example.invalid/p/1",
        prior_summary_path=run_dir / "shared" / "collection_summary.json",
        cdp_port=9333,
        stub_llm=False,
        auth_wall_recovery_mode="patient",
        auth_wall_max_recovery_attempts=1,
        manual_auth_wall_recovery=False,
        diagnostic_artifact_dir=None,
        auth_wall_backoff_seconds=180.0,
    )
    assert "--auth-wall-backoff-seconds" in cmd
    idx = cmd.index("--auth-wall-backoff-seconds")
    assert cmd[idx + 1] == "180"


def test_build_retry_command_omits_backoff_when_unset(tmp_path):
    """When --auth-wall-backoff-seconds is omitted, the validator
    must NOT inject the flag — the pipeline keeps its mode default
    (patient = 120-180s random)."""
    mod = _import_validator_module()
    run_dir = tmp_path / "run-fixture-omit"
    (run_dir / "shared").mkdir(parents=True)
    cmd = mod._build_retry_command(
        run_dir=run_dir,
        product_url="https://example.invalid/p/2",
        prior_summary_path=run_dir / "shared" / "collection_summary.json",
        cdp_port=9333,
        stub_llm=False,
        auth_wall_recovery_mode="patient",
        auth_wall_max_recovery_attempts=1,
        manual_auth_wall_recovery=False,
        diagnostic_artifact_dir=None,
    )
    assert "--auth-wall-backoff-seconds" not in cmd
