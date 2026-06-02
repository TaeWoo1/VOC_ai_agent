"""Pydantic schema for content_plan_ko — the editorial planner output (v2.1).

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

v2.1 narrative (12 base sections + spotlight expansion → 10–20 page carousel)
----------------------------------------------------------------------------
Base required (always present):
    cover · one_liner · loved · divides · signature · fit · consider ·
    summary · cta

Optional product-specific sections (omit when no signal supports them —
NEVER padded with corpus-generic advice):
    why_divides            — only when a dual-polarity attr exists
    checkpoints (1–3)      — only when caution attrs exist
    positive_spotlights    — 0..3 deep-dive pages on top loved attrs
    caution_spotlights     — 0..4 deep-dive pages on top caution attrs
    insight_spotlights     — 0..3 cross-cut interpretation pages
                             (option / use-case / skin-type angles)

Spotlight pages are LLM-interpreted "why does this signal split / land
the way it does" pages. They are NOT review-quote fan-outs — every
sentence is product-specific interpretation grounded in the briefing.

Removed in v2.0 (vs v1.x): `hook` (replaced by `one_liner`),
`audience` (split into `fit` + `consider`), `method` (demoted into
`cover.corpus_footer` + `cta.disclosure` so the analysis basis stays
visible without interrupting the carousel rhythm).

Why `extra="forbid"`
--------------------
Fail-closed on unknown keys. If a future LLM responds with hallucinated
fields the planner refuses to ship them. Adding a field is a deliberate
schema bump, not a silent surface expansion.

Char budgets
------------
Tight on every Korean string. The render templates have fixed type
sizes; copy that overflows a budget breaks the layout silently.
"""
from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

# Char budgets — tuned for the 1080x1350 templates. Upper bounds; the
# planner SHOULD aim for ~80% of the budget so the renderer doesn't
# truncate visible text.
HEADLINE_MAX = 36
ONE_LINER_MAX = 44              # v2.0: one_liner can run a touch longer than HEADLINE
SUBLINE_MAX = 60
TITLE_MAX = 18
LEAD_MAX = 180
BULLET_MAX = 40
TAKEAWAY_MAX = 50               # v2.0: summary takeaway sentences
NOTE_MAX = 32
CLOSING_NOTE_MAX = 60           # v2.0: summary closing-note (judgment criterion)
TIP_MAX = 40
LABEL_MAX = 28
COUNT_MAX = 24
CHIP_MAX = 8
METRIC_LABEL_MAX = 16
METRIC_VALUE_MAX = 16
ASIDE_MAX = 60
AXIS_MAX = 32                   # v2.0: why_divides axis lines
CORPUS_FOOTER_MAX = 40          # v2.0: cover micro-text (분석 기준 absorbed)
DISCLOSURE_MAX = 220            # v2.0: cta footer disclosure (분석 기준 absorbed)


_BASE_CONFIG = ConfigDict(extra="forbid", str_strip_whitespace=True)


def _ends_with_bun(value: str) -> bool:
    """True if the sentence ends in `분` (the Korean buyer-profile
    suffix). Trailing punctuation is tolerated so '… 분.' / '… 분!'
    still count. The check is structural, not semantic — a label like
    `대용량을 매일 부담 없이 쓰고 싶은 분` passes; `건성 피부 소유자`
    does not. We do NOT keyword-check for skin-type / behavior tokens
    so good copy doesn't false-fail."""
    if not value:
        return False
    s = value.rstrip(" .!?…)、,。·")
    return s.endswith("분")


# ---------------------------------------------------------------------------
# Shared atoms
# ---------------------------------------------------------------------------


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


class CheckpointSlide(BaseModel):
    """One checkpoint slide = one focused message.

    v2.0 splits the v1.x checkpoint *list-on-one-slide* into 1–3
    independent slides. This atom is the per-slide payload."""
    model_config = _BASE_CONFIG
    label: str = Field(min_length=1, max_length=TITLE_MAX)
    count: str = Field(min_length=1, max_length=COUNT_MAX)
    tip: str = Field(min_length=1, max_length=TIP_MAX)
    why_note: str = Field(min_length=1, max_length=NOTE_MAX)
    who_note: str = Field(min_length=1, max_length=NOTE_MAX)

    @field_validator("who_note")
    @classmethod
    def _who_note_ends_with_bun(cls, v: str) -> str:
        if not _ends_with_bun(v):
            raise ValueError(
                f"checkpoint.who_note must be a sentence ending in '분', "
                f"got {v!r}"
            )
        return v


class FitItem(BaseModel):
    """잘 맞는 분 — buyer-profile sentence + supporting signal hint.

    v2.3 — `signal_hint` (optional ≤40 chars) carries the
    [근거 signal] half of the fit.item structure
    `[상황/루틴] + [근거 signal]`. When present, the renderer surfaces
    it under the buyer-profile label so the reader can see *why* this
    profile was identified. `note` retains its existing role as the
    short count anchor (`만족 후기 N건`)."""
    model_config = _BASE_CONFIG
    label: str = Field(min_length=1, max_length=LABEL_MAX)
    note: str = Field(min_length=1, max_length=COUNT_MAX)
    signal_hint: str | None = Field(default=None, max_length=BULLET_MAX)

    @field_validator("label")
    @classmethod
    def _fit_label_ends_with_bun(cls, v: str) -> str:
        if not _ends_with_bun(v):
            raise ValueError(
                f"fit.items[].label must be a sentence ending in '분', "
                f"got {v!r}"
            )
        return v


class ConsiderItem(BaseModel):
    """A consider-slide item — buyer profile + review keyword to check.

    `label` MUST end in '분'. We deliberately do NOT enforce a
    keyword-based concreteness check here (skin-type / behavior /
    expectation tokens) — that would false-fail good idiomatic Korean.
    The prompt carries the concreteness contract; the schema just
    enforces sentence-form so tag-like one-word labels are rejected.

    v2.3 — `signal_hint` (optional ≤40 chars) carries the
    [확인할 리뷰 키워드] half of the consider.item structure
    `[민감한 기준] + [확인할 리뷰 키워드]`. Renderer surfaces it
    under the buyer-profile label as a compact "후기에서 확인할 키워드"
    line so the reader knows *what to search* before buying."""
    model_config = _BASE_CONFIG
    label: str = Field(min_length=1, max_length=LABEL_MAX)
    note: str = Field(min_length=1, max_length=COUNT_MAX)
    signal_hint: str | None = Field(default=None, max_length=BULLET_MAX)

    @field_validator("label")
    @classmethod
    def _consider_label_ends_with_bun(cls, v: str) -> str:
        if not _ends_with_bun(v):
            raise ValueError(
                f"consider.items[].label must be a sentence ending in '분', "
                f"got {v!r}"
            )
        return v


# ---------------------------------------------------------------------------
# Page sections (in narrative order)
# ---------------------------------------------------------------------------


CoverHookIntent = Literal[
    # v2.4 — controlled-variety hook intent (was v2.3 5-value enum).
    # Pick one INTENT from signal shape, then compose a headline using
    # one of >=5 wording patterns registered per intent in the planner.
    # Same intent across two products produces different headlines via
    # different wording_pattern picks (deterministic per product).
    "divergence",         # 만족과 아쉬움이 갈린 지점
    "expectation_check",  # 구매 전 확인할 기준
    "routine_fit",        # 특정 사용 루틴에 맞는지 묻기
    "hidden_condition",   # 만족도가 달라지는 조건
    "strong_positive",    # 반복된 호평 중심
    "caution_signal",     # 반복된 주의 신호 (부드럽게)
    "user_question",      # 소비자가 실제로 궁금해할 질문형
    "data_summary",       # 리뷰 수 기반 요약형
    "comparison_frame",   # 기대와 실제 사용감 비교
    "segment_frame",      # 피부타입/옵션/사용환경별 차이
]

# Product-angle vocabulary — semantic axis the cover headline leads with.
# The cover's chosen attribute maps to one of these slugs. Used for
# analytics + variety (so the angle is recorded alongside the intent
# even when the wording pattern doesn't reference it explicitly).
ProductAngle = Literal[
    "texture_finish",
    "moisture",
    "irritation_sensitivity",
    "scent",
    "price_value",
    "size_capacity",
    "packaging_container",
    "adhesion_fit",
    "color_option",
    "skin_type",
    "routine",
    "season_environment",
    "repurchase",
    "long_term_use",
]


class CoverPlan(BaseModel):
    """The carousel cover (v2.4 — controlled-variety hook).

    v2.4 replaces v2.3's `hook_type` Literal-of-5 fixed templates with
    a composition: `(hook_intent, product_angle, wording_pattern_id)`.
    The headline is COMPOSED by the planner from a 10-intent ×
    >=5-patterns table so two products with the same signal shape
    still get visually distinct cover headlines while staying within
    the safety contract.

    Field semantics:
      * `hook_intent`: which editorial angle the cover takes (10 values)
      * `product_angle`: which product axis the headline leads with
        (texture_finish, moisture, packaging_container, ...)
      * `wording_pattern_id`: integer index into the per-intent
        wording-pattern pool. Audit-only; not user-visible. Stable
        per-product so re-running the planner produces the same cover.
      * `headline`: the composed final string (must pass safety).
      * `subline`: product/category recognition cue — `{제품 단축명}
        · 리뷰 N건`. Keep the headline short and put the product cue
        here so the cover reads as `[hook headline] / [product]`.
    """
    model_config = _BASE_CONFIG
    headline: str = Field(min_length=1, max_length=HEADLINE_MAX)
    subline: str = Field(min_length=1, max_length=SUBLINE_MAX)
    chips: list[str] = Field(min_length=1, max_length=3)
    corpus_footer: str = Field(min_length=1, max_length=CORPUS_FOOTER_MAX)
    # v2.4 — composition fields. Defaults are the safest 'data_summary'
    # / 'routine' / 0 so older v2.3 plans without these fields still
    # validate; new mock + LLM plans must set them explicitly.
    hook_intent: CoverHookIntent = Field(default="data_summary")
    product_angle: ProductAngle = Field(default="routine")
    wording_pattern_id: int = Field(default=0, ge=0, le=99)

    @field_validator("chips")
    @classmethod
    def _chip_lengths(cls, v: list[str]) -> list[str]:
        for c in v:
            if not c or len(c) > CHIP_MAX:
                raise ValueError(
                    f"chip {c!r} exceeds budget (1..{CHIP_MAX} chars)"
                )
        return v


class OneLinerPlan(BaseModel):
    """한 줄 요약 — short, rhythmic, observational.

    Replaces the v1.x `hook` page. v2.2 densifies this slide so it
    isn't a near-empty rhythm card: the planner now emits 2–3
    `metric_pills` (short numeric anchors like `리뷰 2,029건` /
    `호평 132건` / `갈림 33건`) + an optional `framing_note` that
    explains *why this product is read this way* — replacing the
    v2.1.1 roadmap mini-nav that read like a slide-deck agenda.
    """
    model_config = _BASE_CONFIG
    headline: str = Field(min_length=1, max_length=ONE_LINER_MAX)
    sub: str = Field(min_length=1, max_length=NOTE_MAX)
    # v2.2 — 2–3 short metric anchors. Each pill ≤ METRIC_VALUE_MAX so
    # the row doesn't overflow the 1080px width.
    metric_pills: list[str] | None = Field(default=None, max_length=3)
    # v2.2 — one-line "why this product is read this way" framing.
    # Replaces the v2.1.1 roadmap mini-nav.
    framing_note: str | None = Field(default=None, max_length=SUBLINE_MAX)

    @field_validator("metric_pills")
    @classmethod
    def _metric_pill_lengths(
        cls, v: list[str] | None,
    ) -> list[str] | None:
        if v is None:
            return v
        for p in v:
            if not p or len(p) > METRIC_VALUE_MAX:
                raise ValueError(
                    f"one_liner.metric_pills[] {p!r} exceeds budget "
                    f"(1..{METRIC_VALUE_MAX} chars)"
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


class WhyDividesPlan(BaseModel):
    """Interpretation slide for THE top divide.

    Names the axis (or 1–3 axes) the split runs on — `사용 환경`,
    `피부 타입`, `기대 사용감`, `루틴 위치`, etc. Layout owns the
    'WHY 갈렸나' structural label; the planner owns the *content* of
    each axis line.

    v2.2 — each axis now pairs with a one-line `왜` explanation
    (`axis_whys[i]` corresponds to `axes[i]`). Older plans without
    `axis_whys` still validate; the layout falls back to a neutral
    paraphrase derived from `note` so the page never reads as a bare
    bullet list.
    """
    model_config = _BASE_CONFIG
    attribute_key: str = Field(min_length=1, max_length=64)
    headline: str = Field(min_length=1, max_length=HEADLINE_MAX)
    axes: list[str] = Field(min_length=1, max_length=3)
    # v2.2 — same length as `axes`, one explanatory line per axis.
    # Optional for backward compat with v2.1 plans.
    axis_whys: list[str] | None = Field(default=None, max_length=3)
    note: str = Field(min_length=1, max_length=NOTE_MAX)

    @field_validator("axes")
    @classmethod
    def _axis_lengths(cls, v: list[str]) -> list[str]:
        for a in v:
            if not a or len(a) > AXIS_MAX:
                raise ValueError(
                    f"why_divides.axes[] {a!r} exceeds budget "
                    f"(1..{AXIS_MAX} chars)"
                )
        return v

    @field_validator("axis_whys")
    @classmethod
    def _axis_why_lengths(cls, v: list[str] | None) -> list[str] | None:
        if v is None:
            return v
        for w in v:
            if not w or len(w) > ASIDE_MAX:
                raise ValueError(
                    f"why_divides.axis_whys[] {w!r} exceeds budget "
                    f"(1..{ASIDE_MAX} chars)"
                )
        return v


class SignaturePlan(BaseModel):
    """The editorial pull-quote page.

    `attribute_key` is intentionally a free-form string (NOT an enum)
    so the planner can use a non-canonical attribute key when an LLM
    surfaces a different cluster than the 12 canonical Phase 2E keys.
    Tests cover the unknown-key path explicitly.

    `who_should_check` MUST end in '분' — buyer-profile sentence, not
    a category tag. `why_it_matters` must explain buyer/use context
    (semantic check is in the prompt; schema enforces budget only)."""
    model_config = _BASE_CONFIG
    attribute_key: str = Field(min_length=1, max_length=64)
    title: str = Field(min_length=1, max_length=TITLE_MAX)
    headline: str = Field(min_length=1, max_length=HEADLINE_MAX)
    lead: str = Field(min_length=1, max_length=LEAD_MAX)
    why_it_matters: str = Field(min_length=1, max_length=ASIDE_MAX)
    who_should_check: str = Field(min_length=1, max_length=ASIDE_MAX)

    @field_validator("who_should_check")
    @classmethod
    def _who_should_check_ends_with_bun(cls, v: str) -> str:
        if not _ends_with_bun(v):
            raise ValueError(
                f"signature.who_should_check must be a sentence ending in "
                f"'분', got {v!r}"
            )
        return v


class CheckpointsPlan(BaseModel):
    """1–2 checkpoint slides, ONE focused message per slide.

    NEVER padded with corpus-generic advice when product signals are
    thin — empty slides are not produced; the carousel just runs
    shorter.

    v2.2 — the upper bound dropped from 3 to 2 (per consumer-feedback
    review): 3-slide checkpoint runs felt sparse on Instagram. With
    `caution_spotlights` (0..4 deeper pages) carrying the heavy
    interpretation, 1–2 quick-tip slides is the right density."""
    model_config = _BASE_CONFIG
    slides: list[CheckpointSlide] = Field(min_length=1, max_length=2)


class FitPlan(BaseModel):
    """잘 맞는 분 — buyer-profile sentences (≥2)."""
    model_config = _BASE_CONFIG
    headline: str = Field(min_length=1, max_length=HEADLINE_MAX)
    items: list[FitItem] = Field(min_length=2, max_length=4)


class ConsiderPlan(BaseModel):
    """신중하게 볼 분 — concrete buyer-profile sentences (≥2).

    Concreteness is a prompt-level rule (skin type / use behavior /
    expectation), not a schema keyword check, so good copy can't
    false-fail on a missing token. The schema only enforces
    sentence-form (`분` ending) and item count."""
    model_config = _BASE_CONFIG
    headline: str = Field(min_length=1, max_length=HEADLINE_MAX)
    items: list[ConsiderItem] = Field(min_length=2, max_length=4)


class SummaryPlan(BaseModel):
    """한 장 정리 — judgment-frame summary (v2.3).

    v2.3 reshapes summary from "앞 장 재나열" to "최종 판단 프레임":

      * `one_liner_conclusion` (NEW, optional ≤TAKEAWAY_MAX chars) —
        a single-sentence "한 줄 결론" rendered above the check list.
        Synthesizes the strongest combined signal (loved + caution) so
        the reader can read just this line and walk away with the call.
        Optional for backward compat with v2.2 plans; new plans should
        always set it.
      * `takeaways` — REPURPOSED. v2.3 plans should populate this with
        2..4 short "구매 전 볼 것" pre-purchase check questions
        (e.g. `1. 매일 쓸 용도인지`). Older v2.2 plans that populated
        this with summary-of-prior-pages still validate; the prompt
        now instructs new plans to write check questions.
      * `closing_note` — REPURPOSED. v2.3 plans should populate this
        with a "소비자 판단 유도 문장" (e.g. "본인 사용 환경 한 가지로
        좁혀 보세요"), NOT a verdict. Same budget as v2.2.

    The schema does NOT enforce the semantic shift — the prompt does.
    This keeps backward compat with already-shipped plans while letting
    the renderer surface `one_liner_conclusion` when present."""
    model_config = _BASE_CONFIG
    headline: str = Field(min_length=1, max_length=HEADLINE_MAX)
    one_liner_conclusion: str | None = Field(
        default=None, max_length=TAKEAWAY_MAX,
    )
    takeaways: list[str] = Field(min_length=2, max_length=4)
    closing_note: str = Field(min_length=1, max_length=CLOSING_NOTE_MAX)

    @field_validator("takeaways")
    @classmethod
    def _takeaway_lengths(cls, v: list[str]) -> list[str]:
        for t in v:
            if not t or len(t) > TAKEAWAY_MAX:
                raise ValueError(
                    f"summary.takeaways[] {t!r} exceeds budget "
                    f"(1..{TAKEAWAY_MAX} chars)"
                )
        return v


class PositiveSpotlightPlan(BaseModel):
    """Deep-dive interpretation of one repeated-praise attribute.

    Distinct from `loved` (which lists top-3 strengths in one slide):
    a positive_spotlight is ONE attribute per page with editorial
    framing of WHY reviewers liked it and WHO benefits.

    `attribute_key` is intentionally free-form (NOT enum-bound) so
    LLM-surfaced non-canonical clusters work without a schema bump.

    `who_benefits` MUST end in `분` (buyer-profile sentence). The
    other free-text fields are budget-checked only — semantic rules
    (no efficacy framing, no copy-paste of `loved.items[].note`,
    paragraphs end with `…었어요` etc.) live in the prompt.
    """
    model_config = _BASE_CONFIG
    attribute_key: str = Field(min_length=1, max_length=64)
    headline: str = Field(min_length=1, max_length=HEADLINE_MAX)
    count: str = Field(min_length=1, max_length=COUNT_MAX)
    what_reviewers_liked: str = Field(min_length=1, max_length=NOTE_MAX)
    why_it_matters: str = Field(min_length=1, max_length=ASIDE_MAX)
    who_benefits: str = Field(min_length=1, max_length=ASIDE_MAX)

    @field_validator("who_benefits")
    @classmethod
    def _who_benefits_ends_with_bun(cls, v: str) -> str:
        if not _ends_with_bun(v):
            raise ValueError(
                f"positive_spotlight.who_benefits must end in '분', got {v!r}"
            )
        return v


class CautionSpotlightPlan(BaseModel):
    """Deep-dive interpretation of one repeated-caution attribute.

    Distinct from `checkpoint` (one-message tip per slide): a
    caution_spotlight names the **likely buyer/use context that
    explains the split** plus a behavioral check-before-buy. Heavier
    interpretation than a checkpoint, lighter than a `signature`.

    Spotlight + checkpoint should not double up on the same attribute
    in mock; LLM mode is encouraged to pick distinct attributes too.
    """
    model_config = _BASE_CONFIG
    attribute_key: str = Field(min_length=1, max_length=64)
    headline: str = Field(min_length=1, max_length=HEADLINE_MAX)
    split_signal: str = Field(min_length=1, max_length=COUNT_MAX)
    likely_context: str = Field(min_length=1, max_length=ASIDE_MAX)
    check_before_buy: str = Field(min_length=1, max_length=ASIDE_MAX)
    # v2.1.1 — body interpretation card (optional). Added so the
    # caution_spotlight page mirrors positive_spotlight's chip+headline+
    # body+aside-pair shape instead of the previous chip+headline+
    # aside-pair-only shape that left the page bottom-empty.
    # LLM-mode is encouraged to fill this with a product-specific
    # one-paragraph reading; mock fills with a safe neutral fallback.
    interpretation: str | None = Field(default=None, max_length=LEAD_MAX)


class InsightSpotlightPlan(BaseModel):
    """Cross-cut interpretation page on one buyer-context dimension.

    Where `why_divides` lists 1–3 axes the top divide runs on (sketchy
    by design), an insight_spotlight zooms into ONE buyer-context
    angle (option / use-case / skin-type / season) and writes a short
    interpretation paragraph + buyer-profile recommendation.

    Used to expand the carousel toward 10–20 pages WITHOUT padding
    with corpus-generic advice — every spotlight is grounded in a
    specific product signal.
    """
    model_config = _BASE_CONFIG
    headline: str = Field(min_length=1, max_length=HEADLINE_MAX)
    signal_count: str = Field(min_length=1, max_length=COUNT_MAX)
    interpretation: str = Field(min_length=1, max_length=LEAD_MAX)
    who_should_check: str = Field(min_length=1, max_length=ASIDE_MAX)

    @field_validator("who_should_check")
    @classmethod
    def _who_should_check_ends_with_bun(cls, v: str) -> str:
        if not _ends_with_bun(v):
            raise ValueError(
                f"insight_spotlight.who_should_check must end in '분', "
                f"got {v!r}"
            )
        return v


class CtaPlan(BaseModel):
    """Single primary CTA + (v2.2) supporting micro-actions.

    `type` names the primary call-to-action:
      * `comment_next_product` (default) — invite a comment with the
        next product to analyze.
      * `save_for_later` — invite saving the carousel.

    v2.2 adds an optional `actions` list — short, concrete Instagram
    operating actions like `다시 보려면 저장`, `도움이 됐다면 좋아요·팔로우`,
    `다음에 보고 싶은 제품은 댓글`. The primary call (encoded by `type`
    + `body`) stays the editorial centerpiece; `actions` enriches the
    slide so it doesn't feel sparse and so save / like / follow / comment
    invitations can coexist.

    `disclosure` absorbs the methodology disclaimer that used to live
    on the standalone `method` slide so the basis stays visible without
    a dedicated slide breaking the rhythm."""
    model_config = _BASE_CONFIG
    type: Literal["comment_next_product", "save_for_later"]
    headline: str = Field(min_length=1, max_length=HEADLINE_MAX)
    body: str = Field(min_length=1, max_length=BULLET_MAX + 20)
    # v2.2 — supporting Instagram actions (save / like / comment).
    # 1..3 short sentences; each ≤ ASIDE_MAX. Optional for
    # backward compat with v2.1 plans.
    actions: list[str] | None = Field(default=None, max_length=3)
    disclosure: str = Field(min_length=1, max_length=DISCLOSURE_MAX)

    @field_validator("actions")
    @classmethod
    def _action_lengths(cls, v: list[str] | None) -> list[str] | None:
        if v is None:
            return v
        for a in v:
            if not a or len(a) > ASIDE_MAX:
                raise ValueError(
                    f"cta.actions[] {a!r} exceeds budget "
                    f"(1..{ASIDE_MAX} chars)"
                )
        return v


# ---------------------------------------------------------------------------
# Top-level
# ---------------------------------------------------------------------------


class ContentPlan(BaseModel):
    """The full consumer-facing cardnews copy plan (v2.1).

    Single source of truth for every Korean string that ends up on a
    rendered page (modulo structural labels added by the layout — chips
    like '구매 전 체크포인트' — which are layout-owned, not editorial).

    Section order in this model mirrors the rendered carousel order:
    cover → one_liner → loved → positive_spotlights? → divides →
    why_divides? → caution_spotlights? → insight_spotlights? →
    signature → checkpoints? → fit → consider → summary → cta.

    Optional sections (`why_divides`, `checkpoints`, all spotlights)
    are produced ONLY when product-specific signals support them.
    They are NEVER padded with corpus-generic advice — the carousel
    just runs shorter (down to a 9-page floor for genuinely-thin
    corpora; rich corpora expand toward 20 pages)."""
    model_config = _BASE_CONFIG

    schema_version: str = Field(default="2.2")
    language: Literal["ko"] = "ko"

    cover: CoverPlan
    one_liner: OneLinerPlan
    loved: LovedPlan
    # 0–3 deep-dive pages on top loved attributes. Each is one
    # attribute's "why reviewers liked it / who benefits" interpretation.
    positive_spotlights: list[PositiveSpotlightPlan] | None = Field(
        default=None,
        description="0..3 deep-dive pages on top loved attributes",
    )
    divides: DividesPlan
    # Optional — only present when divides exists. The user mandate is
    # "no empty slides, no generic advice fillers" — when there's no
    # actual divide to interpret, the section is dropped entirely.
    why_divides: WhyDividesPlan | None = None
    # 0–4 deep-dive pages on top caution attributes. Each names the
    # likely-context that splits the signal + a check-before-buy
    # behavior. Distinct attribute set from `checkpoints` to avoid
    # narrative repetition.
    caution_spotlights: list[CautionSpotlightPlan] | None = Field(
        default=None,
        description="0..4 deep-dive pages on top caution attributes",
    )
    # 0–3 cross-cut buyer-context interpretation pages (option /
    # use-case / skin-type / season).
    insight_spotlights: list[InsightSpotlightPlan] | None = Field(
        default=None,
        description="0..3 cross-cut buyer-context interpretation pages",
    )
    signature: SignaturePlan
    # Optional — only present when product-specific caution signals
    # exist. Per user contract: 1..3 slides when present, NEVER padded
    # with corpus-generic advice. Absent means the carousel skips
    # checkpoints and runs shorter (10–20 expandable narrative).
    checkpoints: CheckpointsPlan | None = None
    fit: FitPlan
    consider: ConsiderPlan
    summary: SummaryPlan
    cta: CtaPlan

    @field_validator("positive_spotlights")
    @classmethod
    def _positive_spotlights_bounds(
        cls, v: list[PositiveSpotlightPlan] | None,
    ) -> list[PositiveSpotlightPlan] | None:
        if v is None:
            return v
        if not (1 <= len(v) <= 3):
            raise ValueError(
                f"positive_spotlights must have 1..3 items when present, "
                f"got {len(v)}"
            )
        return v

    @field_validator("caution_spotlights")
    @classmethod
    def _caution_spotlights_bounds(
        cls, v: list[CautionSpotlightPlan] | None,
    ) -> list[CautionSpotlightPlan] | None:
        if v is None:
            return v
        if not (1 <= len(v) <= 4):
            raise ValueError(
                f"caution_spotlights must have 1..4 items when present, "
                f"got {len(v)}"
            )
        return v

    @field_validator("insight_spotlights")
    @classmethod
    def _insight_spotlights_bounds(
        cls, v: list[InsightSpotlightPlan] | None,
    ) -> list[InsightSpotlightPlan] | None:
        if v is None:
            return v
        if not (1 <= len(v) <= 3):
            raise ValueError(
                f"insight_spotlights must have 1..3 items when present, "
                f"got {len(v)}"
            )
        return v
