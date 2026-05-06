"""Phase B: deterministic Korean Instagram cardnews slot-filler.

Reads `analysis_report.json` and produces a 7-slide cardnews JSON
dict. No LLM call, no re-analysis of raw reviews — every field is
extracted from already-aggregated analysis fields and shaped into
buyer-facing copy.

Slide map (locked v1)
---------------------
1. hook        — quick_decision.verdict_ko (confidence-gated framing)
2. loved       — top strengths by supporting_count
3. divides     — attribute-level pos+neg contradictions + theme contrasts
4. fit         — buyer_segments with confidence >= moderate
5. watch_outs  — monitoring_candidates with n_negative >= threshold
6. best_for    — quick_decision.who_for_ko / who_not_for_ko, with fallback
7. method      — corpus framing + methodology disclosure

Hard contracts
--------------
- Output must pass `validate_instagram_cardnews_ko` from validators.py.
  Length budgets, bullet counts, and ban-list rules are enforced there;
  this module produces output that already conforms.
- analysis_report.json is the single source of truth. No imports from
  src.voc.reporting.phase2e.{stage1, stage2, aggregate}; no DB; no
  network.
- Confidence-gated hook framing: weak → exploratory ("리뷰에서 자주
  보이는 인상"); moderate → "반복되는 인상"; strong → "일관되게 나타나는
  인상". Reuses Phase 2E's confidence rubric vocabulary.
- Failure mode: when source data is too thin for a slide to clear the
  2-bullet floor even with fallback derivation, raise
  `CardnewsGenerationError`. The runner catches and marks
  `instagram_cardnews_json` as `status=failed` in the manifest.

Why slot-fill
-------------
A deterministic slot-fill scaffold is testable, cacheable, fully
mockable (`--mock` is the only path in Phase B), and immune to
wording drift. Phase C will add an LLM polish layer that takes this
output as input and returns fluent copy; the validator runs again
after polish to catch drift.
"""
from __future__ import annotations

import hashlib
import json
import re
from datetime import datetime, timezone
from typing import Any

from src.voc.content._confidence import resolve_overall_confidence
from src.voc.content.editorial_rules import (
    slide_phrase_for as _slide_phrase_for,
)
from src.voc.content.validators import (
    BULLETS_MAX,
    BULLETS_MIN,
    BULLET_MAX_CHARS_KO,
    SLIDE_TITLE_MAX_CHARS_KO,
)


def _selected_profile_id(report: dict) -> str | None:
    """Extract `product.selected_profile_id` from the analysis
    report, returning None when absent. Centralized so every slide
    builder reads from the same field."""
    p = report.get("product") if isinstance(report, dict) else None
    if isinstance(p, dict):
        v = p.get("selected_profile_id")
        if isinstance(v, str) and v.strip():
            return v
    return None


def _ko_topic_particle(noun: str) -> str:
    """Pick the topic particle (은 / 는) based on whether the last
    Hangul syllable carries a batchim (final consonant). Falls back
    to 는 when the input doesn't end in a Hangul syllable.

    Hangul syllable block U+AC00–U+D7A3: each syllable encodes
    `(initial * 21 + medial) * 28 + final`. `(code - 0xAC00) % 28`
    is 0 when there's no final consonant.
    """
    if not noun:
        return "는"
    last = noun.strip()[-1]
    code = ord(last)
    if 0xAC00 <= code <= 0xD7A3:
        return "는" if (code - 0xAC00) % 28 == 0 else "은"
    return "는"


CARDNEWS_SCHEMA_VERSION = "1.0"
CARDNEWS_FORMAT = "cardnews_7slide"
CARDNEWS_LANG = "ko"
CARDNEWS_CHANNEL = "instagram"

# Watch-outs threshold mirrors Phase 2E's contradiction floor — five
# negative mentions is the operator-facing minimum for "this is
# a real signal, not noise."
WATCH_OUTS_MIN_NEGATIVE: int = 5
CONTRADICTION_MIN_PER_SIDE: int = 5

# Locked slide titles (each ≤14 chars KO). Kept here, not in
# the validator, because they are *content* not *rules*.
SLIDE_TITLES_KO: dict[str, str] = {
    "hook": "한 줄 인상",
    "loved": "반복되는 호평",
    "divides": "갈리는 의견",
    "fit": "잘 맞은 분들",
    "watch_outs": "유의 포인트",
    "best_for": "구매 전 점검",
    "method": "분석 기준",
}


# Confidence-gated subtitle leads for the hook slide. The trailing
# colon is intentional — the verdict text follows.
_HOOK_LEAD_BY_CONFIDENCE: dict[str, str] = {
    "weak": "리뷰에서 자주 보이는 인상:",
    "moderate": "리뷰에서 반복되는 인상:",
    "strong": "리뷰에서 일관되게 나타나는 인상:",
}

# Corpus-framed methodology lines, picked by confidence_level.
_METHOD_CORPUS_NOTE_BY_CONFIDENCE: dict[str, str] = {
    "low": "표본이 적어 초기 신호로 해석합니다",
    "medium": "표본 규모는 중간 수준입니다",
    "high": "표본 규모가 충분합니다",
}

DEFAULT_DISCLOSURE_KO = (
    "이 카드뉴스는 공개 리뷰 데이터를 기반으로 정리한 정보이며, "
    "제품의 효능을 보장하지 않습니다."
)
DEFAULT_METHOD_CAVEAT_KO = "리뷰 신호이며 제품 결함을 확정하지 않습니다"


_HTML_TAG_RE = re.compile(r"<[^>]+>")


class CardnewsGenerationError(ValueError):
    """Raised when source data is too thin for the cardnews to satisfy
    structural minimums (e.g. fewer than 2 strengths derivable,
    no observation window, etc.). Caller (run_content.py) catches
    and marks the artifact as `status=failed`."""


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _strip_html(text: str | None) -> str:
    return _HTML_TAG_RE.sub("", text or "").strip()


def _attribute_label_map(report: dict) -> dict[str, str]:
    """Map attribute_key → label_ko using the attributes section of
    the analysis report. Falls back to the key itself when label_ko
    is missing — better to print the key than crash."""
    out: dict[str, str] = {}
    for a in report.get("attributes") or []:
        key = a.get("key")
        if not key:
            continue
        out[key] = a.get("label_ko") or key
    return out


def _attribute_counts(report: dict) -> dict[str, dict]:
    """Map attribute_key → counts dict {n_positive, n_negative,
    n_mixed, evidence_score, label_ko}. Used by slide builders that
    need the polarity distribution behind a strength / contradiction."""
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
            "evidence_score": float(a.get("evidence_score") or 0.0),
        }
    return out


def _truncate(text: str, max_chars: int) -> str:
    """Truncate `text` to fit max_chars; appends `…` when cut.
    Tries to cut at the last whitespace before the budget so we
    don't bisect a Hangul-syllable sequence inside a word.
    """
    if not text:
        return ""
    text = text.strip()
    if len(text) <= max_chars:
        return text
    # Reserve 1 char for the ellipsis.
    head = text[: max_chars - 1]
    last_space = head.rfind(" ")
    if last_space > max_chars // 2:
        head = head[:last_space]
    return head.rstrip(",.- ") + "…"


# ---------------------------------------------------------------------------
# Slide builders
# ---------------------------------------------------------------------------


def _build_slide_hook(
    report: dict,
    confidence: str,
    brief: dict | None = None,
) -> dict:
    """Slide 1 — buyer-facing contrast pair. Two short lines:
    `<top-strength> 강점\n<top-monitoring> 의견 갈림 (만족 N / 불만 M)`.

    The internal-report framing ("리뷰에서 일관되게 나타나는 인상: …")
    that the brief's core_verdict carries is too long for an
    Instagram hook and reads as a methodology footer to a buyer.
    Build the hook locally from per-attribute counts so the
    skeleton is publishable without LLM polish.

    Falls back to a count-paired single-line phrase when there is
    only a strength side, or no monitoring side, or neither.
    """
    profile_id = _selected_profile_id(report)
    counts = _attribute_counts(report)
    if not counts:
        # Last-resort fallback: read brief / quick_decision so the
        # slide can still ship in pathological no-attributes input.
        legacy = ""
        if isinstance(brief, dict):
            legacy = ((brief.get("core_verdict") or {}).get("ko") or "").strip()
        if not legacy:
            quick = report.get("quick_decision") or {}
            legacy = (quick.get("verdict_ko") or "").strip()
        if not legacy:
            raise CardnewsGenerationError(
                "slide_hook: no attributes and no brief/quick_decision verdict"
            )
        return {
            "index": 1,
            "type": "hook",
            "title": SLIDE_TITLES_KO["hook"],
            "subtitle": _truncate(legacy, 80),
        }

    strengths = sorted(
        [(k, c) for k, c in counts.items()
         if c["n_positive"] > c["n_negative"] and c["n_positive"] >= 5],
        key=lambda kv: -kv[1]["n_positive"],
    )
    monitoring = sorted(
        [(k, c) for k, c in counts.items() if c["n_negative"] >= 5],
        key=lambda kv: -kv[1]["n_negative"],
    )

    def _hook_phrase(attr_key: str, label: str, role: str) -> str:
        # Profile-aware noun phrase ("200매 대용량 가성비") wins;
        # else fall back to the display label written in the report.
        return _slide_phrase_for(
            profile_id=profile_id,
            attribute_key=attr_key,
            slide_role=role,
            fallback=label,
        ) or label

    if strengths and monitoring:
        s_key, s = strengths[0]
        m_key, m = monitoring[0]
        # Line 1 uses the loved-phrase ("200매 대용량 가성비"); line 2
        # uses the SHORT display label ("촉촉함/마무리감") so the
        # contrast reads as `<long buyer phrase> | <attribute>`. The
        # watch_out phrase is the right shape for slide 5 but too
        # narrative as a subject in slide 1's hook.
        s_phrase = _hook_phrase(s_key, s["label_ko"], "loved")
        m_label = m["label_ko"]
        n_pos = m["n_positive"]
        n_neg = m["n_negative"]
        line1 = f"{s_phrase}{_ko_topic_particle(s_phrase)} 강점,"
        line2 = (
            f"{m_label}{_ko_topic_particle(m_label)} 의견 갈림 "
            f"(만족 {n_pos} / 불만 {n_neg})"
        )
        # Each line capped to 80 chars (Instagram subtitle budget).
        # The newline is preserved literally — the renderer may
        # collapse it, but for JSON consumers it documents the
        # author's intended break.
        subtitle = f"{_truncate(line1, 80)}\n{_truncate(line2, 80)}"
    elif strengths:
        s_key, s = strengths[0]
        s_phrase = _hook_phrase(s_key, s["label_ko"], "loved")
        subtitle = f"{s_phrase} 만족 후기 {s['n_positive']}건"
        subtitle = _truncate(subtitle, 80)
    elif monitoring:
        m_key, m = monitoring[0]
        m_phrase = _hook_phrase(m_key, m["label_ko"], "watch_out")
        subtitle = f"{m_phrase} 불만 후기 {m['n_negative']}건"
        subtitle = _truncate(subtitle, 80)
    else:
        subtitle = "리뷰량이 부족해 일관된 신호가 보이지 않습니다."

    return {
        "index": 1,
        "type": "hook",
        "title": SLIDE_TITLES_KO["hook"],
        "subtitle": subtitle,
    }


def _build_slide_loved(report: dict, label_map: dict[str, str]) -> dict:
    """Slide 2 — top 2-3 strengths by supporting_count. Falls back
    to the attribute table when `strengths` is missing."""
    strengths_in = list(report.get("strengths") or [])
    if not strengths_in:
        # Fallback: synthesize from attribute table — anything where
        # n_positive > n_negative and supporting count is non-trivial.
        counts = _attribute_counts(report)
        synth = []
        for key, c in counts.items():
            if c["n_positive"] > c["n_negative"] and c["n_positive"] >= 5:
                synth.append({
                    "attribute_key": key,
                    "supporting_count": c["n_positive"],
                })
        strengths_in = synth

    if not strengths_in:
        raise CardnewsGenerationError(
            "slide_loved: no strengths and no positive attributes to derive"
        )

    sorted_str = sorted(
        strengths_in,
        key=lambda s: -(s.get("supporting_count") or 0),
    )
    top = sorted_str[: BULLETS_MAX - 1]  # cap at 3 to leave room for variation

    profile_id = _selected_profile_id(report)
    bullets: list[str] = []
    for s in top[:3]:
        key = s.get("attribute_key")
        if not key:
            continue
        label = label_map.get(key, key)
        n = int(s.get("supporting_count") or 0)
        # Buyer-specific phrase wins ("200매 대용량 가성비"); falls
        # back to the profile-aware display label.
        phrase = _slide_phrase_for(
            profile_id=profile_id, attribute_key=key,
            slide_role="loved", fallback=label,
        ) or label
        bullet = (
            f"{phrase} — 만족 후기 {n}건"
            if n > 0
            else f"{phrase} — 만족 후기 반복"
        )
        bullets.append(_truncate(bullet, BULLET_MAX_CHARS_KO))

    if len(bullets) < BULLETS_MIN:
        raise CardnewsGenerationError(
            f"slide_loved: derived only {len(bullets)} bullet(s); "
            f"need at least {BULLETS_MIN}"
        )

    return {
        "index": 2,
        "type": "loved",
        "title": SLIDE_TITLES_KO["loved"],
        "bullets": bullets[:BULLETS_MAX],
    }


def _build_slide_divides(report: dict) -> dict:
    """Slide 3 — attribute-level contradictions (n_pos AND n_neg both
    >=5) plus theme_contrasts as a secondary source. Bullets are
    rebuilt from the clean attribute counts to bypass the seller
    PDF's HTML-marked sentence_ko."""
    counts = _attribute_counts(report)

    # Primary source: attributes with both polarities clearing the
    # contradiction floor.
    contradictions = []
    for key, c in counts.items():
        if (
            c["n_positive"] >= CONTRADICTION_MIN_PER_SIDE
            and c["n_negative"] >= CONTRADICTION_MIN_PER_SIDE
        ):
            contradictions.append((key, c))
    contradictions.sort(
        key=lambda kv: -(kv[1]["n_positive"] + kv[1]["n_negative"])
    )

    bullets: list[str] = []
    for _, c in contradictions[: BULLETS_MAX]:
        # Buyer-friendly wording: 만족/불만 (matches every other
        # surface in this run), not the older 호평/비판.
        bullet = (
            f"{c['label_ko']} — 만족 {c['n_positive']} / 불만 {c['n_negative']}"
        )
        bullets.append(_truncate(bullet, BULLET_MAX_CHARS_KO))

    # Secondary source: theme_contrasts when bullets is still under
    # the floor. Each contrast is a known operator-curated pair label.
    if len(bullets) < BULLETS_MIN:
        for tc in (report.get("theme_contrasts") or []):
            pair = tc.get("pair_label_ko")
            if pair:
                bullets.append(_truncate(
                    f"{pair} 의견 갈림",
                    BULLET_MAX_CHARS_KO,
                ))
            if len(bullets) >= BULLETS_MAX:
                break

    if len(bullets) < BULLETS_MIN:
        raise CardnewsGenerationError(
            f"slide_divides: derived only {len(bullets)} bullet(s); "
            f"need at least {BULLETS_MIN}"
        )

    return {
        "index": 3,
        "type": "divides",
        "title": SLIDE_TITLES_KO["divides"],
        "bullets": bullets[:BULLETS_MAX],
    }


def _build_slide_fit(
    report: dict,
    brief: dict | None = None,
) -> dict:
    """Slide 4 — audience descriptions for the people this product
    fits.

    Source precedence:
      1. `buyer_segments` (canonical) when present — confidence ≥
         moderate. Weak groupings are not safe as a public
         recommendation.
      2. Fallback: derive from `report.strengths` using the
         profile-aware `slide_phrase_for(slide_role="fit_for")`
         table. This is the path Phase 2E pipelines hit today
         (no buyer_segments emitted). Each bullet reads as a buyer
         description ("대용량 패드를 자주 쓰고 싶은 분 (만족 155건)"),
         not the older tautological "X 만족 후기 N건이 누적되는
         사용자: 잘 맞았다는 의견" template.
    """
    profile_id = _selected_profile_id(report)
    bullets: list[str] = []

    segments = [
        s for s in (report.get("buyer_segments") or [])
        if (s.get("confidence_level") or "").lower() in ("moderate", "strong")
    ]
    sorted_seg = sorted(
        segments, key=lambda s: -(s.get("dominant_count") or 0),
    )
    for s in sorted_seg[:BULLETS_MAX]:
        label = (s.get("label_ko") or "").strip()
        if not label:
            continue
        n = int(s.get("dominant_count") or 0)
        bullets.append(_truncate(
            f"{label} (만족 {n}건)" if n > 0 else f"{label}",
            BULLET_MAX_CHARS_KO,
        ))

    # Fallback: derive buyer-description bullets from per-attribute
    # strengths using the profile-aware phrase table. We deliberately
    # do NOT consume `brief.best_for[*].label_ko` or
    # `quick_decision.who_for_ko` here because those carry the
    # verbose "X 만족 후기 N건이 누적되는 사용자" template that the
    # operator critiqued as tautological.
    if len(bullets) < BULLETS_MIN:
        strengths = sorted(
            list(report.get("strengths") or []),
            key=lambda s: -(s.get("supporting_count") or 0),
        )
        for s in strengths:
            if len(bullets) >= BULLETS_MAX:
                break
            key = s.get("attribute_key")
            if not key:
                continue
            label_map_local = _attribute_label_map(report)
            label = label_map_local.get(key, key)
            phrase = _slide_phrase_for(
                profile_id=profile_id, attribute_key=key,
                slide_role="fit_for", fallback=None,
            )
            n = int(s.get("supporting_count") or 0)
            if phrase:
                bullet = f"{phrase} (만족 {n}건)" if n > 0 else phrase
            else:
                # No profile override → safer count-paired phrase
                # using the display label, NOT the tautological
                # "누적되는 사용자" template.
                bullet = (
                    f"{label} 만족 후기 {n}건"
                    if n > 0
                    else f"{label} 만족 후기 반복"
                )
            bullets.append(_truncate(bullet, BULLET_MAX_CHARS_KO))

    if len(bullets) < BULLETS_MIN:
        raise CardnewsGenerationError(
            f"slide_fit: derived only {len(bullets)} bullet(s); "
            f"need at least {BULLETS_MIN}"
        )

    return {
        "index": 4,
        "type": "fit",
        "title": SLIDE_TITLES_KO["fit"],
        "bullets": bullets[:BULLETS_MAX],
    }


def _build_slide_watch_outs(report: dict, label_map: dict[str, str]) -> dict:
    """Slide 5 — monitoring_candidates with n_negative >= threshold.
    Falls back to attributes with the highest n_negative when no
    monitoring_candidates block exists in the report."""
    candidates = list(report.get("monitoring_candidates") or [])

    qualified = [
        c for c in candidates
        if int(c.get("n_negative") or 0) >= WATCH_OUTS_MIN_NEGATIVE
    ]
    if not qualified:
        # Fallback: attribute table with negatives clearing the
        # threshold. We don't try to invent a concern_label_ko;
        # the attribute label is a safe operator-facing label.
        counts = _attribute_counts(report)
        synth = []
        for key, c in counts.items():
            if c["n_negative"] >= WATCH_OUTS_MIN_NEGATIVE:
                synth.append({
                    "attribute_key": key,
                    "n_negative": c["n_negative"],
                    "concern_label_ko": c["label_ko"],
                })
        qualified = synth

    sorted_q = sorted(qualified, key=lambda c: -(c.get("n_negative") or 0))
    profile_id = _selected_profile_id(report)
    bullets: list[str] = []
    for c in sorted_q[:BULLETS_MAX]:
        attr_key = c.get("attribute_key", "") or ""
        label = c.get("concern_label_ko") or label_map.get(attr_key, attr_key)
        if not label:
            continue
        n = int(c.get("n_negative") or 0)
        # Buyer-friendly complaint shape ("오래 붙이면 답답하다는 후기");
        # falls back to "{label} 불만 후기" — never "비판 의견".
        phrase = _slide_phrase_for(
            profile_id=profile_id, attribute_key=attr_key,
            slide_role="watch_out", fallback=None,
        )
        if phrase:
            bullet = f"{phrase} {n}건" if n else phrase
        else:
            bullet = (
                f"{label} 불만 후기 {n}건" if n else f"{label} 불만 후기"
            )
        bullets.append(_truncate(bullet, BULLET_MAX_CHARS_KO))

    if len(bullets) < BULLETS_MIN:
        raise CardnewsGenerationError(
            f"slide_watch_outs: derived only {len(bullets)} bullet(s) "
            f"above n_negative>={WATCH_OUTS_MIN_NEGATIVE}; "
            f"need at least {BULLETS_MIN}"
        )

    return {
        "index": 5,
        "type": "watch_outs",
        "title": SLIDE_TITLES_KO["watch_outs"],
        "bullets": bullets[:BULLETS_MAX],
    }


def _build_slide_best_for(
    report: dict,
    label_map: dict[str, str],
    brief: dict | None = None,
) -> dict:
    """Slide 6 — best_for / not_for, combined bullet count 2..4.

    Source precedence:
      1. `brief.best_for[*].label_ko` and `brief.not_for[*].label_ko`
         (Phase C: brief is the buyer-facing crystallization).
      2. `analysis_report.quick_decision.who_for_ko` /
         `who_not_for_ko`.
      3. Fallback derivation from segments + monitoring_candidates.
    """
    profile_id = _selected_profile_id(report)
    for_bullets: list[str] = []
    not_for_bullets: list[str] = []

    # ---- for_bullets: profile-aware buyer descriptions from
    # report.strengths. We deliberately do NOT consume
    # brief.best_for or quick_decision.who_for_ko here — those
    # carry the verbose tautological "X 만족 후기 N건이 누적되는
    # 사용자" template that the operator critiqued. The phrase
    # table gives us short, buyer-direct phrases that fit under
    # BULLET_MAX_CHARS_KO without truncation.
    strengths = sorted(
        list(report.get("strengths") or []),
        key=lambda s: -(s.get("supporting_count") or 0),
    )
    for s in strengths:
        if len(for_bullets) >= 2:
            break
        key = s.get("attribute_key") or ""
        if not key:
            continue
        n = int(s.get("supporting_count") or 0)
        phrase = _slide_phrase_for(
            profile_id=profile_id, attribute_key=key,
            slide_role="best_for", fallback=None,
        )
        if phrase:
            bullet = f"{phrase} (만족 {n}건)" if n > 0 else phrase
        else:
            label = label_map.get(key, key)
            bullet = (
                f"{label} 만족 후기 {n}건" if n > 0 else f"{label} 만족 후기"
            )
        for_bullets.append(_truncate(bullet, BULLET_MAX_CHARS_KO))

    # ---- not_for_bullets: profile-aware sensitivity descriptions
    # from report.monitoring_candidates. Falls back to the
    # display label with a count, NEVER the verbose "한 번 더
    # 검토하세요" template that previously truncated mid-character.
    candidates = sorted(
        (report.get("monitoring_candidates") or []),
        key=lambda c: -(c.get("n_negative") or 0),
    )
    for c in candidates:
        if len(not_for_bullets) >= 2:
            break
        key = c.get("attribute_key") or ""
        n = int(c.get("n_negative") or 0)
        if not key or n <= 0:
            continue
        phrase = _slide_phrase_for(
            profile_id=profile_id, attribute_key=key,
            slide_role="not_for", fallback=None,
        )
        if phrase:
            bullet = f"{phrase} ({n}건)"
        else:
            label = (c.get("concern_label_ko") or "").strip() or label_map.get(
                key, key,
            )
            bullet = f"{label} 민감한 분 ({n}건)"
        not_for_bullets.append(_truncate(bullet, BULLET_MAX_CHARS_KO))

    # Last-resort fallback: brief.best_for / quick_decision.who_for_ko
    # ONLY when the strengths/monitoring derivation produced nothing.
    # In practice this fires for analysis_reports that lack both
    # blocks (very thin corpus). The bullet is still truncated to
    # BULLET_MAX_CHARS_KO.
    if not for_bullets and isinstance(brief, dict):
        for entry in (brief.get("best_for") or [])[:2]:
            label = (entry.get("label_ko") or "").strip()
            if label:
                for_bullets.append(_truncate(label, BULLET_MAX_CHARS_KO))
    if not for_bullets:
        quick = report.get("quick_decision") or {}
        for s in (quick.get("who_for_ko") or [])[:2]:
            if isinstance(s, str) and s.strip():
                for_bullets.append(_truncate(s.strip(), BULLET_MAX_CHARS_KO))
    if not not_for_bullets and isinstance(brief, dict):
        for entry in (brief.get("not_for") or [])[:2]:
            label = (entry.get("label_ko") or "").strip()
            if label:
                not_for_bullets.append(_truncate(label, BULLET_MAX_CHARS_KO))
    if not not_for_bullets:
        quick = report.get("quick_decision") or {}
        for s in (quick.get("who_not_for_ko") or [])[:2]:
            if isinstance(s, str) and s.strip():
                not_for_bullets.append(_truncate(s.strip(), BULLET_MAX_CHARS_KO))

    total = len(for_bullets) + len(not_for_bullets)
    if total < BULLETS_MIN:
        raise CardnewsGenerationError(
            f"slide_best_for: derived only {total} bullet(s); "
            f"need at least {BULLETS_MIN}"
        )
    # Cap combined size at BULLETS_MAX, preferring for_bullets first.
    while len(for_bullets) + len(not_for_bullets) > BULLETS_MAX:
        if len(not_for_bullets) > 0:
            not_for_bullets.pop()
        else:
            for_bullets.pop()

    return {
        "index": 6,
        "type": "best_for",
        "title": SLIDE_TITLES_KO["best_for"],
        "for_bullets": for_bullets,
        "not_for_bullets": not_for_bullets,
    }


def _yyyy_mm(value: Any) -> str | None:
    """Best-effort YYYY-MM formatter. Accepts ISO date strings or
    full ISO timestamps; returns None when the input doesn't parse."""
    if not value or not isinstance(value, str):
        return None
    s = value.strip()
    # Full date or datetime — peel the YYYY-MM prefix.
    if len(s) >= 7 and s[4] == "-" and s[5:7].isdigit():
        return s[:7]
    return None


def _build_slide_method(report: dict) -> dict:
    """Slide 7 — corpus + methodology framing. Always includes a
    disclosure (default fallback if methodology_notes is missing)."""
    corpus = report.get("corpus") or {}
    methodology = report.get("methodology_notes") or {}

    disclosure = (methodology.get("disclosure_ko") or "").strip() or DEFAULT_DISCLOSURE_KO

    bullets: list[str] = []

    n_total = corpus.get("n_reviews_total")
    if isinstance(n_total, int) and n_total > 0:
        bullets.append(_truncate(f"리뷰 {n_total}건 분석", BULLET_MAX_CHARS_KO))

    window = corpus.get("observation_window") or {}
    start_yyyy_mm = _yyyy_mm(window.get("start"))
    end_yyyy_mm = _yyyy_mm(window.get("end"))
    if start_yyyy_mm and end_yyyy_mm:
        bullets.append(_truncate(
            f"관찰 기간: {start_yyyy_mm} ~ {end_yyyy_mm}",
            BULLET_MAX_CHARS_KO,
        ))
    elif start_yyyy_mm:
        bullets.append(_truncate(
            f"관찰 시작: {start_yyyy_mm}",
            BULLET_MAX_CHARS_KO,
        ))

    cl = (corpus.get("confidence_level") or "").lower()
    note = _METHOD_CORPUS_NOTE_BY_CONFIDENCE.get(cl)
    if note:
        bullets.append(_truncate(note, BULLET_MAX_CHARS_KO))

    bullets.append(_truncate(DEFAULT_METHOD_CAVEAT_KO, BULLET_MAX_CHARS_KO))

    # Trim to budget; prefer earlier bullets (corpus/window/note) over
    # the always-on caveat which is already encoded in `disclosure`.
    bullets = bullets[:BULLETS_MAX]
    if len(bullets) < BULLETS_MIN:
        bullets.append("리뷰 데이터를 정리한 결과입니다")
        bullets = bullets[:BULLETS_MAX]

    return {
        "index": 7,
        "type": "method",
        "title": SLIDE_TITLES_KO["method"],
        "bullets": bullets,
        "disclosure": disclosure,
    }


# ---------------------------------------------------------------------------
# Top-level
# ---------------------------------------------------------------------------


def _analysis_report_sha256(report: dict) -> str:
    """Stable hash of the report dict, used for back-reference in the
    cardnews JSON. Computed off canonical JSON form."""
    blob = json.dumps(report, ensure_ascii=False, sort_keys=True)
    return hashlib.sha256(blob.encode("utf-8")).hexdigest()


def generate_instagram_cardnews_ko(
    analysis_report: dict,
    *,
    brief: dict | None = None,
) -> dict:
    """Build a Korean Instagram cardnews JSON dict.

    Pure consumer — no DB, no LLM, no I/O.

    `brief` (Phase C+): optional `consumer_insight_brief.json` dict.
    When supplied:
      - hook subtitle reads `brief.core_verdict.ko`
      - slide 6 (best_for / not_for) reads `brief.best_for[*]` /
        `brief.not_for[*]`
      - top-level `confidence_level` reads `brief.confidence_level`
    Without a brief, behavior is unchanged from Phase B (Phase B
    tests still pass).

    Raises `CardnewsGenerationError` when source data is too thin
    for the structural minimums (fewer than 2 bullets derivable on
    any required slide).
    """
    if not isinstance(analysis_report, dict):
        raise CardnewsGenerationError("analysis_report must be a dict")

    label_map = _attribute_label_map(analysis_report)

    # Confidence: brief wins when present (it already encodes our
    # rubric); otherwise resolve from the analysis report directly.
    if isinstance(brief, dict) and brief.get("confidence_level") in (
        "weak", "moderate", "strong"
    ):
        confidence = brief["confidence_level"]
    else:
        confidence = resolve_overall_confidence(analysis_report)

    # Slide builders may raise CardnewsGenerationError — let it
    # propagate so the runner can mark status=failed.
    slides = [
        _build_slide_hook(analysis_report, confidence, brief=brief),
        _build_slide_loved(analysis_report, label_map),
        _build_slide_divides(analysis_report),
        _build_slide_fit(analysis_report, brief=brief),
        _build_slide_watch_outs(analysis_report, label_map),
        _build_slide_best_for(analysis_report, label_map, brief=brief),
        _build_slide_method(analysis_report),
    ]

    # Sanity-check titles up-front so a typo in SLIDE_TITLES_KO
    # surfaces here, not in the post-hoc validator.
    for s in slides:
        title = s.get("title") or ""
        if len(title) > SLIDE_TITLE_MAX_CHARS_KO:
            raise CardnewsGenerationError(
                f"internal: slide '{s.get('type')}' title exceeds "
                f"{SLIDE_TITLE_MAX_CHARS_KO} chars: {title!r}"
            )

    product = dict(analysis_report.get("product") or {})

    return {
        "schema_version": CARDNEWS_SCHEMA_VERSION,
        "lang": CARDNEWS_LANG,
        "channel": CARDNEWS_CHANNEL,
        "format": CARDNEWS_FORMAT,
        "product": {
            "slug": product.get("slug"),
            "name_ko": product.get("name_ko"),
        },
        "analysis_report_sha256": _analysis_report_sha256(analysis_report),
        "source_brief_sha256": (
            _analysis_report_sha256(brief) if isinstance(brief, dict) else None
        ),
        "confidence_level": confidence,
        "slide_count": len(slides),
        "slides": slides,
        "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    }
