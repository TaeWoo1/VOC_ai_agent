"""Phase 2E Stage 2 — LLM-based polarity classification.

Given a Stage 1 attribute candidate (`review_id`, `attribute`, `matched_text`)
and the source review text, this stage classifies the polarity / intensity
of that attribute mention in the narrow clause around the match.

Architecture: per `docs/phase2e_detector_design.md` §6. Uses OpenAI
`gpt-4o-mini` by default (similar cost tier to the design doc's recommended
Claude Haiku 4.5). Pluggable via the `PolarityClassifier` Protocol — a
deterministic stub classifier is provided for offline development and
regression testing.

LLM scope discipline (per task instructions):
  - Input to LLM is the SENTENCE/CLAUSE around the matched anchor, not the
    full review. Maximum context window per call: 320 chars.
  - Output schema is structured JSON, validated against allowed enums.
  - Records that fail schema validation are dropped (not coerced).

This module is OUTSIDE the v1.13 chain. It does NOT modify v1.13
lexicons or detector and does NOT modify Stage 1.
"""
from __future__ import annotations

import json
import os
import re
from dataclasses import dataclass, field, asdict
from typing import Protocol, runtime_checkable


# ---------------------------------------------------------------------------
# Output schema
# ---------------------------------------------------------------------------

ALLOWED_POLARITIES = (
    "positive", "negative_weak", "negative_strong", "mixed", "neutral", "ambiguous",
)
ALLOWED_INTENSITY = (1, 2, 3)
ALLOWED_CONFIDENCE = ("high", "medium", "low")


# ---------------------------------------------------------------------------
# Prompt versioning
# ---------------------------------------------------------------------------
#
# Two prompt variants ship side-by-side. The default remains v1 so
# pipeline runs are unchanged; v2 is opt-in via the evaluator's
# `--prompt-version` flag and ships as the production default only
# after directional improvement is shown on the seed eval.
#
# Cache discipline: OpenAIClassifier's cache key includes
# `prompt_version` so v1 and v2 entries never collide. A v2 replay
# does not invalidate or overwrite v1 cached responses.

PROMPT_VERSION_V1_BASELINE: str = "v1_makeup_focused"
PROMPT_VERSION_V2_SKINCARE: str = "stage2_polarity_v2_skincare_sentiment"
ALLOWED_PROMPT_VERSIONS: tuple[str, ...] = (
    PROMPT_VERSION_V1_BASELINE,
    PROMPT_VERSION_V2_SKINCARE,
)
# Production default flipped 2026-05-01 after the 42-row seed replay
# (`outputs/eval/phase2e_classification_replay_20260501T084143Z.{json,md}`)
# showed coarse accuracy 0.475 → 0.786, seller-surface risk 16 → 0,
# positive recall 0.481 → 0.893, and zero wrong-direction regressions
# (the 2 row-level regressions were fail-safe drops).
#
# v1 remains available via the `prompt_version` kwarg for replay /
# regression testing. Mixed-class F1 is unchanged at 0 — that's a
# Phase 4.3 problem (selective verifier).
DEFAULT_PROMPT_VERSION: str = PROMPT_VERSION_V2_SKINCARE


@dataclass(frozen=True)
class PolarityRecord:
    attribute: str
    polarity: str
    intensity: int
    evidence_span: str
    confidence: str
    drop: bool = False
    rationale: str = ""

    def to_dict(self) -> dict:
        return asdict(self)


# ---------------------------------------------------------------------------
# Clause extraction — narrow-context window for LLM
# ---------------------------------------------------------------------------

_CLAUSE_BOUNDARIES = re.compile(
    r"(?<=[.!?…])\s+|"
    r"(?<=지만)|(?<=한데)|(?<=다만\s)|"
    r"(?<=그래도\s)|(?<=근데\s)|(?<=하지만\s)"
)


def extract_clause(review_text: str, anchor: str, max_chars: int = 320) -> str:
    """Return a narrow clause-window around `anchor` from `review_text`.

    Splits on Korean clause boundaries, returns the clause containing the
    anchor (extended with one neighbor on each side if very short). Capped
    at `max_chars`.
    """
    if not review_text or not anchor:
        return review_text or ""
    # Find anchor position
    idx = review_text.find(anchor)
    if idx < 0:
        # Fall back to whole text up to max_chars
        return review_text[:max_chars]
    # Heuristic: take a window of max_chars centered on anchor
    half = max_chars // 2
    start = max(0, idx - half)
    end = min(len(review_text), idx + len(anchor) + half)
    snippet = review_text[start:end].replace("\n", " ").replace("\r", " ").strip()
    snippet = re.sub(r"\s+", " ", snippet)
    if start > 0:
        snippet = "…" + snippet
    if end < len(review_text):
        snippet = snippet + "…"
    return snippet


# ---------------------------------------------------------------------------
# W1+W2 narrow-window extractor (v0.3 — Stage 2 v0.3 prompt-locked, window-tuned)
# ---------------------------------------------------------------------------
#
# Replaces the fixed-character window with a content-aware extractor:
#   W1: if evidence_span is self-contained (has an evaluative marker), use it
#       directly. Avoids bleed-in from neighboring attribute clauses.
#   W2: otherwise, split review_text on clause boundaries and return the
#       shortest clause containing the evidence_span.
#   Fallback: if evidence_span cannot be located, use 80-char window via
#       extract_clause.
#
# Per `docs/phase2e_stage2_v0.2_comparison.md` Recommendation §9 (Option A).
# ---------------------------------------------------------------------------

EVALUATIVE_MARKERS: frozenset[str] = frozenset({
    # positive sentiment
    "좋", "예쁘", "이쁘", "이뿌", "이뻐", "이쁜",
    "부드럽", "잘 ", "잘발", "잘펴", "만족", "추천", "찰떡",
    # negative sentiment
    "아쉬", "별로", "약하", "옅", "진해서", "진하", "연하",
    "불편", "구려", "떨어", "더러", "더럽",
    # functional defect verbs
    "벗겨", "묻어", "지워", "밀림", "밀려", "뭉침", "뭉쳐",
    "끈적", "퍼석", "건조", "텁텁", "각질",
    "샜", "깨졌", "깨질", "망가", "이상",
})

# Clause-boundary delimiters. Sentence-end punctuation, Korean review
# bullet/list markers, and explicit conjunction words.
_CLAUSE_BOUNDARY_RE = re.compile(
    # punctuation / list markers / sentence-end fillers
    r"[.!?…ㅠㅜ]+|"
    r"[\-•★]|"
    r"✔️|🏷|"
    # conjunction words (boundary AFTER the word)
    r"(?<=하지만)\s|(?<=다만)\s|(?<=근데)\s|(?<=그런데)\s|(?<=반면)\s|(?<=대신)\s"
)


def _has_evaluative_marker(text: str) -> bool:
    return any(m in text for m in EVALUATIVE_MARKERS)


def _split_clauses(review_text: str) -> list[tuple[int, int, str]]:
    """Split review_text into clauses using `_CLAUSE_BOUNDARY_RE`.

    Returns list of `(start_idx, end_idx, clause_text)` tuples covering the
    whole review. Empty clauses are filtered out.
    """
    if not review_text:
        return []
    spans: list[tuple[int, int, str]] = []
    last = 0
    for m in _CLAUSE_BOUNDARY_RE.finditer(review_text):
        end = m.start()
        if end > last:
            chunk = review_text[last:end].strip()
            if chunk:
                spans.append((last, end, chunk))
        last = m.end()
    if last < len(review_text):
        chunk = review_text[last:].strip()
        if chunk:
            spans.append((last, len(review_text), chunk))
    return spans


def extract_narrow_clause(
    review_text: str,
    evidence_span: str,
    max_chars: int = 80,
) -> str:
    """W1+W2 narrow-window extractor for Stage 2.

    Args:
      review_text: the full review.
      evidence_span: the seed/Stage-1 evidence_span (acts as anchor + content).
      max_chars: fallback window size when both W1 and W2 don't apply.

    Behavior:
      - W1: if `evidence_span` already contains an evaluative marker, return
        the evidence_span (after stripping leading/trailing whitespace and
        ellipsis markers). No expansion. This avoids bleed-in.
      - W2: otherwise, split `review_text` on clause boundaries and return
        the SHORTEST clause that contains the `evidence_span`. If none
        found, fall through.
      - Fallback: a fixed 80-char window via `extract_clause`.
    """
    span = (evidence_span or "").lstrip("…").rstrip("…").strip()
    if not span:
        return (review_text or "")[:max_chars]

    # W1
    if _has_evaluative_marker(span):
        return span

    # W2
    if review_text and span in review_text:
        clauses = _split_clauses(review_text)
        candidates = [c for c in clauses if span in c[2]]
        if candidates:
            # Pick shortest containing clause
            candidates.sort(key=lambda x: len(x[2]))
            chosen = candidates[0][2]
            # If the chosen clause exceeds max_chars*2, prefer narrowing
            # back to a fixed window centered on the span.
            if len(chosen) <= max_chars * 2:
                return chosen

    # Fallback: 80-char window centered on the span
    return extract_clause(review_text, span[:30] if len(span) > 30 else span, max_chars=max_chars)


# ---------------------------------------------------------------------------
# Prompt builder
# ---------------------------------------------------------------------------


_SCHEMA_REFERENCE_V1 = """\
Polarity values (choose exactly one):
- positive: reviewer expresses satisfaction with this attribute
- negative_weak: mild complaint or unmet preference (markers: 아쉬, 별로, 약하, 옅, 좀 ~한 편)
- negative_strong: strong complaint or purchase blocker (markers: 다신 안, 절대 비추, 너무 ~해서 못, 자극이 심해서)
- mixed: ONLY when the SAME clause contains BOTH an explicit positive AND an explicit negative on the SAME attribute (e.g., 촉촉한데 끈적여요 → finish_texture: 촉촉=positive, 끈적=negative). The conjunction marker '~지만' / '~한데' / '다만' alone is NOT enough — there must be opposing evaluative content on the same attribute.
- neutral: attribute mentioned descriptively, no evaluation at all
- ambiguous: genuinely unclear after re-reading; prefer this over forcing a polarity guess

Intensity scale (independent of polarity):
- 1 = mild mention / weak preference / minor caveat (markers: 좀, 약간, 살짝, 조금)
- 2 = clear positive or negative (default; no special markers needed)
- 3 = strong praise or strong issue (markers: 너무, 진짜, 완전, 정말, 최악, 다신, 절대)
- IMPORTANT: a *functional defect* — `밀림` (sliding off), `벗겨짐` (lift-off), `지워짐` (rub-off), `다 묻어` (full transfer), `깨졌` (broken), `샜` (leaked), `안 발려` (won't apply) — is intensity ≥ 2 EVEN WITHOUT an intensifier. The defect itself carries the intensity.

Confidence:
- high: text strongly supports the polarity decision
- medium: text supports but with some interpretive judgment
- low: ambiguous; prefer dropping or use polarity=ambiguous

Polarity rules:
- A high rating (5★) with explicit attribute caveat: extract the caveat as negative_*. Do NOT suppress.
- Korean noun-phrase praise IS evaluation. Phrases like `예쁜 색`, `부드러운 발림`, `톤다운된 예쁜 로즈빛`, `부드럽게 발립니당` contain inline sentiment markers (예쁜, 부드러운, 부드럽게) — classify as `positive`. Do NOT set drop=true on these. Only set drop=true if the clause has zero evaluative content (e.g., `리퀴드 타입이에요`, `퍼프가 같이 와요`).
- Mixed polarity is RARE. Default to single polarity. Only use `mixed` when you can quote BOTH a positive marker AND a negative marker, both clearly about the SAME attribute, both in the same clause. A reviewer expressing mild reservation (`반나절 정도?`, `중 정도`) on an otherwise praised attribute is `positive` (with optional intensity 1), not `mixed`.
- Cross-attribute trade-off: stage 3 handles, you only classify ONE attribute here.
- Generic disappointment ('기대보다 못 미쳐서') with no attribute attachment: set drop=true.
- Sheer-as-feature praise (은은해서 좋아요): pigmentation positive (NOT negative_weak)
- Sheer-as-defect complaint (너무 연해서 아쉬워요): pigmentation negative_weak
- Strong pigment praised but control issue (양조절): if you're classifying pigmentation here, return positive; if classifying application_blending, return negative_weak

When to set drop=true:
- The clause contains NO evaluative markers at all (no 좋/예쁜/잘/별로/아쉬/약하/etc.)
- The clause is generic disappointment with no attribute reference
- The clause is purely descriptive (e.g., a feature listing without judgment)

When NOT to set drop=true:
- Noun-phrase praise (`예쁜 색상`, `부드러운 질감`, `예쁜 발색`) — these ARE positive
- Adverbial praise (`부드럽게 발려요`, `잘 펴져요`) — these ARE positive
- Mild reservation framed as relative comparison (`예상보다는 좋았어요`) — this IS positive
"""

_FEW_SHOT_EXAMPLES_V1 = """\
Examples (reviewers' Korean → schema records):

Example 1 — clean positive
clause: "발색이 너무 좋아요"
attribute: pigmentation
output: {"polarity": "positive", "intensity": 3, "evidence_span": "발색이 너무 좋아요", "confidence": "high", "drop": false, "rationale": "clean praise with intensity-3 marker '너무'"}

Example 2 — clean negative_weak
clause: "발색도 약하구요"
attribute: pigmentation
output: {"polarity": "negative_weak", "intensity": 2, "evidence_span": "발색도 약하구요", "confidence": "high", "drop": false, "rationale": "clear weak-pigment complaint"}

Example 3 — sheer-as-feature
clause: "은은해서 좋아요"
attribute: pigmentation
output: {"polarity": "positive", "intensity": 2, "evidence_span": "은은해서 좋아요", "confidence": "high", "drop": false, "rationale": "sheer-as-feature framing; reviewer wants natural finish"}

Example 4 — sheer-as-defect
clause: "너무 연해서 아쉬워요"
attribute: pigmentation
output: {"polarity": "negative_weak", "intensity": 2, "evidence_span": "너무 연해서 아쉬워요", "confidence": "high", "drop": false, "rationale": "sheer-as-defect framing; '아쉬' soft-negative marker"}

Example 5 — TRUE mixed (rare; both polarities on same attribute, same clause)
clause: "촉촉한데 끈적이고 머리카락 붙어요"
attribute: finish_texture
output: {"polarity": "mixed", "intensity": 2, "evidence_span": "촉촉한데 끈적이고 머리카락 붙어요", "confidence": "high", "drop": false, "rationale": "single attribute self-contradiction: praises 촉촉 (positive), complains 끈적/머리카락 붙 (negative); both on finish_texture"}

Example 6 — dryness complaint despite matte praise
clause: "보송하지만 건조하고 퍼석해요"
attribute: dryness_skin_texture
output: {"polarity": "negative_weak", "intensity": 2, "evidence_span": "건조하고 퍼석해요", "confidence": "high", "drop": false, "rationale": "explicit dryness complaint; for dryness attribute the polarity is negative (the matte praise is on finish_texture, a different attribute)"}

Example 7 — cross-attribute split
clause: "발색은 진짜 좋은데 양조절이 어려워요"
attribute: application_blending
output: {"polarity": "negative_weak", "intensity": 2, "evidence_span": "양조절이 어려워요", "confidence": "high", "drop": false, "rationale": "control complaint; pigmentation praise is on a different attribute, not relevant here"}

Example 8 — functional defect = intensity ≥ 2
clause: "마스크에 다 묻어나요"
attribute: transfer_resistance
output: {"polarity": "negative_strong", "intensity": 2, "evidence_span": "마스크에 다 묻어나요", "confidence": "high", "drop": false, "rationale": "explicit transfer failure; '다 묻어나요' is functional defect → intensity 2 even without literal intensifier"}

Example 9 — bare descriptive mention → drop
clause: "퍼프가 같이 와요"
attribute: applicator_tool
output: {"polarity": "neutral", "intensity": 1, "evidence_span": "", "confidence": "low", "drop": true, "rationale": "bare descriptive mention, no evaluative marker (no 좋/별로/불편/etc.)"}

Example 10 — soft-negative
clause: "지속력이 좀 아쉬워요"
attribute: persistence
output: {"polarity": "negative_weak", "intensity": 1, "evidence_span": "지속력이 좀 아쉬워요", "confidence": "high", "drop": false, "rationale": "soft-negative '좀' + '아쉬' → intensity 1"}

Example 11 — noun-phrase praise IS positive (do NOT drop)
clause: "톤다운된 예쁜 로즈빛"
attribute: color_tone_matching
output: {"polarity": "positive", "intensity": 2, "evidence_span": "톤다운된 예쁜 로즈빛", "confidence": "high", "drop": false, "rationale": "noun-phrase praise — '예쁜' is an evaluative marker; this is positive on color, not descriptive"}

Example 12 — adverbial praise IS positive (do NOT drop)
clause: "부드럽게 발립니당"
attribute: application_blending
output: {"polarity": "positive", "intensity": 2, "evidence_span": "부드럽게 발립니당", "confidence": "high", "drop": false, "rationale": "'부드럽게' is positive evaluation of application; do not treat as descriptive"}

Example 13 — counter-example: '~지만' alone is NOT mixed
clause: "예상보다는 좋았어요 지속력 중 정도?"
attribute: persistence
output: {"polarity": "positive", "intensity": 1, "evidence_span": "예상보다는 좋았어요", "confidence": "medium", "drop": false, "rationale": "relative-comparison praise ('예상보다는 좋았어요'); '중 정도?' is mild reservation but not an explicit negative; this is positive intensity 1, NOT mixed"}

Example 14 — counter-example: caveat marker without explicit negative on same attribute
clause: "촉촉한 타입이라 지속력이 안좋을 거라 생각했는데 예상보다는 좋았어요"
attribute: persistence
output: {"polarity": "positive", "intensity": 2, "evidence_span": "예상보다는 좋았어요", "confidence": "medium", "drop": false, "rationale": "the '~데' caveat marker contrasts EXPECTATION vs reality; the actual evaluation is positive ('예상보다는 좋았어요'). Not mixed."}

Example 15 — counter-example: implicit packaging praise (no explicit 케이스 noun)
clause: "들고 다니기 딱 좋은 사이즈"
attribute: packaging_container
output: {"polarity": "positive", "intensity": 2, "evidence_span": "들고 다니기 딱 좋은 사이즈", "confidence": "high", "drop": false, "rationale": "portability praise via '딱 좋은' even without explicit packaging noun; positive on packaging"}

Example 16 — functional defect (no intensifier, still intensity 2)
clause: "베이스를 벗겨냅니다"
attribute: adhesion_base_interaction
output: {"polarity": "negative_strong", "intensity": 2, "evidence_span": "베이스를 벗겨냅니다", "confidence": "high", "drop": false, "rationale": "functional defect '벗겨' (base lift-off); intensity ≥2 even without literal intensifier"}
"""


# ---------------------------------------------------------------------------
# v2 prompt — skincare-sentiment-aware
# ---------------------------------------------------------------------------
#
# Designed against the 2026-05-01 seed eval (42 rows). The dominant
# Stage 2 v1 failure mode was `positive_as_negative` on skincare
# spans where the reviewer self-reports a positive feel (촉촉,
# 진정되는 느낌, 쫀쫀하게, 탄탄해진 느낌) and v1 classified the
# clause as negative_weak. v2 adds:
#   - explicit "topic words are NOT polarity" section
#   - skincare-positive sentiment cheatsheet
#   - concession-marker handling rules (~지만, ~한데)
#   - neutral / context-missing escape valve so the model has an
#     out other than guessing negative_weak
#   - medical-claim discipline ("self-reported feel is positive
#     sentiment"; downstream layer paraphrases banned tokens)
#
# JSON output schema is byte-identical to v1 — parse_response()
# does not need to change.

_SCHEMA_REFERENCE_V2 = """\
You classify the polarity of one Korean cosmetic-review attribute.

The product can be SKINCARE (pads, toners, ampoules, masks) or
MAKEUP (lips, cheeks, base, eye). Treat both domains with the same
discipline. The single most common Stage 2 failure mode is calling
positive skincare sentiment as `negative_weak` — read the actual
sentiment, not just the topic words.

Polarity values (choose exactly one):
- positive: reviewer expresses satisfaction with this attribute. Includes the reviewer's own self-reported feel.
- negative_weak: a REAL complaint, friction, unmet expectation, or drawback the reviewer voices about THIS attribute. Soft markers: 아쉬, 별로, 약하, 옅, 좀 ~한 편, 불편, 짜증, 후회.
  → CRITICAL: do NOT label negative just because the clause mentions a skin concern (모공, 건조, 자극, 피부결) or attribute term (촉촉, 마무리, 밀착, 답답). Those are TOPIC words, not sentiment.
- negative_strong: strong complaint or purchase blocker. Markers: 다신 안, 절대 비추, 자극이 심해서 환불, 트러블, 최악, 비추.
- mixed: the SAME clause contains BOTH explicit praise AND explicit complaint on the SAME attribute (e.g., "촉촉하긴 한데 답답해요" for finish_texture). Cross-attribute praise/complaint is NOT mixed — classify ONLY the attribute you were asked about.
- neutral: attribute mentioned descriptively, no evaluation at all. Set drop=true.
- ambiguous: genuinely unclear after re-reading; prefer this over forcing a polarity guess.

Intensity scale:
- 1 = mild mention, weak preference, soft caveat (좀, 약간, 살짝, 조금)
- 2 = clear positive or negative (default)
- 3 = strong praise or strong issue (너무, 진짜, 완전, 정말, 엄청, 짱, 진심, 다신, 절대, 최악)
- A FUNCTIONAL DEFECT (밀림, 벗겨짐, 지워짐, 다 묻어, 깨졌, 샜, 안 발려, 안 닫힘, 토너 증발) is intensity ≥2 even without an intensifier.

Confidence:
- high: text strongly supports the polarity.
- medium: text supports but with some interpretive judgment.
- low: ambiguous; prefer dropping or use polarity=ambiguous.

# Korean skincare-positive sentiment cheatsheet (these are POSITIVE)

When the reviewer voices any of the following about THIS attribute, the polarity is positive:
- 촉촉하다 / 촉촉해요 / 촉촉하네요 — moisturizing
- 진정되는 느낌 / 진정돼요 / 진정된다 — calming sensation (reviewer self-report; not a medical claim)
- 쫀쫀하다 / 쫀쫀하게 / 쫀쫀해요 — bouncy / firm
- 탄탄해진 느낌 / 탄탄해진다 — firmer feeling
- 밀착이 잘된다 / 밀착도 잘됨 / 밀착이 좋아 — adheres well
- 부드럽다 / 부드럽게 — smooth, soft
- 자극 없이 순하다 / 자극 없이 / 순해요 — no irritation, gentle
- 끈적이지 않다 / 끈적이지 않고 — not sticky (negation of negative = positive)
- 잘 쓰고 있다 / 잘 쓰는 중 / 재구매 / 5통째 — habitual use, repurchase signal
- 괜찮다 / 괜찮네요 / 괜찮아요 — fine, good

# Topic words are NOT polarity by themselves

These appear in BOTH positive and negative contexts. Read the surrounding sentiment, not the topic:

| Topic | Negative example | Positive example |
|---|---|---|
| 모공 | "모공이 더 보여요" | "모공이 조여집니다" / "모공 잡아주는 느낌" |
| 건조 | "사용 후 건조해요" | "건조함도 없고" / "건조함이 줄었어요" |
| 자극 | "자극이 심해서 환불" | "자극 없이 순해요" / "자극 안 가요" |
| 피부결 | "피부결이 거칠어졌어요" | "피부결이 매끄러워요" |
| 답답 | "오래 두면 답답해요" | (rare) |
| 마무리 | "끈적한 마무리" | "쫀쫀한 마무리" / "촉촉한 마무리" |

# Concession handling (~지만, ~한데, ~인데)

- Korean reviews routinely lead with a hedge then resolve to praise: "처음엔 아쉬웠지만 ... 좋아요" → positive.
- Judge the DOMINANT clause (usually the one AFTER the concession marker).
- Both clauses praise/complain the SAME attribute → mixed.
  - "촉촉하긴 한데 답답해요" (finish_texture) → mixed
- Different attributes → classify the asked attribute only.
  - "발색은 좋은데 양조절이 어려워요" — for application_blending: negative_weak; for pigmentation: positive.
- "예상보다는 좋았어요" — concession contrasts EXPECTATION vs reality, not attribute polarity. Positive.

# Neutral / context-missing

If the clause is purely ingredient mention, routine context, or the reviewer's GENERAL skin condition with NO product evaluation, prefer neutral with drop=true. Do NOT default to negative_weak when in doubt.
- "마데카소사이드 성분이 들어있어요" — drop
- "아침 저녁으로 세안 후 사용해요" — drop (routine)
- "저는 건성인데 ..." — drop unless followed by an evaluative claim about the product
- "얼마전 제주도에서" — drop (tangential)

# Medical / efficacy

Reviewer's SELF-REPORTED feel IS positive sentiment for the report's purposes. Classify what the reviewer said:
- "진정되는 느낌이 있습니다" — positive (reviewer feels calmed)
- "흉터가 옅어지는 게 보여요" — positive (reviewer perceives improvement)

Words like 효과, 효능, 진정 in the clause are reviewer-uttered observation, not medical claims. The downstream report layer paraphrases or suppresses banned tokens; you are NOT responsible for that here. Just classify the sentiment as the reviewer expressed it.

# When to set drop=true

- The clause has NO evaluative content (no 좋/별로/아쉬/약하/만족/불편/etc.)
- Pure ingredient or routine mention.
- Tangential context.
- Reviewer's general skin condition without a product evaluation.

# When NOT to set drop=true

- Skincare-positive cheatsheet phrases above (촉촉, 진정되는 느낌, 쫀쫀, 탄탄해진 느낌, 밀착이 잘된다, 부드럽게, 자극 없이 순해요, 끈적이지 않고, 잘 쓰고 있다, 괜찮아요).
- Negation of a negative attribute (건조함도 없고, 끈적이지 않고, 자극 없이) — these ARE positive.
- Repurchase signals (재구매, 5통째, 잘 쓰는 중) — these ARE positive.
- Functional praise even without an explicit positive marker (들고 다니기 딱 좋은 사이즈) — positive.
"""

_FEW_SHOT_EXAMPLES_V2 = """\
Examples (Korean review → schema):

Example 1 — skincare-positive: 촉촉
clause: "촉촉하고 좋아도 용량도 많아서 너무 만족"
attribute: finish_texture
output: {"polarity": "positive", "intensity": 3, "evidence_span": "촉촉하고 좋아도 ... 너무 만족", "confidence": "high", "drop": false, "rationale": "촉촉 + 너무 만족 — clear positive on finish texture"}

Example 2 — skincare-positive: 진정되는 느낌 (reviewer self-report, NOT a medical claim)
clause: "마데카소사이드 성분 때문인지 사용하고 나면 피부가 촉촉하면서도 붉은기가 살짝 진정되는 느낌이 있습니다"
attribute: finish_texture
output: {"polarity": "positive", "intensity": 2, "evidence_span": "촉촉하면서도 ... 진정되는 느낌이 있습니다", "confidence": "high", "drop": false, "rationale": "촉촉하면서도 진정되는 느낌 — reviewer self-reports positive feel; 효능 claim is the downstream layer's concern, not ours"}

Example 3 — skincare-positive: 쫀쫀하게 잡아주
clause: ":) 좀 써보니까 패드가 부드럽게 밀착되면서 피부 컨디션을 쫀쫀하게 잡아주"
attribute: adhesion_base_interaction
output: {"polarity": "positive", "intensity": 2, "evidence_span": "부드럽게 밀착되면서 ... 쫀쫀하게 잡아주", "confidence": "high", "drop": false, "rationale": "부드럽게 + 밀착되면서 + 쫀쫀하게 잡아주 — three positive markers stacked; no negation, no concession"}

Example 4 — skincare-positive: 탄탄해진 느낌
clause: "꾸준히 사용하니 모공 주변 피부가 조금 더 탄탄해진 느낌"
attribute: dryness_skin_texture
output: {"polarity": "positive", "intensity": 2, "evidence_span": "탄탄해진 느낌", "confidence": "high", "drop": false, "rationale": "탄탄해진 느낌 is positive skin-firming sentiment; '꾸준히 사용하니' is routine context, not complaint"}

Example 5 — skincare-positive: 밀착도 잘되고 촉촉하네요
clause: "엄청 잘 떼져요 ㅎㅎ 얇고 쫀쫀해서 밀착도 잘되고 촉촉하네요 탄력도 조금 좋"
attribute: adhesion_base_interaction
output: {"polarity": "positive", "intensity": 3, "evidence_span": "잘 떼져요 ... 밀착도 잘되고 촉촉하네요 탄력도", "confidence": "high", "drop": false, "rationale": "엄청 + 잘 떼져요 + 쫀쫀 + 밀착도 잘되고 + 촉촉 + 탄력 — all positive; ㅎㅎ is happy emoticon"}

Example 6 — skincare-positive: 끈적이지 않고 (negation of negative)
clause: "끈적이지 않고 괜찮아요 종류별로사서 잘쓰"
attribute: finish_texture
output: {"polarity": "positive", "intensity": 2, "evidence_span": "끈적이지 않고 괜찮아요", "confidence": "high", "drop": false, "rationale": "끈적이지 않고 = negation of negative attribute = positive; 괜찮아요 + 종류별로사서 잘쓰 = repurchase signal"}

Example 7 — skincare-positive: 모공 조여집니다 (topic word ≠ negative)
clause: "꾸준히하면 모공진짜 조여집니다"
attribute: dryness_skin_texture
output: {"polarity": "positive", "intensity": 3, "evidence_span": "모공진짜 조여집니다", "confidence": "high", "drop": false, "rationale": "조여집니다 is the desired outcome for pores; 진짜 = intensity 3"}

Example 8 — skincare-positive: 자극 없이 순해요
clause: "자극 없이 순해서 데일리로 쓰기 좋아요"
attribute: dryness_skin_texture
output: {"polarity": "positive", "intensity": 2, "evidence_span": "자극 없이 순해서 ... 쓰기 좋아요", "confidence": "high", "drop": false, "rationale": "자극 없이 순해요 = positive; '자극' here is negated"}

Example 9 — clear negative_weak
clause: "도톰한데 빨리 마르는느낌이 있음- 밀착력도 아쉬움"
attribute: adhesion_base_interaction
output: {"polarity": "negative_weak", "intensity": 2, "evidence_span": "밀착력도 아쉬움", "confidence": "high", "drop": false, "rationale": "밀착력도 아쉬움 — explicit complaint"}

Example 10 — clear negative_weak with functional defect
clause: "통이 좀 마음에 안드는데 일단 뚜껑이 잘 안 닫히는 느낌이 들고 새로"
attribute: packaging_container
output: {"polarity": "negative_weak", "intensity": 2, "evidence_span": "마음에 안드는데 ... 잘 안 닫히는", "confidence": "high", "drop": false, "rationale": "마음에 안드는데 + 잘 안 닫히는 = functional defect; intensity 2 even without intensifier"}

Example 11 — negative_strong
clause: "자극이 심해서 환불했어요. 다시는 안 사요"
attribute: dryness_skin_texture
output: {"polarity": "negative_strong", "intensity": 3, "evidence_span": "자극이 심해서 환불 ... 다시는 안 사요", "confidence": "high", "drop": false, "rationale": "자극이 심해서 + 환불 + 다시는 안 사요 = strong negative purchase blocker"}

Example 12 — true mixed (same attribute, both polarities)
clause: "촉촉하긴 한데 오래 두면 답답해요"
attribute: finish_texture
output: {"polarity": "mixed", "intensity": 2, "evidence_span": "촉촉하긴 한데 ... 답답해요", "confidence": "high", "drop": false, "rationale": "촉촉(+) + 답답(-) on same finish_texture — mixed"}

Example 13 — cross-attribute (NOT mixed for the asked attribute)
clause: "가성비는 좋은데 집게가 불편해요"
attribute: value_price
output: {"polarity": "positive", "intensity": 2, "evidence_span": "가성비는 좋은데", "confidence": "high", "drop": false, "rationale": "for value_price the clause is positive; 집게 complaint belongs to packaging_container"}

Example 14 — context-only → drop
clause: "마데카소사이드 성분이라 꾸준히 사용해봤어요"
attribute: dryness_skin_texture
output: {"polarity": "neutral", "intensity": 1, "evidence_span": "", "confidence": "low", "drop": true, "rationale": "ingredient + routine context only; no product evaluation"}
"""


def _build_prompt_v1(clause: str, attribute: str) -> tuple[str, str]:
    """v1 baseline prompt (makeup-focused). Pre-2026-05-01 production."""
    system_msg = (
        "You classify the polarity of one Korean cosmetic-review attribute.\n\n"
        f"{_SCHEMA_REFERENCE_V1}\n\n"
        f"{_FEW_SHOT_EXAMPLES_V1}\n\n"
        "Output ONLY a single JSON object with these keys: "
        "polarity, intensity, evidence_span, confidence, drop, rationale. "
        "Do not include any markdown formatting or commentary outside the JSON."
    )
    user_msg = (
        f"clause: \"{clause}\"\n"
        f"attribute: {attribute}\n"
        f"output:"
    )
    return system_msg, user_msg


def _build_prompt_v2(clause: str, attribute: str) -> tuple[str, str]:
    """v2 prompt: skincare-sentiment-aware. See `_SCHEMA_REFERENCE_V2`
    for the full design rationale."""
    system_msg = (
        f"{_SCHEMA_REFERENCE_V2}\n\n"
        f"{_FEW_SHOT_EXAMPLES_V2}\n\n"
        "Output ONLY a single JSON object with these keys: "
        "polarity, intensity, evidence_span, confidence, drop, rationale. "
        "No markdown, no commentary outside the JSON."
    )
    user_msg = (
        f"clause: \"{clause}\"\n"
        f"attribute: {attribute}\n"
        f"output:"
    )
    return system_msg, user_msg


def build_prompt(
    clause: str,
    attribute: str,
    *,
    prompt_version: str = DEFAULT_PROMPT_VERSION,
) -> tuple[str, str]:
    """Return (system_msg, user_msg) for the polarity classification call.

    `prompt_version` selects between the baseline and v2 variants.
    Default remains the v1 baseline so existing pipeline runs are
    unchanged. The evaluator's `--prompt-version` flag is the
    intended opt-in path during the v2 trial.
    """
    if prompt_version == PROMPT_VERSION_V2_SKINCARE:
        return _build_prompt_v2(clause, attribute)
    if prompt_version == PROMPT_VERSION_V1_BASELINE:
        return _build_prompt_v1(clause, attribute)
    raise ValueError(
        f"unknown prompt_version: {prompt_version!r}; "
        f"expected one of {ALLOWED_PROMPT_VERSIONS}"
    )


# ---------------------------------------------------------------------------
# Response parser
# ---------------------------------------------------------------------------


def parse_response(raw: str, attribute: str) -> PolarityRecord | None:
    """Parse and validate the LLM response. Returns None on schema violation."""
    if not raw:
        return None
    txt = raw.strip()
    # Strip markdown fences if present
    if txt.startswith("```"):
        txt = re.sub(r"^```(?:json)?\s*", "", txt)
        txt = re.sub(r"\s*```$", "", txt)
    try:
        data = json.loads(txt)
    except json.JSONDecodeError:
        return None
    if not isinstance(data, dict):
        return None
    polarity = data.get("polarity")
    intensity = data.get("intensity")
    confidence = data.get("confidence")
    drop = bool(data.get("drop", False))
    if polarity not in ALLOWED_POLARITIES:
        return None
    if intensity not in ALLOWED_INTENSITY:
        return None
    if confidence not in ALLOWED_CONFIDENCE:
        return None
    return PolarityRecord(
        attribute=attribute,
        polarity=polarity,
        intensity=intensity,
        evidence_span=str(data.get("evidence_span", ""))[:80],
        confidence=confidence,
        drop=drop,
        rationale=str(data.get("rationale", ""))[:200],
    )


# ---------------------------------------------------------------------------
# Classifier protocol + implementations
# ---------------------------------------------------------------------------


@runtime_checkable
class PolarityClassifier(Protocol):
    def classify(self, clause: str, attribute: str) -> PolarityRecord | None: ...


class StubClassifier:
    """Deterministic heuristic classifier — no LLM. Used for offline testing
    and regression checks. Quality is intentionally low; this exists to
    verify pipeline plumbing, not to provide production polarity.
    """

    POSITIVE_MARKERS = ("좋아", "예쁘", "이쁘", "이뿌", "만족", "추천", "찰떡", "딱 좋", "잘 발", "잘 펴", "잘 어울")
    NEGWEAK_MARKERS = ("아쉬", "별로", "약하", "옅", "좀 ", "살짝", "조금", "안 맞")
    NEGSTRONG_MARKERS = ("다신 안", "절대", "최악", "비추", "구려", "더러", "끔찍")
    INTENSE3 = ("너무", "진짜", "완전", "정말 ", "엄청")
    INTENSE1 = ("좀 ", "약간", "살짝", "조금")

    def classify(self, clause: str, attribute: str) -> PolarityRecord | None:
        s = clause or ""
        # Polarity rule
        polarity = None
        if any(m in s for m in self.NEGSTRONG_MARKERS):
            polarity = "negative_strong"
        elif any(m in s for m in self.NEGWEAK_MARKERS):
            polarity = "negative_weak"
        elif any(m in s for m in self.POSITIVE_MARKERS):
            polarity = "positive"
        else:
            return PolarityRecord(
                attribute=attribute, polarity="neutral", intensity=1,
                evidence_span="", confidence="low", drop=True,
                rationale="stub: no sentiment marker",
            )
        # Intensity
        if any(m in s for m in self.INTENSE3):
            intensity = 3
        elif any(m in s for m in self.INTENSE1):
            intensity = 1
        else:
            intensity = 2
        return PolarityRecord(
            attribute=attribute, polarity=polarity, intensity=intensity,
            evidence_span=s[:80], confidence="medium", drop=False,
            rationale="stub heuristic",
        )


class OpenAIClassifier:
    """Real LLM polarity classifier using OpenAI's Chat Completions API.

    Defaults to `gpt-4o-mini` (cost tier comparable to Claude Haiku 4.5
    referenced in the design doc). Temperature=0 for near-deterministic
    output. Caches responses by (model, prompt hash) for repeat eval runs.
    """

    def __init__(self, model: str = "gpt-4o-mini", temperature: float = 0.0,
                 cache_path: str | None = None,
                 *, prompt_version: str = DEFAULT_PROMPT_VERSION):
        try:
            from openai import OpenAI  # type: ignore
        except ImportError as e:
            raise RuntimeError("openai SDK not installed") from e
        # Load .env if present
        try:
            from dotenv import load_dotenv  # type: ignore
            load_dotenv()
        except ImportError:
            pass
        if not os.environ.get("OPENAI_API_KEY"):
            raise RuntimeError("OPENAI_API_KEY not set in environment or .env")
        if prompt_version not in ALLOWED_PROMPT_VERSIONS:
            raise ValueError(
                f"unknown prompt_version: {prompt_version!r}; "
                f"expected one of {ALLOWED_PROMPT_VERSIONS}"
            )
        self._client = OpenAI()
        self._model = model
        self._temperature = temperature
        self._prompt_version = prompt_version
        self._cache: dict[str, dict] = {}
        self._cache_path = cache_path
        if cache_path and os.path.isfile(cache_path):
            try:
                self._cache = json.loads(open(cache_path).read())
            except Exception:
                self._cache = {}

    def _cache_key(self, clause: str, attribute: str) -> str:
        # Cache key includes prompt_version so v1 / v2 caches never
        # collide. Re-running v2 against a cache primed by v1 must
        # always produce a fresh API call.
        import hashlib
        h = hashlib.sha256()
        h.update(self._model.encode())
        h.update(b"|")
        h.update(self._prompt_version.encode())
        h.update(b"|")
        h.update(clause.encode())
        h.update(b"|")
        h.update(attribute.encode())
        return h.hexdigest()[:24]

    def _save_cache(self) -> None:
        if self._cache_path:
            try:
                with open(self._cache_path, "w") as f:
                    json.dump(self._cache, f, ensure_ascii=False)
            except Exception:
                pass

    def classify(self, clause: str, attribute: str) -> PolarityRecord | None:
        if not clause:
            return None
        key = self._cache_key(clause, attribute)
        if key in self._cache:
            cached = self._cache[key]
            return PolarityRecord(**cached) if cached else None

        system_msg, user_msg = build_prompt(
            clause, attribute, prompt_version=self._prompt_version,
        )
        try:
            resp = self._client.chat.completions.create(
                model=self._model,
                temperature=self._temperature,
                messages=[
                    {"role": "system", "content": system_msg},
                    {"role": "user", "content": user_msg},
                ],
                response_format={"type": "json_object"},
                max_completion_tokens=300,
            )
            raw = resp.choices[0].message.content or ""
        except Exception as e:
            print(f"[stage2] api error: {e}")
            return None
        rec = parse_response(raw, attribute)
        # cache as dict (or null sentinel)
        self._cache[key] = rec.to_dict() if rec else None
        self._save_cache()
        return rec


# ---------------------------------------------------------------------------
# Pipeline entry point: stage1 candidates → stage2 records
# ---------------------------------------------------------------------------


def classify_candidate(
    classifier: PolarityClassifier,
    review_text: str,
    attribute: str,
    matched_text: str,
) -> PolarityRecord | None:
    """Run one classification: extract clause around `matched_text`, prompt LLM,
    parse and validate."""
    # `matched_text` from stage 1 is already a snippet; use it as anchor target.
    # If matched_text contains ellipsis markers, strip them for find().
    anchor = matched_text.lstrip("…").rstrip("…").strip()
    # If anchor is the full snippet (long), take its first 8 chars as locator
    if len(anchor) > 30:
        anchor = anchor[:30]
    clause = extract_clause(review_text, anchor)
    return classifier.classify(clause, attribute)


# ---------------------------------------------------------------------------
# Demo runner
# ---------------------------------------------------------------------------


_DEMO_CLAUSES: list[tuple[str, str, str]] = [
    # (clause, attribute, expected polarity)
    ("발색이 너무 좋아요", "pigmentation", "positive"),
    ("발색도 약하구요", "pigmentation", "negative_weak"),
    ("은은해서 좋아요", "pigmentation", "positive"),
    ("너무 연해서 아쉬워요", "pigmentation", "negative_weak"),
    ("촉촉한데 끈적여요", "finish_texture", "mixed"),
    ("양조절이 어려워요", "application_blending", "negative_weak"),
    ("마스크에 다 묻어나요", "transfer_resistance", "negative_strong"),
    ("케이스가 같이 와요", "packaging_container", None),  # expect drop
    ("지속력이 좀 아쉬워요", "persistence", "negative_weak"),
]


def _run_demo(use_real_llm: bool = False) -> None:
    print(f"Phase 2E Stage 2 — demo runner ({'OpenAI gpt-4o-mini' if use_real_llm else 'stub'})")
    print("=" * 70)
    classifier: PolarityClassifier
    if use_real_llm:
        classifier = OpenAIClassifier(cache_path="/tmp/phase2e_stage2_cache.json")
    else:
        classifier = StubClassifier()
    pass_n = 0
    fail_n = 0
    for clause, attr, expected in _DEMO_CLAUSES:
        rec = classifier.classify(clause, attr)
        if expected is None:
            ok = rec is None or rec.drop
            actual = "drop/null" if ok else f"{rec.polarity}"
        else:
            ok = rec is not None and not rec.drop and rec.polarity == expected
            actual = rec.polarity if rec else "None"
        status = "OK  " if ok else "FAIL"
        if ok:
            pass_n += 1
        else:
            fail_n += 1
        intensity_str = f" intensity={rec.intensity}" if rec else ""
        confidence_str = f" conf={rec.confidence}" if rec else ""
        print(f"  [{status}] attr={attr:30s} clause={clause!r}")
        print(f"         expected={expected}, actual={actual}{intensity_str}{confidence_str}")
    print("=" * 70)
    print(f"demo: {pass_n} OK, {fail_n} FAIL")


if __name__ == "__main__":
    import sys as _sys
    use_real = "--real" in _sys.argv
    _run_demo(use_real_llm=use_real)
