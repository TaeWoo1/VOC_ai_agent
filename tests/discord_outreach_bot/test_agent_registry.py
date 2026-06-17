"""agent_registry: roster, capability boundaries, prompt-only build_report."""

from __future__ import annotations

import prompt_builder as pb
from agent_registry import AGENTS
from task_model import Task

EXPECTED = {
    "CandidateResearchAgent", "CollectionAgent", "CorpusReviewAgent",
    "OutreachPacketAgent", "RecipientAgent", "FollowupAgent",
    "InstagramCardnewsAgent", "CodexReviewAgent", "OpsLoggerAgent",
}


def test_full_roster_present():
    assert set(AGENTS) == EXPECTED


def test_only_ops_logger_may_write_and_only_logs():
    for name, spec in AGENTS.items():
        if name == "OpsLoggerAgent":
            assert spec.can_mutate_files is True
            assert set(spec.writes) == {"orchestration_tasks.jsonl", "orchestration_events.jsonl"}
        else:
            assert spec.can_mutate_files is False
            assert spec.writes == ()


def test_codex_has_no_business_approval_authority():
    assert AGENTS["CodexReviewAgent"].business_approval_authority is False


def test_build_report_returns_text_for_every_agent():
    # synthetic task per agent; must return a non-empty string and not raise
    for name, spec in AGENTS.items():
        stage = spec.allowed_stages[0] if spec.allowed_stages else None
        t = Task(goal="g", assigned_agent=name, intended_stage=stage,
                 inputs={"brand": "B", "product": "P", "goods_no": "A1"})
        out = spec.build_report(t, None)
        assert isinstance(out, str) and out.strip()


def test_every_real_red_stage_is_owned_by_some_agent():
    # each 🔴 outreach command must appear in exactly the agents allowed to run it
    red_cmds = {cmd for cmd, state in pb.COMMAND_FROM_STATE.items()
                if pb.step_for(state).gate == pb.RED}
    owned = {s for spec in AGENTS.values() for s in spec.allowed_stages}
    missing = red_cmds - owned
    assert not missing, f"red stages with no owning agent: {missing}"


def test_instagram_agent_is_namespaced():
    assert AGENTS["InstagramCardnewsAgent"].workflow == "instagram"
    out = AGENTS["InstagramCardnewsAgent"].build_report(
        Task(goal="cardnews", assigned_agent="InstagramCardnewsAgent",
             workflow="instagram"), None)
    assert "publish" in out.lower()  # publish flagged as a gate
