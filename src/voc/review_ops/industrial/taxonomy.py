"""Industrial review-ops taxonomy: the 13 operator categories.

Rule-based (no LLM) keyword lexicons, Korean-first and English-compatible.

Design rule that keeps the false-positive test honest: risk-category keywords
are *problem* phrasings only. Positive constructs ("튼튼", "딱 맞아요", "잘 맞아요")
must NOT appear in any risk lexicon, or a satisfied review would be flagged as a
problem.

``kind`` drives worklist behavior and ranking:
  - risk        → forces a review onto the worklist; highest severity
  - operational → forces a review onto the worklist (needs an operator touch)
  - signal      → informative only; does not force inclusion
  - positive    → marketing reuse; does not force inclusion
"""

from __future__ import annotations

from dataclasses import dataclass

# kind -> severity (higher = surfaced earlier on the worklist)
SEVERITY: dict[str, int] = {"risk": 3, "operational": 2, "signal": 1, "positive": 0}
WORKLIST_FORCING_KINDS: frozenset[str] = frozenset({"risk", "operational"})


@dataclass(frozen=True)
class Category:
    id: str
    label_ko: str
    kind: str
    keywords: tuple[str, ...]
    reason: str            # 왜 이 리뷰를 봐야 하는지
    suggested_action: str  # 운영자가 할 수 있는 다음 조치


# Ordered by review priority. classify() returns ids in this order.
CATEGORIES: tuple[Category, ...] = (
    Category(
        id="missing_or_wrong_components",
        label_ko="구성품 누락/오배송",
        kind="risk",
        # Complaint-specific phrasings only. Bare "없어요"/"없네" matched positive
        # reviews like "문제 없어요" / "불편 없어요", so they were removed in favor of
        # qualified "구성품이 없" / "안 들어있" / "빠져 있" forms.
        keywords=("누락", "안왔", "안 왔", "안옴", "빠졌", "빠져 있", "빠져있", "빠져서",
                  "안 들어있", "안들어있", "안 들어 있", "들어있지 않", "들어 있지 않",
                  "구성품이 없", "부품이 없", "구성이 없", "잘못 왔", "다른 게 왔", "다른게 왔",
                  "오배송", "잘못 배송", "missing", "wrong item"),
        reason="구성품 누락·오배송을 언급한 리뷰입니다.",
        suggested_action="구성품 발송 여부를 확인하고, 답글로 처리 방법을 안내하세요.",
    ),
    Category(
        id="delivery_packaging_damage",
        label_ko="배송/포장 파손",
        kind="risk",
        # Complaint-specific forms only. Bare "손상"/"긁힘" matched positive
        # "without damage" reviews ("손상 없이 잘 왔어요", "긁힘 하나 없이 깔끔합니다"),
        # and bare "구겨"/"터져" matched negated/positive forms — all qualified.
        keywords=("파손", "깨졌", "깨져", "찌그러", "박스가 터", "박스 터", "포장이 터", "포장 터",
                  "박스 손상", "제품 손상", "포장 손상", "손상돼", "손상된", "긁혀", "긁힌 자국",
                  "구겨져", "휘었", "젖었", "damaged", "broken"),
        reason="배송 중 파손·포장 손상을 언급한 리뷰입니다.",
        suggested_action="주문·배송 상태를 확인하고, 답글로 교환 절차를 안내하세요.",
    ),
    Category(
        id="spec_size_confusion",
        label_ko="규격/사이즈 혼동",
        kind="risk",
        # Mismatch-specific phrasings only. Bare size adjectives ("작고", "작네",
        # "커서", "커요") matched positive reviews like "작고 튼튼해서 만족합니다",
        # so they were qualified to complaint forms. "안 맞" already covers
        # "작아서 안 맞아요".
        keywords=("안맞", "안 맞", "맞지 않", "너무 작", "너무 커", "커서 안", "사이즈가 작",
                  "사이즈가 커", "사이즈가 달", "규격이 달", "치수가 달", "치수랑 다",
                  "치수 확인", "사이즈 확인", "표기랑 다", "표기와 다", "표기된 치수",
                  "too small", "too big", "wrong size"),
        reason="표기된 규격·사이즈와 다르다는 리뷰입니다.",
        suggested_action="상세페이지 치수 표기와 옵션명을 다시 확인하세요.",
    ),
    Category(
        id="color_appearance_mismatch",
        label_ko="색상/외관 차이",
        kind="risk",
        keywords=("사진이랑 달", "사진과 달", "사진이랑 다르", "사진과 다르", "색이 사진",
                  "이미지랑 달", "화면이랑", "색이 달라", "색상이 달라", "컬러가 달라",
                  "실물이 달라", "생각보다 어둡", "생각보다 밝", "color different"),
        reason="실물 색상이 사진과 다르다는 리뷰입니다.",
        suggested_action="상세페이지 색상·실물 안내 문구를 보완할 후보로 봐주세요.",
    ),
    Category(
        id="installation_difficulty",
        label_ko="설치/조립 어려움",
        kind="risk",
        # Difficulty-paired phrasings only. Neutral help-topic terms like
        # "설치 방법"/"조립 방법" were removed — a praising review ("설치 방법이
        # 잘 나와 있어서 쉬웠어요") must not be flagged as a difficulty complaint.
        keywords=("설치가 어렵", "조립이 어렵", "설치 어렵", "조립 어렵", "설치하기 어렵",
                  "조립하기 어렵", "설치가 힘들", "설치하기 힘들", "설치가 까다",
                  "장착이 어렵", "시공이 어렵", "다는 게 힘", "고정이 안",
                  "어떻게 설치", "어떻게 조립", "hard to install"),
        reason="설치·조립이 어렵다는 리뷰입니다.",
        suggested_action="상세페이지나 FAQ에 설치 방법 문구를 추가할 후보로 봐주세요.",
    ),
    Category(
        id="durability_adhesion_finish",
        label_ko="내구성/마감/접착",
        kind="risk",
        keywords=("부러졌", "부러져", "끊어졌", "끊겨", "녹슬", "녹이", "마감이 거칠",
                  "마감 불량", "접착이 약", "접착력이 약", "떨어졌", "떨어져요", "벗겨",
                  "헐거", "금방 망가", "쉽게 망가"),
        reason="내구성·마감·접착이 약하다는 리뷰입니다.",
        suggested_action="동일 증상이 반복되는지 확인하고, 필요하면 입고분 상태를 점검하세요.",
    ),
    Category(
        id="cs_exchange_return_issue",
        label_ko="교환/반품/CS",
        kind="risk",
        # Request/complaint forms only. Bare nouns (반품/환불/고객센터/a/s/return/
        # refund) matched satisfied policy reviews ("반품 정책이 잘 안내되어 있어요",
        # "고객센터 응대가 좋았어요", "a/s가 빨라요"). "환불 안" is intentionally NOT a
        # keyword — it would match "환불 안내".
        keywords=("교환 가능", "교환하고", "교환했", "교환해", "교환 요청", "교환 문의", "교환문의",
                  "반품하고", "반품했", "반품 요청", "반품 문의", "반품 가능한가", "반품 신청",
                  "환불해", "환불 요청", "환불 안돼", "환불 안 돼", "환불 안됨", "환불이 안",
                  "환불 가능한가", "환불 신청",
                  "고객센터 문의", "고객센터 연락 안", "고객센터 연락이 안", "고객센터 처리 안",
                  "a/s 요청", "as 요청", "a/s 안돼", "as 안돼", "a/s가 안", "as가 안",
                  "처리가 안", "처리 안돼", "처리 안 돼", "연락이 안",
                  "want to return", "want to exchange", "request refund"),
        reason="교환·반품·CS 처리를 요청한 리뷰입니다.",
        suggested_action="답글로 교환·반품 절차를 안내하세요.",
    ),
    Category(
        id="component_option_confusion",
        label_ko="옵션/구성 혼동",
        kind="operational",
        keywords=("옵션이 헷갈", "옵션 헷갈", "구성이 헷갈", "어떤 옵션", "어떤 걸 골",
                  "어떤 걸 선택", "옵션 차이", "구성 차이", "뭐가 다른", "which option"),
        reason="옵션·구성 선택을 헷갈려 하는 리뷰입니다.",
        suggested_action="옵션명과 구성 표기를 더 명확히 정리할 후보로 봐주세요.",
    ),
    Category(
        id="detail_page_faq_candidate",
        label_ko="상세페이지/FAQ 후보",
        kind="operational",
        # "Missing/insufficient info" phrasings only. Bare "상세페이지" matched
        # positive mentions ("상세페이지에 치수가 잘 나와 있어서 딱 맞게 샀어요").
        keywords=("설명이 없", "설명이 부족", "안내가 없", "표기가 없", "정보가 없",
                  "안 나와", "안나와", "나와있지 않", "몰랐", "모르고 샀"),
        reason="상세페이지 설명이 부족하다는 리뷰입니다.",
        suggested_action="상세페이지나 FAQ에 설명 문구를 추가할 후보로 봐주세요.",
    ),
    Category(
        id="needs_reply",
        label_ko="답글 필요",
        kind="operational",
        keywords=("문의", "궁금", "되나요", "될까요", "가능한가요", "가능할까요", "알려주",
                  "답변 부탁", "어떻게 하나요", "재고 있나요"),
        reason="답변이 필요한 문의가 담긴 미답변 리뷰입니다.",
        suggested_action="내용을 확인하고 답글로 안내하세요.",
    ),
    Category(
        id="channel_difference_signal",
        label_ko="채널 차이 신호",
        kind="signal",
        keywords=("다른 데가 싸", "다른데가 싸", "여기가 더 싸", "더 저렴", "가격 차이",
                  "네이버가 싸", "쿠팡이 싸", "자사몰이 싸", "채널마다 다"),
        reason="채널별 가격·구성 차이를 언급한 리뷰입니다.",
        suggested_action="채널별 표기·가격이 일치하는지 확인하세요.",
    ),
    Category(
        id="reorder_bulk_purchase_signal",
        label_ko="재구매/대량구매 신호",
        kind="signal",
        keywords=("재구매", "또 구매", "또 샀", "또 시켰", "다시 주문", "추가 주문",
                  "대량", "여러 개", "여러개", "박스로", "쟁여"),
        reason="재구매·대량구매 의사를 밝힌 리뷰입니다.",
        suggested_action="재구매·대량 고객 대상 안내나 구성 제안 후보로 봐주세요.",
    ),
    Category(
        id="positive_marketing_phrase",
        label_ko="긍정 구매 이유",
        kind="positive",
        keywords=("만족", "추천", "튼튼", "딱 맞", "잘 맞", "깔끔", "유용", "최고", "가성비",
                  "좋아요", "좋네요", "잘 쓰고", "마음에 들"),
        reason="반복되는 긍정 구매 이유가 담긴 리뷰입니다.",
        suggested_action="상세페이지·마케팅 문구 후보로 활용하세요.",
    ),
)

CATEGORY_BY_ID: dict[str, Category] = {c.id: c for c in CATEGORIES}
