"""D4-4b: final send approval tests (RED, FAKE provider only).

Hermetic — the send seam is a FAKE provider (action_dispatch._send_fn); NO real
email, NO SMTP/Gmail/API, NO network. Verifies the "최종 발송 승인" phrase routing,
the AGENT_SEND_ENABLED + authorize_send two-key gate (planner / "진행해" / "라이브
수집 승인" can NEVER send; send_not_authorized PRESERVES the pending), artifact-hash
re-verify against the staged send_preview.json, send_log.md idempotency,
fake-provider outcome mapping, single-use, and the approval_log send_final stage.
"""

from __future__ import annotations

import json
import time

import pytest

import action_dispatch as ad
import agent_discord_adapter as ada
import agent_dispatch as disp
import approval_log as alog

TASK = "task_send_b"
OP = "op_send_b"


@pytest.fixture(autouse=True)
def _clear():
    ad.reset_pending_actions()
    disp.reset_pending_runs()
    yield
    ad.reset_pending_actions()
    disp.reset_pending_runs()


class _Ctx:
    def __init__(self, tmp_path):
        self.root = tmp_path
        self.packets = tmp_path / "outputs" / "outreach"
        self.packet_dir = self.packets / TASK
        self.packet_dir.mkdir(parents=True)
        (self.packet_dir / "analysis_report.json").write_text(
            '{"goods_no": "A000000107679"}', encoding="utf-8")
        (self.packet_dir / "seller_business_report_v3.pdf").write_text(
            "%PDF-stub\n", encoding="utf-8")
        (self.packet_dir / "recipient.json").write_text(
            '{"email": "test@example.com", "name": "Test"}', encoding="utf-8")
        (self.packet_dir / "status.json").write_text('{"s":1}', encoding="utf-8")
        self.staging = tmp_path / "outputs" / "agent_send" / TASK
        self.approvals = tmp_path / "approvals.jsonl"

    def arm(self):
        return ad.propose_send_preview(
            OP, task_id=TASK, packets_root=self.packets,
            staging_root=self.staging, approval_log_path=self.approvals)

    def phrase(self, text):
        return ada.try_handle(text, operator_discord_id=OP, repo_root=self.root,
                              approval_log_path=self.approvals)

    def status_unchanged(self):
        return (self.packet_dir / "status.json").read_text(encoding="utf-8") == '{"s":1}'


@pytest.fixture
def ctx(tmp_path):
    return _Ctx(tmp_path)


# === phrase routing ==========================================================
def test_phrase_final_send_sends_when_env_on(ctx, monkeypatch):
    monkeypatch.setenv("AGENT_SEND_ENABLED", "1")
    ctx.arm()
    out = ctx.phrase("최종 발송 승인")
    assert out is not None and out["intent"] == "send_done" and out["executed"] is True
    assert out["message_id"].startswith("fake-")
    assert (ctx.packet_dir / "send_log.md").is_file()
    assert ad.get_pending_action(OP) is None  # single-use
    assert ctx.status_unchanged()


def test_phrase_no_pending_send_no_pending(ctx, monkeypatch):
    monkeypatch.setenv("AGENT_SEND_ENABLED", "1")
    out = ctx.phrase("최종 발송 승인")
    assert out is not None and out["intent"] == "send_no_pending"
    assert not (ctx.packet_dir / "send_log.md").exists()


def test_phrase_wrong_kind_pending_send_no_pending(ctx, monkeypatch):
    monkeypatch.setenv("AGENT_SEND_ENABLED", "1")
    # arm a non-send pending (render) directly
    ad._PENDING_ACTIONS[ad._op_key(OP)] = {"kind": "render", "created_at": time.time()}
    out = ctx.phrase("최종 발송 승인")
    assert out["intent"] == "send_no_pending"


def test_run_confirm_phrase_does_not_send(ctx, monkeypatch):
    monkeypatch.setenv("AGENT_SEND_ENABLED", "1")
    ctx.arm()
    out = ctx.phrase("진행해")  # generic confirm: no agent run -> falls through
    assert out is None  # adapter does not claim it
    assert ad.get_pending_action(OP) is not None  # send pending preserved
    assert not (ctx.packet_dir / "send_log.md").exists()


def test_live_collect_phrase_does_not_send(ctx, monkeypatch):
    monkeypatch.setenv("AGENT_SEND_ENABLED", "1")
    ctx.arm()
    out = ctx.phrase("라이브 수집 승인")  # collect phrase, send pending -> no send
    assert out is not None and out["intent"] != "send_done"
    assert ad.get_pending_action(OP) is not None  # send pending preserved
    assert not (ctx.packet_dir / "send_log.md").exists()


# === env / gate ==============================================================
def test_env_off_phrase_not_authorized_preserves_pending(ctx, monkeypatch):
    monkeypatch.delenv("AGENT_SEND_ENABLED", raising=False)
    ctx.arm()
    out = ctx.phrase("최종 발송 승인")
    assert out["intent"] == "action_blocked"
    assert out.get("failed_check") == "send_not_authorized"
    assert ad.get_pending_action(OP) is not None  # preserved
    assert not (ctx.packet_dir / "send_log.md").exists()


def test_env_on_planner_confirm_not_authorized_preserves_pending(ctx, monkeypatch):
    monkeypatch.setenv("AGENT_SEND_ENABLED", "1")
    ctx.arm()
    # planner path: authorize_send defaults False
    out = ad.confirm_send_final(OP, approval_log_path=ctx.approvals)
    assert out.get("failed_check") == "send_not_authorized"
    assert ad.get_pending_action(OP) is not None


# === artifact-hash re-verify against staged send_preview.json ================
def test_tampered_staged_preview_mismatch(ctx, monkeypatch):
    monkeypatch.setenv("AGENT_SEND_ENABLED", "1")
    ctx.arm()
    (ctx.staging / "send_preview.json").write_text(
        '{"subject":"x","body":"y","recipient_email":"z@z.co",'
        '"attachments":[],"content_hash":"sha256:dead"}', encoding="utf-8")
    out = ad.confirm_send_final(OP, authorize_send=True, approval_log_path=ctx.approvals)
    assert out.get("failed_check") == "artifact_hash_mismatch"
    assert ad.get_pending_action(OP) is None  # cleared
    assert not (ctx.packet_dir / "send_log.md").exists()


def test_deleted_staged_preview_mismatch(ctx, monkeypatch):
    monkeypatch.setenv("AGENT_SEND_ENABLED", "1")
    ctx.arm()
    (ctx.staging / "send_preview.json").unlink()
    out = ad.confirm_send_final(OP, authorize_send=True, approval_log_path=ctx.approvals)
    assert out.get("failed_check") == "artifact_hash_mismatch"
    assert ad.get_pending_action(OP) is None


# === idempotency =============================================================
def test_send_log_appended_with_result_sent_and_hash(ctx, monkeypatch):
    monkeypatch.setenv("AGENT_SEND_ENABLED", "1")
    ctx.arm()
    pend_hash = ad.get_pending_action(OP)["artifact_hash"]
    ad.confirm_send_final(OP, authorize_send=True, approval_log_path=ctx.approvals)
    log = (ctx.packet_dir / "send_log.md").read_text(encoding="utf-8")
    assert "result=sent" in log and pend_hash in log


def test_second_identical_send_already_sent_at_propose(ctx, monkeypatch):
    monkeypatch.setenv("AGENT_SEND_ENABLED", "1")
    ctx.arm()
    ad.confirm_send_final(OP, authorize_send=True, approval_log_path=ctx.approvals)
    # re-propose the SAME content -> already_sent at propose time
    out = ctx.arm()
    assert out.get("failed_check") == "already_sent"
    assert ad.get_pending_action(OP) is None


def test_already_sent_at_confirm_clears_pending(ctx, monkeypatch):
    monkeypatch.setenv("AGENT_SEND_ENABLED", "1")
    ctx.arm()
    ch = ad.get_pending_action(OP)["artifact_hash"]
    # simulate a prior success ledger line for the same content, pending still armed
    (ctx.packet_dir / "send_log.md").write_text(
        f"- ts | result=sent | content_hash={ch} | to=x\n", encoding="utf-8")
    out = ad.confirm_send_final(OP, authorize_send=True, approval_log_path=ctx.approvals)
    assert out.get("failed_check") == "already_sent"
    assert ad.get_pending_action(OP) is None


def test_failed_attempt_does_not_create_already_sent(ctx, monkeypatch):
    monkeypatch.setenv("AGENT_SEND_ENABLED", "1")
    monkeypatch.setattr(ad, "_send_fn",
                        lambda p: (_ for _ in ()).throw(ad.ProviderUnavailable("down")))
    ctx.arm()
    out = ad.confirm_send_final(OP, authorize_send=True, approval_log_path=ctx.approvals)
    assert out.get("failed_check") == "provider_unavailable"
    assert not (ctx.packet_dir / "send_log.md").exists()  # no ledger -> retryable
    # a fresh propose is NOT blocked by already_sent
    out2 = ctx.arm()
    assert out2["intent"] == "action_propose"


# === fake-provider outcome mapping ===========================================
def test_provider_rejected_no_ledger(ctx, monkeypatch):
    monkeypatch.setenv("AGENT_SEND_ENABLED", "1")
    monkeypatch.setattr(ad, "_send_fn",
                        lambda p: {"result": "rejected", "detail": "bad address"})
    ctx.arm()
    out = ad.confirm_send_final(OP, authorize_send=True, approval_log_path=ctx.approvals)
    assert out.get("failed_check") == "send_rejected" and out["executed"] is False
    assert not (ctx.packet_dir / "send_log.md").exists()
    assert ad.get_pending_action(OP) is None  # single-use


def test_provider_generic_exception_send_failed(ctx, monkeypatch):
    monkeypatch.setenv("AGENT_SEND_ENABLED", "1")
    monkeypatch.setattr(ad, "_send_fn",
                        lambda p: (_ for _ in ()).throw(RuntimeError("boom")))
    ctx.arm()
    out = ad.confirm_send_final(OP, authorize_send=True, approval_log_path=ctx.approvals)
    assert out.get("failed_check") == "send_failed" and out["executed"] is False
    assert not (ctx.packet_dir / "send_log.md").exists()


def test_provider_sent_appends_ledger(ctx, monkeypatch):
    monkeypatch.setenv("AGENT_SEND_ENABLED", "1")
    monkeypatch.setattr(ad, "_send_fn",
                        lambda p: {"result": "sent", "provider": "fake", "message_id": "fake-zzz"})
    ctx.arm()
    out = ad.confirm_send_final(OP, authorize_send=True, approval_log_path=ctx.approvals)
    assert out["intent"] == "send_done" and out["executed"] is True
    assert (ctx.packet_dir / "send_log.md").is_file()


# === single-use ==============================================================
def test_single_use_second_phrase_no_pending(ctx, monkeypatch):
    monkeypatch.setenv("AGENT_SEND_ENABLED", "1")
    ctx.arm()
    ctx.phrase("최종 발송 승인")            # consumes pending
    out = ctx.phrase("최종 발송 승인")       # nothing left
    assert out["intent"] == "send_no_pending"


# === approval_log ============================================================
def test_approval_log_send_final_record_before_send(ctx, monkeypatch):
    monkeypatch.setenv("AGENT_SEND_ENABLED", "1")
    ctx.arm()
    ad.confirm_send_final(OP, authorize_send=True, approval_log_path=ctx.approvals)
    records = [json.loads(line) for line in
               ctx.approvals.read_text(encoding="utf-8").splitlines() if line.strip()]
    finals = [r for r in records if r.get("approved_stage") == "send_final"]
    assert finals and finals[-1]["execution_mode"] == "local_run"
    assert finals[-1]["current_state"] == "send_outreach"


def test_gated_stages_contains_send_final():
    assert "send_final" in alog.GATED_STAGES


# === no status mutation on success ===========================================
def test_no_status_mutation_on_send(ctx, monkeypatch):
    monkeypatch.setenv("AGENT_SEND_ENABLED", "1")
    ctx.arm()
    ad.confirm_send_final(OP, authorize_send=True, approval_log_path=ctx.approvals)
    assert ctx.status_unchanged()  # send_log.md is the ONLY packet mutation
