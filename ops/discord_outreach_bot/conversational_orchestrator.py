"""M5-A: deterministic, READ-ONLY conversational orchestrator (Discord).

Sits BETWEEN the operational NL router (`nl_router`, M4-A/M4-B) and the broad
graph-creation fall-through in `task_discord_adapter.handle_nl_message`. M4 used
to treat "no operational match" as "create a task graph", so a follow-up
*question* like "다음 후보군이 뭐지?" wrongly spawned a graph / clarification task.

This module fixes that edge: when the operational router declines, the adapter
asks `classify_conversation()` whether the message is a question. Question-like
messages are answered here from EXISTING state — read-only — instead of creating
anything. Only genuine new-task commands still fall through to graph creation.

Hard guarantees (enforced structurally + by tests):
  - READ-ONLY. The only modules it touches are read paths:
      task_store.load_tasks, orchestrator.task_status, orchestration_events.read_events,
      agent_registry.AGENTS, and read_text() on generated_prompts/ artifacts.
  - It does NOT import task_runner / task_inputs, does NOT call
    create_task_graph_for_request / advance / record_task_approval, and writes
    NOTHING — no task store, no events, no approvals, no runs, no reviews, no
    packet files. It never runs collection / send / PDF / publish / Claude Code,
    opens no browser/CDP, makes no network call, and shells out to nothing.
Pure (no discord.py); unit-testable with tmp stores.
"""

from __future__ import annotations

import glob
import re
from pathlib import Path
from typing import Any, Optional

import task_store as _store
from agent_registry import AGENTS as _AGENTS  # noqa: F401  (read-only registry; future use)
from orchestration_events import read_events as _read_events  # read-only
from orchestrator import task_status as _task_status          # read-only summary
from task_model import Task

# --- conversation categories -------------------------------------------------
STATUS_QUERY = "status_query"
ARTIFACT_QUERY = "artifact_query"
CANDIDATE_QUERY = "candidate_query"
FOLLOWUP_QUESTION = "followup_question"
NEW_TASK = "new_task_request"
CLARIFICATION = "clarification_needed"

_TERMINAL = {"done", "failed", "cancelled"}
_PICK_STAGE = "outreach:candidate_shortlist_pick"
_CHECK_STAGE = "outreach:candidate_check"

# --- marker regexes ----------------------------------------------------------
# Question-like markers (KR + EN). Presence of any => the message is a question
# to be ANSWERED from state, never a command to execute.
_QUESTION_MARKERS = re.compile(
    r"뭐지|어디까지|뭐\s*해야|뭘\s*해|왜|어떻게|결과|후보군|상태|요약|막힌|가능|\?|"
    r"\bwhat\b|\bhow\b|\bwhy\b|\bwhich\b|\bstatus\b|\bsummary\b|\bresult\b|"
    r"\bblocked\b|\bpossible\b",
    re.I,
)
# Imperative new-task markers — only route to graph creation when command-like
# AND not question-like.
_NEWTASK_MARKERS = re.compile(
    r"골라|준비\s*해|만들어|시작\s*해|파이프라인|콜드\s*메일|리포트|카드뉴스",
    re.I,
)

# sub-intent discriminators (only consulted once a message is question-like)
_CANDIDATE_RE = re.compile(r"후보", re.I)
_ARTIFACT_RE = re.compile(r"결과|요약|\bresult\b|\bsummary\b|artifact|아티팩트", re.I)
_COLLECTION_RE = re.compile(
    r"수집|크롤|\bcollect\b|crawl|발송|보내|\bsend\b|pdf|올려|게시|업로드|publish", re.I)
_APPROVE_RE = re.compile(r"승인|\bapprove\b", re.I)
_NEXT_RE = re.compile(r"다음|뭐\s*해야|뭘\s*해|해야|\bnext\b", re.I)
_STATUS_RE = re.compile(r"어디까지|상태|진행|\bstatus\b|\bprogress\b", re.I)


def is_question_like(text: str) -> bool:
    return bool(_QUESTION_MARKERS.search(text or ""))


def classify_conversation(text: str) -> str:
    """Deterministic conversation classifier (question-first, then command).

    Order is load-bearing:
      1. question-like  -> sub-classify into a read-only query category
           a. candidate (후보, no result/summary word)  -> candidate_query
           b. result / summary word                     -> artifact_query
           c. collection / send / publish word          -> followup_question (gate)
           d. approval word                             -> followup_question (why)
           e. next-action word                          -> followup_question (next)
           f. status word / anything else               -> status_query
      2. new-task imperative marker                      -> new_task_request
      3. neither                                         -> clarification_needed
    """
    t = text or ""
    if is_question_like(t):
        if _CANDIDATE_RE.search(t) and not _ARTIFACT_RE.search(t):
            return CANDIDATE_QUERY
        if _ARTIFACT_RE.search(t):
            return ARTIFACT_QUERY
        if _COLLECTION_RE.search(t):
            return FOLLOWUP_QUESTION
        if _APPROVE_RE.search(t):
            return FOLLOWUP_QUESTION
        if _NEXT_RE.search(t):
            return FOLLOWUP_QUESTION
        if _STATUS_RE.search(t):
            return STATUS_QUERY
        return STATUS_QUERY  # generic question -> safest informative default
    if _NEWTASK_MARKERS.search(t):
        return NEW_TASK
    return CLARIFICATION


# --- read-only state resolution ----------------------------------------------
def _is_terminal(task: Task) -> bool:
    return task.status in _TERMINAL


def _children(tasks: list[Task], root_id: str) -> list[Task]:
    return [t for t in tasks if t.parent_task_id == root_id]


def _active_roots(tasks: list[Task]) -> list[Task]:
    """Root tasks (no parent) that are themselves non-terminal OR have a
    non-terminal child. Read-only."""
    roots = [t for t in tasks if not t.parent_task_id]
    out: list[Task] = []
    for r in roots:
        kids = _children(tasks, r.task_id)
        if (not _is_terminal(r)) or any(not _is_terminal(c) for c in kids):
            out.append(r)
    return out


def _latest_root(roots: list[Task]) -> Task:
    # created_at is a sortable ISO-8601 UTC string; task_id breaks ties stably.
    return sorted(roots, key=lambda t: (t.created_at, t.task_id))[-1]


# --- artifact lookup (read-only) ---------------------------------------------
def _generated_dir(store_path: Path, generated_prompts_dir: Optional[Path]) -> Path:
    if generated_prompts_dir:
        return Path(generated_prompts_dir)
    return Path(store_path).parent / "generated_prompts"


def _artifact_for(task: Optional[Task], store_path: Path,
                  generated_prompts_dir: Optional[Path]) -> Optional[Path]:
    if task is None:
        return None
    for p in (task.artifact_paths or []):
        pp = Path(p)
        if pp.exists():
            return pp
    d = _generated_dir(store_path, generated_prompts_dir)
    hits = sorted(glob.glob(str(d / f"{task.task_id}__*.md")))
    return Path(hits[-1]) if hits else None


def _summarize_artifact(path: Path, max_lines: int = 4) -> Optional[str]:
    try:
        text = Path(path).read_text(encoding="utf-8")
    except OSError:
        return None
    lines = [ln.strip().lstrip("# ").strip() for ln in text.splitlines()]
    lines = [ln for ln in lines if ln]
    return "\n".join(lines[:max_lines]) if lines else None


# --- next-action suggestion (read-only; mirrors M4 verbs, never executes) -----
def _next_action(tasks: list[Task], root: Task) -> str:
    kids = _children(tasks, root.task_id)
    picks = [t for t in kids if t.intended_stage == _PICK_STAGE]
    if any(t.status == "done" for t in picks):
        return ("scaffold 완료. 다음은 Claude Code에서 collect_plan(수집 계획) 준비 — "
                "라이브 수집은 자연어로 실행되지 않으며 매 턴 별도 승인이 필요합니다.")
    if any(t.status == "queued" and t.approval_ref for t in picks):
        return '다음: "dry-run까지 해봐" → scaffold 미리보기 (실행 아님)'
    if any(t.status == "needs_approval" for t in picks):
        return '다음: 후보 정보를 붙이고 "승인해" (예: slug / 브랜드 / goodsNo / 제품명 입력)'
    if any(t.status == "needs_approval" for t in kids):
        return '다음: 승인 대기 작업이 있습니다 — "승인해"'
    return '다음 안전 작업: 후보를 선택하거나 "지금 어디까지 됐어?"로 상태를 확인하세요.'


# --- canned read-only explanations -------------------------------------------
_NO_ACTIVE_REPLY = (
    "진행 중인 작업이 없습니다. 콜드메일 파이프라인을 만들까요?\n"
    "예: '다음 브랜드 하나 골라서 콜드메일까지 준비해줘. 보내지는 마.'"
)
_APPROVAL_EXPLANATION = (
    "'승인'은 의도(intent) 기록만 합니다 — 레드게이트 외부 작업을 실행하지 않습니다.\n"
    "승인은 선택된 후보와 prompt_hash를 고정해서, 이후 dry-run / scaffold가 '승인된 그 "
    "제안'과 정확히 일치할 때만 진행되도록 묶어 줍니다 (자연어 승인 후에도 자동 실행은 없습니다)."
)
_COLLECTION_GATE_EXPLANATION = (
    "수집(collection)은 자연어로 실행되지 않습니다. 라이브 수집은 매 턴 명시적 승인이 "
    "필요한 레드게이트 작업입니다.\n"
    "scaffold가 완료되면 Claude Code에서 collect_plan(수집 계획)을 준비할 수 있지만, "
    "실제 수집 실행은 항상 별도 승인 단계입니다."
)


def _clarify_roots(roots: list[Task]) -> str:
    lines = "\n".join(f"- `{r.task_id}` ({(r.goal or '')[:40]})" for r in roots)
    return ("진행 중인 그래프가 여러 개입니다. 어떤 root task_id를 볼까요?\n" + lines)


# --- per-category reply builders ---------------------------------------------
def _candidate_reply(root: Task, tasks: list[Task], store_path: Path,
                     generated_prompts_dir: Optional[Path]) -> str:
    kids = _children(tasks, root.task_id)
    check = next((t for t in kids if t.intended_stage == _CHECK_STAGE), None)
    pick = next((t for t in kids if t.intended_stage == _PICK_STAGE), None)
    art = _artifact_for(pick, store_path, generated_prompts_dir) \
        or _artifact_for(check, store_path, generated_prompts_dir)
    summary = _summarize_artifact(art) if art else None
    if summary:
        return (f"후보군 요약 (artifact: `{Path(art).name}`):\n{summary}\n"
                f"{_next_action(tasks, root)}")
    cc = check.status if check else "없음"
    ps = pick.status if pick else "없음"
    return ("아직 후보군 요약 artifact가 없습니다.\n"
            f"현재 candidate_check={cc}, candidate_shortlist_pick={ps} 입니다.\n"
            "CandidateResearchAgent에게 후보군 요약을 생성시킬까요?")


def _artifact_reply(root: Task, tasks: list[Task], store_path: Path,
                    generated_prompts_dir: Optional[Path]) -> str:
    kids = _children(tasks, root.task_id)
    # newest-first by updated_at so the most recently advanced stage wins.
    for t in sorted(kids, key=lambda x: x.updated_at, reverse=True):
        art = _artifact_for(t, store_path, generated_prompts_dir)
        if art:
            summary = _summarize_artifact(art)
            if summary:
                return (f"`{t.intended_stage}` 결과 요약 (artifact: `{Path(art).name}`):\n"
                        f"{summary}\n{_next_action(tasks, root)}")
    return ("아직 요약할 artifact가 없습니다. 현재 그래프에서 생성된 프롬프트/결과 파일이 "
            "없습니다.\n" + _next_action(tasks, root))


def _status_reply(root: Task, tasks: list[Task], store_path: Path,
                  events_path: Optional[Path]) -> str:
    summary = _task_status(root.task_id, store_path)
    counts = summary.get("counts", {})
    count_str = ", ".join(f"{k}={v}" for k, v in sorted(counts.items())) or "(없음)"
    lines = [f"📋 진행 그래프: `{root.task_id}`  (root={summary.get('root_status')})",
             f"상태 집계: {count_str}"]
    na = summary.get("needs_approval") or []
    if na:
        first = na[0]
        lines.append(f"승인 대기: `{first['task_id']}` ({first.get('intended_stage')})")
    blocked = summary.get("blocked") or []
    if blocked:
        lines.append(f"blocked: {len(blocked)}건")
    events = _read_events(events_path) if events_path else []
    graph_events = [e for e in events
                    if e.get("parent_task_id") == root.task_id
                    or e.get("task_id") == root.task_id]
    if graph_events:
        last = graph_events[-1]
        msg = (last.get("message") or "")[:80]
        lines.append(f"최근 이벤트: {last.get('event_type')} — {msg}")
    lines.append(_next_action(tasks, root))
    return "\n".join(lines)


def _followup_reply(text: str, root: Task, tasks: list[Task]) -> str:
    t = text or ""
    if _COLLECTION_RE.search(t):
        return _COLLECTION_GATE_EXPLANATION
    if _APPROVE_RE.search(t):
        return _APPROVAL_EXPLANATION
    # next-action / generic follow-up
    return _next_action(tasks, root)


def _reply(intent: str, text: str) -> dict[str, Any]:
    return {"intent": intent, "handled": True, "reply": text}


# --- public entrypoint -------------------------------------------------------
def answer(text: str, *, store_path: Path, events_path: Optional[Path] = None,
           generated_prompts_dir: Optional[Path] = None,
           targets_dir: Optional[Path] = None) -> dict[str, Any]:
    """Answer a question-like message from EXISTING state. READ-ONLY: never
    creates a graph, approves, runs, or writes anything. Returns
    {"intent", "handled": True, "reply"}.

    `targets_dir` is accepted for signature symmetry with the operational
    router/adapter; it is not used for any write and may be ignored.
    """
    category = classify_conversation(text)
    tasks = _store.load_tasks(store_path)
    active = _active_roots(tasks)

    if not active:
        # locked decision: no active graph + question -> explain + suggest.
        return _reply(category, _NO_ACTIVE_REPLY)
    if len(active) > 1:
        return _reply(CLARIFICATION, _clarify_roots(active))
    root = _latest_root(active)

    if category == CANDIDATE_QUERY:
        return _reply(category, _candidate_reply(root, tasks, store_path,
                                                 generated_prompts_dir))
    if category == ARTIFACT_QUERY:
        return _reply(category, _artifact_reply(root, tasks, store_path,
                                                generated_prompts_dir))
    if category == STATUS_QUERY:
        return _reply(category, _status_reply(root, tasks, store_path, events_path))
    if category == FOLLOWUP_QUESTION:
        return _reply(category, _followup_reply(text, root, tasks))
    # NEW_TASK never reaches here (adapter routes it to graph creation);
    # CLARIFICATION and any residual fall here.
    return _reply(CLARIFICATION,
                  "질문을 이해하지 못했습니다. 상태를 보려면 '지금 어디까지 됐어?', "
                  "새 작업은 '다음 브랜드 하나 골라서 콜드메일까지 준비해줘.' 처럼 적어 주세요.")
