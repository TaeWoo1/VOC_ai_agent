"""M2→M3 bridge: task_inputs.set_candidate + task_input_cli. tmp only.

Builds shortlist-pick tasks, attaches candidates, and verifies approval
invalidation + that the M3-A runner accepts the result after re-approval.
No Discord, no packet writes.
"""

from __future__ import annotations

import json

import orchestration_events as oev
import pytest
import task_input_cli as cli
import task_inputs as ti
import task_runner as runner
import task_runs as tr
import task_store as ts
from orchestrator import record_task_approval
from task_model import Task

_CANDIDATE = {"slug": "acme_dew_cream_v1", "brand": "ACME",
              "goods_no": "A000000111111", "product_name": "ACME 수분크림"}


def _paths(tmp_path):
    return {"store_path": tmp_path / "tasks.jsonl",
            "events_path": tmp_path / "events.jsonl"}


def _pick(stage="outreach:candidate_shortlist_pick", status="needs_approval", inputs=None):
    return Task(goal="pick", assigned_agent="CandidateResearchAgent",
                intended_stage=stage, gate="green", approval_required=True,
                status=status, inputs=inputs or {})


# --- 1-4: refusals -----------------------------------------------------------
def test_fails_for_missing_task(tmp_path):
    p = _paths(tmp_path)
    with pytest.raises(ti.CandidateInputError) as e:
        ti.set_candidate("ghost", _CANDIDATE, **p)
    assert e.value.reason == "task_not_found"


def test_fails_for_wrong_stage(tmp_path):
    p = _paths(tmp_path)
    t = _pick(stage="outreach:follow_up")
    ts.append_task_snapshot(t, p["store_path"])
    with pytest.raises(ti.CandidateInputError) as e:
        ti.set_candidate(t.task_id, _CANDIDATE, **p)
    assert e.value.reason == "wrong_stage"


def test_fails_for_unsafe_slug(tmp_path):
    p = _paths(tmp_path)
    t = _pick()
    ts.append_task_snapshot(t, p["store_path"])
    with pytest.raises(ti.CandidateInputError) as e:
        ti.set_candidate(t.task_id, {**_CANDIDATE, "slug": "Bad Slug!"}, **p)
    assert e.value.reason == "unsafe_slug"


def test_fails_for_missing_required_field(tmp_path):
    p = _paths(tmp_path)
    t = _pick()
    ts.append_task_snapshot(t, p["store_path"])
    with pytest.raises(ti.CandidateInputError) as e:
        ti.set_candidate(t.task_id, {"slug": "x", "brand": "B"}, **p)  # no goods_no/product_name
    assert e.value.reason == "missing_candidate_input"


# --- 5: success --------------------------------------------------------------
def test_succeeds_and_attaches_candidate(tmp_path):
    p = _paths(tmp_path)
    t = _pick()
    ts.append_task_snapshot(t, p["store_path"])
    out = ti.set_candidate(t.task_id, _CANDIDATE, **p)
    assert out["ok"] and out["candidate"] == _CANDIDATE
    stored = ts.get_task(t.task_id, p["store_path"])
    assert stored.inputs["candidate"] == _CANDIDATE
    assert out["approval_invalidated"] is False        # had no approval
    # event recorded
    types = [e["event_type"] for e in oev.read_events(p["events_path"])]
    assert "task_input_set" in types
    assert "approval_invalidated_due_to_input_change" not in types


# --- 6: approval invalidation ------------------------------------------------
def test_clears_prior_approval(tmp_path):
    p = _paths(tmp_path)
    t = _pick()
    ts.append_task_snapshot(t, p["store_path"])
    record_task_approval(t.task_id, operator_discord_id="606",
                         approvals_path=tmp_path / "approvals.log.jsonl", **p)
    assert ts.get_task(t.task_id, p["store_path"]).approval_ref  # approved -> queued
    out = ti.set_candidate(t.task_id, _CANDIDATE, **p)
    assert out["approval_invalidated"] is True
    stored = ts.get_task(t.task_id, p["store_path"])
    assert stored.approval_ref is None and stored.status == "needs_approval"
    assert stored.approval_required is True
    types = [e["event_type"] for e in oev.read_events(p["events_path"])]
    assert "approval_invalidated_due_to_input_change" in types


# --- 7-9: bridge flow into the runner ----------------------------------------
def test_set_then_approve_then_runner_verify_and_dry_run(tmp_path):
    p = _paths(tmp_path)
    approvals = tmp_path / "approvals.log.jsonl"
    targets = tmp_path / "targets"
    targets.mkdir()
    runs = tmp_path / "task_runs.jsonl"

    t = _pick()
    ts.append_task_snapshot(t, p["store_path"])
    ti.set_candidate(t.task_id, _CANDIDATE, **p)               # attach candidate
    record_task_approval(t.task_id, operator_discord_id="606",
                         approvals_path=approvals, **p)        # fresh approval

    r = runner.verify(t.task_id, store_path=p["store_path"],
                      approvals_path=approvals, targets_dir=targets)
    assert r.ok and r.action == "scaffold_packet"

    out = runner.dry_run(t.task_id, store_path=p["store_path"],
                         approvals_path=approvals, runs_path=runs, targets_dir=targets)
    assert out["ok"] is True
    # NO packet folder created; ONLY the run log was written
    assert not (targets / _CANDIDATE["slug"]).exists()
    assert len(tr.read_runs(runs)) == 1
    # nothing created under the targets dir at all
    assert list(targets.iterdir()) == []


# --- 11: malformed candidate JSON via the CLI --------------------------------
def test_cli_malformed_json_fails_cleanly(tmp_path):
    p = _paths(tmp_path)
    t = _pick()
    ts.append_task_snapshot(t, p["store_path"])
    bad = tmp_path / "bad.json"
    bad.write_text("{not valid json", encoding="utf-8")
    rc = cli.main(["--store", str(p["store_path"]), "--events", str(p["events_path"]),
                   "set-candidate", t.task_id, "--candidate-json", str(bad)])
    assert rc == 1
    # task unchanged: no candidate attached
    assert "candidate" not in (ts.get_task(t.task_id, p["store_path"]).inputs or {})


def test_cli_convenience_flags_success(tmp_path):
    p = _paths(tmp_path)
    t = _pick()
    ts.append_task_snapshot(t, p["store_path"])
    rc = cli.main(["--store", str(p["store_path"]), "--events", str(p["events_path"]),
                   "set-candidate", t.task_id, "--slug", "acme_dew_cream_v1",
                   "--brand", "ACME", "--goods-no", "A000000111111",
                   "--product-name", "ACME 수분크림", "--product-url", "https://x"])
    assert rc == 0
    cand = ts.get_task(t.task_id, p["store_path"]).inputs["candidate"]
    assert cand["slug"] == "acme_dew_cream_v1" and cand["product_url"] == "https://x"


def test_cli_via_json_file_success(tmp_path):
    p = _paths(tmp_path)
    t = _pick()
    ts.append_task_snapshot(t, p["store_path"])
    cj = tmp_path / "cand.json"
    cj.write_text(json.dumps(_CANDIDATE, ensure_ascii=False), encoding="utf-8")
    rc = cli.main(["--store", str(p["store_path"]), "--events", str(p["events_path"]),
                   "set-candidate", t.task_id, "--candidate-json", str(cj)])
    assert rc == 0
    assert ts.get_task(t.task_id, p["store_path"]).inputs["candidate"] == _CANDIDATE
