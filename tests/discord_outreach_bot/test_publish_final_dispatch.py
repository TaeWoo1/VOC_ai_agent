"""D4-4d: final publish approval tests (RED, FAKE provider only).

Hermetic — the publish seam is a FAKE provider (action_dispatch._publish_fn); NO
real publish, NO Instagram/API/browser/account/network/upload. Verifies the
"최종 게시 승인" phrase routing, the AGENT_PUBLISH_ENABLED + authorize_publish two-key
gate (planner / "진행해" / "최종 발송 승인" / "라이브 수집 승인" can NEVER publish;
publish_not_authorized PRESERVES the pending), artifact-hash re-verify against the
staged publish_preview.json, rights/safety re-assert, publish_log.md idempotency,
fake-provider outcome mapping, single-use, and the approval_log publish_final stage.
"""

from __future__ import annotations

import json
import time

import pytest

import action_dispatch as ad
import agent_discord_adapter as ada
import agent_dispatch as disp
import approval_log as alog

PKG = "ig_pkg_b"
OP = "op_pub_b"
CAPTION = "신상 클렌징 오일 카드뉴스 후기 정리. 프로필 링크에서 확인해주세요."


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
        self.packages = tmp_path / "outputs" / "instagram_packages"
        self.pkg_dir = self.packages / PKG
        self.pkg_dir.mkdir(parents=True)
        self.staging = tmp_path / "outputs" / "agent_publish" / PKG
        self.approvals = tmp_path / "approvals.jsonl"
        (self.pkg_dir / "caption.md").write_text(CAPTION, encoding="utf-8")
        (self.pkg_dir / "asset_manifest.json").write_text(json.dumps([
            {"file": "s1.png", "strategy": "rights_cleared_source_image"}]),
            encoding="utf-8")
        (self.pkg_dir / "s1.png").write_text("P", encoding="utf-8")
        (self.pkg_dir / "rights_review.json").write_text(json.dumps({
            "status": "cleared",
            "assets": {"s1.png": "rights_cleared_source_image"}}), encoding="utf-8")
        (self.pkg_dir / "safety_check.json").write_text(json.dumps({
            "status": "pass", "caption_hash": ad._caption_hash(CAPTION)}),
            encoding="utf-8")

    def arm(self):
        return ad.propose_publish_preview(
            OP, target=PKG, packages_root=self.packages,
            staging_root=self.staging, approval_log_path=self.approvals)

    def phrase(self, text):
        return ada.try_handle(text, operator_discord_id=OP, repo_root=self.root,
                              approval_log_path=self.approvals)


@pytest.fixture
def ctx(tmp_path):
    return _Ctx(tmp_path)


# === phrase routing ==========================================================
def test_phrase_final_publish_publishes_when_env_on(ctx, monkeypatch):
    monkeypatch.setenv("AGENT_PUBLISH_ENABLED", "1")
    ctx.arm()
    out = ctx.phrase("최종 게시 승인")
    assert out is not None and out["intent"] == "publish_done" and out["executed"] is True
    assert out["post_id"].startswith("fake-")
    assert (ctx.pkg_dir / "publish_log.md").is_file()
    assert ad.get_pending_action(OP) is None
    assert not (ctx.pkg_dir / "status.json").exists()


def test_phrase_no_pending(ctx, monkeypatch):
    monkeypatch.setenv("AGENT_PUBLISH_ENABLED", "1")
    out = ctx.phrase("최종 게시 승인")
    assert out["intent"] == "publish_no_pending"


def test_phrase_wrong_kind_pending(ctx, monkeypatch):
    monkeypatch.setenv("AGENT_PUBLISH_ENABLED", "1")
    ad._PENDING_ACTIONS[ad._op_key(OP)] = {"kind": "send", "created_at": time.time()}
    assert ctx.phrase("최종 게시 승인")["intent"] == "publish_no_pending"


def test_run_confirm_does_not_publish(ctx, monkeypatch):
    monkeypatch.setenv("AGENT_PUBLISH_ENABLED", "1")
    ctx.arm()
    out = ctx.phrase("진행해")  # generic confirm: no agent run -> falls through
    assert out is None
    assert ad.get_pending_action(OP) is not None
    assert not (ctx.pkg_dir / "publish_log.md").exists()


def test_send_phrase_does_not_publish(ctx, monkeypatch):
    monkeypatch.setenv("AGENT_PUBLISH_ENABLED", "1")
    monkeypatch.setenv("AGENT_SEND_ENABLED", "1")
    ctx.arm()
    out = ctx.phrase("최종 발송 승인")  # send branch, publish pending -> no publish
    assert out is not None and out["intent"] != "publish_done"
    assert ad.get_pending_action(OP) is not None
    assert not (ctx.pkg_dir / "publish_log.md").exists()


def test_live_collect_phrase_does_not_publish(ctx, monkeypatch):
    monkeypatch.setenv("AGENT_PUBLISH_ENABLED", "1")
    ctx.arm()
    out = ctx.phrase("라이브 수집 승인")
    assert out is not None and out["intent"] != "publish_done"
    assert ad.get_pending_action(OP) is not None
    assert not (ctx.pkg_dir / "publish_log.md").exists()


# === env / gate ==============================================================
def test_env_off_phrase_not_authorized_preserves_pending(ctx, monkeypatch):
    monkeypatch.delenv("AGENT_PUBLISH_ENABLED", raising=False)
    ctx.arm()
    out = ctx.phrase("최종 게시 승인")
    assert out["intent"] == "action_blocked"
    assert out.get("failed_check") == "publish_not_authorized"
    assert ad.get_pending_action(OP) is not None
    assert not (ctx.pkg_dir / "publish_log.md").exists()


def test_env_on_planner_confirm_not_authorized_preserves_pending(ctx, monkeypatch):
    monkeypatch.setenv("AGENT_PUBLISH_ENABLED", "1")
    ctx.arm()
    out = ad.confirm_publish_final(OP, approval_log_path=ctx.approvals)
    assert out.get("failed_check") == "publish_not_authorized"
    assert ad.get_pending_action(OP) is not None


# === artifact-hash re-verify =================================================
def test_tampered_staged_preview_mismatch(ctx, monkeypatch):
    monkeypatch.setenv("AGENT_PUBLISH_ENABLED", "1")
    ctx.arm()
    (ctx.staging / "publish_preview.json").write_text(
        '{"package_id":"x","caption":"y","assets":[],"content_hash":"sha256:dead"}',
        encoding="utf-8")
    out = ad.confirm_publish_final(OP, authorize_publish=True, approval_log_path=ctx.approvals)
    assert out.get("failed_check") == "artifact_hash_mismatch"
    assert ad.get_pending_action(OP) is None
    assert not (ctx.pkg_dir / "publish_log.md").exists()


def test_deleted_staged_preview_mismatch(ctx, monkeypatch):
    monkeypatch.setenv("AGENT_PUBLISH_ENABLED", "1")
    ctx.arm()
    (ctx.staging / "publish_preview.json").unlink()
    out = ad.confirm_publish_final(OP, authorize_publish=True, approval_log_path=ctx.approvals)
    assert out.get("failed_check") == "artifact_hash_mismatch"
    assert ad.get_pending_action(OP) is None


# === rights/safety re-assert from staged preview =============================
def _retamper_preview(ctx, mutate):
    """Arm, then rewrite the staged preview so its content_hash still matches but
    a re-asserted field is flipped (simulates a hash-consistent but unsafe view)."""
    ctx.arm()
    pv = json.loads((ctx.staging / "publish_preview.json").read_text(encoding="utf-8"))
    mutate(pv)
    pv["content_hash"] = ad._publish_artifact_hash(pv)  # keep hash consistent
    (ctx.staging / "publish_preview.json").write_text(
        json.dumps(pv, ensure_ascii=False), encoding="utf-8")
    # re-point the pending artifact_hash to the new (consistent) hash
    ad._PENDING_ACTIONS[ad._op_key(OP)]["artifact_hash"] = pv["content_hash"]


def test_rights_not_cleared_reassert(ctx, monkeypatch):
    monkeypatch.setenv("AGENT_PUBLISH_ENABLED", "1")
    _retamper_preview(ctx, lambda pv: pv["rights_review"].update(all_assets_cleared=False))
    out = ad.confirm_publish_final(OP, authorize_publish=True, approval_log_path=ctx.approvals)
    assert out.get("failed_check") == "rights_review_not_cleared"
    assert ad.get_pending_action(OP) is None
    assert not (ctx.pkg_dir / "publish_log.md").exists()


def test_safety_not_pass_reassert(ctx, monkeypatch):
    monkeypatch.setenv("AGENT_PUBLISH_ENABLED", "1")
    _retamper_preview(ctx, lambda pv: pv["safety_check"].update(status="fail"))
    out = ad.confirm_publish_final(OP, authorize_publish=True, approval_log_path=ctx.approvals)
    assert out.get("failed_check") == "prohibited_claims_detected"
    assert ad.get_pending_action(OP) is None


# === idempotency =============================================================
def test_publish_log_appended_with_result_published_and_hash(ctx, monkeypatch):
    monkeypatch.setenv("AGENT_PUBLISH_ENABLED", "1")
    ctx.arm()
    ch = ad.get_pending_action(OP)["artifact_hash"]
    ad.confirm_publish_final(OP, authorize_publish=True, approval_log_path=ctx.approvals)
    log = (ctx.pkg_dir / "publish_log.md").read_text(encoding="utf-8")
    assert "result=published" in log and ch in log


def test_second_identical_publish_already_published(ctx, monkeypatch):
    monkeypatch.setenv("AGENT_PUBLISH_ENABLED", "1")
    ctx.arm()
    ad.confirm_publish_final(OP, authorize_publish=True, approval_log_path=ctx.approvals)
    ctx.arm()  # re-arm same content
    out = ad.confirm_publish_final(OP, authorize_publish=True, approval_log_path=ctx.approvals)
    assert out.get("failed_check") == "already_published"
    assert ad.get_pending_action(OP) is None


def test_failed_attempt_does_not_create_already_published(ctx, monkeypatch):
    monkeypatch.setenv("AGENT_PUBLISH_ENABLED", "1")
    monkeypatch.setattr(ad, "_publish_fn",
                        lambda p: (_ for _ in ()).throw(ad.ProviderUnavailable("down")))
    ctx.arm()
    out = ad.confirm_publish_final(OP, authorize_publish=True, approval_log_path=ctx.approvals)
    assert out.get("failed_check") == "provider_unavailable"
    assert not (ctx.pkg_dir / "publish_log.md").exists()


# === fake-provider outcome mapping ===========================================
def test_provider_rejected_no_ledger(ctx, monkeypatch):
    monkeypatch.setenv("AGENT_PUBLISH_ENABLED", "1")
    monkeypatch.setattr(ad, "_publish_fn",
                        lambda p: {"result": "rejected", "detail": "policy"})
    ctx.arm()
    out = ad.confirm_publish_final(OP, authorize_publish=True, approval_log_path=ctx.approvals)
    assert out.get("failed_check") == "publish_rejected" and out["executed"] is False
    assert not (ctx.pkg_dir / "publish_log.md").exists()
    assert ad.get_pending_action(OP) is None


def test_provider_generic_exception_publish_failed(ctx, monkeypatch):
    monkeypatch.setenv("AGENT_PUBLISH_ENABLED", "1")
    monkeypatch.setattr(ad, "_publish_fn",
                        lambda p: (_ for _ in ()).throw(RuntimeError("boom")))
    ctx.arm()
    out = ad.confirm_publish_final(OP, authorize_publish=True, approval_log_path=ctx.approvals)
    assert out.get("failed_check") == "publish_failed" and out["executed"] is False
    assert not (ctx.pkg_dir / "publish_log.md").exists()


def test_provider_published_appends_ledger(ctx, monkeypatch):
    monkeypatch.setenv("AGENT_PUBLISH_ENABLED", "1")
    monkeypatch.setattr(ad, "_publish_fn",
                        lambda p: {"result": "published", "provider": "fake", "post_id": "fake-zzz"})
    ctx.arm()
    out = ad.confirm_publish_final(OP, authorize_publish=True, approval_log_path=ctx.approvals)
    assert out["intent"] == "publish_done" and out["executed"] is True
    assert (ctx.pkg_dir / "publish_log.md").is_file()


# === single-use ==============================================================
def test_single_use_second_phrase_no_pending(ctx, monkeypatch):
    monkeypatch.setenv("AGENT_PUBLISH_ENABLED", "1")
    ctx.arm()
    ctx.phrase("최종 게시 승인")
    out = ctx.phrase("최종 게시 승인")
    assert out["intent"] == "publish_no_pending"


# === approval_log ============================================================
def test_approval_log_publish_final_record_before_publish(ctx, monkeypatch):
    monkeypatch.setenv("AGENT_PUBLISH_ENABLED", "1")
    ctx.arm()
    ad.confirm_publish_final(OP, authorize_publish=True, approval_log_path=ctx.approvals)
    records = [json.loads(line) for line in
               ctx.approvals.read_text(encoding="utf-8").splitlines() if line.strip()]
    finals = [r for r in records if r.get("approved_stage") == "publish_final"]
    assert finals and finals[-1]["execution_mode"] == "local_run"
    assert finals[-1]["current_state"] == "publish_post"


def test_gated_stages_contains_publish_final():
    assert "publish_final" in alog.GATED_STAGES


# === no status mutation ======================================================
def test_no_status_mutation_on_publish(ctx, monkeypatch):
    monkeypatch.setenv("AGENT_PUBLISH_ENABLED", "1")
    ctx.arm()
    ad.confirm_publish_final(OP, authorize_publish=True, approval_log_path=ctx.approvals)
    assert not (ctx.pkg_dir / "status.json").exists()
