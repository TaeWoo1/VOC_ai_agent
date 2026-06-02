"""Pass-19: republish_run.py must actually write `manifest.json` to
RUN_DIR (and inspect_run_quality.py must not warn it's missing) when
the operator runs republish on a run-dir whose manifest was deleted
or never existed.

Pre-pass-19 contradiction:
  republish prints  "  → <RUN_DIR>/manifest.json"
  inspect prints    "  ⚠ manifest.json missing — cannot resolve PDF status"

Root cause: `_patch_manifest` returned the path *without writing* when
the file didn't exist; the main loop unconditionally logged
"  → {path}". Pass-19 builds a minimal manifest from analysis_report
+ collection_summary in that case so the file actually lands.
"""
from __future__ import annotations

import importlib.util
import json
import sys
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[2]


def _load_module(name: str, rel_path: str):
    """Importlib helper for the script files (which aren't packages)."""
    full_name = f"_pass19_{name}_{abs(hash(rel_path)) & 0xffff:x}"
    if full_name in sys.modules:
        return sys.modules[full_name]
    spec = importlib.util.spec_from_file_location(full_name, REPO / rel_path)
    mod = importlib.util.module_from_spec(spec)
    sys.modules[full_name] = mod
    spec.loader.exec_module(mod)
    return mod


@pytest.fixture
def run_dir(tmp_path: Path) -> Path:
    """Build a synthetic run-dir with the minimum artifacts republish
    needs: shared/analysis_report.json, shared/collection_summary.json,
    seller_report/seller_report_ko.pdf, buyer_content/ko/
    buyer_journey_cardnews.json. NO manifest.json — the test exercises
    the create-from-scratch path.
    """
    run = tmp_path / "2026-05-03_product-A000000253122_run-001"
    (run / "shared").mkdir(parents=True)
    (run / "seller_report").mkdir()
    (run / "buyer_content" / "ko").mkdir(parents=True)

    analysis_report = {
        "schema_version": "3.0",
        "product": {
            "slug": "product-A000000253122",
            "name_ko": "[퓌X민스코] 퓌 올데이 커버 블랙 쿠션",
            "category": "메이크업 > 베이스메이크업 > 쿠션",
            "selected_profile_id": "base_makeup",
            "raw_product_name": "[퓌X민스코] 퓌 올데이 커버 블랙 쿠션",
            "display_product_name": "퓌 올데이 커버 블랙 쿠션",
            "offer_context": "리필기획 · 본품+리필 · 5종",
            "promo_context": "[퓌X민스코]",
            "report_title": "퓌 올데이 커버 블랙 쿠션 리뷰 인사이트 리포트",
            "source_url": "https://example.invalid/p?goodsNo=A000000253122",
        },
        "corpus": {
            "n_reviews_analyzed": 156,
            "primary_sort": "DATETIME_DESC",
            "sampling_strategy": "latest_only",
            "confidence_level": "high",
        },
        "attributes": [],
        "strengths": [],
        "monitoring_candidates": [],
        "tradeoffs": [],
    }
    collection_summary = {
        "goodsNo": "A000000253122",
        "product_url": "https://example.invalid/p?goodsNo=A000000253122",
        "corpus_mode": "observable_multi_sort",
        "primary_sort": "DATETIME_DESC",
        "review_count_analyzed": 156,
        "sorts_attempted": [
            "DATETIME_DESC", "RATING_ASC", "RATING_DESC",
            "USEFUL_SCORE_DESC", "RECOMMENDED_DESC",
        ],
        "sorts_succeeded": [
            "DATETIME_DESC", "RATING_ASC", "RATING_DESC",
            "USEFUL_SCORE_DESC", "RECOMMENDED_DESC",
        ],
        "sorts_failed": [],
        "sorts_blocked_or_anti_bot": [],
        "partial_success": False,
        "analysis_status": "completed",
    }
    (run / "shared" / "analysis_report.json").write_text(
        json.dumps(analysis_report, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    (run / "shared" / "collection_summary.json").write_text(
        json.dumps(collection_summary, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    # Minimal valid PDF (just bytes — we never parse, only sha256 it).
    (run / "seller_report" / "seller_report_ko.pdf").write_bytes(
        b"%PDF-1.4 stub for republish manifest pass-19 test\n"
    )
    (run / "buyer_content" / "ko" / "buyer_journey_cardnews.json").write_text(
        json.dumps({"slide_count": 7, "slides": []}, ensure_ascii=False),
        encoding="utf-8",
    )
    return run


# ---------------------------------------------------------------------------
# 1. _patch_manifest creates the file when absent
# ---------------------------------------------------------------------------


def test_patch_manifest_creates_file_when_missing(run_dir):
    rep = _load_module("republish", "scripts/republish_run.py")
    pdf = run_dir / "seller_report" / "seller_report_ko.pdf"
    bj = run_dir / "buyer_content" / "ko" / "buyer_journey_cardnews.json"
    new_ar = run_dir / "shared" / "analysis_report.json"
    collection = json.loads(
        (run_dir / "shared" / "collection_summary.json").read_text(
            encoding="utf-8",
        ),
    )
    analysis_report = json.loads(
        (run_dir / "shared" / "analysis_report.json").read_text(
            encoding="utf-8",
        ),
    )

    manifest_path = run_dir / "manifest.json"
    assert not manifest_path.is_file(), "precondition: manifest absent"

    out_path, action = rep._patch_manifest(
        run_dir, bj, pdf, new_ar,
        collection_summary=collection,
        analysis_report=analysis_report,
    )

    assert out_path == manifest_path
    assert action == "created"
    assert manifest_path.is_file(), "manifest should have been created on disk"

    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))

    # Product block hydrated from analysis_report.
    product = manifest.get("product") or {}
    assert product.get("name_ko") == (
        "[퓌X민스코] 퓌 올데이 커버 블랙 쿠션"
    )
    assert product.get("category") == "메이크업 > 베이스메이크업 > 쿠션"
    assert product.get("selected_profile_id") == "base_makeup"
    assert product.get("display_product_name") == "퓌 올데이 커버 블랙 쿠션"

    # Collection block synced from collection_summary.
    coll = manifest.get("collection") or {}
    assert coll.get("partial_success") is False
    assert coll.get("review_count_analyzed") == 156
    assert coll.get("sorts_succeeded") == [
        "DATETIME_DESC", "RATING_ASC", "RATING_DESC",
        "USEFUL_SCORE_DESC", "RECOMMENDED_DESC",
    ]

    # PDF artifact ok with sha256 + bytes.
    pdf_record = (manifest.get("artifacts") or {}).get(
        "seller_report_ko_pdf",
    ) or {}
    assert pdf_record.get("status") == "ok"
    assert pdf_record.get("path") == "seller_report/seller_report_ko.pdf"
    assert isinstance(pdf_record.get("sha256"), str) and pdf_record["sha256"]
    assert pdf_record.get("bytes") == pdf.stat().st_size

    # buyer_journey artifact recorded.
    bc = (
        (manifest.get("artifacts") or {})
        .get("buyer_content") or {}
    ).get("ko") or {}
    bj_record = bc.get("buyer_journey_cardnews_json") or {}
    assert bj_record.get("status") == "ok"

    # republished_at stamp is present.
    assert isinstance(manifest.get("republished_at"), str)


def test_patch_manifest_skipped_when_no_inputs(tmp_path):
    """If neither analysis_report nor collection_summary is supplied
    AND the manifest doesn't exist, _patch_manifest must NOT silently
    write a near-empty manifest. It returns action="skipped" so the
    caller can warn the operator."""
    rep = _load_module("republish", "scripts/republish_run.py")
    run = tmp_path / "empty_run"
    run.mkdir()
    pdf = run / "seller_report" / "seller_report_ko.pdf"
    bj = run / "buyer_content" / "ko" / "buyer_journey_cardnews.json"
    new_ar = run / "shared" / "analysis_report.json"

    out_path, action = rep._patch_manifest(
        run, bj, pdf, new_ar,
        collection_summary=None,
        analysis_report=None,
    )

    assert action == "skipped"
    assert not out_path.is_file()


# ---------------------------------------------------------------------------
# 2. _patch_manifest hydrates an empty product block on the patch path
# ---------------------------------------------------------------------------


def test_patch_manifest_hydrates_empty_product_block(run_dir):
    """Existing manifest with empty/missing product block is back-
    filled from analysis_report. Operator-edited non-empty fields
    survive (manifest is the operator's record)."""
    rep = _load_module("republish", "scripts/republish_run.py")
    manifest_path = run_dir / "manifest.json"
    # Pre-existing manifest: no product block at all.
    manifest_path.write_text(
        json.dumps({
            "schema_version": "1.3",
            "run_dir": run_dir.name,
            "artifacts": {
                "seller_report_ko_pdf": {"status": "skipped"},
                "buyer_content": {"ko": {}},
            },
        }, ensure_ascii=False),
        encoding="utf-8",
    )

    analysis_report = json.loads(
        (run_dir / "shared" / "analysis_report.json").read_text(
            encoding="utf-8",
        ),
    )
    collection = json.loads(
        (run_dir / "shared" / "collection_summary.json").read_text(
            encoding="utf-8",
        ),
    )
    pdf = run_dir / "seller_report" / "seller_report_ko.pdf"
    bj = run_dir / "buyer_content" / "ko" / "buyer_journey_cardnews.json"
    new_ar = run_dir / "shared" / "analysis_report.json"

    _, action = rep._patch_manifest(
        run_dir, bj, pdf, new_ar,
        collection_summary=collection,
        analysis_report=analysis_report,
    )
    assert action == "patched"

    out = json.loads(manifest_path.read_text(encoding="utf-8"))
    product = out.get("product") or {}
    assert product.get("category") == "메이크업 > 베이스메이크업 > 쿠션"
    assert product.get("selected_profile_id") == "base_makeup"


def test_patch_manifest_preserves_non_empty_product_fields(run_dir):
    """When manifest.product already carries (e.g.) an operator-set
    `name_ko`, the hydration must NOT overwrite it. Hydration only
    fills empty / missing fields."""
    rep = _load_module("republish", "scripts/republish_run.py")
    manifest_path = run_dir / "manifest.json"
    operator_set_name = "OPERATOR_PINNED_PRODUCT_NAME"
    manifest_path.write_text(
        json.dumps({
            "schema_version": "1.3",
            "run_dir": run_dir.name,
            "product": {"name_ko": operator_set_name},
            "artifacts": {
                "seller_report_ko_pdf": {"status": "skipped"},
                "buyer_content": {"ko": {}},
            },
        }, ensure_ascii=False),
        encoding="utf-8",
    )

    analysis_report = json.loads(
        (run_dir / "shared" / "analysis_report.json").read_text(
            encoding="utf-8",
        ),
    )
    pdf = run_dir / "seller_report" / "seller_report_ko.pdf"
    bj = run_dir / "buyer_content" / "ko" / "buyer_journey_cardnews.json"
    new_ar = run_dir / "shared" / "analysis_report.json"

    rep._patch_manifest(
        run_dir, bj, pdf, new_ar,
        collection_summary=None,
        analysis_report=analysis_report,
    )

    out = json.loads(manifest_path.read_text(encoding="utf-8"))
    product = out.get("product") or {}
    # Operator's pinned name survives.
    assert product.get("name_ko") == operator_set_name
    # Other fields STILL get hydrated (they were missing).
    assert product.get("category") == "메이크업 > 베이스메이크업 > 쿠션"
    assert product.get("selected_profile_id") == "base_makeup"


# ---------------------------------------------------------------------------
# 3. inspect_run_quality emits no "manifest.json missing" warning
#    after republish on a manifest-less run-dir
# ---------------------------------------------------------------------------


def test_inspect_emits_no_manifest_missing_warning_after_create(
    run_dir, capsys,
):
    """Round-trip: republish creates the manifest from scratch, then
    inspect_run_quality reads it without warning that it's missing."""
    rep = _load_module("republish", "scripts/republish_run.py")
    insp = _load_module("inspect", "scripts/inspect_run_quality.py")

    pdf = run_dir / "seller_report" / "seller_report_ko.pdf"
    bj = run_dir / "buyer_content" / "ko" / "buyer_journey_cardnews.json"
    new_ar = run_dir / "shared" / "analysis_report.json"
    collection = json.loads(
        (run_dir / "shared" / "collection_summary.json").read_text(
            encoding="utf-8",
        ),
    )
    analysis_report = json.loads(new_ar.read_text(encoding="utf-8"))

    # Run republish's manifest step.
    rep._patch_manifest(
        run_dir, bj, pdf, new_ar,
        collection_summary=collection,
        analysis_report=analysis_report,
    )
    assert (run_dir / "manifest.json").is_file()

    # Now run the inspector and capture its warnings list.
    manifest_dict = json.loads(
        (run_dir / "manifest.json").read_text(encoding="utf-8"),
    )

    # Drive `inspect_seller_pdf` directly with the manifest we wrote
    # — locks the contract that "manifest.json missing" is no longer
    # in the warnings list.
    warnings: list[str] = []
    insp.inspect_seller_pdf(run_dir, manifest_dict, warnings)
    assert "manifest.json missing" not in warnings, (
        f"inspector still complains manifest is missing: {warnings}"
    )

    # And `inspect_manifest_collection_block` must also be silent
    # (collection block was synced from collection_summary).
    coll_warnings: list[str] = []
    insp.inspect_manifest_collection_block(manifest_dict, coll_warnings)
    assert not any(
        "no `collection` block" in w for w in coll_warnings
    ), f"inspector flags missing collection block: {coll_warnings}"


def test_inspect_full_run_no_manifest_missing_warning(run_dir):
    """End-to-end: run the whole inspector main() against the run-dir
    after republish has created the manifest. The Summary line must
    NOT contain 'manifest.json missing'."""
    rep = _load_module("republish", "scripts/republish_run.py")
    insp = _load_module("inspect", "scripts/inspect_run_quality.py")

    pdf = run_dir / "seller_report" / "seller_report_ko.pdf"
    bj = run_dir / "buyer_content" / "ko" / "buyer_journey_cardnews.json"
    new_ar = run_dir / "shared" / "analysis_report.json"
    collection = json.loads(
        (run_dir / "shared" / "collection_summary.json").read_text(
            encoding="utf-8",
        ),
    )
    analysis_report = json.loads(new_ar.read_text(encoding="utf-8"))

    rep._patch_manifest(
        run_dir, bj, pdf, new_ar,
        collection_summary=collection,
        analysis_report=analysis_report,
    )

    # Run inspect main() with the run-dir as argv.
    rc = insp.main(["--run-dir", str(run_dir)])

    # Capture stdout via the harness — we just need to confirm that
    # no "manifest.json missing" string appears in any printed line.
    import io
    import contextlib
    buf = io.StringIO()
    with contextlib.redirect_stdout(buf):
        rc = insp.main(["--run-dir", str(run_dir)])
    stdout = buf.getvalue()
    assert "manifest.json missing" not in stdout, (
        f"inspector still prints 'manifest.json missing': "
        f"\n{stdout}"
    )
    # rc may be 0 (clean) or 1 (other warnings — analysis_report has
    # empty attributes block, so other inspectors may flag it). Both
    # are acceptable for this test; we only assert the manifest-
    # missing warning is absent.
    assert rc in (0, 1)


# ---------------------------------------------------------------------------
# 4. Idempotency — re-running republish doesn't corrupt the manifest
# ---------------------------------------------------------------------------


def test_repeat_republish_keeps_manifest_consistent(run_dir):
    """Pass-19 idempotency: calling _patch_manifest twice on the same
    run-dir must produce a manifest that still resolves the inspector's
    expected fields. Action transitions: created → patched."""
    rep = _load_module("republish", "scripts/republish_run.py")
    pdf = run_dir / "seller_report" / "seller_report_ko.pdf"
    bj = run_dir / "buyer_content" / "ko" / "buyer_journey_cardnews.json"
    new_ar = run_dir / "shared" / "analysis_report.json"
    collection = json.loads(
        (run_dir / "shared" / "collection_summary.json").read_text(
            encoding="utf-8",
        ),
    )
    analysis_report = json.loads(new_ar.read_text(encoding="utf-8"))

    _, first_action = rep._patch_manifest(
        run_dir, bj, pdf, new_ar,
        collection_summary=collection,
        analysis_report=analysis_report,
    )
    _, second_action = rep._patch_manifest(
        run_dir, bj, pdf, new_ar,
        collection_summary=collection,
        analysis_report=analysis_report,
    )

    assert first_action == "created"
    assert second_action == "patched"

    out = json.loads(
        (run_dir / "manifest.json").read_text(encoding="utf-8"),
    )
    # All the fields the inspector consumes are still present.
    assert (out.get("product") or {}).get("selected_profile_id") == (
        "base_makeup"
    )
    assert (out.get("collection") or {}).get(
        "review_count_analyzed",
    ) == 156
    assert (
        (out.get("artifacts") or {}).get("seller_report_ko_pdf") or {}
    ).get("status") == "ok"
