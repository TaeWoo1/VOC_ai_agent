"""Phase D1: angle selection layer.

Picks ONE angle from `consumer_insight_brief.angle_candidates` to drive
the editorial cardnews polish. The selected angle is the *lens* for
slide 1's hook subtitle and is required to be reflected (semantically)
on every non-method slide of the editorial output.

Selection is deterministic given the same `(candidates, suggestions,
mode)`; no I/O, no DB, no LLM.

Modes
-----
- `auto`             — channel suggestions[0] → top priority overall
- `strength_first`   — top strength-type candidate
- `tradeoff_first`   — top tradeoff-type candidate
- `risk_first`       — top risk-type candidate
- `segment_first`    — top segment-type candidate

When a `<type>_first` mode finds no qualifying candidate (the brief
emitted no candidates of that type), selection falls back to `auto`
and records the fallback chain for operator audit.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

AngleMode = Literal[
    "auto",
    "strength_first",
    "tradeoff_first",
    "risk_first",
    "segment_first",
]
ANGLE_MODES: tuple[AngleMode, ...] = (
    "auto",
    "strength_first",
    "tradeoff_first",
    "risk_first",
    "segment_first",
)
DEFAULT_ANGLE_MODE: AngleMode = "auto"

_TYPE_BY_MODE: dict[str, str] = {
    "strength_first": "strength",
    "tradeoff_first": "tradeoff",
    "risk_first": "risk",
    "segment_first": "segment",
}


class AngleSelectionError(ValueError):
    """Raised when no angle can be selected at all (empty candidates)."""


@dataclass(frozen=True)
class SelectedAngle:
    """The single angle that drives Phase D editorial polish.

    `angle_id` references an entry in `brief.angle_candidates`.
    `angle` is a frozen copy of the candidate dict so the polish
    layer can read every field without re-resolving against the
    brief.

    `selection_mode` records which mode was *requested*.
    `selection_reason` is operator-readable.
    `fallback_chain` is the modes tried before this one won (e.g.
    `("strength_first",)` when the requested mode found no
    candidate and we fell through to `auto`). Empty tuple when no
    fallback was needed.
    """
    angle_id: str
    angle: dict
    selection_mode: str
    selection_reason: str
    fallback_chain: tuple[str, ...]

    def to_dict(self) -> dict:
        """Serializable form for embedding in editorial JSON `polish_log`."""
        return {
            "angle_id": self.angle_id,
            "type": self.angle.get("type"),
            "ko": self.angle.get("ko"),
            "priority_score": self.angle.get("priority_score"),
            "evidence_n": self.angle.get("evidence_n"),
            "selection_mode": self.selection_mode,
            "selection_reason": self.selection_reason,
            "fallback_chain": list(self.fallback_chain),
        }


def select_angle(
    candidates: list[dict],
    suggestions: list[str] | None = None,
    mode: AngleMode = DEFAULT_ANGLE_MODE,
) -> SelectedAngle:
    """Pick one angle from `candidates`.

    `suggestions` is `brief.channel_angle_recommendations[ch].
    suggested_angle_ids` (already in priority order). When `mode`
    is `auto`, the first valid id from `suggestions` wins; if none
    of them resolve, the top candidate by `priority_score` wins.

    When `mode` is one of `<type>_first`, the top candidate of that
    type wins; if no candidate of that type exists, the function
    transparently falls back to `auto` and records the fallback in
    the returned `SelectedAngle.fallback_chain`.

    Raises `AngleSelectionError` when `candidates` is empty.
    """
    if mode not in ANGLE_MODES:
        raise ValueError(
            f"unknown angle mode {mode!r}; allowed: {ANGLE_MODES}"
        )
    if not candidates:
        raise AngleSelectionError("no angle_candidates to select from")

    suggestions = list(suggestions or [])
    by_id = {c["angle_id"]: c for c in candidates if "angle_id" in c}

    if mode == "auto":
        return _auto_select(candidates, suggestions, by_id, fallback_chain=())

    target_type = _TYPE_BY_MODE[mode]
    matching = sorted(
        [c for c in candidates if c.get("type") == target_type],
        key=lambda c: -(c.get("priority_score") or 0),
    )
    if matching:
        chosen = matching[0]
        return SelectedAngle(
            angle_id=chosen["angle_id"],
            angle=dict(chosen),
            selection_mode=mode,
            selection_reason=f"{mode}: top {target_type} by priority_score",
            fallback_chain=(),
        )
    # No qualifying candidate of the requested type — fall back to auto
    return _auto_select(
        candidates, suggestions, by_id, fallback_chain=(mode,)
    )


def _auto_select(
    candidates: list[dict],
    suggestions: list[str],
    by_id: dict[str, dict],
    *,
    fallback_chain: tuple[str, ...],
) -> SelectedAngle:
    # 1. First valid suggestion id
    for sid in suggestions:
        if sid in by_id:
            base = "auto: channel suggestions[0]"
            reason = (
                base
                if not fallback_chain
                else f"fallback to auto after {fallback_chain[-1]}; {base}"
            )
            return SelectedAngle(
                angle_id=sid,
                angle=dict(by_id[sid]),
                selection_mode="auto",
                selection_reason=reason,
                fallback_chain=fallback_chain,
            )
    # 2. Top candidate overall
    top = max(candidates, key=lambda c: (c.get("priority_score") or 0))
    base = "auto: top priority_score"
    reason = (
        base
        if not fallback_chain
        else f"fallback to auto after {fallback_chain[-1]}; {base}"
    )
    return SelectedAngle(
        angle_id=top["angle_id"],
        angle=dict(top),
        selection_mode="auto",
        selection_reason=reason,
        fallback_chain=fallback_chain,
    )
