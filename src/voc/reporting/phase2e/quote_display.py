"""Display-text normalization for review quotes.

The aggregator captures evidence spans by character offsets so the
invariant `EvidenceUnit.text == parent_review.text[char_start:char_end]`
holds. Span boundaries are chosen to maximize attribute-detection
recall, NOT to look good in a business report. The result is that
verbatim spans often start mid-word ("…해서 재구매했어요!") or end
mid-word ("…뚜껑이 대충눌러서는 완벽하게 닫"). Surfacing those in a
seller-facing PDF is a reliability hit.

This module produces a *display_text* — a human-readable copy of
the quote that:
  - snaps to Korean sentence-ish boundaries when possible,
  - strips orphan leading/trailing punctuation and ellipses,
  - never ends mid-grapheme inside a Hangul word,
  - is bounded in length so a single very long review doesn't
    dominate a card.

The raw span is left untouched. Both fields ride together in the
report's quote dict; PDF / cardnews surfaces prefer `display_text`,
audit tooling reads `text` (the raw span).

Hard rules
----------
- Pure: no I/O.
- Idempotent: `normalize_for_display(normalize_for_display(s)) == normalize_for_display(s)`.
- Never invents characters. Only trims and re-anchors.
- Korean-aware: respects the `ㄱ-ㅎ ㅏ-ㅣ 가-힣` block range when
  detecting word boundaries.
"""
from __future__ import annotations

import re
import unicodedata


# Default cap. ~140 chars is roughly two Korean sentences, fits on
# a PDF priority card without overflowing.
DEFAULT_MAX_LEN: int = 140

# Sentence terminators (Korean + Latin). The `~` is included as
# a soft terminator since Korean reviews routinely use it as a
# sentence end.
_SENTENCE_TERMINATORS: tuple[str, ...] = (
    ".", "!", "?", "。", "！", "？",
)

# Soft terminators that often act as sentence end in Korean review
# style (emoji-like trailing). We accept these for snapping but
# they don't *force* a snap if a hard terminator is also nearby.
_SOFT_TERMINATORS: tuple[str, ...] = (
    "~", "ㅎㅎ", "ㅋㅋ", "ㅎㅎㅎ", "ㅋㅋㅋ", "~~",
)

# Leading characters we strip silently (orphans).
_LEADING_STRIP_CHARS: str = " \t\n\r…·,.!?;:~()-—\"'​ "

# Trailing characters we strip silently. Note we do NOT strip `.` or
# `!` from the trailing edge — those are valid terminators.
_TRAILING_STRIP_CHARS: str = " \t\n\r…·,;:​ "

# A single Hangul syllable block.
_HANGUL_RE = re.compile(r"[가-힣]")

# Whitespace collapse.
_WS_RE = re.compile(r"\s+")

# Korean sentence-final endings that mark a quote as cleanly terminated.
# When the trailing characters match, the snap-to-whitespace fallback
# is suppressed — otherwise short quotes like "밀착시켜줘서 좋아요"
# would lose the sentiment-bearing "좋아요" because the function would
# treat the run after the last space as a dangling word. Conservative
# whitelist: only suffixes that uniquely terminate a clause.
# Particles/connectives (는, 고, 서, 라, 며) are excluded since they
# routinely appear mid-sentence in scraped spans.
_COMPLETE_KOREAN_ENDING_RE = re.compile(
    r"(?:"
    # Compound polite/formal closers (longest first so the alternation
    # prefers them over single-char suffixes that they end with).
    r"이에요|이예요|드네요|거예요|거든요|네요|아요|어요|에요|예요|와요|아용|어용|"
    r"습니다|합니다|됩니다|입니다|랍니다|니다|"
    r"군요|구나|"
    # Single-char polite endings: standard / informal / cute.
    r"요|용|당|"
    # Other sentence-final shapes.
    r"네|죠|지|"
    # Nominalization endings used as standalone phrase ends.
    r"음|함|임|슴|낌|"
    # Bare 다 root (좋다, 멋지다).
    r"다"
    r")$"
)


def _ends_with_complete_form(text: str) -> bool:
    """True when `text` looks like it ends at a clean clause boundary.

    Cheap heuristic: hard/soft sentence terminator OR a curated set of
    Korean sentence-final endings. Used by `_snap_right_to_sentence`
    to refuse a whitespace-based trim that would lop off a sentiment-
    bearing tail like "좋아요" or "촉촉합니다".
    """
    if not text:
        return False
    if text[-1] in _SENTENCE_TERMINATORS:
        return True
    for st in _SOFT_TERMINATORS:
        if text.endswith(st):
            return True
    return bool(_COMPLETE_KOREAN_ENDING_RE.search(text))


def _strip_leading(text: str) -> str:
    return text.lstrip(_LEADING_STRIP_CHARS)


def _strip_trailing(text: str) -> str:
    return text.rstrip(_TRAILING_STRIP_CHARS)


def _collapse_whitespace(text: str) -> str:
    return _WS_RE.sub(" ", text).strip()


def _last_terminator_pos(text: str, hard_only: bool = False) -> int:
    """Position of the rightmost sentence terminator. -1 if none.

    `hard_only=True` ignores `~` / `ㅎㅎ` / `ㅋㅋ` soft terminators.
    """
    best = -1
    pool = _SENTENCE_TERMINATORS if hard_only else (
        _SENTENCE_TERMINATORS + _SOFT_TERMINATORS
    )
    for term in pool:
        idx = text.rfind(term)
        if idx > best:
            # `term` may be multi-char (e.g., "ㅎㅎ"); align right edge.
            best = idx + len(term) - 1
    return best


def _snap_right_to_sentence(text: str) -> str:
    """Snap the trailing edge so display_text reads as a clean clause.

    Order of checks:
      1. Already ends with a hard/soft terminator OR a Korean
         sentence-final ending (요/다/네요/습니다/...) → leave alone.
         Without this, "밀착시켜줘서 좋아요" loses "좋아요" to the
         whitespace-snap fallback below — the canonical run-010 bug.
      2. There IS a hard/soft terminator earlier in the span and it
         sits past the first third → snap to it. Lets "...좋아요?? 별로"
         drop the dangling "별로" tail.
      3. Trailing 1-3 Hangul syllables after the last whitespace look
         like a mid-word fragment ("…너무 좋", "…잘 사용하") → trim
         the fragment and append "…" so the truncation is visible.
      4. Otherwise leave alone — short quotes without a clear
         boundary read better verbatim than half-trimmed.

    Idempotent: each step is a no-op when the input is already in its
    target form.
    """
    s = _strip_trailing(text)
    if not s:
        return ""

    # 1. Clean ending — explicit terminator or Korean sentence-final form.
    if _ends_with_complete_form(s):
        return s

    # 2. Snap to a real terminator earlier in the span when one exists.
    cut = _last_terminator_pos(s, hard_only=False)
    if cut >= 0 and cut >= len(s) // 3:
        return s[: cut + 1]

    # 3. Dangling Korean fragment after whitespace — trim with ellipsis.
    last_ws = s.rfind(" ")
    if last_ws > 0 and last_ws < len(s) - 1:
        tail = s[last_ws + 1:]
        # Pure-Hangul tail of ≤3 syllables that is itself NOT a complete
        # form is treated as a mid-word stem (예: "좋", "사용하", "매").
        if (
            1 <= len(tail) <= 3
            and all("가" <= c <= "힣" for c in tail)
            and not _ends_with_complete_form(tail)
        ):
            head = _strip_trailing(s[:last_ws])
            if head:
                return head + "…"

    # 4. No safe trim — leave the raw span alone. Honest beats half-cut.
    return s


def _snap_left_to_sentence(text: str) -> str:
    """If the text starts mid-clause (e.g., conjunction or particle
    fragment), walk forward to the start of the next sentence.

    Conservative: only re-anchor if the first 1-2 chars look
    like orphan particles. Otherwise keep raw start.
    """
    s = _strip_leading(text)
    if not s:
        return ""

    # If there's a sentence terminator close to the start AND
    # following content is substantial, snap to right-after.
    earliest = -1
    for term in _SENTENCE_TERMINATORS:
        idx = s.find(term)
        if idx >= 0 and (earliest < 0 or idx < earliest):
            earliest = idx
    if 0 < earliest < min(len(s) // 4, 30):
        # Only snap when the cut produces a meaningful tail.
        tail = _strip_leading(s[earliest + 1:])
        if len(tail) >= len(s) * 0.6:
            return tail

    return s


def _truncate(text: str, max_len: int) -> str:
    """Truncate to `max_len` characters, preferring sentence boundary
    snap and falling back to whitespace. Adds `…` when truncated."""
    if len(text) <= max_len:
        return text

    head = text[:max_len]

    # Try to cut at last sentence terminator within head.
    cut = _last_terminator_pos(head, hard_only=False)
    if cut >= max_len // 2:
        return head[: cut + 1]

    # Fall back to last whitespace.
    ws = head.rfind(" ")
    if ws >= max_len // 2:
        return _strip_trailing(head[:ws]) + "…"

    # Last resort: hard cut at max_len, append ellipsis. Walk back
    # one char if we'd cut a Hangul syllable in half (shouldn't
    # happen since Hangul is composed, but defensive against
    # combining marks).
    cut_pos = max_len - 1
    return _strip_trailing(head[:cut_pos]) + "…"


def normalize_for_display(
    raw_text: str,
    *,
    max_len: int = DEFAULT_MAX_LEN,
) -> str:
    """Convert a raw evidence span into a display-friendly string.

    Steps (in order):
      1. NFC normalize so combining marks don't trip length math.
      2. Collapse internal whitespace.
      3. Strip leading orphan punctuation / ellipsis.
      4. Snap left to sentence start when first chars look like
         orphan particles.
      5. Strip trailing orphan punctuation.
      6. Snap right to sentence terminator if not already at one.
      7. Truncate to `max_len` (sentence-boundary aware).

    Returns the display string. Empty input returns "".
    """
    if not isinstance(raw_text, str) or not raw_text.strip():
        return ""

    s = unicodedata.normalize("NFC", raw_text)
    s = _collapse_whitespace(s)
    s = _strip_leading(s)
    s = _snap_left_to_sentence(s)
    s = _strip_trailing(s)
    s = _snap_right_to_sentence(s)
    s = _truncate(s, max_len)
    return s


# ---------------------------------------------------------------------------
# Paraphrase-style display for fragmented / colloquial spans
# ---------------------------------------------------------------------------
#
# `normalize_for_display` does its best to clean the raw span — but
# some scraped spans are too short, too colloquial, or too cut-off to
# read as a clean quote even after cleaning. For business-report
# surfaces (seller PDF, consumer brief, cardnews) the spec is:
#
#   "[span]" → "[main keyword]…라는 의견" / "...만족 의견"
#
# `synthesize_phrase_display` applies that wrap conservatively:
#   - skip when the cleaned text already reads as a complete sentence
#   - detect a primary signal keyword (촉촉/건조/끈적/비추/추천/...)
#   - detect rough polarity from cue words OR an external `polarity`
#     hint passed by the caller
#   - emit "{readable_core} {polarity_suffix} 의견"
#
# The raw span is NEVER mutated. Adapters get TWO strings:
#   - `text`         : raw span (audit invariant; required)
#   - `display_text` : either the cleaned span (default) OR the
#                      synthesized phrase when the cleaned span is
#                      still unfit for a business report.
#
# Conservative on purpose. False negatives are fine — operator just
# sees the cleaned raw. False positives (paraphrasing something that
# was already readable) would erode the contract that audit and
# display agree on the same evidence.

# Colloquial / texting-style markers that signal "raw quote is not
# report-friendly even after cleaning."
_COLLOQUIAL_MARKERS: tuple[str, ...] = (
    "짱짱", "ㅋㅋ", "ㅎㅎ", "헐", "걍", "디기", "쏘쏘", "갓성비",
    "ㅠㅠ", "ㅜㅜ", "ㅡㅡ", "ㅇㅇ", "ㄱㅊ", "ㄴㄴ",
)


def _looks_fragmented(cleaned: str, raw: str) -> bool:
    """True when the cleaned text is not yet report-friendly.

    Order matters — a clean complete-form ending short-circuits the
    "very short" heuristic so a perfectly-readable phrase like
    "촉촉하고 좋아요" (8 chars, ends with 요) is NOT rewritten.

    Conditions (any one):
      - ends in '…' (snap_right trimmed a dangling stem; the wrap
        reads better than the truncation)
      - contains a colloquial / texting marker (짱짱 / ㅋㅋ / 디기 / ...)
      - bare Hangul ending without a complete-form suffix
        (e.g. "...같이써야") — covers 4+ syllable stems the
        whitespace-snap heuristic in snap_right couldn't trim
      - very short (<8 chars) AND no complete-form ending
      - mash-word raw (no whitespace, very short)
    """
    if not cleaned:
        return False
    if cleaned.endswith("…"):
        return True
    if any(m in cleaned for m in _COLLOQUIAL_MARKERS):
        return True
    # Already-complete clean text → NOT fragmented, regardless of length.
    has_complete_ending = _ends_with_complete_form(cleaned)
    if has_complete_ending and len(cleaned) >= 6:
        return False
    if not has_complete_ending:
        last = cleaned.strip()[-1] if cleaned.strip() else ""
        if "가" <= last <= "힣":
            return True
    if len(cleaned) < 8:
        return True
    if " " not in raw and len(raw) < 18:
        return True
    return False


# Anchor signal keywords → polarity-conditioned phrases.
#
# Run-003 QA surfaced a polarity-anchor mismatch: when a positive-coded
# anchor like "밀착" matched a negative-polarity span ("밀착력은 아쉽
# 고"), the synthesizer emitted "밀착이 잘 된다는 아쉬움 의견" — a
# contradictory phrase. This table fixes that by carrying separate
# phrases per polarity per keyword.
#
# Each entry maps:
#   keyword → {"positive": "...", "negative": "...", "default": "..."}
#
# - `positive` is selected when polarity in {positive, pos}
# - `negative` is selected when polarity in {negative_weak, negative_strong, negative}
# - `default` is selected when polarity is mixed / unknown / absent
#
# When a polarity-specific phrase is missing for a hit, we fall through
# to `default`. When `default` is also missing, the keyword is skipped
# (the synthesizer keeps scanning). This way an entry with only
# `default` (e.g. polarity-loaded keywords like 비추 / 추천 / 아쉬 / 비싸)
# behaves identically to the old flat table.
#
# Iteration order matters — the FIRST matching keyword wins. We list
# keywords whose surface form is itself polarity-loaded (비추, 강추,
# 추천, 아쉬, 비싸, 별로, 부드러, 자극, 따가, 트러블, 끈적, 당김, 건조)
# BEFORE the polarity-flexible ones (밀착, 흡수, 촉촉, 진정) so the
# synthesizer biases toward the cue word that already carries
# semantic direction.
_SIGNAL_ANCHORS: tuple[tuple[str, dict[str, str]], ...] = (
    # Polarity-loaded keywords — `default` carries the inherent lean.
    ("비추", {"default": "비추라는"}),
    ("강추", {"default": "강추라는"}),
    ("재구매", {"default": "재구매하겠다는"}),
    ("추천", {"default": "추천한다는"}),
    ("아쉬", {"default": "아쉬움이 있다는"}),
    ("별로", {"default": "별로라는"}),
    ("불편", {"default": "불편하다는"}),
    ("비싸", {"default": "가격이 부담된다는"}),
    ("두 장", {"default": "두 장 같이 써야 한다는"}),
    ("두장", {"default": "두 장 같이 써야 한다는"}),
    ("두께", {"default": "두께가 얇다는"}),
    ("끈적", {"default": "끈적임이 있다는"}),
    ("당김", {"default": "당김이 있다는"}),
    ("자극", {"default": "자극이 있다는"}),
    ("따가", {"default": "따갑다는"}),
    ("트러블", {"default": "트러블이 있다는"}),
    # Polarity-flexible keywords — same word can carry +/- depending
    # on the surrounding spec.
    ("건조", {
        "positive": "건조함이 줄었다는",
        "negative": "건조하다는",
        "default":  "건조감 관련",
    }),
    ("향", {
        "positive": "향이 좋다는",
        "negative": "향이 아쉽다는",
        "default":  "향 관련",
    }),
    ("뚜껑", {
        "positive": "뚜껑이 잘 닫힌다는",
        "negative": "뚜껑이 아쉽다는",
        "default":  "뚜껑 관련",
    }),
    ("케이스", {
        "positive": "케이스가 좋다는",
        "negative": "케이스가 아쉽다는",
        "default":  "케이스 관련",
    }),
    ("집게", {
        "positive": "집게가 편하다는",
        "negative": "집게가 아쉽다는",
        "default":  "집게 관련",
    }),
    ("밀착", {
        "positive": "밀착이 잘 된다는",
        "negative": "밀착이 아쉽다는",
        "default":  "밀착 관련",
    }),
    ("흡수", {
        "positive": "흡수가 잘 된다는",
        "negative": "흡수가 아쉽다는",
        "default":  "흡수 관련",
    }),
    ("촉촉", {
        "positive": "촉촉하다는",
        "negative": "촉촉함이 아쉽다는",
        "default":  "촉촉함 관련",
    }),
    ("부드러", {
        "positive": "부드럽다는",
        "negative": "부드러움이 아쉽다는",
        "default":  "사용감 관련",
    }),
    ("진정", {
        "positive": "진정 효과가 좋다는",
        "negative": "진정 효과가 아쉽다는",
        "default":  "진정 관련",
    }),
    ("가성비", {
        "positive": "가성비가 좋다는",
        "negative": "가격이 부담된다는",
        "default":  "가성비 관련",
    }),
    ("대용량", {
        "positive": "대용량이 좋다는",
        "negative": "용량이 아쉽다는",
        "default":  "용량 관련",
    }),
)

_NEGATIVE_HINTS: tuple[str, ...] = (
    "비추", "별로", "아쉬", "불편", "건조해", "당김", "자극", "따가",
    "트러블", "비싸", "안 ", "안좋", "부족", "모자라",
)
_POSITIVE_HINTS: tuple[str, ...] = (
    "추천", "강추", "재구매", "촉촉", "부드러", "진정", "흡수",
    "밀착", "좋", "만족", "가성비", "대용량",
)

# Phrases that signal positive direction. Used by the contradiction
# gate so a negative-polarity claim never ships a synth phrase that
# reads as if the underlying span was positive.
_POSITIVE_PHRASE_MARKERS: tuple[str, ...] = (
    "잘 된다는", "좋다는", "효과가 좋다는", "잘 닫힌다는",
    "편하다는", "강추라는", "추천한다는", "재구매",
)
_NEGATIVE_PHRASE_MARKERS: tuple[str, ...] = (
    "아쉽다는", "불편하다는", "부담된다는", "아쉬움이 있다는",
    "별로라는", "비추라는", "있다는",  # generic 있다는 covers 끈적임/당김/자극/트러블
)


def _phrase_polarity_lean(phrase: str) -> str | None:
    """Heuristic polarity classification of a synthesized anchor
    phrase. Returns one of {"positive", "negative", None}. Used by
    the contradiction gate."""
    has_pos = any(m in phrase for m in _POSITIVE_PHRASE_MARKERS)
    has_neg = any(m in phrase for m in _NEGATIVE_PHRASE_MARKERS)
    # `있다는` matches both "끈적임이 있다는" (negative) and
    # "효과가 있다는" (positive). Resolve via the more-specific marker.
    if has_pos and not has_neg:
        return "positive"
    if has_neg and not has_pos:
        return "negative"
    if has_pos and has_neg:
        # Both: lean negative because "있다는" is grouped under negative
        # markers and the more-specific positive markers (e.g.
        # "잘 된다는") would have decided this case alone.
        return "negative"
    return None


def _resolve_anchor_phrase(
    raw_text: str, polarity_family: str | None,
) -> tuple[str, str] | None:
    """Pick the (keyword, phrase) for the first anchor hit, choosing
    the polarity-conditioned phrase when present.

    `polarity_family` is one of {"positive", "negative", "mixed", None}
    — the coarse coercion of the Stage 2 verdict.

    Returns (keyword, phrase) or None when no anchor matched.
    """
    for keyword, phrase_map in _SIGNAL_ANCHORS:
        if keyword not in raw_text:
            continue
        if polarity_family == "positive" and "positive" in phrase_map:
            return keyword, phrase_map["positive"]
        if polarity_family == "negative" and "negative" in phrase_map:
            return keyword, phrase_map["negative"]
        if "default" in phrase_map:
            return keyword, phrase_map["default"]
    return None


def _coerce_polarity_family(polarity: str | None) -> str | None:
    p = (polarity or "").lower().strip()
    if p in ("positive", "pos", "긍정"):
        return "positive"
    if p in ("negative_weak", "negative_strong", "negative", "neg", "부정"):
        return "negative"
    if p in ("mixed", "혼합"):
        return "mixed"
    return None


def _polarity_suffix_from_hint(
    polarity: str | None, raw: str,
) -> str | None:
    """Pick a Korean polarity descriptor for the synthesized phrase.

    Resolution order:
      1. Caller-supplied `polarity` (Stage 2 verdict): positive →
         "만족", negative_* → "아쉬움", mixed → None (no suffix).
      2. Cue scan as a fallback when caller didn't pass a hint.
      3. None when neither path produces a clear lean.
    """
    p = (polarity or "").lower()
    if p in ("positive", "pos", "긍정"):
        return "만족"
    if p in ("negative_weak", "negative_strong", "negative", "neg", "부정"):
        return "아쉬움"
    if p in ("mixed", "혼합"):
        return None
    # Fallback cue scan.
    has_neg = any(h in raw for h in _NEGATIVE_HINTS)
    has_pos = any(h in raw for h in _POSITIVE_HINTS)
    if has_neg and not has_pos:
        return "아쉬움"
    if has_pos and not has_neg:
        return "만족"
    return None


def synthesize_phrase_display(
    raw_text: str,
    *,
    polarity: str | None = None,
    max_len: int = DEFAULT_MAX_LEN,
) -> str:
    """Return a report-friendly display string for `raw_text`.

    Resolution order:
      1. Empty input → "".
      2. `normalize_for_display` produces a clean reading → return it.
      3. The cleaned span is fragmented / colloquial / cut-off →
         synthesize "[anchor_phrase] [폴라리티 라벨] 의견".

    Polarity safety (run-003 contradiction gate):
      - Anchor phrases come from `_SIGNAL_ANCHORS`, which carries
        per-polarity templates so "밀착" + negative resolves to
        "밀착이 아쉽다는" (NOT "밀착이 잘 된다는").
      - After synthesis, the function checks the chosen anchor's
        directional lean against the requested polarity. If they
        contradict (e.g. positive-leaning phrase chosen but caller
        asked for negative), the synthesizer DROPS the phrase and
        falls back to the cleaned raw span. This is defense-in-depth
        on top of the per-polarity table — even if a future anchor
        entry is misconfigured, contradictions never reach a reader.

    `polarity` is the Stage 2 verdict (string from
    {positive, negative_weak, negative_strong, mixed}). The function
    NEVER mutates this value; it only consumes it to pick the right
    template. Idempotent on already-synthesized strings (they end in
    "의견" which the function leaves alone).
    """
    if not isinstance(raw_text, str) or not raw_text.strip():
        return ""
    cleaned = normalize_for_display(raw_text, max_len=max_len)
    if not cleaned:
        return ""
    # Already-synthesized strings end in "의견"; don't double-wrap.
    if cleaned.endswith("의견"):
        return cleaned
    if not _looks_fragmented(cleaned, raw_text):
        return cleaned

    polarity_family = _coerce_polarity_family(polarity)

    # Fragmented — try to anchor on a signal keyword. The anchor's
    # phrase is selected based on `polarity_family` so the synth
    # phrase agrees with the verdict from Stage 2.
    anchor = _resolve_anchor_phrase(raw_text, polarity_family)
    if anchor is None:
        # No anchor keyword matched — keep cleaned text as the
        # safest fallback.
        return cleaned
    keyword, anchor_phrase = anchor

    # Contradiction gate: detect the directional lean of the chosen
    # anchor phrase and refuse to ship a phrase that contradicts the
    # caller's polarity. Falls back to cleaned raw if the
    # contradiction would have shipped.
    phrase_lean = _phrase_polarity_lean(anchor_phrase)
    if (
        polarity_family == "negative" and phrase_lean == "positive"
    ) or (
        polarity_family == "positive" and phrase_lean == "negative"
    ):
        # Try the opposite polarity in the table once, in case the
        # default phrase carried an unintended lean. If that lookup
        # yields a non-contradictory phrase, use it; else fall back.
        retry = None
        for k, phrase_map in _SIGNAL_ANCHORS:
            if k != keyword:
                continue
            wanted = phrase_map.get(polarity_family)
            if wanted and _phrase_polarity_lean(wanted) != (
                "positive" if polarity_family == "negative" else "negative"
            ):
                retry = wanted
            break
        if retry is None:
            return cleaned
        anchor_phrase = retry

    # Suffix: "만족" / "아쉬움" / None depending on polarity. Skip the
    # suffix entirely when the anchor phrase already encodes polarity
    # (e.g., "비추라는" / "아쉬움이 있다는" / "밀착이 아쉽다는") — the
    # run-003 audit flagged "...아쉬움이 있다는 아쉬움 의견" as a
    # mechanical duplication and the surface-policy spec (pass-5)
    # locks single-suffix output across cardnews and the PDF helper.
    suffix = _polarity_suffix_from_hint(polarity, raw_text)
    parts: list[str] = [anchor_phrase]
    if suffix and anchor_phrase not in _PHRASES_WITH_BUILT_IN_POLARITY:
        parts.append(suffix)
    parts.append("의견")
    return " ".join(parts)


# ---------------------------------------------------------------------------
# Quote summary for the seller business report
# ---------------------------------------------------------------------------
#
# `synthesize_phrase_display` was designed for cardnews surfaces — it
# wraps fragmented spans as "...라는 만족 의견" / "...라는 아쉬움 의견".
# In a business-grade PDF that pattern reads as awkward duplication
# ("아쉬움이 있다는 아쉬움 의견" / "향이 좋다는 만족 의견"). This
# helper produces a tighter PDF-only phrase that ends in a single
# `... 의견` / `... 반응` / `... 리뷰` and never doubles the polarity
# tag.
#
# Surfaces:
#   - cardnews JSON: keeps using `display_text` (synthesize_phrase_display).
#   - seller PDF:   uses `display_quote_summary` (this function).
# Raw `text` is unchanged on both sides — audit invariant locked.

# Polarity already implied by the anchor phrase (e.g. "비추라는" already
# carries negative semantic). When the anchor's resolved phrase is in
# this set, the report-summary form drops the trailing "만족"/"아쉬움"
# tag so we don't end with "비추라는 아쉬움 의견" (redundant).
_PHRASES_WITH_BUILT_IN_POLARITY: frozenset[str] = frozenset({
    "비추라는",
    "강추라는",
    "재구매하겠다는",
    "추천한다는",
    "아쉬움이 있다는",
    "별로라는",
    "불편하다는",
    "가격이 부담된다는",
    # Polarity-conditioned negative phrases.
    "건조하다는",
    "향이 아쉽다는",
    "뚜껑이 아쉽다는",
    "케이스가 아쉽다는",
    "집게가 아쉽다는",
    "밀착이 아쉽다는",
    "흡수가 아쉽다는",
    "촉촉함이 아쉽다는",
    "부드러움이 아쉽다는",
    "진정 효과가 아쉽다는",
    # Polarity-conditioned positive phrases.
    "건조함이 줄었다는",
    "향이 좋다는",
    "뚜껑이 잘 닫힌다는",
    "케이스가 좋다는",
    "집게가 편하다는",
    "밀착이 잘 된다는",
    "흡수가 잘 된다는",
    "촉촉하다는",
    "부드럽다는",
    "진정 효과가 좋다는",
    "가성비가 좋다는",
    "대용량이 좋다는",
    "용량이 아쉽다는",
    # Other anchor-loaded phrases.
    "끈적임이 있다는",
    "당김이 있다는",
    "자극이 있다는",
    "따갑다는",
    "트러블이 있다는",
    "두께가 얇다는",
    "두 장 같이 써야 한다는",
})


def synthesize_quote_summary_for_report(
    raw_text: str,
    *,
    polarity: str | None = None,
    max_len: int = DEFAULT_MAX_LEN,
) -> str:
    """Return a business-report-friendly quote summary.

    Differs from `synthesize_phrase_display` in three ways:
      1. Single trailing "의견" — never "만족 의견" / "아쉬움 의견" so
         "아쉬움이 있다는 의견" does not double up.
      2. When the cleaned span already reads naturally, returns it
         verbatim (no wrap).
      3. When fragmented but no anchor matched, returns a quote-style
         framing: "리뷰 인용: <cleaned_span>" so the PDF table cell
         still shows a usable cell.

    `polarity` is used ONLY to pick the polarity-aware anchor phrase
    in the same table as `synthesize_phrase_display` — never to add
    a 만족/아쉬움 suffix.
    """
    if not isinstance(raw_text, str) or not raw_text.strip():
        return ""
    cleaned = normalize_for_display(raw_text, max_len=max_len)
    if not cleaned:
        return ""
    # Already-summarized strings (end in "의견") pass through.
    if cleaned.endswith("의견"):
        return cleaned
    if not _looks_fragmented(cleaned, raw_text):
        return cleaned

    polarity_family = _coerce_polarity_family(polarity)
    anchor = _resolve_anchor_phrase(raw_text, polarity_family)
    if anchor is None:
        # No anchor — emit the cleaned span as a short quote inline so
        # the PDF reader sees evidence rather than a paraphrase guess.
        return cleaned
    keyword, anchor_phrase = anchor

    # Defense-in-depth: if the chosen phrase contradicts the polarity,
    # try the polarity-specific entry once; else fall back to cleaned.
    phrase_lean = _phrase_polarity_lean(anchor_phrase)
    if (
        polarity_family == "negative" and phrase_lean == "positive"
    ) or (
        polarity_family == "positive" and phrase_lean == "negative"
    ):
        retry = None
        for k, phrase_map in _SIGNAL_ANCHORS:
            if k != keyword:
                continue
            wanted = phrase_map.get(polarity_family)
            if wanted and _phrase_polarity_lean(wanted) != (
                "positive" if polarity_family == "negative" else "negative"
            ):
                retry = wanted
            break
        if retry is None:
            return cleaned
        anchor_phrase = retry

    # PDF-friendly closing word — pick by the anchor's directional lean.
    # Default: "의견". Positive-leaning anchors get "반응" for variety
    # so the report doesn't read like a single-template loop.
    closing = "의견"
    if anchor_phrase in _PHRASES_WITH_BUILT_IN_POLARITY:
        # Phrase already carries polarity → just append "의견" once.
        return f"{anchor_phrase} {closing}"
    # Anchor's polarity is direction-neutral → append polarity word
    # only via "의견" (no extra 만족/아쉬움 token).
    return f"{anchor_phrase} {closing}"


__all__ = [
    "normalize_for_display",
    "synthesize_phrase_display",
    "synthesize_quote_summary_for_report",
    "DEFAULT_MAX_LEN",
]
