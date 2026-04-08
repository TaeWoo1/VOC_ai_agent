"""VOC insight schema — structured generation output.

Created by:  generation.insight_gen
Consumed by: eval.runner, eval.metrics, eval.failure_analysis, app.ui
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


class Theme(BaseModel):
    label: str
    description: str
    sentiment: Literal["positive", "negative", "mixed"]
    evidence_ids: list[str] = Field(min_length=1)


class PainPoint(BaseModel):
    description: str
    severity: Literal["critical", "major", "minor"]
    evidence_ids: list[str] = Field(min_length=1)


class Recommendation(BaseModel):
    action: str
    rationale: str
    evidence_ids: list[str] = Field(min_length=1)


class VOCInsight(BaseModel):
    query: str
    query_language: Literal["ko", "en"]
    response_language: Literal["ko", "en"]  # TODO: match query_language in generation
    summary: str
    themes: list[Theme] = Field(default_factory=list)
    pain_points: list[PainPoint] = Field(default_factory=list)
    recommendations: list[Recommendation] = Field(default_factory=list)
    evidence_used: list[str] = Field(default_factory=list)  # TODO: compute from sub-schema evidence_ids after generation
    evidence_available: int = 0  # Number of retrieved evidence units passed into generation
    caveats: list[str] = Field(default_factory=list)  # Checked by F-GEN-NOCAV
