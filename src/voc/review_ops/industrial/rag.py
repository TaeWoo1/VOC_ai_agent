"""Local, in-memory RAG over uploaded industrial reviews (Slice 2A).

No persistent vector DB, no Pinecone, no disk index — embeddings live in a
process-local matrix and disappear when the app stops. OpenAI is used only for
(1) embeddings and (2) an optional short Korean answer; both degrade gracefully:
if no API key or the call fails, the caller falls back to retrieval-only.

The pure, testable surface (document/metadata building, cosine similarity, tag
boost, ranking) makes NO network calls. Only ``embed_texts`` / ``build_index`` /
``generate_answer`` touch OpenAI, and they import the client lazily.
"""

from __future__ import annotations

import math
import os
from dataclasses import dataclass, field
from pathlib import Path

from src.voc.review_ops.industrial.schema import IndustrialReview
from src.voc.review_ops.industrial.taxonomy import CATEGORY_BY_ID

try:  # numpy is preferred for the similarity matrix; pure-Python fallback below
    import numpy as _np

    _HAS_NUMPY = True
except ImportError:  # pragma: no cover - exercised only without numpy
    _np = None
    _HAS_NUMPY = False

DEFAULT_EMBEDDING_MODEL = "text-embedding-3-small"
DEFAULT_CHAT_MODEL = "gpt-4o-mini"
DEFAULT_TOP_K = 8
DEFAULT_BOOST_WEIGHT = 0.05

# Query-term -> taxonomy category to boost when the term appears in a question.
TAG_BOOSTS: dict[str, str] = {
    "파손": "delivery_packaging_damage",
    "배송": "delivery_packaging_damage",
    "사이즈": "spec_size_confusion",
    "규격": "spec_size_confusion",
    "설치": "installation_difficulty",
    "구성품": "missing_or_wrong_components",
    "누락": "missing_or_wrong_components",
    "교환": "cs_exchange_return_issue",
    "반품": "cs_exchange_return_issue",
    "cs": "cs_exchange_return_issue",
    "답글": "needs_reply",
    "문의": "needs_reply",
    "재구매": "reorder_bulk_purchase_signal",
    "대량": "reorder_bulk_purchase_signal",
    "상세페이지": "detail_page_faq_candidate",
    "faq": "detail_page_faq_candidate",
}

_ENV_KEYS = ("OPENAI_API_KEY", "OPENAI_EMBEDDING_MODEL", "OPENAI_CHAT_MODEL")


# ---------------------------------------------------------------------------
# Environment (no secret is ever printed or returned in logs)
# ---------------------------------------------------------------------------

_env_loaded = False


def _tiny_load_env(path: str = ".env") -> None:
    """Minimal .env loader for the OpenAI keys only (dotenv fallback)."""
    p = Path(path)
    if not p.exists():
        return
    for line in p.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if key in _ENV_KEYS and not os.getenv(key):
            os.environ[key] = value


def load_env() -> None:
    """Load .env into os.environ once. Prefers python-dotenv if installed."""
    global _env_loaded
    if _env_loaded:
        return
    try:
        from dotenv import load_dotenv

        load_dotenv()
    except ImportError:  # pragma: no cover - dotenv is installed here
        _tiny_load_env()
    _env_loaded = True


def resolve_api_key() -> str | None:
    load_env()
    key = os.getenv("OPENAI_API_KEY")
    return key or None


def embedding_model() -> str:
    load_env()
    return os.getenv("OPENAI_EMBEDDING_MODEL") or DEFAULT_EMBEDDING_MODEL


def chat_model() -> str:
    load_env()
    return os.getenv("OPENAI_CHAT_MODEL") or DEFAULT_CHAT_MODEL


# ---------------------------------------------------------------------------
# Document + metadata building (pure)
# ---------------------------------------------------------------------------


def build_document(review: IndustrialReview, tags: list[str]) -> str:
    """One embedding document per review: text + product/option/channel/rating/tags."""
    labels = [CATEGORY_BY_ID[t].label_ko for t in tags if t in CATEGORY_BY_ID]
    parts = [review.text]
    if review.product_name:
        parts.append(f"상품: {review.product_name}")
    if review.option_name:
        parts.append(f"옵션: {review.option_name}")
    parts.append(f"채널: {review.channel}")
    if review.rating is not None:
        parts.append(f"평점: {review.rating:g}점")
    if labels:
        parts.append("태그: " + ", ".join(labels))
    return "\n".join(parts)


def build_metadata(review: IndustrialReview, tags: list[str]) -> dict:
    labels = [CATEGORY_BY_ID[t].label_ko for t in tags if t in CATEGORY_BY_ID]
    return {
        "review_id": review.review_id,
        "source_id": review.source_id,
        "date": review.review_date.isoformat() if review.review_date else None,
        "channel": review.channel,
        "product_name": review.product_name,
        "option_name": review.option_name,
        "rating": review.rating,
        "tags": list(tags),
        "tag_labels": labels,
        "text": review.text,
    }


# ---------------------------------------------------------------------------
# Similarity (numpy with pure-Python fallback)
# ---------------------------------------------------------------------------


def _cosine_py(a: list[float], b: list[float]) -> float:
    """Pure-Python cosine similarity. Used as the no-numpy fallback."""
    dot = sum(x * y for x, y in zip(a, b))
    na = math.sqrt(sum(x * x for x in a))
    nb = math.sqrt(sum(y * y for y in b))
    if na == 0.0 or nb == 0.0:
        return 0.0
    return dot / (na * nb)


def cosine_similarity(a, b) -> float:
    if _HAS_NUMPY:
        av = _np.asarray(a, dtype=float)
        bv = _np.asarray(b, dtype=float)
        na = float(_np.linalg.norm(av))
        nb = float(_np.linalg.norm(bv))
        if na == 0.0 or nb == 0.0:
            return 0.0
        return float(av @ bv / (na * nb))
    return _cosine_py(list(a), list(b))


def _to_matrix(embeddings: list[list[float]]):
    if _HAS_NUMPY:
        return _np.asarray(embeddings, dtype=float)
    return [[float(x) for x in row] for row in embeddings]


def _cosine_all(matrix, query) -> list[float]:
    """Cosine of ``query`` against every row of ``matrix``."""
    if _HAS_NUMPY:
        q = _np.asarray(query, dtype=float)
        qn = float(_np.linalg.norm(q))
        if qn == 0.0 or len(matrix) == 0:
            return [0.0] * len(matrix)
        norms = _np.linalg.norm(matrix, axis=1)
        norms = _np.where(norms == 0.0, 1e-12, norms)
        return list(map(float, (matrix @ q) / (norms * qn)))
    return [_cosine_py(row, list(query)) for row in matrix]


# ---------------------------------------------------------------------------
# Tag boost (pure)
# ---------------------------------------------------------------------------


def boosted_ids_for_query(query: str) -> set[str]:
    q = (query or "").lower()
    return {cat for term, cat in TAG_BOOSTS.items() if term in q}


# ---------------------------------------------------------------------------
# Index + ranking
# ---------------------------------------------------------------------------


@dataclass
class RagDocument:
    text: str
    metadata: dict
    tags: list[str] = field(default_factory=list)


@dataclass
class SearchResult:
    doc: RagDocument
    similarity: float
    score: float  # similarity + tag boost


class RagIndex:
    """In-memory index: documents + an embedding matrix. No persistence."""

    def __init__(self, documents: list[RagDocument], embeddings: list[list[float]]):
        if len(documents) != len(embeddings):
            raise ValueError("documents and embeddings length mismatch")
        self.documents = documents
        self._matrix = _to_matrix(embeddings)

    def __len__(self) -> int:
        return len(self.documents)

    def vectors_by_review_id(self) -> dict[str, list[float]]:
        """Map review_id -> its stored embedding (as a plain list).

        Read-only accessor so other in-memory stages (e.g. issue clustering) can
        reuse already-built embeddings instead of re-embedding. No network.
        """
        out: dict[str, list[float]] = {}
        for i, doc in enumerate(self.documents):
            rid = doc.metadata.get("review_id")
            if rid is None:
                continue
            row = self._matrix[i]
            out[rid] = [float(x) for x in (row.tolist() if _HAS_NUMPY else row)]
        return out

    def tag_match_count(self, query_text: str) -> int:
        """How many indexed docs carry a tag the query clearly maps to.

        Returns 0 when the query maps to no tag (so callers can distinguish
        "no tag in query" from "tag in query but no matching reviews").
        """
        boosted = boosted_ids_for_query(query_text)
        if not boosted:
            return 0
        return sum(1 for doc in self.documents if boosted & set(doc.tags))

    def rank(
        self,
        query_embedding: list[float],
        *,
        query_text: str = "",
        top_k: int = DEFAULT_TOP_K,
        boost_weight: float = DEFAULT_BOOST_WEIGHT,
        strict_tags: bool = False,
    ) -> list[SearchResult]:
        sims = _cosine_all(self._matrix, query_embedding)
        boosted = boosted_ids_for_query(query_text)
        results: list[SearchResult] = []
        for doc, sim in zip(self.documents, sims):
            boost = boost_weight if (boosted & set(doc.tags)) else 0.0
            results.append(SearchResult(doc=doc, similarity=sim, score=sim + boost))
        if strict_tags and boosted:
            # Hard priority: any tag-matching review outranks any non-matching
            # one, then by score within each group.
            results.sort(
                key=lambda r: (bool(boosted & set(r.doc.tags)), r.score), reverse=True
            )
        else:
            results.sort(key=lambda r: r.score, reverse=True)
        return results[:top_k]


# ---------------------------------------------------------------------------
# OpenAI-backed operations (lazy import; degrade gracefully)
# ---------------------------------------------------------------------------


def embed_texts(texts: list[str], *, api_key: str, model: str | None = None) -> list[list[float]]:
    """Embed texts via OpenAI. Batched. Raises on hard failure (caller handles)."""
    from openai import OpenAI

    client = OpenAI(api_key=api_key)
    model = model or embedding_model()
    out: list[list[float]] = []
    batch = 256
    for i in range(0, len(texts), batch):
        chunk = texts[i : i + batch]
        resp = client.embeddings.create(model=model, input=chunk)
        out.extend(d.embedding for d in resp.data)
    return out


def build_index(
    tagged: list[tuple[IndustrialReview, list[str]]],
    *,
    api_key: str,
    model: str | None = None,
) -> RagIndex:
    """Build documents from (review, tags) pairs and embed them into a RagIndex."""
    documents = [
        RagDocument(
            text=build_document(review, tags),
            metadata=build_metadata(review, tags),
            tags=list(tags),
        )
        for review, tags in tagged
    ]
    embeddings = embed_texts([d.text for d in documents], api_key=api_key, model=model)
    return RagIndex(documents, embeddings)


def _snippet(result: SearchResult, index: int) -> str:
    m = result.doc.metadata
    rating = f"{m['rating']:g}점" if m.get("rating") is not None else "평점미상"
    head = f"{m.get('date') or '날짜미상'} · {m.get('channel')} · {rating}"
    return f"{index}. ({head}) {m.get('text', '')}"


def generate_answer(
    query: str,
    results: list[SearchResult],
    *,
    api_key: str | None,
    model: str | None = None,
) -> str | None:
    """Short, cautious Korean answer grounded ONLY in retrieved snippets.

    Returns None on any failure (no key, network error) so the caller can fall
    back to retrieval-only mode.
    """
    if not api_key or not results:
        return None
    try:
        from openai import OpenAI

        client = OpenAI(api_key=api_key)
        model = model or chat_model()
        context = "\n".join(_snippet(r, i) for i, r in enumerate(results, 1))
        system = (
            "당신은 셀러의 리뷰 운영을 돕는 보조자입니다. "
            "반드시 제공된 리뷰 발췌만 근거로 답하고, 그 외의 사실은 절대 지어내지 마세요."
        )
        user = (
            f"질문: {query}\n\n"
            f"검색된 리뷰 {len(results)}건:\n{context}\n\n"
            f"위 리뷰 {len(results)}건만 근거로 한국어로 3~4문장 이내로 신중하게 요약하세요. "
            "검색된 리뷰 건수를 답변에 포함하고, 자세한 내용은 오른쪽의 원문 리뷰를 확인하라고 안내하세요. "
            "근거가 부족하면 단정하지 말고 그렇게 말하세요."
        )
        resp = client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
            temperature=0.2,
            max_tokens=400,
        )
        content = (resp.choices[0].message.content or "").strip()
        return content or None
    except Exception:
        return None
