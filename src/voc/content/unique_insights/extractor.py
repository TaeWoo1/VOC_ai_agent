"""Phase E3: LLM-driven unique-insight extractor.

Reads a `CandidatePool` (E1) and produces a
`unique_product_insights.json`-shaped dict with LLM-authored
insights anchored to the pool's evidence. Validator (E2) gates the
output; cache (Phase D's `PolishCache`) short-circuits identical
inputs.

Hard contracts
--------------
- No raw review access. The LLM only sees `candidate_pool` + the
  pool's `bounded_review_excerpts` map. Raw reviews are NOT in the
  pool by construction (E1 guarantees only excerpts make it in).
- No new insight creation. Each insight cites
  `source_candidate_ids[]` ⊆ pool's id set; validator rejects
  unknown ids. Each `evidence_quote` must be a literal substring
  of the cited review's bounded excerpt.
- Strict validator pass required. On blocking flags: one retry
  with strict-feedback prompt; on persistent block: fallback to
  empty `insights[]` (still schema-valid).
- LLM cannot influence `insight_id`. Python assigns `ins_001`,
  `ins_002`, … post-parse.
- Style seed and `max_insights` participate in the cache key so
  the same input can produce multiple stable variations on demand.

Reused Phase D plumbing
-----------------------
- `LLMClient` Protocol (mock + Anthropic implementations).
- `PolishCache` disk-backed JSON cache.
- `parse_llm_json`, `ValidatorAttempt`, `build_strict_retry_prompt`
  from `polish/common.py`.

Module owns:
- System + user prompt builders.
- Cache-key computation (extractor-specific field set).
- Retry loop with strict-feedback prompt + fallback assembly.
"""
from __future__ import annotations

import hashlib
import json
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Literal

from src.voc.content.insight_brief import ANTI_CLICKBAIT_KO
from src.voc.content.llm.cache import PolishCache
from src.voc.content.llm.client import LLMClient
from src.voc.content.polish.common import (
    ValidatorAttempt,
    build_strict_retry_prompt,
    parse_llm_json,
)
from src.voc.content.unique_insights.schema import (
    BASELINE_SOURCES,
    CONFIDENCE_LEVELS,
    INSIGHT_TYPES,
    KNOWN_RISK_FLAGS,
    MAX_EVIDENCE_REVIEW_IDS,
    MAX_EXPLANATION_CHARS_KO,
    MAX_INSIGHTS,
    MAX_SOURCE_CANDIDATE_IDS,
    MAX_TITLE_CHARS_KO,
    MAX_WHAT_MAKES_UNIQUE_CHARS_KO,
    MIN_EVIDENCE_REVIEW_IDS,
    MIN_SOURCE_CANDIDATE_IDS,
    RELEVANCE_LEVELS,
    UNIQUE_INSIGHTS_SCHEMA_VERSION,
    CandidatePool,
)
from src.voc.content.unique_insights.validators import (
    InsightValidationResult,
    validate_unique_insights,
)
from src.voc.content.validators import (
    BAN_LIST_CAUSAL_KO,
    BAN_LIST_DIRECTIVE_KO,
    BAN_LIST_MEDICAL_KO,
    BAN_LIST_SUPERLATIVE_KO,
)


# Pinned prompt version. Bump invalidates cache (cache key includes it).
EXTRACTOR_SYSTEM_PROMPT_VERSION: str = "v1"

DEFAULT_MAX_INSIGHTS: int = 5
DEFAULT_MAX_RETRIES: int = 1


@dataclass(frozen=True)
class ExtractionResult:
    """Outcome of one extractor run.

    `insights_doc` is ALWAYS populated:
      - on `ok`, it carries the validated insights array
      - on `failed`, it carries `insights: []` (valid against the
        schema; downstream consumers treat this as "no unique
        signals surfaced this run" rather than corruption).

    Mirrors `PolishResult` so callers can pattern-match uniformly."""
    status: Literal["ok", "failed"]
    insights_doc: dict | None
    fallback_used: bool
    retry_count: int
    validator_history: tuple[ValidatorAttempt, ...]
    llm_call_count: int
    cache_key: str
    cache_hit: bool
    elapsed_ms: int
    notes: str = ""
    blocking_flags: tuple = field(default_factory=tuple)
    advisory_flags: tuple = field(default_factory=tuple)


# ---------------------------------------------------------------------------
# Cache-key helpers
# ---------------------------------------------------------------------------


def _candidate_pool_sha256(pool: CandidatePool) -> str:
    """Stable sha256 of the pool's serialized form. Used as a
    component of the cache key."""
    blob = json.dumps(pool.to_dict(), ensure_ascii=False, sort_keys=True)
    return hashlib.sha256(blob.encode("utf-8")).hexdigest()


def _compute_cache_key(
    *,
    candidate_pool_sha256: str,
    product_slug: str,
    profile_id: str,
    model: str,
    temperature: float,
    system_prompt_version: str,
    style_seed: int | None,
    max_insights: int,
) -> str:
    """Hex sha256 over the extractor-specific input set."""
    payload = "|".join([
        candidate_pool_sha256,
        product_slug,
        profile_id,
        model,
        repr(float(temperature)),
        system_prompt_version,
        "none" if style_seed is None else str(int(style_seed)),
        str(int(max_insights)),
    ])
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


# ---------------------------------------------------------------------------
# Prompt builders
# ---------------------------------------------------------------------------


def _ban_list_dump_ko() -> str:
    """Single comma-separated list of every banned token across all
    five lists. Pasted verbatim into the system prompt under
    "다음 어휘는 사용 금지"."""
    seen: set[str] = set()
    out: list[str] = []
    for group in (
        BAN_LIST_MEDICAL_KO,
        BAN_LIST_DIRECTIVE_KO,
        BAN_LIST_SUPERLATIVE_KO,
        BAN_LIST_CAUSAL_KO,
        ANTI_CLICKBAIT_KO,
    ):
        for term in group:
            if term not in seen:
                seen.add(term)
                out.append(term)
    return ", ".join(out)


def _candidate_id_set(pool: CandidatePool) -> list[str]:
    """Sorted union of every candidate_id across all buckets. Pasted
    into the prompt so the LLM has the closed set to choose from."""
    ids: set[str] = set()
    for bucket in (
        pool.high_frequency_strengths,
        pool.concentrated_complaints,
        pool.cross_attribute_tradeoffs,
        pool.polarity_outliers,
        pool.usage_context_signals,
    ):
        for e in bucket:
            if e.candidate_id:
                ids.add(e.candidate_id)
    return sorted(ids)


def build_system_prompt(
    *,
    candidate_pool: CandidatePool,
    selected_profile_id: str | None,
    max_insights: int,
) -> str:
    """Korean, constraint-first.

    The closed set of candidate_ids is included verbatim so the
    LLM cannot invent unanchored references. The closed enums for
    `type`, `confidence`, `category_baseline.source`, and
    `risk_flags` are dumped from `schema.py` constants so a
    future enum extension auto-propagates here."""
    cb_source = candidate_pool.category_baseline_source
    cb_caveat = candidate_pool.baseline_caveat_ko
    candidate_ids = _candidate_id_set(candidate_pool)
    profile_line = (
        f"selected_profile_id={selected_profile_id!r}"
        if selected_profile_id else "no profile selected"
    )

    return f"""역할: 한국어 코스메틱 리뷰의 "유니크 제품 인사이트" 추출기.

당신은 이미 집계된 candidate_pool과 review_id별 verbatim 발췌
(bounded_review_excerpts)를 받습니다. 이 두 입력만이 인사이트의 근거가
될 수 있습니다. 원본 리뷰 전체에는 접근할 수 없습니다.

[CRITICAL CONSTRAINTS]
1. 모든 evidence_quotes_ko[i]는 bounded_review_excerpts[evidence_review_ids[i]]
   의 LITERAL SUBSTRING이어야 합니다. NFC 정규화 후 substring으로 포함되어야 하며,
   의역/요약/합치기/다른 review의 quote와 섞기 금지.
2. 모든 insight는 source_candidate_ids[]에 candidate_pool에 존재하는 ID를 1개
   이상 명시해야 합니다. 알려진 ID 집합:
   {candidate_ids}
   (이 집합 외의 ID를 만들지 마십시오. 검증기에 의해 거부됩니다.)
3. 새로운 사실, 새로운 속성, 카테고리에 대한 일반론, 입력에 없는 주장 모두
   금지.
4. category_baseline.source는 다음 enum 중 하나만 사용:
   {list(BASELINE_SOURCES)}.
   현재 candidate_pool.category_baseline_source = {cb_source!r}.
   {cb_caveat}
5. category_baseline.source = "uncertain"인 경우 is_hypothesis는 반드시 true.
6. 다음 어휘는 어떤 LLM-author 필드(title_ko / explanation_ko /
   what_makes_it_unique_ko / category_baseline.ko)에도 사용 금지:
   {_ban_list_dump_ko()}
7. evidence_review_ids는 distinct review_id {MIN_EVIDENCE_REVIEW_IDS}~
   {MAX_EVIDENCE_REVIEW_IDS}개. evidence_quotes_ko의 길이는 동일해야 합니다.
8. source_candidate_ids는 distinct {MIN_SOURCE_CANDIDATE_IDS}~
   {MAX_SOURCE_CANDIDATE_IDS}개.
9. 길이: title_ko ≤ {MAX_TITLE_CHARS_KO}자, explanation_ko ≤
   {MAX_EXPLANATION_CHARS_KO}자, what_makes_it_unique_ko ≤
   {MAX_WHAT_MAKES_UNIQUE_CHARS_KO}자.
10. 최대 {max_insights}개의 인사이트를 출력하십시오. 후보가 부족하면
    적게(빈 배열도 valid). 머지/통합을 우선하십시오.

[INSIGHT FIELDS]
- type: {list(INSIGHT_TYPES)}.
- confidence: {list(CONFIDENCE_LEVELS)}.
- content_angle_score: 0.0~1.0. 다른 인사이트 후보 대비 distinctive함.
- seller_report_relevance / buyer_content_relevance: {list(RELEVANCE_LEVELS)}.
- risk_flags: {list(KNOWN_RISK_FLAGS)} 중 부분 집합.
- category_baseline.source가 "uncertain"이면 risk_flags에
  "category_baseline_uncertain"을 포함하는 것을 권장합니다.

[프로파일]
{profile_line}

[OUTPUT — 정확히 다음 JSON만 출력 (자유 산문 금지)]
{{
  "insights": [
    {{
      "type": "...",
      "title_ko": "...",
      "explanation_ko": "...",
      "category_baseline": {{
        "ko": "...",
        "source": "...",
        "is_hypothesis": true_or_false
      }},
      "what_makes_it_unique_ko": "...",
      "evidence_review_ids": ["...", "..."],
      "evidence_quotes_ko": ["...", "..."],
      "source_candidate_ids": ["..."],
      "confidence": "...",
      "content_angle_score": 0.0,
      "seller_report_relevance": "...",
      "buyer_content_relevance": "...",
      "risk_flags": []
    }}
  ]
}}

[FAILURE MODE]
출력이 위 제약을 지키지 못하면 검증기에 의해 거부되며, 한 번 더 재시도
후 실패하면 insights[] 빈 배열로 fallback 처리됩니다."""


def build_user_prompt(
    *,
    product: dict,
    candidate_pool: CandidatePool,
    selected_profile: dict | None,
    selected_profile_id: str | None,
    max_insights: int,
    style_seed: int | None,
) -> str:
    """User prompt = the source artifacts. The LLM sees the same
    inputs the validator will check against."""
    parts = [
        "[product]",
        json.dumps(product, ensure_ascii=False, indent=2),
        "",
        "[selected_profile_id]",
        str(selected_profile_id) if selected_profile_id else "(none)",
        "",
        "[category_profile]",
        (
            json.dumps(selected_profile, ensure_ascii=False, indent=2)
            if selected_profile is not None
            else "(no profile selected)"
        ),
        "",
        "[candidate_pool]",
        json.dumps(candidate_pool.to_dict(), ensure_ascii=False, indent=2),
        "",
        "[max_insights]",
        str(max_insights),
    ]
    if style_seed is not None:
        parts.extend([
            "",
            "[style_seed]",
            str(int(style_seed)),
            "(이 정수는 표현 변주의 힌트입니다. 같은 사실에 대해 여러 동등한 "
            "표현이 가능할 때 이 값을 활용하십시오. 사실/숫자/인용은 변경되지 않습니다.)",
        ])
    return "\n".join(parts)


# ---------------------------------------------------------------------------
# Doc assembly
# ---------------------------------------------------------------------------


def _assemble_doc(
    insights_array: list[dict],
    *,
    candidate_pool: CandidatePool,
    product: dict,
    selected_profile_id: str | None,
    source_analysis_report_sha256: str | None,
    source_brief_sha256: str | None,
    extraction_meta: dict,
    validation_block: dict,
) -> dict:
    """Wrap the LLM's `insights[]` array into the full output doc.
    Python assigns insight_id (LLM doesn't see it)."""
    out_insights: list[dict] = []
    for i, raw in enumerate(insights_array, start=1):
        if not isinstance(raw, dict):
            continue
        insight = dict(raw)
        # Python-canonical ID. Validator's insight_id_format rule
        # is defense-in-depth in case someone hand-edits the file.
        insight["insight_id"] = f"ins_{i:03d}"
        insight.setdefault("risk_flags", [])
        out_insights.append(insight)

    return {
        "schema_version": UNIQUE_INSIGHTS_SCHEMA_VERSION,
        "product": dict(product),
        "source_analysis_report_sha256": source_analysis_report_sha256,
        "source_brief_sha256": source_brief_sha256,
        "selected_profile_id": selected_profile_id,
        "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "extraction_meta": extraction_meta,
        "candidate_pool": candidate_pool.to_dict(),
        "insights": out_insights,
        "validation": validation_block,
    }


def _validation_block(result: InsightValidationResult) -> dict:
    return {
        "ok": result.ok,
        "blocking_flags": [
            {
                "rule": f.rule, "location": f.location,
                "matched": f.matched, "detail": f.detail,
            }
            for f in result.blocking
        ],
        "advisory_flags": [
            {
                "rule": f.rule, "location": f.location,
                "matched": f.matched, "detail": f.detail,
            }
            for f in result.advisory
        ],
    }


def _attempt_record(attempt: int, v: InsightValidationResult) -> ValidatorAttempt:
    return ValidatorAttempt(
        attempt=attempt,
        ok=v.ok,
        blocking_count=len(v.blocking),
        advisory_count=len(v.advisory),
        blocking_rules=tuple(sorted({f.rule for f in v.blocking})),
    )


def _exception_pseudo_flag(rule: str, detail: str):
    """Synthesize a ValidationFlag-shaped object so
    `build_strict_retry_prompt` can quote the failure into the
    retry's system prompt. Avoids coupling to `ValidationFlag` —
    duck-typing is enough."""
    class _F:
        pass
    f = _F()
    f.rule = rule
    f.location = "extractor"
    f.matched = None
    f.detail = detail
    return f


def _build_extraction_meta(
    *,
    llm_client: LLMClient,
    style_seed: int | None,
    retry_count: int,
    fallback_used: bool,
    history: list[ValidatorAttempt],
    cache_key: str,
    cache_hit: bool,
    elapsed_ms: int,
) -> dict:
    return {
        "model": getattr(llm_client, "model", "unknown"),
        "temperature": float(getattr(llm_client, "temperature", 0.0)),
        "system_prompt_version": EXTRACTOR_SYSTEM_PROMPT_VERSION,
        "style_seed": style_seed,
        "retry_count": retry_count,
        "fallback_used": fallback_used,
        "validator_history": [a.to_dict() for a in history],
        "cache": {"hit": cache_hit, "key": cache_key},
        "elapsed_ms": elapsed_ms,
    }


# ---------------------------------------------------------------------------
# Public entry point
# ---------------------------------------------------------------------------


def extract_unique_insights(
    candidate_pool: CandidatePool,
    *,
    product: dict,
    llm_client: LLMClient,
    selected_profile: dict | None = None,
    selected_profile_id: str | None = None,
    cache: PolishCache | None = None,
    max_insights: int = DEFAULT_MAX_INSIGHTS,
    max_retries: int = DEFAULT_MAX_RETRIES,
    style_seed: int | None = None,
    source_analysis_report_sha256: str | None = None,
    source_brief_sha256: str | None = None,
) -> ExtractionResult:
    """Drive cache → LLM → parse → validate → retry → fallback.

    Returns an `ExtractionResult`. On `ok`, `insights_doc` carries
    the validated insights. On `failed`, it carries `insights: []`
    (still schema-valid).
    """
    start = time.monotonic()
    history: list[ValidatorAttempt] = []
    llm_calls = 0
    bounded = candidate_pool.excerpts_as_dict()

    pool_sha = _candidate_pool_sha256(candidate_pool)
    profile_id_for_key = selected_profile_id or "none"
    cache_key = _compute_cache_key(
        candidate_pool_sha256=pool_sha,
        product_slug=str((product or {}).get("slug") or ""),
        profile_id=profile_id_for_key,
        model=getattr(llm_client, "model", "unknown"),
        temperature=float(getattr(llm_client, "temperature", 0.0)),
        system_prompt_version=EXTRACTOR_SYSTEM_PROMPT_VERSION,
        style_seed=style_seed,
        max_insights=max_insights,
    )

    # ---- 1. Cache lookup -------------------------------------------------
    if cache is not None:
        cached = cache.get(cache_key)
        if isinstance(cached, dict):
            v = validate_unique_insights(
                cached,
                bounded_review_excerpts=bounded,
                candidate_pool=candidate_pool,
            )
            history.append(_attempt_record(0, v))
            if v.ok:
                # Keep the cached doc but refresh the validation block.
                cached["validation"] = _validation_block(v)
                return ExtractionResult(
                    status="ok",
                    insights_doc=cached,
                    fallback_used=False,
                    retry_count=0,
                    validator_history=tuple(history),
                    llm_call_count=0,
                    cache_key=cache_key,
                    cache_hit=True,
                    elapsed_ms=int((time.monotonic() - start) * 1000),
                    blocking_flags=v.blocking,
                    advisory_flags=v.advisory,
                )
            # Stale cache (validator strictness changed since write).
            # Fall through to LLM call.

    # ---- 2. Build prompts ------------------------------------------------
    base_system = build_system_prompt(
        candidate_pool=candidate_pool,
        selected_profile_id=selected_profile_id,
        max_insights=max_insights,
    )
    user_prompt = build_user_prompt(
        product=product,
        candidate_pool=candidate_pool,
        selected_profile=selected_profile,
        selected_profile_id=selected_profile_id,
        max_insights=max_insights,
        style_seed=style_seed,
    )

    current_system = base_system
    last_blocking: tuple = ()
    last_doc: dict | None = None

    # ---- 3. Attempts (initial + retries) --------------------------------
    for attempt in range(1, max_retries + 2):
        try:
            llm_calls += 1
            raw = llm_client.complete(system=current_system, user=user_prompt)
        except Exception as exc:
            history.append(ValidatorAttempt(
                attempt=attempt, ok=False,
                blocking_count=1, advisory_count=0,
                blocking_rules=(f"llm_exception:{type(exc).__name__}",),
            ))
            if attempt < max_retries + 1:
                current_system = build_strict_retry_prompt(
                    base_system,
                    (
                        _exception_pseudo_flag(
                            f"llm_exception:{type(exc).__name__}",
                            str(exc)[:200],
                        ),
                    ),
                )
                continue
            return _make_fallback(
                candidate_pool, product, selected_profile_id,
                source_analysis_report_sha256, source_brief_sha256,
                cache_key, history, llm_calls, start, max_retries,
                bounded, llm_client, style_seed,
                notes=f"LLM call raised {type(exc).__name__}: {exc}",
                last_blocking=(),
            )

        # Parse
        try:
            parsed = parse_llm_json(raw)
        except ValueError as exc:
            history.append(ValidatorAttempt(
                attempt=attempt, ok=False,
                blocking_count=1, advisory_count=0,
                blocking_rules=("malformed_json",),
            ))
            if attempt < max_retries + 1:
                current_system = build_strict_retry_prompt(
                    base_system,
                    (_exception_pseudo_flag("malformed_json", str(exc)[:200]),),
                )
                continue
            return _make_fallback(
                candidate_pool, product, selected_profile_id,
                source_analysis_report_sha256, source_brief_sha256,
                cache_key, history, llm_calls, start, max_retries,
                bounded, llm_client, style_seed,
                notes=f"malformed JSON after {attempt} attempt(s): {exc}",
                last_blocking=(),
            )

        # Assemble candidate doc
        insights_array = parsed.get("insights") or []
        if not isinstance(insights_array, list):
            insights_array = []

        candidate_doc = _assemble_doc(
            insights_array,
            candidate_pool=candidate_pool,
            product=product,
            selected_profile_id=selected_profile_id,
            source_analysis_report_sha256=source_analysis_report_sha256,
            source_brief_sha256=source_brief_sha256,
            extraction_meta=_build_extraction_meta(
                llm_client=llm_client,
                style_seed=style_seed,
                retry_count=attempt - 1,
                fallback_used=False,
                history=history,
                cache_key=cache_key,
                cache_hit=False,
                elapsed_ms=int((time.monotonic() - start) * 1000),
            ),
            validation_block={
                "ok": True, "blocking_flags": [], "advisory_flags": [],
            },
        )

        # Validate
        v = validate_unique_insights(
            candidate_doc,
            bounded_review_excerpts=bounded,
            candidate_pool=candidate_pool,
        )
        history.append(_attempt_record(attempt, v))
        # Refresh both validation block and validator_history on the doc
        # so the on-disk state reflects the most recent attempt.
        candidate_doc["validation"] = _validation_block(v)
        candidate_doc["extraction_meta"]["validator_history"] = [
            a.to_dict() for a in history
        ]

        if v.ok:
            if cache is not None:
                try:
                    cache.set(cache_key, candidate_doc)
                except OSError:
                    pass  # cache failures non-fatal
            return ExtractionResult(
                status="ok",
                insights_doc=candidate_doc,
                fallback_used=False,
                retry_count=attempt - 1,
                validator_history=tuple(history),
                llm_call_count=llm_calls,
                cache_key=cache_key,
                cache_hit=False,
                elapsed_ms=int((time.monotonic() - start) * 1000),
                blocking_flags=v.blocking,
                advisory_flags=v.advisory,
            )

        last_blocking = v.blocking
        last_doc = candidate_doc

        if attempt < max_retries + 1:
            current_system = build_strict_retry_prompt(base_system, last_blocking)

    # ---- 4. All attempts exhausted — fallback ---------------------------
    return _make_fallback(
        candidate_pool, product, selected_profile_id,
        source_analysis_report_sha256, source_brief_sha256,
        cache_key, history, llm_calls, start, max_retries,
        bounded, llm_client, style_seed,
        notes=(
            f"validation failed after {max_retries + 1} attempt(s); "
            "shipping insights[] empty"
        ),
        last_blocking=last_blocking,
    )


def _make_fallback(
    candidate_pool: CandidatePool,
    product: dict,
    selected_profile_id: str | None,
    source_analysis_report_sha256: str | None,
    source_brief_sha256: str | None,
    cache_key: str,
    history: list[ValidatorAttempt],
    llm_calls: int,
    start: float,
    max_retries: int,
    bounded: dict[str, str],
    llm_client: LLMClient,
    style_seed: int | None,
    *,
    notes: str,
    last_blocking: tuple,
) -> ExtractionResult:
    """Empty-insights fallback. The doc is still schema-valid
    (insights array `minItems=0`) and validator-passing."""
    elapsed_ms = int((time.monotonic() - start) * 1000)
    fallback_doc = _assemble_doc(
        [],
        candidate_pool=candidate_pool,
        product=product,
        selected_profile_id=selected_profile_id,
        source_analysis_report_sha256=source_analysis_report_sha256,
        source_brief_sha256=source_brief_sha256,
        extraction_meta=_build_extraction_meta(
            llm_client=llm_client,
            style_seed=style_seed,
            retry_count=max_retries,
            fallback_used=True,
            history=history,
            cache_key=cache_key,
            cache_hit=False,
            elapsed_ms=elapsed_ms,
        ),
        validation_block={
            "ok": True, "blocking_flags": [], "advisory_flags": [],
        },
    )
    # Sanity re-validate the empty fallback. Should pass since
    # insights array is empty (minItems=0).
    v = validate_unique_insights(
        fallback_doc,
        bounded_review_excerpts=bounded,
        candidate_pool=candidate_pool,
    )
    fallback_doc["validation"] = _validation_block(v)

    return ExtractionResult(
        status="failed",
        insights_doc=fallback_doc,
        fallback_used=True,
        retry_count=max_retries,
        validator_history=tuple(history),
        llm_call_count=llm_calls,
        cache_key=cache_key,
        cache_hit=False,
        elapsed_ms=elapsed_ms,
        notes=notes,
        blocking_flags=tuple(last_blocking),
        advisory_flags=tuple(),
    )
