"""Phase D1: Korean Instagram editorial polish.

Public entry point: `polish_instagram_cardnews_ko(skeleton, brief,
selected_angle, *, llm_client, cache, polish_mode, max_retries,
style_seed, analysis_report)`.

Inputs: skeleton (Phase B), brief (Phase C), selected angle (D1
selector). Outputs: PolishResult carrying either a polished editorial
cardnews dict or a fallback signal.

Anti-hallucination is enforced by:
  - System prompt explicitly listing every constraint, ban list,
    and locked phrase.
  - Output schema constrained to a `polished_slides[]` array; the
    polish layer fills in metadata around it (Python-side, not LLM).
  - Post-validation via `editorial_validators.validate_editorial_cardnews_ko`
    catches drift; one retry with strict-feedback prompt; then fallback.

`style_seed` is a phrasing-variation hint included in (a) the user
prompt and (b) the cache key so two runs with different seeds get
different tone variations without re-keying the brief.
"""
from __future__ import annotations

import json
from datetime import datetime, timezone

from src.voc.content.angle_selection import SelectedAngle
from src.voc.content.editorial_validators import (
    extract_angle_core_noun,
)
from src.voc.content.insight_brief import (
    ANTI_CLICKBAIT_KO,
    WHAT_WE_CANNOT_SAY_KO,
)
from src.voc.content.llm.cache import PolishCache, compute_cache_key
from src.voc.content.llm.client import LLMClient
from src.voc.content.polish.common import (
    DEFAULT_MAX_RETRIES,
    DEFAULT_POLISH_MODE,
    EDITORIAL_SCHEMA_VERSION,
    POLISH_MODES,
    PolishMode,
    PolishResult,
    SYSTEM_PROMPT_VERSION,
    compute_brief_sha256,
    compute_skeleton_sha256,
    run_polish_loop,
)
from src.voc.content.validators import (
    BAN_LIST_CAUSAL_KO,
    BAN_LIST_DIRECTIVE_KO,
    BAN_LIST_MEDICAL_KO,
    BAN_LIST_SUPERLATIVE_KO,
)


# ---------------------------------------------------------------------------
# Prompt builders
# ---------------------------------------------------------------------------


def _ban_list_dump_ko() -> str:
    """Single comma-separated list of every blocked Korean token,
    pasted verbatim into the system prompt."""
    all_tokens: list[str] = []
    for group in (
        BAN_LIST_MEDICAL_KO,
        BAN_LIST_DIRECTIVE_KO,
        BAN_LIST_SUPERLATIVE_KO,
        BAN_LIST_CAUSAL_KO,
        ANTI_CLICKBAIT_KO,
    ):
        all_tokens.extend(group)
    seen: set[str] = set()
    deduped: list[str] = []
    for t in all_tokens:
        if t not in seen:
            seen.add(t)
            deduped.append(t)
    return ", ".join(deduped)


_OUTPUT_JSON_SCHEMA_HINT = """
{
  "polished_slides": [
    {
      "index": 1,
      "type": "hook",
      "title": "한 줄 인상",
      "subtitle": "<polished prose>",
      "source_brief_fields": ["core_verdict.ko"]
    },
    {
      "index": 2,
      "type": "loved",
      "title": "반복되는 호평",
      "bullets": ["...", "..."],
      "source_brief_fields": ["angle_candidates[h2]", "best_for[0]"]
    },
    {
      "index": 3,
      "type": "divides",
      "title": "갈리는 의견",
      "bullets": ["...", "..."],
      "source_brief_fields": ["main_tradeoff.ko"]
    },
    {
      "index": 4,
      "type": "fit",
      "title": "잘 맞은 분들",
      "bullets": ["...", "..."],
      "source_brief_fields": ["best_for[0]", "best_for[1]"]
    },
    {
      "index": 5,
      "type": "watch_outs",
      "title": "유의 포인트",
      "bullets": ["...", "..."],
      "source_brief_fields": ["watch_outs[0]"]
    },
    {
      "index": 6,
      "type": "best_for",
      "title": "구매 전 점검",
      "for_bullets": ["..."],
      "not_for_bullets": ["..."],
      "source_brief_fields": ["best_for[0]", "not_for[0]"]
    },
    {
      "index": 7,
      "type": "method",
      "title": "분석 기준",
      "bullets": ["...", "..."],
      "disclosure": "...",
      "source_brief_fields": ["evidence_boundaries.n_reviews_total"]
    }
  ]
}
""".strip()


_LOCKED_TITLES_LIST_KO = (
    '"한 줄 인상", "반복되는 호평", "갈리는 의견", "잘 맞은 분들", '
    '"유의 포인트", "구매 전 점검", "분석 기준"'
)


def build_system_prompt_instagram_ko(
    *,
    skeleton: dict,
    brief: dict,
    selected_angle: SelectedAngle,
    polish_mode: PolishMode,
) -> str:
    """Build the Korean system prompt. All constraints are
    information-dense and listed up front."""
    tone = (
        ((brief.get("channel_angle_recommendations") or {}).get("instagram") or {})
        .get("tone_directive")
        or "정보 중심 에디토리얼 톤. 차분하고 스캔 가능하게. 과장 금지."
    )
    cannot = "; ".join(
        list((brief.get("evidence_boundaries") or {}).get("what_we_cannot_say") or [])
        or list(WHAT_WE_CANNOT_SAY_KO)
    )
    confidence = skeleton.get("confidence_level") or "weak"
    angle_core_noun = extract_angle_core_noun(selected_angle.angle.get("ko") or "")

    if polish_mode == "hook_only":
        scope_note = (
            "이번 폴리쉬 범위는 슬라이드 1 (hook)의 subtitle 한 줄만입니다. "
            "다른 슬라이드들은 skeleton 그대로 둡니다 (자동으로 복사됨)."
        )
    else:
        scope_note = (
            "모든 슬라이드의 텍스트(subtitle / bullets / for_bullets / "
            "not_for_bullets / disclosure)를 톤 다듬기 수준으로 다시 "
            "작성합니다. 단, 사실/숫자/제목/구조는 절대 변경할 수 없습니다."
        )

    return f"""역할: 한국어 코스메틱 카드뉴스 에디토리얼 폴리셔.

당신은 이미 작성된 카드뉴스(skeleton)와 buyer-facing brief, 그리고
선택된 angle을 받습니다. 당신의 임무는 톤과 흐름을 다듬는 것뿐입니다.
새로운 사실, 새로운 주장, 새로운 숫자를 만들지 마십시오.

[폴리쉬 범위]
{scope_note}

[CRITICAL CONSTRAINTS]
1. skeleton에 등장한 모든 정수(예: 181, 47)는 그대로 유지하거나
   재포맷("181건"→"리뷰 181건")만 허용됩니다. 누락, 변경, 새 숫자
   추가는 모두 위반입니다.
2. 슬라이드 개수(7개), 슬라이드 순서, type 라벨, 그리고 title은
   절대 변경하지 마십시오. title은 다음 고정 문자열입니다:
   {_LOCKED_TITLES_LIST_KO}.
3. 다음 단어/문구는 절대 사용 금지:
   {_ban_list_dump_ko()}.
4. brief.evidence_boundaries.what_we_cannot_say에 명시된 주장을
   하지 마십시오: {cannot}.
5. 길이 제약: 슬라이드 제목 14자 이하, 불릿 40자 이하, 불릿 2~4개.
   슬라이드 1 hook은 불릿 없이 subtitle 한 줄.
   슬라이드 6 best_for는 for_bullets / not_for_bullets 합계 2~4.
   슬라이드 7 method에는 disclosure 필드가 비지 않아야 하며
   다음 중 하나 이상 포함: "리뷰", "정리", "효능 보장하지 않".
6. confidence_level은 skeleton과 동일하게 유지: {confidence!r}.
7. 슬라이드 1 hook의 subtitle은 다음 [SELECTED ANGLE]을 정보 중심
   톤으로 한 줄 정리한 결과여야 합니다:
   - angle_id: {selected_angle.angle_id}
   - type: {selected_angle.angle.get("type")}
   - ko: {selected_angle.angle.get("ko")!r}
   - core_noun: {angle_core_noun!r}
8. 모든 비-method 슬라이드는 [SELECTED ANGLE]을 적어도 한 번
   반영해야 합니다. 다음 중 하나로 충족됩니다:
   (a) source_brief_fields에 "angle_candidates[{selected_angle.angle_id}]" 포함
   (b) 슬라이드 텍스트가 angle.ko의 핵심 명사 ({angle_core_noun!r})를 포함
   (c) 슬라이드 텍스트가 angle.ko의 한국어 부분 문자열(3자 이상)을 포함
9. 각 슬라이드에 source_brief_fields[]를 1개 이상 기재합니다. 허용 경로:
   - core_verdict.ko
   - main_tradeoff.ko
   - angle_candidates[<angle_id>]
   - best_for[<index>]
   - not_for[<index>]
   - watch_outs[<index>]
   - evidence_boundaries.<field>
   - visual_concept.<field>
10. 같은 슬라이드 내에서 적어도 하나의 불릿은 다음 중 하나를
    포함해야 합니다: skeleton의 정수(≥10) / 분석 리포트의 attribute
    label / 후보 angle label. 모든 불릿이 추상적이면 거부됩니다.

[SCAMPER 편집 제약]
- 본 콘텐츠는 "리뷰 요약"이 아니라 "구매 전 의사결정 자료"입니다.
- 다음 표현은 같은 문장 안에 구체 수치(예: "32건")나 직접 인용
  (따옴표 "..." / 「...」)이 없으면 사용 금지:
  호평이 반복됩니다 / 호평이 두드러집니다 / 관련 호평 / 관련 부정 의견 /
  주의가 필요합니다 / 사용 패턴 / 반복적으로 관찰됩니다 /
  반복적으로 등장합니다 / 일관되게 나타납니다.
- 구체 비교쌍(contrast pair)을 우선합니다.
  Bad : "마무리감 관련 호평이 반복됩니다"
  Good: "촉촉하다는 평은 많지만, 오래 붙이면 건조하다는 의견도
         반복됩니다"
- "이런 분은 한 번 더 검토하세요" 같은 망설임(hesitation) 항목을
  강점만큼 비중 있게 다루십시오.

[톤 가이드]
{tone}

[OUTPUT — 정확히 다음 JSON만 출력 (자유 산문 금지)]
{_OUTPUT_JSON_SCHEMA_HINT}

[FAILURE MODE]
출력이 위 제약을 지키지 못하면 검증기에 의해 거부되고 skeleton으로
대체됩니다."""


def build_user_prompt_instagram_ko(
    *,
    skeleton: dict,
    brief: dict,
    selected_angle: SelectedAngle,
    polish_mode: PolishMode,
    style_seed: int | None,
) -> str:
    """User prompt = the source artifacts. The LLM sees the same
    inputs the validator will check against."""
    brief_excerpt = _brief_excerpt_for_instagram(brief)
    parts = [
        "[skeleton_cardnews]",
        json.dumps(skeleton, ensure_ascii=False, indent=2),
        "",
        "[brief_excerpt]",
        json.dumps(brief_excerpt, ensure_ascii=False, indent=2),
        "",
        "[selected_angle]",
        json.dumps(selected_angle.to_dict(), ensure_ascii=False, indent=2),
        "",
        f"[polish_mode] {polish_mode}",
    ]
    if style_seed is not None:
        parts.extend([
            "",
            "[style_seed]",
            str(int(style_seed)),
            "(이 정수는 표현 변주의 힌트입니다. 같은 사실에 대해 "
            "여러 동등한 표현이 가능할 때 이 값을 활용해 한 가지를 "
            "선택하십시오. 숫자, 사실, 슬라이드 구조는 변경되지 "
            "않습니다.)",
        ])
    return "\n".join(parts)


def _brief_excerpt_for_instagram(brief: dict) -> dict:
    """Trim the brief to the fields the IG polish actually needs."""
    keep = (
        "product",
        "confidence_level",
        "core_verdict",
        "main_tradeoff",
        "angle_candidates",
        "best_for",
        "not_for",
        "watch_outs",
        "channel_angle_recommendations",
        "evidence_boundaries",
        "visual_concept",
    )
    out: dict = {k: brief[k] for k in keep if k in brief}
    rec = (out.get("channel_angle_recommendations") or {}).get("instagram")
    if rec is not None:
        out["channel_angle_recommendations"] = {"instagram": rec}
    return out


# ---------------------------------------------------------------------------
# Editorial assembler
# ---------------------------------------------------------------------------


def _assemble_editorial_cardnews(
    parsed: dict,
    selected_angle: SelectedAngle,
    skeleton: dict,
) -> dict:
    """Build the on-disk editorial JSON from the LLM's
    `polished_slides` plus skeleton metadata. Per-slide attaches
    `skeleton: {...}` (audit copy) and computes `preserved_numerics`.

    The LLM's content is taken verbatim for `subtitle`, `bullets`,
    `for_bullets`, `not_for_bullets`, `disclosure`, and
    `source_brief_fields`. Everything else (index, type, title) is
    forced to the skeleton value — even if the LLM tried to change
    it, the validator will catch it, but we don't want to ship a
    drifted index either.
    """
    polished = parsed.get("polished_slides") or []
    skel_slides = skeleton.get("slides") or []

    by_index = {p.get("index"): p for p in polished if isinstance(p, dict)}

    editorial_slides: list[dict] = []
    for s in skel_slides:
        idx = s.get("index")
        p = by_index.get(idx, {})
        slide_out: dict = {
            "index": idx,
            "type": s.get("type"),
            "title": s.get("title"),
        }

        stype = s.get("type")
        if stype == "hook":
            subtitle = (p.get("subtitle") if isinstance(p.get("subtitle"), str) else None) or s.get("subtitle")
            slide_out["subtitle"] = subtitle
            slide_out["skeleton"] = {"subtitle": s.get("subtitle")}
        elif stype == "best_for":
            for_b = p.get("for_bullets") if isinstance(p.get("for_bullets"), list) else None
            not_for_b = p.get("not_for_bullets") if isinstance(p.get("not_for_bullets"), list) else None
            slide_out["for_bullets"] = list(for_b) if for_b else list(s.get("for_bullets") or [])
            slide_out["not_for_bullets"] = list(not_for_b) if not_for_b else list(s.get("not_for_bullets") or [])
            slide_out["skeleton"] = {
                "for_bullets": list(s.get("for_bullets") or []),
                "not_for_bullets": list(s.get("not_for_bullets") or []),
            }
        elif stype == "method":
            bullets = p.get("bullets") if isinstance(p.get("bullets"), list) else None
            slide_out["bullets"] = list(bullets) if bullets else list(s.get("bullets") or [])
            disclosure = p.get("disclosure") if isinstance(p.get("disclosure"), str) else None
            slide_out["disclosure"] = (disclosure or s.get("disclosure") or "")
            slide_out["skeleton"] = {
                "bullets": list(s.get("bullets") or []),
                "disclosure": s.get("disclosure"),
            }
        else:
            bullets = p.get("bullets") if isinstance(p.get("bullets"), list) else None
            slide_out["bullets"] = list(bullets) if bullets else list(s.get("bullets") or [])
            slide_out["skeleton"] = {"bullets": list(s.get("bullets") or [])}

        # Preserved numerics from skeleton (audit field — not user-driven)
        slide_out["preserved_numerics"] = sorted(_extract_skeleton_numerics(s))

        # source_brief_fields from LLM, default empty so the validator
        # can flag the omission with a precise location
        sbf = p.get("source_brief_fields")
        slide_out["source_brief_fields"] = list(sbf) if isinstance(sbf, list) else []

        editorial_slides.append(slide_out)

    return {
        "schema_version": EDITORIAL_SCHEMA_VERSION,
        "lang": "ko",
        "channel": "instagram",
        "format": "cardnews_7slide",
        "polished": True,
        "source_skeleton_sha256": compute_skeleton_sha256(skeleton),
        "source_brief_sha256": None,  # set by run_polish_loop caller
        "source_analysis_report_sha256": skeleton.get("analysis_report_sha256"),
        "confidence_level": skeleton.get("confidence_level"),
        "product": dict(skeleton.get("product") or {}),
        "selected_angle": selected_angle.to_dict(),
        "slide_count": len(editorial_slides),
        "slides": editorial_slides,
        "polish_log": {},  # filled by entry-point function below
        "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    }


def _extract_skeleton_numerics(slide: dict) -> set[int]:
    """Numbers ≥10 that the validator will require on the corresponding
    editorial slide. Stored as `preserved_numerics` for operator audit."""
    import re as _re
    text_parts = []
    for k in ("title", "subtitle", "disclosure"):
        v = slide.get(k)
        if isinstance(v, str):
            text_parts.append(v)
    for k in ("bullets", "for_bullets", "not_for_bullets"):
        for b in slide.get(k) or []:
            if isinstance(b, str):
                text_parts.append(b)
    out: set[int] = set()
    for s in text_parts:
        for m in _re.findall(r"\d+", s):
            try:
                n = int(m)
            except ValueError:
                continue
            if n >= 10:
                out.add(n)
    return out


# ---------------------------------------------------------------------------
# Hook-only assembler — copies skeleton verbatim except slide 1 subtitle
# ---------------------------------------------------------------------------


def _assemble_hook_only(
    parsed: dict,
    selected_angle: SelectedAngle,
    skeleton: dict,
) -> dict:
    """For polish_mode='hook_only', only the slide-1 subtitle changes.
    Slides 2–7 are byte-equal skeleton (no LLM influence)."""
    out = _assemble_editorial_cardnews(parsed, selected_angle, skeleton)
    skel_slides = skeleton.get("slides") or []
    for i, s in enumerate(skel_slides):
        if s.get("type") == "hook":
            continue
        # Restore skeleton fields verbatim
        if s.get("type") == "best_for":
            out["slides"][i]["for_bullets"] = list(s.get("for_bullets") or [])
            out["slides"][i]["not_for_bullets"] = list(s.get("not_for_bullets") or [])
        elif s.get("type") == "method":
            out["slides"][i]["bullets"] = list(s.get("bullets") or [])
            out["slides"][i]["disclosure"] = s.get("disclosure") or ""
        else:
            out["slides"][i]["bullets"] = list(s.get("bullets") or [])
    return out


# ---------------------------------------------------------------------------
# Public entry point
# ---------------------------------------------------------------------------


def polish_instagram_cardnews_ko(
    skeleton: dict,
    brief: dict,
    selected_angle: SelectedAngle,
    *,
    llm_client: LLMClient,
    cache: PolishCache | None = None,
    polish_mode: PolishMode = DEFAULT_POLISH_MODE,
    max_retries: int = DEFAULT_MAX_RETRIES,
    style_seed: int | None = None,
    analysis_report: dict | None = None,
) -> PolishResult:
    """Polish a KO Instagram cardnews skeleton using the LLM client.

    Returns a `PolishResult`. On success `result.cardnews` is the
    editorial JSON dict; on failure `result.fallback_used` is True
    and the runner ships the skeleton instead.

    Caching: identical (skeleton, brief, angle, model, temp,
    prompt version, polish_mode, style_seed) → cache hit.
    """
    if polish_mode not in POLISH_MODES:
        raise ValueError(
            f"unknown polish_mode {polish_mode!r}; allowed: {POLISH_MODES}"
        )

    skel_sha = compute_skeleton_sha256(skeleton)
    brief_sha = compute_brief_sha256(brief)
    cache_key = compute_cache_key(
        skeleton_sha256=skel_sha,
        brief_sha256=brief_sha,
        selected_angle_id=selected_angle.angle_id,
        model=getattr(llm_client, "model", "unknown"),
        temperature=float(getattr(llm_client, "temperature", 0.0)),
        system_prompt_version=SYSTEM_PROMPT_VERSION,
        polish_mode=polish_mode,
        style_seed=style_seed,
    )

    base_system = build_system_prompt_instagram_ko(
        skeleton=skeleton,
        brief=brief,
        selected_angle=selected_angle,
        polish_mode=polish_mode,
    )
    user = build_user_prompt_instagram_ko(
        skeleton=skeleton,
        brief=brief,
        selected_angle=selected_angle,
        polish_mode=polish_mode,
        style_seed=style_seed,
    )

    assembler = _assemble_hook_only if polish_mode == "hook_only" else _assemble_editorial_cardnews

    result = run_polish_loop(
        skeleton=skeleton,
        brief=brief,
        selected_angle=selected_angle,
        analysis_report=analysis_report,
        base_system_prompt=base_system,
        user_prompt=user,
        cardnews_assembler=assembler,
        llm_client=llm_client,
        cache=cache,
        cache_key=cache_key,
        polish_mode=polish_mode,
        style_seed=style_seed,
        max_retries=max_retries,
    )

    # Backfill editorial metadata that the loop doesn't know about.
    if result.cardnews is not None:
        result.cardnews["source_brief_sha256"] = brief_sha
        result.cardnews["polish_log"] = {
            "model": getattr(llm_client, "model", "unknown"),
            "temperature": float(getattr(llm_client, "temperature", 0.0)),
            "system_prompt_version": SYSTEM_PROMPT_VERSION,
            "polish_mode": polish_mode,
            "style_seed": style_seed,
            "retry_count": result.retry_count,
            "fallback_used": result.fallback_used,
            "validator_history": [a.to_dict() for a in result.validator_history],
            "cache": {"hit": result.cache_hit, "key": result.cache_key},
            "elapsed_ms": result.elapsed_ms,
        }
        result.cardnews["validation"] = {
            "ok": result.status == "ok",
            "blocking_flags": [
                {"rule": f.rule, "location": f.location,
                 "matched": f.matched, "detail": f.detail}
                for f in (result.blocking_flags or ())
            ],
            "advisory_flags": [
                {"rule": f.rule, "location": f.location,
                 "matched": f.matched, "detail": f.detail}
                for f in (result.advisory_flags or ())
            ],
        }
    return result
