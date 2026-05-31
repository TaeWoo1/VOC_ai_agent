"""Local RAG: document/metadata building, cosine fallback, tag boost, ranking.

No network. These tests never call OpenAI — embeddings are injected directly so
``RagIndex.rank`` and the pure helpers are exercised offline.
"""

from __future__ import annotations

from datetime import date

from src.voc.review_ops.industrial import rag
from src.voc.review_ops.industrial.schema import IndustrialReview


def _review(text: str, **kw) -> IndustrialReview:
    base = dict(
        review_id="r1",
        channel="네이버",
        text=text,
        content_fingerprint="x" * 64,
    )
    base.update(kw)
    return IndustrialReview(**base)


def test_build_document_includes_all_fields():
    review = _review(
        "박스가 터져서 왔어요",
        product_name="전선몰딩 1P",
        option_name="2m",
        rating=2.0,
    )
    doc = rag.build_document(review, ["delivery_packaging_damage"])
    assert "박스가 터져서 왔어요" in doc
    assert "전선몰딩 1P" in doc
    assert "2m" in doc
    assert "네이버" in doc
    assert "2점" in doc
    assert "배송/포장 파손" in doc  # Korean tag label


def test_build_metadata_carries_audit_fields():
    review = _review(
        "구성품이 누락됐어요",
        product_name="세트A",
        rating=1.0,
        review_date=date(2026, 1, 21),
        source_id="rev-123",
    )
    meta = rag.build_metadata(review, ["missing_or_wrong_components"])
    assert meta["review_id"] == "r1"
    assert meta["source_id"] == "rev-123"
    assert meta["date"] == "2026-01-21"
    assert meta["channel"] == "네이버"
    assert meta["product_name"] == "세트A"
    assert meta["rating"] == 1.0
    assert meta["tags"] == ["missing_or_wrong_components"]
    assert meta["tag_labels"] == ["구성품 누락/오배송"]
    assert meta["text"] == "구성품이 누락됐어요"


def test_cosine_py_fallback_values():
    assert rag._cosine_py([1.0, 0.0], [1.0, 0.0]) == 1.0
    assert rag._cosine_py([1.0, 0.0], [0.0, 1.0]) == 0.0
    assert rag._cosine_py([1.0, 0.0], [-1.0, 0.0]) == -1.0
    # zero vector is safe (no division by zero)
    assert rag._cosine_py([0.0, 0.0], [1.0, 1.0]) == 0.0


def test_cosine_similarity_matches_pure_python():
    a, b = [0.2, 0.9, 0.1], [0.25, 0.85, 0.05]
    assert abs(rag.cosine_similarity(a, b) - rag._cosine_py(a, b)) < 1e-9


def test_boosted_ids_for_query():
    assert rag.boosted_ids_for_query("배송 파손 리뷰 보여줘") == {"delivery_packaging_damage"}
    assert rag.boosted_ids_for_query("사이즈 불만") == {"spec_size_confusion"}
    assert rag.boosted_ids_for_query("답글 필요한 거") == {"needs_reply"}
    assert rag.boosted_ids_for_query("CS 관련") == {"cs_exchange_return_issue"}
    assert rag.boosted_ids_for_query("그냥 좋은 리뷰") == set()


def test_tag_boost_changes_ranking():
    # Two docs with IDENTICAL embeddings; document order puts the untagged one
    # first. Without boost it would win ties; the 파손 boost must lift the tagged
    # delivery doc to the top.
    plain = rag.RagDocument(text="좋아요", metadata={"text": "좋아요"}, tags=[])
    damage = rag.RagDocument(
        text="박스 파손", metadata={"text": "박스 파손"}, tags=["delivery_packaging_damage"]
    )
    index = rag.RagIndex([plain, damage], [[1.0, 0.0], [1.0, 0.0]])

    # No boost (neutral query): tie broken by order -> plain first.
    neutral = index.rank([1.0, 0.0], query_text="리뷰 보여줘", top_k=2)
    assert neutral[0].doc is plain

    # Boosted query: tagged delivery doc rises to the top.
    boosted = index.rank([1.0, 0.0], query_text="배송 파손 보여줘", top_k=2)
    assert boosted[0].doc is damage
    assert boosted[0].score > boosted[0].similarity  # boost was applied


def test_rank_respects_top_k_and_similarity_order():
    docs = [
        rag.RagDocument(text="a", metadata={"text": "a"}, tags=[]),
        rag.RagDocument(text="b", metadata={"text": "b"}, tags=[]),
        rag.RagDocument(text="c", metadata={"text": "c"}, tags=[]),
    ]
    # embeddings increasingly aligned with the query [1,0]
    index = rag.RagIndex(docs, [[0.1, 1.0], [0.7, 1.0], [1.0, 0.0]])
    results = index.rank([1.0, 0.0], query_text="", top_k=2)
    assert len(results) == 2
    assert results[0].doc.text == "c"  # most aligned
    assert results[0].similarity >= results[1].similarity


def test_generate_answer_returns_none_without_key_or_results():
    # No API key -> None (retrieval-only fallback); no network attempted.
    assert rag.generate_answer("질문", [], api_key=None) is None
    dummy = [rag.SearchResult(doc=rag.RagDocument("t", {"text": "t"}), similarity=0.5, score=0.5)]
    assert rag.generate_answer("질문", dummy, api_key=None) is None


def test_rag_index_length_guard():
    docs = [rag.RagDocument(text="a", metadata={}, tags=[])]
    try:
        rag.RagIndex(docs, [[1.0], [2.0]])  # mismatched lengths
    except ValueError:
        pass
    else:
        raise AssertionError("expected ValueError on length mismatch")
