"""Hype-token sanitizer for LLM-produced content_plan dicts.

Runs between the LLM's raw JSON output and the Pydantic /
safety-validation layers so the most common hype/exposé tokens
(`미쳤어요`, `인생템`, `무조건`, `최악`, `독한`) don't abort an
otherwise-clean run. Pure pre-processing; the safety validator still
runs on the sanitized output and remains the source of truth for
what is publishable.

Why this exists
---------------
The LLM (gpt-4o at temperature 0.3 with the v2.2.1 prompt) keeps
landing one of the five high-leak hype tokens in fields like
`signature.lead` or `summary.takeaways[]`, even though those tokens
are listed at the top of the prompt as banned and re-listed in the
per-section guidance. Three layers of in-prompt warnings cut the
retry rate but don't eliminate it — and each retry costs a full
LLM round-trip. This sanitizer is a deterministic post-process that
swaps the five tokens for safe paraphrases before validation, so the
run completes on the first try unless something genuinely unsafe is
present.

Hard boundary
-------------
Medical / efficacy tokens (`효능`, `효과를 극대화`, `보장`, `완치`,
`부작용 없음`, etc.) are NEVER auto-replaced — they're flagged in the
sanitize report and left in place so the safety validator catches them
and the run aborts. Auto-rewriting an efficacy claim is a higher-risk
edit than swapping a hype word; we keep that boundary intentional.

The sanitizer is a *retry-rate optimization*, not a replacement for
the safety validator. The validator still has the final say on what
gets published.
"""
from __future__ import annotations

import json
from dataclasses import asdict, dataclass, field
from pathlib import Path


# ---------------------------------------------------------------------------
# Replacement tables
# ---------------------------------------------------------------------------


# High-leak hype tokens → safe replacement. Each entry is a single
# substring swap. Replacements are chosen for minimal grammatical
# disruption — they slot into most Korean sentence shapes without
# leaving an obvious seam. The mapping is the contract; tests assert
# each entry.
HYPE_REPLACEMENTS: dict[str, str] = {
    "미쳤어요": "인상적이에요",
    "인생템": "만족도가 높았던 제품",
    "무조건": "먼저",
    "최악": "아쉬웠다는 의견",
    "독한": "자극적으로 느꼈다는 의견",
}


# Medical / efficacy tokens. Listed verbatim from the prompt's banned
# list. These are FLAGGED, not replaced — auto-rewriting an efficacy
# claim risks producing a clean-looking-but-still-misleading sentence.
# The safety validator still catches them on its second pass; the
# sanitize report tells the operator which field needs manual rewrite.
MEDICAL_FLAGGED_TOKENS: tuple[str, ...] = (
    "치료",
    "완치",
    "보장",
    "부작용 없음",
    "효능 보장",
    "효과가 극대화",
    "효과를 극대화",
    "효과를 높여요",
    "효과를 높여줘요",
    "효과를 높이는",
    "효능이 좋아져요",
    "효능이 있어요",
    "효과를 보장",
    "효과가 확실",
    "효능",
)


# ---------------------------------------------------------------------------
# Report types
# ---------------------------------------------------------------------------


@dataclass
class SanitizeReplacement:
    """One auto-replacement event in the report."""
    field_path: str
    original: str
    replacement: str
    count: int


@dataclass
class SanitizeFlag:
    """One medical / efficacy token left in place in the report."""
    field_path: str
    token: str
    snippet: str  # ±20 chars around the match for context


@dataclass
class SanitizeReport:
    replaced: list[SanitizeReplacement] = field(default_factory=list)
    flagged_unsafe: list[SanitizeFlag] = field(default_factory=list)

    def total_replacements(self) -> int:
        return sum(r.count for r in self.replaced)

    def has_changes(self) -> bool:
        return bool(self.replaced or self.flagged_unsafe)

    def to_dict(self) -> dict:
        return {
            "replaced": [asdict(r) for r in self.replaced],
            "flagged_unsafe": [asdict(f) for f in self.flagged_unsafe],
            "total_replacements": self.total_replacements(),
            "total_flagged_unsafe": len(self.flagged_unsafe),
        }


# ---------------------------------------------------------------------------
# Walker
# ---------------------------------------------------------------------------


def _snippet(text: str, idx: int, window: int = 20) -> str:
    start = max(0, idx - window)
    end = min(len(text), idx + window)
    s = text[start:end]
    if start > 0:
        s = "…" + s
    if end < len(text):
        s = s + "…"
    return s


def _sanitize_string(s: str, path: str, report: SanitizeReport) -> str:
    """Replace hype tokens; flag medical tokens. Returns the new string.

    Replacement is iterative: every hype token in HYPE_REPLACEMENTS is
    swept once. Medical token detection runs on the post-replacement
    string so a hype-then-efficacy combo (rare) still flags the
    efficacy half."""
    out = s
    for token, replacement in HYPE_REPLACEMENTS.items():
        if token in out:
            count = out.count(token)
            out = out.replace(token, replacement)
            report.replaced.append(SanitizeReplacement(
                field_path=path,
                original=token,
                replacement=replacement,
                count=count,
            ))
    for token in MEDICAL_FLAGGED_TOKENS:
        idx = out.find(token)
        if idx >= 0:
            report.flagged_unsafe.append(SanitizeFlag(
                field_path=path,
                token=token,
                snippet=_snippet(out, idx),
            ))
    return out


def _walk_and_sanitize(node: object, path: str, report: SanitizeReport) -> object:
    """Recursively walk dict/list/str. Returns a new structure — input
    is not mutated. Non-string scalars (int, float, bool, None) pass
    through unchanged."""
    if isinstance(node, dict):
        out: dict = {}
        for k, v in node.items():
            child_path = f"{path}.{k}" if path else k
            out[k] = _walk_and_sanitize(v, child_path, report)
        return out
    if isinstance(node, list):
        out_list: list = []
        for i, item in enumerate(node):
            child_path = f"{path}[{i}]"
            out_list.append(_walk_and_sanitize(item, child_path, report))
        return out_list
    if isinstance(node, str):
        return _sanitize_string(node, path, report)
    return node


# ---------------------------------------------------------------------------
# Public entry point
# ---------------------------------------------------------------------------


def sanitize_content_plan(plan: dict) -> tuple[dict, SanitizeReport]:
    """Walk the content_plan recursively, replace hype tokens, flag
    medical tokens. Pure function — input is NOT mutated.

    Returns (sanitized_plan, report).

    Field paths in the report are dotted with bracket-indexed list
    segments, mirroring the safety validator's path encoding:
        `summary.takeaways[2]`,
        `positive_spotlights[0].what_reviewers_liked`.
    """
    report = SanitizeReport()
    sanitized = _walk_and_sanitize(plan, path="", report=report)
    assert isinstance(sanitized, dict)  # plan root is always a dict
    return sanitized, report


def write_sanitize_artifacts(
    *,
    raw_plan: dict,
    sanitized_plan: dict,
    report: SanitizeReport,
    out_dir: Path,
) -> tuple[Path, Path, Path]:
    """Write the three debug artifacts under out_dir.

    Operator can diff raw vs sanitized + read the report. Returns the
    three paths in (raw, sanitized, report) order. Caller decides
    whether to invoke this — typical policy is "only write when the
    report has changes, or when downstream validation later fails."
    """
    out_dir = Path(out_dir).expanduser().resolve()
    out_dir.mkdir(parents=True, exist_ok=True)
    raw_p = out_dir / "_planner_raw.json"
    san_p = out_dir / "_planner_sanitized.json"
    rep_p = out_dir / "_planner_sanitize_report.json"
    raw_p.write_text(
        json.dumps(raw_plan, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    san_p.write_text(
        json.dumps(sanitized_plan, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    rep_p.write_text(
        json.dumps(report.to_dict(), ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    return raw_p, san_p, rep_p
