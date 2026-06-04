"""Pure Notion payload builder (I1). No network, no Notion client, no env.

Exercises notion_page_title / build_notion_blocks / build_notion_payload only.
The actual API client + Streamlit button land in I2 and are not tested here.
"""

from __future__ import annotations

from datetime import date, datetime
from types import SimpleNamespace

from src.voc.review_ops.industrial import notion_export as nx
from src.voc.review_ops.industrial.notion_export import (
    APPLICABILITY_ORDER,
    MAX_PRIORITY_REVIEWS,
    NO_NEEDS_REPLY_TEXT,
    NOTION_API_VERSION,
    NOTION_DB_SCHEMA_MISMATCH_NOTE,
    SECTION_TITLES,
    build_database_properties,
    build_notion_blocks,
    build_notion_database_payload,
    build_notion_payload,
    export_to_notion,
    export_to_notion_database,
    notion_database_row_title,
    notion_page_title,
    resolve_notion_config,
    resolve_notion_database_config,
)

# Wording that would overpromise automation or assert causality — must never
# appear in the page text built from a clean fixture.
BANNED_WORDING = ["반드시", "원인", "매출 영향", "자동 처리 완료", "개선해야"]

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


def test_all_section_headings_exist():
    headings = _headings(build_notion_blocks(_full_result()))
    for title in SECTION_TITLES:
        assert title in headings, title


def test_old_worklist_heading_gone():
    headings = _headings(build_notion_blocks(_full_result()))
    assert "오늘/이번 주 확인할 리뷰" not in headings
    assert "우선 확인 리뷰" in headings


def test_ceo_summary_includes_key_counts_and_scope():
    blocks = build_notion_blocks(_full_result())
    # 운영 요약 is the first section
    assert _headings(blocks)[0] == "운영 요약"
    text = _all_text(blocks)
    assert "선택 상품 6개" in text
    assert "1,141" in text  # scoped count
    assert "2,962" in text  # full count
    assert "3.1점" in text   # average rating
    assert "우선 점검 항목" in text  # the lead-in sentence + section


def test_old_headings_absent():
    text = _all_text(build_notion_blocks(_full_result()))
    for old in (
        "대표님 요약",
        "이번에 먼저 볼 것",
        "운영 적용 가능성",
        "다음 업로드 때 비교할 것",
        "대표님에게 물어볼 질문",
    ):
        assert old not in text, old


def test_no_direct_address():
    text = _all_text(build_notion_blocks(_full_result()))
    assert "대표님" not in text


def test_new_applicability_labels_exist():
    headings = _headings(build_notion_blocks(_full_result()))
    for label in ("현재 적용 가능", "추가 데이터 필요", "보류 권장"):
        assert label in headings, label


def test_action_list_precedes_evidence_quotes():
    blocks = build_notion_blocks(_full_result())
    action_idx = next(
        i for i, b in enumerate(blocks)
        if b["type"] == "heading_2"
        and b["heading_2"]["rich_text"][0]["text"]["content"] == "우선 점검 항목"
    )
    first_quote_idx = next(i for i, b in enumerate(blocks) if b["type"] == "quote")
    assert action_idx < first_quote_idx


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


def test_issue_block_includes_capped_evidence_note():
    text = _all_text(build_notion_blocks(_full_result()))
    # the issue has 3 reps but only 2 are shown
    assert "관련 8건 중 2건 표시" in text


def test_issue_heading_has_no_long_product_name():
    long_name = "(벌크) 신개념 일체형 전선몰딩 선바로 1P 열고 닫기 편한 전선몰드 추가구성 세트"
    issue = _issue("접착력 부족", count=5)
    for rep in issue["reps"]:
        rep["상품명"] = long_name
    result = _full_result()
    result["issue_items"] = [issue]
    blocks = build_notion_blocks(result)
    issue_headings = [
        b["heading_3"]["rich_text"][0]["text"]["content"]
        for b in blocks
        if b["type"] == "heading_3"
    ]
    # the issue heading is exactly 'title · 관련 리뷰 N건' — no product name
    assert "접착력 부족 · 관련 리뷰 5건" in issue_headings
    assert not any(long_name in h for h in issue_headings)


def test_issue_product_context_is_shortened():
    long_name = "(벌크) 신개념 일체형 전선몰딩 선바로 1P 열고 닫기 편한 전선몰드 추가구성 세트"
    issue = _issue("접착력 부족")
    for rep in issue["reps"]:
        rep["상품명"] = long_name
    result = _full_result()
    result["issue_items"] = [issue]
    text = _all_text(build_notion_blocks(result))
    assert "대표 상품:" in text
    assert long_name not in text  # full long name never rendered
    assert "…" in text  # shortened


# --- worklist ----------------------------------------------------------------


def test_worklist_includes_reason_and_action():
    text = _all_text(build_notion_blocks(_full_result()))
    assert "확인 이유:" in text
    assert "다음 조치:" in text
    assert "평점이 낮아 확인이 필요합니다." in text


def test_worklist_cap_respected():
    result = _full_result()
    # quotes carry the 긴목록 marker; the action list uses suggested_action, so
    # the marker only appears for priority-review quotes (capped).
    result["worklist_items"] = [_worklist_item(f"긴목록 {i}") for i in range(20)]
    text = _all_text(build_notion_blocks(result))
    assert f"긴목록 {MAX_PRIORITY_REVIEWS - 1}" in text
    assert f"긴목록 {MAX_PRIORITY_REVIEWS}" not in text


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


def test_detail_candidates_are_action_first_and_deduped():
    result = _full_result()
    # two issues that share the same title+action must collapse to one candidate
    dup = _issue("접착력 부족", action="추가 고정 안내 추가 검토")
    result["issue_items"] = [dup, dup, _issue("절단 시 깨짐", action="절단 도구/작업 방법 안내 검토")]
    blocks = build_notion_blocks(result)
    bullets = [
        b["bulleted_list_item"]["rich_text"][0]["text"]["content"]
        for b in blocks
        if b["type"] == "bulleted_list_item"
    ]
    cand = [b for b in bullets if "보완 후보" in b]
    # action-first phrasing, no duplicate 추가 wording
    assert any(b.startswith("추가 고정 안내 추가 검토 (접착력 부족 관련 보완 후보)") for b in cand)
    assert not any("추가 후보" in b for b in cand)  # old suffix gone
    # deduped: the shared candidate appears once
    assert sum(1 for b in cand if "추가 고정 안내 추가 검토" in b) == 1


def test_no_overpromise_wording():
    text = _all_text(build_notion_blocks(_full_result()))
    # 운영 적용 가능성 intentionally names "원인/매출 영향 단정" as a thing NOT to do —
    # that caution is allowed; strip it before scanning the report's own voice.
    text = text.replace("원인/매출 영향 단정", "")
    for banned in BANNED_WORDING:
        assert banned not in text, banned


def test_block_count_under_100():
    assert len(build_notion_blocks(_full_result())) < 100


def test_block_count_under_100_at_caps():
    # max everything: 5 issues (3 reps each), 20 worklist, 5 needs-reply
    result = _full_result()
    result["issue_items"] = [_issue(f"이슈 {i}") for i in range(5)]
    result["worklist_items"] = [_worklist_item(f"리뷰 {i}") for i in range(20)]
    result["tagged"] = [_review(f"답글 {i}", tags=("needs_reply",)) for i in range(8)]
    assert len(build_notion_blocks(result)) < 100


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


# --- J1: database row payload builder (pure, no network) --------------------

NOW = datetime(2026, 1, 21, 20, 33, 46)


def _db_result(scope_products, **overrides):
    """A result tailored for DB-property tests: control scope + counts."""
    result = _full_result()
    result["scope_products"] = list(scope_products)
    result["worklist_review_ids"] = set(overrides.pop("worklist_review_ids", []))
    result.update(overrides)
    return result


def test_db_title_includes_time_scope_and_issue_count():
    result = _db_result(["a", "b", "c", "d", "e", "f"], issue_count=4)
    title = notion_database_row_title(result, NOW)
    assert "리뷰 점검" in title
    assert "01/21 20:33" in title       # MM/DD HH:mm
    assert "선택 6개" in title           # scope_short
    assert "이슈 4건" in title           # issue count


def test_db_title_scope_short_full():
    title = notion_database_row_title(_db_result([], issue_count=0), NOW)
    assert "전체" in title


def test_db_payload_parent_is_database_and_id_echoed():
    payload = build_notion_database_payload(_full_result(), "db-123", NOW)
    assert payload["parent"] == {"type": "database_id", "database_id": "db-123"}


def test_db_payload_children_equals_compact_blocks():
    payload = build_notion_database_payload(_full_result(), "db-123", NOW)
    assert payload["children"] == build_notion_blocks(_full_result(), compact=True)


def test_db_payload_block_count_under_100():
    payload = build_notion_database_payload(_full_result(), "db-123", NOW)
    assert len(payload["children"]) < 100


def test_db_properties_have_expected_type_wrappers():
    props = build_database_properties(
        _db_result(["전선몰딩"], worklist_review_ids=["w1", "w2"]), NOW
    )
    assert "title" in props["이름"]
    assert "start" in props["분석일시"]["date"]
    assert "rich_text" in props["분석 범위"]
    assert "name" in props["범위 유형"]["select"]
    assert isinstance(props["리뷰 수"]["number"], int)
    assert isinstance(props["전체 리뷰 수"]["number"], int)
    assert isinstance(props["저평점 수"]["number"], int)
    assert isinstance(props["우선 확인 수"]["number"], int)
    assert isinstance(props["반복 이슈 수"]["number"], int)
    assert "rich_text" in props["주요 이슈"]
    assert "name" in props["우선도"]["select"]


def test_db_properties_map_values():
    result = _db_result(["전선몰딩"], worklist_review_ids=["w1", "w2", "w3"])
    props = build_database_properties(result, NOW)
    assert props["분석 범위"]["rich_text"][0]["text"]["content"] == "선택 상품 6개"
    assert props["리뷰 수"]["number"] == 1141
    assert props["전체 리뷰 수"]["number"] == 2962
    assert props["저평점 수"]["number"] == 210
    assert props["우선 확인 수"]["number"] == 3
    assert props["반복 이슈 수"]["number"] == 2


def test_db_status_never_set():
    props = build_database_properties(_full_result(), NOW)
    assert "상태" not in props


def test_db_priority_always_set():
    props = build_database_properties(_full_result(), NOW)
    assert "우선도" in props


def test_db_new_review_count_omitted_when_missing():
    result = _full_result()
    result.pop("new_summary", None)
    props = build_database_properties(result, NOW)
    assert "신규 리뷰 수" not in props


def test_db_new_review_count_present_when_available():
    result = _full_result()
    result["new_summary"] = {"new_count": 17}
    props = build_database_properties(result, NOW)
    assert props["신규 리뷰 수"]["number"] == 17


def test_db_average_omitted_when_none():
    result = _full_result()
    result["rating_summary"] = {"average": None, "low_count": 0, "total": 0}
    props = build_database_properties(result, NOW)
    assert "평균 평점" not in props


def test_db_average_present_when_available():
    props = build_database_properties(_full_result(), NOW)
    assert props["평균 평점"]["number"] == 3.1


def test_db_scope_kind_full():
    assert nx._scope_kind(_db_result([])) == "전체 상품"


def test_db_scope_kind_single():
    assert nx._scope_kind(_db_result(["전선몰딩"])) == "개별 상품"


def test_db_scope_kind_multiple():
    assert nx._scope_kind(_db_result(["a", "b"])) == "선택 상품"


def test_db_priority_high_on_two_issues():
    result = _db_result([], issue_count=2, worklist_review_ids=[])
    result["rating_summary"] = {"average": 4.0, "low_count": 0, "total": 10}
    assert nx._compute_priority(result) == "높음"


def test_db_priority_high_on_low_rating_count():
    result = _db_result([], issue_count=0, worklist_review_ids=[])
    result["rating_summary"] = {"average": 2.0, "low_count": 10, "total": 50}
    assert nx._compute_priority(result) == "높음"


def test_db_priority_high_on_priority_count():
    result = _db_result(
        [], issue_count=0, worklist_review_ids=[f"w{i}" for i in range(10)]
    )
    result["rating_summary"] = {"average": 4.0, "low_count": 0, "total": 50}
    assert nx._compute_priority(result) == "높음"


def test_db_priority_medium_on_some_signal():
    result = _db_result([], issue_count=1, worklist_review_ids=[])
    result["rating_summary"] = {"average": 4.0, "low_count": 0, "total": 50}
    assert nx._compute_priority(result) == "보통"


def test_db_priority_low_when_quiet():
    result = _db_result([], issue_count=0, worklist_review_ids=[])
    result["rating_summary"] = {"average": 4.8, "low_count": 0, "total": 50}
    assert nx._compute_priority(result) == "낮음"


def test_db_key_issues_is_rich_text_and_preserves_commas():
    result = _full_result()
    result["issue_items"] = [
        _issue("접착력 문제, 절단 시 깨짐"),
        _issue("표면 자국, 변색 우려"),
    ]
    props = build_database_properties(result, NOW)
    content = props["주요 이슈"]["rich_text"][0]["text"]["content"]
    assert "접착력 문제, 절단 시 깨짐" in content      # comma-bearing title intact
    assert "표면 자국, 변색 우려" in content
    assert " · " in content                          # titles joined


# --- J2 client: resolve_notion_database_config ------------------------------


def test_resolve_db_config_missing_is_safe(monkeypatch):
    monkeypatch.delenv("NOTION_API_KEY", raising=False)
    monkeypatch.delenv("NOTION_DATABASE_ID", raising=False)
    monkeypatch.setattr(nx, "_notion_env_loaded", True, raising=False)
    key, db = resolve_notion_database_config()
    assert key is None
    assert db is None


def test_resolve_db_config_reads_env(monkeypatch):
    monkeypatch.setattr(nx, "_notion_env_loaded", True, raising=False)
    monkeypatch.setenv("NOTION_API_KEY", "secret-abc")
    monkeypatch.setenv("NOTION_DATABASE_ID", "db-xyz")
    key, db = resolve_notion_database_config()
    assert key == "secret-abc"
    assert db == "db-xyz"


# --- J2 client: export_to_notion_database (fake transport, no network) ------


def test_db_export_ok_returns_url():
    captured = {}

    def fake_transport(url, payload, headers):
        captured["url"] = url
        captured["payload"] = payload
        captured["headers"] = headers
        return {"url": "https://www.notion.so/db-row-123"}

    payload = build_notion_database_payload(_full_result(), "db-1", NOW)
    res = export_to_notion_database(payload, api_key="secret-key", transport=fake_transport)
    assert res.ok is True
    assert res.url == "https://www.notion.so/db-row-123"
    assert res.error is None
    assert res.note is None


def test_db_export_sends_post_headers_and_db_payload():
    captured = {}

    def fake_transport(url, payload, headers):
        captured["url"] = url
        captured["payload"] = payload
        captured["headers"] = headers
        return {"url": "https://www.notion.so/r"}

    payload = build_notion_database_payload(_full_result(), "db-9", NOW)
    export_to_notion_database(payload, api_key="secret-key", transport=fake_transport)
    assert captured["url"] == nx.NOTION_PAGES_URL
    assert captured["headers"]["Authorization"] == "Bearer secret-key"
    assert captured["headers"]["Content-Type"] == "application/json"
    assert captured["headers"]["Notion-Version"] == NOTION_API_VERSION
    assert captured["payload"]["parent"]["type"] == "database_id"
    assert captured["payload"]["parent"]["database_id"] == "db-9"
    assert "children" in captured["payload"]


def test_db_export_failure_returns_error_not_ok():
    def raising_transport(url, payload, headers):
        raise RuntimeError("network down")

    payload = build_notion_database_payload(_full_result(), "db-1", NOW)
    res = export_to_notion_database(payload, api_key="secret-key", transport=raising_transport)
    assert res.ok is False
    assert res.url is None
    assert "network down" in (res.error or "")


def test_db_export_title_only_retry_on_schema_mismatch():
    calls = {"n": 0}

    def flaky_transport(url, payload, headers):
        calls["n"] += 1
        if calls["n"] == 1:
            # full create rejected (e.g. property name/type mismatch)
            raise RuntimeError("body failed validation: 평균 평점 is not a property")
        # retry payload must be title-only + body
        assert list(payload["properties"].keys()) == ["이름"]
        assert "children" in payload
        return {"url": "https://www.notion.so/retry-row"}

    payload = build_notion_database_payload(_full_result(), "db-1", NOW)
    res = export_to_notion_database(payload, api_key="secret-key", transport=flaky_transport)
    assert calls["n"] == 2
    assert res.ok is True
    assert res.url == "https://www.notion.so/retry-row"
    assert res.note == NOTION_DB_SCHEMA_MISMATCH_NOTE


def test_db_export_retry_failure_is_fail_soft():
    def always_raising(url, payload, headers):
        raise RuntimeError("auth invalid")

    payload = build_notion_database_payload(_full_result(), "db-1", NOW)
    res = export_to_notion_database(payload, api_key="secret-key", transport=always_raising)
    assert res.ok is False
    assert "auth invalid" in (res.error or "")
    assert res.note is None


def test_db_export_api_key_not_in_result_repr():
    def raising_transport(url, payload, headers):
        raise RuntimeError("boom")

    payload = build_notion_database_payload(_full_result(), "db-1", NOW)
    res = export_to_notion_database(payload, api_key="super-secret-key", transport=raising_transport)
    assert "super-secret-key" not in repr(res)
    assert "super-secret-key" not in (res.error or "")


# --- compact DB body (UX polish) --------------------------------------------

_COMPACT_REQUIRED = (
    "운영 요약",
    "우선 점검 항목",
    "반복 이슈",
    "상세페이지/안내 보완 후보",
    "적용 범위",
)


def test_compact_blocks_include_required_sections():
    headings = _headings(build_notion_blocks(_full_result(), compact=True))
    for title in _COMPACT_REQUIRED:
        assert title in headings, title


def test_compact_blocks_omit_long_list_sections():
    headings = _headings(build_notion_blocks(_full_result(), compact=True))
    assert "우선 확인 리뷰" not in headings
    assert "다음 업로드 비교 항목" not in headings


def test_compact_blocks_fewer_than_full():
    full = build_notion_blocks(_full_result())
    compact = build_notion_blocks(_full_result(), compact=True)
    assert len(compact) < len(full)


def test_compact_blocks_under_60():
    assert len(build_notion_blocks(_full_result(), compact=True)) < 60


def test_compact_evidence_capped_at_two():
    # the issue fixture carries a 3rd rep marked "캡 초과되어야 함"
    text = _all_text(build_notion_blocks(_full_result(), compact=True))
    assert "세 번째 근거" not in text


def test_compact_needs_reply_included_when_non_positive():
    # _full_result has one needs_reply review at rating 2.0 → worth a reply
    blocks = build_notion_blocks(_full_result(), compact=True)
    assert "답글 검토 리뷰" in _headings(blocks)
    assert "답글이 필요한 리뷰입니다." in _all_text(blocks)


def test_compact_needs_reply_omitted_when_only_positive():
    result = _full_result()
    result["tagged"] = [
        _review("잘 쓰고 있어요 만족합니다.", rating=5.0, tags=("needs_reply",))
    ]
    headings = _headings(build_notion_blocks(result, compact=True))
    assert "답글 검토 리뷰" not in headings


def test_compact_needs_reply_capped():
    result = _full_result()
    result["tagged"] = [
        _review(f"답글 대상 {i}", rating=2.0, tags=("needs_reply",)) for i in range(10)
    ]
    text = _all_text(build_notion_blocks(result, compact=True))
    assert f"답글 대상 {nx.MAX_COMPACT_NEEDS_REPLY - 1}" in text
    assert f"답글 대상 {nx.MAX_COMPACT_NEEDS_REPLY}" not in text


def test_compact_no_overpromise_wording():
    text = _all_text(build_notion_blocks(_full_result(), compact=True))
    text = text.replace("원인/매출 영향 단정", "")  # the 보류 권장 caution is allowed
    for banned in BANNED_WORDING:
        assert banned not in text, banned


def test_compact_empty_result_builds_safely():
    blocks = build_notion_blocks(_empty_result(), compact=True)
    assert len(blocks) < 60
    headings = _headings(blocks)
    for title in _COMPACT_REQUIRED:
        assert title in headings, title


# --- single-button routing: resolve_notion_export_mode ----------------------


def test_export_mode_database_when_db_id_present(monkeypatch):
    monkeypatch.setattr(nx, "_notion_env_loaded", True, raising=False)
    monkeypatch.setenv("NOTION_API_KEY", "k")
    monkeypatch.setenv("NOTION_DATABASE_ID", "db-1")
    monkeypatch.setenv("NOTION_PARENT_PAGE_ID", "page-1")
    mode, key, target = nx.resolve_notion_export_mode()
    assert mode == "database"
    assert key == "k"
    assert target == "db-1"  # DB wins over page when both are set


def test_export_mode_page_when_only_parent_present(monkeypatch):
    monkeypatch.setattr(nx, "_notion_env_loaded", True, raising=False)
    monkeypatch.setenv("NOTION_API_KEY", "k")
    monkeypatch.delenv("NOTION_DATABASE_ID", raising=False)
    monkeypatch.setenv("NOTION_PARENT_PAGE_ID", "page-1")
    mode, key, target = nx.resolve_notion_export_mode()
    assert mode == "page"
    assert key == "k"
    assert target == "page-1"


def test_export_mode_none_when_all_missing(monkeypatch):
    monkeypatch.setattr(nx, "_notion_env_loaded", True, raising=False)
    monkeypatch.delenv("NOTION_API_KEY", raising=False)
    monkeypatch.delenv("NOTION_DATABASE_ID", raising=False)
    monkeypatch.delenv("NOTION_PARENT_PAGE_ID", raising=False)
    mode, key, target = nx.resolve_notion_export_mode()
    assert mode == "none"
    assert key is None
    assert target is None


def test_export_mode_none_when_key_missing(monkeypatch):
    monkeypatch.setattr(nx, "_notion_env_loaded", True, raising=False)
    monkeypatch.delenv("NOTION_API_KEY", raising=False)
    monkeypatch.setenv("NOTION_DATABASE_ID", "db-1")
    monkeypatch.setenv("NOTION_PARENT_PAGE_ID", "page-1")
    mode, key, target = nx.resolve_notion_export_mode()
    assert mode == "none"
    assert key is None
    assert target is None
