"""Tests for the Phase E3 unique-insight extractor.

Driven entirely by `MockLLMClient` — no network, no API keys, no
real LLM. Covers:

- Happy path: mock returns valid insights → status=ok, validator
  passes, doc carries Python-assigned `ins_001`/`ins_002`/...
- Retry + success: mock returns invalid first, valid second →
  status=ok with retry_count=1.
- Persistent fail → fallback: mock returns invalid both attempts
  → status=failed, insights[]=[], doc still validator-passing.
- Anti-hallucination: paraphrased quote, unknown candidate_id,
  banned vocabulary, malformed JSON, LLM exception.
- Cache: identical input → cache hit, no LLM call. Different
  style_seed → different cache key, LLM called.
- Stale cache: cached doc fails current validator → cache
  invalidated, LLM called.
"""
from __future__ import annotations

import copy
import json
from pathlib import Path

import pytest

from src.voc.content.llm.cache import PolishCache
from src.voc.content.llm.client import MockLLMClient
from src.voc.content.unique_insights.candidate_pool import build_candidate_pool
from src.voc.content.unique_insights.extractor import (
    EXTRACTOR_SYSTEM_PROMPT_VERSION,
    extract_unique_insights,
)
from src.voc.content.unique_insights.schema import (
    BASELINE_CAVEAT_UNCERTAIN_KO,
    UNIQUE_INSIGHTS_SCHEMA_VERSION,
    CandidatePool,
)


# ---------------------------------------------------------------------------
# fixtures
# ---------------------------------------------------------------------------


def _q(text: str, rid: str, *, polarity: str | None = None) -> dict:
    # Schema-shaped quote (the on-disk analysis_report.json uses
    # `text`). The adapter accepts either `evidence_span` (the
    # aggregator's internal field name) or `text` (the v3.0 schema
    # field). Tests use the schema name for clarity.
    out: dict = {"text": text, "review_id": rid}
    if polarity is not None:
        out["polarity"] = polarity
    return out


def _rich_report() -> dict:
    return {
        "schema_version": "3.0",
        "product": {"slug": "demo", "name_ko": "데모"},
        "corpus": {"n_reviews_total": 1135},
        "attributes": [
            {
                "key": "pigmentation", "label_ko": "발색",
                "n_positive": 181, "n_negative": 71, "n_mixed": 12,
                "top_quotes": [
                    _q("발색이 정말 진하고 예뻐요", "r1", polarity="positive"),
                    _q("색이 너무 잘 나와요 만족합니다", "r2", polarity="positive"),
                    _q("시간 지나면 변색돼요", "r3", polarity="negative_strong"),
                ],
            },
            {
                "key": "persistence", "label_ko": "지속력",
                "n_positive": 47, "n_negative": 12, "n_mixed": 4,
                "top_quotes": [
                    _q("지속력 정말 좋아요 하루 가요", "r4", polarity="positive"),
                ],
            },
            {
                "key": "transfer_resistance", "label_ko": "묻어남",
                "n_positive": 5, "n_negative": 38, "n_mixed": 6,
                "top_quotes": [
                    _q("마스크에 묻어나요 정말", "r5", polarity="negative_strong"),
                    _q("옷에도 묻어나서 아쉬워요", "r6", polarity="negative_strong"),
                ],
            },
            {
                "key": "application_blending", "label_ko": "발림성",
                "n_positive": 32, "n_negative": 8, "n_mixed": 2,
                "top_quotes": [
                    _q("발림성이 부드러워요", "r7", polarity="positive"),
                ],
            },
        ],
        "monitoring_candidates": [
            {
                "attribute_key": "transfer_resistance",
                "concern_label_ko": "묻어남", "n_negative": 38,
                "top_negative_quotes": [
                    _q("마스크에 묻어나요 정말", "r5", polarity="negative_strong"),
                    _q("옷에도 묻어나서 아쉬워요", "r6", polarity="negative_strong"),
                ],
            },
        ],
        "tradeoffs": [
            {"pair": "pigmentation:positive -> transfer_resistance:negative_strong", "count": 14},
        ],
        "usage_patterns": [],
    }


def _product() -> dict:
    return {
        "slug": "demo", "name_ko": "데모 제품",
        "brand_ko": "Demo Brand", "category": "color_cosmetics",
        "source_url": "https://example.com/p/123",
    }


def _candidate_pool() -> CandidatePool:
    return build_candidate_pool(_rich_report())


def _valid_llm_response_for(pool: CandidatePool) -> str:
    """Build a polished_insights JSON that passes every validator
    rule against the live candidate_pool. Computed at runtime so
    the response stays consistent with whichever candidate_ids
    the pool happened to assign."""
    # Pick the highest-priority strength + the highest-priority
    # complaint as our two seed candidates. Always the first id in
    # each bucket given the candidate_pool's deterministic order.
    strength_id = pool.high_frequency_strengths[0].candidate_id
    strength_evidence_ids = list(
        pool.high_frequency_strengths[0].evidence_review_ids
    )[:2]
    strength_evidence_quotes = list(
        pool.high_frequency_strengths[0].evidence_excerpts_preview
    )[:2]

    complaint_id = pool.concentrated_complaints[0].candidate_id
    complaint_evidence_ids = list(
        pool.concentrated_complaints[0].evidence_review_ids
    )[:2]
    complaint_evidence_quotes = list(
        pool.concentrated_complaints[0].evidence_excerpts_preview
    )[:2]

    payload = {
        "insights": [
            {
                "type": "unique_strength",
                "title_ko": "발색 호평 반복 신호",
                "explanation_ko": "다수 리뷰에서 발색에 대한 호평이 반복적으로 관찰됩니다.",
                "category_baseline": {
                    "ko": "이 카테고리 평균은 아직 정의되지 않았습니다.",
                    "source": "uncertain",
                    "is_hypothesis": True,
                },
                "what_makes_it_unique_ko": "후보 풀에서 발색이 가장 많이 호평된 신호입니다.",
                "evidence_review_ids": strength_evidence_ids,
                "evidence_quotes_ko": strength_evidence_quotes,
                "source_candidate_ids": [strength_id],
                "confidence": "moderate",
                "content_angle_score": 0.72,
                "seller_report_relevance": "high",
                "buyer_content_relevance": "high",
                "risk_flags": ["category_baseline_uncertain"],
            },
            {
                "type": "unique_weakness",
                "title_ko": "묻어남 비판 반복",
                "explanation_ko": "마스크/옷에 묻어난다는 비판이 다수 리뷰에서 반복됩니다.",
                "category_baseline": {
                    "ko": "이 카테고리 평균은 아직 정의되지 않았습니다.",
                    "source": "uncertain",
                    "is_hypothesis": True,
                },
                "what_makes_it_unique_ko": "사용 환경(마스크/옷) 모두에서 동일 신호가 관찰됩니다.",
                "evidence_review_ids": complaint_evidence_ids,
                "evidence_quotes_ko": complaint_evidence_quotes,
                "source_candidate_ids": [complaint_id],
                "confidence": "moderate",
                "content_angle_score": 0.55,
                "seller_report_relevance": "high",
                "buyer_content_relevance": "moderate",
                "risk_flags": ["category_baseline_uncertain"],
            },
        ]
    }
    return json.dumps(payload, ensure_ascii=False)


def _as_response(payload: dict) -> str:
    return json.dumps(payload, ensure_ascii=False)


# ---------------------------------------------------------------------------
# happy path
# ---------------------------------------------------------------------------


class TestHappyPath:
    def test_returns_ok(self):
        pool = _candidate_pool()
        llm = MockLLMClient([_valid_llm_response_for(pool)])
        result = extract_unique_insights(
            pool, product=_product(), llm_client=llm,
        )
        assert result.status == "ok", f"unexpected: {result.notes}; blocking={result.blocking_flags}"
        assert not result.fallback_used
        assert result.retry_count == 0
        assert result.llm_call_count == 1
        assert result.insights_doc is not None
        assert len(result.insights_doc["insights"]) == 2

    def test_python_assigned_insight_ids(self):
        pool = _candidate_pool()
        llm = MockLLMClient([_valid_llm_response_for(pool)])
        result = extract_unique_insights(
            pool, product=_product(), llm_client=llm,
        )
        ids = [i["insight_id"] for i in result.insights_doc["insights"]]
        assert ids == ["ins_001", "ins_002"]

    def test_extraction_meta_populated(self):
        pool = _candidate_pool()
        llm = MockLLMClient([_valid_llm_response_for(pool)])
        result = extract_unique_insights(
            pool, product=_product(), llm_client=llm,
        )
        meta = result.insights_doc["extraction_meta"]
        assert meta["model"] == "mock-model"
        assert meta["system_prompt_version"] == EXTRACTOR_SYSTEM_PROMPT_VERSION
        assert meta["fallback_used"] is False
        assert meta["retry_count"] == 0
        assert meta["cache"]["hit"] is False
        assert len(meta["validator_history"]) == 1
        assert meta["validator_history"][0]["ok"] is True

    def test_doc_validation_block_ok(self):
        pool = _candidate_pool()
        llm = MockLLMClient([_valid_llm_response_for(pool)])
        result = extract_unique_insights(
            pool, product=_product(), llm_client=llm,
        )
        assert result.insights_doc["validation"]["ok"] is True
        assert result.insights_doc["validation"]["blocking_flags"] == []

    def test_schema_version_pinned(self):
        pool = _candidate_pool()
        llm = MockLLMClient([_valid_llm_response_for(pool)])
        result = extract_unique_insights(
            pool, product=_product(), llm_client=llm,
        )
        assert result.insights_doc["schema_version"] == UNIQUE_INSIGHTS_SCHEMA_VERSION


# ---------------------------------------------------------------------------
# retry → success
# ---------------------------------------------------------------------------


class TestRetryThenSuccess:
    def test_paraphrased_quote_blocks_then_recovers(self):
        pool = _candidate_pool()
        # Build a "bad" response: paraphrased quote that is NOT a
        # substring of any bounded excerpt.
        valid = json.loads(_valid_llm_response_for(pool))
        bad = copy.deepcopy(valid)
        bad["insights"][0]["evidence_quotes_ko"][0] = "발색이 좋다 (paraphrase)"
        llm = MockLLMClient([
            _as_response(bad),
            _valid_llm_response_for(pool),
        ])
        result = extract_unique_insights(
            pool, product=_product(), llm_client=llm,
        )
        assert result.status == "ok"
        assert result.retry_count == 1
        assert result.llm_call_count == 2
        # validator_history records both attempts
        history = result.validator_history
        assert len(history) == 2
        assert history[0].ok is False
        assert "evidence_quote_substring" in history[0].blocking_rules
        assert history[1].ok is True

    def test_unknown_candidate_id_blocks_then_recovers(self):
        pool = _candidate_pool()
        valid = json.loads(_valid_llm_response_for(pool))
        bad = copy.deepcopy(valid)
        bad["insights"][0]["source_candidate_ids"] = ["cand_strength_999"]
        llm = MockLLMClient([
            _as_response(bad),
            _valid_llm_response_for(pool),
        ])
        result = extract_unique_insights(
            pool, product=_product(), llm_client=llm,
        )
        assert result.status == "ok"
        history = result.validator_history
        assert "source_candidate_id_in_pool" in history[0].blocking_rules


# ---------------------------------------------------------------------------
# persistent failure → fallback
# ---------------------------------------------------------------------------


class TestFallback:
    def test_persistent_block_yields_empty_insights(self):
        pool = _candidate_pool()
        valid = json.loads(_valid_llm_response_for(pool))
        bad = copy.deepcopy(valid)
        bad["insights"][0]["evidence_quotes_ko"][0] = "발색이 좋다 (paraphrase)"
        llm = MockLLMClient([_as_response(bad), _as_response(bad)])
        result = extract_unique_insights(
            pool, product=_product(), llm_client=llm,
        )
        assert result.status == "failed"
        assert result.fallback_used is True
        assert result.insights_doc["insights"] == []
        # The fallback doc is still schema-valid (validator passes
        # on empty insights array).
        assert result.insights_doc["validation"]["ok"] is True
        assert result.insights_doc["extraction_meta"]["fallback_used"] is True

    def test_malformed_json_falls_back(self):
        pool = _candidate_pool()
        llm = MockLLMClient(["not json", "still not json"])
        result = extract_unique_insights(
            pool, product=_product(), llm_client=llm,
        )
        assert result.status == "failed"
        assert result.fallback_used is True
        assert "malformed JSON" in result.notes

    def test_llm_exception_falls_back(self):
        pool = _candidate_pool()
        llm = MockLLMClient([
            RuntimeError("upstream timeout"),
            RuntimeError("still down"),
        ])
        result = extract_unique_insights(
            pool, product=_product(), llm_client=llm,
        )
        assert result.status == "failed"
        assert result.fallback_used is True
        assert "RuntimeError" in result.notes

    def test_banned_word_blocks_then_falls_back(self):
        pool = _candidate_pool()
        valid = json.loads(_valid_llm_response_for(pool))
        bad = copy.deepcopy(valid)
        bad["insights"][0]["title_ko"] = "역대급 발색"  # anti_clickbait + length OK
        llm = MockLLMClient([_as_response(bad), _as_response(bad)])
        result = extract_unique_insights(
            pool, product=_product(), llm_client=llm,
        )
        assert result.status == "failed"
        assert result.fallback_used is True
        assert any(
            "anti_clickbait" in attempt.blocking_rules
            for attempt in result.validator_history
        )


# ---------------------------------------------------------------------------
# cache
# ---------------------------------------------------------------------------


class TestCache:
    def test_first_run_writes_cache(self, tmp_path: Path):
        cache = PolishCache(tmp_path)
        pool = _candidate_pool()
        llm = MockLLMClient([_valid_llm_response_for(pool)])
        result = extract_unique_insights(
            pool, product=_product(), llm_client=llm, cache=cache,
        )
        assert result.status == "ok"
        # The cache file should now exist for this key.
        assert cache.has(result.cache_key)

    def test_second_run_hits_cache_no_llm_call(self, tmp_path: Path):
        cache = PolishCache(tmp_path)
        pool = _candidate_pool()
        # First run: warm the cache.
        llm1 = MockLLMClient([_valid_llm_response_for(pool)])
        extract_unique_insights(
            pool, product=_product(), llm_client=llm1, cache=cache,
        )
        # Second run: empty queue. If LLM gets called, MockLLMClient
        # raises RuntimeError; cache hit avoids that.
        llm2 = MockLLMClient([])
        result = extract_unique_insights(
            pool, product=_product(), llm_client=llm2, cache=cache,
        )
        assert result.status == "ok"
        assert result.cache_hit is True
        assert result.llm_call_count == 0

    def test_different_style_seed_misses_cache(self, tmp_path: Path):
        cache = PolishCache(tmp_path)
        pool = _candidate_pool()
        llm_a = MockLLMClient([_valid_llm_response_for(pool)])
        result_a = extract_unique_insights(
            pool, product=_product(), llm_client=llm_a, cache=cache, style_seed=1,
        )
        llm_b = MockLLMClient([_valid_llm_response_for(pool)])
        result_b = extract_unique_insights(
            pool, product=_product(), llm_client=llm_b, cache=cache, style_seed=2,
        )
        assert result_a.cache_key != result_b.cache_key
        assert llm_a.call_count == 1
        assert llm_b.call_count == 1

    def test_invalid_output_not_cached(self, tmp_path: Path):
        cache = PolishCache(tmp_path)
        pool = _candidate_pool()
        valid = json.loads(_valid_llm_response_for(pool))
        bad = copy.deepcopy(valid)
        bad["insights"][0]["evidence_quotes_ko"][0] = "발색이 좋다 (paraphrase)"
        llm = MockLLMClient([_as_response(bad), _as_response(bad)])
        extract_unique_insights(
            pool, product=_product(), llm_client=llm, cache=cache,
        )
        # No cache entry should be written for an invalid result.
        assert list(tmp_path.rglob("*.json")) == []

    def test_stale_cache_re_runs_llm(self, tmp_path: Path):
        """If the cached doc happens to fail the current validator
        (e.g. a rule was tightened post-write), the extractor should
        invalidate the hit and call the LLM."""
        cache = PolishCache(tmp_path)
        pool = _candidate_pool()
        llm1 = MockLLMClient([_valid_llm_response_for(pool)])
        result1 = extract_unique_insights(
            pool, product=_product(), llm_client=llm1, cache=cache,
        )
        # Manually corrupt the cached doc so the validator now blocks.
        cached = cache.get(result1.cache_key)
        cached["insights"][0]["title_ko"] = "역대급 발색"  # anti_clickbait
        cache.set(result1.cache_key, cached)

        # Next run: we expect a fresh LLM call (cache hit fails
        # validation, falls through). Provide a valid response.
        llm2 = MockLLMClient([_valid_llm_response_for(pool)])
        result2 = extract_unique_insights(
            pool, product=_product(), llm_client=llm2, cache=cache,
        )
        assert result2.cache_hit is False
        assert result2.llm_call_count == 1
        assert result2.status == "ok"


# ---------------------------------------------------------------------------
# defensive
# ---------------------------------------------------------------------------


class TestDefensive:
    def test_pool_excerpts_present_in_prompt(self):
        """Every bounded_review_excerpts value must appear verbatim
        in the user prompt — that's the LLM's evidence pool. The
        extractor never reads raw reviews; only the pool flows in."""
        pool = _candidate_pool()
        llm = MockLLMClient([_valid_llm_response_for(pool)])
        extract_unique_insights(
            pool, product=_product(), llm_client=llm,
        )
        user_prompt = llm.calls[0]["user"]
        bounded = pool.excerpts_as_dict()
        for rid, text in bounded.items():
            assert rid in user_prompt
            # text may be split across multiple lines depending on
            # excerpt length; check the first 20 chars survive.
            assert text[:20] in user_prompt

    def test_no_raw_review_field_in_call_signature(self):
        """Defensive: the public extractor signature must NOT
        accept raw reviews. This is a static sanity check — if a
        future PR adds such a kwarg, the test fails loudly."""
        import inspect
        sig = inspect.signature(extract_unique_insights)
        forbidden = {"raw_reviews", "reviews", "review_text", "review_blocks"}
        leaked = forbidden & set(sig.parameters.keys())
        assert not leaked, f"raw-review kwargs leaked into signature: {leaked}"

    def test_empty_insights_response_is_ok(self):
        """LLM legitimately decides nothing rises above threshold."""
        pool = _candidate_pool()
        llm = MockLLMClient([json.dumps({"insights": []})])
        result = extract_unique_insights(
            pool, product=_product(), llm_client=llm,
        )
        assert result.status == "ok"
        assert result.insights_doc["insights"] == []

    def test_does_not_mutate_candidate_pool(self):
        pool = _candidate_pool()
        before_dict = pool.to_dict()
        llm = MockLLMClient([_valid_llm_response_for(pool)])
        extract_unique_insights(
            pool, product=_product(), llm_client=llm,
        )
        # Pool is frozen + we never replace it; sanity check via dict equality.
        assert pool.to_dict() == before_dict
