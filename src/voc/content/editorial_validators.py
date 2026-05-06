"""Phase D1: editorial cardnews validators.

Reuses Phase B/C validators (length budgets, ban lists, structure)
and adds Phase D-specific rules:

  - `numeric_preservation` — every integer ≥10 from skeleton appears
    on the corresponding editorial slide.
  - `slide_structure_preservation` — slide count, type, index, and
    title locked to skeleton.
  - `confidence_consistency` — editorial.confidence_level equals
    skeleton's.
  - `source_field_traceability` — every slide carries non-empty
    `source_brief_fields[]` resolving to existing brief paths.
  - `novel_claim_guard` (RELAXED Phase D1) — at least ONE bullet per
    eligible slide must contain a numeric ≥10 OR an attribute label
    OR an angle label. Per-bullet anchoring is no longer required.
  - `angle_propagation_per_slide` — every non-method slide must
    reflect the selected angle: by `source_brief_fields` citation,
    by full `angle.ko` substring, OR by the angle's core noun
    (extracted from the locked angle phrase patterns).
  - `disclosure_keyword_preservation` — method-slide disclosure
    contains at least one of {리뷰, 정리, 효능 보장하지 않}.

The result type is `EditorialValidationResult`, parallel to
`CardnewsValidationResult` from Phase B.
"""
from __future__ import annotations

import re
from dataclasses import dataclass

from src.voc.content.editorial_rules import (
    find_unsupported_generic_phrases as _scamper_find_unsupported,
)
from src.voc.content.insight_brief import ANTI_CLICKBAIT_KO
from src.voc.content.validators import (
    ValidationFlag,
    _scan_ban_list,
    _slide_text_for_scan,
    validate_instagram_cardnews_ko,
)

# ---------------------------------------------------------------------------
# Locked configuration
# ---------------------------------------------------------------------------

# Locked slide titles — must equal skeleton; the LLM cannot rewrite.
LOCKED_SLIDE_TITLES_KO: dict[str, str] = {
    "hook": "한 줄 인상",
    "loved": "반복되는 호평",
    "divides": "갈리는 의견",
    "fit": "잘 맞은 분들",
    "watch_outs": "유의 포인트",
    "best_for": "구매 전 점검",
    "method": "분석 기준",
}

# Method-slide disclosure must contain at least one of these substrings.
DISCLOSURE_REQUIRED_SUBSTRINGS: tuple[str, ...] = (
    "리뷰",
    "정리",
    "효능 보장하지 않",
)

# Numeric preservation threshold: integers ≥10 are tracked. Smaller
# numbers (e.g. "1번", "2슬라이드") would generate noise.
NUMERIC_PRESERVATION_MIN: int = 10

# Slide types for which `novel_claim_guard` runs (hook is subtitle-only).
NOVEL_CLAIM_GUARD_SLIDES: tuple[str, ...] = (
    "loved", "divides", "fit", "watch_outs", "best_for"
)

# Slides exempt from `angle_propagation_per_slide`. Method is
# structural — always anchored to evidence_boundaries — so requiring
# angle propagation there would force unnatural insertions.
ANGLE_PROPAGATION_EXEMPT_SLIDES: tuple[str, ...] = ("method",)

# Minimum Korean substring length for the angle propagation
# "core noun" / phrase fragment overlap check. Three Hangul syllables
# is roughly the smallest that's specific enough to mean something
# (e.g. "발색", "지속력"); a 2-char threshold tripped on common bigrams.
ANGLE_PROPAGATION_MIN_KOREAN_OVERLAP: int = 3

# Allowed source_brief_fields path roots. Anything else → blocking.
ALLOWED_BRIEF_PATH_ROOTS: tuple[str, ...] = (
    "core_verdict",
    "main_tradeoff",
    "angle_candidates",
    "best_for",
    "not_for",
    "watch_outs",
    "evidence_boundaries",
    "visual_concept",
)

_INTEGER_RE = re.compile(r"\d+")
_BRIEF_PATH_HEAD_RE = re.compile(r"^([a-z_]+)(\..+|\[.+\]|$)")
_BRIEF_PATH_DOT_RE = re.compile(r"^\.([a-z_]+)$")
_BRIEF_PATH_NAMED_INDEX_RE = re.compile(r"^\[([^\]]+)\]$")
_BRIEF_PATH_INT_INDEX_RE = re.compile(r"^\[(\d+)\]$")

# Locked Phase C angle-phrase patterns. Used to extract the "core
# noun" (the attribute or segment label) from `selected_angle.ko`
# so we can require it to appear on every non-exempt editorial slide.
_ANGLE_PREFIX_PATTERNS_KO: tuple[str, ...] = (
    "리뷰에서 반복된 ",
    "의견이 갈린 ",
    "구매 전 확인할 ",
)
_ANGLE_SUFFIX_PATTERNS_KO: tuple[str, ...] = (
    " 호평",
    " 사용감",
)
_ANGLE_SEGMENT_RE = re.compile(r"^(.+?)에서 반복된 사용감$")


# ---------------------------------------------------------------------------
# Result type
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class EditorialValidationResult:
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


def _extract_integers_at_or_above(
    text: str,
    threshold: int = NUMERIC_PRESERVATION_MIN,
) -> set[int]:
    out: set[int] = set()
    for m in _INTEGER_RE.findall(text or ""):
        try:
            n = int(m)
        except ValueError:
            continue
        if n >= threshold:
            out.add(n)
    return out


def _slide_text(slide: dict) -> str:
    """All operator-visible string fields of a slide, joined with newlines.
    Used by numeric/anchor scans (a single body to grep against)."""
    parts: list[str] = []
    for k in ("title", "subtitle", "disclosure"):
        v = slide.get(k)
        if isinstance(v, str):
            parts.append(v)
    for k in ("bullets", "for_bullets", "not_for_bullets"):
        for b in slide.get(k) or []:
            if isinstance(b, str):
                parts.append(b)
    return "\n".join(parts)


def _bullets_of(slide: dict) -> list[str]:
    """The bullet set used for novel_claim_guard. Hook has no bullets."""
    if slide.get("type") == "hook":
        return []
    if slide.get("type") == "best_for":
        return list(slide.get("for_bullets") or []) + list(
            slide.get("not_for_bullets") or []
        )
    return list(slide.get("bullets") or [])


def _attribute_labels(analysis_report: dict | None) -> set[str]:
    if not isinstance(analysis_report, dict):
        return set()
    out: set[str] = set()
    for a in analysis_report.get("attributes") or []:
        label = (a.get("label_ko") or "").strip()
        if label:
            out.add(label)
    return out


def _angle_labels(brief: dict) -> set[str]:
    """Anchor strings derived from the brief.

    The relaxed novel_claim_guard accepts anything in this set. We
    return:
      - full `angle.ko` strings (e.g. "리뷰에서 반복된 발색 호평")
      - extracted core nouns for each angle (e.g. "발색", "건성 피부")
        so that an editorial bullet referencing the buyer-facing
        noun (without the framing wrapper) still anchors.
      - `best_for[*].label_ko` and `not_for[*].label_ko` since
        those are evidence-backed labels the buyer-facing slides
        legitimately reference (e.g. "건성 피부에서 잘 맞았다는 의견").
      - `watch_outs[*].concern_label_ko` for symmetry.

    Empty strings are filtered.
    """
    out: set[str] = set()
    for a in brief.get("angle_candidates") or []:
        ko = (a.get("ko") or "").strip()
        if ko:
            out.add(ko)
            core = extract_angle_core_noun(ko)
            if core:
                out.add(core)
    for entry in brief.get("best_for") or []:
        label = (entry.get("label_ko") or "").strip()
        if label:
            out.add(label)
    for entry in brief.get("not_for") or []:
        label = (entry.get("label_ko") or "").strip()
        if label:
            out.add(label)
    for entry in brief.get("watch_outs") or []:
        label = (entry.get("concern_label_ko") or "").strip()
        if label:
            out.add(label)
    return out


def extract_angle_core_noun(angle_ko: str) -> str:
    """Strip locked Phase C phrase wrappers and return the noun.

    Examples:
        "의견이 갈린 발색"               → "발색"
        "리뷰에서 반복된 발색 호평"       → "발색"
        "구매 전 확인할 묻어남"          → "묻어남"
        "건성 피부에서 반복된 사용감"     → "건성 피부"

    Public so the polish prompt builder can call it for the
    angle-propagation hint to the LLM.
    """
    s = (angle_ko or "").strip()
    if not s:
        return ""
    m = _ANGLE_SEGMENT_RE.match(s)
    if m:
        return m.group(1).strip()
    for p in _ANGLE_PREFIX_PATTERNS_KO:
        if s.startswith(p):
            s = s[len(p):]
            break
    for sfx in _ANGLE_SUFFIX_PATTERNS_KO:
        if s.endswith(sfx):
            s = s[: -len(sfx)]
            break
    return s.strip()


def _is_hangul(c: str) -> bool:
    return "가" <= c <= "힣"


def _korean_substring_overlap(
    needle: str,
    haystack: str,
    *,
    min_len: int = ANGLE_PROPAGATION_MIN_KOREAN_OVERLAP,
) -> bool:
    """True if any contiguous run of ≥`min_len` Hangul syllables
    from `needle` appears in `haystack`."""
    if not needle or not haystack:
        return False
    for i in range(len(needle) - min_len + 1):
        substr = needle[i : i + min_len]
        if not all(_is_hangul(c) for c in substr):
            continue
        if substr in haystack:
            return True
    return False


def _resolve_brief_path(brief: dict, path: str) -> bool:
    """Return True if `path` is a syntactically valid path that
    resolves to an existing field/index in `brief`.

    Accepted shapes:
        core_verdict.ko
        main_tradeoff.ko
        angle_candidates[<angle_id>]
        best_for[<index>]
        not_for[<index>]
        watch_outs[<index>]
        evidence_boundaries.<field>
        visual_concept.<field>

    Anything else → False. Path validation is purely structural;
    we don't re-validate the field's value.
    """
    if not isinstance(path, str) or not path:
        return False
    head = _BRIEF_PATH_HEAD_RE.match(path)
    if not head:
        return False
    root = head.group(1)
    rest = head.group(2) or ""
    if root not in ALLOWED_BRIEF_PATH_ROOTS:
        return False

    if root in ("core_verdict", "main_tradeoff", "evidence_boundaries", "visual_concept"):
        m = _BRIEF_PATH_DOT_RE.match(rest)
        if not m:
            return False
        section = brief.get(root)
        if not isinstance(section, dict):
            return False
        return m.group(1) in section

    if root == "angle_candidates":
        m = _BRIEF_PATH_NAMED_INDEX_RE.match(rest)
        if not m:
            return False
        angle_id = m.group(1)
        return any(
            (c.get("angle_id") == angle_id)
            for c in (brief.get("angle_candidates") or [])
        )

    if root in ("best_for", "not_for", "watch_outs"):
        m = _BRIEF_PATH_INT_INDEX_RE.match(rest)
        if not m:
            return False
        idx = int(m.group(1))
        arr = brief.get(root) or []
        return 0 <= idx < len(arr)

    return False


# ---------------------------------------------------------------------------
# Public validator
# ---------------------------------------------------------------------------


def validate_editorial_cardnews_ko(
    editorial: dict,
    skeleton: dict,
    brief: dict,
    selected_angle: dict,
    *,
    analysis_report: dict | None = None,
) -> EditorialValidationResult:
    """Run every editorial validator and return an aggregate result.

    `selected_angle` is the dict form of the SelectedAngle (or any
    dict carrying `angle_id` and `ko`).

    `analysis_report` is optional; when omitted, attribute-label
    anchors are skipped in the novel-claim guard. The runner always
    has it on hand, so this is mostly for unit tests that exercise
    a single rule.
    """
    flags: list[ValidationFlag] = []

    # ---- 1. Reuse Phase B base validation ---------------------------------
    base_result = validate_instagram_cardnews_ko(editorial)
    flags.extend(base_result.flags)

    # ---- 2. Anti-clickbait scan (Phase C carryover) -----------------------
    for i, slide in enumerate(editorial.get("slides") or []):
        loc = f"slide[{i + 1}]"
        text = _slide_text_for_scan(slide)
        for term in _scan_ban_list(text, ANTI_CLICKBAIT_KO):
            flags.append(ValidationFlag(
                rule="anti_clickbait",
                severity="blocking",
                location=loc,
                matched=term,
                detail="sensational / clickbait framing",
            ))

    # ---- 2b. SCAMPER ELIMINATE: unsupported generic phrases ---------------
    # A generic phrase like "호평이 반복됩니다" is allowed only when
    # paired with a digit (count) or a quoted excerpt in the same
    # sentence — anything else reads as filler review-summary text
    # rather than decision-criteria content. Soft generics
    # ("잘 맞았다는 의견") are advisory by default.
    for i, slide in enumerate(editorial.get("slides") or []):
        loc = f"slide[{i + 1}]"
        text = _slide_text_for_scan(slide)
        for hit in _scamper_find_unsupported(text):
            flags.append(ValidationFlag(
                rule="scamper_unsupported_generic_phrase",
                severity=(
                    "blocking" if hit["severity"] == "block" else "advisory"
                ),
                location=loc,
                matched=hit["phrase"],
                detail=(
                    "generic phrase without paired evidence "
                    "(digit or quoted excerpt) in the same sentence"
                ),
            ))

    s_slides = list(skeleton.get("slides") or [])
    e_slides = list(editorial.get("slides") or [])

    # ---- 3. Slide structure preservation ----------------------------------
    if len(e_slides) != len(s_slides):
        flags.append(ValidationFlag(
            rule="slide_structure_preservation",
            severity="blocking",
            location="editorial.slides",
            matched=str(len(e_slides)),
            detail=f"slide count {len(e_slides)} != skeleton {len(s_slides)}",
        ))
    else:
        for i, (e, s) in enumerate(zip(e_slides, s_slides)):
            loc = f"slide[{i + 1}]"
            if e.get("index") != s.get("index"):
                flags.append(ValidationFlag(
                    rule="slide_structure_preservation",
                    severity="blocking",
                    location=f"{loc}.index",
                    matched=str(e.get("index")),
                    detail=f"editorial index {e.get('index')!r} != skeleton {s.get('index')!r}",
                ))
            if e.get("type") != s.get("type"):
                flags.append(ValidationFlag(
                    rule="slide_structure_preservation",
                    severity="blocking",
                    location=f"{loc}.type",
                    matched=str(e.get("type")),
                    detail=f"editorial type {e.get('type')!r} != skeleton {s.get('type')!r}",
                ))
            stype = s.get("type")
            expected_title = LOCKED_SLIDE_TITLES_KO.get(stype) if stype else None
            if expected_title and e.get("title") != expected_title:
                flags.append(ValidationFlag(
                    rule="slide_structure_preservation",
                    severity="blocking",
                    location=f"{loc}.title",
                    matched=str(e.get("title")),
                    detail=f"title must equal locked {expected_title!r}",
                ))

    # ---- 4. Confidence consistency ----------------------------------------
    s_conf = skeleton.get("confidence_level")
    e_conf = editorial.get("confidence_level")
    if s_conf != e_conf:
        flags.append(ValidationFlag(
            rule="confidence_consistency",
            severity="blocking",
            location="editorial.confidence_level",
            matched=str(e_conf),
            detail=f"editorial confidence {e_conf!r} != skeleton {s_conf!r}",
        ))

    # ---- 5. Numeric preservation per slide --------------------------------
    if len(e_slides) == len(s_slides):
        for i, (e, s) in enumerate(zip(e_slides, s_slides)):
            loc = f"slide[{i + 1}]"
            s_text = _slide_text(s)
            e_text = _slide_text(e)
            s_nums = _extract_integers_at_or_above(s_text)
            e_nums = _extract_integers_at_or_above(e_text)
            missing = s_nums - e_nums
            if missing:
                flags.append(ValidationFlag(
                    rule="numeric_preservation",
                    severity="blocking",
                    location=loc,
                    matched=", ".join(str(n) for n in sorted(missing)),
                    detail=f"skeleton numbers {sorted(s_nums)} not all preserved",
                ))

    # ---- 6. Source-field traceability per slide ---------------------------
    for i, e in enumerate(e_slides):
        loc = f"slide[{i + 1}]"
        sbf = e.get("source_brief_fields")
        if not isinstance(sbf, list) or len(sbf) == 0:
            flags.append(ValidationFlag(
                rule="source_field_traceability",
                severity="blocking",
                location=f"{loc}.source_brief_fields",
                detail="must list at least one brief path",
            ))
            continue
        for j, path in enumerate(sbf):
            if not _resolve_brief_path(brief, path):
                flags.append(ValidationFlag(
                    rule="source_field_traceability",
                    severity="blocking",
                    location=f"{loc}.source_brief_fields[{j}]",
                    matched=str(path),
                    detail="path does not resolve in brief",
                ))

    # ---- 7. Novel-claim guard (RELAXED: per-slide, not per-bullet) ---------
    attr_labels = _attribute_labels(analysis_report)
    angle_labels = _angle_labels(brief)
    for i, e in enumerate(e_slides):
        if e.get("type") not in NOVEL_CLAIM_GUARD_SLIDES:
            continue
        bullets = _bullets_of(e)
        if not bullets:
            continue  # bullet_count rule already handled this
        anchored = False
        for b in bullets:
            text = b or ""
            if _extract_integers_at_or_above(text):
                anchored = True
                break
            if any(label and label in text for label in attr_labels):
                anchored = True
                break
            if any(label and label in text for label in angle_labels):
                anchored = True
                break
        if not anchored:
            flags.append(ValidationFlag(
                rule="novel_claim_guard",
                severity="blocking",
                location=f"slide[{i + 1}]",
                detail=(
                    "no bullet on this slide is anchored to a numeric ≥10, "
                    "an attribute label, or an angle label"
                ),
            ))

    # ---- 8. Angle propagation per slide -----------------------------------
    selected_angle_id = (selected_angle or {}).get("angle_id")
    selected_angle_ko = ((selected_angle or {}).get("ko") or "").strip()
    selected_angle_path = (
        f"angle_candidates[{selected_angle_id}]" if selected_angle_id else None
    )
    angle_core_noun = extract_angle_core_noun(selected_angle_ko)

    for i, e in enumerate(e_slides):
        stype = e.get("type")
        if stype in ANGLE_PROPAGATION_EXEMPT_SLIDES:
            continue
        loc = f"slide[{i + 1}]"
        sbf = e.get("source_brief_fields") or []
        slide_text = _slide_text(e)
        # (a) explicit citation
        if selected_angle_path and selected_angle_path in sbf:
            continue
        # (b) full angle.ko substring
        if selected_angle_ko and selected_angle_ko in slide_text:
            continue
        # (c) core noun (attribute / segment label) substring
        if angle_core_noun and angle_core_noun in slide_text:
            continue
        # (d) generic Korean ≥3-syllable overlap (last-chance check)
        if selected_angle_ko and _korean_substring_overlap(selected_angle_ko, slide_text):
            continue
        flags.append(ValidationFlag(
            rule="angle_propagation_per_slide",
            severity="blocking",
            location=loc,
            detail=(
                f"slide does not reflect selected angle {selected_angle_id!r} "
                f"(core noun {angle_core_noun!r}): no citation in "
                "source_brief_fields, no Korean substring overlap with angle.ko"
            ),
        ))

    # ---- 9. Disclosure substring preservation -----------------------------
    for i, e in enumerate(e_slides):
        if e.get("type") != "method":
            continue
        disclosure = (e.get("disclosure") or "").strip()
        if not any(s in disclosure for s in DISCLOSURE_REQUIRED_SUBSTRINGS):
            flags.append(ValidationFlag(
                rule="disclosure_keyword_preservation",
                severity="blocking",
                location=f"slide[{i + 1}].disclosure",
                detail=(
                    f"must contain at least one of {DISCLOSURE_REQUIRED_SUBSTRINGS}"
                ),
            ))

    blocking_present = any(f.severity == "blocking" for f in flags)
    return EditorialValidationResult(ok=not blocking_present, flags=tuple(flags))
