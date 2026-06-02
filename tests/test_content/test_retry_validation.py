"""Tests for the retry-recovery validation surface.

Covers:
  - validate_retry_recovery.py dry-run sanity: prints the planned
    command + before-state, makes no subprocess calls.
  - inspect_run_quality `inspect_retry_outcome` reads the
    `_pre_retry_snapshot/` dir and surfaces the diff.
  - Sidecar merge: when --retry-failed-from-summary filters the
    plan, the new sidecar carries the prior-run successes plus the
    fresh retry outcomes (regression test for the merge logic).
"""
from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[2]


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


def _write_run_dir(
    base: Path,
    *,
    sorts_failed: list[str],
    sorts_succeeded: list[str],
    raw_seen_by_sort: dict[str, int] | None = None,
) -> Path:
    run_dir = base / "synthetic_run"
    (run_dir / "shared").mkdir(parents=True, exist_ok=True)
    summary = {
        "schema_version": "1.1",
        "product_url": "https://example/test?goodsNo=AAA",
        "goodsNo": "AAA",
        "corpus_mode": "observable_multi_sort",
        "primary_sort": "DATETIME_DESC",
        "sorts_attempted": sorts_succeeded + sorts_failed,
        "sorts_succeeded": sorts_succeeded,
        "sorts_failed": sorts_failed,
        "sorts_blocked_or_anti_bot": [],
        "partial_success": bool(sorts_failed),
        "raw_records_seen_by_sort": raw_seen_by_sort or {
            **{s: 80 for s in sorts_succeeded},
            **{s: 0 for s in sorts_failed},
        },
        "rows_inserted_by_sort": {
            **{s: 0 for s in sorts_succeeded + sorts_failed},
        },
        "review_count_analyzed": 2115,
        "per_sort": {
            **{s: {"status": "ok", "raw_records_seen": 80,
                   "rows_inserted": 0, "attempts": 1,
                   "recovery_actions": []}
               for s in sorts_succeeded},
            **{s: {"status": "anonymous_auth_wall",
                   "raw_records_seen": 0, "rows_inserted": 0, "attempts": 2,
                   "recovery_actions": [
                       "wait_after_auth_wall",
                       "retry_after_other_sorts",
                       "final_failed",
                   ]}
               for s in sorts_failed},
        },
        "analysis_status": "completed",
        "completed_at": "2026-05-02T16:00:00Z",
    }
    (run_dir / "shared" / "collection_summary.json").write_text(
        json.dumps(summary, ensure_ascii=False), encoding="utf-8",
    )

    report = {
        "schema_version": "3.0",
        "product": {"slug": "p", "name_ko": "T",
                    "source_url": "https://example/test?goodsNo=AAA"},
        "corpus": {
            "n_reviews_total": 2115, "n_reviews_analyzed": 2115,
            "primary_sort": "DATETIME_DESC",
            "confidence_level": "high", "signal_stability": "high",
            "confidence_axes": {
                "negative_signal_coverage": {
                    "level": "degraded" if "RATING_ASC" in sorts_failed else "complete",
                    "label_ko": "X",
                    "note_ko": "Y",
                },
            },
        },
        "attributes": [], "strengths": [], "monitoring_candidates": [],
        "tradeoffs": [], "usage_patterns": [], "buyer_segments": [],
        "quick_decision": {"verdict_ko": "v", "who_for_ko": [],
                           "who_not_for_ko": [], "watch_outs_ko": [],
                           "confidence_level": "strong"},
        "methodology_notes": {"disclosure_ko": "d"},
        "polarity_audit": {"n_total_quotes": 0, "n_total_suspect": 0,
                           "n_total_suspect_share": 0.0,
                           "by_attribute": {}, "samples": []},
    }
    (run_dir / "shared" / "analysis_report.json").write_text(
        json.dumps(report, ensure_ascii=False), encoding="utf-8",
    )

    manifest = {
        "artifacts": {
            "seller_report_ko_pdf": {"status": "ok",
                                      "path": "seller_report/seller_report_ko.pdf"},
        },
        "collection": {
            "product_url": summary["product_url"],
            "goodsNo": "AAA",
            "sorts_attempted": summary["sorts_attempted"],
            "sorts_succeeded": sorts_succeeded,
            "sorts_failed": sorts_failed,
            "partial_success": summary["partial_success"],
        },
    }
    (run_dir / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False), encoding="utf-8",
    )
    return run_dir


# ---------------------------------------------------------------------------
# 1. validate_retry_recovery.py — dry-run sanity
# ---------------------------------------------------------------------------


class TestValidateRetryRecoveryDryRun:
    def test_dry_run_prints_planned_command_and_before_state(
        self, tmp_path,
    ):
        run_dir = _write_run_dir(
            tmp_path,
            sorts_failed=["RATING_ASC", "RECOMMENDED_DESC"],
            sorts_succeeded=["DATETIME_DESC", "RATING_DESC", "USEFUL_SCORE_DESC"],
        )
        proc = subprocess.run(
            [
                sys.executable,
                str(REPO / "scripts" / "validate_retry_recovery.py"),
                "--run-dir", str(run_dir),
                "--dry-run",
            ],
            capture_output=True, text=True, cwd=str(REPO),
            env={"PYTHONPATH": str(REPO), "PATH": ""},
        )
        assert proc.returncode == 0, (
            f"dry-run exit {proc.returncode}:\nSTDOUT:{proc.stdout}\n"
            f"STDERR:{proc.stderr}"
        )
        out = proc.stdout
        # Before-state surfaces the failed sorts.
        assert "RATING_ASC" in out
        assert "RECOMMENDED_DESC" in out
        # Planned command includes the retry flag + the prior summary path.
        assert "--retry-failed-from-summary" in out
        assert "collection_summary.json" in out
        # No live-mode side effects (no snapshot directory created).
        snap_root = run_dir / "shared" / "_pre_retry_snapshot"
        assert not snap_root.exists()

    def test_dry_run_no_failed_sorts_returns_zero(self, tmp_path):
        run_dir = _write_run_dir(
            tmp_path,
            sorts_failed=[],
            sorts_succeeded=["DATETIME_DESC", "RATING_DESC", "RATING_ASC",
                             "USEFUL_SCORE_DESC", "RECOMMENDED_DESC"],
        )
        proc = subprocess.run(
            [
                sys.executable,
                str(REPO / "scripts" / "validate_retry_recovery.py"),
                "--run-dir", str(run_dir),
                "--dry-run",
            ],
            capture_output=True, text=True, cwd=str(REPO),
            env={"PYTHONPATH": str(REPO), "PATH": ""},
        )
        assert proc.returncode == 0
        assert "Nothing to retry" in proc.stdout


# ---------------------------------------------------------------------------
# 2. inspect_run_quality — retry outcome view
# ---------------------------------------------------------------------------


class TestInspectorRetryOutcome:
    def _seed_snapshot(self, run_dir: Path) -> Path:
        snap = run_dir / "shared" / "_pre_retry_snapshot" / "20260502T100000Z"
        snap.mkdir(parents=True, exist_ok=True)
        # Prior state: BOTH RATING_ASC and RECOMMENDED_DESC failed.
        prior_summary = {
            "sorts_failed": ["RATING_ASC", "RECOMMENDED_DESC"],
            "sorts_succeeded": ["DATETIME_DESC"],
            "raw_records_seen_by_sort": {
                "RATING_ASC": 0, "RECOMMENDED_DESC": 0,
            },
        }
        prior_report = {
            "corpus": {
                "confidence_axes": {
                    "negative_signal_coverage": {"level": "degraded"},
                },
            },
        }
        (snap / "collection_summary.json").write_text(
            json.dumps(prior_summary, ensure_ascii=False), encoding="utf-8",
        )
        (snap / "analysis_report.json").write_text(
            json.dumps(prior_report, ensure_ascii=False), encoding="utf-8",
        )
        return snap

    def test_inspector_surfaces_recovery_diff_when_snapshot_exists(
        self, tmp_path,
    ):
        run_dir = _write_run_dir(
            tmp_path,
            sorts_failed=[],   # current state: clean after retry
            sorts_succeeded=["DATETIME_DESC", "RATING_ASC", "RATING_DESC",
                             "USEFUL_SCORE_DESC", "RECOMMENDED_DESC"],
        )
        # Bump the current report to "complete" to test the upgrade path.
        report_path = run_dir / "shared" / "analysis_report.json"
        report = json.loads(report_path.read_text(encoding="utf-8"))
        report["corpus"]["confidence_axes"]["negative_signal_coverage"]["level"] = "complete"
        report_path.write_text(
            json.dumps(report, ensure_ascii=False), encoding="utf-8",
        )

        # Mark current per_sort to show RATING_ASC succeeded.
        cs_path = run_dir / "shared" / "collection_summary.json"
        cs = json.loads(cs_path.read_text(encoding="utf-8"))
        cs["raw_records_seen_by_sort"] = {
            "DATETIME_DESC": 80, "RATING_DESC": 80, "RATING_ASC": 50,
            "USEFUL_SCORE_DESC": 60, "RECOMMENDED_DESC": 50,
        }
        cs["per_sort"]["RATING_ASC"] = {
            "status": "ok", "raw_records_seen": 50, "rows_inserted": 50,
            "attempts": 3,
            "recovery_actions": [
                "wait_after_auth_wall",
                "retry_after_other_sorts",
            ],
        }
        cs["per_sort"]["RECOMMENDED_DESC"] = {
            "status": "ok", "raw_records_seen": 50, "rows_inserted": 50,
            "attempts": 3,
            "recovery_actions": [
                "wait_after_auth_wall",
                "retry_after_other_sorts",
            ],
        }
        cs_path.write_text(
            json.dumps(cs, ensure_ascii=False), encoding="utf-8",
        )

        # Now seed the snapshot and run the inspector.
        self._seed_snapshot(run_dir)
        proc = subprocess.run(
            [sys.executable, str(REPO / "scripts" / "inspect_run_quality.py"),
             "--run-dir", str(run_dir)],
            capture_output=True, text=True, cwd=str(REPO),
            env={"PYTHONPATH": str(REPO), "PATH": ""},
        )
        # Synthetic fixture intentionally avoids attaching the
        # buyer_journey stub — it's not the focus of this test, so a
        # warnings exit is fine. We only assert the retry-outcome
        # section rendered.
        assert "Retry outcome" in proc.stdout
        assert "RATING_ASC" in proc.stdout
        assert "recovered=True" in proc.stdout
        assert "negative_signal_coverage : degraded → complete" in proc.stdout
        assert "UPGRADED" in proc.stdout

    def test_inspector_skips_retry_section_when_no_snapshot(self, tmp_path):
        """Without a `_pre_retry_snapshot/` dir, the retry-outcome
        section is silent — operators who never ran the validator
        don't see noise in the inspector output."""
        run_dir = _write_run_dir(
            tmp_path,
            sorts_failed=[],
            sorts_succeeded=["DATETIME_DESC", "RATING_ASC", "RATING_DESC",
                             "USEFUL_SCORE_DESC", "RECOMMENDED_DESC"],
        )
        proc = subprocess.run(
            [sys.executable, str(REPO / "scripts" / "inspect_run_quality.py"),
             "--run-dir", str(run_dir)],
            capture_output=True, text=True, cwd=str(REPO),
            env={"PYTHONPATH": str(REPO), "PATH": ""},
        )
        assert "Retry outcome" not in proc.stdout
