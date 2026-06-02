"""Tests for src.voc.content.manifest.

Covers manifest construction, atomic write, and integrity validation.
Phase A surface: every buyer-content slot starts as `skipped`; only
seller PDF and provenance can flip to `ok` when a real artifact is
registered.
"""
from __future__ import annotations

import json
from pathlib import Path

import pytest

from src.voc.content.manifest import (
    ARTIFACT_KEYS_PHASE_A,
    BUYER_CONTENT_ARTIFACT_KEYS_PHASE_A,
    MANIFEST_FILENAME,
    MANIFEST_SCHEMA_VERSION,
    SUPPORTED_LANGS_PHASE_A,
    ArtifactRecord,
    ManifestBuildContext,
    ManifestIntegrityError,
    build_phase_a_manifest,
    compute_sha256,
    failed_record,
    skipped_record,
    validate_manifest,
    write_manifest,
    _record_for_existing_file,
)
from src.voc.content.paths import allocate_run_dir


# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------


@pytest.fixture
def run_dir(tmp_path: Path) -> Path:
    return allocate_run_dir("2026-04-29", "demo", base=tmp_path)


def _write_seller_pdf(run_dir: Path, body: bytes = b"%PDF-1.4 fake\n") -> Path:
    target = run_dir / "seller_report" / "seller_report_ko.pdf"
    target.write_bytes(body)
    return target


def _build_minimal_ctx(run_dir: Path, **overrides) -> ManifestBuildContext:
    base = dict(
        run_dir=run_dir,
        product={"slug": "demo", "name_ko": "데모", "source_url": None},
        analysis_report_path="shared/analysis_report.json",
        analysis_report_extras={"n_reviews_total": 0},
        languages=("ko", "en"),
        config={"phase": "A"},
    )
    base.update(overrides)
    return ManifestBuildContext(**base)


# ---------------------------------------------------------------------------
# compute_sha256
# ---------------------------------------------------------------------------


class TestComputeSha256:
    def test_known_digest(self, tmp_path: Path):
        f = tmp_path / "x.txt"
        f.write_text("hello", encoding="utf-8")
        # Known sha256 for "hello"
        assert (
            compute_sha256(f)
            == "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824"
        )

    def test_streams_large_file(self, tmp_path: Path):
        f = tmp_path / "big.bin"
        # 256 KB of zero bytes — exercises the chunked read path.
        f.write_bytes(b"\x00" * (256 * 1024))
        digest = compute_sha256(f)
        assert len(digest) == 64


# ---------------------------------------------------------------------------
# build_phase_a_manifest — shape
# ---------------------------------------------------------------------------


class TestBuildManifestShape:
    def test_schema_version_pinned(self, run_dir: Path):
        m = build_phase_a_manifest(_build_minimal_ctx(run_dir))
        assert m["schema_version"] == MANIFEST_SCHEMA_VERSION

    def test_run_dir_basename(self, run_dir: Path):
        m = build_phase_a_manifest(_build_minimal_ctx(run_dir))
        assert m["run_dir"] == run_dir.name

    def test_safety_block_pinned_to_human_review(self, run_dir: Path):
        m = build_phase_a_manifest(_build_minimal_ctx(run_dir))
        assert m["safety"]["requires_human_review"] is True
        assert m["safety"]["blocking_flags"] == []
        assert m["safety"]["advisory_flags"] == []

    def test_all_phase_a_artifact_keys_present(self, run_dir: Path):
        m = build_phase_a_manifest(_build_minimal_ctx(run_dir))
        for key in ARTIFACT_KEYS_PHASE_A:
            assert key in m["artifacts"]

    def test_all_languages_register_buyer_content_keys(self, run_dir: Path):
        m = build_phase_a_manifest(_build_minimal_ctx(run_dir))
        for lang in ("ko", "en"):
            assert lang in m["artifacts"]["buyer_content"]
            for key in BUYER_CONTENT_ARTIFACT_KEYS_PHASE_A:
                assert key in m["artifacts"]["buyer_content"][lang]

    def test_default_buyer_content_status_is_skipped(self, run_dir: Path):
        m = build_phase_a_manifest(_build_minimal_ctx(run_dir))
        for lang in ("ko", "en"):
            for key in BUYER_CONTENT_ARTIFACT_KEYS_PHASE_A:
                assert m["artifacts"]["buyer_content"][lang][key]["status"] == "skipped"
                assert m["artifacts"]["buyer_content"][lang][key]["path"] is None
                assert m["artifacts"]["buyer_content"][lang][key]["sha256"] is None

    def test_provenance_block_present_with_three_keys(self, run_dir: Path):
        m = build_phase_a_manifest(_build_minimal_ctx(run_dir))
        prov = m["provenance"]
        assert set(prov.keys()) == {"corpus_provenance", "snapshot", "comparability"}
        assert all(prov[k]["status"] == "skipped" for k in prov)

    def test_consumer_insight_brief_key_in_inventory(self, run_dir: Path):
        # Phase C: brief lives at the top level (not under buyer_content)
        # because it's channel-agnostic. Default = skipped.
        m = build_phase_a_manifest(_build_minimal_ctx(run_dir))
        assert "consumer_insight_brief_json" in m["artifacts"]
        assert m["artifacts"]["consumer_insight_brief_json"]["status"] == "skipped"

    def test_skeleton_cardnews_json_renamed(self, run_dir: Path):
        # Phase C migration: instagram_cardnews_json → skeleton_cardnews_json.
        m = build_phase_a_manifest(_build_minimal_ctx(run_dir))
        for lang in ("ko", "en"):
            block = m["artifacts"]["buyer_content"][lang]
            assert "skeleton_cardnews_json" in block
            assert "instagram_cardnews_json" not in block

    def test_manifest_schema_version_is_one_two(self, run_dir: Path):
        from src.voc.content.manifest import MANIFEST_SCHEMA_VERSION
        m = build_phase_a_manifest(_build_minimal_ctx(run_dir))
        assert MANIFEST_SCHEMA_VERSION == "1.2"
        assert m["schema_version"] == "1.2"

    def test_safety_block_has_phase_d_flags(self, run_dir: Path):
        m = build_phase_a_manifest(_build_minimal_ctx(run_dir))
        assert m["safety"]["editorial_polish_used"] is False
        assert m["safety"]["fallback_to_skeleton"] is False

    def test_safety_block_carries_explicit_polish_flags(self, run_dir: Path):
        m = build_phase_a_manifest(
            _build_minimal_ctx(run_dir),
            safety_editorial_polish_used=True,
            safety_fallback_to_skeleton=True,
        )
        assert m["safety"]["editorial_polish_used"] is True
        assert m["safety"]["fallback_to_skeleton"] is True

    def test_editorial_cardnews_json_in_buyer_content_inventory(self, run_dir: Path):
        m = build_phase_a_manifest(_build_minimal_ctx(run_dir))
        for lang in ("ko", "en"):
            assert "editorial_cardnews_json" in m["artifacts"]["buyer_content"][lang]
            assert m["artifacts"]["buyer_content"][lang]["editorial_cardnews_json"]["status"] == "skipped"


# ---------------------------------------------------------------------------
# build_phase_a_manifest — analysis_report block
# ---------------------------------------------------------------------------


class TestAnalysisReportBlock:
    def test_records_sha_when_report_on_disk(self, run_dir: Path):
        report = run_dir / "shared" / "analysis_report.json"
        report.write_text('{"product":{"slug":"demo"}}', encoding="utf-8")
        m = build_phase_a_manifest(_build_minimal_ctx(run_dir))
        assert m["analysis_report"]["sha256"] == compute_sha256(report)
        assert m["analysis_report"]["bytes"] == report.stat().st_size
        assert m["analysis_report"]["path"] == "shared/analysis_report.json"

    def test_keeps_extras(self, run_dir: Path):
        ctx = _build_minimal_ctx(
            run_dir,
            analysis_report_extras={"n_reviews_total": 1135, "confidence_level": "high"},
        )
        m = build_phase_a_manifest(ctx)
        assert m["analysis_report"]["n_reviews_total"] == 1135
        assert m["analysis_report"]["confidence_level"] == "high"


# ---------------------------------------------------------------------------
# Registering a real artifact via _record_for_existing_file
# ---------------------------------------------------------------------------


class TestRecordForExistingFile:
    def test_ok_record_for_seller_pdf(self, run_dir: Path):
        _write_seller_pdf(run_dir)
        rec = _record_for_existing_file(run_dir, "seller_report/seller_report_ko.pdf")
        assert rec.status == "ok"
        assert rec.path == "seller_report/seller_report_ko.pdf"
        assert rec.sha256 is not None
        assert rec.bytes is not None

    def test_raises_when_missing(self, run_dir: Path):
        with pytest.raises(FileNotFoundError):
            _record_for_existing_file(run_dir, "seller_report/missing.pdf")


# ---------------------------------------------------------------------------
# write_manifest — atomic write
# ---------------------------------------------------------------------------


class TestWriteManifest:
    def test_writes_at_run_root(self, run_dir: Path):
        m = build_phase_a_manifest(_build_minimal_ctx(run_dir))
        out = write_manifest(run_dir, m)
        assert out == run_dir / MANIFEST_FILENAME
        assert out.is_file()

    def test_contents_round_trip(self, run_dir: Path):
        m = build_phase_a_manifest(_build_minimal_ctx(run_dir))
        out = write_manifest(run_dir, m)
        loaded = json.loads(out.read_text(encoding="utf-8"))
        assert loaded["schema_version"] == MANIFEST_SCHEMA_VERSION

    def test_no_temp_file_left_behind(self, run_dir: Path):
        m = build_phase_a_manifest(_build_minimal_ctx(run_dir))
        write_manifest(run_dir, m)
        assert not (run_dir / (MANIFEST_FILENAME + ".tmp")).exists()

    def test_raises_when_run_dir_missing(self, tmp_path: Path):
        m = build_phase_a_manifest(_build_minimal_ctx(tmp_path / "nonexistent"))
        with pytest.raises(FileNotFoundError):
            write_manifest(tmp_path / "nonexistent", m)


# ---------------------------------------------------------------------------
# validate_manifest — integrity invariants
# ---------------------------------------------------------------------------


class TestValidateManifestSucceeds:
    def test_default_phase_a_manifest_validates(self, run_dir: Path):
        m = build_phase_a_manifest(_build_minimal_ctx(run_dir))
        validate_manifest(m, run_dir)

    def test_with_real_seller_pdf_registered(self, run_dir: Path):
        _write_seller_pdf(run_dir)
        rec = _record_for_existing_file(run_dir, "seller_report/seller_report_ko.pdf")
        m = build_phase_a_manifest(
            _build_minimal_ctx(run_dir),
            seller_report_record=rec,
        )
        validate_manifest(m, run_dir)


class TestValidateManifestRejects:
    def test_wrong_schema_version(self, run_dir: Path):
        m = build_phase_a_manifest(_build_minimal_ctx(run_dir))
        m["schema_version"] = "9.9"
        with pytest.raises(ManifestIntegrityError, match="schema_version"):
            validate_manifest(m, run_dir)

    def test_human_review_disabled(self, run_dir: Path):
        m = build_phase_a_manifest(_build_minimal_ctx(run_dir))
        m["safety"]["requires_human_review"] = False
        with pytest.raises(ManifestIntegrityError, match="requires_human_review"):
            validate_manifest(m, run_dir)

    def test_missing_required_artifact_key(self, run_dir: Path):
        m = build_phase_a_manifest(_build_minimal_ctx(run_dir))
        del m["artifacts"]["seller_report_ko_pdf"]
        with pytest.raises(ManifestIntegrityError, match="seller_report_ko_pdf"):
            validate_manifest(m, run_dir)

    def test_ok_status_without_path(self, run_dir: Path):
        _write_seller_pdf(run_dir)
        m = build_phase_a_manifest(_build_minimal_ctx(run_dir))
        m["artifacts"]["seller_report_ko_pdf"] = {
            "status": "ok",
            "path": None,
            "sha256": None,
        }
        with pytest.raises(ManifestIntegrityError, match="status=ok requires path"):
            validate_manifest(m, run_dir)

    def test_ok_status_with_absolute_path(self, run_dir: Path):
        _write_seller_pdf(run_dir)
        m = build_phase_a_manifest(_build_minimal_ctx(run_dir))
        m["artifacts"]["seller_report_ko_pdf"] = {
            "status": "ok",
            "path": str(run_dir / "seller_report" / "seller_report_ko.pdf"),
            "sha256": "x" * 64,
        }
        with pytest.raises(ManifestIntegrityError, match="not a safe relative path"):
            validate_manifest(m, run_dir)

    def test_ok_status_under_tmp_prefix(self, run_dir: Path):
        m = build_phase_a_manifest(_build_minimal_ctx(run_dir))
        m["artifacts"]["seller_report_ko_pdf"] = {
            "status": "ok",
            "path": "tmp/leak.pdf",
            "sha256": "x" * 64,
        }
        with pytest.raises(ManifestIntegrityError):
            validate_manifest(m, run_dir)

    def test_ok_status_under_docs_prefix(self, run_dir: Path):
        m = build_phase_a_manifest(_build_minimal_ctx(run_dir))
        m["artifacts"]["seller_report_ko_pdf"] = {
            "status": "ok",
            "path": "docs/leak.pdf",
            "sha256": "x" * 64,
        }
        with pytest.raises(ManifestIntegrityError):
            validate_manifest(m, run_dir)

    def test_ok_status_with_traversal(self, run_dir: Path):
        m = build_phase_a_manifest(_build_minimal_ctx(run_dir))
        m["artifacts"]["seller_report_ko_pdf"] = {
            "status": "ok",
            "path": "shared/../../etc/passwd",
            "sha256": "x" * 64,
        }
        with pytest.raises(ManifestIntegrityError):
            validate_manifest(m, run_dir)

    def test_sha_mismatch_detected(self, run_dir: Path):
        path = _write_seller_pdf(run_dir)
        m = build_phase_a_manifest(_build_minimal_ctx(run_dir))
        m["artifacts"]["seller_report_ko_pdf"] = {
            "status": "ok",
            "path": "seller_report/seller_report_ko.pdf",
            "sha256": "0" * 64,  # wrong digest
        }
        # Sanity: file actually exists
        assert path.is_file()
        with pytest.raises(ManifestIntegrityError, match="sha256 mismatch"):
            validate_manifest(m, run_dir)

    def test_invalid_status_string(self, run_dir: Path):
        m = build_phase_a_manifest(_build_minimal_ctx(run_dir))
        m["artifacts"]["seller_report_ko_pdf"] = {
            "status": "pending",  # not in enum
            "path": None,
            "sha256": None,
        }
        with pytest.raises(ManifestIntegrityError, match="status must be one of"):
            validate_manifest(m, run_dir)

    def test_analysis_report_outside_shared(self, run_dir: Path):
        m = build_phase_a_manifest(_build_minimal_ctx(run_dir))
        m["analysis_report"]["path"] = "buyer_content/analysis_report.json"
        with pytest.raises(ManifestIntegrityError, match="analysis_report.path"):
            validate_manifest(m, run_dir)


# ---------------------------------------------------------------------------
# Sugar helpers
# ---------------------------------------------------------------------------


class TestSugarHelpers:
    def test_skipped_record(self):
        rec = skipped_record("not yet")
        assert rec.status == "skipped"
        assert rec.path is None
        assert rec.sha256 is None
        assert rec.notes == "not yet"

    def test_failed_record(self):
        rec = failed_record("LLM unreachable")
        assert rec.status == "failed"
        assert rec.notes == "LLM unreachable"

    def test_artifact_record_to_dict_omits_optional(self):
        rec = ArtifactRecord(status="ok", path="seller_report/x.pdf", sha256="a" * 64)
        d = rec.to_dict()
        assert "bytes" not in d
        assert "notes" not in d


class TestSelectShippingCardnews:
    """Phase D1: shipping selector."""

    def _manifest_with(self, skeleton_status: str, editorial_status: str) -> dict:
        from src.voc.content.manifest import select_shipping_cardnews  # noqa: F401
        return {
            "artifacts": {
                "buyer_content": {
                    "ko": {
                        "skeleton_cardnews_json": {
                            "status": skeleton_status,
                            "path": "buyer_content/ko/instagram_cardnews.json"
                                    if skeleton_status == "ok" else None,
                        },
                        "editorial_cardnews_json": {
                            "status": editorial_status,
                            "path": "buyer_content/ko/editorial_cardnews.json"
                                    if editorial_status == "ok" else None,
                        },
                    },
                },
            },
        }

    def test_editorial_ok_ships_editorial(self):
        from src.voc.content.manifest import select_shipping_cardnews
        m = self._manifest_with("ok", "ok")
        assert select_shipping_cardnews(m, "ko") == "buyer_content/ko/editorial_cardnews.json"

    def test_editorial_failed_ships_skeleton(self):
        from src.voc.content.manifest import select_shipping_cardnews
        m = self._manifest_with("ok", "failed")
        assert select_shipping_cardnews(m, "ko") == "buyer_content/ko/instagram_cardnews.json"

    def test_editorial_skipped_ships_skeleton(self):
        from src.voc.content.manifest import select_shipping_cardnews
        m = self._manifest_with("ok", "skipped")
        assert select_shipping_cardnews(m, "ko") == "buyer_content/ko/instagram_cardnews.json"

    def test_both_failed_returns_none(self):
        from src.voc.content.manifest import select_shipping_cardnews
        m = self._manifest_with("failed", "failed")
        assert select_shipping_cardnews(m, "ko") is None

    def test_unknown_lang_returns_none(self):
        from src.voc.content.manifest import select_shipping_cardnews
        m = self._manifest_with("ok", "ok")
        assert select_shipping_cardnews(m, "fr") is None
