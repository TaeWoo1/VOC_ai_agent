"""Walking-skeleton smoke test for the review_ops pipeline.

Builds a minimal run_dir + an in-memory SQLite database in tmp_path,
invokes the CLI entrypoint, and asserts that both expected artifacts land
on disk and contain the required disclaimer.
"""

from __future__ import annotations

import json
import sqlite3
from pathlib import Path

import pytest

from scripts.generate_review_ops_report import main as cli_main
from src.voc.persistence.migrations import init_db
from src.voc.reporting.review_ops.schema import DEFAULT_DISCLAIMER_KO

PRODUCT_URL = "https://example.test/product/abc"


def _seed_run_dir(tmp_path: Path) -> Path:
    run_dir = tmp_path / "2026-05-04_product-test_run-001"
    (run_dir / "shared").mkdir(parents=True)
    (run_dir / "manifest.json").write_text(
        json.dumps(
            {
                "schema_version": "manifest.v1",
                "run_dir": run_dir.name,
                "product": {
                    "slug": "product-test",
                    "source_url": PRODUCT_URL,
                },
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    (run_dir / "shared" / "analysis_report.json").write_text(
        json.dumps(
            {
                "schema_version": "analysis_report.v1",
                "generated_at": "2026-05-04T00:00:00Z",
                "product": {
                    "slug": "product-test",
                    "name_ko": "테스트 제품 풀네임",
                    "display_product_name": "테스트 제품",
                    "raw_product_name": "테스트 제품 풀네임",
                    "source_url": PRODUCT_URL,
                    "selected_profile_id": "skincare_pad",
                },
                "corpus": {
                    "n_reviews_total": 2,
                    "observation_window": {"start": None, "end": None},
                },
                "attributes": [],
                "strengths": [],
                "monitoring_candidates": [],
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    return run_dir


def _seed_db(db_path: Path) -> None:
    init_db(str(db_path)).close()
    conn = sqlite3.connect(str(db_path))
    try:
        conn.executemany(
            """
            INSERT INTO phase1_reviews (
                review_id, source_channel, source_method, text,
                rating_raw, review_date, content_fingerprint, is_duplicate,
                product_keyword, channel_meta_json, raw_metadata_json,
                collected_at, ingested_at
            ) VALUES (?, 'oliveyoung', 'api', ?, ?, ?, ?, 0, ?, ?, ?, ?, ?)
            """,
            [
                (
                    "rev_aaaaaaaaaaaa",
                    "촉촉하고 발림성이 좋아요. 재구매 의사 있어요.",
                    5.0,
                    "2026-04-01",
                    "fp1",
                    PRODUCT_URL,
                    json.dumps({"product_option_raw": "기본"}),
                    json.dumps({"oy_review_id": 1}),
                    "2026-05-04T00:00:00Z",
                    "2026-05-04T00:00:00Z",
                ),
                (
                    "rev_bbbbbbbbbbbb",
                    "용기 펌프가 잘 안 나와요. 사용감은 좋은데 아쉬워요.",
                    2.0,
                    "2024-08-12",
                    "fp2",
                    PRODUCT_URL,
                    json.dumps({"product_option_raw": "기본"}),
                    json.dumps({"oy_review_id": 2}),
                    "2026-05-04T00:00:00Z",
                    "2026-05-04T00:00:00Z",
                ),
            ],
        )
        conn.commit()
    finally:
        conn.close()


def test_skeleton_end_to_end(tmp_path, capsys):
    run_dir = _seed_run_dir(tmp_path)
    db_path = tmp_path / "voc_data.db"
    _seed_db(db_path)

    rc = cli_main(["--run-dir", str(run_dir), "--db-path", str(db_path)])
    assert rc == 0

    json_path = run_dir / "shared" / "review_ops_analysis.json"
    html_path = run_dir / "review_ops" / "review_ops_report.html"
    assert json_path.exists(), "review_ops_analysis.json was not written"
    assert html_path.exists(), "review_ops_report.html was not written"

    payload = json.loads(json_path.read_text(encoding="utf-8"))
    assert payload["schema_version"] == "review_ops_analysis.v1"
    assert payload["product"]["display_product_name"] == "테스트 제품"
    assert payload["product"]["selected_profile_id"] == "skincare_pad"
    assert payload["metrics"]["total_reviews"] == 2
    # rating_raw 5 + 2 → avg 3.5
    assert payload["metrics"]["average_rating"] == pytest.approx(3.5, abs=0.01)
    # The 2024-08-12 review is ≥180 days stale and rating ≤3.
    assert payload["metrics"]["stale_negative_count"] == 1
    assert payload["disclaimer"] == DEFAULT_DISCLAIMER_KO

    # Asset wiring: the 5★ row is usable, the 2★ row is risk + stale.
    assert payload["asset_counts"]["usable"] == 1
    assert payload["asset_counts"]["risk"] >= 1
    assert payload["asset_counts"]["stale"] >= 1
    assert any(
        item["review_id"] == "rev_aaaaaaaaaaaa"
        for item in payload["assets"]["usable"]
    )

    html = html_path.read_text(encoding="utf-8")
    assert DEFAULT_DISCLAIMER_KO in html
    assert "테스트 제품" in html
    assert "리뷰 운영 진단 리포트" in html
    # Asset sections now render real items: usable quote + risk quote both present.
    assert "재구매 의사 있어요" in html
    assert "용기 펌프가 잘 안 나와요" in html

    # Section 3 stale band split: rev_bbb (2024-08-12, ★2) is stale-actionable.
    html_skeleton = html_path.read_text(encoding="utf-8")
    assert "갱신 확인 후보" in html_skeleton
    stale_item = payload["assets"]["stale"][0]
    assert stale_item["stale_band"] == "actionable"
    assert isinstance(stale_item["age_days"], int)
    assert stale_item["age_days"] >= 180

    # Pilot polish — header brand chip + executive summary in HTML.
    assert "브랜드: 테스트" in html_skeleton
    assert payload["product"]["brand_name"] == "테스트"
    assert payload["executive_summary"]
    assert payload["executive_summary"] in html_skeleton
    # Raw multi-class chip ("usable / risk" etc.) must not appear in HTML;
    # JSON still preserves the full asset_classes for audit.
    assert "usable / risk" not in html_skeleton
    assert "stale / risk" not in html_skeleton
    # JSON-side audit: at least one asset preserves multi-class info if present.
    all_classes = []
    for bucket in ("usable", "stale", "risk", "insight"):
        for it in payload["assets"][bucket]:
            all_classes.append(it["asset_classes"])
    assert all(isinstance(c, list) for c in all_classes)

    out = capsys.readouterr().out
    assert "db_status=ok" in out
    assert "reviews_loaded=2" in out


def test_emergent_cluster_renders_in_json_and_html(tmp_path):
    run_dir = _seed_run_dir(tmp_path)
    db_path = tmp_path / "voc_data.db"
    init_db(str(db_path)).close()
    conn = sqlite3.connect(str(db_path))
    try:
        conn.executemany(
            """
            INSERT INTO phase1_reviews (
                review_id, source_channel, source_method, text,
                rating_raw, review_date, content_fingerprint, is_duplicate,
                product_keyword, channel_meta_json, raw_metadata_json,
                collected_at, ingested_at
            ) VALUES (?, 'oliveyoung', 'api', ?, ?, ?, ?, 0, ?, ?, ?, ?, ?)
            """,
            [
                (
                    f"pump_{i:03d}",
                    "용기 펌프가 잘 안 나와요. 누수 있어요.",
                    2.0,
                    "2026-04-01",
                    f"fp_pump_{i}",
                    PRODUCT_URL,
                    "{}",
                    "{}",
                    "2026-05-04T00:00:00Z",
                    "2026-05-04T00:00:00Z",
                )
                for i in range(3)
            ],
        )
        conn.commit()
    finally:
        conn.close()

    rc = cli_main(["--run-dir", str(run_dir), "--db-path", str(db_path)])
    assert rc == 0

    payload = json.loads(
        (run_dir / "shared" / "review_ops_analysis.json").read_text(encoding="utf-8")
    )
    cluster_ids = [c["cluster_id"] for c in payload["emergent_clusters"]]
    assert "packaging_pump_leak" in cluster_ids

    # risk_groups: section 4 now renders grouped buckets, not a flat list.
    rg_cids = [g["cluster_id"] for g in payload["risk_groups"]]
    assert "packaging_pump_leak" in rg_cids
    pump_group = next(
        g for g in payload["risk_groups"] if g["cluster_id"] == "packaging_pump_leak"
    )
    assert pump_group["label"] == "용기·포장 사용감"
    assert len(pump_group["items"]) <= 2

    # generated_actions: cluster drives all three lists.
    actions = payload["generated_actions"]
    assert any(
        item["source_cluster_id"] == "packaging_pump_leak"
        for item in actions["landing_page_copy"]
    )
    assert actions["reply_drafts"], "expected at least one humble reply draft"
    pump_oem = next(
        q for q in actions["oem_questions"]
        if q["source_cluster_id"] == "packaging_pump_leak"
    )
    # Profile is skincare_pad → OEM question must use pad/container vocab,
    # never "펌프" (the pad SKU has no pump).
    assert "펌프" not in pump_oem["question"]
    for term in ("용기", "뚜껑", "집게", "포장"):
        assert term in pump_oem["question"]

    html = (run_dir / "review_ops" / "review_ops_report.html").read_text(encoding="utf-8")
    assert "신호 클러스터" in html
    # Profile-aware cluster label: under skincare_pad the packaging cluster
    # surfaces as 용기·뚜껑·집게 사용감, never as the generic 펌프 wording.
    assert "용기·뚜껑·집게 사용감" in html
    assert "펌프·용기 누수" not in html
    assert "keyword_v1" in html
    # Sections 5/6/7 now render real content. Pad profile override means
    # the landing-copy topic uses 용기·포장 (no 펌프) for skincare_pad.
    assert "용기·포장 사용감" in html
    # Landing copy is paste-ready: a concrete pad-format sentence reaches HTML.
    assert "뚜껑" in html and "집게" in html
    # P0 regression: landing copy never renders dict.copy method repr.
    assert "<built-in method copy" not in html
    # Landing copy actual Korean text reaches HTML (pad-vocab override).
    assert "내장 집게를 사용해 패드를 꺼내는" in html
    assert "감사합니다" in html
    assert "확인 가능할까요?" in html
    # Section 4 grouped risk: cluster label + repeat-count chip rendered.
    assert "반복" in html
    assert "risk-group" in html
    # Section 6 channel-aware label: oliveyoung uses CS-response framing.
    assert "1:1 문의/CS 응대 문구 초안" in html
    assert "리뷰 답글 초안" not in html
    assert "올리브영 리뷰에는 직접 답글을 남기기 어려울 수 있어" in html
    # Section 6 framing polish: review-based candidate copy + dual-check note.
    # Per-item "상세페이지 대조 필요" chip was removed; the section-note alone conveys it.
    assert "6. 리뷰 기반 상세페이지/FAQ 보완 후보" in html
    assert "5. 상세페이지 보완 문구" not in html
    assert "실제 상세페이지의 기존 문구" in html
    assert "상세페이지 대조 필요" not in html
    # 신호 클러스터 is now numbered as Section 2.
    assert "2. 신호 클러스터 (반복 키워드)" in html
    # Renumbered cascade for sanity-check.
    assert "5. 즉시 대응이 필요한 리스크 리뷰" in html
    assert "7. 1:1 문의/CS 응대 문구 초안" in html
    assert "8. OEM/기획팀 확인 질문" in html
    assert "9. 운영 자산 수" in html
    # Risk section must not contain the cold-stale action wording (contradiction guard).
    risk_block_start = html.find("5. 즉시 대응이 필요한 리스크 리뷰")
    risk_block_end = html.find("6. 리뷰 기반 상세페이지/FAQ 보완 후보")
    assert risk_block_start != -1 and risk_block_end != -1
    risk_block = html[risk_block_start:risk_block_end]
    assert "장기 과거 리뷰 — 우선순위 낮춤" not in risk_block
    # Auxiliary-report framing near the footer.
    assert "보조 리포트" in html
    # JSON still preserves reply_drafts (schema unchanged).
    assert isinstance(payload["generated_actions"]["reply_drafts"], list)
    assert payload["generated_actions"]["reply_drafts"], "reply drafts must still be emitted"

    # consumer_safe_signals appear in JSON (not in HTML — consumer-facing surface).
    signals = payload["consumer_safe_signals"]
    assert any(s["topic_label"] == "packaging_container" for s in signals)
    sig = next(s for s in signals if s["topic_label"] == "packaging_container")
    assert sig["summary"] == "용기 사용감에 대한 의견이 일부 반복됐어요"
    # Public fields carry no full review_id (12+ hex).
    import re as _re
    public_text = " ".join([sig["topic_label"], sig["tone"], sig["summary"]])
    assert _re.search(r"\b[0-9a-f]{12}\b", public_text) is None


def test_degrades_when_db_missing(tmp_path, capsys):
    """Pipeline must still produce both artifacts when the DB is unreachable."""
    run_dir = _seed_run_dir(tmp_path)
    missing_db = tmp_path / "does_not_exist.db"

    rc = cli_main(["--run-dir", str(run_dir), "--db-path", str(missing_db)])
    assert rc == 0

    json_path = run_dir / "shared" / "review_ops_analysis.json"
    html_path = run_dir / "review_ops" / "review_ops_report.html"
    assert json_path.exists()
    assert html_path.exists()

    payload = json.loads(json_path.read_text(encoding="utf-8"))
    assert payload["metrics"]["total_reviews"] == 0
    out = capsys.readouterr().out
    assert "db_status=missing" in out
