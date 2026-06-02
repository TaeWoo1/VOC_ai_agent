"""Tests for `scripts/package_creator_handoff.py`.

Builds the creator handoff package against a synthetic run directory
+ synthetic cardnews copy and verifies:

  - every required output file lands on disk
  - buyer_cardnews_copy_ko.json contains 7 slides
  - creator_payload.json carries product / corpus / cardnews /
    seller_insights_summary / design_brief / claim_safety / source_files
  - README_FOR_CREATOR.md surfaces all required caveats
  - tool-agnostic surfaces (README, design brief, buyer copy, payload)
    contain no Figma-specific terms (manifest.json's source-provenance
    references the original input path and is excluded by design)
  - the packager is read-only over the run dir
"""
from __future__ import annotations

import importlib.util
import json
import shutil
import sys
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[2]
PACKAGER = REPO / "scripts" / "package_creator_handoff.py"


@pytest.fixture(scope="module")
def packager():
    sys.path.insert(0, str(REPO))
    spec = importlib.util.spec_from_file_location(
        "package_creator_handoff_test", PACKAGER,
    )
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


# ---------------------------------------------------------------------------
# Synthetic run + content copy fixtures.
# ---------------------------------------------------------------------------


def _build_synthetic_run(run_dir: Path) -> None:
    (run_dir / "shared").mkdir(parents=True)
    (run_dir / "seller_report").mkdir(parents=True)
    (run_dir / "buyer_content" / "ko").mkdir(parents=True)

    # manifest.json (truthy enough to satisfy upstream tools).
    (run_dir / "manifest.json").write_text(
        json.dumps({
            "schema_version": "1.2",
            "run_dir": run_dir.name,
            "product": {
                "slug": "test-product", "name_ko": "테스트 제품",
            },
        }, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    # Fake PDF (any bytes — the packager only sha256s + copies it).
    (run_dir / "seller_report" / "seller_report_ko.pdf").write_bytes(
        b"%PDF-1.4 fake pdf bytes for test\n",
    )
    # analysis_report.json — minimal but realistic.
    (run_dir / "shared" / "analysis_report.json").write_text(
        json.dumps({
            "schema_version": "3.0",
            "product": {
                "slug": "test-product",
                "name_ko": "메디힐 더마 패드 200매",
                "category": "마스크팩 > 패드",
                "selected_profile_id": "skincare_pad",
                "source_url": (
                    "https://www.oliveyoung.co.kr/store/goods/"
                    "getGoodsDetail.do?goodsNo=A000000171427"
                ),
            },
            "corpus": {
                "n_reviews_total": 2029,
                "n_reviews_analyzed": 2029,
                "primary_sort": "DATETIME_DESC",
                "sampling_strategy": "observable_multi_sort_corpus",
                "confidence_level": "high",
                "signal_stability": "high",
                "observation_window": {"start": None, "end": None},
            },
            "strengths": [
                {"attribute_key": "value_price", "supporting_count": 157},
                {"attribute_key": "finish_texture", "supporting_count": 132},
            ],
            "monitoring_candidates": [
                {
                    "attribute_key": "finish_texture",
                    "concern_label_ko": "촉촉함/마무리감",
                    "n_negative": 33,
                    "interview_hook_ko": "마무리 텍스처 — 흡수 후 끈적임",
                },
            ],
            "tradeoffs": [{"pair": "a:positive -> b:negative", "count": 5}],
            "quick_decision": {
                "verdict_ko": "테스트 verdict",
                "watch_outs_ko": ["촉촉함/마무리감"],
            },
            "polarity_audit": {
                "n_total_quotes": 60,
                "n_total_suspect": 5,
                "n_total_suspect_share": 0.0833,
                "by_attribute": {},
                "samples": [],
            },
        }, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    (run_dir / "shared" / "consumer_insight_brief.json").write_text(
        json.dumps({"schema_version": "1.0", "stub": True},
                   ensure_ascii=False),
        encoding="utf-8",
    )


def _build_synthetic_content_copy(content_copy_path: Path) -> None:
    content_copy_path.parent.mkdir(parents=True, exist_ok=True)
    content_copy_path.write_text(
        json.dumps({
            "schema_version": "1.0",
            "format": "instagram_cardnews_7slide",
            "lang": "ko",
            "audience": "general_buyer",
            "tone": "informational, credible, cosmetics editorial",
            "product": {
                "name_ko": "메디힐 더마 패드 200매",
                "category_ko": "마스크팩 > 패드",
                "profile_id": "skincare_pad",
            },
            "corpus_summary": {
                "n_reviews_analyzed": 2029,
                "primary_sort": "DATETIME_DESC",
                "sampling_strategy": "observable_multi_sort_corpus",
                "confidence_level": "high",
                "claim_safety": "informational; no efficacy claim",
            },
            "global_footer_disclaimer_ko": (
                "올리브영 공개 리뷰 2,029건을 정리한 자료입니다. "
                "무작위 표본이 아니며, 특정 결과를 보장하지 않습니다."
            ),
            "slides": [
                {"slide_no": i, "section_type": s,
                 "title": f"슬라이드 {i}", "subtitle": "",
                 "bullets": [], "footer_note": ""}
                for i, s in enumerate(
                    ["hook", "loved", "divides", "fit",
                     "watch_outs", "best_for", "method"],
                    start=1,
                )
            ],
        }, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


@pytest.fixture
def package_dirs(tmp_path: Path):
    run_dir = tmp_path / "2026-05-01_product-test_run-001"
    content_copy = tmp_path / "input_copy" / "figma_cardnews_copy_ko.json"
    out_dir = tmp_path / "out_package"
    _build_synthetic_run(run_dir)
    _build_synthetic_content_copy(content_copy)
    return {
        "run_dir": run_dir,
        "content_copy": content_copy,
        "out_dir": out_dir,
    }


# ---------------------------------------------------------------------------
# Build success — required files land.
# ---------------------------------------------------------------------------


class TestPackageCreation:
    def test_all_required_files_present(self, packager, package_dirs):
        packager.build_package(
            run_dir=package_dirs["run_dir"],
            content_copy_path=package_dirs["content_copy"],
            out_dir=package_dirs["out_dir"],
        )
        for rel in packager.PACKAGE_REQUIRED_FILES:
            p = package_dirs["out_dir"] / rel
            assert p.is_file(), f"missing required file: {rel}"

    def test_seller_pdf_copied_through(self, packager, package_dirs):
        packager.build_package(
            run_dir=package_dirs["run_dir"],
            content_copy_path=package_dirs["content_copy"],
            out_dir=package_dirs["out_dir"],
        )
        pdf = package_dirs["out_dir"] / "seller_report_ko.pdf"
        assert pdf.read_bytes().startswith(b"%PDF")

    def test_analysis_report_lands_under_shared(
        self, packager, package_dirs,
    ):
        packager.build_package(
            run_dir=package_dirs["run_dir"],
            content_copy_path=package_dirs["content_copy"],
            out_dir=package_dirs["out_dir"],
        )
        ar = package_dirs["out_dir"] / "shared" / "analysis_report.json"
        parsed = json.loads(ar.read_text(encoding="utf-8"))
        assert parsed["schema_version"] == "3.0"

    def test_run_dir_unchanged_after_packaging(
        self, packager, package_dirs,
    ):
        before_files = sorted(
            p.relative_to(package_dirs["run_dir"])
            for p in package_dirs["run_dir"].rglob("*") if p.is_file()
        )
        before_sizes = {
            str(p): (package_dirs["run_dir"] / p).stat().st_size
            for p in before_files
        }
        packager.build_package(
            run_dir=package_dirs["run_dir"],
            content_copy_path=package_dirs["content_copy"],
            out_dir=package_dirs["out_dir"],
        )
        after_files = sorted(
            p.relative_to(package_dirs["run_dir"])
            for p in package_dirs["run_dir"].rglob("*") if p.is_file()
        )
        assert before_files == after_files
        for p in after_files:
            assert before_sizes[str(p)] == (
                package_dirs["run_dir"] / p
            ).stat().st_size, f"packager mutated {p}"


# ---------------------------------------------------------------------------
# Buyer cardnews copy — neutralized + 7 slides.
# ---------------------------------------------------------------------------


class TestBuyerCardnewsCopy:
    def test_seven_slides_present(self, packager, package_dirs):
        packager.build_package(
            run_dir=package_dirs["run_dir"],
            content_copy_path=package_dirs["content_copy"],
            out_dir=package_dirs["out_dir"],
        )
        copy_path = (
            package_dirs["out_dir"] / "buyer_cardnews_copy_ko.json"
        )
        copy = json.loads(copy_path.read_text(encoding="utf-8"))
        assert isinstance(copy.get("slides"), list)
        assert len(copy["slides"]) == 7

    def test_format_is_neutral(self, packager, package_dirs):
        packager.build_package(
            run_dir=package_dirs["run_dir"],
            content_copy_path=package_dirs["content_copy"],
            out_dir=package_dirs["out_dir"],
        )
        copy = json.loads(
            (package_dirs["out_dir"]
             / "buyer_cardnews_copy_ko.json").read_text(encoding="utf-8"),
        )
        # `format` is the only field that could carry tool branding.
        assert "figma" not in (copy.get("format") or "").lower()

    def test_tool_specific_top_level_keys_stripped(
        self, packager, package_dirs,
    ):
        # Inject a defensive `figma_*` top-level key into the input.
        # The packager must drop it.
        copy_path = package_dirs["content_copy"]
        injected = json.loads(copy_path.read_text(encoding="utf-8"))
        injected["figma_master_frames"] = ["should_not_appear"]
        injected["figma_layout_spec_ref"] = "../layout_spec.json"
        copy_path.write_text(
            json.dumps(injected, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        packager.build_package(
            run_dir=package_dirs["run_dir"],
            content_copy_path=copy_path,
            out_dir=package_dirs["out_dir"],
        )
        out = json.loads(
            (package_dirs["out_dir"]
             / "buyer_cardnews_copy_ko.json").read_text(encoding="utf-8"),
        )
        assert not any(k.startswith("figma_") for k in out.keys())


# ---------------------------------------------------------------------------
# creator_payload.json shape.
# ---------------------------------------------------------------------------


class TestCreatorPayload:
    def test_top_level_keys_present(self, packager, package_dirs):
        packager.build_package(
            run_dir=package_dirs["run_dir"],
            content_copy_path=package_dirs["content_copy"],
            out_dir=package_dirs["out_dir"],
        )
        payload_path = package_dirs["out_dir"] / "creator_payload.json"
        p = json.loads(payload_path.read_text(encoding="utf-8"))
        for k in (
            "schema_version", "run_id", "product", "corpus",
            "buyer_cardnews", "seller_insights_summary",
            "design_brief", "claim_safety", "source_files",
        ):
            assert k in p, f"creator_payload missing top-level key: {k}"

    def test_polarity_reliability_surfaced_when_present(
        self, packager, package_dirs,
    ):
        """When analysis_report has polarity_audit, the payload should
        carry a `polarity_reliability` block with the headline counts."""
        packager.build_package(
            run_dir=package_dirs["run_dir"],
            content_copy_path=package_dirs["content_copy"],
            out_dir=package_dirs["out_dir"],
        )
        p = json.loads(
            (package_dirs["out_dir"]
             / "creator_payload.json").read_text(encoding="utf-8"),
        )
        assert "polarity_reliability" in p
        assert p["polarity_reliability"]["n_total_quotes"] == 60
        assert p["polarity_reliability"]["n_total_suspect"] == 5

    def test_claim_safety_lists_banned_morphemes(
        self, packager, package_dirs,
    ):
        packager.build_package(
            run_dir=package_dirs["run_dir"],
            content_copy_path=package_dirs["content_copy"],
            out_dir=package_dirs["out_dir"],
        )
        p = json.loads(
            (package_dirs["out_dir"]
             / "creator_payload.json").read_text(encoding="utf-8"),
        )
        cs = p["claim_safety"]
        assert cs["no_medical_claims"] is True
        assert cs["no_efficacy_claims"] is True
        assert cs["no_superlatives"] is True
        # Headline morphemes the creator must NOT introduce.
        banned = set(cs["banned_korean_morphemes"])
        assert {"효과", "효능", "최고", "1위", "반드시", "절대"}.issubset(banned)

    def test_design_brief_carries_palette_and_imagery_rules(
        self, packager, package_dirs,
    ):
        packager.build_package(
            run_dir=package_dirs["run_dir"],
            content_copy_path=package_dirs["content_copy"],
            out_dir=package_dirs["out_dir"],
        )
        p = json.loads(
            (package_dirs["out_dir"]
             / "creator_payload.json").read_text(encoding="utf-8"),
        )
        d = p["design_brief"]
        assert "warm_ivory" in (d["palette"]["core"] or [])
        assert "muted_sage" in (d["palette"]["accent"] or [])
        forbidden = set(d["imagery_rules"]["forbidden"])
        assert "human faces" in forbidden
        assert any("before/after" in s for s in forbidden)
        assert any("medical" in s for s in forbidden)


# ---------------------------------------------------------------------------
# README_FOR_CREATOR.md — required caveats present.
# ---------------------------------------------------------------------------


class TestReadme:
    def test_caveats_present(self, packager, package_dirs):
        packager.build_package(
            run_dir=package_dirs["run_dir"],
            content_copy_path=package_dirs["content_copy"],
            out_dir=package_dirs["out_dir"],
        )
        readme = (
            package_dirs["out_dir"] / "README_FOR_CREATOR.md"
        ).read_text(encoding="utf-8")
        # Each item from the user-stated caveat list.
        assert "observed review corpus" in readme.lower()
        assert "not a medical" in readme.lower()
        assert "no exaggerated skincare" in readme.lower()
        assert "llm polish" in readme.lower()

    def test_partial_collection_caveat_added_when_applicable(
        self, packager, package_dirs,
    ):
        # Inject a collection_summary indicating partial success.
        cs_path = (
            package_dirs["run_dir"] / "shared" / "collection_summary.json"
        )
        cs_path.write_text(
            json.dumps({
                "partial_success": True,
                "sorts_attempted": ["A", "B", "C"],
                "sorts_succeeded": ["A"],
                "sorts_failed": ["B", "C"],
                "analysis_status": "completed",
                "goodsNo": "A000000171427",
            }, ensure_ascii=False),
            encoding="utf-8",
        )
        packager.build_package(
            run_dir=package_dirs["run_dir"],
            content_copy_path=package_dirs["content_copy"],
            out_dir=package_dirs["out_dir"],
        )
        readme = (
            package_dirs["out_dir"] / "README_FOR_CREATOR.md"
        ).read_text(encoding="utf-8")
        assert "partial collection" in readme.lower()


# ---------------------------------------------------------------------------
# Tool-agnostic content surfaces: no Figma terms in
# README/design brief/buyer copy/payload.
# ---------------------------------------------------------------------------


class TestNoFigmaInToolAgnosticSurfaces:
    """Per the architecture pivot: the new content package must read
    as tool-agnostic. The manifest.json's `sources.content_copy_input`
    legitimately records the input path (often a `figma_*`-named file
    for now) and is excluded from this check."""

    TOOL_AGNOSTIC_FILES = (
        "README_FOR_CREATOR.md",
        "content_design_brief.md",
        "buyer_cardnews_copy_ko.json",
        "creator_payload.json",
    )

    @pytest.fixture
    def built_package(self, packager, package_dirs):
        packager.build_package(
            run_dir=package_dirs["run_dir"],
            content_copy_path=package_dirs["content_copy"],
            out_dir=package_dirs["out_dir"],
        )
        return package_dirs["out_dir"]

    @pytest.mark.parametrize("rel_path", TOOL_AGNOSTIC_FILES)
    def test_no_figma_references(self, built_package: Path, rel_path: str):
        body = (built_package / rel_path).read_text(encoding="utf-8")
        lower = body.lower()
        # Figma-specific terms that must not appear.
        assert "figma" not in lower, (
            f"{rel_path} contains 'figma':\n  "
            f"{[ln for ln in body.splitlines() if 'figma' in ln.lower()][:3]}"
        )
        assert "master_frame" not in lower
        assert "master frame" not in lower

    def test_manifest_records_source_path_for_provenance(
        self, built_package: Path,
    ):
        """Per design: manifest.json may legitimately reference the
        `figma_*`-named input file because it's recording provenance."""
        m = json.loads(
            (built_package / "manifest.json").read_text(encoding="utf-8"),
        )
        sources = m.get("sources") or {}
        assert "content_copy_input" in sources


# ---------------------------------------------------------------------------
# Validation guard.
# ---------------------------------------------------------------------------


class TestValidationGuard:
    def test_missing_run_dir_raises(self, packager, tmp_path: Path):
        with pytest.raises(FileNotFoundError):
            packager.build_package(
                run_dir=tmp_path / "nope",
                content_copy_path=tmp_path / "fake.json",
                out_dir=tmp_path / "out",
            )

    def test_missing_required_input_raises(
        self, packager, package_dirs,
    ):
        # Delete the seller PDF — packager must refuse.
        (package_dirs["run_dir"]
         / "seller_report" / "seller_report_ko.pdf").unlink()
        with pytest.raises(FileNotFoundError, match="required input"):
            packager.build_package(
                run_dir=package_dirs["run_dir"],
                content_copy_path=package_dirs["content_copy"],
                out_dir=package_dirs["out_dir"],
            )

    def test_non_dict_content_copy_raises(
        self, packager, package_dirs,
    ):
        package_dirs["content_copy"].write_text(
            json.dumps(["not", "an", "object"]), encoding="utf-8",
        )
        with pytest.raises(ValueError, match="not a JSON object"):
            packager.build_package(
                run_dir=package_dirs["run_dir"],
                content_copy_path=package_dirs["content_copy"],
                out_dir=package_dirs["out_dir"],
            )


# ---------------------------------------------------------------------------
# Consistency validation: buyer copy review-count vs analysis_report.
# ---------------------------------------------------------------------------


def _set_copy_review_count(content_copy_path: Path, structured_n: int | None,
                            narrative_subtitle: str | None = None) -> None:
    """Mutate the synthetic cardnews copy to test specific count
    scenarios. `structured_n` controls
    `corpus_summary.n_reviews_analyzed`; `narrative_subtitle` replaces
    slide 1's subtitle text."""
    obj = json.loads(content_copy_path.read_text(encoding="utf-8"))
    if structured_n is None:
        obj.get("corpus_summary", {}).pop("n_reviews_analyzed", None)
    else:
        obj.setdefault("corpus_summary", {})["n_reviews_analyzed"] = structured_n
    if narrative_subtitle is not None and obj.get("slides"):
        obj["slides"][0]["subtitle"] = narrative_subtitle
    # Also clear any global footer that mentions a count, to keep the
    # narrative scan's surface minimal in tests.
    obj["global_footer_disclaimer_ko"] = (
        "공개 리뷰 데이터를 정리한 자료입니다."
    )
    content_copy_path.write_text(
        json.dumps(obj, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


class TestConsistencyValidationPureFn:
    """Pure-function tests for `validate_count_consistency` —
    decoupled from `build_package` so the regex/boundary semantics
    can be exercised cheaply."""

    def test_matching_structured_and_narrative_no_warning(self, packager):
        analysis_report = {"corpus": {"n_reviews_analyzed": 2029}}
        copy = {
            "corpus_summary": {"n_reviews_analyzed": 2029},
            "slides": [{"subtitle": "리뷰 2,029건 정리"}],
            "global_footer_disclaimer_ko": "공개 리뷰 2,029건을 정리한 자료입니다.",
        }
        warnings = packager.validate_count_consistency(copy, analysis_report)
        assert warnings == []

    def test_per_attribute_counts_excluded(self, packager):
        """`만족 후기 N건` and `불만 후기 N건` are per-attribute counts —
        the validator must NOT match them as corpus-total drift."""
        analysis_report = {"corpus": {"n_reviews_analyzed": 2029}}
        copy = {
            "corpus_summary": {"n_reviews_analyzed": 2029},
            "slides": [{
                "title": "메디힐 더마 패드",
                "subtitle": "리뷰 2,029건 정리",
                "bullets": [
                    "200매 대용량 가성비 — 만족 후기 157건",
                    "촉촉함/마무리감 — 불만 후기 33건",
                ],
            }],
        }
        warnings = packager.validate_count_consistency(copy, analysis_report)
        assert warnings == []

    def test_structured_mismatch_emits_warning(self, packager):
        analysis_report = {"corpus": {"n_reviews_analyzed": 2029}}
        copy = {
            "corpus_summary": {"n_reviews_analyzed": 2030},  # drift
            "slides": [{"subtitle": "리뷰 2,029건 정리"}],
        }
        warnings = packager.validate_count_consistency(copy, analysis_report)
        assert len(warnings) >= 1
        mismatch = [w for w in warnings
                    if w.get("code") == "review_count_mismatch"]
        assert mismatch
        w = mismatch[0]
        assert w["expected"] == 2029
        assert w["found"] == 2030
        assert w["severity"] == "warning"

    def test_narrative_mismatch_emits_warning(self, packager):
        analysis_report = {"corpus": {"n_reviews_analyzed": 2029}}
        copy = {
            "corpus_summary": {"n_reviews_analyzed": 2029},
            "slides": [{"subtitle": "리뷰 1,500건 정리"}],  # narrative drift
        }
        warnings = packager.validate_count_consistency(copy, analysis_report)
        mismatch = [w for w in warnings
                    if w.get("code") == "review_count_mismatch"]
        assert len(mismatch) == 1
        assert mismatch[0]["found"] == 1500
        assert mismatch[0]["expected"] == 2029
        assert mismatch[0]["source_kind"] == "narrative"

    def test_no_count_in_copy_yields_info_note(self, packager):
        """When neither a structured count nor a narrative `리뷰 N건`
        mention exists, the validator emits `copy_count_not_found`
        as severity=info — not a blocking warning."""
        analysis_report = {"corpus": {"n_reviews_analyzed": 2029}}
        copy = {
            "slides": [{
                "title": "촉촉할까 답답할까",
                "subtitle": "구매 전 한 번에 보기",
            }],
        }
        warnings = packager.validate_count_consistency(copy, analysis_report)
        assert len(warnings) == 1
        assert warnings[0]["code"] == "copy_count_not_found"
        assert warnings[0]["severity"] == "info"

    def test_missing_expected_count_yields_info_note(self, packager):
        copy = {
            "corpus_summary": {"n_reviews_analyzed": 2029},
            "slides": [],
        }
        warnings = packager.validate_count_consistency(
            copy, {"corpus": {}},
        )
        assert any(w.get("code") == "expected_count_missing"
                   for w in warnings)
        # Info severity — not blocking.
        for w in warnings:
            assert w.get("severity") == "info"

    def test_duplicate_narrative_mentions_dedupe(self, packager):
        """The same drift quoted in two slides should produce one
        warning per (location, value) pair — not N near-identical ones."""
        analysis_report = {"corpus": {"n_reviews_analyzed": 2029}}
        copy = {
            "slides": [
                {"subtitle": "리뷰 1,500건 정리"},  # location A
                {"subtitle": "리뷰 1,500건 정리"},  # location B (different path)
            ],
        }
        warnings = packager.validate_count_consistency(copy, analysis_report)
        # Two different locations → two warnings (not collapsed across
        # paths). But the same path repeated wouldn't double up.
        mismatch = [w for w in warnings
                    if w.get("code") == "review_count_mismatch"]
        assert len(mismatch) == 2


class TestConsistencyEmbeddedInPackage:
    """Verify the validator's output rides into README / creator_payload
    / manifest when build_package runs."""

    def test_no_warning_when_consistent(
        self, packager, package_dirs,
    ):
        # Matching count baseline.
        _set_copy_review_count(
            package_dirs["content_copy"],
            structured_n=2029,
            narrative_subtitle="리뷰 2,029건 정리",
        )
        # The synthetic analysis_report has n_reviews_analyzed=2029
        # (set by `_build_synthetic_run`).
        packager.build_package(
            run_dir=package_dirs["run_dir"],
            content_copy_path=package_dirs["content_copy"],
            out_dir=package_dirs["out_dir"],
        )
        manifest = json.loads(
            (package_dirs["out_dir"] / "manifest.json")
            .read_text(encoding="utf-8"),
        )
        payload = json.loads(
            (package_dirs["out_dir"] / "creator_payload.json")
            .read_text(encoding="utf-8"),
        )
        readme = (
            package_dirs["out_dir"] / "README_FOR_CREATOR.md"
        ).read_text(encoding="utf-8")
        assert manifest.get("handoff_warnings") == []
        assert payload.get("handoff_warnings") == []
        # README's warnings block exists but says "None".
        assert "Handoff warnings" in readme
        assert "_None — buyer cardnews copy is consistent" in readme

    def test_mismatch_warning_embedded_in_all_three_surfaces(
        self, packager, package_dirs,
    ):
        # Cause a structured drift: copy says 2030, report says 2029.
        _set_copy_review_count(
            package_dirs["content_copy"],
            structured_n=2030,
            narrative_subtitle="리뷰 2,030건 정리",
        )
        packager.build_package(
            run_dir=package_dirs["run_dir"],
            content_copy_path=package_dirs["content_copy"],
            out_dir=package_dirs["out_dir"],
        )
        manifest = json.loads(
            (package_dirs["out_dir"] / "manifest.json")
            .read_text(encoding="utf-8"),
        )
        payload = json.loads(
            (package_dirs["out_dir"] / "creator_payload.json")
            .read_text(encoding="utf-8"),
        )
        readme = (
            package_dirs["out_dir"] / "README_FOR_CREATOR.md"
        ).read_text(encoding="utf-8")

        for surface_name, warnings in (
            ("manifest", manifest.get("handoff_warnings") or []),
            ("payload", payload.get("handoff_warnings") or []),
        ):
            mismatch = [
                w for w in warnings
                if w.get("code") == "review_count_mismatch"
            ]
            assert mismatch, f"{surface_name} missing review_count_mismatch warning"
            assert mismatch[0]["expected"] == 2029
            assert mismatch[0]["found"] in (2030,)

        assert "consistency warning" in readme.lower()
        assert "2,029" in readme  # expected count
        assert "review_count_mismatch" in readme

    def test_copy_count_not_found_info_in_all_surfaces(
        self, packager, package_dirs,
    ):
        # Strip every count mention.
        obj = json.loads(
            package_dirs["content_copy"].read_text(encoding="utf-8"),
        )
        obj.get("corpus_summary", {}).pop("n_reviews_analyzed", None)
        for slide in obj.get("slides", []):
            slide["subtitle"] = ""
        obj["global_footer_disclaimer_ko"] = (
            "공개 리뷰 데이터를 정리한 자료입니다."
        )
        package_dirs["content_copy"].write_text(
            json.dumps(obj, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )

        packager.build_package(
            run_dir=package_dirs["run_dir"],
            content_copy_path=package_dirs["content_copy"],
            out_dir=package_dirs["out_dir"],
        )
        manifest = json.loads(
            (package_dirs["out_dir"] / "manifest.json")
            .read_text(encoding="utf-8"),
        )
        warnings = manifest.get("handoff_warnings") or []
        codes = {w.get("code") for w in warnings}
        assert "copy_count_not_found" in codes
        # Severity must be info — NOT blocking.
        for w in warnings:
            if w.get("code") == "copy_count_not_found":
                assert w["severity"] == "info"


class TestStrictConsistencyMode:
    def test_strict_mismatch_raises_consistency_error(
        self, packager, package_dirs,
    ):
        _set_copy_review_count(
            package_dirs["content_copy"],
            structured_n=2030,
            narrative_subtitle="리뷰 2,030건 정리",
        )
        with pytest.raises(packager.ConsistencyError) as ei:
            packager.build_package(
                run_dir=package_dirs["run_dir"],
                content_copy_path=package_dirs["content_copy"],
                out_dir=package_dirs["out_dir"],
                strict_consistency=True,
            )
        # The exception carries the warnings so the CLI can print
        # operator context before exiting.
        assert ei.value.warnings
        codes = {(w.get("code") or "?") for w in ei.value.warnings}
        assert "review_count_mismatch" in codes

    def test_strict_match_does_not_raise(
        self, packager, package_dirs,
    ):
        _set_copy_review_count(
            package_dirs["content_copy"],
            structured_n=2029,
            narrative_subtitle="리뷰 2,029건 정리",
        )
        # Should NOT raise.
        packager.build_package(
            run_dir=package_dirs["run_dir"],
            content_copy_path=package_dirs["content_copy"],
            out_dir=package_dirs["out_dir"],
            strict_consistency=True,
        )

    def test_strict_info_only_does_not_raise(
        self, packager, package_dirs,
    ):
        """`copy_count_not_found` has severity=info — strict mode
        should NOT fail on it."""
        obj = json.loads(
            package_dirs["content_copy"].read_text(encoding="utf-8"),
        )
        obj.get("corpus_summary", {}).pop("n_reviews_analyzed", None)
        for slide in obj.get("slides", []):
            slide["subtitle"] = ""
        obj["global_footer_disclaimer_ko"] = (
            "공개 리뷰 데이터를 정리한 자료입니다."
        )
        package_dirs["content_copy"].write_text(
            json.dumps(obj, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        packager.build_package(
            run_dir=package_dirs["run_dir"],
            content_copy_path=package_dirs["content_copy"],
            out_dir=package_dirs["out_dir"],
            strict_consistency=True,
        )

    def test_cli_strict_mismatch_returns_nonzero_exit(
        self, packager, package_dirs,
    ):
        _set_copy_review_count(
            package_dirs["content_copy"],
            structured_n=2030,
            narrative_subtitle="리뷰 2,030건 정리",
        )
        rc = packager.main([
            "--run-dir", str(package_dirs["run_dir"]),
            "--content-copy", str(package_dirs["content_copy"]),
            "--out-dir", str(package_dirs["out_dir"]),
            "--strict-consistency",
        ])
        assert rc != 0
        # The CLI's documented exit code for ConsistencyError is 4.
        assert rc == 4

    def test_cli_non_strict_mismatch_returns_zero_exit(
        self, packager, package_dirs,
    ):
        """Without --strict-consistency, mismatch warnings are
        non-blocking — package still builds, exit 0."""
        _set_copy_review_count(
            package_dirs["content_copy"],
            structured_n=2030,
            narrative_subtitle="리뷰 2,030건 정리",
        )
        rc = packager.main([
            "--run-dir", str(package_dirs["run_dir"]),
            "--content-copy", str(package_dirs["content_copy"]),
            "--out-dir", str(package_dirs["out_dir"]),
        ])
        assert rc == 0
        # Warnings still embedded.
        manifest = json.loads(
            (package_dirs["out_dir"] / "manifest.json")
            .read_text(encoding="utf-8"),
        )
        assert any(
            w.get("code") == "review_count_mismatch"
            for w in (manifest.get("handoff_warnings") or [])
        )
