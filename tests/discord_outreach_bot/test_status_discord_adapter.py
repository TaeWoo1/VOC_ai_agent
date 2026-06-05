"""D5-2a tests for the pure status Discord adapter.

The adapter is string->string: it matches anchored full-message phrases and
delegates to the D5-1 read-only indexer. These tests use a constructed repo
under tmp_path and never read the real outputs/ tree.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

import operator_status
import status_discord_adapter as adapter
from status_discord_adapter import try_handle_status_message

_UNAVAILABLE = "⚠️ operator status unavailable (indexer error). No state was changed."


def _make_repo(tmp_path: Path) -> Path:
    (tmp_path / "CLAUDE.md").write_text("# test repo\n", encoding="utf-8")
    (tmp_path / "outputs").mkdir()
    return tmp_path


def _send_preview(repo: Path, workspace: str, packet_id: str) -> None:
    staging = repo / "outputs" / workspace / "staging" / packet_id
    staging.mkdir(parents=True, exist_ok=True)
    body = {
        "kind": "send_preview",
        "mode": "draft",
        "task_id": packet_id,
        "recipient_email": "test@example.com",
        "subject": f"[VOC] {packet_id}",
        "attachments": [],
        "content_hash": "sha256:" + "0" * 64,
    }
    (staging / "send_preview.json").write_text(json.dumps(body), encoding="utf-8")


# --------------------------------------------------------------------------- #
# Match -> card
# --------------------------------------------------------------------------- #


@pytest.mark.parametrize(
    "phrase",
    [
        "상태 알려줘",
        "상태",
        "오늘 작업 보여줘",
        "operator status",
        "status",
    ],
)
def test_status_phrase_returns_card(tmp_path, phrase):
    repo = _make_repo(tmp_path)
    out = try_handle_status_message(phrase, repo_root=repo)
    assert out is not None
    assert "Operator status" in out
    assert out != _UNAVAILABLE


@pytest.mark.parametrize("phrase", ["OPERATOR STATUS", "Status", "OpErAtOr   Status"])
def test_english_case_insensitive(tmp_path, phrase):
    repo = _make_repo(tmp_path)
    out = try_handle_status_message(phrase, repo_root=repo)
    assert out is not None
    assert "Operator status" in out


# --------------------------------------------------------------------------- #
# No match -> None
# --------------------------------------------------------------------------- #


@pytest.mark.parametrize(
    "phrase",
    [
        "리뷰 수집해줘",
        "왜 승인?",
        "상태가 어때?",
        "에이전트 상태",
        "진행해",
        "최종 발송 승인",
        "send me the status report please",
        "",
    ],
)
def test_unrelated_or_broad_text_returns_none(tmp_path, phrase):
    repo = _make_repo(tmp_path)
    assert try_handle_status_message(phrase, repo_root=repo) is None


def test_non_string_returns_none(tmp_path):
    repo = _make_repo(tmp_path)
    assert try_handle_status_message(None, repo_root=repo) is None  # type: ignore[arg-type]


# --------------------------------------------------------------------------- #
# include_smoke modifier
# --------------------------------------------------------------------------- #


@pytest.mark.parametrize(
    "phrase",
    ["상태 알려줘 smoke 포함", "status smoke", "status include_smoke", "status include smoke"],
)
def test_smoke_suffix_sets_include_smoke_true(tmp_path, phrase, monkeypatch):
    repo = _make_repo(tmp_path)
    captured = {}

    real_build = operator_status.build_operator_status

    def _spy(*args, **kwargs):
        captured["include_smoke"] = kwargs.get("include_smoke")
        return real_build(*args, **kwargs)

    monkeypatch.setattr(operator_status, "build_operator_status", _spy)
    out = try_handle_status_message(phrase, repo_root=repo)
    assert out is not None
    assert captured["include_smoke"] is True


def test_plain_phrase_keeps_include_smoke_false(tmp_path, monkeypatch):
    repo = _make_repo(tmp_path)
    captured = {}

    real_build = operator_status.build_operator_status

    def _spy(*args, **kwargs):
        captured["include_smoke"] = kwargs.get("include_smoke")
        return real_build(*args, **kwargs)

    monkeypatch.setattr(operator_status, "build_operator_status", _spy)
    try_handle_status_message("상태 알려줘", repo_root=repo)
    assert captured["include_smoke"] is False


def test_smoke_phrase_actually_surfaces_smoke_records(tmp_path):
    """End-to-end: smoke workspace hidden by default, shown with the modifier."""
    repo = _make_repo(tmp_path)
    _send_preview(repo, "agent_send_final_smoke", "packet_smoke_001")

    plain = try_handle_status_message("상태", repo_root=repo)
    with_smoke = try_handle_status_message("상태 smoke 포함", repo_root=repo)

    assert "packet_smoke_001" not in plain
    assert "packet_smoke_001" in with_smoke


# --------------------------------------------------------------------------- #
# Error handling + determinism
# --------------------------------------------------------------------------- #


def test_build_exception_returns_safe_string(tmp_path, monkeypatch):
    repo = _make_repo(tmp_path)

    def _boom(*args, **kwargs):
        raise RuntimeError("disk gone")

    monkeypatch.setattr(operator_status, "build_operator_status", _boom)
    out = try_handle_status_message("status", repo_root=repo)
    assert out == _UNAVAILABLE


def test_same_input_twice_is_identical(tmp_path):
    repo = _make_repo(tmp_path)
    a = try_handle_status_message("operator status", repo_root=repo)
    b = try_handle_status_message("operator status", repo_root=repo)
    assert a == b


# --------------------------------------------------------------------------- #
# Static safety guard
# --------------------------------------------------------------------------- #


def test_no_forbidden_imports_or_writes():
    src = Path(adapter.__file__).read_text(encoding="utf-8")
    forbidden_imports = (
        "import discord",
        "from discord",
        "action_dispatch",
        "smtplib",
        "googleapiclient",
        "import requests",
        "import httpx",
        "urllib.request",
        "import socket",
        "instagram",
    )
    hits = [tok for tok in forbidden_imports if tok in src]
    assert not hits, f"forbidden import/reference in adapter: {hits}"

    write_calls = (
        "write_text(",
        "write_bytes(",
        ".mkdir(",
        ".unlink(",
        ".rename(",
        "os.remove",
        "shutil.",
    )
    whits = [tok for tok in write_calls if tok in src]
    assert not whits, f"write-like call in adapter: {whits}"
