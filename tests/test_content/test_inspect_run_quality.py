"""Tests for `scripts/inspect_run_quality.py`.

The inspector is the pre-publish gate that surfaces partial-success
warnings, dangling display_text quotes, and schema enum mismatches.
Tests drive the script as a subprocess against a synthetic run
directory so they exercise the same I/O path the operator uses.
"""
from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[2]
SCRIPT = REPO / "scripts" / "inspect_run_quality.py"


def _run_inspector(run_dir: Path) -> tuple[int, str, str]:
    """Invoke the inspector and return (exit_code, stdout, stderr)."""
    proc = subprocess.run(
        [sys.executable, str(SCRIPT), "--run-dir", str(run_dir)],
        capture_output=True, text=True, cwd=str(REPO),
        env={"PYTHONPATH": str(REPO), "PATH": ""},
    )
    return proc.returncode, proc.stdout, proc.stderr


def _write_minimal_run(
    base: Path,
    *,
    sorts_succeeded: list[str],
    sorts_failed: list[str],
    sampling_strategy: str = "observable_multi_sort_corpus",
    display_text_samples: list[dict] | None = None,
) -> Path:
    """Build a synthetic run directory with the bare minimum the
    inspector reads: manifest.json, shared/analysis_report.json,
    shared/analysis_report.schema.json, shared/collection_summary.json.
    """
    run_dir = base / "synthetic_run"
    (run_dir / "shared").mkdir(parents=True, exist_ok=True)
    (run_dir / "seller_report").mkdir(parents=True, exist_ok=True)
    (run_dir / "buyer_content" / "ko").mkdir(parents=True, exist_ok=True)

    # Run-003 QA pass-5: write a stub buyer_journey_cardnews.json so
    # the inspector's "primary cardnews must exist" check is satisfied
    # for synthetic runs that aren't exercising the cardnews path.
    (run_dir / "buyer_content" / "ko" / "buyer_journey_cardnews.json").write_text(
        json.dumps({
            "schema_version": "1.0",
            "format": "cardnews_buyer_journey",
            "lang": "ko",
            "slide_count": 14,
            "slides": [],
        }, ensure_ascii=False),
        encoding="utf-8",
    )

    manifest = {
        "product": {
            "slug": "product-deadbeef",
            "name_ko": "Test product",
            "category": "패드",
            "selected_profile_id": "skincare_pad",
        },
        "artifacts": {
            "seller_report_ko_pdf": {
                "status": "skipped",
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
        "collection": {
            "product_url": "https://example/test",
            "goodsNo": "deadbeef",
            "corpus_mode": "observable_multi_sort",
            "primary_sort": "DATETIME_DESC",
            "sorts_attempted": sorts_succeeded + sorts_failed,
            "sorts_succeeded": sorts_succeeded,
            "partial_success": bool(sorts_failed),
            "review_count_analyzed": 200,
        },
    }
    (run_dir / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False), encoding="utf-8",
    )

    quotes = display_text_samples or [
        {
            "text": "촉촉하게 잘 발리고 좋아요",
            "review_id": "r_clean",
            "polarity": "positive",
            "display_text": "촉촉하게 잘 발리고 좋아요",
        },
    ]
    report = {
        "schema_version": "3.0",
        "generated_at": "2026-05-02T00:00:00Z",
        "product": {"slug": "product-deadbeef"},
        "corpus": {
            "n_reviews_total": 200,
            "n_reviews_analyzed": 200,
            "primary_sort": "DATETIME_DESC",
            "sampling_strategy": sampling_strategy,
            "corpus_type": "observed_scrape",
            "confidence_level": "low",
            "signal_stability": "low",
            "observation_window": {"start": None, "end": None},
        },
        "attributes": [
            {
                "key": "dryness_skin_texture",
                "label_ko": "건조감",
                "n_positive": 1,
                "n_negative": 0,
                "n_mixed": 0,
                "evidence_score": 0.7,
                "polarity_share": {
                    "positive": 1.0, "negative": 0.0, "mixed": 0.0,
                },
                "tier": None,
                "top_quotes": quotes,
            },
        ],
        "polarity_audit": {
            "n_total_quotes": len(quotes),
            "n_total_suspect": 0,
            "n_total_suspect_share": 0.0,
            "by_attribute": {},
            "samples": [],
        },
    }
    (run_dir / "shared" / "analysis_report.json").write_text(
        json.dumps(report, ensure_ascii=False), encoding="utf-8",
    )

    # Copy the canonical schema so the schema-mismatch path can read it.
    canonical = (
        REPO / "src" / "voc" / "content" / "schemas"
        / "analysis_report.schema.json"
    )
    (run_dir / "shared" / "analysis_report.schema.json").write_text(
        canonical.read_text(encoding="utf-8"), encoding="utf-8",
    )

    summary = {
        "schema_version": "1.1",
        "product_url": manifest["collection"]["product_url"],
        "goodsNo": "deadbeef",
        "corpus_mode": "observable_multi_sort",
        "primary_sort": "DATETIME_DESC",
        "sorts_attempted": sorts_succeeded + sorts_failed,
        "sorts_succeeded": sorts_succeeded,
        "sorts_failed": sorts_failed,
        "sorts_blocked_or_anti_bot": [],
        "partial_success": bool(sorts_failed),
        "skipped_scrape": False,
        "analysis_status": "completed",
        "completed_at": "2026-05-02T00:01:00Z",
    }
    (run_dir / "shared" / "collection_summary.json").write_text(
        json.dumps(summary, ensure_ascii=False), encoding="utf-8",
    )
    return run_dir


def test_inspector_warns_when_rating_asc_fails(tmp_path):
    run_dir = _write_minimal_run(
        tmp_path,
        sorts_succeeded=["DATETIME_DESC", "RATING_DESC", "USEFUL_SCORE_DESC"],
        sorts_failed=["RATING_ASC", "RECOMMENDED_DESC"],
    )
    rc, stdout, _ = _run_inspector(run_dir)
    assert rc == 1, "expected warnings to set non-zero exit"
    assert "RATING_ASC" in stdout
    assert "부정 리뷰 신호가 과소 관측될 수 있습니다" in stdout


def test_inspector_dangling_samples_block_lists_offenders(tmp_path):
    """The actionable surface — operator must see WHICH quotes are
    flagged, not just how many."""
    quotes = [
        {  # dangling — ends with bare 좋
            "text": "정말 너무 좋",
            "review_id": "r_dang_1",
            "polarity": "positive",
            "display_text": "정말 너무 좋",
        },
        {  # dangling — ends with bare 매
            "text": "갓성비라 매",
            "review_id": "r_dang_2",
            "polarity": "positive",
            "display_text": "갓성비라",
        },
    ]
    # Note: r_dang_2's display_text "갓성비라" ends with 라 which our
    # complete-form regex treats as connective (NOT in the whitelist),
    # so it surfaces as dangling — exactly matching run-010's behavior.
    run_dir = _write_minimal_run(
        tmp_path,
        sorts_succeeded=["DATETIME_DESC"],
        sorts_failed=[],
        display_text_samples=quotes,
    )
    rc, stdout, _ = _run_inspector(run_dir)
    # Pass-16: dangling display_text without a clean
    # display_quote_summary is treated as a blocking warning. The
    # block heading changed from "top dangling samples" to
    # "blocking dangling samples".
    assert "blocking dangling samples" in stdout
    assert "r_dang_1" in stdout
    assert "polarity=positive" in stdout
    assert "display:" in stdout
    assert rc == 1


def test_inspector_schema_enum_mismatch_warning(tmp_path):
    """If the report value is outside the schema's enum, the inspector
    must surface it. We simulate by writing a schema with a stripped
    enum to the run dir."""
    run_dir = _write_minimal_run(
        tmp_path,
        sorts_succeeded=["DATETIME_DESC"],
        sorts_failed=[],
    )
    schema_path = run_dir / "shared" / "analysis_report.schema.json"
    schema = json.loads(schema_path.read_text(encoding="utf-8"))
    # Strip the new value to simulate a stale run-dir copy.
    enum = (
        schema["properties"]["corpus"]["properties"]
        ["sampling_strategy"]["enum"]
    )
    schema["properties"]["corpus"]["properties"]["sampling_strategy"][
        "enum"
    ] = [v for v in enum if v != "observable_multi_sort_corpus"]
    schema_path.write_text(
        json.dumps(schema, ensure_ascii=False), encoding="utf-8",
    )
    rc, stdout, _ = _run_inspector(run_dir)
    assert "schema enum mismatch" in stdout or "not one of" in stdout
    assert rc == 1


def test_inspector_clean_run_returns_zero(tmp_path):
    """Successful, full-coverage run with clean display_texts and
    matching schema enum: exit code 0 (publishable)."""
    run_dir = _write_minimal_run(
        tmp_path,
        sorts_succeeded=[
            "DATETIME_DESC", "RATING_ASC", "RATING_DESC",
            "USEFUL_SCORE_DESC", "RECOMMENDED_DESC",
        ],
        sorts_failed=[],
    )
    # Ensure the seller PDF "missing" is acknowledged but not warned —
    # the inspector reports manifest status="skipped" and on_disk=False
    # for our minimal fixture; it warns only on inconsistency. To
    # guarantee a zero exit we mark status as "ok" and write a stub
    # PDF byte so the cross-check passes.
    manifest_path = run_dir / "manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    manifest["artifacts"]["seller_report_ko_pdf"]["status"] = "ok"
    manifest_path.write_text(
        json.dumps(manifest, ensure_ascii=False), encoding="utf-8",
    )
    pdf_path = (
        run_dir / "seller_report" / "seller_report_ko.pdf"
    )
    pdf_path.write_bytes(b"%PDF-1.4\nstub\n%%EOF")
    rc, _stdout, _ = _run_inspector(run_dir)
    assert rc == 0
