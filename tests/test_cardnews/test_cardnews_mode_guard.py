"""Phase A — cardnews_mode guard + manifest contract tests.

Pure-Python. Does not launch Playwright. Covers:
- ``validate_cardnews_mode`` accept / reject behavior for the 3
  reserved modes + arbitrary unknown values.
- ``_build_render_manifest`` carries ``cardnews_mode`` (default
  ``private_demo``) and the matching ``cardnews_mode_constraints``
  block, with ``schema_version == "1.1"``.
- The ``cardnews.render`` CLI argparse rejects
  ``--cardnews-mode public_education`` at parse time (outermost lock).

Policy sources:
- docs/instagram_voc_brand_strategy.md (108888e §9, §10 Phase A)
- docs/instagram_voc_publishing_checklist.md (6dc8a0f §1, §8.3)
"""
from __future__ import annotations

import pytest

from cardnews.render import _build_render_manifest, _main
from cardnews.safety_validator import (
    CardnewsSafetyError,
    validate_cardnews_mode,
)


# ---------------------------------------------------------------------------
# validate_cardnews_mode
# ---------------------------------------------------------------------------


class TestValidateCardnewsMode:
    """Phase A guard contract."""

    def test_private_demo_passes(self) -> None:
        # No raise, returns None.
        assert validate_cardnews_mode("private_demo") is None

    def test_public_education_raises_planner_not_implemented(self) -> None:
        with pytest.raises(CardnewsSafetyError) as exc:
            validate_cardnews_mode("public_education")
        # Single violation.
        assert len(exc.value.violations) == 1
        v = exc.value.violations[0]
        assert v.rule == "planner_not_implemented"
        assert v.location == "cardnews_mode"
        assert v.matched == "public_education"
        # Message points operators at the strategy doc Phase B.
        assert "Phase B" in v.detail
        assert "instagram_voc_brand_strategy" in v.detail

    def test_consented_case_study_raises_planner_not_implemented(self) -> None:
        with pytest.raises(CardnewsSafetyError) as exc:
            validate_cardnews_mode("consented_case_study")
        assert len(exc.value.violations) == 1
        v = exc.value.violations[0]
        assert v.rule == "planner_not_implemented"
        assert v.matched == "consented_case_study"
        assert "Phase B" in v.detail  # planner roadmap pointer

    def test_unknown_mode_raises_unknown_mode(self) -> None:
        with pytest.raises(CardnewsSafetyError) as exc:
            validate_cardnews_mode("bogus_marketing_mode")
        assert len(exc.value.violations) == 1
        v = exc.value.violations[0]
        assert v.rule == "unknown_mode"
        assert v.matched == "bogus_marketing_mode"
        # Message lists the 3 known modes so the caller can self-correct.
        for known in ("private_demo", "public_education", "consented_case_study"):
            assert known in v.detail

    def test_empty_string_treated_as_unknown_mode(self) -> None:
        with pytest.raises(CardnewsSafetyError) as exc:
            validate_cardnews_mode("")
        assert exc.value.violations[0].rule == "unknown_mode"


# ---------------------------------------------------------------------------
# _build_render_manifest
# ---------------------------------------------------------------------------


def _stub_layout() -> dict:
    """Minimal layout dict for manifest-shape tests. Mirrors only the
    keys ``_build_render_manifest`` reads."""
    return {
        "generated_at": "2026-05-06T00:00:00Z",
        "language": "ko",
        "analysis_report_sha256": "a" * 64,
        "content_plan_sha256": "b" * 64,
        "product": {
            "name_ko": "테스트 상품",
            "external_id": "X000",
            "source_url": "https://example.test/x",
            "category": "test",
        },
    }


class TestBuildRenderManifest:
    """Manifest shape contract — what the JSON on disk looks like."""

    def test_default_private_demo_shape(self) -> None:
        manifest = _build_render_manifest(
            layout=_stub_layout(),
            total_pages=12,
            rendered=[{"index": 1, "type": "cover", "png": "pages/01_cover.png"}],
            product_image_source="fallback_gradient",
            cardnews_mode="private_demo",
        )
        # Schema version bumped 1.0 → 1.1.
        assert manifest["schema_version"] == "1.1"
        # Mode lock is machine-readable.
        assert manifest["cardnews_mode"] == "private_demo"
        # Self-describing constraints block matches the policy:
        # private_demo is NOT publishable to public channels; intended
        # distribution is 1:1 비공개; doc + commit hint point to the
        # strategy SHA so operators can chase the policy back.
        constraints = manifest["cardnews_mode_constraints"]
        assert constraints == {
            "publishable_to_public_channels": False,
            "intended_distribution": "1:1 비공개 (DM/email)",
            "policy_doc": "docs/instagram_voc_brand_strategy.md",
            "policy_commit_hint": "108888e",
        }
        # Existing 1.0 fields are preserved byte-for-byte.
        assert manifest["generated_at"] == "2026-05-06T00:00:00Z"
        assert manifest["language"] == "ko"
        assert manifest["page_count"] == 12
        assert manifest["analysis_report_sha256"] == "a" * 64
        assert manifest["content_plan_sha256"] == "b" * 64
        assert manifest["product"]["name_ko"] == "테스트 상품"
        assert manifest["product_image_source"] == "fallback_gradient"
        assert manifest["pages"] == [
            {"index": 1, "type": "cover", "png": "pages/01_cover.png"},
        ]

    def test_constraints_block_for_unsupported_mode_raises_assertion(self) -> None:
        # Defensive guard: if a future planner widens
        # _ALLOWED_CARDNEWS_MODES_TODAY but forgets to update the
        # constraints dispatch, the manifest must NOT ship a stale
        # constraints block silently. _build_render_manifest hits an
        # AssertionError instead of writing public_education with a
        # private_demo-shaped constraints block.
        with pytest.raises(AssertionError) as exc:
            _build_render_manifest(
                layout=_stub_layout(),
                total_pages=0,
                rendered=[],
                product_image_source="fallback_gradient",
                cardnews_mode="public_education",
            )
        assert "_ALLOWED_CARDNEWS_MODES_TODAY" in str(exc.value)


# ---------------------------------------------------------------------------
# CLI argparse lock
# ---------------------------------------------------------------------------


class TestCliCardnewsModeLock:
    """The CLI is the outermost lock — argparse ``choices`` rejects
    anything other than ``private_demo`` at parse time so a user
    cannot ship a mislabeled artifact even by passing the flag
    explicitly."""

    def test_cli_rejects_public_education_at_parse_time(
        self, tmp_path, capsys
    ) -> None:
        # Need a syntactically-valid invocation otherwise argparse
        # raises on a different missing arg first. Use --layout with a
        # placeholder path; --cardnews-mode is parsed before the layout
        # JSON is read, so the file does not need to exist for this
        # test — argparse's choices check fires first.
        layout_placeholder = tmp_path / "layout.json"
        layout_placeholder.write_text("{}", encoding="utf-8")
        with pytest.raises(SystemExit) as exc:
            _main([
                "--layout", str(layout_placeholder),
                "--out-dir", str(tmp_path / "out"),
                "--cardnews-mode", "public_education",
            ])
        assert exc.value.code == 2  # argparse error exit
        err = capsys.readouterr().err
        assert "--cardnews-mode" in err
        # argparse's choices error names the rejected value.
        assert "public_education" in err

    def test_cli_rejects_consented_case_study_at_parse_time(
        self, tmp_path, capsys
    ) -> None:
        layout_placeholder = tmp_path / "layout.json"
        layout_placeholder.write_text("{}", encoding="utf-8")
        with pytest.raises(SystemExit) as exc:
            _main([
                "--layout", str(layout_placeholder),
                "--out-dir", str(tmp_path / "out"),
                "--cardnews-mode", "consented_case_study",
            ])
        assert exc.value.code == 2
        err = capsys.readouterr().err
        assert "consented_case_study" in err
