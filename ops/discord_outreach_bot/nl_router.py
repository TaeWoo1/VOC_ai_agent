"""M4-A: deterministic natural-language operator router (Discord).

Sits IN FRONT of the broad graph-creation handler (`task_discord_adapter.
handle_nl_message`). It recognizes a SMALL set of operational intents on
EXISTING tasks and routes them to the already-audited cores:

  - set_candidate             -> task_inputs.set_candidate        (records-only)
  - approve_one               -> orchestrator.record_task_approval (intent only)
  - dangerous_external_action -> refuse (ZERO writes)
  - clarification_needed      -> ask  (ZERO writes)
  - create_graph (no match)   -> caller falls through to graph creation

M4-A scope (deliberately narrow): this module does NOT call task_runner, does
NOT dry-run / run / review / rollback, does NOT scaffold a packet folder, and
does NOT collect, send, render, publish, touch a packet status.json /
send_log.md, or invoke Claude Code / network / subprocess. It is rule-based and
pure (no discord.py); unit-testable with tmp stores. The only writes it can
cause are the same ones the slash commands already make: a task snapshot
(set_candidate) and an append-only approvals.log record (approve_one).
"""

from __future__ import annotations

import re
from pathlib import Path
from typing import Any, Optional

import orchestrator as _orch
import task_formatting as _fmt
import task_inputs as _ti
import task_store as _store
from task_model import Task

# --- intents -----------------------------------------------------------------
SET_CANDIDATE = "set_candidate"
APPROVE_ONE = "approve_one"
DANGEROUS = "dangerous_external_action"
CLARIFY = "clarification_needed"
CREATE_GRAPH = "create_graph"   # no operational match -> caller falls through

_PICK_STAGE = "outreach:candidate_shortlist_pick"
# attaching candidate input is safe only pre-execution (mirrors task_inputs)
_PICK_SETTABLE = ("needs_approval", "queued", "blocked")


# --- candidate field extraction ----------------------------------------------
# slug / goods_no use tight charsets; brand / product_name capture up to the
# next comma (operators write comma-separated labelled fields).
_FIELD_RES = {
    "slug": re.compile(r"slug\s*(?:는|은|이|가|:|=)?\s*([A-Za-z0-9_]+)", re.I),
    "goods_no": re.compile(
        r"(?:goods\s*no|goods_no|굿즈\s*번호|상품\s*번호)\s*(?:는|은|이|가|:|=)?\s*"
        r"([A-Za-z0-9_-]+)", re.I),
    "brand": re.compile(r"(?:브랜드|brand)\s*(?:는|은|이|가|:|=)?\s*([^,\n]+)", re.I),
    "product_name": re.compile(
        r"(?:제품명|상품명|product[_ ]?name)\s*(?:은|는|이|가|:|=)?\s*([^,\n]+)", re.I),
}
_COPULA_RE = re.compile(r"\s*(?:이에요|예요|입니다|이야|이다|야|임)?\s*[.!]*\s*$")


def _clean_value(val: str) -> str:
    return _COPULA_RE.sub("", val.strip()).strip()


def extract_candidate_fields(text: str) -> dict[str, str]:
    """Pull labelled candidate fields out of a free-form message (best-effort)."""
    out: dict[str, str] = {}
    for key, rex in _FIELD_RES.items():
        m = rex.search(text or "")
        if m:
            val = _clean_value(m.group(1))
            if val:
                out[key] = val
    return out


def _has_candidate_fields(fields: dict[str, str]) -> bool:
    # slug / goodsNo are unambiguous candidate labels; otherwise need >=2 labels
    # so a stray "브랜드" in a broad request doesn't get read as a candidate.
    return "slug" in fields or "goods_no" in fields or len(fields) >= 2


# --- dangerous-action detection ----------------------------------------------
_DANGER_VERBS = (
    re.compile(r"보내|발송|\bsend\b", re.I),                       # email send
    re.compile(r"수집|크롤|\bcollect\b|crawl", re.I),             # collection
    re.compile(r"\bpdf\b|피디에프", re.I),                        # pdf render
    re.compile(r"올려|올리|게시|업로드|포스팅|\bpublish\b|\bpost(?:ing)?\b", re.I),  # publish
)
# negation immediately around a verb: "...하지 마", "보내지는 마", "안 보내", "금지"
_NEG_AFTER = re.compile(r"^[지은는을를도\s]*(?:말|마|마라|않|안|못|금지|하지)")
_NEG_BEFORE = re.compile(r"(?:안|못)\s*$")


def _affirmative_danger(text: str) -> bool:
    """True if any send/collect/PDF/publish verb appears in an AFFIRMATIVE
    (non-negated) context. A locally-negated verb (e.g. '수집은 하지 마') does
    not count — mirrors the orchestrator's no_send negation guard."""
    t = text or ""
    for rex in _DANGER_VERBS:
        for m in rex.finditer(t):
            tail = t[m.end(): m.end() + 14]
            head = t[max(0, m.start() - 4): m.start()]
            if _NEG_AFTER.match(tail) or _NEG_BEFORE.search(head):
                continue  # this occurrence is negated
            return True
    return False


# --- approval detection ------------------------------------------------------
_APPROVE_RE = re.compile(r"승인|\bapprove\b", re.I)
_TASK_ID_RE = re.compile(r"\b((?:task|t)_[0-9a-z]{4,})\b", re.I)


def classify_action(text: str) -> tuple[str, dict[str, Any]]:
    """Deterministic, ordered intent classification. Returns (intent, parsed).

    Order is load-bearing:
      1. set_candidate (candidate fields present) — beats approve even with '진행'/'승인'.
      2. dangerous_external_action (affirmative send/collect/PDF/publish) — refuse early.
      3. approve_one (approval words, no candidate fields).
      4. create_graph — fall through to the unchanged graph-creation handler.
    Ambiguity (0 / >=2 resolved tasks) is decided later, in route(), as CLARIFY.
    """
    t = text or ""
    fields = extract_candidate_fields(t)
    if _has_candidate_fields(fields):
        return SET_CANDIDATE, {"fields": fields}
    if _affirmative_danger(t):
        return DANGEROUS, {}
    if _APPROVE_RE.search(t):
        tid = _TASK_ID_RE.search(t)
        return APPROVE_ONE, {"task_id": tid.group(1) if tid else None}
    return CREATE_GRAPH, {}


# --- state resolution (read-only) --------------------------------------------
def _resolve_picks(store_path: Path) -> list[Task]:
    return [t for t in _store.load_tasks(store_path)
            if t.intended_stage == _PICK_STAGE and t.status in _PICK_SETTABLE]


def _resolve_waiting(store_path: Path) -> list[Task]:
    return [t for t in _store.load_tasks(store_path) if t.status == "needs_approval"]


def _clarify(message: str, tasks: Optional[list[Task]] = None) -> dict[str, Any]:
    return {"intent": CLARIFY, "handled": True,
            "reply": _fmt.format_nl_clarification(message, tasks)}


# --- handlers ----------------------------------------------------------------
def _do_set_candidate(fields: dict[str, str], store_path: Path,
                      events_path: Path) -> dict[str, Any]:
    picks = _resolve_picks(store_path)
    if not picks:
        return _clarify("진행 중인 candidate_shortlist_pick 작업이 없습니다. "
                        "먼저 콜드메일 파이프라인을 만들어 주세요.")
    if len(picks) > 1:
        return _clarify("후보 선택 작업이 여러 개입니다. 어느 task_id에 붙일까요?", picks)
    task = picks[0]
    candidate: dict[str, str] = {k: fields[k] for k in _ti.CANDIDATE_REQUIRED_FIELDS
                                 if fields.get(k)}
    for k in _ti.CANDIDATE_OPTIONAL_FIELDS:
        if fields.get(k):
            candidate[k] = fields[k]
    try:
        result = _ti.set_candidate(task.task_id, candidate,
                                   store_path=store_path, events_path=events_path)
    except _ti.CandidateInputError as exc:
        return {"intent": SET_CANDIDATE, "handled": True,
                "reply": _fmt.format_nl_set_candidate_result(
                    {"ok": False, "reason": exc.reason, "message": str(exc)})}
    return {"intent": SET_CANDIDATE, "handled": True,
            "reply": _fmt.format_nl_set_candidate_result(result)}


def _do_approve(task_id: Optional[str], operator_discord_id: str,
                operator_display_name: Optional[str], store_path: Path,
                events_path: Path, approvals_path: Optional[Path],
                targets_dir: Optional[Path]) -> dict[str, Any]:
    waiting = _resolve_waiting(store_path)
    if task_id:
        match = [t for t in waiting if t.task_id == task_id]
        if not match:
            return _clarify(f"`{task_id}` 는 승인 대기(needs_approval) 작업이 아닙니다.")
        waiting = match
    if not waiting:
        return {"intent": APPROVE_ONE, "handled": True,
                "reply": "⚠ 승인 대기 중인 작업이 없습니다 (needs_approval 없음)."}
    if len(waiting) > 1:
        return _clarify("승인 대기 작업이 여러 개입니다. 어떤 task_id를 승인할까요?", waiting)
    task = waiting[0]
    result = _orch.record_task_approval(
        task.task_id, operator_discord_id=operator_discord_id,
        operator_display_name=operator_display_name,
        store_path=store_path, events_path=events_path,
        approvals_path=approvals_path, targets_dir=targets_dir)
    return {"intent": APPROVE_ONE, "handled": True,
            "reply": _fmt.format_nl_approval_result(result)}


def route(text: str, *, operator_discord_id: str, store_path: Path,
          events_path: Path, approvals_path: Optional[Path] = None,
          targets_dir: Optional[Path] = None,
          operator_display_name: Optional[str] = None) -> dict[str, Any]:
    """Route a free-form message to an operational intent, or signal fall-through.

    Returns a dict with `intent`, `handled` (bool), and `reply` (str|None). When
    `handled` is False (intent == CREATE_GRAPH) the caller runs the unchanged
    graph-creation path. M4-A never executes a task or calls task_runner.
    """
    intent, parsed = classify_action(text)
    if intent == SET_CANDIDATE:
        return _do_set_candidate(parsed["fields"], store_path, events_path)
    if intent == DANGEROUS:
        return {"intent": DANGEROUS, "handled": True,
                "reply": _fmt.format_nl_dangerous_refusal()}
    if intent == APPROVE_ONE:
        return _do_approve(parsed.get("task_id"), operator_discord_id,
                           operator_display_name, store_path, events_path,
                           approvals_path, targets_dir)
    return {"intent": CREATE_GRAPH, "handled": False, "reply": None}
