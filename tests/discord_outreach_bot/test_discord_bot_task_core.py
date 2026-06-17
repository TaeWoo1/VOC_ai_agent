"""M2 Discord input adapter cores (pure; no Discord connection).

Exercises task_discord_adapter + that discord_bot imports without discord.py.
All state in tmp_path; a synthetic SENT packet is used for follow-up resolution;
real packet folders are never written.
"""

from __future__ import annotations

import json

import task_discord_adapter as adapter
import task_store as ts


def _paths(tmp_path):
    return {"store_path": tmp_path / "orchestration_tasks.jsonl",
            "events_path": tmp_path / "orchestration_events.jsonl"}


def _sent_targets(tmp_path):
    tdir = tmp_path / "targets"
    pdir = tdir / "snature_aqua_squalane_cream_v1"
    pdir.mkdir(parents=True)
    sj = pdir / "status.json"
    sj.write_text(json.dumps({
        "brand": "에스네이처 (S.NATURE)", "goods_no": "A000000156230",
        "slug": "snature_aqua_squalane_cream_v1", "state": "SENT",
        "send": {"recipient_primary": "mkt@snature.kr", "follow_up_due": "2026-06-08"},
        "response": None,
    }, ensure_ascii=False), encoding="utf-8")
    return tdir, sj


# --- 1 & 2: /task_create core builds + advances the pipeline, stops at gate ---
def test_task_create_builds_cold_email_dag_and_stops_at_gate(tmp_path):
    p = _paths(tmp_path)
    out = adapter.cmd_task_create(
        workflow="outreach", goal="다음 브랜드 하나 골라서 콜드메일까지 준비해줘. 보내지는 마.",
        requested_by="op1", **p)
    assert out["plan_kind"] == "cold_email_pipeline"
    tasks = ts.list_tasks(p["store_path"], parent_task_id=out["parent_task_id"])
    assert len(tasks) == 10                                  # 10 subtasks
    stages = [t.intended_stage for t in tasks]
    assert "outreach:mark_sent" not in stages               # no send task
    # advanced once: candidate_research done, shortlist needs_approval, rest blocked
    by_status = {}
    for t in tasks:
        by_status.setdefault(t.status, 0)
        by_status[t.status] += 1
    assert by_status.get("done") == 1
    assert by_status.get("needs_approval") == 1
    assert by_status.get("blocked") == 8
    assert "Needs operator approval" in out["reply"]


# --- 3: NL "다음 브랜드…" => cold_email_pipeline graph ------------------------
def test_nl_cold_email(tmp_path):
    p = _paths(tmp_path)
    out = adapter.handle_nl_message(
        "다음 브랜드 하나 골라서 콜드메일까지 준비해줘. 보내지는 마.",
        operator_discord_id="606", **p)
    assert out["plan_kind"] == "cold_email_pipeline"
    children = ts.list_tasks(p["store_path"], parent_task_id=out["parent_task_id"])
    assert len(children) == 10


# --- 4: NL "에스네이처…" => follow_up, needs approval, proposal only ----------
def test_nl_followup_needs_approval(tmp_path):
    p = _paths(tmp_path)
    tdir, _ = _sent_targets(tmp_path)
    out = adapter.handle_nl_message("에스네이처 답장 없으면 팔로업 초안 만들어줘.",
                                    operator_discord_id="606", targets_dir=tdir, **p)
    assert out["plan_kind"] == "follow_up"
    t = ts.get_task(out["parent_task_id"], p["store_path"])
    assert t.assigned_agent == "FollowupAgent"
    assert t.target_slug == "snature_aqua_squalane_cream_v1"
    assert t.intended_stage == "outreach:follow_up"
    assert t.gate == "red" and t.status == "needs_approval"
    assert t.artifact_paths and "/task_approve" in out["reply"]


# --- 5: NL "그거 그냥 보내" => M4-A router refuses BEFORE any graph (zero writes) -
# Behavior change (M4-A): the NL router now intercepts an affirmative-send message
# as a dangerous-action refusal, with NO task graph created. The send_ambiguous
# planner path itself is unchanged and still reachable via /task_create (covered in
# test_orchestrator.py); only the natural-language entrypoint short-circuits it.
def test_nl_ambiguous_send_refused_no_graph(tmp_path):
    p = _paths(tmp_path)
    out = adapter.handle_nl_message("그거 그냥 보내.", operator_discord_id="606", **p)
    assert out["handled"] is True and out["intent"] == "dangerous_external_action"
    assert "자연어로 실행하지 않습니다" in out["reply"]
    assert "parent_task_id" not in out                      # no graph created
    # zero store/event writes: the dangerous path mutates nothing
    assert ts.load_tasks(p["store_path"]) == []
    assert not p["events_path"].exists()


# --- 6: /task_approve records approval_ref, mutates NO packet files -----------
def test_task_approve_records_ref_no_packet_mutation(tmp_path):
    p = _paths(tmp_path)
    tdir, status_json = _sent_targets(tmp_path)
    before = status_json.read_bytes()
    approvals = tmp_path / "approvals.log.jsonl"
    out = adapter.handle_nl_message("에스네이처 답장 없으면 팔로업 초안 만들어줘.",
                                    operator_discord_id="606", targets_dir=tdir, **p)
    pid = out["parent_task_id"]
    reply = adapter.cmd_task_approve(task_id=pid, operator_discord_id="606",
                                     approvals_path=approvals, targets_dir=tdir, **p)
    assert "Approval recorded" in reply and "NOT executed" in reply
    t = ts.get_task(pid, p["store_path"])
    assert t.approval_ref and t.status == "queued"           # approved, awaiting manual run
    assert len(approvals.read_text(encoding="utf-8").splitlines()) == 1
    # packet status.json byte-identical; no send_log.md created
    assert status_json.read_bytes() == before
    assert not (status_json.parent / "send_log.md").exists()


# --- 7: /agent_status lists 9 agents + mutation boundaries -------------------
def test_agent_status_core():
    out = adapter.cmd_agent_status()
    assert "Registered agents (9)" in out
    assert "OpsLoggerAgent" in out and "writes-logs" in out
    for name in ("CandidateResearchAgent", "FollowupAgent", "InstagramCardnewsAgent",
                 "CodexReviewAgent", "RecipientAgent"):
        assert name in out


# --- /task_cancel + /tasks + /task_status cores ------------------------------
def test_task_cancel_and_listing(tmp_path):
    p = _paths(tmp_path)
    out = adapter.handle_nl_message("오늘 인스타 카드뉴스 하나 만들어줘.",
                                    operator_discord_id="606", **p)
    pid = out["parent_task_id"]
    # instagram namespace, no outreach target
    t = ts.get_task(pid, p["store_path"])
    assert t.workflow == "instagram" and t.target_slug is None
    # cancel
    creply = adapter.cmd_task_cancel(task_id=pid, reason="not today", **p)
    assert "Cancelled" in creply
    assert ts.get_task(pid, p["store_path"]).status == "cancelled"
    # listing reflects it
    assert "cancelled" in adapter.cmd_tasks(p["store_path"])
    assert "No task matching" in adapter.cmd_task_status("nope", p["store_path"])


# --- discord_bot still imports without discord.py ----------------------------
def _pick_task(inputs=None, status="needs_approval"):
    from task_model import Task
    return Task(goal="pick", assigned_agent="CandidateResearchAgent",
                intended_stage="outreach:candidate_shortlist_pick", gate="green",
                approval_required=True, status=status, inputs=inputs or {})


_CAND = dict(slug="acme_dew_cream_v1", brand="ACME", goods_no="A000000111111",
             product_name="ACME 수분크림")


def test_set_candidate_attaches_and_replies(tmp_path):
    p = _paths(tmp_path)
    t = _pick_task()
    ts.append_task_snapshot(t, p["store_path"])
    reply = adapter.cmd_set_candidate(task_id=t.task_id, **_CAND, **p)
    assert "Candidate attached" in reply and "acme_dew_cream_v1" in reply
    assert f"/task_approve task_id:{t.task_id}" in reply
    assert ts.get_task(t.task_id, p["store_path"]).inputs["candidate"]["slug"] == \
        "acme_dew_cream_v1"


def test_set_candidate_unsafe_slug_fails(tmp_path):
    p = _paths(tmp_path)
    t = _pick_task()
    ts.append_task_snapshot(t, p["store_path"])
    reply = adapter.cmd_set_candidate(task_id=t.task_id, **{**_CAND, "slug": "Bad Slug"}, **p)
    assert "unsafe_slug" in reply
    assert "candidate" not in (ts.get_task(t.task_id, p["store_path"]).inputs or {})


def test_set_candidate_missing_field_fails(tmp_path):
    p = _paths(tmp_path)
    t = _pick_task()
    ts.append_task_snapshot(t, p["store_path"])
    reply = adapter.cmd_set_candidate(task_id=t.task_id, slug="acme_dew_cream_v1",
                                      brand="ACME", goods_no="A1", product_name="", **p)
    assert "missing_candidate_input" in reply


def test_set_candidate_wrong_stage_fails(tmp_path):
    p = _paths(tmp_path)
    from task_model import Task
    t = Task(goal="x", assigned_agent="FollowupAgent", intended_stage="outreach:follow_up",
             gate="red", approval_required=True, status="needs_approval")
    ts.append_task_snapshot(t, p["store_path"])
    reply = adapter.cmd_set_candidate(task_id=t.task_id, **_CAND, **p)
    assert "wrong_stage" in reply


def test_set_candidate_clears_prior_approval(tmp_path):
    p = _paths(tmp_path)
    t = _pick_task()
    ts.append_task_snapshot(t, p["store_path"])
    from orchestrator import record_task_approval
    record_task_approval(t.task_id, operator_discord_id="606",
                         approvals_path=tmp_path / "approvals.log.jsonl", **p)
    assert ts.get_task(t.task_id, p["store_path"]).approval_ref  # queued + approved
    reply = adapter.cmd_set_candidate(task_id=t.task_id, **_CAND, **p)
    assert "prior approval cleared" in reply and "re-approval is required" in reply
    stored = ts.get_task(t.task_id, p["store_path"])
    assert stored.approval_ref is None and stored.status == "needs_approval"


def test_set_candidate_creates_no_packet(tmp_path):
    p = _paths(tmp_path)
    targets = tmp_path / "targets"
    targets.mkdir()
    t = _pick_task()
    ts.append_task_snapshot(t, p["store_path"])
    adapter.cmd_set_candidate(task_id=t.task_id, **_CAND, **p)
    assert list(targets.iterdir()) == []        # no packet folder created


def test_nl_guard_disables_when_channel_missing():
    import discord_bot
    cfg = {"discord": {"operator_channel_id": None}, "nl": {"enabled": True}}
    active, channel, warn = discord_bot._nl_runtime(cfg)
    assert active is False and channel is None          # fail-closed
    assert warn and "operator_channel_id" in warn


def test_nl_guard_active_when_channel_set():
    import discord_bot
    cfg = {"discord": {"operator_channel_id": 123456789012345678},
           "nl": {"enabled": True}}
    active, channel, warn = discord_bot._nl_runtime(cfg)
    assert active is True and channel == 123456789012345678 and warn is None


def test_nl_disabled_stays_disabled_no_warning():
    import discord_bot
    active, channel, warn = discord_bot._nl_runtime(
        {"nl": {"enabled": False}, "discord": {"operator_channel_id": 123}})
    assert active is False and warn is None


def test_build_bot_fail_closed_intent(tmp_path):
    import discord_bot
    if not discord_bot.HAS_DISCORD:
        import pytest
        pytest.skip("discord.py not installed in this env")
    cfg = discord_bot.load_config(config_path=tmp_path / "none.yaml")  # defaults
    cfg["discord"]["allowed_operator_ids"] = [606392855505797120]
    cfg["nl"]["enabled"] = True
    # no channel -> NL disabled -> privileged intent NOT requested
    cfg["discord"]["operator_channel_id"] = None
    assert discord_bot.build_bot(cfg).intents.message_content is False
    # channel set -> NL active -> intent requested
    cfg["discord"]["operator_channel_id"] = 123456789012345678
    assert discord_bot.build_bot(cfg).intents.message_content is True


def test_discord_bot_module_imports_and_defaults(tmp_path):
    # imports cleanly whether or not discord.py is installed in this env
    import discord_bot
    assert hasattr(discord_bot, "build_bot") and hasattr(discord_bot, "run_bot")
    # new config keys present with safe defaults (use a nonexistent path so we
    # read pure defaults, not the operator's real config.yaml)
    cfg = discord_bot.load_config(config_path=tmp_path / "none.yaml")
    assert cfg["nl"]["enabled"] is False                     # NL off by default
    assert "tasks" in cfg and "events" in cfg
    assert discord_bot._nl_enabled(cfg) is False
