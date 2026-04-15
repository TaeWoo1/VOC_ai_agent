"""Pipeline orchestrator — ingest + retrieval + generation.

Ingest: collect → normalize → dedup → evidence split → chunk → embed → index.
Query: embed question → retrieve top-K → generate VOCInsight.
"""

from __future__ import annotations

import logging
import time
from dataclasses import dataclass, field

from src.voc.connectors.base import CollectParams
from src.voc.connectors.mock import MockConnector
from src.voc.generation.insight_gen import InsightGenerator
from src.voc.ingestion.normalizer import normalize
from src.voc.ingestion.dedup import dedup
from src.voc.ingestion.evidence import split_review
from src.voc.processing.chunker import chunk_evidence_units
from src.voc.processing.embedder import Embedder
from src.voc.processing.indexer import ChunkIndexer
from src.voc.retrieval.retriever import retrieve

logger = logging.getLogger(__name__)


@dataclass
class StageResult:
    name: str
    status: str = "ok"  # "ok" | "error"
    count: int = 0
    duration_ms: float = 0.0
    errors: list[str] = field(default_factory=list)


@dataclass
class QueryResult:
    run_id: str
    status: str = "not_implemented"
    insight: dict | None = None
    retrieved_evidence: list[dict] = field(default_factory=list)
    retrieval_meta: dict = field(default_factory=dict)
    message: str | None = None


@dataclass
class IngestResult:
    run_id: str
    status: str = "completed"  # "completed" | "failed"
    stages: list[StageResult] = field(default_factory=list)

    @property
    def counts(self) -> dict[str, int]:
        return {s.name: s.count for s in self.stages}


class VOCPipeline:
    """Orchestrates the VOC pipeline."""

    def __init__(self, embedder: Embedder, indexer: ChunkIndexer, generator: InsightGenerator, connectors=None):
        self._connectors = connectors or {"mock": MockConnector}
        self._embedder = embedder
        self._indexer = indexer
        self._generator = generator

    async def ingest(
        self, keyword: str, run_id: str, connector_name: str = "mock",
        max_results: int = 100, collect_params: CollectParams | None = None,
    ) -> IngestResult:
        """Run collect → normalize → dedup → evidence → chunk → embed → index."""
        result = IngestResult(run_id=run_id)

        # --- Collect ---
        t0 = time.perf_counter()
        try:
            connector_cls = self._connectors.get(connector_name)
            if connector_cls is None:
                raise ValueError(f"Unknown connector: {connector_name}")
            connector = connector_cls()
            params = collect_params or CollectParams(max_results=max_results)
            raw_reviews = await connector.collect(keyword, params)
            result.stages.append(StageResult(
                name="collected", count=len(raw_reviews),
                duration_ms=_elapsed_ms(t0),
            ))
        except Exception as e:
            result.stages.append(StageResult(
                name="collected", status="error",
                duration_ms=_elapsed_ms(t0), errors=[str(e)],
            ))
            result.status = "failed"
            return result

        # --- Normalize ---
        t0 = time.perf_counter()
        canonical = []
        normalize_errors = []
        for raw in raw_reviews:
            try:
                canonical.append(normalize(raw))
            except ValueError as e:
                normalize_errors.append(f"{raw.source_id}: {e}")
        result.stages.append(StageResult(
            name="normalized", count=len(canonical),
            duration_ms=_elapsed_ms(t0), errors=normalize_errors,
        ))

        # --- Dedup ---
        t0 = time.perf_counter()
        canonical = dedup(canonical)
        dup_count = sum(1 for r in canonical if r.is_duplicate)
        non_dup = [r for r in canonical if not r.is_duplicate]
        result.stages.append(StageResult(
            name="deduplicated", count=dup_count,
            duration_ms=_elapsed_ms(t0),
        ))

        # --- Evidence split ---
        t0 = time.perf_counter()
        all_units = []
        for review in non_dup:
            units = split_review(review)
            all_units.extend(units)
        result.stages.append(StageResult(
            name="evidence_units", count=len(all_units),
            duration_ms=_elapsed_ms(t0),
        ))

        # --- Chunk ---
        t0 = time.perf_counter()
        chunks = chunk_evidence_units(all_units)
        result.stages.append(StageResult(
            name="chunks", count=len(chunks),
            duration_ms=_elapsed_ms(t0),
        ))

        # --- Embed + Index ---
        t0 = time.perf_counter()
        try:
            texts = [c.text for c in chunks]
            embeddings = self._embedder.embed_texts(texts)

            ids = [c.chunk_id for c in chunks]
            documents = texts
            metadatas = [
                {
                    "review_id": c.review_id,
                    "language": c.language,
                    "source_channel": c.source_channel,
                    "product_keyword": c.product_keyword,
                    "evidence_ids": ",".join(c.evidence_ids),
                    "rating_normalized": c.rating_normalized if c.rating_normalized is not None else -1.0,
                }
                for c in chunks
            ]

            self._indexer.upsert_chunks(ids, embeddings, documents, metadatas)
            result.stages.append(StageResult(
                name="indexed", count=len(chunks),
                duration_ms=_elapsed_ms(t0),
            ))
        except Exception as e:
            result.stages.append(StageResult(
                name="indexed", status="error",
                duration_ms=_elapsed_ms(t0), errors=[str(e)],
            ))
            result.status = "failed"
            return result

        logger.info(
            "Ingest completed",
            extra={"run_id": run_id, "counts": result.counts},
        )
        return result

    async def query(
        self,
        question: str,
        run_id: str,
        top_k: int = 10,
        strategy: str = "naive",
        filters: dict | None = None,
    ) -> QueryResult:
        """Retrieve evidence for a question. Generation not yet wired."""
        t0 = time.perf_counter()
        try:
            results = retrieve(
                query=question,
                embedder=self._embedder,
                indexer=self._indexer,
                top_k=top_k,
                strategy=strategy,
                filters=filters if filters else None,
            )
        except NotImplementedError as e:
            return QueryResult(
                run_id=run_id,
                status="not_implemented",
                message=str(e),
            )
        except Exception as e:
            logger.error("Retrieval failed", exc_info=e)
            return QueryResult(
                run_id=run_id,
                status="failed",
                message=f"Retrieval error: {e}",
            )

        duration = _elapsed_ms(t0)
        evidence = [
            {
                "chunk_id": r.chunk_id,
                "text": r.text,
                "evidence_ids": r.evidence_ids,
                "score": round(r.score, 4),
                "rank": r.rank,
                "language": r.language,
                "source_channel": r.source_channel,
            }
            for r in results
        ]

        retrieval_meta = {
            "chunks_retrieved": len(results),
            "top_score": round(results[0].score, 4) if results else None,
            "bottom_score": round(results[-1].score, 4) if results else None,
            "retrieval_ms": duration,
        }

        logger.info(
            "Retrieval completed",
            extra={"run_id": run_id, "chunks_retrieved": len(results), "duration_ms": duration},
        )

        # --- Generate ---
        t1 = time.perf_counter()
        try:
            insight = self._generator.generate(question, evidence)
            gen_duration = _elapsed_ms(t1)
            retrieval_meta["generation_ms"] = gen_duration

            logger.info(
                "Generation completed",
                extra={"run_id": run_id, "duration_ms": gen_duration},
            )

            return QueryResult(
                run_id=run_id,
                status="completed",
                insight=insight.model_dump(),
                retrieved_evidence=evidence,
                retrieval_meta=retrieval_meta,
            )
        except (ValueError, Exception) as e:
            gen_duration = _elapsed_ms(t1)
            retrieval_meta["generation_ms"] = gen_duration
            logger.error("Generation failed", exc_info=e, extra={"run_id": run_id})

            return QueryResult(
                run_id=run_id,
                status="generation_failed",
                retrieved_evidence=evidence,
                retrieval_meta=retrieval_meta,
                message=f"Generation error: {e}",
            )


def _elapsed_ms(start: float) -> float:
    return round((time.perf_counter() - start) * 1000, 2)
