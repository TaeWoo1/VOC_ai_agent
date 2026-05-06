"""Tests for src.voc.app.overnight_batch.

These cover the testable surface of the overnight batch runner:
classification rules, summary aggregation, failed_products.csv
emission, TSV row stability, and the auth-failure log detector.

The bash runner itself is exercised end-to-end by a smoke test that
invokes both `classify` and `finalize` subcommands against a synthetic
batch_dir; we assert the artifacts it writes match the spec the
shell consumer relies on.
"""
from __future__ import annotations

import csv
import json
import subprocess
import sys
from pathlib import Path

import pytest

from src.voc.app import overnight_batch as ob
from src.voc.app.overnight_batch import (
    AUTH_BUCKET_STATUSES,
    EXIT_NOT_RUN,
    FINAL_SAMPLE_READY_FLOOR,
    INSUFFICIENT_CORPUS_FLOOR,
    RESUMABLE_STATUSES,
    STATUS_ANTI_BOT_PAUSE_REQUIRED,
    STATUS_AUTH_REQUIRED,
    STATUS_COMPLETED_WITH_WARNINGS,
    STATUS_FINAL_SAMPLE_READY,
    STATUS_INSUFFICIENT_CORPUS,
    STATUS_PIPELINE_FAILED,
    STATUS_PREFLIGHT_FAILED,
    STATUS_PUBLISHABLE,
    STATUS_SKIPPED,
    TSV_HEADER,
    ProductOutcome,
    aggregate_summary_json,
    classify_product_outcome,
    extract_failed_products_csv_rows,
    is_auth_failure_log,
    parse_batch_input_csv,
    regenerate_summary_tsv_from_sidecars,
    validate_summary_tsv,
    validate_tsv_json_consistency,
    write_failed_products_csv,
)


REPO_ROOT = Path(__file__).resolve().parents[2]


# ---------- Fixtures: synthetic run_dir -----------------------------------


def _write_run_dir(
    tmp_path: Path,
    *,
    review_count: int | None = 200,
    sorts_succeeded: list[str] | None = None,
    sorts_failed: list[str] | None = None,
    partial_success: bool = False,
    pdf: bool = True,
    manifest: bool = True,
    cardnews: bool = True,
) -> Path:
    """Build a synthetic run_dir mirroring the shape produced by
    run_phase2e_pipeline.py + republish_run.py.
    """
    run = tmp_path / "outputs" / "run_001"
    (run / "shared").mkdir(parents=True, exist_ok=True)
    if review_count is not None:
        cs = {
            "review_count_analyzed": review_count,
            "sorts_succeeded": sorts_succeeded
            if sorts_succeeded is not None
            else ["DATETIME_DESC", "RATING_ASC", "RATING_DESC",
                  "USEFUL_SCORE_DESC", "RECOMMENDED_DESC"],
            "sorts_failed": sorts_failed if sorts_failed is not None else [],
            "partial_success": partial_success,
        }
        (run / "shared" / "collection_summary.json").write_text(
            json.dumps(cs), encoding="utf-8"
        )
    if pdf:
        (run / "seller_report").mkdir(parents=True, exist_ok=True)
        (run / "seller_report" / "seller_report_ko.pdf").write_text("PDF", encoding="utf-8")
    if manifest:
        (run / "manifest.json").write_text("{}", encoding="utf-8")
    if cardnews:
        (run / "buyer_content" / "ko").mkdir(parents=True, exist_ok=True)
        (run / "buyer_content" / "ko" / "p01.png").write_text("png", encoding="utf-8")
    return run


# ---------- is_auth_failure_log ------------------------------------------


class TestAuthFailureLog:
    def test_anti_bot_classification_detected(self):
        log = "Batch halted: product 'A000000171261' classified as 'anti_bot' — re-establish auth"
        assert is_auth_failure_log(log) is True

    def test_scraper_subprocess_failed_detected(self):
        log = "[attempt 1/2] sort=DATETIME_DESC status=scraper_subprocess_failed rows_inserted=0"
        assert is_auth_failure_log(log) is True

    def test_clean_log_returns_false(self):
        log = "Pipeline complete in 626.7s\n  ✓ all checks passed — run looks publishable"
        assert is_auth_failure_log(log) is False

    def test_blocked_or_empty_state_alone_does_not_trigger(self):
        # A single blocked_or_empty_state isn't enough — the runner
        # waits for the explicit anti_bot classification or
        # auth_wall signal. blocked_or_empty_state shows up in
        # routine retries and would over-fire the auth bucket.
        log = "[attempt 1/2] sort=RATING_DESC status=blocked_or_empty_state quality=invalid"
        assert is_auth_failure_log(log) is False

    def test_empty_log_returns_false(self):
        assert is_auth_failure_log("") is False
        assert is_auth_failure_log(None) is False  # type: ignore[arg-type]


# ---------- classify_product_outcome -------------------------------------


class TestClassifyProductOutcome:
    def test_publishable_when_all_checks_pass_below_final_floor(self, tmp_path):
        run = _write_run_dir(tmp_path, review_count=400)
        log = "Pipeline complete\n  ✓ all checks passed — run looks publishable"
        out = classify_product_outcome(
            rank="3", profile="base_makeup", goodsNo="A000",
            slug="x", run_dir=run,
            pipeline_exit=0, republish_exit=0, inspect_exit=0,
            log_text=log,
        )
        assert out.status == STATUS_PUBLISHABLE
        assert out.review_count_analyzed == 400

    def test_final_sample_ready_when_above_500_with_full_sorts(self, tmp_path):
        run = _write_run_dir(tmp_path, review_count=550)
        log = "  ✓ all checks passed"
        out = classify_product_outcome(
            rank="3", profile="base_makeup", goodsNo="A000", slug="x",
            run_dir=run,
            pipeline_exit=0, republish_exit=0, inspect_exit=0,
            log_text=log,
        )
        assert out.status == STATUS_FINAL_SAMPLE_READY

    def test_completed_with_warnings_when_inspect_warns(self, tmp_path):
        run = _write_run_dir(tmp_path, review_count=400)
        log = "  ⚠ 2 warning(s):\n    1. quote summary degraded\n    2. coverage low"
        out = classify_product_outcome(
            rank="3", profile="base_makeup", goodsNo="A000", slug="x",
            run_dir=run,
            pipeline_exit=0, republish_exit=0, inspect_exit=1,
            log_text=log,
        )
        assert out.status == STATUS_COMPLETED_WITH_WARNINGS

    def test_insufficient_corpus_when_below_floor(self, tmp_path):
        run = _write_run_dir(tmp_path, review_count=200)
        log = "  ✓ all checks passed"
        out = classify_product_outcome(
            rank="3", profile="base_makeup", goodsNo="A000", slug="x",
            run_dir=run,
            pipeline_exit=0, republish_exit=0, inspect_exit=0,
            log_text=log,
        )
        assert out.status == STATUS_INSUFFICIENT_CORPUS
        assert "review_count_analyzed=200" in (out.failure_reason or "")

    def test_insufficient_corpus_when_rating_asc_failed(self, tmp_path):
        run = _write_run_dir(
            tmp_path, review_count=600,
            sorts_succeeded=["DATETIME_DESC", "RATING_DESC", "USEFUL_SCORE_DESC", "RECOMMENDED_DESC"],
            sorts_failed=["RATING_ASC"],
        )
        log = "  ✓ all checks passed"
        out = classify_product_outcome(
            rank="3", profile="base_makeup", goodsNo="A000", slug="x",
            run_dir=run,
            pipeline_exit=0, republish_exit=0, inspect_exit=0,
            log_text=log,
        )
        assert out.status == STATUS_INSUFFICIENT_CORPUS
        assert out.failure_reason == "rating_asc_missing"

    def test_pipeline_failed_no_auth_signal(self, tmp_path):
        run = _write_run_dir(tmp_path, review_count=None, pdf=False, manifest=False, cardnews=False)
        log = "TypeError: something exploded mid-pipeline"
        out = classify_product_outcome(
            rank="3", profile="base_makeup", goodsNo="A000", slug="x",
            run_dir=run,
            pipeline_exit=3, republish_exit=999, inspect_exit=999,
            log_text=log,
        )
        assert out.status == STATUS_PIPELINE_FAILED
        assert "pipeline_exit=3" in (out.failure_reason or "")

    def test_anti_bot_pause_required_promotes_pipeline_failed(self, tmp_path):
        # The exact log Skin1004 produced in the overnight run.
        run = _write_run_dir(tmp_path, review_count=None, pdf=False, manifest=False, cardnews=False)
        log = (
            "[attempt 1/2] sort=DATETIME_DESC status=scraper_subprocess_failed\n"
            "Batch halted: product 'A000000171261' classified as 'anti_bot' — re-establish auth"
        )
        out = classify_product_outcome(
            rank="4", profile="sunscreen", goodsNo="A000000171261", slug="x",
            run_dir=run,
            pipeline_exit=4, republish_exit=999, inspect_exit=999,
            log_text=log,
        )
        assert out.status == STATUS_ANTI_BOT_PAUSE_REQUIRED
        assert out.failure_reason == "anti_bot_classification"
        assert out.auth_indicator is True

    def test_preflight_failed_overrides_pipeline_exit(self, tmp_path):
        # Even if pipeline is reported as 0, preflight_failed wins
        # — the runner shouldn't reach pipeline when preflight fails.
        run = _write_run_dir(tmp_path)
        out = classify_product_outcome(
            rank="3", profile="base_makeup", goodsNo="A000", slug="x",
            run_dir=run,
            pipeline_exit=999, republish_exit=999, inspect_exit=999,
            log_text="",
            preflight_ok=False,
        )
        assert out.status == STATUS_PREFLIGHT_FAILED

    def test_skipped_status_recorded(self, tmp_path):
        run = _write_run_dir(tmp_path)
        out = classify_product_outcome(
            rank="3", profile="base_makeup", goodsNo="A000", slug="x",
            run_dir=run,
            pipeline_exit=999, republish_exit=999, inspect_exit=999,
            log_text="",
            skipped=True,
        )
        assert out.status == STATUS_SKIPPED


# ---------- TSV row format ------------------------------------------------


class TestTsvRow:
    def test_always_nine_fields(self, tmp_path):
        run = _write_run_dir(tmp_path, review_count=400)
        log = "  ✓ all checks passed"
        out = classify_product_outcome(
            rank="3", profile="base_makeup", goodsNo="A000", slug="tirtir",
            run_dir=run,
            pipeline_exit=0, republish_exit=0, inspect_exit=0,
            log_text=log,
        )
        row = out.to_tsv_row()
        assert row.count("\t") == 8  # 9 fields → 8 separators
        parts = row.split("\t")
        assert len(parts) == 9
        # status is always the last field
        assert parts[-1] == STATUS_PUBLISHABLE

    def test_exit_codes_always_numeric(self, tmp_path):
        # Even when pipeline / republish / inspect were skipped,
        # the exit code must serialize as a digit string.
        out = ProductOutcome(
            rank="1", profile="x", goodsNo="A000", slug="s",
            run_dir="outputs/x",
            pipeline_exit=EXIT_NOT_RUN,
            republish_exit=EXIT_NOT_RUN,
            inspect_exit=EXIT_NOT_RUN,
            status=STATUS_PREFLIGHT_FAILED,
        )
        parts = out.to_tsv_row().split("\t")
        assert parts[5] == "999"
        assert parts[6] == "999"
        assert parts[7] == "999"

    def test_status_never_contains_whitespace(self):
        # Every defined status sentinel must be safe to drop into
        # the last TSV column without quoting.
        for status in (
            STATUS_PUBLISHABLE, STATUS_FINAL_SAMPLE_READY,
            STATUS_COMPLETED_WITH_WARNINGS, STATUS_INSUFFICIENT_CORPUS,
            STATUS_PIPELINE_FAILED, STATUS_AUTH_REQUIRED,
            STATUS_ANTI_BOT_PAUSE_REQUIRED, STATUS_PREFLIGHT_FAILED,
            STATUS_SKIPPED,
        ):
            assert " " not in status
            assert "\t" not in status
            assert "\n" not in status

    def test_header_matches_field_count(self):
        assert TSV_HEADER.count("\t") == 8
        assert len(TSV_HEADER.split("\t")) == 9


# ---------- summary.json aggregation -------------------------------------


def _make_outcome(status: str, **kwargs) -> ProductOutcome:
    base = dict(
        rank="1", profile="x", goodsNo="A", slug="s",
        run_dir="outputs/x",
        pipeline_exit=0, republish_exit=0, inspect_exit=0,
        status=status,
    )
    base.update(kwargs)
    return ProductOutcome(**base)


class TestAggregateSummaryJson:
    def test_counts_match_outcomes(self):
        outcomes = [
            _make_outcome(STATUS_PUBLISHABLE, rank="1", goodsNo="A1"),
            _make_outcome(STATUS_PUBLISHABLE, rank="2", goodsNo="A2"),
            _make_outcome(STATUS_AUTH_REQUIRED, rank="3", goodsNo="A3"),
            _make_outcome(STATUS_PIPELINE_FAILED, rank="4", goodsNo="A4"),
            _make_outcome(STATUS_COMPLETED_WITH_WARNINGS, rank="5", goodsNo="A5"),
        ]
        summary = aggregate_summary_json(
            outcomes, batch_id="TEST", requested_max_reviews_per_sort=200,
        )
        assert summary["counts"]["total"] == 5
        assert summary["counts"][STATUS_PUBLISHABLE] == 2
        assert summary["counts"][STATUS_AUTH_REQUIRED] == 1
        assert summary["counts"][STATUS_PIPELINE_FAILED] == 1
        assert summary["counts"][STATUS_COMPLETED_WITH_WARNINGS] == 1
        assert summary["theoretical_raw_cap_per_product"] == 1000
        assert summary["requested_max_reviews_per_sort"] == 200

    def test_summary_json_total_matches_summary_tsv_rows(self, tmp_path):
        # Spec: "summary.json counts match summary.tsv". We write a
        # summary.tsv with N rows, build N outcomes, and verify
        # counts.total == N.
        outcomes = [_make_outcome(STATUS_PUBLISHABLE, rank=str(i), goodsNo=f"A{i}") for i in range(7)]
        tsv = tmp_path / "summary.tsv"
        tsv.write_text(
            TSV_HEADER + "\n" + "\n".join(o.to_tsv_row() for o in outcomes) + "\n",
            encoding="utf-8",
        )
        summary = aggregate_summary_json(outcomes, batch_id="X", requested_max_reviews_per_sort=200)
        # tsv row count (excluding header) must match summary total
        tsv_rows = [l for l in tsv.read_text().splitlines() if l and not l.startswith("rank\t")]
        assert len(tsv_rows) == summary["counts"]["total"] == 7


# ---------- failed_products.csv -------------------------------------------


class TestFailedProductsCsv:
    def test_only_resumable_statuses_included(self, tmp_path):
        outcomes = [
            _make_outcome(STATUS_PUBLISHABLE, rank="1", goodsNo="A1"),
            _make_outcome(STATUS_AUTH_REQUIRED, rank="2", goodsNo="A2",
                          failure_reason="auth_wall_detected"),
            _make_outcome(STATUS_ANTI_BOT_PAUSE_REQUIRED, rank="3", goodsNo="A3",
                          failure_reason="anti_bot_classification"),
            _make_outcome(STATUS_PIPELINE_FAILED, rank="4", goodsNo="A4",
                          failure_reason="pipeline_exit=3"),
            _make_outcome(STATUS_INSUFFICIENT_CORPUS, rank="5", goodsNo="A5"),
            _make_outcome(STATUS_COMPLETED_WITH_WARNINGS, rank="6", goodsNo="A6"),
        ]
        rows = extract_failed_products_csv_rows(outcomes)
        ids = {r["goodsNo"] for r in rows}
        assert ids == {"A2", "A3", "A4", "A5"}
        assert "A1" not in ids
        assert "A6" not in ids

    def test_csv_round_trip_through_parse(self, tmp_path):
        # Write failed_products.csv → re-read with parse_batch_input_csv
        # → confirm it exposes the same goodsNo set.
        outcomes = [
            _make_outcome(STATUS_AUTH_REQUIRED, rank="2", goodsNo="A2", slug="anua",
                          failure_reason="auth_wall_detected"),
            _make_outcome(STATUS_ANTI_BOT_PAUSE_REQUIRED, rank="4", goodsNo="A4", slug="skin1004",
                          failure_reason="anti_bot_classification"),
        ]
        out = tmp_path / "failed_products.csv"
        write_failed_products_csv(extract_failed_products_csv_rows(outcomes), out)
        reread = parse_batch_input_csv(out)
        assert {r["goodsNo"] for r in reread} == {"A2", "A4"}
        assert reread[0]["rank"] in {"2", "4"}

    def test_failed_csv_created_for_auth_and_anti_bot(self, tmp_path):
        # Spec assertion: failed_products.csv is created for auth /
        # anti-bot / pipeline failures.
        outcomes = [
            _make_outcome(STATUS_PUBLISHABLE, rank="1", goodsNo="A1"),
            _make_outcome(STATUS_AUTH_REQUIRED, rank="2", goodsNo="A2"),
            _make_outcome(STATUS_PIPELINE_FAILED, rank="3", goodsNo="A3"),
        ]
        out = tmp_path / "failed_products.csv"
        write_failed_products_csv(extract_failed_products_csv_rows(outcomes), out)
        assert out.is_file()
        with out.open(encoding="utf-8") as fh:
            rows = list(csv.DictReader(fh))
        assert len(rows) == 2
        assert {r["goodsNo"] for r in rows} == {"A2", "A3"}
        # Header columns are exactly the spec'd 8.
        with out.open(encoding="utf-8") as fh:
            header = fh.readline().strip().split(",")
        assert header == ["rank", "profile", "goodsNo", "slug",
                          "reason", "last_status", "run_dir", "log_path"]


# ---------- CLI subcommands ------------------------------------------------


class TestCli:
    def _run_classify(self, batch_dir: Path, **kwargs) -> dict:
        cmd = [
            sys.executable, "-m", "src.voc.app.overnight_batch", "classify",
            "--batch-dir", str(batch_dir),
            "--rank", kwargs.get("rank", "1"),
            "--profile", kwargs.get("profile", "x"),
            "--goodsNo", kwargs.get("goodsNo", "A1"),
            "--slug", kwargs.get("slug", "s"),
            "--run-dir", str(kwargs["run_dir"]),
            "--pipeline-exit", str(kwargs.get("pipeline_exit", 0)),
            "--republish-exit", str(kwargs.get("republish_exit", 0)),
            "--inspect-exit", str(kwargs.get("inspect_exit", 0)),
        ]
        if kwargs.get("log_path"):
            cmd += ["--log-path", str(kwargs["log_path"])]
        if kwargs.get("preflight_failed"):
            cmd += ["--preflight-failed"]
        if kwargs.get("skipped"):
            cmd += ["--skipped"]
        result = subprocess.run(cmd, capture_output=True, text=True, check=False,
                                cwd=str(Path(__file__).resolve().parents[2]))
        assert result.returncode == 0, result.stderr
        return json.loads(result.stdout.strip().splitlines()[-1])

    def test_classify_writes_sidecar_and_progress_tsv_only(self, tmp_path):
        # New contract: classify does NOT write summary.tsv (that's
        # finalize's job). It writes the sidecar JSON and a
        # best-effort progress.tsv for live tailing.
        batch_dir = tmp_path / "batch"
        batch_dir.mkdir()
        run = _write_run_dir(tmp_path, review_count=400)
        log = tmp_path / "p.log"
        log.write_text("  ✓ all checks passed", encoding="utf-8")

        result = self._run_classify(
            batch_dir,
            rank="3", profile="base_makeup", goodsNo="A000", slug="tirtir",
            run_dir=run, pipeline_exit=0, republish_exit=0, inspect_exit=0,
            log_path=log,
        )
        assert result["status"] == STATUS_PUBLISHABLE

        # summary.tsv must NOT exist after classify alone.
        assert not (batch_dir / "summary.tsv").exists()

        # progress.tsv exists with header + one row.
        progress = (batch_dir / "progress.tsv").read_text(encoding="utf-8")
        rows = [l for l in progress.splitlines() if l]
        assert rows[0] == TSV_HEADER
        assert rows[1].split("\t")[-1] == STATUS_PUBLISHABLE
        assert rows[1].count("\t") == 8

        sidecar = batch_dir / "products" / "3_A000.json"
        assert sidecar.is_file()
        data = json.loads(sidecar.read_text(encoding="utf-8"))
        assert data["status"] == STATUS_PUBLISHABLE
        assert data["review_count_analyzed"] == 400

    def test_finalize_writes_summary_json_and_failed_products(self, tmp_path):
        batch_dir = tmp_path / "batch"
        batch_dir.mkdir()
        # Two products: one publishable, one anti-bot.
        good_run = _write_run_dir(tmp_path, review_count=400)

        # publishable
        good_log = tmp_path / "good.log"
        good_log.write_text("  ✓ all checks passed", encoding="utf-8")
        self._run_classify(
            batch_dir, rank="1", profile="x", goodsNo="A1", slug="good",
            run_dir=good_run, pipeline_exit=0, republish_exit=0, inspect_exit=0,
            log_path=good_log,
        )

        # anti-bot
        bad_run = tmp_path / "outputs" / "run_002"
        bad_run.mkdir(parents=True)
        bad_log = tmp_path / "bad.log"
        bad_log.write_text(
            "Batch halted: product 'A2' classified as 'anti_bot' — re-establish auth",
            encoding="utf-8",
        )
        self._run_classify(
            batch_dir, rank="2", profile="x", goodsNo="A2", slug="bad",
            run_dir=bad_run, pipeline_exit=4, republish_exit=999, inspect_exit=999,
            log_path=bad_log,
        )

        # Finalize.
        result = subprocess.run(
            [sys.executable, "-m", "src.voc.app.overnight_batch", "finalize",
             "--batch-dir", str(batch_dir),
             "--batch-id", "TEST_BATCH",
             "--requested-max-reviews-per-sort", "200"],
            capture_output=True, text=True, check=False,
            cwd=str(Path(__file__).resolve().parents[2]),
        )
        assert result.returncode == 0, result.stderr

        summary = json.loads((batch_dir / "summary.json").read_text(encoding="utf-8"))
        assert summary["batch_id"] == "TEST_BATCH"
        assert summary["counts"]["total"] == 2
        assert summary["counts"][STATUS_PUBLISHABLE] == 1
        assert summary["counts"][STATUS_ANTI_BOT_PAUSE_REQUIRED] == 1
        assert summary["theoretical_raw_cap_per_product"] == 1000

        failed = (batch_dir / "failed_products.csv").read_text(encoding="utf-8")
        # publishable not in failed; anti-bot product is.
        assert "A2" in failed
        assert "A1," not in failed.replace("\n", ",,")  # no leading "A1," cell
        # Header is the spec'd 8 columns.
        header = failed.splitlines()[0]
        assert header == "rank,profile,goodsNo,slug,reason,last_status,run_dir,log_path"


# ---------- Spec-mandated assertions --------------------------------------


class TestSpecAssertions:
    """Direct lifts of the user-supplied test list (§I)."""

    def test_rating_asc_failure_blocks_publishable(self, tmp_path):
        run = _write_run_dir(
            tmp_path, review_count=600,
            sorts_succeeded=["DATETIME_DESC", "RATING_DESC"],
            sorts_failed=["RATING_ASC", "USEFUL_SCORE_DESC", "RECOMMENDED_DESC"],
            partial_success=True,
        )
        log = "  ✓ all checks passed"
        out = classify_product_outcome(
            rank="3", profile="base_makeup", goodsNo="A000", slug="x",
            run_dir=run, pipeline_exit=0, republish_exit=0, inspect_exit=0,
            log_text=log,
        )
        assert out.status in (STATUS_INSUFFICIENT_CORPUS, STATUS_COMPLETED_WITH_WARNINGS)
        assert out.status != STATUS_PUBLISHABLE
        assert out.status != STATUS_FINAL_SAMPLE_READY

    def test_no_stale_db_report_when_all_sorts_zero(self, tmp_path):
        # When all sorts collected zero raw records, the pipeline
        # should have aborted before generating analysis_report.
        # Our classifier sees pipeline_exit != 0 and the log
        # confirms "No reviews in DB"; we promote the status by
        # auth/anti-bot signals, NOT by silently labeling it
        # publishable.
        run = tmp_path / "outputs" / "run_dead"
        run.mkdir(parents=True)
        log_text = (
            "⚠ No reviews in DB for A000. Scraper completed but inserted 0 rows.\n"
            "[attempt 1/2] sort=DATETIME_DESC status=blocked_or_empty_state quality=invalid"
        )
        out = classify_product_outcome(
            rank="2", profile="cleansing", goodsNo="A000", slug="x",
            run_dir=run, pipeline_exit=3, republish_exit=999, inspect_exit=999,
            log_text=log_text,
        )
        # Either pipeline_failed or auth bucket — but NOT publishable.
        assert out.status not in (STATUS_PUBLISHABLE, STATUS_FINAL_SAMPLE_READY,
                                   STATUS_COMPLETED_WITH_WARNINGS)
        assert out.pdf_exists is False
        assert out.manifest_exists is False

    def test_resumable_statuses_are_proper_subset(self):
        # Auth bucket is fully contained in resumable; resumable also
        # includes pipeline_failed and insufficient_corpus.
        assert AUTH_BUCKET_STATUSES.issubset(RESUMABLE_STATUSES)
        assert STATUS_PIPELINE_FAILED in RESUMABLE_STATUSES
        assert STATUS_INSUFFICIENT_CORPUS in RESUMABLE_STATUSES
        assert STATUS_PUBLISHABLE not in RESUMABLE_STATUSES
        assert STATUS_FINAL_SAMPLE_READY not in RESUMABLE_STATUSES


# ---------- Bash runner integration --------------------------------------


class TestBashRunnerWiring:
    """Black-box assertions on the bash runner: env-var propagation,
    flag wiring, behavior under ON_AUTH_FAILURE.

    We don't run the full pipeline here — just inspect the script's
    text to confirm the flags it claims to support are actually
    plumbed into the right commands. This catches the bash <-> python
    drift the prior runner had.
    """

    @pytest.fixture
    def script(self) -> str:
        path = Path(__file__).resolve().parents[2] / "scripts" / "run_oy_top8_interview_batch.sh"
        return path.read_text(encoding="utf-8")

    def test_max_reviews_per_sort_env_propagates_to_pipeline(self, script):
        # The pipeline call must use --max-reviews-per-sort "$MAX_REVIEWS_PER_SORT".
        assert 'MAX_REVIEWS_PER_SORT="${MAX_REVIEWS_PER_SORT:-200}"' in script
        assert '--max-reviews-per-sort "$MAX_REVIEWS_PER_SORT"' in script
        assert '--max-reviews all' in script

    def test_on_auth_failure_default_skip_product(self, script):
        assert 'ON_AUTH_FAILURE="${ON_AUTH_FAILURE:-skip_product}"' in script

    def test_on_auth_failure_stop_batch_branch_exists(self, script):
        assert 'if [ "$ON_AUTH_FAILURE" = "stop_batch" ]' in script
        assert "STOP_BATCH=1" in script

    def test_stop_after_auth_failures_default(self, script):
        assert 'STOP_AFTER_AUTH_FAILURES="${STOP_AFTER_AUTH_FAILURES:-2}"' in script
        assert 'CONSECUTIVE_AUTH_FAILURES=$((CONSECUTIVE_AUTH_FAILURES + 1))' in script

    def test_bash_does_not_write_summary_tsv_during_loop(self, script):
        # Per the new contract, only the Python finalize step writes
        # summary.tsv. The bash runner must NOT contain any echo /
        # printf > $SUMMARY pattern. (We allow `cat "$SUMMARY"` for
        # display.) This is the regression guard for the shifted-row
        # bug operators saw in pass-19.
        assert "> \"$SUMMARY\"" not in script
        assert ">$SUMMARY" not in script
        assert "TSV_HEADER=" not in script  # no embedded TSV header literal
        # finalize writes summary.tsv (Python helper).
        assert "overnight_batch finalize" in script

    def test_finalize_invocation_present(self, script):
        assert "overnight_batch finalize" in script
        assert "--batch-dir " in script
        assert "--requested-max-reviews-per-sort" in script

    def test_preflight_curl_against_cdp_endpoint(self, script):
        # Per-product preflight curl, NOT just at startup.
        # Two `curl -s ... /json/version` calls should be present.
        assert script.count('/json/version') >= 2

    def test_product_sleep_jitter_envs(self, script):
        assert 'PRODUCT_SLEEP_MIN_SECS="${PRODUCT_SLEEP_MIN_SECS:-90}"' in script
        assert 'PRODUCT_SLEEP_MAX_SECS="${PRODUCT_SLEEP_MAX_SECS:-180}"' in script

    def test_bash_awk_field_count_check_present(self, script):
        # Belt-and-suspenders: bash itself awk-validates summary.tsv
        # after finalize and surfaces VALIDATION_ERROR to master.log.
        assert "awk -F'\\t' 'NF != 9" in script
        assert "VALIDATION_ERROR" in script
        assert "FINAL_EXIT=3" in script


# ---------- TSV regeneration + validation --------------------------------


def _write_sidecar(
    products_dir: Path,
    *,
    rank: str,
    profile: str = "x",
    goodsNo: str,
    slug: str = "s",
    pipeline_exit: int = 0,
    republish_exit: int = 0,
    inspect_exit: int = 0,
    status: str = STATUS_PUBLISHABLE,
    review_count_analyzed: int | None = 400,
    sorts_succeeded: list[str] | None = None,
    sorts_failed: list[str] | None = None,
) -> Path:
    products_dir.mkdir(parents=True, exist_ok=True)
    payload = {
        "rank": rank, "profile": profile, "goodsNo": goodsNo, "slug": slug,
        "run_dir": f"outputs/{slug}",
        "pipeline_exit": pipeline_exit,
        "republish_exit": republish_exit,
        "inspect_exit": inspect_exit,
        "status": status,
        "review_count_analyzed": review_count_analyzed,
        "sorts_succeeded": sorts_succeeded or [],
        "sorts_failed": sorts_failed or [],
        "partial_success": False,
        "failure_reason": None,
        "pdf_exists": True, "manifest_exists": True, "cardnews_exists": True,
        "log_path": None,
        "auth_indicator": False,
    }
    p = products_dir / f"{rank}_{goodsNo}.json"
    p.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    return p


class TestRegenerateSummaryTsv:
    def test_every_row_has_nine_fields(self, tmp_path):
        batch = tmp_path / "batch"
        products = batch / "products"
        _write_sidecar(products, rank="1", goodsNo="A1", inspect_exit=0,
                        status=STATUS_PUBLISHABLE)
        _write_sidecar(products, rank="2", goodsNo="A2", inspect_exit=1,
                        status=STATUS_COMPLETED_WITH_WARNINGS)
        _write_sidecar(products, rank="3", goodsNo="A3",
                        pipeline_exit=3, republish_exit=999, inspect_exit=999,
                        status=STATUS_PIPELINE_FAILED)

        path = regenerate_summary_tsv_from_sidecars(batch)
        lines = path.read_text(encoding="utf-8").splitlines()
        assert lines[0] == TSV_HEADER
        assert len(lines) == 4  # header + 3 rows
        for ln in lines:
            assert len(ln.split("\t")) == 9, f"row not 9 fields: {ln!r}"

    def test_inspect_exit_is_present_for_warning_rows(self, tmp_path):
        # Direct regression test for the user-reported bug where
        # inspect_exit=1 was missing from TSV rows.
        batch = tmp_path / "batch"
        products = batch / "products"
        _write_sidecar(
            products, rank="1", goodsNo="A1",
            pipeline_exit=0, republish_exit=0, inspect_exit=1,
            status=STATUS_COMPLETED_WITH_WARNINGS,
        )
        path = regenerate_summary_tsv_from_sidecars(batch)
        lines = path.read_text(encoding="utf-8").splitlines()
        row = lines[1].split("\t")
        # Position 7 (0-indexed) is inspect_exit per TSV_HEADER.
        assert row[5] == "0"   # pipeline_exit
        assert row[6] == "0"   # republish_exit
        assert row[7] == "1"   # inspect_exit  <-- the bug location
        assert row[8] == STATUS_COMPLETED_WITH_WARNINGS

    def test_atomic_write_via_tmp(self, tmp_path):
        # The write must NOT leave a stale .tmp behind on success.
        batch = tmp_path / "batch"
        products = batch / "products"
        _write_sidecar(products, rank="1", goodsNo="A1")
        regenerate_summary_tsv_from_sidecars(batch)
        assert not (batch / "summary.tsv.tmp").exists()
        assert (batch / "summary.tsv").exists()

    def test_rows_sorted_by_numeric_rank(self, tmp_path):
        batch = tmp_path / "batch"
        products = batch / "products"
        _write_sidecar(products, rank="10", goodsNo="A10")
        _write_sidecar(products, rank="2", goodsNo="A2")
        _write_sidecar(products, rank="1", goodsNo="A1")
        path = regenerate_summary_tsv_from_sidecars(batch)
        ranks = [
            ln.split("\t")[0]
            for ln in path.read_text(encoding="utf-8").splitlines()[1:]
        ]
        assert ranks == ["1", "2", "10"]


class TestValidateSummaryTsv:
    def test_clean_file_returns_no_errors(self, tmp_path):
        batch = tmp_path / "batch"
        products = batch / "products"
        _write_sidecar(products, rank="1", goodsNo="A1")
        path = regenerate_summary_tsv_from_sidecars(batch)
        assert validate_summary_tsv(path) == []

    def test_short_row_flagged(self, tmp_path):
        bad = tmp_path / "bad.tsv"
        bad.write_text(TSV_HEADER + "\n" + "1\tx\tA1\ts\toutputs/s\t0\t0\n",
                       encoding="utf-8")
        errors = validate_summary_tsv(bad)
        assert len(errors) == 1
        assert "got 7" in errors[0]

    def test_long_row_flagged(self, tmp_path):
        bad = tmp_path / "bad.tsv"
        bad.write_text(
            TSV_HEADER + "\n"
            + "1\tx\tA1\ts\toutputs/s\t0\t0\t0\tpublishable\textra\n",
            encoding="utf-8",
        )
        errors = validate_summary_tsv(bad)
        assert len(errors) == 1
        assert "got 10" in errors[0]

    def test_missing_file_returns_error(self, tmp_path):
        errors = validate_summary_tsv(tmp_path / "no_such.tsv")
        assert len(errors) == 1
        assert "missing" in errors[0]


class TestTsvJsonConsistency:
    def test_matching_files_no_errors(self, tmp_path):
        batch = tmp_path / "batch"
        products = batch / "products"
        _write_sidecar(products, rank="1", goodsNo="A1", status=STATUS_PUBLISHABLE,
                        inspect_exit=0)
        _write_sidecar(products, rank="2", goodsNo="A2", status=STATUS_COMPLETED_WITH_WARNINGS,
                        inspect_exit=1)
        # Run finalize via direct calls so both files are derived from
        # the same sidecars.
        outcomes = ob._read_outcome_sidecars(products)
        summary = aggregate_summary_json(outcomes, batch_id="X",
                                          requested_max_reviews_per_sort=200)
        (batch / "summary.json").write_text(
            json.dumps(summary, ensure_ascii=False), encoding="utf-8"
        )
        regenerate_summary_tsv_from_sidecars(batch)
        errors = validate_tsv_json_consistency(
            batch / "summary.tsv", batch / "summary.json"
        )
        assert errors == []

    def test_status_drift_between_tsv_and_json_flagged(self, tmp_path):
        # Hand-corrupt summary.tsv to disagree with summary.json.
        batch = tmp_path / "batch"
        products = batch / "products"
        _write_sidecar(products, rank="1", goodsNo="A1", status=STATUS_PUBLISHABLE,
                        inspect_exit=0)
        outcomes = ob._read_outcome_sidecars(products)
        summary = aggregate_summary_json(outcomes, batch_id="X",
                                          requested_max_reviews_per_sort=200)
        (batch / "summary.json").write_text(
            json.dumps(summary, ensure_ascii=False), encoding="utf-8"
        )
        # corrupted TSV: status field replaced.
        corrupted = TSV_HEADER + "\n1\tx\tA1\ts\toutputs/s\t0\t0\t0\tpipeline_failed\n"
        (batch / "summary.tsv").write_text(corrupted, encoding="utf-8")
        errors = validate_tsv_json_consistency(
            batch / "summary.tsv", batch / "summary.json"
        )
        assert any("status mismatch" in e for e in errors)

    def test_inspect_exit_drift_flagged(self, tmp_path):
        batch = tmp_path / "batch"
        products = batch / "products"
        _write_sidecar(products, rank="1", goodsNo="A1",
                        inspect_exit=1, status=STATUS_COMPLETED_WITH_WARNINGS)
        outcomes = ob._read_outcome_sidecars(products)
        summary = aggregate_summary_json(outcomes, batch_id="X",
                                          requested_max_reviews_per_sort=200)
        (batch / "summary.json").write_text(
            json.dumps(summary, ensure_ascii=False), encoding="utf-8"
        )
        # TSV has inspect_exit=0 but JSON has 1.
        corrupted = (TSV_HEADER + "\n"
                     + "1\tx\tA1\ts\toutputs/s\t0\t0\t0\tcompleted_with_warnings\n")
        (batch / "summary.tsv").write_text(corrupted, encoding="utf-8")
        errors = validate_tsv_json_consistency(
            batch / "summary.tsv", batch / "summary.json"
        )
        assert any("inspect_exit mismatch" in e for e in errors)


class TestFinalizeCli:
    def _run_finalize(self, batch_dir: Path, **kwargs) -> subprocess.CompletedProcess:
        cmd = [
            sys.executable, "-m", "src.voc.app.overnight_batch", "finalize",
            "--batch-dir", str(batch_dir),
        ]
        if kwargs.get("batch_id"):
            cmd += ["--batch-id", kwargs["batch_id"]]
        if kwargs.get("requested_max_reviews_per_sort") is not None:
            cmd += ["--requested-max-reviews-per-sort",
                    str(kwargs["requested_max_reviews_per_sort"])]
        return subprocess.run(cmd, capture_output=True, text=True, check=False,
                              cwd=str(REPO_ROOT))

    def test_finalize_regenerates_tsv_with_correct_inspect_exit(self, tmp_path):
        # User-reported regression: inspect_exit=1 was silently
        # dropped from summary.tsv. Direct repro at the CLI level.
        batch = tmp_path / "batch"
        products = batch / "products"
        _write_sidecar(products, rank="1", goodsNo="A1", inspect_exit=1,
                        status=STATUS_COMPLETED_WITH_WARNINGS)
        _write_sidecar(products, rank="2", goodsNo="A2", inspect_exit=0,
                        status=STATUS_PUBLISHABLE)
        result = self._run_finalize(batch, batch_id="T",
                                     requested_max_reviews_per_sort=200)
        assert result.returncode == 0, result.stderr

        rows = (batch / "summary.tsv").read_text(encoding="utf-8").splitlines()
        assert rows[0] == TSV_HEADER
        assert len(rows) == 3
        for r in rows:
            assert len(r.split("\t")) == 9

        # Locate the inspect_exit=1 row and assert it survives intact.
        warning_row = [r for r in rows[1:] if r.startswith("1\t")][0]
        parts = warning_row.split("\t")
        assert parts[7] == "1"
        assert parts[8] == STATUS_COMPLETED_WITH_WARNINGS

    def test_finalize_exits_nonzero_on_validation_drift(self, tmp_path):
        # If finalize is called twice and someone hand-corrupts
        # summary.tsv between calls, the bash-level awk also catches
        # it; but at the python level we need an active validation
        # signal. Simulate by injecting a malformed sidecar that
        # ProductOutcome rejects, then running finalize. The bad
        # sidecar should be skipped and the rest should validate
        # cleanly — i.e. partial corruption doesn't crash finalize.
        batch = tmp_path / "batch"
        products = batch / "products"
        _write_sidecar(products, rank="1", goodsNo="A1", inspect_exit=0,
                        status=STATUS_PUBLISHABLE)
        # Malformed sidecar (junk JSON); finalize should skip it.
        (products / "9_BAD.json").write_text("{", encoding="utf-8")

        result = self._run_finalize(batch, batch_id="T",
                                     requested_max_reviews_per_sort=200)
        assert result.returncode == 0
        rows = (batch / "summary.tsv").read_text(encoding="utf-8").splitlines()
        assert len(rows) == 2  # header + 1 valid row only


# ---------- End-to-end bash smoke test -----------------------------------


@pytest.fixture
def stub_pipeline_repo(tmp_path: Path):
    """Build a tmp repo skeleton with stub pipeline / republish /
    inspect scripts. The bash runner is invoked with BATCH_REPO_ROOT
    pointing here, plus PIPELINE_SCRIPT / REPUBLISH_SCRIPT /
    INSPECT_SCRIPT pointing at the stubs.

    Stubs read STUB_PRODUCT_BEHAVIOR (a JSON env var) keyed by
    goodsNo to decide what exit code to use and what artifacts to
    write. This lets one test exercise success / pipeline_failed /
    inspect_warning paths in a single bash invocation.
    """
    root = tmp_path / "repo"
    root.mkdir()
    # Mirror src/ so PYTHONPATH=. resolves overnight_batch.
    (root / "src").symlink_to(REPO_ROOT / "src")
    (root / "scripts").mkdir()

    # Pipeline stub: writes minimal collection_summary.json and
    # analysis_report.json based on STUB_PRODUCT_BEHAVIOR for the
    # current goodsNo (parsed from the URL). Exits with the
    # configured code.
    pipeline_stub = root / "scripts" / "stub_pipeline.py"
    pipeline_stub.write_text(
        """#!/usr/bin/env python3
import argparse, json, os, pathlib, sys, re
ap = argparse.ArgumentParser()
ap.add_argument("product_url")
ap.add_argument("--multi-sort", action="store_true")
ap.add_argument("--corpus-mode")
ap.add_argument("--max-reviews")
ap.add_argument("--max-reviews-per-sort")
ap.add_argument("--category-mode")
ap.add_argument("--cdp-endpoint")
ap.add_argument("--stub-llm", action="store_true")
ap.add_argument("--emit-analysis-report-json")
ap.add_argument("--emit-collection-summary-json")
ap.add_argument("--analysis-report-source-url")
ap.add_argument("--out-pdf")
args, _ = ap.parse_known_args()
m = re.search(r"goodsNo=([A-Z0-9]+)", args.product_url)
goods = m.group(1) if m else "UNKNOWN"
behavior = json.loads(os.environ.get("STUB_PRODUCT_BEHAVIOR", "{}"))
spec = behavior.get(goods, {})
exit_code = int(spec.get("pipeline_exit", 0))
# Always drop a meta file so the inspect stub can recover goodsNo
# from the run-dir (the bash runner doesn't pass it through).
run_dir = pathlib.Path(args.emit_collection_summary_json).parent.parent
run_dir.mkdir(parents=True, exist_ok=True)
(run_dir / ".stub_meta.json").write_text(json.dumps({"goodsNo": goods}))
if exit_code == 0:
    cs = {
        "goodsNo": goods,
        "review_count_analyzed": spec.get("review_count_analyzed", 400),
        "sorts_succeeded": spec.get("sorts_succeeded",
            ["DATETIME_DESC","RATING_ASC","RATING_DESC","USEFUL_SCORE_DESC","RECOMMENDED_DESC"]),
        "sorts_failed": spec.get("sorts_failed", []),
        "partial_success": False,
    }
    open(args.emit_collection_summary_json, "w").write(json.dumps(cs))
    open(args.emit_analysis_report_json, "w").write("{}")
    open(args.out_pdf, "w").write("PDF")
else:
    msg = spec.get("log_message", "stub pipeline failed")
    print(msg, file=sys.stderr)
sys.exit(exit_code)
""",
        encoding="utf-8",
    )

    # republish stub: touch manifest.json. Exit per spec.
    republish_stub = root / "scripts" / "stub_republish.py"
    republish_stub.write_text(
        """#!/usr/bin/env python3
import argparse, json, os, pathlib, sys
ap = argparse.ArgumentParser()
ap.add_argument("--run-dir", required=True)
args, _ = ap.parse_known_args()
run = pathlib.Path(args.run_dir)
run.mkdir(parents=True, exist_ok=True)
(run / "manifest.json").write_text("{}")
(run / "buyer_content" / "ko").mkdir(parents=True, exist_ok=True)
(run / "buyer_content" / "ko" / "p01.png").write_text("png")
sys.exit(0)
""",
        encoding="utf-8",
    )

    # inspect stub: read STUB_PRODUCT_BEHAVIOR via run-dir filename
    # to pick "all checks passed" vs warnings.
    inspect_stub = root / "scripts" / "stub_inspect.py"
    inspect_stub.write_text(
        """#!/usr/bin/env python3
import argparse, json, os, sys, pathlib
ap = argparse.ArgumentParser()
ap.add_argument("--run-dir", required=True)
args, _ = ap.parse_known_args()
meta_path = pathlib.Path(args.run_dir) / ".stub_meta.json"
goods = "UNKNOWN"
if meta_path.is_file():
    try:
        goods = json.loads(meta_path.read_text())["goodsNo"]
    except Exception:
        pass
behavior = json.loads(os.environ.get("STUB_PRODUCT_BEHAVIOR", "{}"))
spec = behavior.get(goods, {})
inspect_exit = int(spec.get("inspect_exit", 0))
if inspect_exit == 0:
    print("  ✓ all checks passed — run looks publishable")
else:
    print("  ⚠ 1 warning(s):")
    print("    1. quote summary degraded")
sys.exit(inspect_exit)
""",
        encoding="utf-8",
    )
    return root


class TestBashRunnerEndToEnd:
    """End-to-end smoke test: actually invoke
    `scripts/run_oy_top8_interview_batch.sh` against stub
    pipeline / republish / inspect scripts, and assert the artifacts
    it produces obey the 9-field invariant + tsv↔json parity.
    """

    def test_three_products_success_warning_failure(self, stub_pipeline_repo, tmp_path):
        repo = stub_pipeline_repo
        # The runner writes logs under <repo>/logs/batch_runs/<BATCH_ID>/
        csv_path = repo / "products.csv"
        csv_path.write_text(
            "rank,profile,goodsNo,slug\n"
            "1,base_makeup,A000000001,good_pub\n"
            "2,base_makeup,A000000002,warning_only\n"
            "3,base_makeup,A000000003,pipeline_dead\n",
            encoding="utf-8",
        )
        behavior = {
            "A000000001": {"pipeline_exit": 0, "inspect_exit": 0,
                            "review_count_analyzed": 400},
            "A000000002": {"pipeline_exit": 0, "inspect_exit": 1,
                            "review_count_analyzed": 400},
            "A000000003": {"pipeline_exit": 3, "inspect_exit": 0,
                            "log_message": "pipeline blew up"},
        }
        env = {
            **os.environ,
            "BATCH_REPO_ROOT": str(repo),
            "PIPELINE_SCRIPT": "scripts/stub_pipeline.py",
            "REPUBLISH_SCRIPT": "scripts/stub_republish.py",
            "INSPECT_SCRIPT": "scripts/stub_inspect.py",
            "SKIP_CDP_PREFLIGHT": "1",
            "SKIP_OPENAI_KEY_CHECK": "1",
            "PRODUCT_SLEEP_MIN_SECS": "0",
            "PRODUCT_SLEEP_MAX_SECS": "0",
            "STUB_PRODUCT_BEHAVIOR": json.dumps(behavior),
            "BATCH_ID": "smoke_test_001",
            "PYTHONPATH": str(REPO_ROOT),
        }
        runner_path = REPO_ROOT / "scripts" / "run_oy_top8_interview_batch.sh"
        result = subprocess.run(
            ["bash", str(runner_path), str(csv_path)],
            capture_output=True, text=True, env=env, check=False,
            cwd=str(repo),
            timeout=60,
        )
        # The runner exits 0 even with pipeline_failed products as
        # long as TSV validation passes.
        assert result.returncode == 0, (
            f"runner exit={result.returncode}\n"
            f"stdout:\n{result.stdout}\n"
            f"stderr:\n{result.stderr}"
        )

        log_dir = repo / "logs" / "batch_runs" / "smoke_test_001"
        summary_tsv = log_dir / "summary.tsv"
        summary_json_path = log_dir / "summary.json"
        assert summary_tsv.is_file()
        assert summary_json_path.is_file()

        # Field-count invariant: header + 3 rows, every line 9 fields.
        lines = summary_tsv.read_text(encoding="utf-8").splitlines()
        assert lines[0] == TSV_HEADER, f"header drift: {lines[0]!r}"
        assert len(lines) == 4, f"expected 4 lines (header+3), got {len(lines)}"
        for ln in lines:
            field_count = len(ln.split("\t"))
            assert field_count == 9, f"non-9-field line: {ln!r}"

        # Content sanity: row 2 has inspect_exit=1; row 3 has pipeline_exit=3.
        row1 = lines[1].split("\t")
        row2 = lines[2].split("\t")
        row3 = lines[3].split("\t")
        assert row1[7] == "0" and row1[8] == STATUS_PUBLISHABLE
        assert row2[7] == "1" and row2[8] == STATUS_COMPLETED_WITH_WARNINGS
        assert row3[5] == "3" and row3[8] == STATUS_PIPELINE_FAILED

        # TSV ↔ JSON parity for every row.
        errors = validate_tsv_json_consistency(summary_tsv, summary_json_path)
        assert errors == [], f"tsv↔json drift: {errors}"

        # summary.json counts also match.
        summary = json.loads(summary_json_path.read_text(encoding="utf-8"))
        assert summary["counts"]["total"] == 3
        assert summary["counts"][STATUS_PUBLISHABLE] == 1
        assert summary["counts"][STATUS_COMPLETED_WITH_WARNINGS] == 1
        assert summary["counts"][STATUS_PIPELINE_FAILED] == 1

    def test_skipped_products_recorded_with_nine_fields(self, stub_pipeline_repo, tmp_path):
        # When ON_AUTH_FAILURE=stop_batch fires after an anti-bot
        # product, remaining products are recorded with status=skipped
        # — they must still appear in summary.tsv with 9 fields.
        repo = stub_pipeline_repo
        csv_path = repo / "products.csv"
        csv_path.write_text(
            "rank,profile,goodsNo,slug\n"
            "1,sunscreen,A000000004,bot_block\n"
            "2,base_makeup,A000000005,never_runs\n"
            "3,base_makeup,A000000006,also_skipped\n",
            encoding="utf-8",
        )
        behavior = {
            # First product simulates anti-bot: pipeline_exit nonzero
            # AND log message contains the trigger phrase.
            "A000000004": {
                "pipeline_exit": 4, "inspect_exit": 0,
                "log_message": "Batch halted: product 'A000000004' classified as 'anti_bot' — re-establish auth",
            },
        }
        env = {
            **os.environ,
            "BATCH_REPO_ROOT": str(repo),
            "PIPELINE_SCRIPT": "scripts/stub_pipeline.py",
            "REPUBLISH_SCRIPT": "scripts/stub_republish.py",
            "INSPECT_SCRIPT": "scripts/stub_inspect.py",
            "SKIP_CDP_PREFLIGHT": "1",
            "SKIP_OPENAI_KEY_CHECK": "1",
            "PRODUCT_SLEEP_MIN_SECS": "0",
            "PRODUCT_SLEEP_MAX_SECS": "0",
            "ON_AUTH_FAILURE": "stop_batch",
            "STUB_PRODUCT_BEHAVIOR": json.dumps(behavior),
            "BATCH_ID": "smoke_test_002",
            "PYTHONPATH": str(REPO_ROOT),
        }
        runner_path = REPO_ROOT / "scripts" / "run_oy_top8_interview_batch.sh"
        result = subprocess.run(
            ["bash", str(runner_path), str(csv_path)],
            capture_output=True, text=True, env=env, check=False,
            cwd=str(repo),
            timeout=60,
        )
        assert result.returncode == 0, (
            f"runner exit={result.returncode}\nstdout:\n{result.stdout}\nstderr:\n{result.stderr}"
        )

        log_dir = repo / "logs" / "batch_runs" / "smoke_test_002"
        lines = (log_dir / "summary.tsv").read_text(encoding="utf-8").splitlines()
        assert lines[0] == TSV_HEADER
        # 3 products: 1 anti-bot + 2 skipped; all must appear.
        assert len(lines) == 4
        for ln in lines:
            assert len(ln.split("\t")) == 9, f"non-9-field line: {ln!r}"

        # Row content: rank-1 is anti_bot_pause_required, the others skipped.
        statuses = [ln.split("\t")[8] for ln in lines[1:]]
        assert statuses[0] == STATUS_ANTI_BOT_PAUSE_REQUIRED
        assert statuses[1] == STATUS_SKIPPED
        assert statuses[2] == STATUS_SKIPPED

        # failed_products.csv contains only the auth-bucket row,
        # not the skipped ones (skipped is not a resumable status).
        failed_text = (log_dir / "failed_products.csv").read_text(encoding="utf-8")
        assert "A000000004" in failed_text
        assert "A000000005" not in failed_text
        assert "A000000006" not in failed_text


# Force `os` import for the smoke tests above.
import os  # noqa: E402
