"""Pure Notion payload builder (I1). No network, no Notion client, no env.

Exercises notion_page_title / build_notion_blocks / build_notion_payload only.
The actual API client + Streamlit button land in I2 and are not tested here.
"""

from __future__ import annotations

from datetime import date
from types import SimpleNamespace

from src.voc.review_ops.industrial import notion_export as nx
from src.voc.review_ops.industrial.notion_export import (
    APPLICABILITY_ORDER,
    MAX_WORKLIST,
    NO_NEEDS_REPLY_TEXT,
    NOTION_API_VERSION,
    SECTION_TITLES,
    build_notion_blocks,
    build_notion_payload,
    export_to_notion,
    notion_page_title,
    resolve_notion_config,
)

TODAY = date(2026, 1, 21)


# --- fixtures ----------------------------------------------------------------


def _review(text, *, product="전선몰딩", rating=2.0, day=20, tags=("needs_reply",)):
    return (
        SimpleNamespace(
            review_id=f"r-{text[:4]}",
            text=text,
            product_name=product,
            rating=rating,
            review_date=date(2026, 1, day),
        ),
        list(tags),
    )


def _issue(title, *, count=8, action="고정력 보강 안내 추가 검토", reps=None):
    return {
        "issue_title": title,
        "severity": 3,
        "severity_label": "높음",
        "type_label": "품질",
        "tag_label": "접착력",
        "review_count": count,
        "summary": f"{title} 관련 의견이 반복됩니다.",
        "recommended_action": action,
        "product_summary": "상품: 전선몰딩",
        "reps": reps
        or [
            {"작성일": "2026-01-19", "채널": "네이버", "평점": "2", "상품명": "전선몰딩",
             "리뷰": "벽지에 붙였더니 접착력이 약해서 떨어졌어요."},
            {"작성일": "2026-01-18", "채널": "네이버", "평점": "1", "상품명": "전선몰딩",
             "리뷰": "자를 때 깨졌습니다."},
            {"작성일": "2026-01-17", "채널": "네이버", "평점": "2", "상품명": "전선몰딩",
             "리뷰": "세 번째 근거 (캡 초과되어야 함)."},
        ],
    }


def _worklist_item(text, *, day=20, reason="평점이 낮아 확인이 필요합니다.",
                   action="내용 확인 후 필요하면 답글로 안내하세요."):
    return {
        "review_id": f"w-{text[:4]}",
        "작성일": f"2026-01-{day}",
        "채널": "네이버",
        "상품명": "전선몰딩",
        "평점": "2",
        "태그": "품질",
        "리뷰": text,
        "reason": reason,
        "suggested_action": action,
    }


def _full_result():
    return {
        "scope_label": "선택 상품 6개",
        "scope_products": ["전선몰딩"],
        "total": 1141,
        "full_active_count": 2962,
        "scoped_active_count": 1141,
        "today_count": 12,
        "week_count": 30,
        "issue_count": 2,
        "rating_summary": {"average": 3.1, "low_count": 210, "total": 1141},
        "issue_items": [_issue("접착력 부족"), _issue("절단 시 깨짐", action="절단 도구/작업 방법 안내 검토")],
        "worklist_items": [_worklist_item(f"리뷰 {i}", day=20) for i in range(10)],
        "tagged": [
            _review("답글이 필요한 리뷰입니다.", tags=("needs_reply",)),
            _review("자석이 약해요.", tags=("quality",)),
        ],
    }


def _empty_result():
    return {
        "scope_label": "전체 상품",
        "scope_products": [],
        "total": 0,
        "full_active_count": 0,
        "scoped_active_count": 0,
        "today_count": 0,
        "week_count": 0,
        "issue_count": 0,
        "rating_summary": {"average": None, "low_count": 0, "total": 0},
        "issue_items": [],
        "worklist_items": [],
        "tagged": [],
    }


def _headings(blocks):
    return [
        b[b["type"]]["rich_text"][0]["text"]["content"]
        for b in blocks
        if b["type"] in ("heading_2", "heading_3")
    ]


def _all_text(blocks):
    out = []
    for b in blocks:
        rt = b.get(b["type"], {}).get("rich_text")
        if rt:
            out.append(rt[0]["text"]["content"])
    return "\n".join(out)


# --- title -------------------------------------------------------------------


def test_title_includes_scope_label_and_date():
    title = notion_page_title(_full_result(), TODAY)
    assert "리뷰 운영 점검" in title
    assert "선택 상품 6개" in title
    assert "2026-01-21" in title


def test_scoped_vs_full_title_differs():
    scoped = notion_page_title(_full_result(), TODAY)
    full = notion_page_title(_empty_result(), TODAY)
    assert scoped != full
    assert "전체 상품" in full


# --- sections present --------------------------------------------------------


def test_all_seven_section_headings_exist():
    headings = _headings(build_notion_blocks(_full_result()))
    for title in SECTION_TITLES:
        assert title in headings, title


def test_analysis_summary_includes_key_counts():
    text = _all_text(build_notion_blocks(_full_result()))
    assert "선택 상품 6개" in text
    assert "1,141" in text  # scoped count
    assert "2,962" in text  # full count
    assert "3.1점" in text   # average rating
    assert "210" in text     # low_count


# --- issues ------------------------------------------------------------------


def test_issue_blocks_include_evidence_and_action():
    text = _all_text(build_notion_blocks(_full_result()))
    assert "접착력 부족" in text
    assert "절단 시 깨짐" in text
    assert "추천 조치" in text
    assert "고정력 보강 안내 추가 검토" in text
    # verbatim evidence quote present
    assert "접착력이 약해서 떨어졌어요" in text


def test_issue_evidence_is_capped():
    blocks = build_notion_blocks(_full_result())
    quotes = [b for b in blocks if b["type"] == "quote"]
    # 2 issues x 2 evidence + worklist quotes; the 3rd-rep marker must not appear.
    assert "세 번째 근거" not in _all_text(blocks)
    assert quotes  # some evidence rendered


# --- worklist ----------------------------------------------------------------


def test_worklist_includes_reason_and_action():
    text = _all_text(build_notion_blocks(_full_result()))
    assert "확인 이유:" in text
    assert "다음 조치:" in text
    assert "평점이 낮아 확인이 필요합니다." in text


def test_worklist_cap_respected():
    result = _full_result()
    result["worklist_items"] = [_worklist_item(f"긴목록 {i}") for i in range(20)]
    text = _all_text(build_notion_blocks(result))
    # only MAX_WORKLIST reviews rendered
    assert f"긴목록 {MAX_WORKLIST - 1}" in text
    assert f"긴목록 {MAX_WORKLIST}" not in text


# --- needs reply -------------------------------------------------------------


def test_needs_reply_fallback_when_none():
    result = _full_result()
    result["tagged"] = [_review("일반 리뷰", tags=("quality",))]
    text = _all_text(build_notion_blocks(result))
    assert NO_NEEDS_REPLY_TEXT in text


def test_needs_reply_lists_reviews_when_present():
    text = _all_text(build_notion_blocks(_full_result()))
    assert "답글이 필요한 리뷰입니다." in text
    assert NO_NEEDS_REPLY_TEXT not in text


# --- applicability -----------------------------------------------------------


def test_applicability_includes_all_three_categories():
    headings = _headings(build_notion_blocks(_full_result()))
    for category in APPLICABILITY_ORDER:
        assert category in headings, category


def test_applicability_does_not_overclaim():
    text = _all_text(build_notion_blocks(_full_result()))
    # not-yet-automate category items appear under the right framing
    assert "답글 자동 게시" in text
    assert "고객 응대 완전 자동화" in text


# --- block budget / safety ---------------------------------------------------


def test_block_count_under_100():
    assert len(build_notion_blocks(_full_result())) < 100


def test_empty_result_builds_safely():
    blocks = build_notion_blocks(_empty_result())
    assert len(blocks) < 100
    headings = _headings(blocks)
    for title in SECTION_TITLES:
        assert title in headings
    # fallbacks present, no crash
    text = _all_text(blocks)
    assert NO_NEEDS_REPLY_TEXT in text


# --- payload assembly --------------------------------------------------------


def test_payload_shape():
    payload = build_notion_payload(_full_result(), "parent-123", TODAY)
    assert payload["parent"] == {"type": "page_id", "page_id": "parent-123"}
    title_rt = payload["properties"]["title"]["title"][0]["text"]["content"]
    assert "선택 상품 6개" in title_rt
    assert isinstance(payload["children"], list)
    assert payload["children"] == build_notion_blocks(_full_result())


def test_valid_block_objects():
    for b in build_notion_blocks(_full_result()):
        assert b.get("object") == "block" or b["type"] == "divider"
        assert b["type"] in b  # the type-keyed payload exists


# --- I2 client: resolve_notion_config ---------------------------------------


def test_resolve_config_missing_is_safe(monkeypatch, tmp_path):
    monkeypatch.delenv("NOTION_API_KEY", raising=False)
    monkeypatch.delenv("NOTION_PARENT_PAGE_ID", raising=False)
    # force a fresh load against an empty cwd so no real .env interferes
    monkeypatch.setattr(nx, "_notion_env_loaded", True, raising=False)
    key, parent = resolve_notion_config()
    assert key is None
    assert parent is None


def test_resolve_config_reads_env(monkeypatch):
    monkeypatch.setattr(nx, "_notion_env_loaded", True, raising=False)
    monkeypatch.setenv("NOTION_API_KEY", "secret-abc")
    monkeypatch.setenv("NOTION_PARENT_PAGE_ID", "parent-xyz")
    key, parent = resolve_notion_config()
    assert key == "secret-abc"
    assert parent == "parent-xyz"


# --- I2 client: export_to_notion (fake transport, no network) ---------------


def test_export_ok_returns_url():
    captured = {}

    def fake_transport(url, payload, headers):
        captured["url"] = url
        captured["payload"] = payload
        captured["headers"] = headers
        return {"url": "https://www.notion.so/created-page-123"}

    payload = build_notion_payload(_full_result(), "parent-1", TODAY)
    res = export_to_notion(payload, api_key="secret-key", transport=fake_transport)
    assert res.ok is True
    assert res.url == "https://www.notion.so/created-page-123"
    assert res.error is None


def test_export_failure_returns_error_not_ok():
    def raising_transport(url, payload, headers):
        raise RuntimeError("network down")

    res = export_to_notion({}, api_key="secret-key", transport=raising_transport)
    assert res.ok is False
    assert res.url is None
    assert "network down" in (res.error or "")


def test_export_sends_method_headers_and_json():
    captured = {}

    def fake_transport(url, payload, headers):
        captured["url"] = url
        captured["payload"] = payload
        captured["headers"] = headers
        return {"url": "https://www.notion.so/p"}

    payload = build_notion_payload(_full_result(), "parent-9", TODAY)
    export_to_notion(payload, api_key="secret-key", transport=fake_transport)
    assert captured["url"] == nx.NOTION_PAGES_URL
    assert captured["headers"]["Authorization"] == "Bearer secret-key"
    assert captured["headers"]["Content-Type"] == "application/json"
    assert captured["headers"]["Notion-Version"] == NOTION_API_VERSION
    # the JSON payload is the I1 page-create body
    assert captured["payload"]["parent"]["page_id"] == "parent-9"
    assert "children" in captured["payload"]


def test_api_key_not_in_result_repr():
    def raising_transport(url, payload, headers):
        raise RuntimeError("boom")

    res = export_to_notion({}, api_key="super-secret-key", transport=raising_transport)
    assert "super-secret-key" not in repr(res)
    assert "super-secret-key" not in (res.error or "")


def test_default_transport_builds_post_request(monkeypatch):
    """Exercises the real _default_transport without any network: monkeypatch
    urllib.request.urlopen to capture the Request and return a fake body."""
    seen = {}

    class _FakeResp:
        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

        def read(self):
            return b'{"url": "https://www.notion.so/real"}'

    def fake_urlopen(req, timeout=None):
        seen["method"] = req.get_method()
        seen["url"] = req.full_url
        seen["body"] = req.data
        seen["auth"] = req.headers.get("Authorization")
        return _FakeResp()

    monkeypatch.setattr(nx.urllib.request, "urlopen", fake_urlopen)
    payload = build_notion_payload(_full_result(), "parent-real", TODAY)
    res = export_to_notion(payload, api_key="k-123")
    assert res.ok is True
    assert res.url == "https://www.notion.so/real"
    assert seen["method"] == "POST"
    assert seen["url"] == nx.NOTION_PAGES_URL
    assert seen["auth"] == "Bearer k-123"
    # body is valid JSON carrying the page-create payload
    import json

    decoded = json.loads(seen["body"].decode("utf-8"))
    assert decoded["parent"]["page_id"] == "parent-real"
