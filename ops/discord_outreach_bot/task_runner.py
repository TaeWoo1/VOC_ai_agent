#!/usr/bin/env python3
"""Guarded local runner — v0.3 M3-C (verify / dry-run / run / review / rollback).

The FIRST write-capable runner, but for EXACTLY ONE action (`scaffold_packet`)
and only after the full M3-A gate PLUS a matching clean dry-run. It writes only:
    outputs/outreach/new_targets/<slug>/
    outputs/outreach/new_targets/<slug>/status.json
It NEVER runs collection, sends email, renders PDFs, publishes Instagram, opens
a browser, makes network calls, invokes Claude Code, commits, edits an existing
packet folder, writes send_log.md, or auto-runs multiple tasks.

Core safety contract: a task may only run if a recorded operator approval's
`prompt_hash` still equals the freshly-recomputed proposal hash AND a clean
dry-run for that exact approval already happened. `run` writes the scaffold but
leaves the task in `pending_review`; a deterministic CodexReviewAgent (`review`)
must PASS before the task is `done`. A failed review blocks the task and
recommends — but NEVER auto-runs — `rollback`. `rollback` deletes only the
files a `done` run created (no --force).

Usage:
    python3 ops/discord_outreach_bot/task_runner.py verify   <task_id>
    python3 ops/discord_outreach_bot/task_runner.py dry-run  <task_id>
    python3 ops/discord_outreach_bot/task_runner.py run      <task_id>
    python3 ops/discord_outreach_bot/task_runner.py review   <run_id>
    python3 ops/discord_outreach_bot/task_runner.py rollback <run_id>
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Optional

sys.path.insert(0, str(Path(__file__).resolve().parent))

import approval_log as _alog          # noqa: E402
import codex_review as _cr            # noqa: E402
import codex_reviews as _crl          # noqa: E402
import orchestration_events as _oev    # noqa: E402
import orchestrator as _orch           # noqa: E402
import status_reader as _sr           # noqa: E402
import task_inputs as _ti             # noqa: E402
import task_runs as _runs             # noqa: E402
import task_store as _store           # noqa: E402
from agent_registry import AGENTS     # noqa: E402
from task_model import utc_now_str    # noqa: E402

# The ONLY runner action M3 will ever execute (M3-A only verifies/dry-runs it).
ALLOWED_RUNNER_ACTIONS = {"scaffold_packet"}
# stage command -> runner action. Intentionally narrow; everything else refuses.
STAGE_TO_ACTION = {"candidate_shortlist_pick": "scaffold_packet"}


def _stage_command(stage: Optional[str]) -> Optional[str]:
    if not stage:
        return None
    return stage.split(":", 1)[1] if stage.startswith("outreach:") else stage


@dataclass
class VerifyResult:
    ok: bool
    reason: Optional[str] = None        # machine-readable failure code (None on PASS)
    message: str = ""
    task_id: Optional[str] = None
    action: Optional[str] = None
    target_slug: Optional[str] = None
    approval_ref: Optional[str] = None
    prompt_hash: Optional[str] = None
    candidate: Optional[dict[str, Any]] = None
    would_create: list[str] = field(default_factory=list)
    status_preview: Optional[dict[str, Any]] = None

    def fail(self, reason: str, message: str) -> "VerifyResult":
        self.ok = False
        self.reason = reason
        self.message = message
        return self


def _fail(task_id: str, reason: str, message: str) -> VerifyResult:
    return VerifyResult(ok=False, reason=reason, message=message, task_id=task_id)


def verify(task_id: str, *, store_path: Path, approvals_path: Path,
           targets_dir: Optional[Path] = None) -> VerifyResult:
    """Read-only eligibility check. Creates/mutates NOTHING."""
    tdir = Path(targets_dir) if targets_dir else _sr.default_targets_dir()

    task = _store.get_task(task_id, store_path)
    if task is None:
        return _fail(task_id, "task_not_found", f"no task with id {task_id!r}")
    if task.status != "queued":
        return _fail(task_id, "bad_status",
                     f"task status is {task.status!r}, must be 'queued' "
                     "(approved + awaiting run)")
    if not task.approval_ref:
        return _fail(task_id, "missing_approval_ref",
                     "task has no approval_ref — not approved")

    # parse "{timestamp_utc}|sha256:<hex>"
    if "|" not in task.approval_ref:
        return _fail(task_id, "malformed_approval_ref",
                     f"approval_ref not in '<ts>|<hash>' form: {task.approval_ref!r}")
    ts, phash = task.approval_ref.split("|", 1)
    if not phash.startswith("sha256:"):
        return _fail(task_id, "malformed_approval_ref",
                     f"approval_ref hash not sha256: {phash!r}")

    stage_cmd = _stage_command(task.intended_stage)

    # locate the recorded approval (intent, prompt_only)
    rec = None
    for r in _alog.read_records(approvals_path):
        if (r.get("timestamp_utc") == ts and r.get("prompt_hash") == phash
                and r.get("target_slug") == (task.target_slug or "(none)")
                and r.get("approved_stage") == stage_cmd
                and r.get("execution_mode") == "prompt_only"):
            rec = r
            break
    if rec is None:
        return _fail(task_id, "no_matching_approval",
                     "no approvals.log record matches this approval_ref/stage/target")

    # rebuild the proposal and re-hash — approval is bound to EXACT content
    target = _sr.get_target(task.target_slug, tdir) if task.target_slug else None
    current_hash = _alog.prompt_hash(AGENTS[task.assigned_agent].build_report(task, target))
    if current_hash != phash:
        return _fail(task_id, "prompt_hash_mismatch",
                     "proposal changed since approval — re-approval required "
                     f"(approved {phash}, current {current_hash})")

    action = STAGE_TO_ACTION.get(stage_cmd or "")
    if action not in ALLOWED_RUNNER_ACTIONS:
        return _fail(task_id, "stage_not_runnable",
                     f"stage {stage_cmd!r} has no allowed runner action")

    # dependencies must all be done
    for dep in task.dependencies:
        d = _store.get_task(dep, store_path)
        if d is None or d.status != "done":
            return _fail(task_id, "deps_incomplete",
                         f"dependency {dep!r} is not done")

    res = VerifyResult(ok=True, task_id=task_id, action=action,
                       target_slug=task.target_slug, approval_ref=task.approval_ref,
                       prompt_hash=phash)

    # --- scaffold_packet specifics --------------------------------------------
    if action == "scaffold_packet":
        try:
            cand = _ti.validate_candidate((task.inputs or {}).get("candidate"))
        except _ti.CandidateInputError as exc:
            return res.fail(exc.reason, str(exc))
        slug = cand["slug"]
        folder = (tdir / slug).resolve()
        # slug regex already blocks traversal; assert the folder is a direct child
        if folder.parent != tdir.resolve():
            return res.fail("unsafe_slug", "resolved scaffold path escapes targets dir")
        if folder.exists():
            return res.fail("target_exists",
                            f"target folder already exists: {folder}")
        status_json = folder / "status.json"
        res.candidate = cand
        res.would_create = [str(folder) + "/", str(status_json)]
        res.status_preview = build_scaffold_status(cand)   # runner_meta=None -> deterministic

    res.message = f"PASS — {action} eligible for `{task_id}`"
    return res


def build_scaffold_status(candidate: dict[str, Any], runner_meta: Optional[dict] = None,
                          now=None) -> dict[str, Any]:
    """Initial status.json for a scaffolded packet — shared by dry-run + run.

    With runner_meta=None this is the DETERMINISTIC preview (no `runner` block,
    history `at`=None) so the stored dry-run preview equals the recomputed run
    plan. With runner_meta set (actual run) it adds provenance + a real
    timestamp. Initial state is CANDIDATE_SELECTED (the workflow's first state);
    the runner never advances past it. No send/collection/PDF — by construction.
    """
    status: dict[str, Any] = {
        "brand": candidate["brand"],
        "goods_no": candidate["goods_no"],
        "slug": candidate["slug"],
        "product_name": candidate["product_name"],
        "state": "CANDIDATE_SELECTED",
        "state_note": "created by guarded runner scaffold; no collection run, no send, no PDF",
        "corpus": {"unique": 0, "min_met": False, "collection_run": False},
        "approved_angle": None,
        "gates_passed": [],
        "send": None,
        "response": None,
        "history": [{
            "state": "CANDIDATE_SELECTED",
            "at": utc_now_str(now) if runner_meta else None,
            "by": "guarded_runner",
            "note": ("scaffold only — no collection/send/PDF; created from "
                     "approved candidate_shortlist_pick"),
        }],
    }
    if str(candidate.get("product_url") or "").strip():
        status["product_url"] = candidate["product_url"]
    if runner_meta:
        status["runner"] = {
            "run_id": runner_meta["run_id"],
            "task_id": runner_meta["task_id"],
            "approval_ref": runner_meta["approval_ref"],
            "prompt_hash": runner_meta["prompt_hash"],
            "runner_action": "scaffold_packet",
        }
    return status


def dry_run(task_id: str, *, store_path: Path, approvals_path: Path,
            runs_path: Path, targets_dir: Optional[Path] = None,
            now=None) -> dict[str, Any]:
    """Verify, then (on PASS) append a `dry_run` run record. Writes NO packet files."""
    res = verify(task_id, store_path=store_path, approvals_path=approvals_path,
                 targets_dir=targets_dir)
    if not res.ok:
        return {"ok": False, "reason": res.reason, "message": res.message}

    preview = {"would_create": res.would_create, "status_json": res.status_preview}
    record = _runs.make_run_record(
        task_id=task_id, runner_action=res.action, status="dry_run",
        approval_ref=res.approval_ref, prompt_hash=res.prompt_hash,
        rollback_plan=[f"(dry-run only — nothing to roll back) {p}"
                       for p in res.would_create],
        codex_review_status="n/a", dry_run_preview=preview, now=now)
    _runs.append_run(record, runs_path)
    return {"ok": True, "reason": None, "run_id": record["run_id"],
            "would_create": res.would_create, "status_preview": res.status_preview}


def run(task_id: str, *, store_path: Path, approvals_path: Path, runs_path: Path,
        events_path: Path, targets_dir: Optional[Path] = None,
        now=None) -> dict[str, Any]:
    """Scaffold-write an approved task (M3-B). Writes ONLY the new folder +
    status.json, then marks the task done. Refuses unless verify PASSes AND a
    matching clean dry-run exists. On any write error, auto-cleans partials."""
    res = verify(task_id, store_path=store_path, approvals_path=approvals_path,
                 targets_dir=targets_dir)
    if not res.ok:
        return {"ok": False, "reason": res.reason, "message": res.message}

    tdir = Path(targets_dir) if targets_dir else _sr.default_targets_dir()
    cand = res.candidate
    folder = (tdir / cand["slug"]).resolve()
    status_json = folder / "status.json"

    # NEW gate: a clean dry-run for THIS exact approval must already exist
    dr = _runs.find_matching_dry_run(task_id, "scaffold_packet",
                                     res.approval_ref, res.prompt_hash, runs_path)
    if dr is None:
        return {"ok": False, "reason": "no_clean_dry_run",
                "message": "no matching clean dry-run for this approval — dry-run first"}
    plan = {"would_create": res.would_create, "status_json": build_scaffold_status(cand)}
    if plan != dr.get("dry_run_preview"):
        return {"ok": False, "reason": "dry_run_plan_drift",
                "message": "run plan differs from the recorded dry-run preview"}

    prev = _runs.find_latest_run_for_task_action(task_id, "scaffold_packet", runs_path)
    if prev and prev.get("status") == "done":
        return {"ok": False, "reason": "already_scaffolded",
                "message": f"a completed scaffold run already exists ({prev['run_id']})"}

    run_id = _runs.new_run_id()
    rollback_plan = [f"rm {status_json}", f"rmdir {folder}"]
    meta = {"approval_ref": res.approval_ref, "prompt_hash": res.prompt_hash}
    _runs.append_run(_runs.make_run_record(
        run_id=run_id, task_id=task_id, runner_action="scaffold_packet",
        status="running", rollback_plan=rollback_plan,
        codex_review_status="pending", now=now, **meta), runs_path)

    created_folder = False
    tmp = folder / ".status.json.tmp"
    try:
        if folder.exists():
            raise RuntimeError("target folder appeared after verify (race)")
        folder.mkdir(parents=False)           # parent (targets dir) must already exist
        created_folder = True
        status = build_scaffold_status(cand, runner_meta={
            "run_id": run_id, "task_id": task_id, **meta}, now=now)
        tmp.write_text(json.dumps(status, ensure_ascii=False, indent=2), encoding="utf-8")
        os.replace(tmp, status_json)          # atomic publish within the new folder
    except Exception as exc:
        # auto-cleanup: remove ONLY what this run created
        try:
            if tmp.exists():
                tmp.unlink()
            if status_json.exists():
                status_json.unlink()
            if created_folder and folder.exists() and not any(folder.iterdir()):
                folder.rmdir()
        except OSError:
            pass
        _runs.append_run(_runs.make_run_record(
            run_id=run_id, task_id=task_id, runner_action="scaffold_packet",
            status="failed", rollback_plan=rollback_plan, codex_review_status="n/a",
            failure_reason=str(exc), now=now, **meta), runs_path)
        _oev.append_event(_oev.make_event(
            event_type="task_failed", source="task_runner", task_id=task_id,
            intended_stage="outreach:candidate_shortlist_pick", gate="green",
            status="failed", message=f"scaffold write failed: {exc}"), events_path)
        return {"ok": False, "reason": "scaffold_write_error",
                "message": str(exc), "run_id": run_id}

    files_created = [str(folder) + "/", str(status_json)]
    _runs.append_run(_runs.make_run_record(
        run_id=run_id, task_id=task_id, runner_action="scaffold_packet", status="done",
        files_created=files_created, files_modified=[], rollback_plan=rollback_plan,
        codex_review_status="pending", now=now, **meta), runs_path)

    # M3-C: the write completed (run record `done`) but the task is NOT accepted
    # yet — it waits in `pending_review` for the CodexReviewAgent gate.
    task = _store.get_task(task_id, store_path)
    if task is not None:
        task.status = "pending_review"
        task.result_summary = f"scaffold written, awaiting review ({folder})"
        task.touch(now)
        _store.append_task_snapshot(task, store_path)
    _oev.append_event(_oev.make_event(
        event_type="codex_review_requested", source="task_runner", task_id=task_id,
        intended_stage="outreach:candidate_shortlist_pick", gate="green",
        status="pending_review",
        message=f"scaffold written ({run_id}); awaiting CodexReviewAgent review",
        now=now), events_path)
    return {"ok": True, "run_id": run_id, "files_created": files_created,
            "task_status": "pending_review"}


def review(run_id: str, *, store_path: Path, events_path: Path, runs_path: Path,
           reviews_path: Path, targets_dir: Optional[Path] = None,
           now=None) -> dict[str, Any]:
    """Run the deterministic CodexReviewAgent over a scaffold run, record the
    verdict, and gate the task. PASS -> task `done`; FAIL -> task `blocked`
    (files left on disk; cleanup is an explicit operator `rollback`). Never
    deletes or rolls back automatically."""
    recs = _runs.records_for_run(run_id, runs_path)
    if not recs:
        return {"ok": False, "reason": "run_not_found", "message": f"no run {run_id!r}"}
    latest = recs[-1]
    if latest.get("status") != "done":
        return {"ok": False, "reason": "not_done",
                "message": f"run status is {latest.get('status')!r}, not 'done'"}
    if latest.get("codex_review_status") in ("pass", "fail"):
        return {"ok": False, "reason": "already_reviewed",
                "message": f"run already reviewed: {latest.get('codex_review_status')}"}

    tdir = Path(targets_dir) if targets_dir else _sr.default_targets_dir()
    outcome = _cr.review_scaffold_run(run_id, runs_path=runs_path,
                                      targets_dir=tdir, now=now)
    task_id = outcome.task_id
    rec = _crl.make_review_record(
        run_id=run_id, task_id=task_id, status=outcome.status,
        findings=outcome.findings, files_checked=outcome.files_checked,
        recommended_action=outcome.recommended_action, now=now)
    _crl.append_review(rec, reviews_path)

    first_fail = outcome.first_failure()
    _runs.append_review_outcome(
        run_id, codex_review_status=outcome.status, review_id=rec["review_id"],
        failure_reason=(first_fail["check"] if first_fail else None),
        runs_path=runs_path, now=now)

    failing = [f for f in outcome.findings if not f["ok"]]
    if outcome.status == "pass":
        _orch.mark_task_done(task_id, store_path=store_path, events_path=events_path,
                             result_summary=f"scaffold reviewed PASS ({rec['review_id']})")
        _oev.append_event(_oev.make_event(
            event_type="codex_review_passed", source="task_runner", task_id=task_id,
            intended_stage="outreach:candidate_shortlist_pick", gate="green",
            status="done", message=f"review pass ({rec['review_id']})", now=now),
            events_path)
        return {"ok": True, "status": "pass", "review_id": rec["review_id"],
                "recommended_action": "accept", "task_id": task_id}

    # FAIL: block the task; DO NOT delete files, DO NOT auto-rollback.
    task = _store.get_task(task_id, store_path) if task_id else None
    if task is not None:
        task.status = "blocked"
        task.result_summary = (f"review FAILED ({outcome.recommended_action}); "
                               f"recommend rollback ({rec['review_id']})")
        task.touch(now)
        _store.append_task_snapshot(task, store_path)
    _oev.append_event(_oev.make_event(
        event_type="codex_review_failed", source="task_runner", task_id=task_id,
        intended_stage="outreach:candidate_shortlist_pick", gate="green",
        status="blocked",
        message=(f"review fail ({rec['review_id']}); recommend "
                 f"{outcome.recommended_action}"), now=now), events_path)
    return {"ok": True, "status": "fail", "review_id": rec["review_id"],
            "recommended_action": outcome.recommended_action, "task_id": task_id,
            "findings": failing}


def rollback(run_id: str, *, store_path: Path, events_path: Path, runs_path: Path,
             targets_dir: Optional[Path] = None) -> dict[str, Any]:
    """Delete ONLY the files a `done` scaffold run created, then return the task
    to `queued`. Refuses on path-escape / extra files / already-rolled-back /
    non-done. No --force."""
    recs = _runs.records_for_run(run_id, runs_path)
    if not recs:
        return {"ok": False, "reason": "run_not_found", "message": f"no run {run_id!r}"}
    latest = recs[-1]
    if latest["status"] == "rolled_back":
        return {"ok": False, "reason": "already_rolled_back", "message": "already rolled back"}
    if latest["status"] != "done":
        return {"ok": False, "reason": "not_rollbackable",
                "message": f"run status is {latest['status']!r}, not 'done'"}

    files_created = latest.get("files_created") or []
    status_paths = [p for p in files_created if p.rstrip("/").endswith("status.json")]
    if not status_paths:
        return {"ok": False, "reason": "nothing_to_rollback",
                "message": "run recorded no status.json"}
    status_json = Path(status_paths[0])
    folder = status_json.parent
    tdir = Path(targets_dir) if targets_dir else _sr.default_targets_dir()

    # path safety: folder is a direct child of the targets dir; all paths under it
    if folder.resolve().parent != tdir.resolve():
        return {"ok": False, "reason": "path_escape",
                "message": f"{folder} is not directly under the targets dir"}
    for p in files_created:
        rp = Path(p.rstrip("/")).resolve()
        if rp != folder.resolve() and folder.resolve() not in rp.parents:
            return {"ok": False, "reason": "path_escape", "message": f"{p} escapes the folder"}

    task_id = latest.get("task_id")
    if folder.exists():
        extras = {c.name for c in folder.iterdir()} - {"status.json"}
        if extras:
            return {"ok": False, "reason": "unexpected_extra_files",
                    "message": f"folder has unexpected files: {sorted(extras)}"}
        if status_json.exists():
            status_json.unlink()
        if folder.exists() and not any(folder.iterdir()):
            folder.rmdir()

    _runs.append_run(_runs.make_run_record(
        run_id=run_id, task_id=task_id, runner_action="scaffold_packet",
        status="rolled_back", approval_ref=latest.get("approval_ref"),
        prompt_hash=latest.get("prompt_hash"), files_created=files_created,
        rollback_plan=latest.get("rollback_plan")), runs_path)
    _oev.append_event(_oev.make_event(
        event_type="run_rolled_back", source="task_runner", task_id=task_id,
        intended_stage="outreach:candidate_shortlist_pick", gate="green",
        status="rolled_back", message=f"scaffold rolled back ({run_id})"), events_path)

    # return the task to queued (approval_ref kept) so it can be re-run. A
    # scaffolded task may be `done` (M3-B), `pending_review` (M3-C, not yet
    # reviewed), or `blocked` (M3-C, review failed) — all roll back to queued.
    task = _store.get_task(task_id, store_path) if task_id else None
    if task and task.status in ("done", "pending_review", "blocked"):
        task.status = "queued"
        task.result_summary = f"scaffold rolled back ({run_id})"
        task.touch()
        _store.append_task_snapshot(task, store_path)
    return {"ok": True, "run_id": run_id, "removed": files_created}


# --- CLI ---------------------------------------------------------------------
def _paths(args) -> dict[str, Any]:
    return {
        "store_path": Path(args.store) if args.store else _store.default_store_path(),
        "approvals_path": (Path(args.approvals) if args.approvals
                           else _alog.default_log_path()),
        "targets_dir": Path(args.targets_dir) if args.targets_dir else None,
    }


def main(argv=None) -> int:
    p = argparse.ArgumentParser(
        prog="task-runner",
        description="Guarded local runner (M3-C: verify / dry-run / run / review / rollback).")
    p.add_argument("--store", default=None)
    p.add_argument("--events", default=None)
    p.add_argument("--approvals", default=None)
    p.add_argument("--runs", default=None)
    p.add_argument("--reviews", default=None)
    p.add_argument("--targets-dir", default=None, dest="targets_dir")
    sub = p.add_subparsers(dest="command", required=True)
    for name in ("verify", "dry-run", "run"):
        sub.add_parser(name).add_argument("task_id")
    sub.add_parser("review").add_argument("run_id")
    sub.add_parser("rollback").add_argument("run_id")
    args = p.parse_args(argv)
    paths = _paths(args)
    runs_path = Path(args.runs) if args.runs else _runs.default_runs_path()
    events_path = Path(args.events) if args.events else _oev.default_events_path()
    reviews_path = Path(args.reviews) if args.reviews else _crl.default_reviews_path()

    if args.command == "verify":
        res = verify(args.task_id, **paths)
        if res.ok:
            print(res.message)
            for w in res.would_create:
                print(f"  would create (NOT created): {w}")
            return 0
        print(f"FAIL [{res.reason}] {res.message}", file=sys.stderr)
        return 1

    if args.command == "dry-run":
        out = dry_run(args.task_id, runs_path=runs_path, **paths)
        if not out["ok"]:
            print(f"FAIL [{out['reason']}] {out['message']}", file=sys.stderr)
            return 1
        print(f"DRY-RUN OK (run_id={out['run_id']}) — NO files created.")
        for w in out["would_create"]:
            print(f"  would create: {w}")
        print("initial status.json preview:")
        for k, v in (out["status_preview"] or {}).items():
            print(f"  {k}: {v}")
        return 0

    if args.command == "run":
        out = run(args.task_id, runs_path=runs_path, events_path=events_path, **paths)
        if not out["ok"]:
            print(f"FAIL [{out['reason']}] {out['message']}", file=sys.stderr)
            return 1
        print(f"RUN OK (run_id={out['run_id']}) — scaffold written (task pending_review):")
        for f in out["files_created"]:
            print(f"  created: {f}")
        print(f"  next: task-runner review {out['run_id']}")
        return 0

    if args.command == "review":
        out = review(args.run_id, store_path=paths["store_path"], events_path=events_path,
                     runs_path=runs_path, reviews_path=reviews_path,
                     targets_dir=paths["targets_dir"])
        if not out["ok"]:
            print(f"FAIL [{out['reason']}] {out['message']}", file=sys.stderr)
            return 1
        if out["status"] == "pass":
            print(f"REVIEW PASS (review_id={out['review_id']}) — task done.")
            return 0
        print(f"REVIEW FAIL (review_id={out['review_id']}) "
              f"recommended_action={out['recommended_action']}", file=sys.stderr)
        for f in out.get("findings", []):
            print(f"  - {f['check']}: {f['detail']}", file=sys.stderr)
        return 2

    # rollback
    out = rollback(args.run_id, store_path=paths["store_path"], events_path=events_path,
                   runs_path=runs_path, targets_dir=paths["targets_dir"])
    if not out["ok"]:
        print(f"FAIL [{out['reason']}] {out['message']}", file=sys.stderr)
        return 1
    print(f"ROLLBACK OK ({out['run_id']}) — removed:")
    for f in out["removed"]:
        print(f"  removed: {f}")
    return 0


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
