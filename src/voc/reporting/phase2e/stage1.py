"""Phase 2E Stage 1 — deterministic attribute candidate extractor.

Given a Korean cosmetic-review text, emit the set of v0.2 schema attributes
the review mentions. This is candidate extraction only — no polarity, no
intensity, no decision beyond "this attribute is mentioned somewhere in the
review with appropriate guard conditions met".

This module is intentionally OUTSIDE the v1.13 chain. It must NOT be
imported by `src/voc/reporting/phase1/`. It does NOT touch the v1.13
lexicons (`data/phase1_lexicons/`) or detector (`src/voc/reporting/phase1/
signals.py`).

Vocabulary anchored on `docs/phase2e_vocabulary_candidates.md` (empirical
discovery scan). Per-attribute design follows
`docs/phase2e_detector_design.md` §5. v0.2 schema rules from
`docs/phase2e_attribute_polarity_schema_plan.md` §4.

Korean morphology handling: substring-of-stem matching against a curated
per-attribute pattern set. Particles (이/가/은/는/을/를/도) attach as suffixes;
substring `발색` matches `발색이`, `발색은`, `발색도`, `발색이라`. Verb-stem
bigrams (`벗겨`, `약하`) match across conjugation (`벗겨냅니다`, `약하구요`).
No tokenizer dependency.

Output:

    list[AttributeCandidate]

where each entry has `(review_id, attribute, matched_text)`. At most one
record per (review_id, attribute) pair; if multiple patterns match, the
first match's surrounding context window is captured.
"""
from __future__ import annotations

import re
from dataclasses import dataclass


@dataclass(frozen=True)
class AttributeCandidate:
    """One (review_id, attribute) candidate emitted by Stage 1.

    `matched_text` is a short context snippet (~40 chars) centered on the
    first matched pattern; useful for human audit and downstream stage 2
    prompting.
    """

    review_id: str
    attribute: str
    matched_text: str


# ---------------------------------------------------------------------------
# Per-attribute patterns
# ---------------------------------------------------------------------------
#
# Patterns are Korean substrings (stem-form, particle-stripped). Substring
# match — not regex, not tokenized — captures particle variation natively
# because Korean particles attach as suffixes.
#
# Naming convention:
#   <ATTR>_DIRECT       — single-stem fires alone
#   <ATTR>_<COND>       — co-occurrence-conditioned patterns
# ---------------------------------------------------------------------------

# 4.1 pigmentation
PIGMENTATION_DIRECT: frozenset[str] = frozenset({
    "발색", "채도", "톤다운", "발색력",
    "진하", "진해", "진한", "과하",
    "연하", "연해", "약하", "옅",
    "여러 번 발", "여러번 발",
})
# Idioms shared with application_blending (emit BOTH attributes)
PIGMENTATION_APPLICATION_IDIOMS: frozenset[str] = frozenset({
    "불타는 고구마", "불탄고구마", "불탄 고구마",
})

# 4.2 persistence
PERSISTENCE_DIRECT: frozenset[str] = frozenset({
    "지속력", "유지력",
    "오래가", "오래 가", "오래 유지",
    "금방 사라", "금방 지워", "금방 날", "금방 흐",
    "반나절", "종일",
})

# 4.3 application_blending
APPLICATION_BLENDING_DIRECT: frozenset[str] = frozenset({
    "양조절", "양 조절", "색조절", "색 조절", "발색 조절", "발색조절",
    "뭉침", "뭉쳐", "얼룩", "경계", "밀림",
    "잘 발", "잘 펴", "발림성", "블렌딩",
    "펴바르", "펴 바르",                            # v0.3: contracted verb forms
    "다루기 힘", "한 번에 너무",
    "톡톡 두들", "톡톡 바르",                        # v0.3: technique phrase
    "부드럽게 발",
    "쉽게 연출", "쉬운 편", "쉽게 발", "쉽게 표현",   # v0.3: ease-of-use idioms
    "똥손",                                         # v0.3: ease-of-use marker
})

# 4.4 adhesion_base_interaction
ADHESION_DIRECT: frozenset[str] = frozenset({
    "밀착",
    "들뜸", "들뜨", "들떠",
    "벗겨",
    "안 쌓이", "안쌓이",
    "겉돌",
    "안 올라",
})
# Co-occurrence: base-noun + interaction-verb
ADHESION_BASE_NOUNS: frozenset[str] = frozenset({"베이스", "파데", "쿠션 위"})
ADHESION_INTERACT_VERBS: frozenset[str] = frozenset({
    "밀려", "밀리", "밀렸",                         # v0.3: past-tense conjugation 밀렸
    "지워져", "지워짐",                              # v0.3: noun-form complement
    "벗겨", "안 올라", "안 쌓이", "겉돌",
    "까짐",                                          # v0.3: 베이스 까짐 (chip-off on base)
    "뭉침", "뭉쳐", "뭉치",  # base-interaction artifact, also fires application_blending
})

# 4.5 finish_texture
FINISH_TEXTURE_DIRECT: frozenset[str] = frozenset({
    "촉촉",
    "윤광", "광이", "광택",
    "보송", "블러",
    "끈적", "찐득",
    "매트", "유분",
    "머리카락 붙", "머리카락이 붙",
})

# 4.6 dryness_skin_texture
DRYNESS_DIRECT: frozenset[str] = frozenset({
    "건조", "퍼석", "텁텁",
    "각질", "모공", "요철",
})

# 4.7 color_tone_matching
COLOR_TONE_DIRECT: frozenset[str] = frozenset({
    "톤", "쿨톤", "웜톤", "여쿨", "봄웜", "라이트톤", "다크톤",
    "노란피부", "백옥",
    "찰떡", "흰끼", "다크닝", "칙칙", "홍조", "붉어 보",
    "사진과 달", "사진과 다",
    "기대했던 색", "기대한 색",
    "안 맞", "안맞", "잘 어울", "안 어울", "잘 맞",
})
COLOR_TONE_SKIN_NUM_RE = re.compile(r"\d+호")  # 17호, 19호, 21호 etc. as skin-tone designation

# 4.8 packaging_container
PACKAGING_NOUNS: frozenset[str] = frozenset({"케이스", "용기", "캐이스", "뚜껑"})
# explicit-negative-context guard (per schema §4.8)
PACKAGING_NEG_QUALIFIERS: frozenset[str] = frozenset({
    "불편", "깨졌", "샜", "더러", "더럽",                  # v0.3: 더럽 (present-form, complements 더러)
    "위생", "구려", "완성도",
    "다이소보다", "다이소 제품보다", "다이*",                # v0.3: mojibake/censored 다이소 variant
    "이상", "고장", "망가", "흠집", "별로",
    "가성비 떨어",
    "아쉬",                                                  # v0.3: soft-negative qualifier
})
PACKAGING_POS_QUALIFIERS: frozenset[str] = frozenset({
    "예쁘", "이쁘", "이뿌", "이뻐", "이쁜",   # 이쁘/이뿌 are colloquial 예쁘
    "휴대", "편함", "편해", "귀여워", "반짝",
    "디자인 너무", "영롱",
})
# v0.3: implicit-portability fallback — packaging praise without explicit
# 케이스/용기 noun. Fires only when co-occurring with positive qualifier.
PACKAGING_PORTABILITY_PHRASES: frozenset[str] = frozenset({
    "휴대하기", "휴대성도",
    "들고 다니", "가지고 다니",
    "깨질 위험이 없",
    "파우치에",
})
# v0.3: implicit-delivery-condition fallback — specimen-condition complaint
# without explicit packaging noun. Requires ≥2 delivery markers to fire,
# preventing false positives from a single bare mention.
PACKAGING_DELIVERY_PHRASES: frozenset[str] = frozenset({
    "녹은 듯", "구른것", "구른 것", "몇년", "테스터", "반품 후",
    "누가 사용", "새상품을 받은",
    "더럽고", "더러웠",
})

# 4.9 applicator_tool
APPLICATOR_NOUNS: frozenset[str] = frozenset({
    "퍼프", "브러쉬", "브러시", "어플리케이터", "솔",
    "팁",                                                # v0.3: tip applicator (cosmetic context)
})
APPLICATOR_NEG_QUALIFIERS: frozenset[str] = frozenset({
    "불편", "뻣뻣", "더러", "사용 어려",
    "빠져", "고장", "망가",
    "까매", "까매서",                                    # v0.3: blackened/dirtied applicator
    "걸리는",                                            # v0.3: snags
})
APPLICATOR_POS_QUALIFIERS: frozenset[str] = frozenset({
    "부드러", "사용감 좋",
    "쫀쫀", "말랑", "말랑말랑",                          # v0.3: tactile feature words
})
# Special: 손톱 mention with color-staining is applicator_tool negative
APPLICATOR_NAIL_STAIN: frozenset[str] = frozenset({
    "손톱에 색", "손톱에 묻", "손톱에 물",
})

# 4.10 value_price
VALUE_PRICE_DIRECT: frozenset[str] = frozenset({
    "가격", "가성비", "비싸", "비싼",
    "저렴", "세일", "할인",
    "양이 적", "용량",
})

# 4.11 multi_use_lip_cheek_compatibility
# (No records in seed v0.2; vocabulary from schema §4.11)
MULTI_USE_NOUNS: frozenset[str] = frozenset({
    "립앤치크", "립 앤 치크", "겸용", "다용도",
})
MULTI_USE_LIP_VERBS: frozenset[str] = frozenset({
    "입술이 갈라", "입술이 부르터", "입술에 발라", "입술에도",
})

# 4.12 transfer_resistance — REQUIRES carrier surface (schema §4.12)
TRANSFER_CARRIERS: frozenset[str] = frozenset({
    "마스크", "옷에 묻", "옷이 묻", "옷도 묻", "옷에 다",
    "손등에 다", "손등에 묻",
    "기름종이",
})
TRANSFER_VERBS: frozenset[str] = frozenset({
    "묻어", "약합", "약해", "옮겨", "베어", "지워져",
})
# Negation-positive: "안 묻어" / "묻어나지 않" → positive on transfer_resistance
# (Detected as a candidate; stage 2 polarity decides direction)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _first_match(text: str, patterns: frozenset[str]) -> str | None:
    """Return the first pattern in `patterns` found as a substring of `text`."""
    for p in patterns:
        if p in text:
            return p
    return None


def _any_in(text: str, patterns: frozenset[str]) -> bool:
    return any(p in text for p in patterns)


def _snippet(text: str, anchor: str, width: int = 40) -> str:
    """Return a context snippet (~`width` chars) centered on `anchor`'s first
    occurrence in `text`. Used for the `matched_text` field — gives the
    auditor a small window to verify the candidate.
    """
    if not anchor or not text:
        return anchor or ""
    idx = text.find(anchor)
    if idx < 0:
        return anchor
    half = max(width // 2, 10)
    start = max(0, idx - half)
    end = min(len(text), idx + len(anchor) + half)
    s = text[start:end].replace("\n", " ").replace("\r", " ").strip()
    s = re.sub(r"\s+", " ", s)
    if start > 0:
        s = "…" + s
    if end < len(text):
        s = s + "…"
    return s


# ---------------------------------------------------------------------------
# Per-attribute detectors
# ---------------------------------------------------------------------------


def _detect_pigmentation(text: str) -> str | None:
    p = _first_match(text, PIGMENTATION_DIRECT)
    if p:
        return p
    p = _first_match(text, PIGMENTATION_APPLICATION_IDIOMS)
    if p:
        return p
    return None


def _detect_application_blending(text: str) -> str | None:
    p = _first_match(text, APPLICATION_BLENDING_DIRECT)
    if p:
        return p
    p = _first_match(text, PIGMENTATION_APPLICATION_IDIOMS)
    if p:
        return p
    return None


def _detect_adhesion(text: str) -> str | None:
    # Direct stems that are unambiguous on their own
    p = _first_match(text, ADHESION_DIRECT)
    if p:
        return p
    # Co-occurrence: base-noun + interaction-verb
    if _any_in(text, ADHESION_BASE_NOUNS) and _any_in(text, ADHESION_INTERACT_VERBS):
        # Anchor on the base noun for the snippet
        for n in ADHESION_BASE_NOUNS:
            if n in text:
                return n
    return None


def _detect_finish_texture(text: str) -> str | None:
    return _first_match(text, FINISH_TEXTURE_DIRECT)


def _detect_dryness(text: str) -> str | None:
    return _first_match(text, DRYNESS_DIRECT)


def _detect_color_tone(text: str) -> str | None:
    p = _first_match(text, COLOR_TONE_DIRECT)
    if p:
        return p
    if COLOR_TONE_SKIN_NUM_RE.search(text):
        m = COLOR_TONE_SKIN_NUM_RE.search(text)
        return m.group(0) if m else None
    return None


def _detect_packaging(text: str) -> str | None:
    """Emit packaging_container under one of three rules:

    1. (Primary, schema §4.8) Explicit packaging-noun + explicit qualifier.
       Bare `케이스` mentions without qualifier do NOT fire.
    2. (v0.3 implicit-portability) Portability phrase (`휴대하기`,
       `들고 다니`, etc.) + positive qualifier. Captures praise that
       references portability without naming the case.
    3. (v0.3 implicit-delivery) ≥2 delivery-condition phrases co-occur
       (`녹은 듯`, `구른것`, `테스터`, `반품 후`, etc.). Captures specimen-
       condition complaints without explicit packaging-noun reference.
       The ≥2 threshold prevents false positives from a single bare
       delivery marker.
    """
    # Rule 1: explicit noun + qualifier
    noun = _first_match(text, PACKAGING_NOUNS)
    if noun and (
        _any_in(text, PACKAGING_NEG_QUALIFIERS) or _any_in(text, PACKAGING_POS_QUALIFIERS)
    ):
        return noun
    # Rule 2: implicit-portability + positive qualifier
    port = _first_match(text, PACKAGING_PORTABILITY_PHRASES)
    if port and _any_in(text, PACKAGING_POS_QUALIFIERS):
        return port
    # Rule 3: ≥2 implicit-delivery phrases
    delivery_hits = sum(1 for p in PACKAGING_DELIVERY_PHRASES if p in text)
    if delivery_hits >= 2:
        return _first_match(text, PACKAGING_DELIVERY_PHRASES)
    return None


def _detect_applicator(text: str) -> str | None:
    """Emit applicator_tool only if (noun present) AND (qualifier present).
    Special case: 손톱-stain phrases fire even without a noun list match.
    """
    if _any_in(text, APPLICATOR_NAIL_STAIN):
        return next(iter(p for p in APPLICATOR_NAIL_STAIN if p in text), "손톱")
    noun = _first_match(text, APPLICATOR_NOUNS)
    if not noun:
        return None
    if _any_in(text, APPLICATOR_NEG_QUALIFIERS) or _any_in(text, APPLICATOR_POS_QUALIFIERS):
        return noun
    return None


def _detect_value_price(text: str) -> str | None:
    return _first_match(text, VALUE_PRICE_DIRECT)


def _detect_multi_use(text: str) -> str | None:
    p = _first_match(text, MULTI_USE_NOUNS)
    if p:
        return p
    p = _first_match(text, MULTI_USE_LIP_VERBS)
    if p:
        return p
    return None


def _detect_persistence(text: str) -> str | None:
    return _first_match(text, PERSISTENCE_DIRECT)


def _detect_transfer_resistance(text: str) -> str | None:
    """Emit transfer_resistance only if (external-surface carrier) AND
    (transfer-verb) co-occur. The §4.12 carrier rule prevents bare `묻어`
    mentions (which often refer to applicator-side, not on-mask transfer)
    from emitting candidates.
    """
    carrier = _first_match(text, TRANSFER_CARRIERS)
    if not carrier:
        return None
    if _any_in(text, TRANSFER_VERBS):
        return carrier
    return None


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


_DETECTORS = (
    ("pigmentation", _detect_pigmentation),
    ("persistence", _detect_persistence),
    ("application_blending", _detect_application_blending),
    ("adhesion_base_interaction", _detect_adhesion),
    ("finish_texture", _detect_finish_texture),
    ("dryness_skin_texture", _detect_dryness),
    ("color_tone_matching", _detect_color_tone),
    ("packaging_container", _detect_packaging),
    ("applicator_tool", _detect_applicator),
    ("value_price", _detect_value_price),
    ("multi_use_lip_cheek_compatibility", _detect_multi_use),
    ("transfer_resistance", _detect_transfer_resistance),
)


def extract(review_id: str, text: str) -> list[AttributeCandidate]:
    """Return all unique attribute candidates for a single review.

    At most one candidate per (review_id, attribute) pair. If multiple
    patterns match, the first match's surrounding context is captured in
    `matched_text`.

    Empty / None text returns an empty list.
    """
    if not text:
        return []
    out: list[AttributeCandidate] = []
    for attr, detector in _DETECTORS:
        anchor = detector(text)
        if anchor is None:
            continue
        out.append(AttributeCandidate(
            review_id=review_id,
            attribute=attr,
            matched_text=_snippet(text, anchor),
        ))
    return out


def extract_batch(rows: list[tuple[str, str]]) -> list[AttributeCandidate]:
    """Convenience: extract from a list of (review_id, text) pairs."""
    out: list[AttributeCandidate] = []
    for rid, txt in rows:
        out.extend(extract(rid, txt))
    return out


# ---------------------------------------------------------------------------
# Simple test runner — `python -m src.voc.reporting.phase2e.stage1`
# ---------------------------------------------------------------------------


_DEMO_INPUTS: list[tuple[str, str, list[str]]] = [
    # (review_id, text, expected_attributes)
    ("demo-01", "발색이 너무 좋아요", ["pigmentation"]),
    ("demo-02", "양조절이 어려워요", ["application_blending"]),
    ("demo-03", "마스크에 다 묻어나요", ["transfer_resistance"]),
    ("demo-04", "퍼프가 같이 와요", []),  # bare mention, no qualifier — should NOT fire
    ("demo-05", "퍼프가 더러워서 못 쓰겠어요", ["applicator_tool"]),
    ("demo-06", "색이 안 맞아서 아쉬워요", ["color_tone_matching"]),
    ("demo-07", "촉촉하고 좋아요", ["finish_texture"]),
    ("demo-08", "지속력이 별로에요", ["persistence"]),
    ("demo-09", "베이스가 밀려요", ["adhesion_base_interaction"]),
    (
        "demo-10",
        "두 번만 레이어링 해도 불타는 고구마",
        ["pigmentation", "application_blending"],
    ),
    ("demo-11", "케이스 진짜 너무 구려요", ["packaging_container"]),
    ("demo-12", "케이스가 영롱하니 너무 이뿌네요", ["packaging_container"]),
    ("demo-13", "케이스가 있어요", []),  # bare mention — no qualifier
    ("demo-14", "건조해서 퍼석해요", ["dryness_skin_texture"]),
    ("demo-15", "가격이 좀 있지만 만족이에요", ["value_price"]),
]


def _run_demo() -> None:
    print("Phase 2E Stage 1 — demo runner")
    print("=" * 60)
    pass_count = 0
    fail_count = 0
    for rid, text, expected in _DEMO_INPUTS:
        candidates = extract(rid, text)
        detected = sorted({c.attribute for c in candidates})
        expected_sorted = sorted(set(expected))
        ok = detected == expected_sorted
        status = "OK  " if ok else "FAIL"
        if ok:
            pass_count += 1
        else:
            fail_count += 1
        print(f"  [{status}] {rid}: text={text!r}")
        print(f"         expected: {expected_sorted}")
        print(f"         detected: {detected}")
        for c in candidates:
            print(f"           - {c.attribute}: {c.matched_text!r}")
    print("=" * 60)
    print(f"demo: {pass_count} OK, {fail_count} FAIL")


if __name__ == "__main__":
    _run_demo()
