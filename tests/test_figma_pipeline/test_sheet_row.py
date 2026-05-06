"""Pure tests for the cardnews-review-Sheet row builder."""
from __future__ import annotations

import json
from pathlib import Path

import pytest

from src.voc.figma_pipeline import sheet_row
from src.voc.figma_pipeline.sheet_row import (
    COPY_STATUS_APPROVED,
    COPY_STATUS_PENDING,
    DESIGN_STATUS_FIGMA_GENERATED,
    DESIGN_STATUS_PENDING,
    KNOWN_COPY_STATUSES,
    KNOWN_DESIGN_STATUSES,
    SHEET_COLUMNS,
    SHEET_TEMPLATE_HEADER,
    build_cardnews_row,
    extract_goods_no,
    format_card_body,
)


# ---------------------------------------------------------------------------
# Schema invariants
# ---------------------------------------------------------------------------


class TestSchemaInvariants:
    def test_27_columns(self):
        assert len(SHEET_COLUMNS) == 27

    def test_header_is_csv(self):
        assert "," in SHEET_TEMPLATE_HEADER
        assert SHEET_TEMPLATE_HEADER.split(",") == list(SHEET_COLUMNS)

    @pytest.mark.parametrize("col", [
        "date", "run_id", "product_name", "goods_no", "category",
        "profile_id", "review_count", "confidence",
        "copy_status", "design_status",
        "figma_file_url", "png_folder", "reviewer_notes",
    ])
    def test_required_top_level_columns_present(self, col):
        assert col in SHEET_COLUMNS

    def test_seven_card_pairs(self):
        for i in range(1, 8):
            assert f"card{i:02d}_title" in SHEET_COLUMNS
            assert f"card{i:02d}_body" in SHEET_COLUMNS

    def test_status_enums_complete(self):
        assert "copy_pending" in KNOWN_COPY_STATUSES
        assert "copy_approved" in KNOWN_COPY_STATUSES
        assert "copy_needs_revision" in KNOWN_COPY_STATUSES
        for s in (
            "design_pending",
            "figma_generated",
            "visual_review_needed",
            "publish_ready",
            "rejected",
        ):
            assert s in KNOWN_DESIGN_STATUSES


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


class TestExtractGoodsNo:
    def test_full_url(self):
        assert extract_goods_no(
            "https://www.oliveyoung.co.kr/store/goods/getGoodsDetail.do"
            "?goodsNo=A000000171427"
        ) == "A000000171427"

    def test_lowercase_query_key(self):
        assert extract_goods_no(
            "https://www.oliveyoung.co.kr/...?goodsno=a000000171427"
        ) == "A000000171427"

    def test_empty_returns_empty(self):
        assert extract_goods_no("") == ""
        assert extract_goods_no(None) == ""

    def test_url_without_goods_no(self):
        assert extract_goods_no("https://example.com/something") == ""


class TestFormatCardBody:
    def test_subtitle_then_bullets_then_footer(self):
        body = format_card_body({
            "subtitle": "강점 3가지",
            "bullets": ["A", "B"],
            "footer_note": "출처: 리뷰 N건",
        })
        assert body == "강점 3가지\n• A\n• B\n※ 출처: 리뷰 N건"

    def test_skips_missing_subtitle(self):
        body = format_card_body({"bullets": ["X"]})
        assert body == "• X"

    def test_skips_missing_footer(self):
        body = format_card_body({"subtitle": "S", "bullets": ["B"]})
        assert body == "S\n• B"

    def test_preserves_existing_bullet_marker(self):
        body = format_card_body({
            "bullets": ["✓ approved", "— rejected", "• already-bulleted"],
        })
        # Markers are preserved verbatim — no double-bulleting.
        assert body == "✓ approved\n— rejected\n• already-bulleted"

    def test_drops_empty_bullets(self):
        body = format_card_body({"bullets": ["A", "", "  ", "B"]})
        assert body == "• A\n• B"

    def test_empty_input_returns_empty(self):
        assert format_card_body({}) == ""
        assert format_card_body(None) == ""


# ---------------------------------------------------------------------------
# build_cardnews_row
# ---------------------------------------------------------------------------


def _ar() -> dict:
    return {
        "product": {
            "slug": "product-83743e299623",
            "name_ko": "[1위 패드] 메디힐 더마 패드 200매",
            "category": "마스크팩 > 패드",
            "selected_profile_id": "skincare_pad",
            "source_url": (
                "https://www.oliveyoung.co.kr/store/goods/getGoodsDetail.do"
                "?goodsNo=A000000171427"
            ),
        },
        "corpus": {
            "n_reviews_total": 2029,
            "n_reviews_analyzed": 2029,
            "confidence_level": "high",
        },
    }


def _cn() -> dict:
    return {
        "schema_version": "1.0",
        "slides": [
            {"slide_no": i, "section_type": t, "title": f"T{i}",
             "subtitle": f"S{i}",
             "bullets": [f"b{i}.1", f"b{i}.2"],
             "footer_note": f"f{i}"}
            for i, t in enumerate([
                "hook", "loved", "divides", "fit",
                "watch_outs", "best_for", "method",
            ], start=1)
        ],
    }


class TestBuildCardnewsRow:
    def test_row_has_27_keys_in_locked_order(self):
        row = build_cardnews_row(
            analysis_report=_ar(),
            cardnews_copy=_cn(),
            run_id="run_001",
        )
        assert list(row.keys()) == list(SHEET_COLUMNS)
        assert len(row) == 27

    def test_top_level_fields_populated(self):
        row = build_cardnews_row(
            analysis_report=_ar(),
            cardnews_copy=_cn(),
            run_id="run_001",
            today_str="2026-04-30",
        )
        assert row["date"] == "2026-04-30"
        assert row["run_id"] == "run_001"
        assert row["product_name"].startswith("[1위 패드]")
        assert row["goods_no"] == "A000000171427"
        assert row["category"] == "마스크팩 > 패드"
        assert row["profile_id"] == "skincare_pad"
        assert row["review_count"] == "2029"
        assert row["confidence"] == "high"

    def test_seven_cards_filled_from_slides(self):
        row = build_cardnews_row(
            analysis_report=_ar(),
            cardnews_copy=_cn(),
            run_id="r",
        )
        for i in range(1, 8):
            assert row[f"card{i:02d}_title"] == f"T{i}"
            body = row[f"card{i:02d}_body"]
            assert body.startswith(f"S{i}")
            assert f"• b{i}.1" in body
            assert f"• b{i}.2" in body
            assert f"※ f{i}" in body

    def test_missing_slides_yield_empty_card_columns(self):
        row = build_cardnews_row(
            analysis_report=_ar(),
            cardnews_copy={"slides": []},
            run_id="r",
        )
        for i in range(1, 8):
            assert row[f"card{i:02d}_title"] == ""
            assert row[f"card{i:02d}_body"] == ""

    def test_default_statuses(self):
        row = build_cardnews_row(
            analysis_report=_ar(), cardnews_copy=_cn(), run_id="r",
        )
        assert row["copy_status"] == COPY_STATUS_PENDING
        assert row["design_status"] == DESIGN_STATUS_PENDING

    def test_explicit_statuses(self):
        row = build_cardnews_row(
            analysis_report=_ar(), cardnews_copy=_cn(), run_id="r",
            copy_status=COPY_STATUS_APPROVED,
            design_status=DESIGN_STATUS_FIGMA_GENERATED,
            figma_file_url="https://www.figma.com/file/abc",
            png_folder="exports/r/",
            reviewer_notes="approved by editor — 2026-04-30",
        )
        assert row["copy_status"] == "copy_approved"
        assert row["design_status"] == "figma_generated"
        assert row["figma_file_url"] == "https://www.figma.com/file/abc"
        assert row["png_folder"] == "exports/r/"
        assert "approved" in row["reviewer_notes"]

    def test_invalid_copy_status_rejected(self):
        with pytest.raises(ValueError, match="copy_status"):
            build_cardnews_row(
                analysis_report=_ar(), cardnews_copy=_cn(), run_id="r",
                copy_status="bogus",
            )

    def test_invalid_design_status_rejected(self):
        with pytest.raises(ValueError, match="design_status"):
            build_cardnews_row(
                analysis_report=_ar(), cardnews_copy=_cn(), run_id="r",
                design_status="bogus",
            )

    def test_empty_run_id_rejected(self):
        with pytest.raises(ValueError, match="run_id"):
            build_cardnews_row(
                analysis_report=_ar(), cardnews_copy=_cn(), run_id="",
            )

    def test_review_count_falls_back_to_n_total_when_analyzed_missing(self):
        ar = _ar()
        ar["corpus"].pop("n_reviews_analyzed")
        ar["corpus"]["n_reviews_total"] = 1500
        row = build_cardnews_row(
            analysis_report=ar, cardnews_copy=_cn(), run_id="r",
        )
        assert row["review_count"] == "1500"

    def test_review_count_empty_when_corpus_missing(self):
        ar = _ar()
        ar["corpus"] = {}
        row = build_cardnews_row(
            analysis_report=ar, cardnews_copy=_cn(), run_id="r",
        )
        assert row["review_count"] == ""

    def test_extra_slides_truncated_to_seven(self):
        # Defensive: someone passes 9 slides → row only carries 7.
        cn = _cn()
        cn["slides"].extend([
            {"title": "T8", "bullets": ["x"]},
            {"title": "T9", "bullets": ["y"]},
        ])
        row = build_cardnews_row(
            analysis_report=_ar(), cardnews_copy=cn, run_id="r",
        )
        # Only card01..card07 keys exist.
        assert "card08_title" not in row
        assert row["card07_title"] == "T7"  # not T8 / T9


# ---------------------------------------------------------------------------
# End-to-end against the real Mediheal artifacts
# ---------------------------------------------------------------------------


REPO = Path(__file__).resolve().parents[2]
RUN = REPO / "outputs" / "review_packages" / "2026-04-30_mediheal_pad_run-010"
FIGMA = REPO / "outputs" / "figma_packages" / "mediheal_pad_instagram_v1"


@pytest.mark.skipif(
    not (RUN / "shared" / "analysis_report.json").is_file(),
    reason="run-010 review package not present; skipping integration test",
)
def test_real_run_010_artifacts_produce_clean_row():
    ar = json.loads(
        (RUN / "shared" / "analysis_report.json").read_text(encoding="utf-8"),
    )
    manifest = json.loads(
        (RUN / "manifest.json").read_text(encoding="utf-8"),
    )
    # Prefer the polished Figma copy when it exists; fall back to
    # the raw skeleton from buyer_content.
    if (FIGMA / "figma_cardnews_copy_ko.json").is_file():
        cn = json.loads(
            (FIGMA / "figma_cardnews_copy_ko.json").read_text(encoding="utf-8"),
        )
    else:
        cn = json.loads((
            RUN / "buyer_content" / "ko" / "instagram_cardnews.json"
        ).read_text(encoding="utf-8"))

    row = build_cardnews_row(
        analysis_report=ar,
        cardnews_copy=cn,
        manifest=manifest,
        run_id="2026-04-30_product-83743e299623_run-010",
    )

    assert row["goods_no"] == "A000000171427"
    assert row["profile_id"] == "skincare_pad"
    assert row["category"] == "마스크팩 > 패드"
    assert row["review_count"] == "2029"
    assert row["confidence"] == "high"
    assert row["copy_status"] == COPY_STATUS_PENDING
    assert row["design_status"] == DESIGN_STATUS_PENDING
    # Card 1 carries the polished hook title (or the deterministic
    # one if Figma copy is absent) — either way, non-empty.
    assert row["card01_title"]
    # Card 7 is the method slide.
    assert row["card07_title"]
