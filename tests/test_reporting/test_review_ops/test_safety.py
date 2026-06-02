from __future__ import annotations

from datetime import date, datetime, timezone
from pathlib import Path

import pytest

from src.voc.reporting.review_ops.safety import (
    OperatorReportSafetyError,
    validate_operator,
)
from src.voc.reporting.review_ops.schema import (
    AssetBuckets,
    AssetCounts,
    AssetItem,
    GeneratedActions,
    Generator,
    Metrics,
    ProductMeta,
    ReviewOpsAnalysis,
)


def _make_report(
    *,
    suggested_action: str = "상세페이지·콘텐츠에 인용 가능한지 검토",
    landing_copy: str = "용기 사용감에 대한 안내 문구 추가 검토.",
    landing_rationale: str = "신호 클러스터 packaging_pump_leak (반복 5건) 기반",
    reply_draft: str = (
        "리뷰 남겨주셔서 감사합니다. "
        "말씀해주신 부분은 다시 확인해보겠습니다. 고객센터로 안내 부탁드립니다."
    ),
    oem_question: str = (
        "최근 3개월간 해당 옵션의 펌프 사양 변경 이력이 있었는지 확인 가능할까요?"
    ),
    consumer_summary: str = "용기 사용감에 대한 의견이 일부 반복됐어요",
) -> ReviewOpsAnalysis:
    item = AssetItem(
        review_id="rid_aaaaaaaaaaaa",
        quote="원문 인용 자리표시자",
        rating=2.0,
        review_date=date(2026, 4, 1),
        asset_classes=["risk"],
        suggested_action=suggested_action,
    )
    return ReviewOpsAnalysis(
        source_run_dir="/tmp/fake",
        generated_at=datetime.now(timezone.utc),
        generator=Generator(),
        product=ProductMeta(display_product_name="테스트 제품"),
        metrics=Metrics(),
        asset_counts=AssetCounts(risk=1),
        assets=AssetBuckets(risk=[item]),
        generated_actions=GeneratedActions(
            landing_page_copy=[
                {
                    "topic": "용기·펌프 사용감",
                    "section_hint": "FAQ",
                    "copy": landing_copy,
                    "rationale": landing_rationale,
                    "source_cluster_id": "packaging_pump_leak",
                    "source_review_ids": ["a", "b"],
                }
            ],
            reply_drafts=[
                {
                    "review_id": "rid",
                    "rating": 2.0,
                    "review_date": "2026-04-01",
                    "tone": "humble",
                    "draft": reply_draft,
                    "rationale": "리스크 후보 — CS 답글 회수 검토",
                    "source": "risk",
                }
            ],
            oem_questions=[
                {
                    "category": "용기/포장",
                    "question": oem_question,
                    "evidence_review_ids": ["a", "b"],
                    "source_cluster_id": "packaging_pump_leak",
                    "linked_attribute": "packaging_container",
                    "rationale": "신호 클러스터 packaging_pump_leak 기반",
                }
            ],
        ),
        consumer_safe_signals=[
            {
                "topic_label": "packaging_container",
                "tone": "caution",
                "summary": consumer_summary,
                "evidence_count": 5,
                "audit": {"evidence_review_id_truncated": ["abcdef01…"]},
            }
        ],
    )


def test_valid_generated_report_passes():
    # No raise.
    validate_operator(_make_report())


def test_directive_phrase_in_suggested_action_raises():
    bad = _make_report(suggested_action="즉시 개선 필요")
    with pytest.raises(OperatorReportSafetyError) as ei:
        validate_operator(bad)
    assert any("개선 필요" in v for v in ei.value.violations)
    assert any("suggested_action" in v for v in ei.value.violations)


def test_product_defect_phrase_in_landing_copy_raises():
    bad = _make_report(landing_copy="제품 결함 가능성 안내")
    with pytest.raises(OperatorReportSafetyError) as ei:
        validate_operator(bad)
    assert any("제품 결함" in v for v in ei.value.violations)


def test_landing_medical_claim_raises():
    bad = _make_report(landing_copy="피부 트러블 치료 효과가 있습니다")
    with pytest.raises(OperatorReportSafetyError) as ei:
        validate_operator(bad)
    assert any("치료" in v for v in ei.value.violations)


def test_consumer_review_id_leak_raises():
    bad = _make_report(
        consumer_summary="용기 의견이 반복됐어요 (deadbeefcafe1234)"
    )
    with pytest.raises(OperatorReportSafetyError) as ei:
        validate_operator(bad)
    assert any("hex" in v.lower() for v in ei.value.violations)


def test_consumer_banned_framing_raises():
    bad = _make_report(consumer_summary="브랜드가 숨긴 진실을 폭로합니다")
    with pytest.raises(OperatorReportSafetyError) as ei:
        validate_operator(bad)
    joined = " ".join(ei.value.violations)
    assert "숨긴" in joined
    assert "폭로" in joined


def test_phrase_with_pil_yo_in_allowed_compound_does_not_raise():
    # "확인 필요 후보" / "갱신 필요 리뷰" must NOT trigger any rule
    # (bare 필요 is intentionally not banned).
    ok = _make_report(suggested_action="추가 확인 필요 후보")
    validate_operator(ok)


def test_haseo_hamnida_directive_raises():
    bad = _make_report(reply_draft="고객님이 직접 확인해야 합니다.")
    with pytest.raises(OperatorReportSafetyError) as ei:
        validate_operator(bad)
    assert any("해야 합니다" in v for v in ei.value.violations)


def test_strong_pattern_in_oem_question_raises():
    bad = _make_report(oem_question="원인은 무엇인지 확인 가능할까요?")
    with pytest.raises(OperatorReportSafetyError) as ei:
        validate_operator(bad)
    assert any("원인은" in v for v in ei.value.violations)


def test_violations_list_collects_all_problems():
    bad = _make_report(
        suggested_action="개선 필요",
        landing_copy="치료 효과",
        consumer_summary="브랜드가 숨긴 사실",
    )
    with pytest.raises(OperatorReportSafetyError) as ei:
        validate_operator(bad)
    # Three independent failures should be reported in one pass.
    assert len(ei.value.violations) >= 3


# ── CLI integration: fail-closed behavior ────────────────────────────


def _seed_minimal_run_dir(tmp_path: Path) -> Path:
    import json as _json

    run_dir = tmp_path / "2026-05-04_product-test_run-001"
    (run_dir / "shared").mkdir(parents=True)
    (run_dir / "manifest.json").write_text(
        _json.dumps(
            {
                "schema_version": "manifest.v1",
                "run_dir": run_dir.name,
                "product": {
                    "slug": "product-test",
                    "source_url": "https://example.test/p/abc",
                },
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    (run_dir / "shared" / "analysis_report.json").write_text(
        _json.dumps(
            {
                "schema_version": "analysis_report.v1",
                "generated_at": "2026-05-04T00:00:00Z",
                "product": {
                    "slug": "product-test",
                    "display_product_name": "테스트 제품",
                    "raw_product_name": "테스트 제품",
                    "source_url": "https://example.test/p/abc",
                    "selected_profile_id": "skincare_pad",
                },
                "corpus": {"observation_window": {"start": None, "end": None}},
                "attributes": [],
                "strengths": [],
                "monitoring_candidates": [],
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    return run_dir


def test_cli_fails_gracefully_on_safety_violation(tmp_path, monkeypatch, capsys):
    from scripts.generate_review_ops_report import main as cli_main
    from src.voc.reporting.review_ops import landing_copy as lc

    run_dir = _seed_minimal_run_dir(tmp_path)
    db_path = tmp_path / "voc_data.db"  # not seeded — degrades to empty reviews

    original_generate = lc.generate

    def poisoned_generate(**kwargs):
        # Force a banned phrase into the landing copy output regardless of input.
        return [
            {
                "topic": "test",
                "section_hint": "FAQ",
                "copy": "이 제품은 제품 결함이 있을 수 있어요.",
                "rationale": "test",
                "source_cluster_id": None,
                "source_review_ids": [],
            }
        ] + list(original_generate(**kwargs))

    monkeypatch.setattr(lc, "generate", poisoned_generate)

    rc = cli_main(["--run-dir", str(run_dir), "--db-path", str(db_path)])
    assert rc == 2

    captured = capsys.readouterr()
    assert "safety validation failed" in captured.err
    assert "제품 결함" in captured.err

    # Fail-closed: artifacts must NOT be written.
    assert not (run_dir / "shared" / "review_ops_analysis.json").exists()
    assert not (run_dir / "review_ops" / "review_ops_report.html").exists()
