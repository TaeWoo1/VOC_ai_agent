"""D4-3a: guarded render_report execution tests.

Hermetic — the renderer is MOCKED (action_dispatch._render_fn), so NO real PDF
is produced, no reporting deps loaded, no live render. Verifies the precondition
gate, propose/confirm handshake, staging-only output, no packet mutation, plan
hash binding, and confirm precedence (agent run-pending wins over action).
"""

from __future__ import annotations

import pytest

import action_dispatch as ad
import agent_dispatch as disp
import agent_intents as ai
import intent_dispatcher as idp

TASK = "task_render_1"
OP = "op1"


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
            '{"ok": true}', encoding="utf-8")
        # packet control files that must NEVER be mutated
        (self.packet_dir / "status.json").write_text('{"s":1}', encoding="utf-8")
        (self.packet_dir / "send_log.md").write_text("log\n", encoding="utf-8")
        self.staging = tmp_path / "outputs" / "agent_render" / TASK

    def render_intent(self, task_id=TASK):
        v = ai.validate({"intent": "render_report", "targets": {"task_id": task_id}})
        return idp.dispatch_intent(
            v, operator_discord_id=OP, repo_root=self.root,
            packets_root=self.packets, staging_root=self.staging)

    def confirm(self):
        v = ai.validate({"intent": "confirm_pending", "targets": {}})
        return idp.dispatch_intent(v, operator_discord_id=OP, repo_root=self.root)


@pytest.fixture
def ctx(tmp_path):
    return _Ctx(tmp_path)


@pytest.fixture
def mock_render(monkeypatch):
    """Replace the live renderer with a hermetic stub that writes to staging."""
    calls = {"n": 0}

    def fake(packet_dir, staging_dir):
        from pathlib import Path as _P
        calls["n"] += 1
        _P(staging_dir).mkdir(parents=True, exist_ok=True)
        out = _P(staging_dir) / "seller_business_report_v3.pdf"
        out.write_text("%PDF-mock\n", encoding="utf-8")
        return [str(out)]
    monkeypatch.setattr(ad, "_render_fn", fake)
    return calls


# === precondition gate (no render on fail) ===================================
def test_target_unresolved_blocks(ctx, mock_render):
    out = ctx.render_intent(task_id="task_nope")
    assert out["intent"] == "action_blocked" and out["executed"] is False
    assert "target_unresolved" in out["reply"]
    assert mock_render["n"] == 0 and ad.get_pending_action(OP) is None


def test_analysis_report_missing_blocks(ctx, mock_render):
    (ctx.packet_dir / "analysis_report.json").unlink()
    out = ctx.render_intent()
    assert "analysis_report_missing" in out["reply"]
    assert mock_render["n"] == 0


def test_packet_blocked_marker(ctx, mock_render):
    (ctx.packet_dir / "render.blocked").write_text("x", encoding="utf-8")
    out = ctx.render_intent()
    assert "packet_blocked" in out["reply"] and mock_render["n"] == 0


# === propose arms pending only (no render) ===================================
def test_propose_arms_pending_no_render(ctx, mock_render):
    out = ctx.render_intent()
    assert out["intent"] == "action_propose" and out["executed"] is False
    assert ad.get_pending_action(OP) is not None
    assert mock_render["n"] == 0
    assert not ctx.staging.exists()  # nothing rendered yet


# === confirm runs the (mock) renderer ========================================
def test_confirm_runs_render_to_staging(ctx, mock_render):
    ctx.render_intent()
    out = ctx.confirm()
    assert out["intent"] == "action_done" and out["executed"] is True
    assert mock_render["n"] == 1
    art = ctx.staging / "seller_business_report_v3.pdf"
    assert art.exists() and str(art) in out["reply"]
    assert ad.get_pending_action(OP) is None  # single-use


def test_confirm_no_pending_clarifies(ctx, mock_render):
    out = ctx.confirm()
    assert out["executed"] is False and mock_render["n"] == 0


def test_plan_hash_mismatch_blocks(ctx, mock_render):
    ctx.render_intent()
    # tamper the canonical input after propose
    (ctx.packet_dir / "analysis_report.json").write_text(
        '{"ok": false, "x": 1}', encoding="utf-8")
    out = ctx.confirm()
    assert out["intent"] == "action_blocked" and out["executed"] is False
    assert "plan_hash_mismatch" in out.get("failed_check", "")
    assert mock_render["n"] == 0


# === staging-only / no packet mutation =======================================
def test_no_packet_mutation(ctx, mock_render):
    before = {p.name: p.read_text(encoding="utf-8") for p in
              (ctx.packet_dir / "analysis_report.json",
               ctx.packet_dir / "status.json", ctx.packet_dir / "send_log.md")}
    ctx.render_intent()
    ctx.confirm()
    after = {p.name: p.read_text(encoding="utf-8") for p in
             (ctx.packet_dir / "analysis_report.json",
              ctx.packet_dir / "status.json", ctx.packet_dir / "send_log.md")}
    assert before == after  # canonical + control files untouched
    # artifact landed only under staging, not the packet dir
    assert not (ctx.packet_dir / "seller_business_report_v3.pdf").exists()


def test_output_path_denied_when_staging_in_packet(ctx, mock_render):
    failed, _ = ad.check_render_preconditions(
        task_id=TASK, packet_dir=ctx.packet_dir,
        staging_dir=ctx.packet_dir / "sub")  # inside packet -> denied
    assert failed == "output_path_denied"


# === live render gated (default off) =========================================
def test_live_render_not_authorized_blocks(ctx, monkeypatch):
    # use the DEFAULT _render_fn (not mocked) with the env flag unset
    monkeypatch.delenv("AGENT_RENDER_ENABLED", raising=False)
    monkeypatch.setattr(ad, "_renderer_importable", lambda: True)
    ctx.render_intent()
    out = ctx.confirm()
    assert out["intent"] == "action_blocked"
    assert out.get("failed_check") == "render_not_authorized"


# === confirm precedence: agent run-pending wins over action-pending ==========
def test_agent_run_pending_wins_over_action(ctx, mock_render, monkeypatch):
    # arm BOTH an action-pending (render) and an agent run-pending; confirm must
    # resolve the agent run first and NOT run the render.
    ctx.render_intent()
    assert ad.get_pending_action(OP) is not None
    sentinel = {"hit": False}

    def fake_confirm_agent(*a, **k):
        sentinel["hit"] = True
        return {"outcome": "dry_run", "report": "dry_run ok"}
    monkeypatch.setattr(disp, "_get_pending", lambda op: {"run_id": "run_x"})
    monkeypatch.setattr(disp, "confirm_agent_run", fake_confirm_agent)
    ctx.confirm()
    assert sentinel["hit"] is True              # agent run-pending handled first
    assert mock_render["n"] == 0                # render NOT executed
    assert ad.get_pending_action(OP) is not None  # action-pending untouched


# === collect/send/publish remain report-only =================================
@pytest.mark.parametrize("intent,targets", [
    ("collect_reviews", {"target": "A1"}),
    ("send_outreach", {"task_id": TASK}),
    ("publish_post", {"target": "ig1"}),
])
def test_other_intents_report_only(ctx, mock_render, intent, targets):
    v = ai.validate({"intent": intent, "targets": targets})
    out = idp.dispatch_intent(
        v, operator_discord_id=OP, repo_root=ctx.root,
        packets_root=ctx.packets, staging_root=ctx.staging)
    assert out["executed"] is False and mock_render["n"] == 0


def test_render_report_only_without_packets_root(ctx, mock_render):
    # no packets_root configured -> stays report-only (no execution)
    v = ai.validate({"intent": "render_report", "targets": {"task_id": TASK}})
    res = idp.dispatch_intent(v, operator_discord_id=OP, repo_root=ctx.root)
    assert res["executed"] is False and mock_render["n"] == 0


# === D4-3a-fix: live renderer wiring ========================================
def test_renderer_importable_checks_symbol(monkeypatch, tmp_path):
    # real repo: the standalone PDF script defines the symbol -> True
    assert ad._renderer_importable() is True
    # script defines no such symbol -> False (stricter than module-spec check)
    bad = tmp_path / "no_symbol.py"
    bad.write_text("def something_else():\n    pass\n", encoding="utf-8")
    monkeypatch.setattr(ad, "_renderer_script_path", lambda: bad)
    assert ad._renderer_importable() is False
    # script missing entirely -> False
    monkeypatch.setattr(ad, "_renderer_script_path", lambda: tmp_path / "nope.py")
    assert ad._renderer_importable() is False


def _spy_renderer(monkeypatch):
    """Replace the standalone-script loader with a spy that records HOW it was
    called and writes a stub artifact to out_path. No real PDF / reportlab."""
    rec = {}

    def fake_renderer(*args, **kwargs):
        rec["args"] = args
        rec["kwargs"] = kwargs
        out = kwargs["out_path"]
        out.write_text("%PDF-stub\n", encoding="utf-8")
        return out

    monkeypatch.setattr(ad, "_load_renderer", lambda: fake_renderer)
    monkeypatch.setattr(ad, "_render_authorized", lambda: True)
    return rec


def test_live_render_loads_report_and_calls_keyword_only(ctx, monkeypatch):
    (ctx.packet_dir / "collection_summary.json").write_text(
        '{"review_count_analyzed": 12}', encoding="utf-8")
    rec = _spy_renderer(monkeypatch)
    artifacts = ad._live_render(ctx.packet_dir, ctx.staging)
    # called keyword-only: NO positional args
    assert rec["args"] == ()
    kw = rec["kwargs"]
    assert kw["analysis_report"] == {"ok": True}          # parsed from file
    assert kw["collection_summary"] == {"review_count_analyzed": 12}
    assert kw["out_path"] == ctx.staging / "seller_business_report_v3.pdf"
    assert kw["run_id"] == ctx.packet_dir.name
    # artifact landed in staging only
    assert artifacts == [str(ctx.staging / "seller_business_report_v3.pdf")]
    assert (ctx.staging / "seller_business_report_v3.pdf").exists()


def test_live_render_missing_collection_summary_defaults_empty(ctx, monkeypatch):
    rec = _spy_renderer(monkeypatch)  # no collection_summary.json present
    ad._live_render(ctx.packet_dir, ctx.staging)
    assert rec["kwargs"]["collection_summary"] == {}      # safe default


def test_live_render_bad_collection_summary_action_failed(ctx, monkeypatch):
    (ctx.packet_dir / "collection_summary.json").write_text(
        "not json", encoding="utf-8")
    monkeypatch.setattr(ad, "_load_renderer",
                        lambda: (_ for _ in ()).throw(AssertionError("unreached")))
    monkeypatch.setattr(ad, "_render_authorized", lambda: True)
    # propose -> confirm: malformed summary raises in _live_render -> action_failed
    ctx.render_intent()
    out = ctx.confirm()
    assert out["intent"] == "action_failed" and out["executed"] is False
    # packet + control files untouched by the failed render
    assert (ctx.packet_dir / "status.json").read_text(encoding="utf-8") == '{"s":1}'
    assert not ctx.staging.exists()


def test_live_render_not_authorized_raises(ctx, monkeypatch):
    monkeypatch.delenv("AGENT_RENDER_ENABLED", raising=False)
    monkeypatch.setattr(ad, "_load_renderer",
                        lambda: (_ for _ in ()).throw(AssertionError("unreached")))
    with pytest.raises(ad.RenderNotAuthorized):
        ad._live_render(ctx.packet_dir, ctx.staging)
    assert not ctx.staging.exists()
