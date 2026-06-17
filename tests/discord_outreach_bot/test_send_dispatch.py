"""D4-4a: send_outreach preview/draft tests (RED, preview-only).

Hermetic — there is NO send capability in D4-4a: the `_send_fn` seam always
raises SendNotAuthorized and confirm_send_final hard-blocks send_not_enabled.
Verifies the precondition gate (recipient resolved from packet/recipient.json
ONLY), inert staging preview, NO send_log / status.json / packet mutation,
artifact-hash binding, and that neither authorize_send nor the planner confirm
path can send.
"""

from __future__ import annotations

import pytest

import action_dispatch as ad
import agent_dispatch as disp
import agent_intents as ai
import intent_dispatcher as idp

TASK = "task_send_1"
OP = "op_send"


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
            '{"email": "ops@brand.co.kr", "name": "담당자"}', encoding="utf-8")
        # packet control files that must NEVER be mutated
        (self.packet_dir / "status.json").write_text('{"s":1}', encoding="utf-8")
        self.staging = tmp_path / "outputs" / "agent_send" / TASK
        self.approvals = tmp_path / "approvals.jsonl"

    def propose(self, task_id=TASK):
        v = ai.validate({"intent": "send_outreach", "targets": {"task_id": task_id}})
        return idp.dispatch_intent(
            v, operator_discord_id=OP, repo_root=self.root,
            packets_root=self.packets, send_staging_root=self.staging,
            approval_log_path=self.approvals)

    def confirm(self):
        v = ai.validate({"intent": "confirm_pending", "targets": {}})
        return idp.dispatch_intent(
            v, operator_discord_id=OP, repo_root=self.root,
            approval_log_path=self.approvals)


@pytest.fixture
def ctx(tmp_path):
    return _Ctx(tmp_path)


# === precondition gate (no preview on fail) ==================================
def test_missing_packet_target_unresolved(ctx):
    out = ctx.propose(task_id="task_nope")
    assert out["intent"] == "action_blocked" and out["executed"] is False
    assert out.get("failed_check") == "target_unresolved"
    assert ad.get_pending_action(OP) is None


def test_missing_analysis_report(ctx):
    (ctx.packet_dir / "analysis_report.json").unlink()
    out = ctx.propose()
    assert out.get("failed_check") == "analysis_report_missing"
    assert ad.get_pending_action(OP) is None


def test_missing_report_pdf(ctx):
    (ctx.packet_dir / "seller_business_report_v3.pdf").unlink()
    out = ctx.propose()
    assert out.get("failed_check") == "report_artifact_missing"


def test_missing_recipient(ctx):
    (ctx.packet_dir / "recipient.json").unlink()
    out = ctx.propose()
    assert out.get("failed_check") == "recipient_unresolved"


def test_invalid_recipient(ctx):
    (ctx.packet_dir / "recipient.json").write_text(
        '{"email": "not-an-email"}', encoding="utf-8")
    out = ctx.propose()
    assert out.get("failed_check") == "recipient_unresolved"


def test_send_blocked_marker(ctx):
    (ctx.packet_dir / "send.blocked").write_text("x", encoding="utf-8")
    out = ctx.propose()
    assert out.get("failed_check") == "packet_blocked"


def test_output_path_inside_packet_denied(ctx):
    failed, _ = ad.check_send_preconditions(
        task_id=TASK, packet_dir=ctx.packet_dir,
        staging_dir=ctx.packet_dir / "sub")  # inside packet -> denied
    assert failed == "output_path_denied"


# === recipient resolution policy: packet/recipient.json ONLY =================
def test_report_artifact_resolves_via_link(ctx):
    # no *.pdf in packet, but a linked existing file -> resolves (exists or linked)
    (ctx.packet_dir / "seller_business_report_v3.pdf").unlink()
    linked = ctx.root / "linked_report.pdf"
    linked.write_text("%PDF\n", encoding="utf-8")
    (ctx.packet_dir / "report_artifact.json").write_text(
        f'{{"pdf_path": "{linked}"}}', encoding="utf-8")
    failed, _ = ad.check_send_preconditions(
        task_id=TASK, packet_dir=ctx.packet_dir, staging_dir=ctx.staging)
    assert failed is None


# === preview success: inert, staging-only, no mutation =======================
def test_preview_arms_pending_writes_staging_only(ctx):
    out = ctx.propose()
    assert out["intent"] == "action_propose" and out["executed"] is False
    pend = ad.get_pending_action(OP)
    assert pend is not None and pend["kind"] == "send"
    assert (ctx.staging / "send_preview.json").is_file()
    assert (ctx.staging / "send_preview.txt").is_file()  # optional text view
    # NO send_log, NO status mutation, NO packet preview file
    assert not (ctx.packet_dir / "send_log.md").exists()
    assert (ctx.packet_dir / "status.json").read_text(encoding="utf-8") == '{"s":1}'
    assert not (ctx.packet_dir / "send_preview.json").exists()


def test_preview_recipient_and_subject(ctx):
    import json
    ctx.propose()
    preview = json.loads((ctx.staging / "send_preview.json").read_text(encoding="utf-8"))
    assert preview["recipient_email"] == "ops@brand.co.kr"
    assert preview["attachments"] == ["seller_business_report_v3.pdf"]
    assert "content_hash" in preview and preview["mode"] == "draft"


def test_no_packet_mutation_after_propose(ctx):
    before = {p.name: p.read_text(encoding="utf-8") for p in
              (ctx.packet_dir / "analysis_report.json",
               ctx.packet_dir / "recipient.json",
               ctx.packet_dir / "status.json")}
    ctx.propose()
    after = {p.name: p.read_text(encoding="utf-8") for p in
             (ctx.packet_dir / "analysis_report.json",
              ctx.packet_dir / "recipient.json",
              ctx.packet_dir / "status.json")}
    assert before == after


# === artifact-hash binding (re-verified against staged send_preview.json) ====
def test_artifact_hash_mismatch_blocks(ctx):
    ctx.propose()
    # tamper the STAGED preview bytes (the source of truth for the outgoing msg)
    (ctx.staging / "send_preview.json").write_text(
        '{"task_id":"x","recipient_email":"z@z.co","subject":"s","body":"b",'
        '"attachments":[],"content_hash":"sha256:deadbeef"}', encoding="utf-8")
    out = ctx.confirm()
    assert out["intent"] == "action_blocked" and out["executed"] is False
    assert out.get("failed_check") == "artifact_hash_mismatch"
    assert ad.get_pending_action(OP) is None  # cleared


# === confirm clarify / planner-never-sends (D4-4b) ===========================
def test_confirm_no_pending_clarifies(ctx):
    # no agent run, no action pending -> dispatcher's own confirm clarify
    out = ctx.confirm()
    assert out["executed"] is False
    assert out["intent"] == "intent_confirm"


def test_confirm_send_final_no_pending_direct(ctx):
    # calling the action fn directly with no pending -> action_confirm clarify
    out = ad.confirm_send_final(OP, approval_log_path=ctx.approvals)
    assert out["executed"] is False and out["intent"] == "action_confirm"


def test_planner_confirm_not_authorized_preserves_pending(ctx):
    # confirm_pending (planner NL) reaches confirm_send_final with
    # authorize_send=False -> send_not_authorized, never a send, pending PRESERVED.
    ctx.propose()
    out = ctx.confirm()
    assert out["intent"] == "action_blocked" and out["executed"] is False
    assert out.get("failed_check") == "send_not_authorized"
    assert ad.get_pending_action(OP) is not None  # preserved for the phrase
    assert not (ctx.packet_dir / "send_log.md").exists()
    assert (ctx.packet_dir / "status.json").read_text(encoding="utf-8") == '{"s":1}'


def test_authorize_send_true_env_off_not_authorized(ctx, monkeypatch):
    # authorize_send=True but env off -> send_not_authorized, pending preserved
    monkeypatch.delenv("AGENT_SEND_ENABLED", raising=False)
    ctx.propose()
    out = ad.confirm_send_final(OP, authorize_send=True,
                                approval_log_path=ctx.approvals)
    assert out.get("failed_check") == "send_not_authorized"
    assert ad.get_pending_action(OP) is not None
    assert not (ctx.packet_dir / "send_log.md").exists()


def test_fake_send_returns_sent(ctx):
    # the D4-4b default seam is a fake provider: returns result=sent, no network
    res = ad._send_fn({"content_hash": "sha256:abc123def456"})
    assert res["result"] == "sent" and res["provider"] == "fake"
    assert res["message_id"].startswith("fake-")


# === send_outreach report-only without packets_root =========================
def test_send_report_only_without_packets_root(ctx):
    v = ai.validate({"intent": "send_outreach", "targets": {"task_id": TASK}})
    res = idp.dispatch_intent(v, operator_discord_id=OP, repo_root=ctx.root)
    assert res["executed"] is False
    assert ad.get_pending_action(OP) is None


# === publish_post stays report-only =========================================
def test_publish_post_report_only(ctx):
    v = ai.validate({"intent": "publish_post", "targets": {"target": "ig1"}})
    res = idp.dispatch_intent(
        v, operator_discord_id=OP, repo_root=ctx.root,
        packets_root=ctx.packets, send_staging_root=ctx.staging)
    assert res["executed"] is False
    assert ad.get_pending_action(OP) is None


# === send_outreach not in the D4-2 executable allowlist ======================
def test_send_outreach_not_in_executable_allowlist():
    assert "send_outreach" not in idp.D4_2_EXECUTABLE_INTENTS
    assert "publish_post" not in idp.D4_2_EXECUTABLE_INTENTS
