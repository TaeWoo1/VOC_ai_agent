"""Chunker — combines adjacent evidence units into embedding-ready chunks.

Groups by review_id internally. Never merges across reviews.
Greedy accumulate / flush-on-overflow baseline. No overlap.
Caller is responsible for excluding duplicate reviews before chunking.
"""

from __future__ import annotations

import hashlib
from collections import defaultdict

from src.voc.schemas.chunk import Chunk
from src.voc.schemas.evidence import EvidenceUnit


def chunk_evidence_units(
    evidence_units: list[EvidenceUnit],
    min_tokens: int = 50,
    max_tokens_ko: int = 150,
    max_tokens_en: int = 200,
) -> list[Chunk]:
    """Chunk evidence units into embedding-ready chunks.

    - Groups by review_id, orders by unit_index within each group.
    - Greedy accumulate: flush when adding next unit would exceed max.
    - Single oversized unit: emitted as lone chunk, not split.
    - Text: unit texts joined with single space.
    - chunk_id: sha256(sorted(evidence_ids))[:16].
    """
    if not evidence_units:
        return []

    # Group by review_id
    groups: dict[str, list[EvidenceUnit]] = defaultdict(list)
    for unit in evidence_units:
        groups[unit.review_id].append(unit)

    chunks: list[Chunk] = []

    for review_id, units in groups.items():
        units.sort(key=lambda u: u.unit_index)
        max_tokens = max_tokens_ko if units[0].language == "ko" else max_tokens_en

        accumulator: list[EvidenceUnit] = []
        acc_tokens = 0

        for unit in units:
            unit_tokens = _estimate_tokens(unit.text, unit.language)

            if accumulator:
                combined = acc_tokens + unit_tokens
                if combined > max_tokens:
                    chunks.append(_build_chunk(accumulator))
                    accumulator = [unit]
                    acc_tokens = unit_tokens
                else:
                    accumulator.append(unit)
                    acc_tokens = combined
            else:
                accumulator = [unit]
                acc_tokens = unit_tokens

        if accumulator:
            chunks.append(_build_chunk(accumulator))

    return chunks


def _estimate_tokens(text: str, language: str) -> int:
    """Character-based token estimate. Replaceable with tiktoken later."""
    if language == "ko":
        return len(text)
    return max(1, len(text) // 4)


def _build_chunk(units: list[EvidenceUnit]) -> Chunk:
    """Construct a Chunk from a list of accumulated evidence units."""
    evidence_ids = [u.evidence_id for u in units]
    chunk_id = hashlib.sha256(
        "::".join(sorted(evidence_ids)).encode("utf-8")
    ).hexdigest()[:16]
    first = units[0]

    return Chunk(
        chunk_id=chunk_id,
        review_id=first.review_id,
        evidence_ids=evidence_ids,
        text=" ".join(u.text for u in units),
        language=first.language,
        tenant_id=first.tenant_id if hasattr(first, "tenant_id") else "default",
        source_channel=first.source_channel,
        product_keyword=first.product_keyword,
        rating_normalized=first.rating_normalized,
        review_date=first.review_date,
    )
