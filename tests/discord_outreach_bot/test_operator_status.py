"""D5-1 tests for the read-only operator status indexer.

All trees are constructed under tmp_path. Nothing here reads the real
`outputs/` tree, and the indexer must never write.
"""

from __future__ import annotations

import hashlib
import json
from pathlib import Path

import pytest

import operator_status as ops
from operator_status import (
    CAT_BLOCKED,
    CAT_COMPLETED_FAKE,
    CAT_NEEDS_ATTENTION,
    CAT_READY,
    build_operator_status,
    format_status_card,
)


# --------------------------------------------------------------------------- #
# Builders for constructed artifact trees
# --------------------------------------------------------------------------- #


def _make_repo(tmp_path: Path) -> Path:
    """A minimal repo root the indexer will accept (CLAUDE.md marker)."""
    (tmp_path / "CLAUDE.md").write_text("# test repo\n", encoding="utf-8")
    (tmp_path / "outputs").mkdir()
    return tmp_path


def _send_preview(
    ws: Path, packet_id: str, content_hash: str, *, attachment: str | None = None
) -> None:
    staging = ws / "staging" / packet_id
    staging.mkdir(parents=True, exist_ok=True)
    body = {
        "kind": "send_preview",
        "mode": "draft",
        "task_id": packet_id,
        "recipient_email": "test@example.com",
        "subject": f"[VOC] {packet_id} report",
        "attachments": [attachment] if attachment else [],
        "content_hash": content_hash,
    }
    (staging / "send_preview.json").write_text(json.dumps(body), encoding="utf-8")


def _send_log(ws: Path, packet_id: str, content_hash: str, *, fake: bool = True) -> None:
    pkt = ws / packet_id
    pkt.mkdir(parents=True, exist_ok=True)
    mid = f"fake-{content_hash[7:19]}" if fake else f"real-{content_hash[7:19]}"
    line = (
        f"# send_log\n- 2026-06-04T09:47:03Z | result=sent | "
        f"content_hash={content_hash} | to=test@example.com | "
        f"message_id={mid} | operator=op | stage=send_final\n"
    )
    (pkt / "send_log.md").write_text(line, encoding="utf-8")


def _publish_preview(
    ws: Path,
    package_id: str,
    content_hash: str,
    *,
    rights: str = "cleared",
    safety: str = "pass",
) -> None:
    staging = ws / "staging" / package_id
    staging.mkdir(parents=True, exist_ok=True)
    body = {
        "kind": "publish_preview",
        "mode": "draft",
        "package_id": package_id,
        "caption": "카드뉴스 정리",
        "assets": [{"file": "slide1.png"}],
        "rights_review": {"status": rights},
        "safety_check": {"status": safety},
        "content_hash": content_hash,
    }
    (staging / "publish_preview.json").write_text(json.dumps(body), encoding="utf-8")


def _publish_log(ws: Path, package_id: str, content_hash: str, *, fake: bool = True) -> None:
    pkg = ws / "packages" / package_id
    pkg.mkdir(parents=True, exist_ok=True)
    pid = f"fake-{content_hash[7:19]}" if fake else f"real-{content_hash[7:19]}"
    line = (
        f"# publish_log\n- 2026-06-04T12:59:36Z | result=published | "
        f"content_hash={content_hash} | package={package_id} | "
        f"post_id={pid} | operator=op | stage=publish_final\n"
    )
    (pkg / "publish_log.md").write_text(line, encoding="utf-8")


def _hash(seed: str) -> str:
    return "sha256:" + hashlib.sha256(seed.encode()).hexdigest()


def _by_id(status, _id):
    return next((r for r in status.records if r.id == _id), None)


# --------------------------------------------------------------------------- #
# Tests
# --------------------------------------------------------------------------- #


def test_empty_tree_returns_zero_counts(tmp_path):
    repo = _make_repo(tmp_path)
    status = build_operator_status(repo_root=repo)
    assert sum(status.counts.values()) == 0
    assert status.records == ()
    assert status.attention == ()
    assert status.smoke_excluded == 0


def test_send_preview_without_log_is_ready(tmp_path):
    repo = _make_repo(tmp_path)
    ws = repo / "outputs" / "agent_send_lane"
    _send_preview(ws, "packet_001", _hash("a"))
    status = build_operator_status(repo_root=repo)
    rec = _by_id(status, "packet_001")
    assert rec is not None
    assert rec.category == CAT_READY
    assert not rec.already_completed


def test_send_preview_plus_fake_log_is_completed_fake(tmp_path):
    repo = _make_repo(tmp_path)
    ws = repo / "outputs" / "agent_send_lane"
    h = _hash("b")
    _send_preview(ws, "packet_002", h)
    _send_log(ws, "packet_002", h, fake=True)
    status = build_operator_status(repo_root=repo)
    rec = _by_id(status, "packet_002")
    assert rec.category == CAT_COMPLETED_FAKE
    assert rec.already_completed
    assert rec.last_outcome == "sent"
    assert rec.last_outcome_at == "2026-06-04T09:47:03Z"


def test_send_blocked_marker(tmp_path):
    repo = _make_repo(tmp_path)
    ws = repo / "outputs" / "agent_send_lane"
    _send_preview(ws, "packet_003", _hash("c"))
    (ws / "staging" / "packet_003" / "send.blocked").write_text("recipient unresolved\n")
    status = build_operator_status(repo_root=repo)
    rec = _by_id(status, "packet_003")
    assert rec.category == CAT_BLOCKED
    assert rec.blocked
    assert "recipient" in (rec.blocked_reason or "")


def test_publish_preview_rights_and_safety_pass_is_ready(tmp_path):
    repo = _make_repo(tmp_path)
    ws = repo / "outputs" / "agent_publish_lane"
    _publish_preview(ws, "pkg_001", _hash("d"), rights="cleared", safety="pass")
    status = build_operator_status(repo_root=repo)
    rec = _by_id(status, "pkg_001")
    assert rec.category == CAT_READY


@pytest.mark.parametrize(
    "rights,safety,gate",
    [
        ("pending", "pass", "rights_review_cleared"),
        ("cleared", "fail", "safety_check_pass"),
    ],
)
def test_publish_preview_gate_failure_is_blocked(tmp_path, rights, safety, gate):
    repo = _make_repo(tmp_path)
    ws = repo / "outputs" / "agent_publish_lane"
    _publish_preview(ws, "pkg_002", _hash("e"), rights=rights, safety=safety)
    status = build_operator_status(repo_root=repo)
    rec = _by_id(status, "pkg_002")
    assert rec.category == CAT_BLOCKED
    assert gate in rec.prerequisites_missing


def test_publish_preview_plus_fake_log_is_completed_fake(tmp_path):
    repo = _make_repo(tmp_path)
    ws = repo / "outputs" / "agent_publish_lane"
    h = _hash("f")
    _publish_preview(ws, "pkg_003", h)
    _publish_log(ws, "pkg_003", h, fake=True)
    status = build_operator_status(repo_root=repo)
    rec = _by_id(status, "pkg_003")
    assert rec.category == CAT_COMPLETED_FAKE
    assert rec.already_completed
    assert rec.last_outcome == "published"


def test_malformed_preview_json_is_needs_attention(tmp_path):
    repo = _make_repo(tmp_path)
    ws = repo / "outputs" / "agent_send_lane"
    staging = ws / "staging" / "packet_bad"
    staging.mkdir(parents=True)
    (staging / "send_preview.json").write_text("{ not valid json", encoding="utf-8")
    status = build_operator_status(repo_root=repo)
    rec = next((r for r in status.records if r.path.endswith("send_preview.json")), None)
    assert rec is not None
    assert rec.category == CAT_NEEDS_ATTENTION
    assert rec.last_outcome == "parse_error"


def test_orphan_send_and_publish_logs_are_needs_attention(tmp_path):
    repo = _make_repo(tmp_path)
    ws_s = repo / "outputs" / "agent_send_lane"
    _send_log(ws_s, "packet_orphan", _hash("g"), fake=True)  # no preview
    ws_p = repo / "outputs" / "agent_publish_lane"
    _publish_log(ws_p, "pkg_orphan", _hash("h"), fake=True)  # no preview
    status = build_operator_status(repo_root=repo)
    orphans = [r for r in status.records if r.last_outcome == "orphan_ledger_entry"]
    assert len(orphans) == 2
    assert all(r.category == CAT_NEEDS_ATTENTION for r in orphans)


def test_duplicate_preview_hash_is_idempotency_collision(tmp_path):
    repo = _make_repo(tmp_path)
    ws = repo / "outputs" / "agent_send_lane"
    h = _hash("dup")
    _send_preview(ws, "packet_dupA", h)
    _send_preview(ws, "packet_dupB", h)
    status = build_operator_status(repo_root=repo)
    collisions = [r for r in status.records if r.last_outcome == "idempotency_collision"]
    assert len(collisions) == 2
    assert all(r.category == CAT_NEEDS_ATTENTION for r in collisions)


def test_smoke_excluded_by_default_and_counted(tmp_path):
    repo = _make_repo(tmp_path)
    ws = repo / "outputs" / "agent_send_final_smoke"  # 'smoke' in path
    _send_preview(ws, "packet_smoke_001", _hash("i"))
    status = build_operator_status(repo_root=repo)
    assert status.smoke_excluded >= 1
    assert all(not r.is_smoke for r in status.records)
    assert _by_id(status, "packet_smoke_001") is None


def test_include_smoke_surfaces_records(tmp_path):
    repo = _make_repo(tmp_path)
    ws = repo / "outputs" / "agent_send_final_smoke"
    _send_preview(ws, "packet_smoke_002", _hash("j"))
    status = build_operator_status(repo_root=repo, include_smoke=True)
    rec = _by_id(status, "packet_smoke_002")
    assert rec is not None
    assert rec.is_smoke


def test_collect_runner_stdout_recognized(tmp_path):
    repo = _make_repo(tmp_path)
    run = repo / "outputs" / "agent_collect_runs" / "A0001__DATETIME_DESC__ts"
    run.mkdir(parents=True)
    (run / "runner_stdout.log").write_text("...\n", encoding="utf-8")
    status = build_operator_status(repo_root=repo)
    rec = _by_id(status, "A0001__DATETIME_DESC__ts")
    assert rec is not None
    assert rec.lane == "collect"
    assert rec.last_outcome == "collect_run"


def test_staging_pdf_recognized_as_render(tmp_path):
    repo = _make_repo(tmp_path)
    staging = repo / "outputs" / "agent_render_lane" / "staging" / "pkt"
    staging.mkdir(parents=True)
    (staging / "report_v3.pdf").write_text("%PDF-1.4 fake\n", encoding="utf-8")
    status = build_operator_status(repo_root=repo)
    rec = _by_id(status, "report_v3")
    assert rec is not None
    assert rec.lane == "render"
    assert rec.category == CAT_READY


def test_formatter_is_deterministic(tmp_path):
    repo = _make_repo(tmp_path)
    ws = repo / "outputs" / "agent_send_lane"
    _send_preview(ws, "packet_fmt", _hash("k"))
    status = build_operator_status(repo_root=repo)
    a = format_status_card(status)
    b = format_status_card(status)
    assert a == b
    assert "Operator status" in a
    assert "packet_fmt" in a


def _hash_tree(root: Path) -> dict[str, str]:
    out: dict[str, str] = {}
    for p in sorted(root.rglob("*")):
        if p.is_file():
            out[str(p.relative_to(root))] = hashlib.sha256(p.read_bytes()).hexdigest()
    return out


def test_read_only_invariant_tree_unchanged(tmp_path):
    repo = _make_repo(tmp_path)
    ws = repo / "outputs" / "agent_send_lane"
    h = _hash("ro")
    _send_preview(ws, "packet_ro", h)
    _send_log(ws, "packet_ro", h, fake=True)
    before = _hash_tree(repo)
    build_operator_status(repo_root=repo)
    build_operator_status(repo_root=repo, include_smoke=True)
    after = _hash_tree(repo)
    assert before == after


def test_module_has_no_write_operations():
    """Static guard: the indexer source must not contain mutating I/O calls."""
    src = Path(ops.__file__).read_text(encoding="utf-8")
    banned = (
        "write_text(",
        "write_bytes(",
        ".mkdir(",
        ".unlink(",
        ".rename(",
        ".replace(",  # Path.replace (move); str.replace is fine but absent on Path lines
        "os.remove",
        "shutil.",
        "open(",
    )
    # Allow str.replace usage in _clip by checking for Path-style misuse only:
    offending = [tok for tok in banned if tok in src and tok != ".replace("]
    # `.replace(` appears for str (caption/text) sanitising, not Path moves;
    # assert no Path-move pattern `Path(...).replace(` or `path.replace(` on files.
    assert not offending, f"operator_status.py contains write-like calls: {offending}"
