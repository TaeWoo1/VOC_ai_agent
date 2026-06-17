"""task_runner M3-A: verify + dry-run guards. tmp only, no Discord/network.

All fixtures build an approved candidate_shortlist_pick task via the real
orchestrator.record_task_approval (so approval_ref + approvals.log + prompt_hash
are produced exactly as in production), then exercise the runner's read-only
verify and dry-run paths.
"""

from __future__ import annotations

import task_runner as runner
import task_runs as tr
import task_store as ts
from orchestrator import record_task_approval
from task_model import Task

_CANDIDATE = {"slug": "acme_dew_cream_v1", "brand": "ACME",
              "goods_no": "A000000111111", "product_name": "ACME 수분크림"}


def _paths(tmp_path):
    return {"store_path": tmp_path / "tasks.jsonl",
            "approvals_path": tmp_path / "approvals.log.jsonl"}


def _pick_task(inputs, *, deps=None, stage="outreach:candidate_shortlist_pick",
               agent="CandidateResearchAgent"):
    return Task(goal="pick a candidate", assigned_agent=agent, intended_stage=stage,
                gate="green", approval_required=True, status="needs_approval",
                dependencies=deps or [], inputs=inputs)


def _approve(tmp_path, task):
    """Persist + approve a task; returns (task_id, verify_kwargs)."""
    p = _paths(tmp_path)
    ts.append_task_snapshot(task, p["store_path"])
    record_task_approval(task.task_id, operator_discord_id="606",
                         store_path=p["store_path"],
                         events_path=tmp_path / "events.jsonl",
                         approvals_path=p["approvals_path"])
    p["targets_dir"] = tmp_path / "targets"
    p["targets_dir"].mkdir(exist_ok=True)
    return task.task_id, p


# --- 1-3: basic preconditions ------------------------------------------------
def test_verify_fails_if_task_missing(tmp_path):
    p = _paths(tmp_path)
    r = runner.verify("ghost", targets_dir=tmp_path, **p)
    assert not r.ok and r.reason == "task_not_found"


def test_verify_fails_if_not_queued(tmp_path):
    p = _paths(tmp_path)
    t = _pick_task({"candidate": _CANDIDATE})  # status stays needs_approval (not approved)
    ts.append_task_snapshot(t, p["store_path"])
    r = runner.verify(t.task_id, targets_dir=tmp_path, **p)
    assert not r.ok and r.reason == "bad_status"


def test_verify_fails_if_approval_ref_missing(tmp_path):
    p = _paths(tmp_path)
    t = _pick_task({"candidate": _CANDIDATE})
    t.status = "queued"           # queued but never approved -> no approval_ref
    ts.append_task_snapshot(t, p["store_path"])
    r = runner.verify(t.task_id, targets_dir=tmp_path, **p)
    assert not r.ok and r.reason == "missing_approval_ref"


# --- 4-5: approval binding ---------------------------------------------------
def test_verify_fails_if_no_matching_approval(tmp_path):
    p = _paths(tmp_path)
    t = _pick_task({"candidate": _CANDIDATE})
    t.status = "queued"
    t.approval_ref = "2020-01-01T00:00:00Z|sha256:deadbeef"   # not in approvals.log
    ts.append_task_snapshot(t, p["store_path"])
    r = runner.verify(t.task_id, targets_dir=tmp_path, **p)
    assert not r.ok and r.reason == "no_matching_approval"


def test_verify_fails_if_prompt_hash_mismatch(tmp_path):
    tid, p = _approve(tmp_path, _pick_task(
        {"candidate": _CANDIDATE, "brand": "ACME", "product": "orig", "goods_no": "A1"}))
    # mutate an input that build_report uses -> proposal text changes -> hash drifts
    t = ts.get_task(tid, p["store_path"])
    t.inputs["product"] = "CHANGED AFTER APPROVAL"
    ts.append_task_snapshot(t, p["store_path"])
    r = runner.verify(tid, **p)
    assert not r.ok and r.reason == "prompt_hash_mismatch"


# --- 6-7: stage + deps -------------------------------------------------------
def test_verify_fails_if_stage_not_allowed(tmp_path):
    # an approved follow_up task is not a runner action
    tid, p = _approve(tmp_path, _pick_task(
        {"current_state": "SENT"}, stage="outreach:follow_up", agent="FollowupAgent"))
    r = runner.verify(tid, **p)
    assert not r.ok and r.reason == "stage_not_runnable"


def test_verify_fails_if_deps_incomplete(tmp_path):
    tid, p = _approve(tmp_path, _pick_task({"candidate": _CANDIDATE}, deps=["ghost_dep"]))
    r = runner.verify(tid, **p)
    assert not r.ok and r.reason == "deps_incomplete"


# --- 8-10: candidate contract ------------------------------------------------
def test_verify_fails_if_candidate_missing(tmp_path):
    tid, p = _approve(tmp_path, _pick_task({"brand": "ACME"}))  # no 'candidate'
    r = runner.verify(tid, **p)
    assert not r.ok and r.reason == "missing_candidate_input"


def test_verify_fails_if_slug_unsafe(tmp_path):
    bad = {**_CANDIDATE, "slug": "Bad-Slug!!"}
    tid, p = _approve(tmp_path, _pick_task({"candidate": bad}))
    r = runner.verify(tid, **p)
    assert not r.ok and r.reason == "unsafe_slug"


def test_verify_fails_if_target_folder_exists(tmp_path):
    tid, p = _approve(tmp_path, _pick_task({"candidate": _CANDIDATE}))
    (p["targets_dir"] / _CANDIDATE["slug"]).mkdir()      # pre-existing packet
    r = runner.verify(tid, **p)
    assert not r.ok and r.reason == "target_exists"


# --- 11: happy path ----------------------------------------------------------
def test_verify_passes_for_valid_approved_pick(tmp_path):
    tid, p = _approve(tmp_path, _pick_task({"candidate": _CANDIDATE}))
    r = runner.verify(tid, **p)
    assert r.ok and r.reason is None and r.action == "scaffold_packet"
    assert r.candidate == _CANDIDATE
    assert any("status.json" in w for w in r.would_create)
    assert r.status_preview["state"] == "CANDIDATE_SELECTED"
    assert r.status_preview["corpus"]["collection_run"] is False


# --- 12-14: dry-run ----------------------------------------------------------
def test_dry_run_creates_no_packet_files_and_logs_one_run(tmp_path):
    tid, p = _approve(tmp_path, _pick_task({"candidate": _CANDIDATE}))
    runs_path = tmp_path / "task_runs.jsonl"
    out = runner.dry_run(tid, runs_path=runs_path, **p)
    assert out["ok"] is True and out["run_id"].startswith("run_")
    # NO packet folder/file created
    folder = p["targets_dir"] / _CANDIDATE["slug"]
    assert not folder.exists()
    # exactly ONE run record, status dry_run, preview carries status.json
    recs = tr.read_runs(runs_path)
    assert len(recs) == 1 and recs[0]["status"] == "dry_run"
    assert recs[0]["dry_run_preview"]["status_json"]["slug"] == _CANDIDATE["slug"]
    assert "status.json" in " ".join(out["would_create"])


def test_dry_run_refuses_when_verify_fails_and_writes_no_run(tmp_path):
    tid, p = _approve(tmp_path, _pick_task({"brand": "ACME"}))  # missing candidate
    runs_path = tmp_path / "task_runs.jsonl"
    out = runner.dry_run(tid, runs_path=runs_path, **p)
    assert out["ok"] is False and out["reason"] == "missing_candidate_input"
    assert tr.read_runs(runs_path) == []        # no run record on verify-fail


# --- 15: capability grep -----------------------------------------------------
def test_runner_has_no_external_capabilities():
    import pathlib
    src = pathlib.Path(runner.__file__).read_text(encoding="utf-8")
    for forbidden in ("smtplib", "requests", "urllib", "subprocess", "selenium",
                      "cdp", "render_outreach", "ingest_oliveyoung", "smtp"):
        assert forbidden not in src, f"runner must not reference {forbidden!r}"
    # the runner must never WRITE a send_log.md (mention in the docstring is fine)
    assert ".status.json.tmp" in src and 'send_log.md"' not in src


# --- M3-B: run + rollback ----------------------------------------------------
def _run_paths(tmp_path):
    return {"runs_path": tmp_path / "task_runs.jsonl",
            "events_path": tmp_path / "events.jsonl"}


def _dry_ran(tmp_path):
    """Approve a valid pick + complete a dry-run; return (task_id, all kwargs)."""
    tid, p = _approve(tmp_path, _pick_task({"candidate": _CANDIDATE}))
    rp = _run_paths(tmp_path)
    out = runner.dry_run(tid, runs_path=rp["runs_path"], **p)
    assert out["ok"]
    return tid, {**p, **rp}


def test_run_refuses_without_prior_dry_run(tmp_path):
    tid, p = _approve(tmp_path, _pick_task({"candidate": _CANDIDATE}))
    rp = _run_paths(tmp_path)
    out = runner.run(tid, runs_path=rp["runs_path"], events_path=rp["events_path"], **p)
    assert not out["ok"] and out["reason"] == "no_clean_dry_run"
    assert not (p["targets_dir"] / _CANDIDATE["slug"]).exists()


def test_run_refuses_if_dry_run_hash_differs(tmp_path):
    # dry-run, then mutate task inputs so a (hypothetical) re-approval would differ.
    tid, kw = _dry_ran(tmp_path)
    # tamper the approval_ref so the matching dry-run lookup fails
    t = ts.get_task(tid, kw["store_path"])
    t.approval_ref = t.approval_ref.split("|")[0] + "|sha256:different"
    ts.append_task_snapshot(t, kw["store_path"])
    out = runner.run(tid, **kw)
    # verify now fails first (no_matching_approval) — still refuses, no write
    assert not out["ok"] and out["reason"] in ("no_matching_approval", "no_clean_dry_run")
    assert not (kw["targets_dir"] / _CANDIDATE["slug"]).exists()


def test_run_creates_only_folder_and_status_json(tmp_path):
    tid, kw = _dry_ran(tmp_path)
    out = runner.run(tid, **kw)
    assert out["ok"]
    folder = kw["targets_dir"] / _CANDIDATE["slug"]
    assert folder.is_dir()
    assert {c.name for c in folder.iterdir()} == {"status.json"}   # ONLY status.json
    assert not (folder / "send_log.md").exists()


def test_run_status_json_valid_and_loads_via_status_reader(tmp_path):
    import json as _json

    import status_reader as sr
    tid, kw = _dry_ran(tmp_path)
    runner.run(tid, **kw)
    folder = kw["targets_dir"] / _CANDIDATE["slug"]
    data = _json.loads((folder / "status.json").read_text(encoding="utf-8"))
    assert data["state"] == "CANDIDATE_SELECTED" and data["corpus"]["unique"] == 0
    assert data["runner"]["runner_action"] == "scaffold_packet"
    t = sr.get_target(_CANDIDATE["slug"], kw["targets_dir"])
    assert t is not None and t.state == "CANDIDATE_SELECTED" and t.corpus_unique == 0


def test_run_leaves_task_pending_review_not_done(tmp_path):
    # M3-C: the write completes (run record `done`, codex_review_status pending)
    # but the task is NOT accepted — it waits in pending_review for the gate.
    tid, kw = _dry_ran(tmp_path)
    out = runner.run(tid, **kw)
    assert out["ok"] and out["task_status"] == "pending_review"
    assert ts.get_task(tid, kw["store_path"]).status == "pending_review"
    statuses = [r["status"] for r in tr.read_runs(kw["runs_path"])]
    assert statuses == ["dry_run", "running", "done"]
    done = tr.read_runs(kw["runs_path"])[-1]
    assert done["codex_review_status"] == "pending"


def test_run_refuses_target_exists(tmp_path):
    tid, kw = _dry_ran(tmp_path)
    (kw["targets_dir"] / _CANDIDATE["slug"]).mkdir()        # folder appears
    out = runner.run(tid, **kw)
    assert not out["ok"] and out["reason"] == "target_exists"   # caught by verify


def test_run_refuses_second_run(tmp_path):
    # after a successful run the task is `done` + folder exists, so a second run
    # is refused (verify catches bad_status first; already_scaffolded/target_exists
    # are the deeper guards). Either way: no double scaffold.
    tid, kw = _dry_ran(tmp_path)
    assert runner.run(tid, **kw)["ok"]
    out = runner.run(tid, **kw)
    assert not out["ok"]
    assert out["reason"] in ("bad_status", "already_scaffolded", "target_exists")
    folder = kw["targets_dir"] / _CANDIDATE["slug"]
    assert {c.name for c in folder.iterdir()} == {"status.json"}   # unchanged


def test_run_write_failure_auto_cleans(tmp_path, monkeypatch):
    tid, kw = _dry_ran(tmp_path)
    import task_runner as tr_mod
    real_replace = tr_mod.os.replace

    def boom(src, dst):
        raise OSError("disk full (simulated)")
    monkeypatch.setattr(tr_mod.os, "replace", boom)
    out = runner.run(tid, **kw)
    monkeypatch.setattr(tr_mod.os, "replace", real_replace)
    assert not out["ok"] and out["reason"] == "scaffold_write_error"
    # no orphaned folder/file left behind
    assert not (kw["targets_dir"] / _CANDIDATE["slug"]).exists()
    assert tr.read_runs(kw["runs_path"])[-1]["status"] == "failed"
    assert ts.get_task(tid, kw["store_path"]).status != "done"


def test_rollback_deletes_only_created_and_requeues(tmp_path):
    tid, kw = _dry_ran(tmp_path)
    out = runner.run(tid, **kw)
    folder = kw["targets_dir"] / _CANDIDATE["slug"]
    assert folder.exists()
    rb = runner.rollback(out["run_id"], store_path=kw["store_path"],
                         events_path=kw["events_path"], runs_path=kw["runs_path"],
                         targets_dir=kw["targets_dir"])
    assert rb["ok"]
    assert not folder.exists()                                  # folder removed
    assert ts.get_task(tid, kw["store_path"]).status == "queued"  # re-runnable
    assert ts.get_task(tid, kw["store_path"]).approval_ref       # approval kept
    assert tr.read_runs(kw["runs_path"])[-1]["status"] == "rolled_back"


def test_rollback_refuses_unexpected_extra_files(tmp_path):
    tid, kw = _dry_ran(tmp_path)
    out = runner.run(tid, **kw)
    folder = kw["targets_dir"] / _CANDIDATE["slug"]
    (folder / "operator_note.txt").write_text("hand-added", encoding="utf-8")  # extra
    rb = runner.rollback(out["run_id"], store_path=kw["store_path"],
                         events_path=kw["events_path"], runs_path=kw["runs_path"],
                         targets_dir=kw["targets_dir"])
    assert not rb["ok"] and rb["reason"] == "unexpected_extra_files"
    assert folder.exists() and (folder / "status.json").exists()   # nothing deleted


def test_rollback_refuses_already_rolled_back(tmp_path):
    tid, kw = _dry_ran(tmp_path)
    out = runner.run(tid, **kw)
    rb_kw = dict(store_path=kw["store_path"], events_path=kw["events_path"],
                 runs_path=kw["runs_path"], targets_dir=kw["targets_dir"])
    assert runner.rollback(out["run_id"], **rb_kw)["ok"]
    second = runner.rollback(out["run_id"], **rb_kw)
    assert not second["ok"] and second["reason"] == "already_rolled_back"


def test_rollback_refuses_non_done_run(tmp_path):
    tid, kw = _dry_ran(tmp_path)
    dry = tr.read_runs(kw["runs_path"])[0]      # the dry_run record
    rb = runner.rollback(dry["run_id"], store_path=kw["store_path"],
                         events_path=kw["events_path"], runs_path=kw["runs_path"],
                         targets_dir=kw["targets_dir"])
    assert not rb["ok"] and rb["reason"] == "not_rollbackable"


# --- M3-C: CodexReviewAgent post-run review gate -----------------------------
import codex_review as cr        # noqa: E402
import codex_reviews as crl      # noqa: E402


def _ran(tmp_path):
    """dry-run + run; returns (task_id, kw incl reviews_path, run_id)."""
    tid, kw = _dry_ran(tmp_path)
    out = runner.run(tid, **kw)
    assert out["ok"]
    kw["reviews_path"] = tmp_path / "codex_reviews.jsonl"
    return tid, kw, out["run_id"]


def _review(run_id, kw):
    return runner.review(run_id, store_path=kw["store_path"], events_path=kw["events_path"],
                         runs_path=kw["runs_path"], reviews_path=kw["reviews_path"],
                         targets_dir=kw["targets_dir"])


def _status_path(kw):
    return kw["targets_dir"] / _CANDIDATE["slug"] / "status.json"


def test_review_passes_clean_scaffold(tmp_path):
    tid, kw, run_id = _ran(tmp_path)
    out = _review(run_id, kw)
    assert out["ok"] and out["status"] == "pass" and out["recommended_action"] == "accept"
    assert ts.get_task(tid, kw["store_path"]).status == "done"          # gated -> done
    latest = tr.read_runs(kw["runs_path"])[-1]
    assert latest["codex_review_status"] == "pass" and latest["status"] == "done"
    rev = crl.find_latest_review_for_run(run_id, kw["reviews_path"])
    assert rev["status"] == "pass" and rev["reviewer"] == "CodexReviewAgent"


def test_review_fail_extra_file_blocks_task_files_remain(tmp_path):
    tid, kw, run_id = _ran(tmp_path)
    folder = kw["targets_dir"] / _CANDIDATE["slug"]
    (folder / "stray.txt").write_text("hand-added", encoding="utf-8")
    out = _review(run_id, kw)
    assert out["status"] == "fail" and out["recommended_action"] == "rollback"
    assert ts.get_task(tid, kw["store_path"]).status == "blocked"
    assert folder.exists() and (folder / "status.json").exists()        # NOT deleted
    assert (folder / "stray.txt").exists()


def test_review_fail_invalid_json(tmp_path):
    tid, kw, run_id = _ran(tmp_path)
    _status_path(kw).write_text("{ not valid json", encoding="utf-8")
    out = _review(run_id, kw)
    assert out["status"] == "fail"
    checks = {f["check"] for f in out["findings"]}
    assert "status_json_valid_json" in checks


def test_review_fail_missing_status_json(tmp_path):
    tid, kw, run_id = _ran(tmp_path)
    _status_path(kw).unlink()
    out = _review(run_id, kw)
    assert out["status"] == "fail"
    assert any(f["check"] == "status_json_exists" for f in out["findings"])


def test_review_fail_send_log_exists(tmp_path):
    tid, kw, run_id = _ran(tmp_path)
    (kw["targets_dir"] / _CANDIDATE["slug"] / "send_log.md").write_text("x", encoding="utf-8")
    out = _review(run_id, kw)
    assert out["status"] == "fail"
    assert any(f["check"] == "no_send_log" and not f["ok"] for f in out["findings"])


def test_review_fail_wrong_state(tmp_path):
    import json as _json
    tid, kw, run_id = _ran(tmp_path)
    data = _json.loads(_status_path(kw).read_text(encoding="utf-8"))
    data["state"] = "SENT"
    _status_path(kw).write_text(_json.dumps(data), encoding="utf-8")
    out = _review(run_id, kw)
    assert out["status"] == "fail"
    assert any(f["check"] == "state_is_candidate_selected" and not f["ok"]
               for f in out["findings"])


def test_review_fail_corpus_collection_run_true(tmp_path):
    import json as _json
    tid, kw, run_id = _ran(tmp_path)
    data = _json.loads(_status_path(kw).read_text(encoding="utf-8"))
    data["corpus"]["collection_run"] = True
    _status_path(kw).write_text(_json.dumps(data), encoding="utf-8")
    out = _review(run_id, kw)
    assert out["status"] == "fail"
    assert any(f["check"] == "corpus_collection_run_false" and not f["ok"]
               for f in out["findings"])


def test_review_records_finding_names_and_details(tmp_path):
    tid, kw, run_id = _ran(tmp_path)
    (kw["targets_dir"] / _CANDIDATE["slug"] / "stray.txt").write_text("x", encoding="utf-8")
    _review(run_id, kw)
    rev = crl.find_latest_review_for_run(run_id, kw["reviews_path"])
    bad = [f for f in rev["findings"] if not f["ok"]]
    assert bad and all({"check", "ok", "detail"} <= set(f) for f in rev["findings"])
    assert any(f["check"] == "folder_contents_exact" for f in bad)


def test_failed_review_does_not_auto_delete(tmp_path):
    tid, kw, run_id = _ran(tmp_path)
    folder = kw["targets_dir"] / _CANDIDATE["slug"]
    _status_path(kw).write_text("{ broken", encoding="utf-8")
    out = _review(run_id, kw)
    assert out["status"] == "fail"
    assert folder.exists() and (folder / "status.json").exists()        # left for operator
    # latest run record reflects the fail but write stays `done`
    latest = tr.read_runs(kw["runs_path"])[-1]
    assert latest["codex_review_status"] == "fail" and latest["status"] == "done"


def test_rollback_after_failed_review_requeues(tmp_path):
    tid, kw, run_id = _ran(tmp_path)
    folder = kw["targets_dir"] / _CANDIDATE["slug"]
    _status_path(kw).write_text("{ broken", encoding="utf-8")
    assert _review(run_id, kw)["status"] == "fail"
    assert ts.get_task(tid, kw["store_path"]).status == "blocked"
    rb = runner.rollback(run_id, store_path=kw["store_path"], events_path=kw["events_path"],
                         runs_path=kw["runs_path"], targets_dir=kw["targets_dir"])
    assert rb["ok"] and not folder.exists()
    t = ts.get_task(tid, kw["store_path"])
    assert t.status == "queued" and t.approval_ref                       # re-runnable


def test_review_refuses_double_review(tmp_path):
    tid, kw, run_id = _ran(tmp_path)
    assert _review(run_id, kw)["status"] == "pass"
    again = _review(run_id, kw)
    assert not again["ok"] and again["reason"] == "already_reviewed"


def test_review_refuses_non_done_run(tmp_path):
    tid, kw = _dry_ran(tmp_path)
    kw["reviews_path"] = tmp_path / "codex_reviews.jsonl"
    dry = tr.read_runs(kw["runs_path"])[0]                                # dry_run record
    out = _review(dry["run_id"], kw)
    assert not out["ok"] and out["reason"] == "not_done"


def test_review_refuses_run_not_found(tmp_path):
    tid, kw = _dry_ran(tmp_path)
    kw["reviews_path"] = tmp_path / "codex_reviews.jsonl"
    out = _review("run_doesnotexist", kw)
    assert not out["ok"] and out["reason"] == "run_not_found"


def test_codex_reviews_append_and_read_helpers(tmp_path):
    path = tmp_path / "codex_reviews.jsonl"
    assert crl.read_reviews(path) == [] and crl.find_latest_review_for_run("x", path) is None
    rec = crl.make_review_record(run_id="run_1", task_id="t1", status="pass",
                                 findings=[{"check": "c", "ok": True, "detail": ""}],
                                 files_checked=["a"], recommended_action="accept")
    crl.append_review(rec, path)
    assert rec["review_id"].startswith("rev_")
    assert crl.read_reviews(path)[0]["run_id"] == "run_1"
    assert crl.find_latest_review_for_run("run_1", path)["status"] == "pass"


def test_codex_review_pure_checker_no_side_effects(tmp_path):
    # review_scaffold_run is read-only: it returns a verdict and writes nothing.
    tid, kw, run_id = _ran(tmp_path)
    folder = kw["targets_dir"] / _CANDIDATE["slug"]
    before = {c.name for c in folder.iterdir()}
    outcome = cr.review_scaffold_run(run_id, runs_path=kw["runs_path"],
                                     targets_dir=kw["targets_dir"])
    assert outcome.ok and outcome.task_id == tid
    assert {c.name for c in folder.iterdir()} == before                  # nothing touched
    assert not kw["reviews_path"].exists()                               # no log written


def test_codex_review_has_no_dangerous_capabilities():
    import pathlib
    src = pathlib.Path(cr.__file__).read_text(encoding="utf-8")
    # call-forms only (the docstring documents these as negatives in prose).
    for forbidden in (".unlink(", ".rmdir(", "rmtree(", "shutil", ".write_text(",
                      ".write_bytes(", "os.replace(", "subprocess", "requests",
                      "urllib", "smtplib", "socket"):
        assert forbidden not in src, f"reviewer must not reference {forbidden!r}"


def test_existing_packet_hashes_unchanged_through_lifecycle(tmp_path):
    import hashlib
    tid, kw = _dry_ran(tmp_path)
    # a pre-existing sibling packet that must never be touched
    sibling = kw["targets_dir"] / "snature_existing"
    sibling.mkdir()
    sfile = sibling / "status.json"
    sfile.write_text('{"state": "SENT"}', encoding="utf-8")
    before = hashlib.sha256(sfile.read_bytes()).hexdigest()

    out = runner.run(tid, **kw)
    kw["reviews_path"] = tmp_path / "codex_reviews.jsonl"
    assert _review(out["run_id"], kw)["status"] == "pass"
    runner.rollback(out["run_id"], store_path=kw["store_path"], events_path=kw["events_path"],
                    runs_path=kw["runs_path"], targets_dir=kw["targets_dir"])
    assert hashlib.sha256(sfile.read_bytes()).hexdigest() == before      # byte-identical
