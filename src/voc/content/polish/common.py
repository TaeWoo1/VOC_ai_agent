"""Shared polish-layer plumbing.

`PolishResult` is the public dataclass every channel module returns.
`run_polish_loop` drives:
    cache lookup → LLM call → JSON parse → editorial validation
                 → retry once with strict-feedback prompt → cache write

`build_strict_retry_prompt` quotes the failing rules back to the LLM
on retry so the second attempt has explicit corrections.

`compute_skeleton_sha256` and `compute_brief_sha256` are stable
hashes used for cache keying and audit.
"""
from __future__ import annotations

import hashlib
import json
import time
from dataclasses import dataclass, field
from typing import Callable, Literal

from src.voc.content.angle_selection import SelectedAngle
from src.voc.content.editorial_validators import (
    EditorialValidationResult,
    validate_editorial_cardnews_ko,
)
from src.voc.content.llm.cache import PolishCache, compute_cache_key
from src.voc.content.llm.client import LLMClient


PolishMode = Literal["full", "hook_only"]
POLISH_MODES: tuple[PolishMode, ...] = ("full", "hook_only")
DEFAULT_POLISH_MODE: PolishMode = "full"

SYSTEM_PROMPT_VERSION = "v1"
EDITORIAL_SCHEMA_VERSION = "1.0"

DEFAULT_MAX_RETRIES: int = 1


# ---------------------------------------------------------------------------
# Result type
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class ValidatorAttempt:
    attempt: int
    ok: bool
    blocking_count: int
    advisory_count: int
    blocking_rules: tuple[str, ...]

    def to_dict(self) -> dict:
        return {
            "attempt": self.attempt,
            "ok": self.ok,
            "blocking_count": self.blocking_count,
            "advisory_count": self.advisory_count,
            "blocking_rules": list(self.blocking_rules),
        }


@dataclass
class PolishResult:
    """Outcome of one polish run.

    `cardnews` is the editorial JSON dict on success and `None` on
    failure. `fallback_used` is True when the editorial pipeline
    gave up and the shipping artifact remains the skeleton.

    Mutable so callers can inject `notes` after construction (the
    runner appends operator-readable context).
    """
    status: Literal["ok", "failed"]
    cardnews: dict | None
    fallback_used: bool
    retry_count: int
    validator_history: tuple[ValidatorAttempt, ...]
    llm_call_count: int
    cache_key: str
    cache_hit: bool
    elapsed_ms: int
    notes: str = ""
    blocking_flags: tuple = field(default_factory=tuple)
    advisory_flags: tuple = field(default_factory=tuple)


# ---------------------------------------------------------------------------
# Stable hashing
# ---------------------------------------------------------------------------


def _sha256_dict(d: dict) -> str:
    """Stable sha256 of a dict by canonical-JSON encoding (sorted keys,
    no extra whitespace, ensure_ascii=False)."""
    blob = json.dumps(d, ensure_ascii=False, sort_keys=True)
    return hashlib.sha256(blob.encode("utf-8")).hexdigest()


def compute_skeleton_sha256(skeleton: dict) -> str:
    return _sha256_dict(skeleton)


def compute_brief_sha256(brief: dict) -> str:
    return _sha256_dict(brief)


# ---------------------------------------------------------------------------
# Strict retry prompt
# ---------------------------------------------------------------------------


def build_strict_retry_prompt(
    base_system_prompt: str,
    last_blocking_flags: tuple,
) -> str:
    """Prepend a feedback block to the system prompt quoting the
    specific rules that failed last time. The LLM is told exactly
    what to fix on the second attempt."""
    if not last_blocking_flags:
        return base_system_prompt
    lines = ["[이전 출력 거부됨] 다음 검증 규칙을 위반했습니다:"]
    for f in last_blocking_flags[:8]:  # cap to avoid prompt bloat
        rule = getattr(f, "rule", "?")
        loc = getattr(f, "location", "?")
        matched = getattr(f, "matched", None)
        detail = getattr(f, "detail", "")
        m_str = f" matched={matched!r}" if matched else ""
        lines.append(f"- {rule} @ {loc}{m_str}: {detail}")
    lines.append(
        "다시 출력하되 위 규칙을 모두 준수하십시오. 모든 숫자(≥10)는 "
        "skeleton과 동일하게 보존하고, 슬라이드 개수/순서/제목을 "
        "변경하지 말고, 선택된 angle을 모든 비-method 슬라이드에서 "
        "반영하십시오."
    )
    feedback = "\n".join(lines)
    return f"{base_system_prompt}\n\n{feedback}"


# ---------------------------------------------------------------------------
# JSON parse with tolerance
# ---------------------------------------------------------------------------


def parse_llm_json(raw: str) -> dict:
    """Parse the LLM's response as JSON. Trims leading/trailing
    whitespace and code fences. Raises ValueError on malformed input.
    """
    if not isinstance(raw, str):
        raise ValueError(f"LLM response was not a string: {type(raw).__name__}")
    s = raw.strip()
    # Strip ```json fences if present
    if s.startswith("```"):
        s = s.split("```", 2)
        # Pattern: ```json\n...\n```  → take the middle chunk
        if len(s) >= 2:
            inner = s[1]
            if inner.startswith("json"):
                inner = inner[4:].lstrip()
            s = inner.rsplit("```", 1)[0].strip()
        else:
            s = "".join(s)
    try:
        parsed = json.loads(s)
    except json.JSONDecodeError as exc:
        raise ValueError(f"LLM returned malformed JSON: {exc}") from exc
    if not isinstance(parsed, dict):
        raise ValueError(
            f"LLM returned JSON of type {type(parsed).__name__}, expected dict"
        )
    return parsed


# ---------------------------------------------------------------------------
# Polish loop
# ---------------------------------------------------------------------------


def run_polish_loop(
    *,
    skeleton: dict,
    brief: dict,
    selected_angle: SelectedAngle,
    analysis_report: dict | None,
    base_system_prompt: str,
    user_prompt: str,
    cardnews_assembler: Callable[[dict, SelectedAngle, dict], dict],
    llm_client: LLMClient,
    cache: PolishCache | None,
    cache_key: str,
    polish_mode: PolishMode,
    style_seed: int | None,
    max_retries: int = DEFAULT_MAX_RETRIES,
) -> PolishResult:
    """Drive cache → LLM → parse → validate → retry → fallback.

    `cardnews_assembler` builds the final editorial-shaped dict from
    (raw_polished_slides, selected_angle, skeleton) — channel-
    specific because slide schemas differ slightly.
    """
    start = time.monotonic()
    history: list[ValidatorAttempt] = []
    llm_calls = 0
    cache_hit = False

    # 1. Cache lookup
    if cache is not None:
        cached = cache.get(cache_key)
        if isinstance(cached, dict):
            cache_hit = True
            # Re-validate (defense in depth — disk corruption etc.)
            v = validate_editorial_cardnews_ko(
                cached, skeleton, brief,
                selected_angle.angle, analysis_report=analysis_report,
            )
            history.append(_attempt_record(0, v))
            if v.ok:
                return _make_result(
                    status="ok", cardnews=cached, fallback_used=False,
                    retry_count=0, history=history, llm_calls=0,
                    cache_key=cache_key, cache_hit=True,
                    elapsed_ms=_elapsed_ms(start),
                    blocking_flags=v.blocking, advisory_flags=v.advisory,
                )
            # Stale cache — fall through to LLM call. Don't delete the
            # entry; let the next set() overwrite atomically.

    # 2. LLM call(s)
    current_system = base_system_prompt
    last_blocking: tuple = ()
    cardnews: dict | None = None

    for attempt in range(1, max_retries + 2):  # 1, 2, ..., max_retries+1
        try:
            llm_calls += 1
            raw = llm_client.complete(system=current_system, user=user_prompt)
        except Exception as exc:  # network / SDK / timeout
            history.append(ValidatorAttempt(
                attempt=attempt, ok=False,
                blocking_count=1, advisory_count=0,
                blocking_rules=(f"llm_exception:{type(exc).__name__}",),
            ))
            return _make_result(
                status="failed", cardnews=None, fallback_used=True,
                retry_count=attempt - 1, history=history,
                llm_calls=llm_calls, cache_key=cache_key, cache_hit=False,
                elapsed_ms=_elapsed_ms(start),
                notes=f"LLM call raised {type(exc).__name__}: {exc}",
            )

        # Parse
        try:
            parsed = parse_llm_json(raw)
        except ValueError as exc:
            history.append(ValidatorAttempt(
                attempt=attempt, ok=False,
                blocking_count=1, advisory_count=0,
                blocking_rules=("malformed_json",),
            ))
            if attempt < max_retries + 1:
                current_system = build_strict_retry_prompt(
                    base_system_prompt,
                    (_pseudo_flag("malformed_json", "response", str(exc)),),
                )
                continue
            return _make_result(
                status="failed", cardnews=None, fallback_used=True,
                retry_count=attempt - 1, history=history,
                llm_calls=llm_calls, cache_key=cache_key, cache_hit=False,
                elapsed_ms=_elapsed_ms(start),
                notes=f"malformed JSON after {attempt} attempt(s): {exc}",
            )

        # Assemble editorial dict
        cardnews = cardnews_assembler(parsed, selected_angle, skeleton)

        # Validate
        v = validate_editorial_cardnews_ko(
            cardnews, skeleton, brief,
            selected_angle.angle, analysis_report=analysis_report,
        )
        history.append(_attempt_record(attempt, v))
        if v.ok:
            # 3. Cache write (only on success)
            if cache is not None:
                try:
                    cache.set(cache_key, cardnews)
                except OSError:
                    pass  # cache failures are non-fatal
            return _make_result(
                status="ok", cardnews=cardnews, fallback_used=False,
                retry_count=attempt - 1, history=history,
                llm_calls=llm_calls, cache_key=cache_key, cache_hit=False,
                elapsed_ms=_elapsed_ms(start),
                blocking_flags=v.blocking, advisory_flags=v.advisory,
            )

        last_blocking = v.blocking
        # Retry with stricter prompt if budget remains
        if attempt < max_retries + 1:
            current_system = build_strict_retry_prompt(
                base_system_prompt, last_blocking
            )
            continue

    # 4. Out of retries — fallback
    return _make_result(
        status="failed",
        cardnews=cardnews,    # last attempt's output (for inspection)
        fallback_used=True,
        retry_count=max_retries + 1 - 1,  # attempts beyond initial = retries used
        history=history,
        llm_calls=llm_calls,
        cache_key=cache_key,
        cache_hit=cache_hit,
        elapsed_ms=_elapsed_ms(start),
        blocking_flags=last_blocking,
        notes=(
            f"validation failed after {max_retries + 1} attempt(s); "
            f"shipping artifact = skeleton"
        ),
    )


def _attempt_record(
    attempt: int, v: EditorialValidationResult
) -> ValidatorAttempt:
    blocking_rules = tuple(sorted({f.rule for f in v.blocking}))
    return ValidatorAttempt(
        attempt=attempt,
        ok=v.ok,
        blocking_count=len(v.blocking),
        advisory_count=len(v.advisory),
        blocking_rules=blocking_rules,
    )


def _pseudo_flag(rule: str, location: str, detail: str):
    """Synthesize a ValidationFlag-shaped object for retry-prompt
    feedback when the failure happened before validation (e.g.
    JSON parse). Avoid coupling to validators.ValidationFlag — duck
    typing in build_strict_retry_prompt is enough."""
    class _F:
        pass
    f = _F()
    f.rule = rule
    f.location = location
    f.matched = None
    f.detail = detail
    return f


def _elapsed_ms(start: float) -> int:
    return int((time.monotonic() - start) * 1000)


def _make_result(
    *,
    status: str,
    cardnews: dict | None,
    fallback_used: bool,
    retry_count: int,
    history: list[ValidatorAttempt],
    llm_calls: int,
    cache_key: str,
    cache_hit: bool,
    elapsed_ms: int,
    blocking_flags: tuple = (),
    advisory_flags: tuple = (),
    notes: str = "",
) -> PolishResult:
    return PolishResult(
        status=status,  # type: ignore[arg-type]
        cardnews=cardnews,
        fallback_used=fallback_used,
        retry_count=retry_count,
        validator_history=tuple(history),
        llm_call_count=llm_calls,
        cache_key=cache_key,
        cache_hit=cache_hit,
        elapsed_ms=elapsed_ms,
        notes=notes,
        blocking_flags=tuple(blocking_flags),
        advisory_flags=tuple(advisory_flags),
    )
