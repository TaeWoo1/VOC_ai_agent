"""Deterministic post-run reviewer for guarded scaffold writes (v0.3 M3-C).

`CodexReviewAgent` here is NOT an LLM and makes NO network / shell-out / Claude
call. It re-reads what a `run` physically wrote and checks it against the ONLY
shape a scaffold is allowed to have, producing a structured verdict. It NEVER
deletes or mutates anything (no `unlink`/`rmdir`/`write`): cleanup stays an
explicit operator `rollback`. The caller (task_runner.review) records the
verdict and transitions the task; this module only reads and judges.

Every check yields a `{check, ok, detail}` finding. Any failed check -> overall
`fail`. `recommended_action` is `accept` on pass, `rollback` if a STRUCTURAL
check failed (the folder/file layout is wrong), else `manual_review` (the layout
is fine but the status.json content is off — a human should look).
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Optional

import status_reader as _sr
import task_runs as _runs

# Structural failures => recommend rollback; content failures => manual_review.
_STRUCTURAL_CHECKS = {
    "run_status_done", "runner_action_scaffold", "files_created_exact",
    "files_modified_empty", "folder_direct_child", "folder_contents_exact",
    "status_json_exists", "status_json_valid_json", "no_send_log",
    "no_forbidden_artifacts", "no_path_escape",
}
# File names / suffixes that must never appear in a scaffold folder.
_FORBIDDEN_SUFFIXES = (".pdf",)
_FORBIDDEN_NAME_TOKENS = ("send_log", "review", "corpus", "collect", "collection")


@dataclass
class ReviewOutcome:
    status: str                          # "pass" | "fail"
    findings: list[dict[str, Any]] = field(default_factory=list)
    files_checked: list[str] = field(default_factory=list)
    recommended_action: str = "accept"   # accept | rollback | manual_review
    run_id: Optional[str] = None
    task_id: Optional[str] = None

    @property
    def ok(self) -> bool:
        return self.status == "pass"

    def first_failure(self) -> Optional[dict[str, Any]]:
        return next((f for f in self.findings if not f["ok"]), None)


def _ck(findings: list[dict[str, Any]], check: str, ok: bool, detail: str = "") -> bool:
    findings.append({"check": check, "ok": bool(ok), "detail": detail})
    return bool(ok)


def review_scaffold_run(run_id: str, *, runs_path: Path,
                        targets_dir: Optional[Path] = None,
                        now=None) -> ReviewOutcome:  # noqa: ARG001 (now reserved)
    """Deterministically review what a scaffold `run` wrote. Read-only.

    Self-contained: re-fetches the run record, derives the slug from the
    recorded `files_created`, and re-reads the on-disk folder. Records one
    finding per check; never raises on a bad scaffold (it reports `fail`),
    only on a genuinely absent run (returned as a `run_exists` failure).
    """
    tdir = (Path(targets_dir) if targets_dir else _sr.default_targets_dir()).resolve()
    findings: list[dict[str, Any]] = []

    recs = _runs.records_for_run(run_id, runs_path)
    if not recs:
        _ck(findings, "run_exists", False, f"no run {run_id!r}")
        return ReviewOutcome(status="fail", findings=findings,
                             recommended_action="manual_review", run_id=run_id)
    _ck(findings, "run_exists", True, "")
    latest = recs[-1]
    done = next((r for r in reversed(recs) if r.get("status") == "done"), None)
    task_id = (done or latest).get("task_id")

    out = ReviewOutcome(status="pass", findings=findings, run_id=run_id, task_id=task_id)

    _ck(findings, "run_status_done", latest.get("status") == "done",
        f"latest run status is {latest.get('status')!r}")
    _ck(findings, "runner_action_scaffold",
        (done or latest).get("runner_action") == "scaffold_packet",
        f"runner_action is {(done or latest).get('runner_action')!r}")

    files_created = list((done or {}).get("files_created") or [])
    _ck(findings, "files_modified_empty",
        not ((done or {}).get("files_modified") or []),
        f"files_modified={list((done or {}).get('files_modified') or [])}")

    # Derive folder/slug from the recorded folder entry (the trailing-"/" one),
    # falling back to the parent of the recorded status.json.
    folder_entries = [p for p in files_created if p.endswith("/")]
    status_entries = [p for p in files_created if p.rstrip("/").endswith("status.json")]
    if folder_entries:
        folder: Optional[Path] = Path(folder_entries[0].rstrip("/"))
    elif status_entries:
        folder = Path(status_entries[0]).parent
    else:
        folder = None

    if folder is None:
        _ck(findings, "files_created_exact", False,
            f"cannot derive scaffold folder from files_created={files_created}")
        out.status = "fail"
        out.recommended_action = "rollback"
        return out

    slug = folder.name
    status_json = folder / "status.json"
    out.files_checked = [str(status_json)]

    expected = {str(folder) + "/", str(status_json)}
    _ck(findings, "files_created_exact", set(files_created) == expected,
        f"files_created={sorted(files_created)} expected={sorted(expected)}")

    folder_r = folder.resolve()
    _ck(findings, "folder_direct_child", folder_r.parent == tdir,
        f"{folder} parent is {folder_r.parent}, expected {tdir}")
    _ck(findings, "no_path_escape",
        folder_r == tdir / slug or folder_r.parent == tdir,
        f"{folder} escapes targets dir {tdir}")

    folder_exists = folder.is_dir()
    on_disk = sorted(c.name for c in folder.iterdir()) if folder_exists else []
    _ck(findings, "folder_contents_exact", folder_exists and on_disk == ["status.json"],
        f"folder contents={on_disk}")
    _ck(findings, "no_send_log", not (folder / "send_log.md").exists(),
        "send_log.md present" if (folder / "send_log.md").exists() else "")

    forbidden = [n for n in on_disk
                 if any(n.lower().endswith(s) for s in _FORBIDDEN_SUFFIXES)
                 or any(tok in n.lower() for tok in _FORBIDDEN_NAME_TOKENS)]
    _ck(findings, "no_forbidden_artifacts", not forbidden,
        f"forbidden artifacts present: {forbidden}" if forbidden else "")

    # --- status.json content (re-read from disk, NOT trusted from any preview) ---
    exists = status_json.exists()
    _ck(findings, "status_json_exists", exists, "status.json missing" if not exists else "")
    data: Optional[dict[str, Any]] = None
    valid_json = False
    if exists:
        try:
            data = json.loads(status_json.read_text(encoding="utf-8"))
            valid_json = isinstance(data, dict)
        except (json.JSONDecodeError, OSError) as exc:
            _ck(findings, "status_json_valid_json", False, f"unparseable: {exc}")
        else:
            _ck(findings, "status_json_valid_json", valid_json,
                "" if valid_json else "status.json is not a JSON object")
    else:
        _ck(findings, "status_json_valid_json", False, "status.json missing")

    if valid_json and data is not None and folder_exists:
        target = _sr.get_target(slug, tdir)
        loads = target is not None and target.state != "STATUS_JSON_PARSE_ERROR"
        _ck(findings, "status_reader_loads", loads,
            "" if loads else "status_reader could not load the packet")
        _ck(findings, "state_is_candidate_selected",
            data.get("state") == "CANDIDATE_SELECTED",
            f"state={data.get('state')!r}")
        corpus = data.get("corpus") if isinstance(data.get("corpus"), dict) else {}
        _ck(findings, "corpus_unique_zero", corpus.get("unique") == 0,
            f"corpus.unique={corpus.get('unique')!r}")
        _ck(findings, "corpus_collection_run_false", corpus.get("collection_run") is False,
            f"corpus.collection_run={corpus.get('collection_run')!r}")
        _ck(findings, "send_is_null", data.get("send") is None,
            f"send={data.get('send')!r}")
    else:
        # content checks cannot run on unreadable JSON; record them as not-ok
        for c in ("status_reader_loads", "state_is_candidate_selected",
                  "corpus_unique_zero", "corpus_collection_run_false", "send_is_null"):
            _ck(findings, c, False, "skipped: status.json unreadable")

    failures = [f for f in findings if not f["ok"]]
    if not failures:
        out.status = "pass"
        out.recommended_action = "accept"
    else:
        out.status = "fail"
        structural = any(f["check"] in _STRUCTURAL_CHECKS for f in failures)
        out.recommended_action = "rollback" if structural else "manual_review"
    return out
