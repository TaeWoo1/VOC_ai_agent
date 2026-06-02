from __future__ import annotations

import re
from typing import Iterable, Optional

from .schema import ReviewOpsAnalysis

# Strong patterns rejected anywhere in operator-facing action/public text.
# NOTE: bare "필요" is intentionally NOT banned — phrasings like
# "확인 필요 후보" or "갱신 필요 리뷰" must remain valid.
STRONG_BAN: tuple[str, ...] = (
    "해야 합니다",
    "해야 함",
    "반드시",
    "원인은",
    "제품 결함",
    "브랜드가 방치",
    "문제 제품",
    "개선 필요",
    "교체 필요",
)

# Additional bans applied only to landing-page copy text.
LANDING_EXTRA_BAN: tuple[str, ...] = (
    "치료",
    "완치",
    "의학적 효능",
)

# Additional bans applied only to consumer-safe signal summaries.
CONSUMER_EXTRA_BAN: tuple[str, ...] = (
    "숨긴",
    "실체",
    "폭로",
    "속았다",
    "광고에 속지",
)

# review_id-like hex leak detector for consumer surfaces (matches the
# cardnews safety_validator's _HEX12 contract: ≥12 contiguous hex chars).
_HEX12_RE = re.compile(r"\b[0-9a-f]{12,}\b")


class OperatorReportSafetyError(Exception):
    """Raised when validate_operator finds disallowed wording.

    Carries the full list of violations on `.violations` so the CLI (or
    callers) can surface every problem in one pass instead of fix-and-retry.
    """

    def __init__(self, violations: list[str]):
        self.violations = list(violations)
        body = "\n".join(f"  - {v}" for v in self.violations)
        super().__init__(
            "review_ops report failed operator safety validation:\n" + body
        )


def _check_phrases(
    text: Optional[str],
    phrases: Iterable[str],
    *,
    location: str,
    violations: list[str],
) -> None:
    if not isinstance(text, str) or not text:
        return
    for phrase in phrases:
        if phrase in text:
            violations.append(f"{location}: banned phrase {phrase!r}")


def _check_hex_leak(
    text: Optional[str],
    *,
    location: str,
    violations: list[str],
) -> None:
    if not isinstance(text, str) or not text:
        return
    if _HEX12_RE.search(text):
        violations.append(
            f"{location}: review_id-like hex string leaked into public field"
        )


def validate_operator(report: ReviewOpsAnalysis) -> None:
    """Validate operator-facing action/public fields only.

    Targets, per spec:
      - AssetItem.suggested_action (across all 4 buckets)
      - LandingCopy.copy + .rationale  (.copy also gets medical bans)
      - ReplyDraft.draft + .rationale
      - OEMQuestion.question + .rationale
      - ConsumerSafeSignal.summary  (also: hex leak + clickbait/attack bans)

    Does NOT walk HTML, section titles, AssetItem.reason, or quotes.
    Raises OperatorReportSafetyError listing every violation found.
    """
    violations: list[str] = []

    # AssetItem.suggested_action across the four buckets.
    for bucket in ("usable", "stale", "risk", "insight"):
        items = getattr(report.assets, bucket)
        for idx, item in enumerate(items):
            _check_phrases(
                item.suggested_action,
                STRONG_BAN,
                location=f"assets.{bucket}[{idx}].suggested_action",
                violations=violations,
            )

    # Landing-page copy.
    for idx, item in enumerate(report.generated_actions.landing_page_copy):
        copy = item.get("copy", "") if isinstance(item, dict) else ""
        rationale = item.get("rationale", "") if isinstance(item, dict) else ""
        loc_copy = f"generated_actions.landing_page_copy[{idx}].copy"
        loc_rat = f"generated_actions.landing_page_copy[{idx}].rationale"
        _check_phrases(copy, STRONG_BAN, location=loc_copy, violations=violations)
        _check_phrases(copy, LANDING_EXTRA_BAN, location=loc_copy, violations=violations)
        _check_phrases(rationale, STRONG_BAN, location=loc_rat, violations=violations)

    # Reply drafts.
    for idx, item in enumerate(report.generated_actions.reply_drafts):
        draft = item.get("draft", "") if isinstance(item, dict) else ""
        rationale = item.get("rationale", "") if isinstance(item, dict) else ""
        _check_phrases(
            draft,
            STRONG_BAN,
            location=f"generated_actions.reply_drafts[{idx}].draft",
            violations=violations,
        )
        _check_phrases(
            rationale,
            STRONG_BAN,
            location=f"generated_actions.reply_drafts[{idx}].rationale",
            violations=violations,
        )

    # OEM questions.
    for idx, item in enumerate(report.generated_actions.oem_questions):
        question = item.get("question", "") if isinstance(item, dict) else ""
        rationale = item.get("rationale", "") if isinstance(item, dict) else ""
        _check_phrases(
            question,
            STRONG_BAN,
            location=f"generated_actions.oem_questions[{idx}].question",
            violations=violations,
        )
        _check_phrases(
            rationale,
            STRONG_BAN,
            location=f"generated_actions.oem_questions[{idx}].rationale",
            violations=violations,
        )

    # Consumer-safe signal summaries: strong + clickbait/attack + hex leak.
    for idx, sig in enumerate(report.consumer_safe_signals):
        summary = sig.get("summary", "") if isinstance(sig, dict) else ""
        loc = f"consumer_safe_signals[{idx}].summary"
        _check_phrases(summary, STRONG_BAN, location=loc, violations=violations)
        _check_phrases(summary, CONSUMER_EXTRA_BAN, location=loc, violations=violations)
        _check_hex_leak(summary, location=loc, violations=violations)

    if violations:
        raise OperatorReportSafetyError(violations)
