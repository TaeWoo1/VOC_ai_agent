"""Review issue × detail-guidance gap analysis (S2x.4a).

Pure, offline: given one repeated-review issue (a simple dict) and a
``product_guidance_review`` dict (the S2x.3c deterministic post-process output),
return a cautious gap-analysis result — what detail-page guidance the extracted
draft *does* surface for that issue, and what it does *not*.

Discipline — this layer invents nothing and asserts nothing about the original
detail page:
- ``not_found`` means "not found in the extracted draft", NOT "absent from the
  original page". Wording stays "추출 결과 기준으로 찾지 못했습니다", never
  "상세페이지에 없습니다".
- Outputs are review/check candidates ("점검 후보", "운영자 확인 필요"), never
  directives ("반드시 추가") and never causal claims ("원인").
- NO network, NO OpenAI, NO OCR, NO ProductKnowledge, NO Notion / Streamlit /
  store / review-analysis integration. It is not wired into the review report.
"""

from __future__ import annotations

CONFIDENCE = "review_needed"
BASIS = "consumer_visible_detail_image_draft"
CAUTION = (
    "not_found는 원본 상세페이지에 없다는 단정이 아니라, 추출 draft에서 찾지 못했다는 의미입니다."
)

# issue title / canonical_label substrings -> mapping id (checked in order).
ADHESION_KEYS: tuple[str, ...] = ("접착력", "접착", "부착력", "adhesion")
CUTTING_KEYS: tuple[str, ...] = ("절단", "깨짐", "파손", "재단", "cutting", "breakage")
COMPONENT_KEYS: tuple[str, ...] = ("구성품", "구성", "옵션", "누락", "component")

# mapping id -> the precomputed review_gap_ready_signals topic to prefer.
_SIGNAL_TOPIC = {"adhesion": "접착력 부족", "cutting": "절단 시 깨짐"}


def _norm(value: str) -> str:
    return (value or "").lower()


def _resolve_mapping(issue: dict) -> str | None:
    text = _norm(f"{issue.get('title', '')} {issue.get('canonical_label', '')}")
    if any(k.lower() in text for k in ADHESION_KEYS):
        return "adhesion"
    if any(k.lower() in text for k in CUTTING_KEYS):
        return "cutting"
    if any(k.lower() in text for k in COMPONENT_KEYS):
        return "component"
    return None


def _signal_by_topic(review: dict) -> dict:
    return {
        s.get("topic"): s
        for s in (review.get("review_gap_ready_signals") or [])
        if isinstance(s, dict)
    }


def _status_from(found: list[str], not_found: list[str]) -> str:
    if found and not_found:
        return "partial_guidance"
    if found:
        return "guidance_present"
    if not_found:
        return "not_found"
    return "needs_operator_check"


def _fallback_adhesion(review: dict) -> tuple[list[str], list[str]]:
    cg = review.get("confirmed_guidance") or {}
    nf = {n.get("topic") for n in review.get("not_found_guidance") or []}
    found: list[str] = []
    if cg.get("surface_preparation"):
        found.append("부착 전 물기/먼지 제거")
    if cg.get("fixation_guidance"):
        found.append("피스/실리콘 고정")
    not_found: list[str] = []
    if "실크벽지" in nf:
        not_found.append("실크벽지 조건")
    if "추가 양면테이프" in nf:
        not_found.append("추가 양면테이프")
    if ("거친 벽면" in nf) or ("습기" in nf):
        not_found.append("거친 벽면/습기 조건")
    return found, not_found


def _fallback_cutting(review: dict) -> tuple[list[str], list[str]]:
    cg = review.get("confirmed_guidance") or {}
    nf = {n.get("topic") for n in review.get("not_found_guidance") or []}
    found: list[str] = []
    if cg.get("cutting_guidance"):
        found.append("재단 안내")
    not_found: list[str] = []
    if "깨짐 방지" in nf:
        not_found.append("깨짐 방지 주의")
    if "권장 절단 도구" in nf:
        not_found.append("권장 절단 도구의 명확한 안내")
    return found, not_found


def _operator_check(status: str, found: list[str], not_found: list[str]) -> str:
    """Cautious operator sentence for the adhesion / cutting mappings."""
    if status == "partial_guidance":
        return (
            f"상세페이지 추출 결과 기준으로 {', '.join(found)} 안내는 확인되지만, "
            f"{', '.join(not_found)} 안내는 찾지 못했습니다. 안내 위치/표현을 점검할 후보입니다."
        )
    if status == "guidance_present":
        return (
            f"상세페이지 추출 결과 기준으로 {', '.join(found)} 안내가 확인됩니다. "
            "리뷰 신호와 안내 사이의 gap 여부는 운영자 확인 후보입니다."
        )
    if status == "not_found":
        topics = ", ".join(not_found) if not_found else "관련"
        return (
            f"상세페이지 추출 결과 기준으로 {topics} 안내를 찾지 못했습니다. "
            "리뷰 신호와 안내 사이의 gap 후보로 운영자 확인이 필요합니다."
        )
    return (
        "상세페이지 추출 결과 기준으로 관련 안내를 충분히 확인하지 못했습니다. "
        "리뷰 신호와 안내 사이의 gap 후보로 운영자 확인이 필요합니다."
    )


def _component_operator_check(status: str, count: int) -> str:
    """Cautious operator sentence for the component mapping (no fulfillment inference)."""
    if status == "guidance_present":
        return (
            f"상세페이지 추출 결과 기준으로 구성품 안내 {count}건이 확인됩니다. "
            "리뷰의 구성품 관련 신호와 안내 사이의 gap 여부는 운영자 확인 후보입니다."
        )
    return (
        "상세페이지 추출 결과 기준으로 구성품 안내를 충분히 확인하지 못했습니다. "
        "구성품 표기를 점검할 후보이며 운영자 확인이 필요합니다."
    )


def _base(issue: dict) -> dict:
    return {
        "issue_title": issue.get("title", "") or "",
        "confidence": CONFIDENCE,
        "basis": BASIS,
        "needs_operator_review": True,
        "caution": CAUTION,
    }


def analyze_issue_guidance_gap(issue: dict, guidance_review: dict | None) -> dict:
    """Analyze the gap between one review issue and the detail-guidance review.

    ``issue`` is a simple dict (``title`` / ``canonical_label`` / ``summary`` /
    ``recommended_action``). ``guidance_review`` is the S2x.3c
    ``product_guidance_review`` dict. Returns a cautious result (see module
    docstring). Fail-soft: a missing/empty review yields ``no_guidance_review``;
    an unmapped issue yields ``no_mapped_guidance``.
    """
    issue = issue or {}
    base = _base(issue)

    if not guidance_review or not isinstance(guidance_review, dict):
        return {
            **base,
            "detail_page_status": "no_guidance_review",
            "found_guidance": [],
            "not_found_guidance": [],
            "operator_check": (
                "상세페이지 추출 결과(product_guidance_review)가 없어 gap 분석을 수행하지 못했습니다. "
                "먼저 상세페이지 안내 후처리를 생성한 뒤 다시 확인할 후보입니다."
            ),
        }

    mapping = _resolve_mapping(issue)
    if mapping is None:
        return {
            **base,
            "detail_page_status": "no_mapped_guidance",
            "found_guidance": [],
            "not_found_guidance": [],
            "operator_check": (
                "이 리뷰 이슈에 매핑된 상세페이지 안내 점검 규칙이 아직 없습니다. "
                "운영자 확인 후보입니다."
            ),
        }

    if mapping in ("adhesion", "cutting"):
        topic = _SIGNAL_TOPIC[mapping]
        sig = _signal_by_topic(guidance_review).get(topic)
        if sig:
            found = list(sig.get("found") or [])
            not_found = list(sig.get("not_found") or [])
            status = sig.get("detail_page_status") or _status_from(found, not_found)
        else:
            found, not_found = (
                _fallback_adhesion(guidance_review)
                if mapping == "adhesion"
                else _fallback_cutting(guidance_review)
            )
            status = _status_from(found, not_found)
        return {
            **base,
            "detail_page_status": status,
            "found_guidance": found,
            "not_found_guidance": not_found,
            "operator_check": _operator_check(status, found, not_found),
        }

    # mapping == "component": surface component guidance only; never infer fulfillment.
    comps = (guidance_review.get("confirmed_guidance") or {}).get("component_guidance") or []
    found = [c.get("value", "") for c in comps if isinstance(c, dict) and c.get("value")]
    status = "guidance_present" if found else "needs_operator_check"
    return {
        **base,
        "detail_page_status": status,
        "found_guidance": found,
        "not_found_guidance": [],
        "operator_check": _component_operator_check(status, len(found)),
    }
