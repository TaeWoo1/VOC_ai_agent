"""Section 6 channel-aware title coverage (template-only).

Renders synthetic ReviewOpsAnalysis with different `source_channel` values
and asserts the section-6 H2 + (when applicable) explanatory note are
correct. Pure template behavior — no DB / no CLI / no pipeline.
"""

from __future__ import annotations

from datetime import datetime, timezone

from src.voc.reporting.review_ops.render_html import render
from src.voc.reporting.review_ops.schema import (
    Generator,
    ProductMeta,
    ReviewOpsAnalysis,
)


def _report_with_channel(channel: str | None) -> ReviewOpsAnalysis:
    return ReviewOpsAnalysis(
        source_run_dir="/tmp/fake",
        generated_at=datetime(2026, 5, 5, 12, tzinfo=timezone.utc),
        generator=Generator(),
        product=ProductMeta(
            display_product_name="테스트 제품",
            source_channel=channel,
        ),
    )


def test_oliveyoung_section6_uses_cs_response_label_and_note():
    html = render(_report_with_channel("oliveyoung"))
    assert "1:1 문의/CS 응대 문구 초안" in html
    assert "올리브영 리뷰에는 직접 답글을 남기기 어려울 수 있어" in html
    # The default review-reply label must NOT appear.
    assert "리뷰 답글 초안" not in html


def test_naver_channel_keeps_review_reply_label():
    html = render(_report_with_channel("naver"))
    assert "리뷰 답글 초안" in html
    assert "1:1 문의/CS 응대 문구 초안" not in html
    assert "올리브영 리뷰에는" not in html


def test_coupang_channel_keeps_review_reply_label():
    html = render(_report_with_channel("coupang"))
    assert "리뷰 답글 초안" in html


def test_unknown_channel_uses_neutral_label():
    html = render(_report_with_channel(None))
    assert "고객 응대 문구 초안" in html
    assert "리뷰 답글 초안" not in html
    assert "1:1 문의/CS 응대 문구 초안" not in html
