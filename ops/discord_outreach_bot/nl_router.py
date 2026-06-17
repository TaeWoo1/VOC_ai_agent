"""M4-A/M4-B: deterministic natural-language operator router (Discord).

Sits IN FRONT of the broad graph-creation handler (`task_discord_adapter.
handle_nl_message`). It recognizes a SMALL set of operational intents on
EXISTING tasks and routes them to the already-audited cores:

  M4-A (records / intent only):
    - set_candidate             -> task_inputs.set_candidate         (records-only)
    - approve_one               -> orchestrator.record_task_approval  (intent only)
  M4-B (the guarded scaffold_packet runner, called directly — no shell):
    - dry_run_candidate         -> task_runner.dry_run                (no folder)
    - run_review_scaffold       -> task_runner.run then .review       (scaffold only)
    - rollback_latest           -> task_runner.rollback               (run's files only)
  always:
    - dangerous_external_action -> refuse (ZERO writes)
    - clarification_needed      -> ask  (ZERO writes)
    - create_graph (no match)   -> caller falls through to graph creation

Scope guarantees: this module NEVER runs collection, sends email, renders PDFs,
publishes Instagram, invokes Claude Code, opens a browser/CDP, makes a network
call, or shells out. It does NOT widen `ALLOWED_RUNNER_ACTIONS` / `STAGE_TO_ACTION`
(scaffold_packet only) and it NEVER auto-rolls-back a failed review. Every guard
inside task_runner (queued status, approval_ref, prompt_hash re-match, matching
clean dry-run, path-escape, extra-file refusal) still fires unchanged — the
router only resolves WHICH task/run and calls the existing function. Pure (no
discord.py); unit-testable with tmp stores.
"""

from __future__ import annotations

import re
from pathlib import Path
from typing import Any, Optional

import orchestrator as _orch
import task_formatting as _fmt
import task_inputs as _ti
import task_runner as _runner
import task_runs as _runs
import task_store as _store
from task_model import Task

# --- intents -----------------------------------------------------------------
SET_CANDIDATE = "set_candidate"
APPROVE_ONE = "approve_one"
DRY_RUN = "dry_run_candidate"
RUN_REVIEW = "run_review_scaffold"
ROLLBACK = "rollback_latest"
DANGEROUS = "dangerous_external_action"
CLARIFY = "clarification_needed"
CREATE_GRAPH = "create_graph"   # no operational match -> caller falls through

_PICK_STAGE = "outreach:candidate_shortlist_pick"
# attaching candidate input is safe only pre-execution (mirrors task_inputs)
_PICK_SETTABLE = ("needs_approval", "queued", "blocked")
# the ONLY runner action the router may drive (never widened here)
_SCAFFOLD_ACTION = "scaffold_packet"


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
    re.compile(r"claude\s*code|\bclaude\b|클로드", re.I),          # Claude Code
)
# negation immediately around a verb: "...하지 마", "보내지는 마", "안 보내", "금지"
_NEG_AFTER = re.compile(r"^[지은는을를도\s]*(?:말|마|마라|않|안|못|금지|하지)")
_NEG_BEFORE = re.compile(r"(?:안|못)\s*$")


def _affirmative_danger(text: str) -> bool:
    """True if any send/collect/PDF/publish/Claude verb appears in an AFFIRMATIVE
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


# --- approval / runner intent detection --------------------------------------
_APPROVE_RE = re.compile(r"승인|\bapprove\b", re.I)
_ROLLBACK_RE = re.compile(r"rollback|롤백|되돌려|되돌리|원복", re.I)
_DRYRUN_RE = re.compile(r"dry[\s-]?run|미리\s?보기|프리뷰|preview", re.I)
_SCAFFOLD_NOUN = re.compile(r"scaffold|폴더|status\.json", re.I)
_RUN_VERB = re.compile(r"생성|만들|검수|review|리뷰", re.I)
_TASK_ID_RE = re.compile(r"\b((?:task|t)_[0-9a-z]{4,})\b", re.I)
_RUN_ID_RE = re.compile(r"\b(run_[0-9a-z]{4,})\b", re.I)


def classify_action(text: str) -> tuple[str, dict[str, Any]]:
    """Deterministic, ordered intent classification. Returns (intent, parsed).

    Order is load-bearing:
      1. set_candidate          (candidate fields present)
      2. dangerous              (affirmative send/collect/PDF/publish/Claude) — refuse early
      3. approve_one            (approval words, no candidate fields)
      4. rollback_latest        (rollback/되돌려)            — before run_review
      5. dry_run_candidate      (dry-run/미리보기)            — before run_review
      6. run_review_scaffold    (scaffold-noun + make/review verb)
      7. create_graph           (fall through, unchanged)
    Ambiguity (0 / >=2 resolved task/run) is decided in route() as CLARIFY.
    """
    t = text or ""
    fields = extract_candidate_fields(t)
    if _has_candidate_fields(fields):
        return SET_CANDIDATE, {"fields": fields}
    if _affirmative_danger(t):
        return DANGEROUS, {}
    if _APPROVE_RE.search(t):
        m = _TASK_ID_RE.search(t)
        return APPROVE_ONE, {"task_id": m.group(1) if m else None}
    if _ROLLBACK_RE.search(t):
        m = _RUN_ID_RE.search(t)
        return ROLLBACK, {"run_id": m.group(1) if m else None}
    if _DRYRUN_RE.search(t):
        m = _TASK_ID_RE.search(t)
        return DRY_RUN, {"task_id": m.group(1) if m else None}
    if _SCAFFOLD_NOUN.search(t) and _RUN_VERB.search(t):
        m = _TASK_ID_RE.search(t)
        return RUN_REVIEW, {"task_id": m.group(1) if m else None}
    return CREATE_GRAPH, {}


# --- state resolution (read-only) --------------------------------------------
def _resolve_picks(store_path: Path) -> list[Task]:
    return [t for t in _store.load_tasks(store_path)
            if t.intended_stage == _PICK_STAGE and t.status in _PICK_SETTABLE]


def _resolve_waiting(store_path: Path) -> list[Task]:
    return [t for t in _store.load_tasks(store_path) if t.status == "needs_approval"]


def _resolve_approved_queued(store_path: Path) -> list[Task]:
    """Approved candidate picks awaiting a guarded run (queued + approval_ref)."""
    return [t for t in _store.load_tasks(store_path)
            if t.intended_stage == _PICK_STAGE and t.status == "queued"
            and t.approval_ref]


def _resolve_rollbackable_runs(runs_path: Optional[Path]) -> list[dict[str, Any]]:
    """Scaffold runs whose LATEST record is `done` (written, not yet rolled back).

    Folds the append-only run log by run_id (last record wins), matching the
    runner's own rollback eligibility (done/pending_review/blocked task states
    all map to a `done` run record)."""
    latest: dict[str, dict[str, Any]] = {}
    for r in _runs.read_runs(runs_path):
        latest[r.get("run_id")] = r
    return [r for r in latest.values()
            if r.get("runner_action") == _SCAFFOLD_ACTION and r.get("status") == "done"]


def _clarify(message: str, tasks: Optional[list[Task]] = None) -> dict[str, Any]:
    return {"intent": CLARIFY, "handled": True,
            "reply": _fmt.format_nl_clarification(message, tasks)}


def _clarify_runs(message: str, runs: list[dict[str, Any]]) -> dict[str, Any]:
    return {"intent": CLARIFY, "handled": True,
            "reply": _fmt.format_nl_run_clarification(message, runs)}


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


def _pick_approved(task_id: Optional[str], store_path: Path):
    """Resolve the single approved-queued candidate, or a CLARIFY/ask dict."""
    approved = _resolve_approved_queued(store_path)
    if task_id:
        match = [t for t in approved if t.task_id == task_id]
        if not match:
            return None, _clarify(f"`{task_id}` 는 승인된 대기 후보(queued)가 아닙니다.")
        approved = match
    if not approved:
        return None, _clarify('승인된 대기 후보(queued + approval_ref)가 없습니다. '
                              '먼저 "승인해".')
    if len(approved) > 1:
        return None, _clarify("승인된 후보가 여러 개입니다. 어떤 task_id를 진행할까요?", approved)
    return approved[0], None


def _do_dry_run(task_id: Optional[str], store_path: Path,
                approvals_path: Optional[Path], runs_path: Optional[Path],
                targets_dir: Optional[Path]) -> dict[str, Any]:
    task, problem = _pick_approved(task_id, store_path)
    if problem:
        return problem
    out = _runner.dry_run(task.task_id, store_path=store_path,
                          approvals_path=approvals_path, runs_path=runs_path,
                          targets_dir=targets_dir)
    return {"intent": DRY_RUN, "handled": True,
            "reply": _fmt.format_nl_dry_run_result(out)}


def _do_run_review(task_id: Optional[str], store_path: Path,
                   approvals_path: Optional[Path], runs_path: Optional[Path],
                   events_path: Path, reviews_path: Optional[Path],
                   targets_dir: Optional[Path]) -> dict[str, Any]:
    task, problem = _pick_approved(task_id, store_path)
    if problem:
        return problem

    # read-only verify -> approval_ref + prompt_hash (and surface gate failures)
    res = _runner.verify(task.task_id, store_path=store_path,
                         approvals_path=approvals_path, targets_dir=targets_dir)
    if not res.ok:
        return _run_review_reply({"phase": "verify", "reason": res.reason,
                                  "message": res.message})

    # require a matching CLEAN dry-run for this exact approval-bound proposal
    dr = _runs.find_matching_dry_run(task.task_id, _SCAFFOLD_ACTION,
                                     res.approval_ref, res.prompt_hash, runs_path)
    if dr is None:
        return _run_review_reply({"phase": "no_dry_run"})

    run_out = _runner.run(task.task_id, store_path=store_path,
                          approvals_path=approvals_path, runs_path=runs_path,
                          events_path=events_path, targets_dir=targets_dir)
    if not run_out.get("ok"):
        return _run_review_reply({"phase": "run", "reason": run_out.get("reason"),
                                  "message": run_out.get("message")})

    run_id = run_out["run_id"]
    rev = _runner.review(run_id, store_path=store_path, events_path=events_path,
                         runs_path=runs_path, reviews_path=reviews_path,
                         targets_dir=targets_dir)
    if not rev.get("ok"):
        return _run_review_reply({"phase": "run", "reason": rev.get("reason"),
                                  "message": rev.get("message")})
    if rev.get("status") == "pass":
        return _run_review_reply({"phase": "review_pass", "run_id": run_id,
                                  "review_id": rev.get("review_id"),
                                  "files_created": run_out.get("files_created")})
    # review FAIL — task is blocked by the runner; we NEVER auto-rollback.
    return _run_review_reply({"phase": "review_fail", "run_id": run_id,
                              "review_id": rev.get("review_id"),
                              "recommended_action": rev.get("recommended_action"),
                              "findings": rev.get("findings", [])})


def _run_review_reply(info: dict[str, Any]) -> dict[str, Any]:
    return {"intent": RUN_REVIEW, "handled": True,
            "reply": _fmt.format_nl_run_review_result(info)}


def _do_rollback(run_id: Optional[str], store_path: Path, events_path: Path,
                 runs_path: Optional[Path],
                 targets_dir: Optional[Path]) -> dict[str, Any]:
    candidates = _resolve_rollbackable_runs(runs_path)
    if run_id:
        match = [r for r in candidates if r.get("run_id") == run_id]
        if not match:
            return _clarify(f"`{run_id}` 는 되돌릴 수 있는 scaffold run이 아닙니다.")
        candidates = match
    if not candidates:
        return {"intent": ROLLBACK, "handled": True,
                "reply": "⚠ 되돌릴 scaffold run이 없습니다."}
    if len(candidates) > 1:
        return _clarify_runs("되돌릴 수 있는 scaffold run이 여러 개입니다. 어떤 run_id?",
                             candidates)
    out = _runner.rollback(candidates[0]["run_id"], store_path=store_path,
                           events_path=events_path, runs_path=runs_path,
                           targets_dir=targets_dir)
    return {"intent": ROLLBACK, "handled": True,
            "reply": _fmt.format_nl_rollback_result(out)}


def route(text: str, *, operator_discord_id: str, store_path: Path,
          events_path: Path, approvals_path: Optional[Path] = None,
          runs_path: Optional[Path] = None, reviews_path: Optional[Path] = None,
          targets_dir: Optional[Path] = None,
          operator_display_name: Optional[str] = None) -> dict[str, Any]:
    """Route a free-form message to an operational intent, or signal fall-through.

    Returns a dict with `intent`, `handled` (bool), and `reply` (str|None). When
    `handled` is False (intent == CREATE_GRAPH) the caller runs the unchanged
    graph-creation path. The router only drives the guarded scaffold_packet
    runner — never collection / send / PDF / publish / Claude Code.
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
    if intent == ROLLBACK:
        return _do_rollback(parsed.get("run_id"), store_path, events_path,
                            runs_path, targets_dir)
    if intent == DRY_RUN:
        return _do_dry_run(parsed.get("task_id"), store_path, approvals_path,
                           runs_path, targets_dir)
    if intent == RUN_REVIEW:
        return _do_run_review(parsed.get("task_id"), store_path, approvals_path,
                              runs_path, events_path, reviews_path, targets_dir)
    return {"intent": CREATE_GRAPH, "handled": False, "reply": None}
