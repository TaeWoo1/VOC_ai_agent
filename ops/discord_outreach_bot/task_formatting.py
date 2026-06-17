"""Compact, read-only Discord string builders for the orchestration tasks (M2).

Pure functions — NO discord.py, NO I/O of their own (callers pass already-loaded
tasks/summaries). They render the orchestrator's task graph into operator-friendly
text. Nothing here executes a task or writes a packet file.
"""

from __future__ import annotations

from typing import Any, Optional

from agent_registry import AGENTS
from task_model import Task

DISCORD_LIMIT = 2000
_CLIP = 1900

# --- Pipeline display order (formatting only — never reorders storage/deps) ---
# Tasks are stored/folded in arbitrary (snapshot/hash) order. For the operator
# we render them in workflow pipeline order. Within a graph only one workflow's
# stages appear, so a single combined table is unambiguous.
_OUTREACH_ORDER = (
    "outreach:candidate_check",
    "outreach:candidate_shortlist_pick",
    "outreach:collect_plan",
    "outreach:collect_execute",
    "outreach:corpus_review",
    "outreach:angle_select",
    "outreach:draft_packet",
    "outreach:copy_qa",
    "outreach:render_pdf",
    "outreach:prepare_send",
    "outreach:mark_sent",
    "outreach:follow_up",
    "outreach:closeout",
    "outreach:packet_revision",
)
_INSTAGRAM_ORDER = (
    "instagram:collection",
    "instagram:product_detail_context",
    "instagram:cardnews_content_packet",
    "instagram:manuscript",
    "instagram:render",
    "instagram:cardnews_plan",
    "instagram:publish",
)
STAGE_ORDER = {s: i for i, s in enumerate(_OUTREACH_ORDER + _INSTAGRAM_ORDER)}

# Sort buckets: root rows first, then known pipeline stages, then ops
# clarification (after workflow-specific stages), then unknown stages last.
# Unknown stages are NEVER dropped — they sort after known ones and keep their
# label for visibility.
_BUCKET_ROOT, _BUCKET_KNOWN, _BUCKET_CLARIFY, _BUCKET_UNKNOWN = -1, 0, 1, 2
_CLARIFICATION = "ops:clarification"
_TERMINAL_STATUSES = ("done", "cancelled", "failed")


def stage_sort_key(task: Task) -> tuple:
    """Display sort key for one task. Pure; reads only `intended_stage`.

    Tuple = (bucket, ordinal, stage) so known pipeline stages come first in
    pipeline order, clarification sits after them, and any unknown stage sorts
    last but still shows. Root rows (no stage) lead their graph.
    """
    stage = task.intended_stage or ""
    if not stage:
        return (_BUCKET_ROOT, 0, "")
    if stage in STAGE_ORDER:
        return (_BUCKET_KNOWN, STAGE_ORDER[stage], stage)
    if stage == _CLARIFICATION:
        return (_BUCKET_CLARIFY, 0, stage)
    return (_BUCKET_UNKNOWN, 0, stage)


def order_tasks(tasks: list[Task]) -> list[Task]:
    """Return tasks in pipeline display order (does not mutate the input).

    An `ops:clarification` task floats to the top when it is the only active
    (non-terminal) task — i.e. the active blocker the operator must answer;
    otherwise it keeps its after-workflow-stages position.
    """
    ordered = sorted(tasks, key=stage_sort_key)
    active = [t for t in tasks if t.status not in _TERMINAL_STATUSES]
    if (len(active) == 1 and active[0].intended_stage == _CLARIFICATION):
        clar = [t for t in ordered if t.intended_stage == _CLARIFICATION]
        rest = [t for t in ordered if t.intended_stage != _CLARIFICATION]
        return clar + rest
    return ordered


def _gate(g: str) -> str:
    return "🔴" if g == "red" else "🟢"


def _task_marker(t: Task) -> str:
    """Display marker. Internal gate stays green/red; this only disambiguates a
    GREEN task that still needs an operator DECISION (e.g. candidate pick)."""
    if t.gate == "red":
        return "🔴"
    if getattr(t, "approval_required", False):
        return "🟡"   # operator-decision gate (green) — not external execution
    return "🟢"


def _approval_kind(gate: str) -> str:
    return "🔴 red gate" if gate == "red" else "🟡 operator-decision (green)"


_LEGEND = ("🟡 = operator-decision gate: records intent only, NOT external "
           "execution. Approve with /task_approve.")


def _short_goal(goal: str, n: int = 60) -> str:
    g = " ".join((goal or "").split())
    return g if len(g) <= n else g[: n - 1] + "…"


def _clip(text: str) -> str:
    if len(text) <= _CLIP:
        return text
    return text[:_CLIP] + "\n… (truncated; use /task_status for detail)"


def format_tasks(tasks: list[Task], status: Optional[str] = None) -> str:
    rows = [t for t in tasks if status is None or t.status == status]
    if not rows:
        scope = f" with status `{status}`" if status else ""
        return f"No orchestration tasks{scope}."
    head = f"**Tasks ({len(rows)}{'/' + str(len(tasks)) if status else ''})**"
    lines = [head]
    # Keep each graph's rows contiguous (group by parent graph), then order
    # within a graph by pipeline stage. Display-only; storage order untouched.
    rows = sorted(rows, key=lambda t: ((t.parent_task_id or t.task_id), stage_sort_key(t)))
    for t in rows:
        tgt = t.target_slug or "-"
        lines.append(
            f"{_task_marker(t)} `{t.status}` [{t.workflow}] `{t.task_id}` "
            f"{t.assigned_agent} · {tgt} :: {_short_goal(t.goal)}")
    return _clip("\n".join(lines))


def format_task_status(task_id: str, tasks: list[Task], summary: dict[str, Any]) -> str:
    by_id = {t.task_id: t for t in tasks}
    root = by_id.get(task_id)
    if root is None:
        return f"No task matching `{task_id}`."
    children = [t for t in tasks if t.parent_task_id == task_id]
    scope = order_tasks(children) if children else [root]
    lines = [
        f"**Task `{task_id}`** [{root.workflow}] — {_short_goal(root.goal, 80)}",
        f"root status: `{root.status}`  ·  counts: {summary.get('counts', {})}",
    ]
    for i, t in enumerate(scope, 1):
        deps = ",".join(d[:10] for d in t.dependencies) or "-"
        lines.append(
            f"  {i:02d} {_task_marker(t)} `{t.status}` `{t.task_id}` {t.assigned_agent} "
            f"· stage={t.intended_stage or '-'} · deps=[{deps}]")
    na = summary.get("needs_approval", [])
    if na:
        lines.append("\n⛔ needs approval (records intent only — NOT external execution):")
        for n in na:
            lines.append(f"  `{n['task_id']}` {n['agent']} {n['intended_stage']} "
                         f"— {_approval_kind(n['gate'])}"
                         f"  → /task_approve task_id:{n['task_id']}")
        if any(n["gate"] != "red" for n in na):
            lines.append(f"  ({_LEGEND})")
    if summary.get("blocked"):
        lines.append(f"blocked: {len(summary['blocked'])} task(s) waiting on dependencies")
    arts = summary.get("artifacts", [])
    if arts:
        lines.append("artifacts (proposals — NOT executed):")
        lines.extend(f"  {a}" for a in arts)
    # surface any clarification reason
    for t in scope:
        if t.intended_stage == "ops:clarification":
            reason = (t.inputs or {}).get("reason", "clarification required")
            lines.append(f"❓ clarification: {reason}")
    return _clip("\n".join(lines))


def format_task_create_result(parent_id: str, tasks: list[Task],
                              summary: dict[str, Any]) -> str:
    by_id = {t.task_id: t for t in tasks}
    root = by_id.get(parent_id)
    children = [t for t in tasks if t.parent_task_id == parent_id]
    scope = order_tasks(children) if children else ([root] if root else [])
    lines = [f"**Created task graph** `{parent_id}` — {len(scope)} task(s)"]
    lines.append(f"counts: {summary.get('counts', {})}")
    for i, t in enumerate(scope, 1):
        lines.append(f"  {i:02d} {_task_marker(t)} `{t.status}` {t.assigned_agent} "
                     f"· {t.intended_stage or '-'}")
    na = summary.get("needs_approval", [])
    if na:
        lines.append("\n⛔ Needs operator approval (records intent only — NOT external execution):")
        for n in na:
            lines.append(f"  `{n['task_id']}` {n['intended_stage']} "
                         f"— {_approval_kind(n['gate'])}"
                         f"  → /task_approve task_id:{n['task_id']}")
        if any(n["gate"] != "red" for n in na):
            lines.append(f"  ({_LEGEND})")
    # clarification / ambiguous send warning
    clar = [t for t in scope if t.intended_stage == "ops:clarification"]
    for t in clar:
        reason = (t.inputs or {}).get("reason", "clarification required")
        warn = "  ⚠ external send is a 🔴 gate and is never auto-executed." \
            if t.gate == "red" else ""
        lines.append(f"\n❓ Clarification needed: {reason}{warn}")
    lines.append("\n(propose-only — no send/collect/render/packet mutation)")
    return _clip("\n".join(lines))


def format_approval_result(result: dict[str, Any]) -> str:
    if not result.get("ok"):
        return f"⚠ {result.get('message', 'could not record approval')}"
    return (f"✅ Approval recorded (intent only — NOT executed).\n"
            f"task: `{result['task_id']}`\n"
            f"approval_ref: `{result['approval_ref']}`\n"
            "⛔ This does not run the stage or bypass the 🔴 gate. Run the next "
            "step manually in an authorized Claude Code turn.")


def format_cancel_result(task: Task) -> str:
    return (f"🗑 Cancelled `{task.task_id}` ({task.assigned_agent}, "
            f"{task.intended_stage or '-'}). No packet files touched.")


def format_set_candidate_result(result: dict[str, Any]) -> str:
    if not result.get("ok"):
        return f"⚠ {result.get('reason', 'error')}: {result.get('message', '')}".strip()
    c = result["candidate"]
    lines = [
        f"✅ Candidate attached to `{result['task_id']}`.",
        f"slug: `{c['slug']}` · brand: {c['brand']} · goodsNo: {c['goods_no']}",
        f"product: {c['product_name']}",
        f"status: `{result['status']}`",
    ]
    if result.get("approval_invalidated"):
        lines.append("⚠ prior approval cleared — proposal changed, so re-approval "
                     "is required before any run.")
    lines.append(f"next: /task_approve task_id:{result['task_id']}")
    lines.append("(records-only — no packet folder/file created, nothing executed)")
    return _clip("\n".join(lines))


# --- M4-A natural-language router replies ------------------------------------
def format_nl_set_candidate_result(result: dict[str, Any]) -> str:
    """Conversational set_candidate reply (records-only; no execution)."""
    if not result.get("ok"):
        return f"⚠ {result.get('reason', 'error')}: {result.get('message', '')}".strip()
    c = result["candidate"]
    lines = [
        f"✅ 후보 정보를 붙였습니다 → `{c['slug']}` ({c['brand']} · {c['goods_no']})",
        f"   제품: {c['product_name']}",
        f"   task: `{result['task_id']}` · status: `{result['status']}`",
    ]
    if result.get("approval_invalidated"):
        lines.append("⚠ 이전 승인은 무효화되었습니다 (후보가 바뀌어 재승인 필요).")
    lines.append("(records-only — 폴더/파일 생성 없음, 실행 없음)")
    lines.append('이제 승인할까요?  →  "승인해"')
    return _clip("\n".join(lines))


def format_nl_approval_result(result: dict[str, Any]) -> str:
    """Conversational approve_one reply (intent only — never executes)."""
    if not result.get("ok"):
        return f"⚠ {result.get('message', '승인을 기록하지 못했습니다.')}"
    return ("✅ 승인 기록 완료 (intent only — 실행 아님).\n"
            f"   task: `{result['task_id']}`\n"
            f"   approval_ref: `{result['approval_ref']}`\n"
            "⛔ 이 승인은 단계를 실행하거나 🔴 게이트를 통과시키지 않습니다.\n"
            "dry-run은 아직 실행하지 않았습니다. 다음 단계는 권한 있는 "
            "Claude Code 턴 / CLI에서 진행하세요.")


def format_nl_dangerous_refusal() -> str:
    """Refuse a send/collect/PDF/publish/Claude-Code request made in natural language."""
    return ("⛔ 이 작업은 자연어로 실행하지 않습니다 (발송 / 수집 / PDF / 퍼블리시 / Claude Code).\n"
            "   M4-B 자연어로 가능한 것: scaffold dry-run → run+review → rollback.\n"
            "   - 라이브 수집 / 이메일 발송 / PDF 렌더 / 인스타 게시: 기존 수동 워크플로우·권한 턴에서만\n"
            "   - Claude Code 실행도 자연어 트리거 대상이 아닙니다.")


def format_nl_clarification(message: str, tasks: Optional[list[Task]] = None) -> str:
    """Ask the operator to disambiguate; lists candidate task_ids. Zero writes."""
    lines = [f"❓ {message}"]
    for t in (tasks or []):
        tgt = (t.target_slug
               or ((t.inputs or {}).get("candidate") or {}).get("slug")
               or "-")
        lines.append(f"   • `{t.task_id}` {t.intended_stage or '-'} ({tgt})")
    if tasks:
        lines.append('   → 예: "<task_id> 승인"')
    return _clip("\n".join(lines))


# --- M4-B natural-language scaffold runner replies ---------------------------
def _reapprove_hint(reason: Optional[str]) -> str:
    return ('\n→ 후보가 바뀌었습니다. 다시 "승인해".'
            if reason == "prompt_hash_mismatch" else "")


def format_nl_dry_run_result(result: dict[str, Any]) -> str:
    """dry-run reply: pass shows would-create paths; fail shows the reason."""
    if not result.get("ok"):
        reason = result.get("reason", "error")
        return (f"⚠ dry-run 불가 [{reason}]: {result.get('message', '')}".strip()
                + _reapprove_hint(reason))
    lines = [f"🔎 dry-run 통과 (run_id=`{result['run_id']}`) — 파일 생성 없음.",
             "   would create:"]
    lines.extend(f"     {w}" for w in result.get("would_create", []))
    sp = result.get("status_preview") or {}
    if sp:
        corpus = sp.get("corpus") or {}
        lines.append(f"   status.json: state={sp.get('state')} · "
                     f"corpus.collection_run={corpus.get('collection_run')} · "
                     f"send={sp.get('send')}")
    lines.append('실제 scaffold 생성+review까지 진행할까요? 수집은 하지 않습니다.  →  '
                 '"scaffold 생성하고 review까지 진행해"')
    return _clip("\n".join(lines))


def format_nl_run_review_result(info: dict[str, Any]) -> str:
    """run + deterministic review reply, keyed by `phase`. Never auto-rolls back."""
    phase = info.get("phase")
    if phase == "verify":
        reason = info.get("reason", "error")
        return (f"⚠ scaffold 불가 [{reason}]: {info.get('message', '')}".strip()
                + _reapprove_hint(reason))
    if phase == "no_dry_run":
        return ('⛔ 깨끗한 dry-run이 없어 scaffold를 만들지 않았습니다. '
                '먼저 "dry-run까지 해봐".')
    if phase == "run":
        return (f"⚠ scaffold run 실패 [{info.get('reason', 'error')}]: "
                f"{info.get('message', '')}").strip()
    if phase == "review_pass":
        lines = ["✅ scaffold 생성 + review pass.",
                 f"   run_id=`{info['run_id']}` · review_id=`{info.get('review_id')}` · "
                 "task → done"]
        lines.extend(f"   created: {f}" for f in (info.get("files_created") or []))
        lines.append("다음 단계 collect_plan 은 권한 있는 Claude Code 턴에서만 진행합니다.")
        return _clip("\n".join(lines))
    # review_fail
    lines = [f"⚠ review FAIL — recommended_action={info.get('recommended_action')} "
             f"(review_id=`{info.get('review_id')}`)"]
    lines.extend(f"   - {f.get('check')}: {f.get('detail')}"
                 for f in (info.get("findings") or [])[:5])
    lines.append("task → blocked. 파일은 남겨뒀습니다 (자동 삭제 안 함).")
    lines.append('되돌리려면 "방금 만든 scaffold rollback해".')
    return _clip("\n".join(lines))


def format_nl_rollback_result(result: dict[str, Any]) -> str:
    """rollback reply: success lists removed files; fail shows the reason."""
    if not result.get("ok"):
        return (f"⚠ rollback 불가 [{result.get('reason', 'error')}]: "
                f"{result.get('message', '')}").strip()
    lines = [f"↩ rollback 완료 (`{result['run_id']}`) — removed:"]
    lines.extend(f"     {f}" for f in (result.get("removed") or []))
    lines.append("task → queued (재실행 가능).")
    return _clip("\n".join(lines))


def format_nl_run_clarification(message: str, runs: list[dict[str, Any]]) -> str:
    """Ask which run_id to roll back; lists candidate runs. Zero writes."""
    lines = [f"❓ {message}"]
    for r in runs:
        slug = next((p.rstrip("/").rsplit("/", 1)[-1]
                     for p in (r.get("files_created") or []) if p.endswith("/")), "-")
        lines.append(f"   • `{r.get('run_id')}` task=`{r.get('task_id')}` ({slug})")
    lines.append('   → 예: "<run_id> 되돌려"')
    return _clip("\n".join(lines))


def format_agent_status() -> str:
    lines = [f"**Registered agents ({len(AGENTS)})**"]
    for name, spec in AGENTS.items():
        mut = "writes-logs" if spec.can_mutate_files else "read-only"
        stages = ", ".join(spec.allowed_stages) or "-"
        forbid = "; ".join(spec.forbidden_actions[:2])
        lines.append(f"• **{name}** [{spec.workflow}] ({mut})\n"
                     f"    stages: {stages}\n"
                     f"    forbids: {forbid}")
    return _clip("\n".join(lines))
