"""Inspect the ingestion pipeline on fixture data. Fully offline — no API calls."""

from __future__ import annotations

import asyncio

from src.voc.connectors.mock import MockConnector
from src.voc.ingestion.normalizer import normalize
from src.voc.ingestion.dedup import dedup
from src.voc.ingestion.evidence import split_review
from src.voc.processing.chunker import chunk_evidence_units


async def main():
    # --- Collect ---
    connector = MockConnector()
    raw_reviews = await connector.collect("에어팟 프로")
    print(f"Collected {len(raw_reviews)} raw reviews\n")

    # --- Normalize ---
    canonical_reviews = [normalize(raw) for raw in raw_reviews]

    # --- Dedup ---
    canonical_reviews = dedup(canonical_reviews)
    dup_count = sum(1 for r in canonical_reviews if r.is_duplicate)
    print(f"Normalized: {len(canonical_reviews)}, Duplicates flagged: {dup_count}\n")

    # --- Split + Chunk ---
    all_evidence_units = []
    all_chunks = []

    for review in canonical_reviews:
        if review.is_duplicate:
            continue

        units = split_review(review)
        chunks = chunk_evidence_units(units)
        all_evidence_units.extend(units)
        all_chunks.extend(chunks)

        print(f"--- Review: {review.review_id} [{review.language}] ---")
        print(f"  text: {review.text[:80]}...")
        print(f"  rating: {review.rating_normalized}")
        print(f"  date: {review.review_date}")
        print(f"  fingerprint: {review.content_fingerprint[:12]}...")
        print(f"  is_duplicate: {review.is_duplicate}")
        print()

        print(f"  Evidence units ({len(units)}):")
        for u in units:
            ok = u.text == review.text[u.char_start:u.char_end]
            flag = "" if ok else " *** SPAN MISMATCH ***"
            print(f"    [{u.evidence_id}] {u.text[:60]}...  "
                  f"(chars {u.char_start}-{u.char_end}){flag}")
        print()

        print(f"  Chunks ({len(chunks)}):")
        for c in chunks:
            print(f"    [{c.chunk_id}] {len(c.evidence_ids)} units")
            print(f"    text: {c.text[:80]}...")
        print()

    print("=" * 60)
    print(f"Total non-duplicate reviews: {len(canonical_reviews) - dup_count}")
    print(f"Total evidence units: {len(all_evidence_units)}")
    print(f"Total chunks: {len(all_chunks)}")
    print()

    # --- Evidence ID reference list (copy for eval dataset authoring) ---
    print("Evidence IDs:")
    for u in all_evidence_units:
        print(f"  {u.evidence_id}  [{u.language}]  {u.text[:50]}...")


if __name__ == "__main__":
    asyncio.run(main())
