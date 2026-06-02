"""M6-A plan_validator tests — the 'Python disposes' gate.

Covers the strict-validation contract: extra/missing keys, unknown & rejected
intents, runner/allowed actions, hallucinated task ids, unknown agents,
execution-claiming replies, and the Python-recomputed read-only envelope. Pure:
no store, no network, no env.
"""

from __future__ import annotations

import ast
from pathlib import Path

import plan_validator as pv


def _plan(**over):
    base = {
        "intent": "answer_status",
        "target": {"root_task_id": None, "task_id": None, "slug": None},
        "agent": None,
        "safety_level": "read_only",
        "requires_approval": False,
        "allowed_action": None,
        "reply": "현재 진행 상황을 설명드립니다.",
        "proposed_next_steps": [],
        "runner_action": None,
        "confidence": 0.5,
    }
    base.update(over)
    return base


# --- baseline + recompute ----------------------------------------------------
def test_valid_read_only_plan_accepted():
    res = pv.validate(_plan(), known_task_ids=set())
    assert res["ok"] is True
    assert res["outcome"] == pv.VALID
    assert res["intent"] == "answer_status"
    assert res["safety_level"] == "read_only"
    assert res["plan"]["runner_action"] is None
    assert res["plan"]["requires_approval"] is False


def test_safety_level_is_recomputed_not_trusted():
    # model claims external_blocked but the accepted intent is read-only -> forced
    res = pv.validate(_plan(safety_level="external_blocked"), known_task_ids=set())
    assert res["ok"] is True
    assert res["plan"]["safety_level"] == "read_only"


def test_confidence_clamped():
    res = pv.validate(_plan(confidence=9.9), known_task_ids=set())
    assert res["plan"]["confidence"] == 1.0
    res2 = pv.validate(_plan(confidence="nan-ish"), known_task_ids=set())
    assert res2["plan"]["confidence"] == 0.0


# --- 3 / shape ---------------------------------------------------------------
def test_non_dict_is_clarify():
    assert pv.validate(None, known_task_ids=set())["outcome"] == pv.CLARIFY
    assert pv.validate("nope", known_task_ids=set())["outcome"] == pv.CLARIFY


# --- 4. extra keys rejected --------------------------------------------------
def test_extra_keys_rejected():
    p = _plan()
    p["surprise"] = 1
    res = pv.validate(p, known_task_ids=set())
    assert res["outcome"] == pv.CLARIFY
    assert res["reason"].startswith("extra_keys")


def test_missing_keys_rejected():
    p = _plan()
    del p["reply"]
    res = pv.validate(p, known_task_ids=set())
    assert res["outcome"] == pv.CLARIFY
    assert res["reason"].startswith("missing_keys")


# --- 5. unknown intent rejected ----------------------------------------------
def test_unknown_intent_clarify():
    res = pv.validate(_plan(intent="frobnicate"), known_task_ids=set())
    assert res["outcome"] == pv.CLARIFY
    assert res["reason"] == "unknown_intent"


# --- 8. non-null runner_action rejected --------------------------------------
def test_runner_action_rejected():
    res = pv.validate(_plan(runner_action="scaffold_packet"), known_task_ids=set())
    assert res["outcome"] == pv.REFUSED
    assert res["reason"] == "runner_action_not_allowed"


def test_allowed_action_rejected():
    res = pv.validate(_plan(allowed_action="prepare_send"), known_task_ids=set())
    assert res["outcome"] == pv.REFUSED


def test_requires_approval_true_rejected():
    res = pv.validate(_plan(requires_approval=True), known_task_ids=set())
    assert res["outcome"] == pv.REFUSED


# --- 9 / 10. external + claude-code intents rejected -------------------------
def test_external_and_claude_code_intents_rejected():
    for bad in ("run_collection", "send_email", "render_pdf", "publish_instagram",
                "invoke_claude_code", "approve_task", "run_dry_run", "run_scaffold",
                "rollback", "cancel_task_graph", "select_active_graph"):
        res = pv.validate(_plan(intent=bad), known_task_ids=set())
        assert res["outcome"] == pv.REFUSED, bad
        assert res["intent"] == "refuse"
        assert res["safety_level"] == "external_blocked"


# --- 6 / 7. task id grounding ------------------------------------------------
def test_invented_task_id_rejected():
    p = _plan(target={"root_task_id": "task_doesnotexist", "task_id": None, "slug": None})
    res = pv.validate(p, known_task_ids={"task_real0001"})
    assert res["outcome"] == pv.CLARIFY
    assert res["reason"].startswith("unknown_task_id")


def test_existing_task_id_accepted():
    p = _plan(target={"root_task_id": "task_real0001", "task_id": None, "slug": None})
    res = pv.validate(p, known_task_ids={"task_real0001"})
    assert res["ok"] is True
    assert res["plan"]["target"]["root_task_id"] == "task_real0001"


def test_target_extra_keys_clarify():
    p = _plan()
    p["target"] = {"root_task_id": None, "task_id": None, "slug": None, "x": 1}
    assert pv.validate(p, known_task_ids=set())["outcome"] == pv.CLARIFY


# --- 11. agent grounding -----------------------------------------------------
def test_unknown_agent_rejected():
    res = pv.validate(_plan(agent="GhostAgent"), known_agents={"CandidateResearchAgent"})
    assert res["outcome"] == pv.CLARIFY
    assert res["reason"] == "unknown_agent"


# --- 12. create_subagent_prompt accepted as proposal -------------------------
def test_create_subagent_prompt_accepted_with_known_agent():
    p = _plan(intent="create_subagent_prompt", agent="CandidateResearchAgent",
              reply="CandidateResearchAgent에게 후보 요약 프롬프트 생성을 제안합니다.",
              proposed_next_steps=["프롬프트 생성(M6-B)", "후보 선택", "승인"])
    res = pv.validate(p, known_task_ids=set())  # default registry has the agent
    assert res["ok"] is True
    assert res["intent"] == "create_subagent_prompt"
    assert res["plan"]["agent"] == "CandidateResearchAgent"


def test_create_subagent_prompt_without_agent_clarify():
    p = _plan(intent="create_subagent_prompt", agent=None)
    res = pv.validate(p, known_task_ids=set())
    assert res["outcome"] == pv.CLARIFY


# --- reply must not claim execution ------------------------------------------
def test_reply_claiming_execution_refused():
    p = _plan(reply="후보 작업을 취소했습니다. 메일도 발송했습니다.")
    res = pv.validate(p, known_task_ids=set())
    assert res["outcome"] == pv.REFUSED
    assert res["reason"] == "reply_claims_execution"


def test_empty_reply_clarify():
    assert pv.validate(_plan(reply="  "), known_task_ids=set())["outcome"] == pv.CLARIFY


def test_bad_safety_level_clarify():
    assert pv.validate(_plan(safety_level="danger"),
                       known_task_ids=set())["outcome"] == pv.CLARIFY


def test_bad_proposed_next_steps_clarify():
    assert pv.validate(_plan(proposed_next_steps="not-a-list"),
                       known_task_ids=set())["outcome"] == pv.CLARIFY


# --- 18. import boundary: no runner/inputs/subprocess/network/anthropic ------
def test_validator_import_boundary():
    src = Path(pv.__file__).read_text(encoding="utf-8")
    tree = ast.parse(src)
    imported: set[str] = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for a in node.names:
                imported.add(a.name.split(".")[0])
        elif isinstance(node, ast.ImportFrom) and node.module:
            imported.add(node.module.split(".")[0])
    for banned in ("task_runner", "task_inputs", "subprocess", "socket",
                   "webbrowser", "urllib", "requests", "http", "anthropic"):
        assert banned not in imported, banned
