"""Pydantic schema for content_plan_ko — the editorial planner output.

Architecture context
--------------------
The cardnews skill is split into 3 layers:

    analysis_report.json   →   editorial_planner   →   layout   →   render

The planner consumes the analysis report and emits a `content_plan_ko`
object: a fully-public, sanitized, consumer-facing copy bundle. The
layout layer maps plan fields → page records but never invents copy.

This module defines the contract so:
  * the planner's mock + LLM modes both validate against the same shape,
  * the layout consumer can rely on field presence + char budgets,
  * tests can poison fields and catch regressions.

Why `extra="forbid"`
--------------------
Fail-closed on unknown keys. If a future LLM responds with hallucinated
fields the planner refuses to ship them. Adding a field is a deliberate
schema bump, not a silent surface expansion.

Char budgets
------------
Tight on every Korean string. The render templates have fixed type
sizes; copy that overflows a budget breaks the layout silently. The
planner truncates to budget before validation, so a 200-char headline
becomes 36 chars (with ellipsis) rather than a validation error in
mock mode. LLM mode trusts the model to obey the budget; if it
doesn't, validation fails and the raw response is saved.
"""
from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

# Char budgets — tuned for the 1080x1350 templates. These are upper
# bounds; the planner SHOULD aim for ~80% of the budget so the
# Playwright renderer doesn't truncate visible text.
HEADLINE_MAX = 36
SUBLINE_MAX = 60
TITLE_MAX = 18
LEAD_MAX = 180
BULLET_MAX = 40
NOTE_MAX = 32
TIP_MAX = 40
LABEL_MAX = 28
COUNT_MAX = 24
CHIP_MAX = 8
METRIC_LABEL_MAX = 16
METRIC_VALUE_MAX = 16
ASIDE_MAX = 60


_BASE_CONFIG = ConfigDict(extra="forbid", str_strip_whitespace=True)


def _required_str(max_len: int) -> object:
    return Field(min_length=1, max_length=max_len)


# ---------------------------------------------------------------------------
# Shared atoms
# ---------------------------------------------------------------------------


class MetricItem(BaseModel):
    model_config = _BASE_CONFIG
    label: str = Field(min_length=1, max_length=METRIC_LABEL_MAX)
    value: str = Field(min_length=1, max_length=METRIC_VALUE_MAX)


class LovedItem(BaseModel):
    model_config = _BASE_CONFIG
    label: str = Field(min_length=1, max_length=TITLE_MAX)
    count: str = Field(min_length=1, max_length=COUNT_MAX)
    note: str = Field(min_length=1, max_length=NOTE_MAX)


class DivideItem(BaseModel):
    model_config = _BASE_CONFIG
    label: str = Field(min_length=1, max_length=TITLE_MAX)
    satisfied: int = Field(ge=0)
    split: int = Field(ge=0)
    note: str = Field(min_length=1, max_length=NOTE_MAX)


class CheckpointItem(BaseModel):
    model_config = _BASE_CONFIG
    label: str = Field(min_length=1, max_length=TITLE_MAX)
    count: str = Field(min_length=1, max_length=COUNT_MAX)
    tip: str = Field(min_length=1, max_length=TIP_MAX)
    why_note: str = Field(min_length=1, max_length=NOTE_MAX)
    who_note: str = Field(min_length=1, max_length=NOTE_MAX)


class AudienceItem(BaseModel):
    model_config = _BASE_CONFIG
    label: str = Field(min_length=1, max_length=LABEL_MAX)
    note: str = Field(min_length=1, max_length=COUNT_MAX)


# ---------------------------------------------------------------------------
# Page sections
# ---------------------------------------------------------------------------


class CoverPlan(BaseModel):
    model_config = _BASE_CONFIG
    headline: str = Field(min_length=1, max_length=HEADLINE_MAX)
    subline: str = Field(min_length=1, max_length=SUBLINE_MAX)
    chips: list[str] = Field(min_length=1, max_length=4)

    @field_validator("chips")
    @classmethod
    def _chip_lengths(cls, v: list[str]) -> list[str]:
        for c in v:
            if not c or len(c) > CHIP_MAX:
                raise ValueError(
                    f"chip {c!r} exceeds budget (1..{CHIP_MAX} chars)"
                )
        return v


class HookPlan(BaseModel):
    model_config = _BASE_CONFIG
    headline: str = Field(min_length=1, max_length=HEADLINE_MAX)
    metrics: list[MetricItem] = Field(min_length=1, max_length=4)
    bullets: list[str] = Field(min_length=1, max_length=3)

    @field_validator("bullets")
    @classmethod
    def _bullet_lengths(cls, v: list[str]) -> list[str]:
        for b in v:
            if not b or len(b) > BULLET_MAX:
                raise ValueError(
                    f"bullet {b!r} exceeds budget (1..{BULLET_MAX} chars)"
                )
        return v


class LovedPlan(BaseModel):
    model_config = _BASE_CONFIG
    headline: str = Field(min_length=1, max_length=HEADLINE_MAX)
    items: list[LovedItem] = Field(min_length=1, max_length=4)


class DividesPlan(BaseModel):
    model_config = _BASE_CONFIG
    headline: str = Field(min_length=1, max_length=HEADLINE_MAX)
    items: list[DivideItem] = Field(min_length=1, max_length=4)


class SignaturePlan(BaseModel):
    """The editorial pull-quote page.

    `attribute_key` is intentionally a free-form string (NOT an enum) so
    the planner can use a non-canonical attribute key when an LLM
    surfaces a different cluster than the 12 canonical Phase 2E keys.
    Tests cover the unknown-key path explicitly.
    """
    model_config = _BASE_CONFIG
    attribute_key: str = Field(min_length=1, max_length=64)
    title: str = Field(min_length=1, max_length=TITLE_MAX)
    headline: str = Field(min_length=1, max_length=HEADLINE_MAX)
    lead: str = Field(min_length=1, max_length=LEAD_MAX)
    why_it_matters: str = Field(min_length=1, max_length=ASIDE_MAX)
    who_should_check: str = Field(min_length=1, max_length=ASIDE_MAX)


class CheckpointsPlan(BaseModel):
    model_config = _BASE_CONFIG
    headline: str = Field(min_length=1, max_length=HEADLINE_MAX)
    items: list[CheckpointItem] = Field(min_length=1, max_length=4)


class AudiencePlan(BaseModel):
    model_config = _BASE_CONFIG
    fit_items: list[AudienceItem] = Field(min_length=1, max_length=4)
    consider_items: list[AudienceItem] = Field(min_length=1, max_length=4)


class MethodPlan(BaseModel):
    model_config = _BASE_CONFIG
    items: list[MetricItem] = Field(min_length=1, max_length=4)
    note: str = Field(min_length=1, max_length=NOTE_MAX)


class CtaPlan(BaseModel):
    """Single primary CTA. Type is constrained to a small allow-list so
    new CTA shapes are a deliberate schema bump (not an LLM hallucination
    that the renderer doesn't know how to lay out)."""
    model_config = _BASE_CONFIG
    type: Literal[
        "comment_next_product",
        "save_for_later",
        "ask_question",
    ]
    headline: str = Field(min_length=1, max_length=HEADLINE_MAX)
    body: str = Field(min_length=1, max_length=BULLET_MAX + 20)


# ---------------------------------------------------------------------------
# Top-level
# ---------------------------------------------------------------------------


class ContentPlan(BaseModel):
    """The full consumer-facing cardnews copy plan.

    Single source of truth for every Korean string that ends up on a
    rendered page (modulo structural labels added by the layout — chips
    like "분석 기준" — which are layout-owned, not editorial).
    """
    model_config = _BASE_CONFIG

    schema_version: str = Field(default="1.0")
    language: Literal["ko"] = "ko"

    cover: CoverPlan
    hook: HookPlan
    loved: LovedPlan
    divides: DividesPlan
    signature: SignaturePlan
    checkpoints: CheckpointsPlan
    audience: AudiencePlan
    method: MethodPlan
    cta: CtaPlan
