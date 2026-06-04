"""D4-4c: publish_post preview/draft tests (RED, preview-only).

Hermetic — there is NO publish capability in D4-4c: the `_publish_fn` seam always
raises PublishNotAuthorized and confirm_publish_final hard-blocks
publish_not_enabled. No Instagram/API/browser/network. Uses a CONSTRUCTED
instagram_package (caption + dummy assets + explicit rights_review.json +
passing safety_check.json). Verifies the precondition gate (rights + safety
explicit, never inferred), inert staging preview, NO publish_log / status.json /
package mutation, artifact-hash binding, and that the final tier hard-blocks.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

import action_dispatch as ad
import agent_dispatch as disp
import agent_intents as ai
import intent_dispatcher as idp

PKG = "ig_pkg_1"
OP = "op_pub"
CAPTION = "신상 클렌징 오일 카드뉴스 후기 정리. 자세한 내용은 프로필 링크 확인."


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
        self._write_valid()

    def _write_valid(self, caption=CAPTION):
        (self.pkg_dir / "caption.md").write_text(caption, encoding="utf-8")
        (self.pkg_dir / "asset_manifest.json").write_text(json.dumps([
            {"file": "slide1.png", "strategy": "rights_cleared_source_image"},
            {"file": "slide2.png", "strategy": "publish_candidate"},
        ]), encoding="utf-8")
        (self.pkg_dir / "slide1.png").write_text("PNG1", encoding="utf-8")
        (self.pkg_dir / "slide2.png").write_text("PNG2", encoding="utf-8")
        (self.pkg_dir / "rights_review.json").write_text(json.dumps({
            "status": "cleared", "reviewer": "op",
            "assets": {"slide1.png": "rights_cleared_source_image",
                       "slide2.png": "publish_candidate"}}), encoding="utf-8")
        (self.pkg_dir / "safety_check.json").write_text(json.dumps({
            "status": "pass", "validator_version": "v1",
            "caption_hash": ad._caption_hash(caption)}), encoding="utf-8")

    def propose(self, target=PKG):
        v = ai.validate({"intent": "publish_post", "targets": {"target": target}})
        return idp.dispatch_intent(
            v, operator_discord_id=OP, repo_root=self.root,
            publish_packages_root=self.packages, publish_staging_root=self.staging,
            approval_log_path=self.approvals)

    def confirm(self):
        v = ai.validate({"intent": "confirm_pending", "targets": {}})
        return idp.dispatch_intent(
            v, operator_discord_id=OP, repo_root=self.root,
            approval_log_path=self.approvals)


@pytest.fixture
def ctx(tmp_path):
    return _Ctx(tmp_path)


# === precondition gate (no preview/pending on fail) ==========================
def test_target_unresolved(ctx):
    out = ctx.propose(target="nope_pkg")
    assert out.get("failed_check") == "target_unresolved"
    assert ad.get_pending_action(OP) is None


def test_caption_missing(ctx):
    (ctx.pkg_dir / "caption.md").unlink()
    assert ctx.propose().get("failed_check") == "caption_missing"


def test_caption_txt_fallback(ctx):
    (ctx.pkg_dir / "caption.md").unlink()
    (ctx.pkg_dir / "caption.txt").write_text(CAPTION, encoding="utf-8")
    # safety_check caption_hash already matches CAPTION -> passes
    out = ctx.propose()
    assert out["intent"] == "action_propose" and ad.get_pending_action(OP) is not None


def test_assets_missing(ctx):
    (ctx.pkg_dir / "asset_manifest.json").unlink()
    assert ctx.propose().get("failed_check") == "assets_missing"


def test_asset_file_missing(ctx):
    (ctx.pkg_dir / "slide2.png").unlink()
    assert ctx.propose().get("failed_check") == "asset_file_missing"


def test_rights_review_missing(ctx):
    (ctx.pkg_dir / "rights_review.json").unlink()
    assert ctx.propose().get("failed_check") == "rights_review_missing"


def test_rights_review_not_cleared_workflow_demo(ctx):
    (ctx.pkg_dir / "rights_review.json").write_text(json.dumps({
        "status": "cleared", "assets": {
            "slide1.png": "rights_cleared_source_image",
            "slide2.png": "workflow_demo_only"}}), encoding="utf-8")
    assert ctx.propose().get("failed_check") == "rights_review_not_cleared"


def test_rights_review_not_cleared_missing_asset_entry(ctx):
    (ctx.pkg_dir / "rights_review.json").write_text(json.dumps({
        "status": "cleared", "assets": {
            "slide1.png": "rights_cleared_source_image"}}), encoding="utf-8")
    assert ctx.propose().get("failed_check") == "rights_review_not_cleared"


def test_safety_check_missing(ctx):
    (ctx.pkg_dir / "safety_check.json").unlink()
    assert ctx.propose().get("failed_check") == "safety_check_missing"


def test_safety_check_status_not_pass(ctx):
    (ctx.pkg_dir / "safety_check.json").write_text(json.dumps({
        "status": "fail", "caption_hash": ad._caption_hash(CAPTION)}),
        encoding="utf-8")
    assert ctx.propose().get("failed_check") == "prohibited_claims_detected"


def test_safety_check_stale(ctx):
    (ctx.pkg_dir / "safety_check.json").write_text(json.dumps({
        "status": "pass", "caption_hash": "sha256:wrong"}), encoding="utf-8")
    assert ctx.propose().get("failed_check") == "safety_check_stale"


def test_prohibited_claims_banned_framing(ctx):
    banned = "충격! 이거 안 보면 후회하는 클렌징 오일"
    ctx._write_valid(caption=banned)  # cert passes + hash matches, but re-check trips
    assert ctx.propose().get("failed_check") == "prohibited_claims_detected"


def test_output_path_denied(ctx):
    failed, _ = ad.check_publish_preconditions(
        package_id=PKG, package_dir=ctx.pkg_dir,
        staging_dir=ctx.pkg_dir / "sub")  # inside package -> denied
    assert failed == "output_path_denied"


def test_package_blocked(ctx):
    (ctx.pkg_dir / "publish.blocked").write_text("x", encoding="utf-8")
    assert ctx.propose().get("failed_check") == "package_blocked"


# === preview success: inert, staging-only, no mutation =======================
def test_preview_success_staging_only(ctx):
    before = {p.name: p.read_bytes() for p in ctx.pkg_dir.iterdir() if p.is_file()}
    out = ctx.propose()
    assert out["intent"] == "action_propose" and out["executed"] is False
    pend = ad.get_pending_action(OP)
    assert pend is not None and pend["kind"] == "publish"
    assert (ctx.staging / "publish_preview.json").is_file()
    assert (ctx.staging / "publish_preview.md").is_file()
    # NO publish_log, NO status.json, package files unchanged
    assert not (ctx.pkg_dir / "publish_log.md").exists()
    assert not (ctx.pkg_dir / "status.json").exists()
    after = {p.name: p.read_bytes() for p in ctx.pkg_dir.iterdir() if p.is_file()}
    assert before == after


def test_preview_content(ctx):
    ctx.propose()
    pv = json.loads((ctx.staging / "publish_preview.json").read_text(encoding="utf-8"))
    assert pv["kind"] == "publish_preview" and pv["mode"] == "draft"
    assert pv["caption"] == CAPTION
    assert [a["file"] for a in pv["assets"]] == ["slide1.png", "slide2.png"]
    assert pv["assets"][0]["rights"] == "rights_cleared_source_image"
    assert pv["rights_review"]["all_assets_cleared"] is True
    assert pv["safety_check"]["status"] == "pass"
    assert "content_hash" in pv


# === confirm hard-blocks (no publish capability in D4-4c) ====================
def test_confirm_no_pending_clarifies(ctx):
    out = ctx.confirm()
    assert out["executed"] is False and out["intent"] == "intent_confirm"


def test_confirm_publish_final_no_pending_direct(ctx):
    out = ad.confirm_publish_final(OP, approval_log_path=ctx.approvals)
    assert out["executed"] is False and out["intent"] == "action_confirm"


def test_confirm_publish_pending_hard_blocks(ctx):
    ctx.propose()
    out = ctx.confirm()
    assert out["intent"] == "action_blocked" and out["executed"] is False
    assert out.get("failed_check") == "publish_not_enabled"
    assert not (ctx.pkg_dir / "publish_log.md").exists()
    assert not (ctx.pkg_dir / "status.json").exists()


def test_authorize_publish_true_still_blocks(ctx, monkeypatch):
    monkeypatch.setenv("AGENT_PUBLISH_ENABLED", "1")
    ctx.propose()
    out = ad.confirm_publish_final(OP, authorize_publish=True,
                                   approval_log_path=ctx.approvals)
    assert out.get("failed_check") == "publish_not_enabled"
    assert not (ctx.pkg_dir / "publish_log.md").exists()


def test_publish_fn_seam_always_raises(ctx):
    with pytest.raises(ad.PublishNotAuthorized):
        ad._publish_fn({"package_id": PKG})


def test_artifact_hash_mismatch_clears_pending(ctx):
    ctx.propose()
    (ctx.staging / "publish_preview.json").write_text(
        '{"package_id":"x","caption":"y","assets":[],"content_hash":"sha256:dead"}',
        encoding="utf-8")
    out = ad.confirm_publish_final(OP, authorize_publish=True,
                                   approval_log_path=ctx.approvals)
    assert out.get("failed_check") == "artifact_hash_mismatch"
    assert ad.get_pending_action(OP) is None


# === routing ================================================================
def test_publish_report_only_without_packages_root(ctx):
    v = ai.validate({"intent": "publish_post", "targets": {"target": PKG}})
    res = idp.dispatch_intent(v, operator_discord_id=OP, repo_root=ctx.root)
    assert res["executed"] is False
    assert ad.get_pending_action(OP) is None


def test_planner_confirm_does_not_publish(ctx):
    ctx.propose()
    out = ctx.confirm()  # planner confirm_pending -> publish_not_enabled, never publishes
    assert out.get("failed_check") == "publish_not_enabled"


def test_publish_post_not_in_executable_allowlist():
    assert "publish_post" not in idp.D4_2_EXECUTABLE_INTENTS


def test_no_final_publish_phrase_wiring():
    src = (Path(__file__).resolve().parents[2] / "ops" / "discord_outreach_bot"
           / "agent_discord_adapter.py").read_text(encoding="utf-8")
    assert "최종 게시 승인" not in src


def test_gated_stages_contains_prepare_publish():
    import approval_log as alog
    assert "prepare_publish" in alog.GATED_STAGES
