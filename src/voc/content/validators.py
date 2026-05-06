"""Cardnews / buyer-content safety + structural validators.

Phase B owns Korean Instagram cardnews; this module is the single
place where:

- ban lists live (medical / directive / superlative / causal),
- length budgets live (title / bullet),
- structural rules live (slide count, ordering, per-type required
  fields),
- and `validate_instagram_cardnews_ko(...)` runs them all and
  returns a `CardnewsValidationResult`.

The validator is **defense in depth**. The deterministic generator
in `cardnews_generator.py` is supposed to produce output that
already passes; the validator catches drift, fixture surprises, and
later LLM-polish output (Phase C).

Severity model
--------------
- `blocking`  — artifact is not safe to ship. The runner marks
  status=failed in the manifest. Examples: medical claim, causal
  language, directive imperative, superlative without basis,
  bullet over the length budget, missing disclosure.
- `advisory`  — operator review needed but the artifact still
  carries useful structure. Examples: low corpus n without an
  explicit caveat (Phase C extension).

Phase B emits `blocking` flags only — `advisory` is wired in but
unused, kept so Phase C/D can add new rule severities without
touching the validator API.

Char counting
-------------
Korean character lengths are measured against the NFC-normalized
form so a Hangul syllable counts as one character. Decomposed jamo
input is normalized first; mixed Hangul + ASCII is counted by
codepoint after NFC.
"""
from __future__ import annotations

import unicodedata
from dataclasses import dataclass

# ---------------------------------------------------------------------------
# Length budgets
# ---------------------------------------------------------------------------

SLIDE_TITLE_MAX_CHARS_KO: int = 14
BULLET_MAX_CHARS_KO: int = 40
BULLETS_MIN: int = 2
BULLETS_MAX: int = 4
EXPECTED_SLIDE_COUNT: int = 7
SUBTITLE_MAX_CHARS_KO_ADVISORY: int = 80  # not blocking, just a soft cap

# Slide type sequence is locked: cardnews format is deliberately
# fixed in v1 so the renderer can be deterministic.
EXPECTED_SLIDE_TYPES: tuple[str, ...] = (
    "hook",
    "loved",
    "divides",
    "fit",
    "watch_outs",
    "best_for",
    "method",
)

# ---------------------------------------------------------------------------
# Ban lists
# ---------------------------------------------------------------------------
#
# Phase 2E wording-safety contract carries forward: any KO content that
# claims medical effect, makes a causal product-defect attribution,
# uses a directive imperative, or makes a "best of" superlative claim
# without basis is blocked.
#
# Rules are matched as case-sensitive substrings against the rendered
# text on each slide (title + subtitle + every bullet + disclosure).
# Substring match is intentional — `확실히 좋아요` and `확실히 추천` both
# fire on `확실히`, which is the desired behavior for Phase B.

BAN_LIST_MEDICAL_KO: tuple[str, ...] = (
    "효과",
    "효능",
    "알레르기",
    "발진",
    "진정",
    "트러블 완화",
    "치료",
    "처방",
    "의학",
)

BAN_LIST_DIRECTIVE_KO: tuple[str, ...] = (
    "확실히",
    "반드시",
    "강력 추천",
    "강력추천",
    "절대",
    "원인은",
    "개선 필요",
    "개선이 필요",
    "해야 합니다",
    "해야 함",
)

BAN_LIST_SUPERLATIVE_KO: tuple[str, ...] = (
    "최고",
    "1위",
    "베스트",
)

# Causal: "이 제품 때문에 ..." style attribution is dangerous because
# VOC carries correlational evidence only. Match the trailing form
# narrowly so common phrasings like "이 때문에 갈리는" (= because of
# this) used as discourse glue don't trip the rule. Phase B keeps
# only the strongest explicit causal cues.
BAN_LIST_CAUSAL_KO: tuple[str, ...] = (
    "제품 때문",
    "원인이",
    "원인은",
)

# ---------------------------------------------------------------------------
# Result types
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class ValidationFlag:
    """One validation finding.

    `rule` is a stable identifier (test code asserts on it). `location`
    points operators at the failing field, e.g. `slide[3].bullets[1]`.
    `matched` is the offending substring when applicable. `detail` is
    operator-readable.
    """
    rule: str
    severity: str  # "blocking" | "advisory"
    location: str
    matched: str | None = None
    detail: str = ""

    def to_dict(self) -> dict:
        d: dict = {
            "rule": self.rule,
            "severity": self.severity,
            "location": self.location,
            "detail": self.detail,
        }
        if self.matched is not None:
            d["matched"] = self.matched
        return d


@dataclass(frozen=True)
class CardnewsValidationResult:
    """Aggregate result. `ok` is False as soon as any blocking flag
    fires; advisory flags do not flip `ok`."""
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
# Internal helpers
# ---------------------------------------------------------------------------


def _kchars(s: str | None) -> int:
    """Codepoint count after NFC normalization. Returns 0 for None."""
    if not s:
        return 0
    return len(unicodedata.normalize("NFC", s))


def _scan_ban_list(text: str, ban_list: tuple[str, ...]) -> list[str]:
    """Return the subset of ban_list whose entries appear as
    substrings of text. Order preserves ban_list order."""
    if not text:
        return []
    return [term for term in ban_list if term in text]


def _slide_text_for_scan(slide: dict) -> str:
    """Concatenate every operator-visible string field on a slide
    for ban-list scanning. Joined with newlines so substring
    matches don't accidentally span fields."""
    parts: list[str] = []
    for field in ("title", "subtitle", "disclosure"):
        v = slide.get(field)
        if isinstance(v, str):
            parts.append(v)
    for field in ("bullets", "for_bullets", "not_for_bullets"):
        v = slide.get(field) or []
        for b in v:
            if isinstance(b, str):
                parts.append(b)
    return "\n".join(parts)


def _bullet_set_for_count(slide: dict) -> list[str]:
    """The set of bullets that count toward 2..4 budget for a given
    slide type. `best_for` combines for_bullets + not_for_bullets;
    `hook` has no bullets at all."""
    if slide.get("type") == "hook":
        return []
    if slide.get("type") == "best_for":
        return list(slide.get("for_bullets") or []) + list(
            slide.get("not_for_bullets") or []
        )
    return list(slide.get("bullets") or [])


# ---------------------------------------------------------------------------
# Public validator
# ---------------------------------------------------------------------------


def validate_instagram_cardnews_ko(cardnews: dict) -> CardnewsValidationResult:
    """Validate a KO Instagram cardnews JSON.

    Returns a CardnewsValidationResult; never raises on validation
    failures (only on completely malformed input that prevents
    iteration, which would itself be a bug worth crashing on).
    """
    flags: list[ValidationFlag] = []

    if not isinstance(cardnews, dict):
        return CardnewsValidationResult(
            ok=False,
            flags=(
                ValidationFlag(
                    rule="malformed",
                    severity="blocking",
                    location="cardnews",
                    detail="cardnews must be a dict",
                ),
            ),
        )

    # Top-level shape
    if cardnews.get("lang") != "ko":
        flags.append(
            ValidationFlag(
                rule="lang",
                severity="blocking",
                location="cardnews.lang",
                matched=str(cardnews.get("lang")),
                detail="this validator only handles lang=ko",
            )
        )
    if cardnews.get("channel") != "instagram":
        flags.append(
            ValidationFlag(
                rule="channel",
                severity="blocking",
                location="cardnews.channel",
                matched=str(cardnews.get("channel")),
                detail="expected channel=instagram",
            )
        )
    if cardnews.get("format") != "cardnews_7slide":
        flags.append(
            ValidationFlag(
                rule="format",
                severity="blocking",
                location="cardnews.format",
                matched=str(cardnews.get("format")),
                detail="expected format=cardnews_7slide",
            )
        )

    slides = cardnews.get("slides") or []
    if not isinstance(slides, list):
        return CardnewsValidationResult(
            ok=False,
            flags=tuple(flags) + (
                ValidationFlag(
                    rule="malformed",
                    severity="blocking",
                    location="cardnews.slides",
                    detail="slides must be a list",
                ),
            ),
        )

    if len(slides) != EXPECTED_SLIDE_COUNT:
        flags.append(
            ValidationFlag(
                rule="slide_count",
                severity="blocking",
                location="cardnews.slides",
                matched=str(len(slides)),
                detail=f"expected {EXPECTED_SLIDE_COUNT} slides, got {len(slides)}",
            )
        )

    method_slide_seen = False
    for i, slide in enumerate(slides):
        loc = f"slide[{i + 1}]"
        if not isinstance(slide, dict):
            flags.append(
                ValidationFlag(
                    rule="malformed_slide",
                    severity="blocking",
                    location=loc,
                    detail="slide must be a dict",
                )
            )
            continue

        # Index sanity
        idx = slide.get("index")
        if idx != i + 1:
            flags.append(
                ValidationFlag(
                    rule="slide_index",
                    severity="blocking",
                    location=f"{loc}.index",
                    matched=str(idx),
                    detail=f"expected {i + 1}, got {idx!r}",
                )
            )

        # Type sequence
        slide_type = slide.get("type")
        expected_type = EXPECTED_SLIDE_TYPES[i] if i < len(EXPECTED_SLIDE_TYPES) else None
        if expected_type and slide_type != expected_type:
            flags.append(
                ValidationFlag(
                    rule="slide_type",
                    severity="blocking",
                    location=f"{loc}.type",
                    matched=str(slide_type),
                    detail=f"expected {expected_type!r}, got {slide_type!r}",
                )
            )

        # Title length (every slide must have a title)
        title = slide.get("title") or ""
        if not isinstance(title, str) or not title.strip():
            flags.append(
                ValidationFlag(
                    rule="title_present",
                    severity="blocking",
                    location=f"{loc}.title",
                    detail="title is required and non-empty",
                )
            )
        else:
            n = _kchars(title)
            if n > SLIDE_TITLE_MAX_CHARS_KO:
                flags.append(
                    ValidationFlag(
                        rule="title_length",
                        severity="blocking",
                        location=f"{loc}.title",
                        matched=title,
                        detail=f"len={n} > {SLIDE_TITLE_MAX_CHARS_KO}",
                    )
                )

        # Bullet count budget (skip hook)
        bullets = _bullet_set_for_count(slide)
        if slide_type != "hook":
            n_bullets = len(bullets)
            if not (BULLETS_MIN <= n_bullets <= BULLETS_MAX):
                flags.append(
                    ValidationFlag(
                        rule="bullet_count",
                        severity="blocking",
                        location=f"{loc}.bullets",
                        matched=str(n_bullets),
                        detail=(
                            f"expected {BULLETS_MIN}..{BULLETS_MAX} bullets, "
                            f"got {n_bullets}"
                        ),
                    )
                )
            for j, b in enumerate(bullets):
                if not isinstance(b, str) or not b.strip():
                    flags.append(
                        ValidationFlag(
                            rule="bullet_present",
                            severity="blocking",
                            location=f"{loc}.bullets[{j}]",
                            detail="bullet must be a non-empty string",
                        )
                    )
                    continue
                bn = _kchars(b)
                if bn > BULLET_MAX_CHARS_KO:
                    flags.append(
                        ValidationFlag(
                            rule="bullet_length",
                            severity="blocking",
                            location=f"{loc}.bullets[{j}]",
                            matched=b,
                            detail=f"len={bn} > {BULLET_MAX_CHARS_KO}",
                        )
                    )

        # Hook-specific: subtitle is required
        if slide_type == "hook":
            subtitle = slide.get("subtitle") or ""
            if not isinstance(subtitle, str) or not subtitle.strip():
                flags.append(
                    ValidationFlag(
                        rule="hook_subtitle_present",
                        severity="blocking",
                        location=f"{loc}.subtitle",
                        detail="hook slide requires a non-empty subtitle",
                    )
                )

        # Method-specific: disclosure non-empty
        if slide_type == "method":
            method_slide_seen = True
            disclosure = slide.get("disclosure") or ""
            if not isinstance(disclosure, str) or not disclosure.strip():
                flags.append(
                    ValidationFlag(
                        rule="method_disclosure_present",
                        severity="blocking",
                        location=f"{loc}.disclosure",
                        detail="method slide requires a non-empty disclosure",
                    )
                )

        # Ban-list scan over the whole slide text
        scanned = _slide_text_for_scan(slide)
        for term in _scan_ban_list(scanned, BAN_LIST_MEDICAL_KO):
            flags.append(
                ValidationFlag(
                    rule="ban_list_medical",
                    severity="blocking",
                    location=loc,
                    matched=term,
                    detail="medical claim language",
                )
            )
        for term in _scan_ban_list(scanned, BAN_LIST_DIRECTIVE_KO):
            flags.append(
                ValidationFlag(
                    rule="ban_list_directive",
                    severity="blocking",
                    location=loc,
                    matched=term,
                    detail="directive / imperative wording",
                )
            )
        for term in _scan_ban_list(scanned, BAN_LIST_SUPERLATIVE_KO):
            flags.append(
                ValidationFlag(
                    rule="ban_list_superlative",
                    severity="blocking",
                    location=loc,
                    matched=term,
                    detail="superlative claim without comparative basis",
                )
            )
        for term in _scan_ban_list(scanned, BAN_LIST_CAUSAL_KO):
            flags.append(
                ValidationFlag(
                    rule="ban_list_causal",
                    severity="blocking",
                    location=loc,
                    matched=term,
                    detail="causal product-defect attribution",
                )
            )

    if slides and not method_slide_seen:
        flags.append(
            ValidationFlag(
                rule="method_slide_missing",
                severity="blocking",
                location="cardnews.slides",
                detail="cardnews must include a slide of type=method with disclosure",
            )
        )

    blocking_present = any(f.severity == "blocking" for f in flags)
    return CardnewsValidationResult(ok=not blocking_present, flags=tuple(flags))
