"""Evidence unit splitter — splits reviews into atomic evidence units.

Heuristic sentence-level splitting. Replaceable via SentenceSegmenter protocol.
Invariant: unit.text == review.text[unit.char_start:unit.char_end]
"""

from __future__ import annotations

import re

from src.voc.schemas.canonical import CanonicalReview
from src.voc.schemas.evidence import EvidenceUnit, SentenceSegmenter

# Matches sentence-ending positions: punctuation or Korean endings followed by whitespace.
_SPLIT_RE = re.compile(
    r"(?<=[.!?])\s+"
    r"|(?<=[다요죠])[.]\s*(?=\S)"
)

MIN_SEGMENT_LENGTH = 10


class DefaultSegmenter:
    """Heuristic sentence segmenter for Korean and English."""

    def __init__(self, min_length: int = MIN_SEGMENT_LENGTH):
        self.min_length = min_length

    def segment(self, text: str, language: str) -> list[tuple[str, int, int]]:
        """Split text into (segment_text, char_start, char_end) spans.

        Spans are derived by slicing the original text at split boundaries.
        Invariant: segment_text == text[char_start:char_end]
        """
        if not text.strip():
            return []

        # Find split positions — each match is a boundary between segments
        boundaries = [0]
        for m in _SPLIT_RE.finditer(text):
            boundaries.append(m.end())
        boundaries.append(len(text))

        # Slice text at boundaries into spans
        spans: list[tuple[str, int, int]] = []
        for i in range(len(boundaries) - 1):
            start = boundaries[i]
            end = boundaries[i + 1]
            segment_text = text[start:end].rstrip()
            if not segment_text:
                continue
            spans.append((segment_text, start, start + len(segment_text)))

        if not spans:
            return []

        # Merge short segments into previous (or next if first)
        merged: list[tuple[str, int, int]] = [spans[0]]
        for seg_text, seg_start, seg_end in spans[1:]:
            if len(seg_text) < self.min_length:
                prev_text, prev_start, prev_end = merged[-1]
                new_end = seg_end
                merged[-1] = (text[prev_start:new_end].rstrip(), prev_start, new_end)
                # Fix end after rstrip
                fixed_text = merged[-1][0]
                merged[-1] = (fixed_text, prev_start, prev_start + len(fixed_text))
            else:
                merged.append((seg_text, seg_start, seg_end))

        # If first segment is still too short, merge into second
        if len(merged) > 1 and len(merged[0][0]) < self.min_length:
            first_text, first_start, first_end = merged[0]
            second_text, second_start, second_end = merged[1]
            combined = text[first_start:second_end].rstrip()
            merged[0:2] = [(combined, first_start, first_start + len(combined))]

        return merged


_DEFAULT_SEGMENTER = DefaultSegmenter()


def split_review(
    review: CanonicalReview,
    segmenter: SentenceSegmenter | None = None,
) -> list[EvidenceUnit]:
    """Split a CanonicalReview into EvidenceUnits.

    Uses DefaultSegmenter if no segmenter is provided.
    """
    seg = segmenter or _DEFAULT_SEGMENTER
    spans = seg.segment(review.text, review.language)

    return [
        EvidenceUnit(
            evidence_id=f"{review.review_id}_{i:03d}",
            review_id=review.review_id,
            text=span_text,
            unit_index=i,
            char_start=char_start,
            char_end=char_end,
            language=review.language,
            source_channel=review.source_channel,
            product_keyword=review.product_keyword,
            rating_normalized=review.rating_normalized,
            review_date=review.review_date,
        )
        for i, (span_text, char_start, char_end) in enumerate(spans)
    ]
