"""Shared confidence-rubric helper for the content engine.

`resolve_overall_confidence(analysis_report)` returns one of
`weak | moderate | strong` from a uniform precedence:

    quick_decision.confidence_level (already weak/moderate/strong)
    > corpus.signal_stability        (high/medium/low → strong/moderate/weak)
    > corpus.confidence_level        (same mapping)
    > 'weak'

Both `insight_brief.py` and `cardnews_generator.py` import from
here so the brief and the cardnews never disagree on the framing
confidence. Keeping the function in a dedicated leaf module
avoids a circular import (cardnews imports from validators which
imports from… etc.).
"""
from __future__ import annotations

from typing import Literal

ConfidenceLevel = Literal["weak", "moderate", "strong"]


_CORPUS_TO_BRIEF_CONFIDENCE: dict[str, ConfidenceLevel] = {
    "high": "strong",
    "medium": "moderate",
    "low": "weak",
}


def resolve_overall_confidence(analysis_report: dict) -> ConfidenceLevel:
    """Pick weak/moderate/strong for the buyer-facing surface.

    Preference order:
      1. `quick_decision.confidence_level` if already in
         {weak, moderate, strong}.
      2. `corpus.signal_stability` mapped via {high, medium, low} →
         {strong, moderate, weak}. signal_stability is preferred
         over confidence_level because it accounts for sampling
         method, not just corpus size.
      3. `corpus.confidence_level` mapped the same way.
      4. `'weak'` as the safest default — under-claim never harms
         the buyer; over-claim does.
    """
    quick = analysis_report.get("quick_decision") or {}
    qc = (quick.get("confidence_level") or "").strip().lower()
    if qc in ("weak", "moderate", "strong"):
        return qc  # type: ignore[return-value]

    corpus = analysis_report.get("corpus") or {}
    for key in ("signal_stability", "confidence_level"):
        raw = (corpus.get(key) or "").strip().lower()
        mapped = _CORPUS_TO_BRIEF_CONFIDENCE.get(raw)
        if mapped:
            return mapped
    return "weak"
