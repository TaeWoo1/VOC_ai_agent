"""LLM refinement of worklist candidates (Slice 2B).

The rule-based pipeline stays the candidate generator. This module runs an LLM
*only* on the top-N worklist rows to improve the include/exclude decision,
urgency tier, reason, and suggested action — it never touches the full corpus
and never re-tags the taxonomy.

Graceful degradation is the contract: no API key, a bad/non-JSON model reply, or
a network error all fall back to the rule-based row. ``apply_refinements`` and
the parsing/prompt helpers are pure (no network) and fully unit-testable; only
``refine_one`` / ``refine_worklist`` touch OpenAI, via a lazy import.
"""

from __future__ import annotations

import json
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field, replace

from src.voc.review_ops.industrial.rag import chat_model, resolve_api_key
from src.voc.review_ops.industrial.schema import IndustrialReport, WorklistRow

DEFAULT_REFINE_MODEL = "gpt-4o-mini"
DEFAULT_TOP_N = 30
MAX_WORKERS = 8

_VALID_URGENCY = {"today", "period", "exclude"}
_VALID_CONFIDENCE = {"high", "medium", "low"}
# LLM urgency -> internal WorklistRow.tier ("period" is the recent-N-days tier).
_URGENCY_TO_TIER = {"today": "today", "period": "week"}


def refine_model() -> str:
    """Refinement model: reuse the RAG chat-model env, default gpt-4o-mini."""
    return chat_model() or DEFAULT_REFINE_MODEL


# ---------------------------------------------------------------------------
# Result type
# ---------------------------------------------------------------------------


@dataclass
class Refinement:
    review_id: str
    include_in_worklist: bool
    urgency: str          # "today" | "period" | "exclude"
    reason: str
    suggested_action: str
    tag_notes: str = ""
    confidence: str = "medium"  # "high" | "medium" | "low"
    raw: dict = field(default_factory=dict)  # audit: original model JSON


# ---------------------------------------------------------------------------
# Prompt (pure)
# ---------------------------------------------------------------------------

_SYSTEM = (
    "당신은 셀러의 리뷰 운영을 돕는 보조자입니다. "
    "제공된 리뷰에 실제로 적힌 사실만 근거로 판단하세요. "
    "과장하지 말고, 리뷰에 없는 사실은 절대 지어내지 마세요. "
    "반드시 지정된 JSON 객체 하나만 출력하세요."
)

_RULES = (
    "판단 규칙:\n"
    "- 모든 문구는 한국어, 운영자가 읽는 담백한 실무체로 작성하세요.\n"
    "- 핵심 기준은 '평점'이 아니라 '운영자가 확인·조치할 거리가 있는가'입니다. "
    "평점이 높아도(5점이라도) 포장 손상, 구성품 누락·오배송, 접착·내구성 결함, "
    "치수 불일치 같은 구체적 문제가 적혀 있으면 worklist에 유지하고, "
    "reason·suggested_action을 그 사실에 맞게 다듬으세요.\n"
    "- 반대로 평점이 낮아도 내용이 단순 만족·감사·무내용이거나 운영자가 취할 "
    "명확한 조치가 없으면 worklist에서 제외하세요(urgency=exclude).\n"
    "- 포장·배송 파손을 언급했더라도 제품 자체는 손상·분실이 없다고 명시한 "
    "경우, 제외하지 말고 교환 안내 대신 포장 상태 점검을 제안하세요.\n"
    "- 리뷰 원문에 없는 내용은 reason·suggested_action에 넣지 마세요.\n"
    "- 같은 리뷰에 만족 표현과 문제 지적이 섞여 있으면, 문제 부분을 기준으로 "
    "유지 여부를 판단하세요.\n"
)

_SCHEMA_HINT = (
    "다음 JSON 형식으로만 답하세요:\n"
    "{\n"
    '  "include_in_worklist": true 또는 false,\n'
    '  "urgency": "today" 또는 "period" 또는 "exclude",\n'
    '  "reason": "왜 이 리뷰를 봐야 하는지 (없으면 빈 문자열)",\n'
    '  "suggested_action": "운영자가 할 다음 조치 (없으면 빈 문자열)",\n'
    '  "tag_notes": "태그 조정 의견 (선택, 없으면 빈 문자열)",\n'
    '  "confidence": "high" 또는 "medium" 또는 "low"\n'
    "}"
)


def _fmt(value) -> str:
    return "" if value is None else str(value)


def build_messages(row: WorklistRow) -> list[dict]:
    """Build the per-review chat messages. Pure — no network."""
    rating = f"{row.rating:g}점" if row.rating is not None else "평점 미상"
    review_date = row.review_date.isoformat() if row.review_date else "날짜 미상"
    tags = ", ".join(row.tag_labels) if row.tag_labels else "없음"
    user = (
        f"{_RULES}\n"
        "다음은 규칙 기반으로 1차 분류된 리뷰입니다. 위 규칙에 따라 다시 판단하세요.\n\n"
        f"[리뷰 원문]\n{row.text}\n\n"
        f"[메타]\n"
        f"- 평점: {rating}\n"
        f"- 작성일: {review_date}\n"
        f"- 상품명: {_fmt(row.product_name) or '미상'}\n"
        f"- 옵션: {_fmt(row.option_name) or '없음'}\n"
        f"- 현재 태그: {tags}\n"
        f"- 현재 사유: {_fmt(row.reason) or '없음'}\n"
        f"- 현재 조치: {_fmt(row.suggested_action) or '없음'}\n\n"
        f"{_SCHEMA_HINT}"
    )
    return [
        {"role": "system", "content": _SYSTEM},
        {"role": "user", "content": user},
    ]


# ---------------------------------------------------------------------------
# Parsing (pure)
# ---------------------------------------------------------------------------


def _strip_fences(content: str) -> str:
    s = (content or "").strip()
    if s.startswith("```"):
        # drop a leading ```json / ``` fence and a trailing ```
        s = s.split("\n", 1)[1] if "\n" in s else ""
        if s.rstrip().endswith("```"):
            s = s.rstrip()[: -3]
    return s.strip()


def parse_refinement(review_id: str, content: str) -> Refinement | None:
    """Strictly parse the model JSON into a Refinement, or None on any problem.

    Returns None for non-JSON, missing fields, or invalid enum values so the
    caller keeps the rule-based row.
    """
    try:
        data = json.loads(_strip_fences(content))
    except (ValueError, TypeError):
        return None
    if not isinstance(data, dict):
        return None

    include = data.get("include_in_worklist")
    urgency = data.get("urgency")
    confidence = data.get("confidence")
    reason = data.get("reason")
    suggested_action = data.get("suggested_action")

    if not isinstance(include, bool):
        return None
    if urgency not in _VALID_URGENCY:
        return None
    if confidence not in _VALID_CONFIDENCE:
        return None
    if not isinstance(reason, str) or not isinstance(suggested_action, str):
        return None

    # Normalize include/urgency consistency: either signal can drop the row.
    if not include or urgency == "exclude":
        include = False
        urgency = "exclude"

    tag_notes = data.get("tag_notes")
    if not isinstance(tag_notes, str):
        tag_notes = ""

    return Refinement(
        review_id=review_id,
        include_in_worklist=include,
        urgency=urgency,
        reason=reason.strip(),
        suggested_action=suggested_action.strip(),
        tag_notes=tag_notes.strip(),
        confidence=confidence,
        raw=data,
    )


# ---------------------------------------------------------------------------
# Applying refinements to the report (pure)
# ---------------------------------------------------------------------------


def apply_refinements(
    report: IndustrialReport, refinements: dict[str, Refinement]
) -> IndustrialReport:
    """Return a new report whose worklist reflects the refinements.

    - excluded / include=false rows are dropped from the worklist;
    - kept rows get the refined reason/action/tier/confidence (text/tags/rating
      preserved verbatim) and ``refined=True``;
    - rows with no refinement (beyond top-N, or failed calls) are untouched.
    Today-tier rows are ordered before period-tier rows; order within a tier is
    preserved from the rule-based ranking.
    """
    new_rows: list[WorklistRow] = []
    for row in report.worklist:
        ref = refinements.get(row.review_id)
        if ref is None:
            new_rows.append(row)
            continue
        if not ref.include_in_worklist:
            continue  # dropped from the worklist
        new_rows.append(
            replace(
                row,
                reason=ref.reason or row.reason,
                suggested_action=ref.suggested_action or row.suggested_action,
                tier=_URGENCY_TO_TIER.get(ref.urgency, row.tier),
                confidence=ref.confidence,
                refined=True,
            )
        )

    # Stable partition: today first, then period/week. Keeps within-tier order.
    new_rows.sort(key=lambda r: 0 if r.tier == "today" else 1)
    return replace(report, worklist=new_rows)


# ---------------------------------------------------------------------------
# OpenAI-backed (lazy import; degrade gracefully)
# ---------------------------------------------------------------------------


def refine_one(row: WorklistRow, *, api_key: str, model: str | None = None) -> Refinement | None:
    """Refine a single worklist row. Returns None on any failure."""
    try:
        from openai import OpenAI

        client = OpenAI(api_key=api_key)
        resp = client.chat.completions.create(
            model=model or refine_model(),
            messages=build_messages(row),
            response_format={"type": "json_object"},
            temperature=0,
            max_tokens=300,
        )
        content = resp.choices[0].message.content or ""
        return parse_refinement(row.review_id, content)
    except Exception:
        return None


def refine_worklist(
    report: IndustrialReport,
    *,
    api_key: str | None = None,
    model: str | None = None,
    top_n: int = DEFAULT_TOP_N,
) -> tuple[IndustrialReport, dict]:
    """Refine the top-N worklist candidates concurrently.

    Returns ``(report, summary)``. With no API key (or no candidates) the report
    is returned unchanged. ``summary`` carries counts for the UI:
    ``candidates / refined / excluded / failed``.
    """
    api_key = api_key or resolve_api_key()
    candidates = report.worklist[:top_n]
    if not api_key or not candidates:
        return report, {
            "candidates": len(candidates),
            "refined": 0,
            "excluded": 0,
            "failed": 0,
            "had_key": bool(api_key),
        }

    refinements: dict[str, Refinement] = {}
    workers = min(MAX_WORKERS, len(candidates))
    with ThreadPoolExecutor(max_workers=workers) as pool:
        results = list(pool.map(lambda r: (r.review_id, refine_one(r, api_key=api_key, model=model)), candidates))
    for review_id, ref in results:
        if ref is not None:
            refinements[review_id] = ref

    refined_report = apply_refinements(report, refinements)
    excluded = sum(1 for r in refinements.values() if not r.include_in_worklist)
    return refined_report, {
        "candidates": len(candidates),
        "refined": len(refinements) - excluded,
        "excluded": excluded,
        "failed": len(candidates) - len(refinements),
        "had_key": True,
    }
