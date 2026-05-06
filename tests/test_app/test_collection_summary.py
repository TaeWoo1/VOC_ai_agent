"""Tests for the per-run collection_summary.json sidecar.

The sidecar captures every sort's outcome so a post-hoc audit can
reconstruct what happened during scrape. Tests cover:

  - multi-sort partial success (some sorts ok, some failed/blocked)
  - all-sorts succeeded (no failures)
  - all-sorts failed (no successes)
  - blocked / anti-bot detection
  - skip-scrape stub emission
  - atomic write contract
  - manifest extractor reads the sidecar correctly

Acceptance is qualitative — every test asserts a property the
sidecar must satisfy.
"""
from __future__ import annotations

import json
from pathlib import Path

import pytest

from src.voc.app.collection_summary import (
    ANALYSIS_STATUS_COMPLETED,
    ANALYSIS_STATUS_FAILED,
    ANALYSIS_STATUS_PENDING,
    BLOCKING_STATUSES,
    COLLECTION_SUMMARY_SCHEMA_VERSION,
    build_collection_summary,
    update_collection_summary,
    write_collection_summary,
)


# -----------------------------------------------------------------------------
# fixtures — per-sort summary entries shaped like the runner emits.
# -----------------------------------------------------------------------------


def _ok_entry(sort_type: str, *, raw=2143, inserted=2029, attempts=1) -> dict:
    return {
        "sort_type": sort_type,
        "status": "ok",
        "quality_status": "ok",
        "rows_inserted": inserted,
        "raw_records_seen": raw,
        "attempts": attempts,
        "prod_summary": None,
    }


def _blocked_entry(sort_type: str, *, status="anti_bot", attempts=3) -> dict:
    return {
        "sort_type": sort_type,
        "status": status,
        "quality_status": status,
        "rows_inserted": 0,
        "raw_records_seen": 0,
        "attempts": attempts,
        "error": None,
        "prod_summary": None,
    }


def _subprocess_failed(sort_type: str, *, error="rc=1 anti_bot") -> dict:
    return {
        "sort_type": sort_type,
        "status": "scraper_subprocess_failed",
        "quality_status": None,
        "rows_inserted": 0,
        "raw_records_seen": 0,
        "attempts": 1,
        "error": error,
        "prod_summary": None,
    }


def _zero_rows_entry(sort_type: str) -> dict:
    """Connector returned ok status but observed zero records — soft
    block. Treated as failed for sorts_succeeded purposes."""
    return {
        "sort_type": sort_type,
        "status": "ok",
        "quality_status": "ok",
        "rows_inserted": 0,
        "raw_records_seen": 0,
        "attempts": 1,
        "prod_summary": None,
    }


# -----------------------------------------------------------------------------
# Multi-sort partial success — the canonical case.
# -----------------------------------------------------------------------------


def test_partial_success_classifies_succeeded_and_failed():
    summaries = [
        _ok_entry("DATETIME_DESC", raw=2143, inserted=2029),
        _ok_entry("RATING_ASC", raw=50, inserted=12),
        _ok_entry("RATING_DESC", raw=50, inserted=8),
        _blocked_entry("USEFUL_SCORE_DESC", status="anti_bot"),
        _subprocess_failed("RECOMMENDED_DESC"),
    ]
    out = build_collection_summary(
        product_url="https://www.oliveyoung.co.kr/store/goods/getGoodsDetail.do?goodsNo=A000000171427",
        goods_no="A000000171427",
        product_name="메디힐 더마 패드 200매",
        corpus_mode="observable_multi_sort",
        primary_sort="DATETIME_DESC",
        per_sort_summaries=summaries,
        sorts_attempted_plan=[
            "DATETIME_DESC", "RATING_ASC", "RATING_DESC",
            "USEFUL_SCORE_DESC", "RECOMMENDED_DESC",
        ],
        review_count_available_after_merge=2049,
        review_count_analyzed=2029,
    )
    assert out["sorts_attempted"] == [
        "DATETIME_DESC", "RATING_ASC", "RATING_DESC",
        "USEFUL_SCORE_DESC", "RECOMMENDED_DESC",
    ]
    assert set(out["sorts_succeeded"]) == {
        "DATETIME_DESC", "RATING_ASC", "RATING_DESC",
    }
    assert set(out["sorts_failed"]) == {
        "USEFUL_SCORE_DESC", "RECOMMENDED_DESC",
    }
    assert out["partial_success"] is True
    # The anti_bot sort is also captured separately.
    assert "USEFUL_SCORE_DESC" in out["sorts_blocked_or_anti_bot"]


def test_partial_success_attempt_counts_recorded():
    summaries = [
        _ok_entry("DATETIME_DESC", attempts=1),
        _blocked_entry("RATING_ASC", attempts=3),  # 2 retries
    ]
    out = build_collection_summary(
        product_url="https://x", goods_no="A1", product_name="x",
        corpus_mode="observable_multi_sort",
        primary_sort="DATETIME_DESC",
        per_sort_summaries=summaries,
        sorts_attempted_plan=["DATETIME_DESC", "RATING_ASC"],
    )
    assert out["attempts_by_sort"]["DATETIME_DESC"] == 1
    assert out["attempts_by_sort"]["RATING_ASC"] == 3
    # retry_count = attempts - 1
    assert out["retry_count_by_sort"]["DATETIME_DESC"] == 0
    assert out["retry_count_by_sort"]["RATING_ASC"] == 2


def test_zero_rows_treated_as_failed_not_succeeded():
    """Connector reports ok but zero records observed — soft block.
    Should NOT count toward `sorts_succeeded`."""
    summaries = [
        _ok_entry("DATETIME_DESC", raw=2143, inserted=2029),
        _zero_rows_entry("RATING_ASC"),
    ]
    out = build_collection_summary(
        product_url="https://x", goods_no="A1", product_name="x",
        corpus_mode="observable_multi_sort",
        primary_sort="DATETIME_DESC",
        per_sort_summaries=summaries,
        sorts_attempted_plan=["DATETIME_DESC", "RATING_ASC"],
    )
    assert out["sorts_succeeded"] == ["DATETIME_DESC"]
    assert out["sorts_failed"] == ["RATING_ASC"]


# -----------------------------------------------------------------------------
# All succeeded — partial_success=False.
# -----------------------------------------------------------------------------


def test_all_succeeded_partial_false():
    summaries = [
        _ok_entry("DATETIME_DESC"),
        _ok_entry("RATING_ASC"),
    ]
    out = build_collection_summary(
        product_url="https://x", goods_no="A1", product_name="x",
        corpus_mode="observable_multi_sort",
        primary_sort="DATETIME_DESC",
        per_sort_summaries=summaries,
        sorts_attempted_plan=["DATETIME_DESC", "RATING_ASC"],
    )
    assert out["partial_success"] is False
    assert out["sorts_failed"] == []


def test_all_failed_partial_false_no_successes():
    summaries = [
        _blocked_entry("DATETIME_DESC"),
        _subprocess_failed("RATING_ASC"),
    ]
    out = build_collection_summary(
        product_url="https://x", goods_no="A1", product_name="x",
        corpus_mode="observable_multi_sort",
        primary_sort="DATETIME_DESC",
        per_sort_summaries=summaries,
        sorts_attempted_plan=["DATETIME_DESC", "RATING_ASC"],
    )
    # Partial success requires at least one success.
    assert out["partial_success"] is False
    assert out["sorts_succeeded"] == []
    assert set(out["sorts_failed"]) == {"DATETIME_DESC", "RATING_ASC"}


# -----------------------------------------------------------------------------
# Blocked / anti-bot detection.
# -----------------------------------------------------------------------------


def test_anti_bot_status_marked_as_blocked():
    summaries = [_blocked_entry("X", status="anti_bot")]
    out = build_collection_summary(
        product_url="https://x", goods_no="A1", product_name="x",
        corpus_mode="observable_multi_sort",
        primary_sort="X",
        per_sort_summaries=summaries,
        sorts_attempted_plan=["X"],
    )
    assert out["anti_bot_or_blocked_by_sort"]["X"] is True
    assert "X" in out["sorts_blocked_or_anti_bot"]


def test_auth_wall_marked_as_blocked():
    summaries = [_blocked_entry("X", status="anonymous_auth_wall")]
    out = build_collection_summary(
        product_url="https://x", goods_no="A1", product_name="x",
        corpus_mode="observable_multi_sort",
        primary_sort="X",
        per_sort_summaries=summaries,
        sorts_attempted_plan=["X"],
    )
    assert out["anti_bot_or_blocked_by_sort"]["X"] is True


def test_blocking_statuses_constant_includes_expected_set():
    """Hardcoded vocabulary check — if a new connector status emerges
    we want this set to be the single point of update."""
    expected = {
        "anti_bot", "anonymous_auth_wall",
        "human_check_skipped", "human_check_timeout",
        "blocked_or_empty_state",
    }
    assert expected.issubset(BLOCKING_STATUSES)


# -----------------------------------------------------------------------------
# Skip-scrape — stub sidecar with empty sort lists.
# -----------------------------------------------------------------------------


def test_skip_scrape_emits_stub_with_empty_sort_lists():
    out = build_collection_summary(
        product_url="https://x",
        goods_no="A1",
        product_name="x",
        corpus_mode="primary_only",
        primary_sort="DATETIME_DESC",
        per_sort_summaries=None,
        sorts_attempted_plan=None,
        skipped_scrape=True,
    )
    assert out["skipped_scrape"] is True
    assert out["sorts_attempted"] == []
    assert out["sorts_succeeded"] == []
    assert out["sorts_failed"] == []
    assert out["partial_success"] is False


# -----------------------------------------------------------------------------
# Schema shape — required fields.
# -----------------------------------------------------------------------------


def test_required_top_level_fields_present():
    summaries = [_ok_entry("DATETIME_DESC")]
    out = build_collection_summary(
        product_url="https://x", goods_no="A1", product_name="x",
        corpus_mode="observable_multi_sort",
        primary_sort="DATETIME_DESC",
        per_sort_summaries=summaries,
        sorts_attempted_plan=["DATETIME_DESC"],
        review_count_available_after_merge=2029,
        review_count_analyzed=2029,
    )
    required_keys = {
        "schema_version", "generated_at",
        "product_url", "goodsNo", "product_name",
        "corpus_mode", "primary_sort",
        "sorts_attempted", "sorts_succeeded", "sorts_failed",
        "partial_success", "skipped_scrape",
        "attempts_by_sort", "raw_records_seen_by_sort",
        "rows_inserted_by_sort", "quality_by_sort",
        "retry_count_by_sort", "anti_bot_or_blocked_by_sort",
        "total_raw_records_seen", "total_rows_inserted",
        "review_count_available_after_merge", "review_count_analyzed",
        "per_sort",
    }
    assert required_keys.issubset(out.keys())
    assert out["schema_version"] == COLLECTION_SUMMARY_SCHEMA_VERSION


def test_per_sort_detail_carries_error_field():
    summaries = [_subprocess_failed("X", error="rc=1 stderr=anti_bot")]
    out = build_collection_summary(
        product_url="https://x", goods_no="A1", product_name="x",
        corpus_mode="observable_multi_sort",
        primary_sort="X",
        per_sort_summaries=summaries,
        sorts_attempted_plan=["X"],
    )
    assert out["per_sort"]["X"]["error"] == "rc=1 stderr=anti_bot"


def test_totals_aggregate_across_sorts():
    summaries = [
        _ok_entry("A", raw=100, inserted=80),
        _ok_entry("B", raw=200, inserted=150),
    ]
    out = build_collection_summary(
        product_url="https://x", goods_no="A1", product_name="x",
        corpus_mode="observable_multi_sort",
        primary_sort="A",
        per_sort_summaries=summaries,
        sorts_attempted_plan=["A", "B"],
    )
    assert out["total_raw_records_seen"] == 300
    assert out["total_rows_inserted"] == 230


# -----------------------------------------------------------------------------
# Atomic write.
# -----------------------------------------------------------------------------


def test_write_creates_target_file(tmp_path: Path):
    out = build_collection_summary(
        product_url="https://x", goods_no="A1", product_name="x",
        corpus_mode="observable_multi_sort",
        primary_sort="X",
        per_sort_summaries=[_ok_entry("X")],
        sorts_attempted_plan=["X"],
    )
    target = tmp_path / "shared" / "collection_summary.json"
    written = write_collection_summary(target, out)
    assert written == target
    assert target.is_file()
    parsed = json.loads(target.read_text(encoding="utf-8"))
    assert parsed["sorts_succeeded"] == ["X"]


def test_write_atomic_no_partial_temp_file_left(tmp_path: Path):
    out = build_collection_summary(
        product_url=None, goods_no=None, product_name=None,
        corpus_mode="observable_multi_sort",
        primary_sort=None,
        per_sort_summaries=None, sorts_attempted_plan=None,
    )
    target = tmp_path / "x.json"
    write_collection_summary(target, out)
    # No leftover .tmp file.
    siblings = list(tmp_path.glob("*.tmp"))
    assert siblings == []


# -----------------------------------------------------------------------------
# Manifest extractor reads sidecar — backward compat + happy path.
# -----------------------------------------------------------------------------


class TestManifestExtractsFromSidecar:
    """Verify `scripts/run_content.py:_extract_collection_provenance`
    reads the sidecar's flat top-level fields. We import the function
    from the script via module-loader (mirrors what the orchestrator
    test does)."""

    @pytest.fixture
    def loader(self):
        import importlib.util
        from pathlib import Path
        spec = importlib.util.spec_from_file_location(
            "_run_content_for_provenance_test",
            Path("scripts/run_content.py").resolve(),
        )
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        return module

    def test_picks_up_sorts_attempted_succeeded_partial_success(
        self, loader, tmp_path: Path,
    ):
        run_dir = tmp_path / "run"
        (run_dir / "shared").mkdir(parents=True)
        sidecar = run_dir / "shared" / "collection_summary.json"
        sidecar.write_text(json.dumps({
            "sorts_attempted": ["A", "B", "C"],
            "sorts_succeeded": ["A", "B"],
            "sorts_failed": ["C"],
            "partial_success": True,
        }), encoding="utf-8")

        report = {"product": {}, "corpus": {}}
        out = loader._extract_collection_provenance(report, run_dir)
        assert out["sorts_attempted"] == ["A", "B", "C"]
        assert out["sorts_succeeded"] == ["A", "B"]
        assert out["partial_success"] is True

    def test_missing_sidecar_does_not_raise(self, loader, tmp_path: Path):
        run_dir = tmp_path / "run"
        (run_dir / "shared").mkdir(parents=True)
        report = {"product": {}, "corpus": {}}
        # Should NOT raise even when the sidecar is absent — backward
        # compat with old runs.
        out = loader._extract_collection_provenance(report, run_dir)
        assert "sorts_attempted" not in out

    def test_malformed_sidecar_does_not_raise(
        self, loader, tmp_path: Path,
    ):
        run_dir = tmp_path / "run"
        (run_dir / "shared").mkdir(parents=True)
        sidecar = run_dir / "shared" / "collection_summary.json"
        sidecar.write_text("not valid json{{", encoding="utf-8")
        report = {"product": {}, "corpus": {}}
        # Defensive — JSONDecodeError must not crash extraction.
        out = loader._extract_collection_provenance(report, run_dir)
        assert "sorts_attempted" not in out


# -----------------------------------------------------------------------------
# Lifecycle — analysis_status field + atomic update.
# -----------------------------------------------------------------------------


def _build_minimal(**overrides) -> dict:
    """Build a minimal collection_summary dict for lifecycle tests."""
    base = dict(
        product_url="https://x", goods_no="A1", product_name="x",
        corpus_mode="observable_multi_sort",
        primary_sort="DATETIME_DESC",
        per_sort_summaries=[_ok_entry("DATETIME_DESC")],
        sorts_attempted_plan=["DATETIME_DESC"],
        review_count_available_after_merge=1000,
    )
    base.update(overrides)
    return build_collection_summary(**base)


class TestAnalysisStatusField:
    def test_default_status_is_pending(self):
        out = _build_minimal()
        assert out["analysis_status"] == "pending"
        assert ANALYSIS_STATUS_PENDING == "pending"

    def test_explicit_pending_status(self):
        out = _build_minimal(analysis_status=ANALYSIS_STATUS_PENDING)
        assert out["analysis_status"] == "pending"

    def test_explicit_completed_status(self):
        out = _build_minimal(
            analysis_status=ANALYSIS_STATUS_COMPLETED,
            review_count_analyzed=950,
            completed_at="2026-05-01T13:00:00Z",
            analysis_report_path="shared/analysis_report.json",
            seller_pdf_path="seller_report/seller_report_ko.pdf",
        )
        assert out["analysis_status"] == "completed"
        assert out["review_count_analyzed"] == 950
        assert out["completed_at"] == "2026-05-01T13:00:00Z"
        assert out["analysis_report_path"].endswith("analysis_report.json")
        assert out["seller_pdf_path"].endswith("seller_report_ko.pdf")

    def test_invalid_status_rejected(self):
        with pytest.raises(ValueError, match="analysis_status"):
            _build_minimal(analysis_status="halfway_done")

    def test_pending_sidecar_has_lifecycle_fields_present_but_null(self):
        """A `pending` sidecar must carry the lifecycle field names so
        downstream readers can rely on the schema. Values are None
        until the final update flips them."""
        out = _build_minimal(analysis_status=ANALYSIS_STATUS_PENDING)
        assert "completed_at" in out
        assert "analysis_report_path" in out
        assert "seller_pdf_path" in out
        assert "review_count_analyzed" in out
        assert out["completed_at"] is None
        assert out["analysis_report_path"] is None
        assert out["seller_pdf_path"] is None


class TestUpdateCollectionSummary:
    def test_update_flips_pending_to_completed(self, tmp_path: Path):
        path = tmp_path / "collection_summary.json"
        write_collection_summary(path, _build_minimal())
        merged = update_collection_summary(
            path,
            analysis_status=ANALYSIS_STATUS_COMPLETED,
            review_count_analyzed=987,
            completed_at="2026-05-01T13:00:00Z",
        )
        assert merged["analysis_status"] == "completed"
        assert merged["review_count_analyzed"] == 987
        # Re-read from disk to confirm persistence.
        on_disk = json.loads(path.read_text(encoding="utf-8"))
        assert on_disk["analysis_status"] == "completed"
        assert on_disk["review_count_analyzed"] == 987

    def test_update_preserves_unspecified_fields(self, tmp_path: Path):
        path = tmp_path / "x.json"
        initial = _build_minimal()
        write_collection_summary(path, initial)
        update_collection_summary(
            path, analysis_status=ANALYSIS_STATUS_COMPLETED,
        )
        on_disk = json.loads(path.read_text(encoding="utf-8"))
        # Every per-sort field, every count, every product key
        # passes through verbatim — only analysis_status changes.
        for key in (
            "sorts_attempted", "sorts_succeeded", "sorts_failed",
            "attempts_by_sort", "raw_records_seen_by_sort",
            "rows_inserted_by_sort", "anti_bot_or_blocked_by_sort",
            "total_raw_records_seen", "total_rows_inserted",
            "review_count_available_after_merge",
            "product_url", "goodsNo", "product_name",
            "corpus_mode", "primary_sort", "per_sort",
        ):
            assert on_disk[key] == initial[key], (
                f"update mutated {key}: {on_disk[key]!r} vs {initial[key]!r}"
            )

    def test_update_rejects_invalid_status(self, tmp_path: Path):
        path = tmp_path / "x.json"
        write_collection_summary(path, _build_minimal())
        with pytest.raises(ValueError, match="analysis_status"):
            update_collection_summary(path, analysis_status="halfway_done")

    def test_update_atomic_no_partial_temp_file(self, tmp_path: Path):
        path = tmp_path / "x.json"
        write_collection_summary(path, _build_minimal())
        update_collection_summary(
            path, analysis_status=ANALYSIS_STATUS_COMPLETED,
        )
        # The atomic rename leaves no .tmp sibling.
        siblings = list(tmp_path.glob("*.tmp"))
        assert siblings == []

    def test_update_idempotent(self, tmp_path: Path):
        """Running the same update twice should yield the same content."""
        path = tmp_path / "x.json"
        write_collection_summary(path, _build_minimal())
        update_collection_summary(
            path,
            analysis_status=ANALYSIS_STATUS_COMPLETED,
            review_count_analyzed=900,
            completed_at="2026-05-01T13:00:00Z",
        )
        first = path.read_text(encoding="utf-8")
        update_collection_summary(
            path,
            analysis_status=ANALYSIS_STATUS_COMPLETED,
            review_count_analyzed=900,
            completed_at="2026-05-01T13:00:00Z",
        )
        second = path.read_text(encoding="utf-8")
        # Note: `generated_at` is set at build time and is NOT
        # re-rolled by update_collection_summary, so the two writes
        # must be identical.
        assert first == second

    def test_update_missing_target_raises(self, tmp_path: Path):
        path = tmp_path / "does_not_exist.json"
        with pytest.raises(FileNotFoundError):
            update_collection_summary(
                path, analysis_status=ANALYSIS_STATUS_COMPLETED,
            )

    def test_update_arbitrary_keys_not_just_status(self, tmp_path: Path):
        """update_collection_summary is a general key-merge — other
        fields can be patched too (e.g. a re-render that adds the
        seller_pdf_path after a separate PDF re-render step)."""
        path = tmp_path / "x.json"
        write_collection_summary(path, _build_minimal())
        update_collection_summary(
            path,
            seller_pdf_path="seller_report/seller_report_ko.pdf",
        )
        on_disk = json.loads(path.read_text(encoding="utf-8"))
        assert on_disk["seller_pdf_path"].endswith("seller_report_ko.pdf")
        # Status untouched.
        assert on_disk["analysis_status"] == "pending"


class TestPendingSidecarSurvivesMidAnalysisCrash:
    """Simulates the failure mode this lifecycle is designed for:
    scrape succeeds, sidecar is written, then analysis raises BEFORE
    the completed-update would fire. The pending sidecar on disk
    must remain valid JSON."""

    def test_pending_sidecar_remains_valid_json_after_simulated_crash(
        self, tmp_path: Path,
    ):
        path = tmp_path / "shared" / "collection_summary.json"
        # Phase 1: write pending sidecar.
        initial = _build_minimal()
        write_collection_summary(path, initial)

        # Phase 2: simulate a crash before the completed-update fires.
        # No try/except here — the test just doesn't perform the update.
        # The on-disk file is whatever Phase 1 left.

        # Verify: file is still parseable JSON, status is still pending.
        on_disk_text = path.read_text(encoding="utf-8")
        on_disk = json.loads(on_disk_text)
        assert on_disk["analysis_status"] == "pending"
        # All scrape-side fields are intact — the operator can re-run
        # analysis with --skip-scrape and the per-sort provenance is
        # preserved.
        assert on_disk["sorts_succeeded"] == ["DATETIME_DESC"]
        assert on_disk["review_count_available_after_merge"] == 1000

    def test_pending_then_completed_via_two_phase_commit(
        self, tmp_path: Path,
    ):
        """Happy path of the lifecycle — Phase 1 writes pending,
        Phase 2 updates to completed. Verify state at each step."""
        path = tmp_path / "x.json"

        # Phase 1.
        write_collection_summary(path, _build_minimal())
        phase1 = json.loads(path.read_text(encoding="utf-8"))
        assert phase1["analysis_status"] == "pending"
        assert phase1["review_count_analyzed"] is None

        # Phase 2.
        update_collection_summary(
            path,
            analysis_status=ANALYSIS_STATUS_COMPLETED,
            review_count_analyzed=987,
            completed_at="2026-05-01T13:00:00Z",
            analysis_report_path="shared/analysis_report.json",
            seller_pdf_path="seller_report/seller_report_ko.pdf",
        )
        phase2 = json.loads(path.read_text(encoding="utf-8"))
        assert phase2["analysis_status"] == "completed"
        assert phase2["review_count_analyzed"] == 987
        # Pre-existing fields still intact.
        assert phase2["sorts_attempted"] == phase1["sorts_attempted"]
        assert phase2["per_sort"] == phase1["per_sort"]


class TestInspectScriptHandlesPending:
    """The inspect script must NOT classify analysis_status=pending
    as a collection failure — it's a legitimate intermediate state."""

    def _run_inspect(self, run_dir: Path):
        """Subprocess-invoke inspect_run_quality and capture output."""
        import subprocess
        result = subprocess.run(
            ["python3", "scripts/inspect_run_quality.py",
             "--run-dir", str(run_dir)],
            capture_output=True, text=True, cwd=str(Path(__file__).resolve().parent.parent.parent),
        )
        return result

    def test_pending_status_reported_as_pending_not_failure(
        self, tmp_path: Path,
    ):
        run_dir = tmp_path / "2026-05-01_test-product_run-001"
        (run_dir / "shared").mkdir(parents=True)
        (run_dir / "seller_report").mkdir(parents=True)
        # Write pending sidecar (no analysis_report.json yet).
        sidecar = run_dir / "shared" / "collection_summary.json"
        write_collection_summary(sidecar, _build_minimal())

        result = self._run_inspect(run_dir)
        assert "PENDING" in result.stdout, (
            f"pending status not surfaced in inspect output:\n{result.stdout}"
        )
        # Pending state means analysis_report is expected to be absent.
        # The inspect script should NOT log it as a missing-artifact warning.
        assert "analysis_report.json missing" not in result.stdout

    def test_completed_status_reported_with_timestamp(
        self, tmp_path: Path,
    ):
        run_dir = tmp_path / "2026-05-01_test-product_run-002"
        (run_dir / "shared").mkdir(parents=True)
        sidecar = run_dir / "shared" / "collection_summary.json"
        write_collection_summary(sidecar, _build_minimal())
        update_collection_summary(
            sidecar,
            analysis_status=ANALYSIS_STATUS_COMPLETED,
            review_count_analyzed=987,
            completed_at="2026-05-01T13:00:00Z",
        )
        result = self._run_inspect(run_dir)
        assert "completed" in result.stdout.lower()
        assert "2026-05-01T13:00:00Z" in result.stdout
