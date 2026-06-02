"""Phase C: deterministic consumer-insight brief generator + validator.

The brief is the **buyer-facing crystallization** of a (seller-tilted)
analysis report. Downstream LLM polish (Phase D+) reads only the
brief — never the analysis report — so it cannot invent insights;
it can only restyle pre-asserted ones.

Angle candidates (the diversity pool)
-------------------------------------
The brief computes ALL evidence-backed candidate angles from four
buckets — `strength`, `tradeoff`, `risk`, `segment` — capped at 3
per type and 12 total. Each candidate carries a deterministic
`priority_score` (0..1) so callers can rank without re-reading
the source. **Phase C does NOT lock one angle as primary.** The
sibling `channel_angle_recommendations` carries an ordered
suggestion only; Phase D's LLM picks the final angle per channel
from `angle_candidates`. The configurable `angle_priority_modes`
(`strength_first` / `tradeoff_first` / `risk_first` / `segment_first`)
is reserved for Phase D and is not honored here.

What the brief does
-------------------
- Crystallizes the headline buyer-relevant claims (verdict, main
  tradeoff, watch_outs, who_for / who_not_for).
- Emits a diverse pool of evidence-led `angle_candidates` (one
  bucket per type minimum when source data supports it).
  **Information-first by contract.** Sensational framings (절대 사지 마,
  난리, 무조건, 역대급, 충격, 찐템, 대박, 인생템, 미쳤, 원픽) are
  blocked by the brief validator; calm, evidence-led seeds
  ("리뷰에서 반복된 …", "의견이 갈린 …", "구매 전 확인할 …") are
  produced by the generator.
- Records `evidence_boundaries.what_we_can_say` and
  `what_we_cannot_say` so every downstream surface inherits the
  same factual boundary.
- Picks a deterministic visual concept (mood + palette +
  composition keywords) keyed on product category, plus locked
  `anti_patterns` (face / logo / trademark / skin_disease_imagery).
- Emits a deterministic `cover_image_prompt` and one
  `background_image_prompts` per cardnews slide section. Image
  generation itself is out of scope; the brief only emits prompts
  with mandatory `negative_prompts`.

What the brief does NOT do
--------------------------
- It does **not** call any LLM, hit any DB, or scrape anything.
- It does **not** read raw reviews — only the already-aggregated
  fields on the analysis report.
- It does **not** modify the source analysis_report.json.

Failure mode
------------
`InsightBriefGenerationError` when source data is too thin for
required sections (no derivable verdict, no hook angles, etc.).
The runner catches and marks
`consumer_insight_brief_json.status = "failed"`; the run
continues — Phase B's skeleton cardnews can still be produced
from the analysis report directly.
"""
from __future__ import annotations

import hashlib
import json
import unicodedata
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Iterable, Literal

from src.voc.content._confidence import resolve_overall_confidence
from src.voc.content.validators import (
    BAN_LIST_CAUSAL_KO,
    BAN_LIST_DIRECTIVE_KO,
    BAN_LIST_MEDICAL_KO,
    BAN_LIST_SUPERLATIVE_KO,
    ValidationFlag,
)


INSIGHT_BRIEF_SCHEMA_VERSION = "1.0"
INSIGHT_BRIEF_FILENAME = "consumer_insight_brief.json"


# ---------------------------------------------------------------------------
# Information-first contract: anti-clickbait list
# ---------------------------------------------------------------------------
#
# Per the user's explicit Phase C decision, the brief is non-promotional.
# These tokens are blocked from any operator-visible string in the brief
# (hook_angles[*].ko, core_verdict.ko, main_tradeoff.ko, etc.).

ANTI_CLICKBAIT_KO: tuple[str, ...] = (
    "절대 사지 마",   # "don't ever buy"
    "사지 마세요",    # "do not buy" (directive negative)
    "난리",
    "난리난",
    "무조건",
    "역대급",
    "충격",
    "찐템",
    "대박",
    "인생템",
    "미쳤",
    "미친",
    "원픽",
)


# Locked phrases — these define the factual boundary for *every*
# downstream artifact. Editing this list is a contract change.
WHAT_WE_CAN_SAY_KO: tuple[str, ...] = (
    "리뷰에서 반복되는 인상",
    "특정 사용 환경 또는 세그먼트에서의 의견 분포",
    "긍정/부정 비율과 표본 크기",
)

WHAT_WE_CANNOT_SAY_KO: tuple[str, ...] = (
    "제품 결함 확정",
    "효능 보장",
    "특정 피부 트러블 진단",
    "최고/1위/베스트 단정",
)

# Locked anti-pattern tokens. Image-prompt safety depends on these
# being part of every brief — the validator asserts presence.
ANTI_PATTERNS_LOCKED: tuple[str, ...] = (
    "face",
    "logo",
    "trademark",
    "skin_disease_imagery",
    "harsh_neon",
)

# Mandatory negative-prompt tokens for any image-prompt block.
# Required substrings, not the literal full set; the brief writer
# can extend.
REQUIRED_NEGATIVE_PROMPT_TOKENS: tuple[str, ...] = (
    "face",
    "logo",
    "trademark",
    "skin condition",
    "medical imagery",
)

# Sections — must match the cardnews slide types from validators.py.
# Locked here so the schema and the generator can't drift.
CARDNEWS_SECTIONS: tuple[str, ...] = (
    "hook", "loved", "divides", "fit", "watch_outs", "best_for", "method",
)

# Threshold reused from cardnews_generator. Re-stated rather than
# imported to keep insight_brief import-light.
WATCH_OUTS_MIN_NEGATIVE: int = 5
CONTRADICTION_MIN_PER_SIDE: int = 5

# Diversity pool sizing. `MAX_PER_TYPE` controls how deep we go in
# each bucket (strength / tradeoff / risk / segment); `MAX_TOTAL`
# caps the overall list so Phase D's LLM gets a manageable pool.
ANGLE_MAX_PER_TYPE: int = 3
ANGLE_MAX_TOTAL: int = 12

# Angle types — locked enum mirrored in the schema.
AngleType = Literal["strength", "tradeoff", "risk", "segment"]
ANGLE_TYPES: tuple[AngleType, ...] = ("strength", "tradeoff", "risk", "segment")

# Priority-score type weights. Tradeoffs lead because they often
# carry the most decision-relevant information for buyers
# (information asymmetry); strengths/risks are close behind;
# segments slightly lower since "fit" is conditional.
ANGLE_TYPE_WEIGHT: dict[AngleType, float] = {
    "strength": 0.95,
    "tradeoff": 1.00,
    "risk":     0.95,
    "segment":  0.90,
}

# Future configuration knob — the user listed `angle_priority_modes`
# (strength_first / tradeoff_first / risk_first / segment_first)
# as a Phase D concern. They are NOT honored in Phase C; the brief
# emits a neutral, type-balanced pool. Phase D will read this
# constant when implementing per-product or per-campaign overrides.
ANGLE_PRIORITY_MODES: tuple[str, ...] = (
    "strength_first",
    "tradeoff_first",
    "risk_first",
    "segment_first",
)


# ---------------------------------------------------------------------------
# Visual concept palette table (deterministic v1)
# ---------------------------------------------------------------------------
#
# Keyed on coarse product category. The "default" bucket covers
# anything with a missing or unrecognized category. Each bucket is
# a tuple of (mood_ko, palette_keywords, composition_keywords).
# Phase D2 may add LLM-augmented variation within these buckets;
# Phase C ships the locked tables.

PALETTE_BY_CATEGORY: dict[str, dict] = {
    "color_cosmetics": {
        "mood_ko": "차분한 데일리 색조 화장품",
        "palette_keywords": ["soft pink", "warm beige", "cream", "muted coral"],
        "composition_keywords": ["clean macro", "abstract texture", "soft shadow", "minimal still life"],
    },
    "skincare": {
        "mood_ko": "차분한 스킨케어 미니멀 톤",
        "palette_keywords": ["pale cream", "ivory", "soft sage", "frost white"],
        "composition_keywords": ["minimal still life", "gentle blur", "natural light"],
    },
    "haircare": {
        "mood_ko": "차분한 헤어케어 톤",
        "palette_keywords": ["dusty rose", "warm taupe", "ivory"],
        "composition_keywords": ["minimal still life", "soft shadow"],
    },
    "fragrance": {
        "mood_ko": "차분한 프래그런스 미니멀 톤",
        "palette_keywords": ["pale amber", "warm ivory", "soft beige"],
        "composition_keywords": ["minimal glassware", "abstract light", "soft natural shadow"],
    },
    "default": {
        "mood_ko": "차분한 코스메틱 에디토리얼 톤",
        "palette_keywords": ["soft beige", "cream", "warm pastel"],
        "composition_keywords": ["minimal", "clean", "soft shadow"],
    },
}

# Per-section composition hints. Information-first: each section
# leans on a calm, editorial composition rather than a "wow" angle.
SECTION_COMPOSITION_HINTS: dict[str, str] = {
    "hook":       "centered minimal composition, single focal subject, abundant negative space",
    "loved":      "warm gentle light, multiple cosmetic objects in soft arrangement",
    "divides":    "balanced split composition, dual neutral tones, calm contrast",
    "fit":        "warm gentle texture, fabric or paper background, soft daylight",
    "watch_outs": "muted neutral tone, calm minimal arrangement, restrained framing",
    "best_for":   "clean grid layout, geometric calm composition, soft pastel field",
    "method":     "abstract paper texture, minimal calm tone, subtle drop shadow",
}

# Channel angle preferences. Information-first: every tone directive
# emphasizes credibility and evidence-led framing.
#
# `preferred_types` is consulted to derive the deterministic
# `suggested_angle_ids` list per channel. It is a *suggestion*,
# not a lock — Phase D's editorial layer may pick any candidate
# from the pool.
CHANNEL_ANGLE_RULES: dict[str, dict] = {
    "instagram": {
        "preferred_types": ("strength", "segment"),
        "tone_directive": "정보 중심 에디토리얼 톤. 차분하고 스캔 가능하게. 과장 금지.",
    },
    "threads": {
        "preferred_types": ("tradeoff", "risk", "segment"),
        "tone_directive": "설명적·대화체. 헤지 표현(가능성, 검토)을 사용하고 결론을 단정하지 않습니다.",
    },
    "x": {
        "preferred_types": ("tradeoff", "risk"),
        "tone_directive": "한 가지 대립점만 다루며 280자 이내. 단정·과장 금지.",
    },
}

# Per-channel suggestion list cap. Phase D may take fewer.
SUGGESTED_ANGLE_IDS_PER_CHANNEL: int = 3

# Default channel_fit per type. Used to populate `channel_fit` on
# each candidate as advisory metadata; the authoritative routing
# is `channel_angle_recommendations`.
DEFAULT_CHANNEL_FIT_BY_TYPE: dict[AngleType, tuple[str, ...]] = {
    "strength": ("instagram",),
    "tradeoff": ("x", "threads"),
    "risk":     ("threads",),
    "segment":  ("instagram", "threads"),
}


class InsightBriefGenerationError(ValueError):
    """Raised when source data is too thin for the brief to satisfy
    minimums (no derivable verdict, no hook angles, etc.)."""


@dataclass(frozen=True)
class BriefValidationResult:
    """Mirror of CardnewsValidationResult, kept type-distinct so test
    assertions stay clear."""
    ok: bool
    flags: tuple[ValidationFlag, ...]

    @property
    def blocking(self) -> tuple[ValidationFlag, ...]:
        return tuple(f for f in self.flags if f.severity == "blocking")

    @property
    def advisory(self) -> tuple[ValidationFlag, ...]:
        return tuple(f for f in self.flags if f.severity == "advisory")

    def summary(self) -> str:
        if self.ok:
            return f"ok ({len(self.advisory)} advisory)"
        return f"failed ({len(self.blocking)} blocking, {len(self.advisory)} advisory)"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _kchars(s: str | None) -> int:
    return 0 if not s else len(unicodedata.normalize("NFC", s))


def _attribute_label(report: dict, key: str) -> str:
    for a in report.get("attributes") or []:
        if a.get("key") == key:
            return a.get("label_ko") or key
    return key


def _attribute_counts(report: dict) -> dict[str, dict]:
    out: dict[str, dict] = {}
    for a in report.get("attributes") or []:
        key = a.get("key")
        if not key:
            continue
        out[key] = {
            "label_ko": a.get("label_ko") or key,
            "n_positive": int(a.get("n_positive") or 0),
            "n_negative": int(a.get("n_negative") or 0),
            "n_mixed": int(a.get("n_mixed") or 0),
        }
    return out


def _yyyy_mm(value: object) -> str | None:
    """Extract `YYYY-MM` from an ISO-8601 date or datetime string."""
    if not isinstance(value, str):
        return None
    s = value.strip()
    if len(s) >= 7 and s[4] == "-" and s[5:7].isdigit():
        return s[:7]
    return None


def _category_palette(report: dict) -> dict:
    cat = ((report.get("product") or {}).get("category") or "").strip().lower()
    return PALETTE_BY_CATEGORY.get(cat) or PALETTE_BY_CATEGORY["default"]


def _analysis_report_sha256(report: dict) -> str:
    blob = json.dumps(report, ensure_ascii=False, sort_keys=True)
    return hashlib.sha256(blob.encode("utf-8")).hexdigest()


# ---------------------------------------------------------------------------
# Section builders
# ---------------------------------------------------------------------------


def _build_core_verdict(report: dict) -> dict:
    quick = report.get("quick_decision") or {}
    verdict = (quick.get("verdict_ko") or "").strip()

    if verdict:
        return {
            "ko": verdict,
            "evidence": {
                "basis": "quick_decision.verdict_ko",
                "n": int((report.get("corpus") or {}).get("n_reviews_total") or 0) or None,
            },
        }

    # Fallback: derive from the strongest positively-leaning attribute.
    counts = _attribute_counts(report)
    ranked = sorted(
        counts.items(),
        key=lambda kv: -(kv[1]["n_positive"] - kv[1]["n_negative"]),
    )
    if ranked:
        top_key, top = ranked[0]
        if top["n_positive"] > 0:
            # SCAMPER MODIFY: evidence-paired contrast verdict instead
            # of the generic "관련 호평이 두드러집니다" template.
            return {
                "ko": (
                    f"{top['label_ko']} 만족 후기가 "
                    f"{top['n_positive']}건 누적됩니다"
                ),
                "evidence": {
                    "basis": f"attributes[{top_key}].n_positive",
                    "n": top["n_positive"],
                },
            }
    raise InsightBriefGenerationError(
        "core_verdict: no quick_decision.verdict_ko and no positive "
        "attribute available to derive a fallback"
    )


def _build_main_tradeoff(report: dict) -> dict | None:
    counts = _attribute_counts(report)

    pos_dominant = sorted(
        [(k, c) for k, c in counts.items() if c["n_positive"] > c["n_negative"] and c["n_positive"] >= CONTRADICTION_MIN_PER_SIDE],
        key=lambda kv: -kv[1]["n_positive"],
    )
    neg_dominant = sorted(
        [(k, c) for k, c in counts.items() if c["n_negative"] > c["n_positive"] and c["n_negative"] >= CONTRADICTION_MIN_PER_SIDE],
        key=lambda kv: -kv[1]["n_negative"],
    )

    if pos_dominant and neg_dominant:
        for_attr, for_c = pos_dominant[0]
        against_attr, against_c = neg_dominant[0]
        if for_attr != against_attr:
            # SCAMPER MODIFY: explicit count-paired contrast replaces
            # "호평이 반복되며 … 의견이 갈립니다".
            return {
                "ko": (
                    f"{for_c['label_ko']} 만족 후기 "
                    f"{for_c['n_positive']}건이 보이지만, "
                    f"{against_c['label_ko']} 불만 후기도 "
                    f"{against_c['n_negative']}건 함께 누적됩니다"
                ),
                "for_attribute": for_attr,
                "against_attribute": against_attr,
                "n_pos_for": for_c["n_positive"],
                "n_neg_against": against_c["n_negative"],
            }

    # Same-attribute contradiction fallback (both polarities ≥ floor).
    for key, c in sorted(
        counts.items(),
        key=lambda kv: -(kv[1]["n_positive"] + kv[1]["n_negative"]),
    ):
        if (
            c["n_positive"] >= CONTRADICTION_MIN_PER_SIDE
            and c["n_negative"] >= CONTRADICTION_MIN_PER_SIDE
        ):
            return {
                "ko": f"{c['label_ko']}에서 의견이 갈리는 패턴",
                "for_attribute": key,
                "against_attribute": key,
                "n_pos_for": c["n_positive"],
                "n_neg_against": c["n_negative"],
            }
    return None


def _priority_score(
    candidate_type: AngleType,
    evidence_n: int,
    max_evidence_n: int,
) -> float:
    """Compute the deterministic 0..1 priority score.

    `evidence_n / max_evidence_n` keeps the *strongest* candidate
    overall at the top of its bucket; multiplying by the per-type
    weight (`ANGLE_TYPE_WEIGHT`) lets us slightly favor tradeoffs
    without crushing the other types. Returning 0 for non-positive
    `max_evidence_n` keeps the function total — the caller may
    still want to enumerate candidates with no evidence count.
    """
    if max_evidence_n <= 0 or evidence_n <= 0:
        return 0.0
    weight = ANGLE_TYPE_WEIGHT[candidate_type]
    return round((evidence_n / max_evidence_n) * weight, 4)


def _strength_raw_candidates(report: dict) -> list[dict]:
    """All strength candidates (capped). Source: `strengths[*]` first,
    fallback to positive-leaning attributes."""
    counts = _attribute_counts(report)
    strengths = list(report.get("strengths") or [])
    if not strengths:
        for key, c in counts.items():
            if c["n_positive"] > c["n_negative"] and c["n_positive"] >= 5:
                strengths.append({
                    "attribute_key": key,
                    "supporting_count": c["n_positive"],
                })
    strengths.sort(key=lambda s: -(s.get("supporting_count") or 0))
    # Pair each strength angle with the top monitoring concern so the
    # angle reads as a purchase-decision contrast ("X는 강점이지만 Y
    # 체크") rather than the generic "리뷰에서 반복된 X 호평". When no
    # monitoring concern exists, fall back to a count-paired strength
    # phrase that still carries specific evidence.
    monitoring = sorted(
        list(report.get("monitoring_candidates") or []),
        key=lambda c: -(c.get("n_negative") or 0),
    )
    top_concern_label: str | None = None
    if monitoring:
        c = monitoring[0]
        top_concern_label = (c.get("concern_label_ko") or "").strip() or (
            _attribute_label(report, c.get("attribute_key", ""))
        )
    out: list[dict] = []
    for s in strengths[:ANGLE_MAX_PER_TYPE]:
        key = s.get("attribute_key")
        if not key:
            continue
        label = _attribute_label(report, key)
        n_pos = int(s.get("supporting_count") or 0)
        # Skip self-paired contrast (strength and concern on the same
        # attribute would just say "X는 강점이지만 X 체크"); the
        # tradeoff angle covers same-attribute contradictions.
        if top_concern_label and top_concern_label != label:
            ko = f"{label}는 강점, {top_concern_label} 체크"
        else:
            ko = f"{label} 만족 후기 {n_pos}건"
        out.append({
            "type": "strength",
            "ko": ko,
            "evidence_n": n_pos,
        })
    return out


def _tradeoff_raw_candidates(report: dict) -> list[dict]:
    """All tradeoff candidates from per-attribute pos+neg contradictions."""
    counts = _attribute_counts(report)
    contradictions = []
    for key, c in counts.items():
        if (
            c["n_positive"] >= CONTRADICTION_MIN_PER_SIDE
            and c["n_negative"] >= CONTRADICTION_MIN_PER_SIDE
        ):
            contradictions.append((key, c))
    contradictions.sort(key=lambda kv: -(kv[1]["n_positive"] + kv[1]["n_negative"]))
    out: list[dict] = []
    for _, c in contradictions[:ANGLE_MAX_PER_TYPE]:
        # SCAMPER M: count-paired tradeoff phrasing replaces the
        # generic "의견이 갈린 X" template. Carries both sides'
        # numbers so it reads as decision-criteria, not summary.
        n_pos = int(c["n_positive"])
        n_neg = int(c["n_negative"])
        out.append({
            "type": "tradeoff",
            "ko": (
                f"{c['label_ko']}: 만족 {n_pos}건 vs 불만 {n_neg}건"
            ),
            "evidence_n": n_pos + n_neg,
        })
    return out


def _risk_raw_candidates(report: dict) -> list[dict]:
    """All risk candidates from `monitoring_candidates`, with attribute-
    table fallback when the analysis report omits the dedicated block."""
    counts = _attribute_counts(report)
    monitoring = [
        c for c in (report.get("monitoring_candidates") or [])
        if int(c.get("n_negative") or 0) >= WATCH_OUTS_MIN_NEGATIVE
    ]
    if not monitoring:
        for key, c in counts.items():
            if c["n_negative"] >= WATCH_OUTS_MIN_NEGATIVE:
                monitoring.append({
                    "attribute_key": key,
                    "n_negative": c["n_negative"],
                    "concern_label_ko": c["label_ko"],
                })
    monitoring.sort(key=lambda c: -(c.get("n_negative") or 0))
    out: list[dict] = []
    for c in monitoring[:ANGLE_MAX_PER_TYPE]:
        label = (c.get("concern_label_ko") or "").strip() or _attribute_label(
            report, c.get("attribute_key", "")
        )
        if not label:
            continue
        # SCAMPER M+R: count-paired hesitation phrasing. The generic
        # "구매 전 확인할 X" trips downstream evidence-pair checks
        # (no count). Carrying the negative count makes it both
        # decision-criteria AND evidence-paired.
        n_neg = int(c.get("n_negative") or 0)
        out.append({
            "type": "risk",
            "ko": f"{label} 불만 {n_neg}건 — 구매 전 한 번 더 검토",
            "evidence_n": n_neg,
        })
    return out


def _segment_raw_candidates(report: dict) -> list[dict]:
    """All segment candidates with confidence ≥ moderate. Weak
    segments are intentionally excluded — they are not safe as a
    public-facing recommendation."""
    segs = [
        s for s in (report.get("buyer_segments") or [])
        if (s.get("confidence_level") or "").lower() in ("moderate", "strong")
    ]
    segs.sort(key=lambda s: -(s.get("dominant_count") or 0))
    out: list[dict] = []
    for s in segs[:ANGLE_MAX_PER_TYPE]:
        label = (s.get("label_ko") or "").strip()
        if not label:
            continue
        out.append({
            "type": "segment",
            "ko": f"{label}에서 반복된 사용감",
            "evidence_n": int(s.get("dominant_count") or 0),
        })
    return out


def _build_angle_candidates(report: dict) -> list[dict]:
    """Compute the diversity pool of evidence-backed candidate angles.

    Per type (strength / tradeoff / risk / segment) we keep the top
    `ANGLE_MAX_PER_TYPE` from the analysis report. The combined
    pool is scored, sorted, and capped at `ANGLE_MAX_TOTAL`. Angle
    ids are assigned `h1..hN` in `priority_score` descending order;
    ties break by type (alphabetical) then by Korean text for
    determinism.

    Phase C does NOT lock a primary angle; downstream Phase D
    decides per channel.
    """
    raw: list[dict] = []
    raw.extend(_strength_raw_candidates(report))
    raw.extend(_tradeoff_raw_candidates(report))
    raw.extend(_risk_raw_candidates(report))
    raw.extend(_segment_raw_candidates(report))

    if not raw:
        raise InsightBriefGenerationError(
            "angle_candidates: no derivable angles from any bucket "
            "(strengths / tradeoffs / risks / segments)"
        )

    max_evidence = max((c["evidence_n"] for c in raw), default=0)
    for c in raw:
        c["priority_score"] = _priority_score(
            c["type"], c["evidence_n"], max_evidence
        )

    raw.sort(
        key=lambda c: (
            -c["priority_score"],
            c["type"],
            c["ko"],
        )
    )
    raw = raw[:ANGLE_MAX_TOTAL]

    out: list[dict] = []
    for i, c in enumerate(raw, start=1):
        out.append({
            "angle_id": f"h{i}",
            "type": c["type"],
            "priority_score": c["priority_score"],
            "evidence_n": c["evidence_n"],
            "ko": c["ko"],
            "channel_fit": list(DEFAULT_CHANNEL_FIT_BY_TYPE[c["type"]]),
        })
    return out


def _build_best_for(report: dict) -> list[dict]:
    out: list[dict] = []
    quick = report.get("quick_decision") or {}
    raw_for = list(quick.get("who_for_ko") or [])
    for s in raw_for[:4]:
        if isinstance(s, str) and s.strip():
            out.append({
                "label_ko": s.strip(),
                "evidence_n": 0,
                "confidence": "moderate",
                "source_segment_kind": None,
            })

    # Augment / fall back to segments
    if len(out) < 2:
        segs = sorted(
            [
                s for s in (report.get("buyer_segments") or [])
                if (s.get("confidence_level") or "").lower() in ("moderate", "strong")
            ],
            key=lambda s: -(s.get("dominant_count") or 0),
        )
        for s in segs:
            label = (s.get("label_ko") or "").strip()
            if not label:
                continue
            if any(label in (e["label_ko"] or "") for e in out):
                continue
            out.append({
                "label_ko": label,
                "evidence_n": int(s.get("dominant_count") or 0),
                "confidence": (s.get("confidence_level") or "moderate").lower(),
                "source_segment_kind": s.get("segment_kind"),
            })
            if len(out) >= 4:
                break
    return out[:4]


def _build_not_for(report: dict) -> list[dict]:
    out: list[dict] = []
    quick = report.get("quick_decision") or {}
    raw_not_for = list(quick.get("who_not_for_ko") or [])
    for s in raw_not_for[:3]:
        if isinstance(s, str) and s.strip():
            out.append({
                "label_ko": s.strip(),
                "evidence_n": 0,
                "source_concern": None,
            })

    if len(out) < 1:
        candidates = sorted(
            (report.get("monitoring_candidates") or []),
            key=lambda c: -(c.get("n_negative") or 0),
        )
        for c in candidates:
            label = (c.get("concern_label_ko") or "").strip()
            if not label:
                label = _attribute_label(report, c.get("attribute_key", ""))
            if not label:
                continue
            phrase = f"{label}이 중요한 사용 상황"
            out.append({
                "label_ko": phrase,
                "evidence_n": int(c.get("n_negative") or 0),
                "source_concern": c.get("attribute_key"),
            })
            if len(out) >= 3:
                break
    return out[:3]


def _build_watch_outs(report: dict) -> list[dict]:
    out: list[dict] = []
    candidates = sorted(
        (report.get("monitoring_candidates") or []),
        key=lambda c: -(c.get("n_negative") or 0),
    )
    for c in candidates:
        n = int(c.get("n_negative") or 0)
        if n < WATCH_OUTS_MIN_NEGATIVE:
            continue
        label = (c.get("concern_label_ko") or "").strip() or _attribute_label(
            report, c.get("attribute_key", "")
        )
        if not label:
            continue
        out.append({
            "concern_label_ko": label,
            "n_negative": n,
            "context_ko": None,
            "source_attribute": c.get("attribute_key"),
        })
        if len(out) >= 4:
            break
    return out


def _build_channel_recommendations(candidates: Iterable[dict]) -> dict:
    """Derive a deterministic ordered suggestion per channel from
    the candidate pool.

    `suggested_angle_ids` is a *suggestion only* — Phase D's
    editorial layer may pick any angle from `angle_candidates`.
    For each channel:
      1. Filter candidates whose `type` is in the channel's
         `preferred_types`.
      2. Order by the candidate pool's existing priority order
         (the candidates list is already sorted DESC).
      3. Cap at `SUGGESTED_ANGLE_IDS_PER_CHANNEL`.
      4. Final fallback: top candidates overall when no
         preferred-type match exists in the pool.
    """
    candidates_list = list(candidates)

    out: dict[str, dict] = {}
    for channel, rules in CHANNEL_ANGLE_RULES.items():
        preferred = rules["preferred_types"]
        matching = [c for c in candidates_list if c["type"] in preferred]
        suggested = [c["angle_id"] for c in matching[:SUGGESTED_ANGLE_IDS_PER_CHANNEL]]
        if not suggested and candidates_list:
            # Fallback: top candidates overall.
            suggested = [
                c["angle_id"]
                for c in candidates_list[:SUGGESTED_ANGLE_IDS_PER_CHANNEL]
            ]
        out[channel] = {
            "suggested_angle_ids": suggested,
            "tone_directive": rules["tone_directive"],
        }
    return out


def _build_evidence_boundaries(report: dict) -> dict:
    corpus = report.get("corpus") or {}
    window_in = corpus.get("observation_window") or {}
    window = {
        "start": _yyyy_mm(window_in.get("start")),
        "end": _yyyy_mm(window_in.get("end")),
    }
    return {
        "n_reviews_total": int(corpus.get("n_reviews_total") or 0),
        "observation_window": window,
        "primary_sort": corpus.get("primary_sort") or "DATETIME_DESC",
        "what_we_can_say": list(WHAT_WE_CAN_SAY_KO),
        "what_we_cannot_say": list(WHAT_WE_CANNOT_SAY_KO),
    }


def _build_visual_concept(report: dict) -> dict:
    palette = _category_palette(report)
    return {
        "mood_ko": palette["mood_ko"],
        "palette_keywords": list(palette["palette_keywords"]),
        "composition_keywords": list(palette["composition_keywords"]),
        "anti_patterns": list(ANTI_PATTERNS_LOCKED),
    }


def _negative_prompts() -> list[str]:
    """Locked negative-prompt set. Image generators must respect it."""
    return [
        "face",
        "human skin",
        "person",
        "model",
        "logo",
        "brand mark",
        "trademark",
        "skin condition",
        "rash",
        "allergy",
        "medical imagery",
        "before-after comparison",
        "harsh neon",
        "garish color",
    ]


def _build_cover_image_prompt(visual_concept: dict) -> dict:
    palette = ", ".join(visual_concept["palette_keywords"])
    composition = ", ".join(visual_concept["composition_keywords"])
    en = (
        f"Editorial pastel cosmetic still life. "
        f"Mood: {visual_concept['mood_ko']}. "
        f"Palette: {palette}. "
        f"Composition: {composition}. "
        f"Soft natural shadow, minimal clean layout, calm credible tone. "
        f"Avoid: faces, human skin, logos, brand marks, trademarks, "
        f"skin condition, medical imagery, before-after comparisons, "
        f"harsh neon, garish color."
    )
    return {
        "ko": None,
        "en": en,
        "negative_prompts": _negative_prompts(),
    }


def _build_background_image_prompts(visual_concept: dict) -> list[dict]:
    palette = ", ".join(visual_concept["palette_keywords"])
    out: list[dict] = []
    for section in CARDNEWS_SECTIONS:
        composition = SECTION_COMPOSITION_HINTS[section]
        en = (
            f"Editorial pastel cosmetic background for the '{section}' "
            f"section of an evidence-led cardnews. "
            f"Palette: {palette}. "
            f"Composition: {composition}. "
            f"Soft natural shadow, minimal clean layout, calm credible tone. "
            f"Avoid: faces, human skin, logos, brand marks, trademarks, "
            f"skin condition, medical imagery, before-after comparisons, "
            f"harsh neon, garish color."
        )
        out.append({
            "section": section,
            "en": en,
            "negative_prompts": _negative_prompts(),
        })
    return out


# ---------------------------------------------------------------------------
# Top-level
# ---------------------------------------------------------------------------


def generate_consumer_insight_brief(analysis_report: dict) -> dict:
    """Build a consumer insight brief from an analysis report.

    Pure consumer of `analysis_report`; no DB, no LLM, no I/O.

    Raises:
        InsightBriefGenerationError when the source data cannot
        satisfy minimum brief contract (no derivable verdict,
        no hook angles).
    """
    if not isinstance(analysis_report, dict):
        raise InsightBriefGenerationError("analysis_report must be a dict")

    confidence = resolve_overall_confidence(analysis_report)
    core_verdict = _build_core_verdict(analysis_report)
    main_tradeoff = _build_main_tradeoff(analysis_report)
    angle_candidates = _build_angle_candidates(analysis_report)
    best_for = _build_best_for(analysis_report)
    not_for = _build_not_for(analysis_report)
    watch_outs = _build_watch_outs(analysis_report)
    channel_recs = _build_channel_recommendations(angle_candidates)
    evidence_boundaries = _build_evidence_boundaries(analysis_report)
    visual_concept = _build_visual_concept(analysis_report)
    cover_prompt = _build_cover_image_prompt(visual_concept)
    background_prompts = _build_background_image_prompts(visual_concept)

    product = dict(analysis_report.get("product") or {})

    return {
        "schema_version": INSIGHT_BRIEF_SCHEMA_VERSION,
        "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "source_analysis_report_sha256": _analysis_report_sha256(analysis_report),
        "product": {
            "slug": product.get("slug"),
            "name_ko": product.get("name_ko"),
            "name_en": product.get("name_en"),
            "category": product.get("category"),
            "source_url": product.get("source_url"),
        },
        "confidence_level": confidence,
        "core_verdict": core_verdict,
        "main_tradeoff": main_tradeoff,
        "angle_candidates": angle_candidates,
        "best_for": best_for,
        "not_for": not_for,
        "watch_outs": watch_outs,
        "channel_angle_recommendations": channel_recs,
        "evidence_boundaries": evidence_boundaries,
        "visual_concept": visual_concept,
        "cover_image_prompt": cover_prompt,
        "background_image_prompts": background_prompts,
    }


# ---------------------------------------------------------------------------
# Validator
# ---------------------------------------------------------------------------


_BAN_LIST_GROUPS: tuple[tuple[str, tuple[str, ...]], ...] = (
    ("ban_list_medical", BAN_LIST_MEDICAL_KO),
    ("ban_list_directive", BAN_LIST_DIRECTIVE_KO),
    ("ban_list_superlative", BAN_LIST_SUPERLATIVE_KO),
    ("ban_list_causal", BAN_LIST_CAUSAL_KO),
    ("anti_clickbait", ANTI_CLICKBAIT_KO),
)


def _scan_ban_groups(text: str, location: str) -> list[ValidationFlag]:
    """Run every ban list against `text`. Each match yields one
    blocking ValidationFlag. Order of groups follows
    `_BAN_LIST_GROUPS` (medical → directive → superlative →
    causal → anti_clickbait)."""
    flags: list[ValidationFlag] = []
    if not text:
        return flags
    for rule, terms in _BAN_LIST_GROUPS:
        for term in terms:
            if term in text:
                flags.append(ValidationFlag(
                    rule=rule,
                    severity="blocking",
                    location=location,
                    matched=term,
                    detail={
                        "ban_list_medical": "medical claim language",
                        "ban_list_directive": "directive / imperative wording",
                        "ban_list_superlative": "superlative claim without comparative basis",
                        "ban_list_causal": "causal product-defect attribution",
                        "anti_clickbait": "sensational / clickbait framing — brief is information-first",
                    }[rule],
                ))
    return flags


def validate_consumer_insight_brief(brief: dict) -> BriefValidationResult:
    """Validate a brief dict. Never raises on validation failures —
    only on completely malformed input that prevents iteration."""
    flags: list[ValidationFlag] = []

    if not isinstance(brief, dict):
        return BriefValidationResult(
            ok=False,
            flags=(ValidationFlag(
                rule="malformed",
                severity="blocking",
                location="brief",
                detail="brief must be a dict",
            ),),
        )

    # Schema version
    sv = brief.get("schema_version")
    if sv != INSIGHT_BRIEF_SCHEMA_VERSION:
        flags.append(ValidationFlag(
            rule="schema_version",
            severity="blocking",
            location="brief.schema_version",
            matched=str(sv),
            detail=f"expected {INSIGHT_BRIEF_SCHEMA_VERSION!r}",
        ))

    # Product slug present
    product = brief.get("product") or {}
    if not (product.get("slug") or "").strip():
        flags.append(ValidationFlag(
            rule="product_slug_present",
            severity="blocking",
            location="brief.product.slug",
            detail="product.slug is required",
        ))

    # Confidence level
    cl = brief.get("confidence_level")
    if cl not in ("weak", "moderate", "strong"):
        flags.append(ValidationFlag(
            rule="confidence_level",
            severity="blocking",
            location="brief.confidence_level",
            matched=str(cl),
            detail="must be weak | moderate | strong",
        ))

    # core_verdict.ko present + scanned
    core = brief.get("core_verdict") or {}
    verdict_text = (core.get("ko") or "").strip()
    if not verdict_text:
        flags.append(ValidationFlag(
            rule="core_verdict_present",
            severity="blocking",
            location="brief.core_verdict.ko",
            detail="core_verdict.ko is required and non-empty",
        ))
    else:
        flags.extend(_scan_ban_groups(verdict_text, "brief.core_verdict.ko"))

    # main_tradeoff.ko (optional, but if present must pass scan)
    mt = brief.get("main_tradeoff")
    if isinstance(mt, dict):
        mt_text = (mt.get("ko") or "").strip()
        if mt_text:
            flags.extend(_scan_ban_groups(mt_text, "brief.main_tradeoff.ko"))

    # angle_candidates — diverse pool, no primary lock.
    angles = brief.get("angle_candidates") or []
    if not isinstance(angles, list) or not angles:
        flags.append(ValidationFlag(
            rule="angle_candidates_present",
            severity="blocking",
            location="brief.angle_candidates",
            detail="at least one angle candidate is required",
        ))
    else:
        seen_ids: set[str] = set()
        valid_angle_ids: set[str] = set()
        for i, a in enumerate(angles):
            loc = f"brief.angle_candidates[{i}]"
            if not isinstance(a, dict):
                flags.append(ValidationFlag(
                    rule="malformed_angle_candidate",
                    severity="blocking",
                    location=loc,
                    detail="must be a dict",
                ))
                continue
            angle_id = a.get("angle_id")
            if not isinstance(angle_id, str) or not angle_id:
                flags.append(ValidationFlag(
                    rule="angle_candidate_id",
                    severity="blocking",
                    location=f"{loc}.angle_id",
                    matched=str(angle_id),
                    detail="angle_id required",
                ))
            elif angle_id in seen_ids:
                flags.append(ValidationFlag(
                    rule="angle_candidate_id_duplicate",
                    severity="blocking",
                    location=f"{loc}.angle_id",
                    matched=angle_id,
                    detail="angle_id must be unique within angle_candidates",
                ))
            else:
                seen_ids.add(angle_id)
                valid_angle_ids.add(angle_id)
            atype = a.get("type")
            if atype not in ("strength", "tradeoff", "risk", "segment"):
                flags.append(ValidationFlag(
                    rule="angle_candidate_type",
                    severity="blocking",
                    location=f"{loc}.type",
                    matched=str(atype),
                    detail="type must be strength | tradeoff | risk | segment",
                ))
            score = a.get("priority_score")
            if not isinstance(score, (int, float)) or not (0.0 <= float(score) <= 1.0):
                flags.append(ValidationFlag(
                    rule="angle_candidate_priority_score",
                    severity="blocking",
                    location=f"{loc}.priority_score",
                    matched=str(score),
                    detail="priority_score must be a number in [0, 1]",
                ))
            ko_text = (a.get("ko") or "").strip()
            if not ko_text:
                flags.append(ValidationFlag(
                    rule="angle_candidate_ko_present",
                    severity="blocking",
                    location=f"{loc}.ko",
                    detail="angle_candidate.ko required",
                ))
            else:
                flags.extend(_scan_ban_groups(ko_text, f"{loc}.ko"))

        # Channel recommendations must reference real candidate ids.
        channel_recs = brief.get("channel_angle_recommendations") or {}
        for ch, rec in channel_recs.items():
            if not isinstance(rec, dict):
                continue
            ids = list(rec.get("suggested_angle_ids") or [])
            for j, aid in enumerate(ids):
                if aid not in valid_angle_ids:
                    flags.append(ValidationFlag(
                        rule="suggested_angle_id_unknown",
                        severity="blocking",
                        location=f"brief.channel_angle_recommendations.{ch}.suggested_angle_ids[{j}]",
                        matched=str(aid),
                        detail="references an angle_id not present in angle_candidates",
                    ))
            if not (rec.get("tone_directive") or "").strip():
                flags.append(ValidationFlag(
                    rule="channel_tone_directive_present",
                    severity="blocking",
                    location=f"brief.channel_angle_recommendations.{ch}.tone_directive",
                    detail="tone_directive required",
                ))

    # evidence_boundaries — locked phrases must be present.
    eb = brief.get("evidence_boundaries") or {}
    cannot = list(eb.get("what_we_cannot_say") or [])
    for required in WHAT_WE_CANNOT_SAY_KO:
        if required not in cannot:
            flags.append(ValidationFlag(
                rule="evidence_boundary_locked_phrase",
                severity="blocking",
                location="brief.evidence_boundaries.what_we_cannot_say",
                matched=required,
                detail=f"locked phrase missing: {required!r}",
            ))
    can = list(eb.get("what_we_can_say") or [])
    if not can:
        flags.append(ValidationFlag(
            rule="evidence_boundary_what_we_can_say_present",
            severity="blocking",
            location="brief.evidence_boundaries.what_we_can_say",
            detail="what_we_can_say must list at least one allowed claim",
        ))

    # visual_concept anti-pattern lock + non-empty palette/composition
    vc = brief.get("visual_concept") or {}
    anti_patterns = list(vc.get("anti_patterns") or [])
    for required in ("face", "logo", "trademark", "skin_disease_imagery"):
        if required not in anti_patterns:
            flags.append(ValidationFlag(
                rule="visual_concept_anti_pattern_locked",
                severity="blocking",
                location="brief.visual_concept.anti_patterns",
                matched=required,
                detail=f"locked anti-pattern missing: {required!r}",
            ))
    if not (vc.get("palette_keywords") or []):
        flags.append(ValidationFlag(
            rule="visual_concept_palette_present",
            severity="blocking",
            location="brief.visual_concept.palette_keywords",
            detail="palette_keywords must list at least one keyword",
        ))
    if not (vc.get("composition_keywords") or []):
        flags.append(ValidationFlag(
            rule="visual_concept_composition_present",
            severity="blocking",
            location="brief.visual_concept.composition_keywords",
            detail="composition_keywords must list at least one keyword",
        ))

    # cover_image_prompt — negative prompts must include required tokens.
    cover = brief.get("cover_image_prompt") or {}
    cover_prompt_en = (cover.get("en") or "").strip()
    if not cover_prompt_en:
        flags.append(ValidationFlag(
            rule="cover_image_prompt_present",
            severity="blocking",
            location="brief.cover_image_prompt.en",
            detail="cover_image_prompt.en required",
        ))
    cover_neg = list(cover.get("negative_prompts") or [])
    for required in REQUIRED_NEGATIVE_PROMPT_TOKENS:
        if not any(required in n for n in cover_neg):
            flags.append(ValidationFlag(
                rule="image_prompt_negative_required",
                severity="blocking",
                location="brief.cover_image_prompt.negative_prompts",
                matched=required,
                detail=f"required negative-prompt token missing: {required!r}",
            ))

    # background_image_prompts — must cover all 7 sections.
    bg = brief.get("background_image_prompts") or []
    if not isinstance(bg, list) or len(bg) != len(CARDNEWS_SECTIONS):
        flags.append(ValidationFlag(
            rule="background_image_prompts_count",
            severity="blocking",
            location="brief.background_image_prompts",
            matched=str(len(bg)) if isinstance(bg, list) else type(bg).__name__,
            detail=f"expected {len(CARDNEWS_SECTIONS)} prompts (one per section)",
        ))
    else:
        seen_sections: set[str] = set()
        for i, b in enumerate(bg):
            loc = f"brief.background_image_prompts[{i}]"
            if not isinstance(b, dict):
                flags.append(ValidationFlag(
                    rule="malformed_background_prompt",
                    severity="blocking",
                    location=loc,
                    detail="must be a dict",
                ))
                continue
            section = b.get("section")
            if section not in CARDNEWS_SECTIONS:
                flags.append(ValidationFlag(
                    rule="background_section",
                    severity="blocking",
                    location=f"{loc}.section",
                    matched=str(section),
                    detail=f"must be one of {CARDNEWS_SECTIONS}",
                ))
            else:
                seen_sections.add(section)
            if not (b.get("en") or "").strip():
                flags.append(ValidationFlag(
                    rule="background_prompt_present",
                    severity="blocking",
                    location=f"{loc}.en",
                    detail="background_image_prompt.en required",
                ))
            neg = list(b.get("negative_prompts") or [])
            for required in REQUIRED_NEGATIVE_PROMPT_TOKENS:
                if not any(required in n for n in neg):
                    flags.append(ValidationFlag(
                        rule="image_prompt_negative_required",
                        severity="blocking",
                        location=f"{loc}.negative_prompts",
                        matched=required,
                        detail=f"required negative-prompt token missing: {required!r}",
                    ))
        missing_sections = set(CARDNEWS_SECTIONS) - seen_sections
        for s in sorted(missing_sections):
            flags.append(ValidationFlag(
                rule="background_section_missing",
                severity="blocking",
                location="brief.background_image_prompts",
                matched=s,
                detail=f"section missing: {s!r}",
            ))

    blocking_present = any(f.severity == "blocking" for f in flags)
    return BriefValidationResult(ok=not blocking_present, flags=tuple(flags))
