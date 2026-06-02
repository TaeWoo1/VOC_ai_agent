"""Logical agent registry for the v0.3 orchestration core (M1).

Agents are PROMPT/PROPOSAL PRODUCERS only. In M1 no agent executes a tool,
runs collection, sends email, renders a PDF, or mutates a packet file. Each
agent's `build_report(task, target=None)` returns text — the prompt the
operator would run in an authorized Claude Code turn — and nothing else.

`can_mutate_files` is False for every agent except OpsLoggerAgent, whose only
writes are the orchestration logs (declared in `writes`). The orchestrator —
not the agents — is what appends those logs; the flag documents the capability
boundary the safety tests assert against.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Callable, Optional

import prompt_builder as _pb

# orchestration-log filenames OpsLoggerAgent is allowed to write
_ORCH_LOGS = ("orchestration_tasks.jsonl", "orchestration_events.jsonl")


@dataclass(frozen=True)
class AgentSpec:
    name: str
    workflow: str
    responsibilities: str
    allowed_stages: tuple[str, ...]
    forbidden_actions: tuple[str, ...]
    gates_it_may_request: tuple[str, ...]
    build_report: Callable[..., str]
    can_mutate_files: bool = False
    writes: tuple[str, ...] = ()
    # Codex is a code/state reviewer, never a business/editorial approver.
    business_approval_authority: bool = False


# --- shared helpers ----------------------------------------------------------
def _stage_command(stage: Optional[str]) -> Optional[str]:
    """'outreach:follow_up' -> 'follow_up'; pass through bare labels."""
    if not stage:
        return None
    return stage.split(":", 1)[1] if stage.startswith("outreach:") else stage


def _proposal_text(task: Any, header: str) -> str:
    """Inert, structured proposal for synthetic stages or missing targets.

    This is TEXT ONLY — it executes nothing. It states the intended move, the
    gate, and that nothing happens without operator action.
    """
    gate_line = "🔴 RED — operator approval required before any external action." \
        if task.gate == "red" else "🟢 GREEN — safe to run as a prompt; no external action."
    return (
        f"# {header}\n"
        f"- workflow: {task.workflow}\n"
        f"- target: {task.target_slug or '(unresolved)'}\n"
        f"- intended_stage: {task.intended_stage or '(none)'}\n"
        f"- goal: {task.goal}\n"
        f"- gate: {gate_line}\n"
        "\nPROPOSAL ONLY — the orchestrator does not send, collect, render, or "
        "mutate any packet file. Run this in an authorized Claude Code turn."
    )


def _outreach_report(task: Any, target: Any, header: str) -> str:
    """Delegate to prompt_builder for real outreach stages; else a proposal."""
    cmd = _stage_command(task.intended_stage)
    if target is not None and cmd in _pb.COMMAND_FROM_STATE:
        return _pb.build_prompt(target, stage=task.intended_stage)
    return _proposal_text(task, header)


# --- per-agent build_report functions ---------------------------------------
def _candidate_research(task: Any, target: Any = None) -> str:
    s = task.inputs or {}
    return _pb.build_new_candidate_prompt(
        brand=s.get("brand", "<brand>"),
        product=s.get("product", "<product>"),
        goods_no=s.get("goods_no", "<goodsNo>"),
        slug=s.get("slug"),
    )


def _candidate_pick(task: Any, target: Any = None) -> str:
    return _proposal_text(task, "Operator: pick ONE candidate to proceed")


def _collection(task: Any, target: Any = None) -> str:
    return _outreach_report(task, target, "Collection step")


def _corpus_review(task: Any, target: Any = None) -> str:
    return _outreach_report(task, target, "Corpus review + claim-risk gate")


def _outreach_packet(task: Any, target: Any = None) -> str:
    cmd = _stage_command(task.intended_stage)
    if cmd == "packet_revision":
        return _proposal_text(
            task,
            "Packet revision (sharpen/soften copy) — NO send, NO PDF render",
        )
    return _outreach_report(task, target, "Outreach packet step")


def _recipient(task: Any, target: Any = None) -> str:
    return _outreach_report(task, target, "Recipient research / prepare_send")


def _followup(task: Any, target: Any = None) -> str:
    return _outreach_report(task, target, "Follow-up draft (no send)")


def _instagram_cardnews(task: Any, target: Any = None) -> str:
    # Separate namespace — never uses outreach prompt_builder / target status.
    return (
        "# Instagram cardnews — next stage (separate workflow)\n"
        f"- intended_stage: {task.intended_stage or 'instagram:cardnews_plan'}\n"
        f"- goal: {task.goal}\n"
        "- 5-stage separation: collection → product_detail_context → "
        "cardnews_content_packet → manuscript → render.\n"
        "- render and PUBLISH are 🔴 gates; public posting stays blocked pending "
        "rights + publish approval.\n"
        "\nPROPOSAL ONLY — does not render or publish, does not touch any outreach "
        "packet status. Run in an authorized Claude Code turn."
    )


def _codex_review(task: Any, target: Any = None) -> str:
    return (
        "# CodexReviewAgent — code/state review checklist (NOT business approval)\n"
        "- diff review + tests pass\n"
        "- forbidden-path / protected-module changes\n"
        "- state-transition legality (from_state → command in STATE_MACHINE)\n"
        "- side-effect check (writes confined to orchestration logs + generated_prompts/)\n"
        "- packet-mutation safety (no status.json / send_log.md writes from agents)\n"
        "\nCodex does NOT decide: whether to contact a brand, whether a memo is "
        "compelling, whether claim-risk is acceptable, or whether to send/follow up."
    )


def _ops_logger(task: Any, target: Any = None) -> str:
    return (
        "# OpsLoggerAgent — append-only logging only\n"
        f"- task_id: {task.task_id}\n"
        f"- writes: {', '.join(_ORCH_LOGS)} (never packet files, never approvals.log directly)"
    )


# --- registry ----------------------------------------------------------------
AGENTS: dict[str, AgentSpec] = {
    "CandidateResearchAgent": AgentSpec(
        name="CandidateResearchAgent", workflow="outreach",
        responsibilities="ICP/exclusion check; shortlist the next SKU candidate.",
        allowed_stages=("candidate_check", "candidate_shortlist_pick"),
        forbidden_actions=("create packet folders", "write status.json", "run collection"),
        gates_it_may_request=(),
        build_report=_candidate_research,
    ),
    "CollectionAgent": AgentSpec(
        name="CollectionAgent", workflow="outreach",
        responsibilities="Plan collection; propose collect_execute (never run it).",
        allowed_stages=("collect_plan", "collect_execute"),
        forbidden_actions=("run live collection", "open browser tabs", "write review DB"),
        gates_it_may_request=("collect_execute", "floor_exception"),
        build_report=_collection,
    ),
    "CorpusReviewAgent": AgentSpec(
        name="CorpusReviewAgent", workflow="outreach",
        responsibilities="Summarize corpus; run the claim-risk gate; surface angles for operator pick.",
        allowed_stages=("corpus_review", "angle_select"),
        forbidden_actions=("override claim-risk", "draft if skin-reaction/efficacy dominated"),
        gates_it_may_request=("claim_risk_override",),
        build_report=_corpus_review,
    ),
    "OutreachPacketAgent": AgentSpec(
        name="OutreachPacketAgent", workflow="outreach",
        responsibilities="Draft/revise the packet; run copy QA; propose render. Proposals only.",
        allowed_stages=("draft_packet", "copy_qa", "packet_revision", "render_pdf"),
        forbidden_actions=("write packet files", "mutate status.json", "render PDF", "send"),
        gates_it_may_request=(),
        build_report=_outreach_packet,
    ),
    "RecipientAgent": AgentSpec(
        name="RecipientAgent", workflow="outreach",
        responsibilities="Recipient research/confirmation (repo-first).",
        allowed_stages=("prepare_send",),
        forbidden_actions=("send email", "pick alternate channel silently", "web lookup w/o auth"),
        gates_it_may_request=("prepare_send", "alternate_recipient"),
        build_report=_recipient,
    ),
    "FollowupAgent": AgentSpec(
        name="FollowupAgent", workflow="outreach",
        responsibilities="Draft a follow-up on no-reply by the due date. Draft only.",
        allowed_stages=("follow_up",),
        forbidden_actions=("send", "switch channel without approval"),
        gates_it_may_request=("follow_up", "alternate_channel"),
        build_report=_followup,
    ),
    "InstagramCardnewsAgent": AgentSpec(
        name="InstagramCardnewsAgent", workflow="instagram",
        responsibilities="Cardnews 5-stage pipeline (separate from outreach).",
        allowed_stages=(
            "collection", "product_detail_context", "cardnews_content_packet",
            "manuscript", "render", "cardnews_plan",
        ),
        forbidden_actions=("render before packet+manuscript approved", "publish", "touch outreach status"),
        gates_it_may_request=("render", "publish"),
        build_report=_instagram_cardnews,
    ),
    "CodexReviewAgent": AgentSpec(
        name="CodexReviewAgent", workflow="ops",
        responsibilities="Review code diffs/tests/state-transitions/side-effects.",
        allowed_stages=("code_review",),
        forbidden_actions=(
            "decide whether to contact a brand", "judge memo quality",
            "decide claim-risk acceptability", "decide send/follow-up",
        ),
        gates_it_may_request=(),
        build_report=_codex_review,
        business_approval_authority=False,
    ),
    "OpsLoggerAgent": AgentSpec(
        name="OpsLoggerAgent", workflow="ops",
        responsibilities="Append-only orchestration logging + clarification surfacing.",
        allowed_stages=("log", "clarification"),
        forbidden_actions=("write packet files", "write approvals.log directly", "send/collect/render"),
        gates_it_may_request=(),
        build_report=_ops_logger,
        can_mutate_files=True,
        writes=_ORCH_LOGS,
    ),
}


def get_agent(name: str) -> Optional[AgentSpec]:
    return AGENTS.get(name)
