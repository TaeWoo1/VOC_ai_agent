"""D4-3b1: collect_reviews plan/dry-run guarded execution tests.

Hermetic — NO live collection. The live seam (action_dispatch._collect_fn) ALWAYS
raises in D4-3b1; evaluate_preconditions' CDP/pgrep/git I/O is stubbed; and no
subprocess, DB, queue write, or CDP tab open ever happens. The whole flow only
resolves a target, gates, writes a staging collect_plan.json, and hard-blocks on
confirm.
"""

from __future__ import annotations

import json
from datetime import datetime, timezone

import pytest

import action_dispatch as ad
import agent_dispatch as disp
import agent_intents as ai
import intent_dispatcher as idp
from src.voc.app import cdp_tab_probe

GOODS = "A000000179126"
SORT = "DATETIME_DESC"
OP = "op1"
NOW = datetime(2026, 6, 4, tzinfo=timezone.utc)


@pytest.fixture(autouse=True)
def _clear():
    ad.reset_pending_actions()
    disp.reset_pending_runs()
    yield
    ad.reset_pending_actions()
    disp.reset_pending_runs()


def _write_queue(path, *, goods=GOODS, sort=SORT, status="ready"):
    doc = {"_meta": {"schema_version": 1}, "items": [
        {"goods_no": goods, "product_name": "P", "sort_type": sort,
         "target_type": "primary", "status": status},
        {"goods_no": "A000000000001", "product_name": "Q", "sort_type": sort,
         "target_type": "primary", "status": "pending"},
    ]}
    path.write_text(json.dumps(doc, ensure_ascii=False), encoding="utf-8")
    return path


def _good_cdp(goods=GOODS):
    url = ("https://www.oliveyoung.co.kr/store/goods/getGoodsDetail.do"
           f"?goodsNo={goods}&tab=review")

    class _Cdp:
        def get_version(self):
            return {"Browser": "x"}

        def list_tabs(self):
            return [{"url": url, "title": "상품 페이지"}]
    return _Cdp()


class _Ctx:
    def __init__(self, tmp_path):
        self.root = tmp_path
        self.queue = tmp_path / "queue.json"
        _write_queue(self.queue)
        self.staging = tmp_path / "outputs" / "agent_collect_plan"
        (tmp_path / "data" / "collection_artifacts").mkdir(parents=True)

    def propose(self, target=GOODS, *, cdp=None, **kw):
        return ad.propose_collect(
            OP, target=target, queue_path=self.queue, staging_root=self.staging,
            repo_root=self.root, head_baseline=None, now=NOW,
            cdp_probe=cdp if cdp is not None else _good_cdp(),
            pgrep_runner=lambda _c: [], git_head_runner=lambda: "deadbee", **kw)

    def confirm(self, **kw):
        return ad.confirm_collect(OP, **kw)


@pytest.fixture
def ctx(tmp_path):
    return _Ctx(tmp_path)


# === target resolution =======================================================
def test_resolve_goods_no(ctx):
    out = ctx.propose(target=GOODS)
    assert out["intent"] == "action_propose"
    pend = ad.get_pending_action(OP)
    assert pend["goods_no"] == GOODS and pend["sort_type"] == SORT


def test_resolve_product_url(ctx):
    url = ("https://www.oliveyoung.co.kr/store/goods/getGoodsDetail.do"
           f"?goodsNo={GOODS}&tab=review")
    out = ctx.propose(target=url)
    assert out["intent"] == "action_propose"
    assert ad.get_pending_action(OP)["goods_no"] == GOODS


def test_resolve_next(ctx):
    # make GOODS the only runnable row so pick_next_runnable is deterministic
    doc = {"_meta": {"schema_version": 1}, "items": [
        {"goods_no": GOODS, "product_name": "P", "sort_type": SORT,
         "target_type": "primary", "status": "ready"},
        {"goods_no": "A000000000001", "product_name": "Q", "sort_type": SORT,
         "target_type": "primary", "status": "done"},
    ]}
    ctx.queue.write_text(json.dumps(doc, ensure_ascii=False), encoding="utf-8")
    out = ctx.propose(target="다음")
    assert out["intent"] == "action_propose"
    assert ad.get_pending_action(OP)["goods_no"] == GOODS


def test_task_id_only_unresolved(ctx):
    out = ctx.propose(target="task_render_1")
    assert out["intent"] == "action_blocked"
    assert out["failed_check"] == "target_unresolved"
    assert ad.get_pending_action(OP) is None


def test_empty_target_unresolved(ctx):
    out = ctx.propose(target="")
    assert out["failed_check"] == "target_unresolved"
    assert ad.get_pending_action(OP) is None


# === D4-3b-owned preconditions ===============================================
def test_goods_no_not_in_queue(ctx):
    out = ctx.propose(target="A000000999999", cdp=_good_cdp("A000000999999"))
    assert out["failed_check"] == "goods_no_not_in_queue"
    assert ad.get_pending_action(OP) is None


def test_candidate_not_approved(ctx):
    _write_queue(ctx.queue, status="manual_checkpoint")
    out = ctx.propose(target=GOODS)
    assert out["failed_check"] == "candidate_not_approved"
    assert ad.get_pending_action(OP) is None


def test_corpus_db_unwritable(ctx, monkeypatch):
    monkeypatch.setattr(ad, "_path_writable",
                        lambda p: "collection_artifacts" in str(p))
    out = ctx.propose(target=GOODS)
    assert out["failed_check"] == "corpus_db_unwritable"
    assert ad.get_pending_action(OP) is None


def test_artifact_root_unwritable(ctx, monkeypatch):
    monkeypatch.setattr(ad, "_path_writable",
                        lambda p: "collection_artifacts" not in str(p))
    out = ctx.propose(target=GOODS)
    assert out["failed_check"] == "artifact_root_unwritable"


# === delegated evaluate_preconditions (representative) =======================
def test_cdp_unreachable_blocks(ctx):
    class _Down:
        def get_version(self):
            raise cdp_tab_probe.CdpUnreachableError("down")
    out = ctx.propose(target=GOODS, cdp=_Down())
    assert out["failed_check"] == "cdp_unreachable"
    assert ad.get_pending_action(OP) is None


def test_target_tab_missing_blocks(ctx):
    class _NoTab:
        def get_version(self):
            return {}

        def list_tabs(self):
            return []  # no matching tab; allow_open_tab=False -> missing
    out = ctx.propose(target=GOODS, cdp=_NoTab())
    assert out["failed_check"] == "target_tab_missing"
    assert ad.get_pending_action(OP) is None


# === gate pass -> propose arms pending + writes staging plan =================
def test_gate_pass_arms_pending_and_writes_plan(ctx):
    out = ctx.propose(target=GOODS)
    assert out["intent"] == "action_propose" and out["executed"] is False
    pend = ad.get_pending_action(OP)
    assert pend is not None and pend["kind"] == "collect"
    plan = ctx.staging / "collect_plan.json"
    assert plan.is_file()
    doc = json.loads(plan.read_text(encoding="utf-8"))
    assert doc["goods_no"] == GOODS and doc["mode"] == "dry_run"
    assert doc["live_collect_enabled"] is False
    assert "--i-authorize-live-collection" in doc["would_run_argv"]


def test_propose_no_queue_db_or_tab_mutation(ctx):
    before = ctx.queue.read_bytes()
    opened = {"n": 0}

    class _Cdp:
        def get_version(self):
            return {}

        def list_tabs(self):
            url = ("https://www.oliveyoung.co.kr/store/goods/getGoodsDetail.do"
                   f"?goodsNo={GOODS}&tab=review")
            return [{"url": url, "title": "P"}]

        def open_tab(self, url):  # must NEVER be called
            opened["n"] += 1
            return {}
    ctx.propose(target=GOODS, cdp=_Cdp())
    assert ctx.queue.read_bytes() == before          # queue file unchanged
    assert opened["n"] == 0                           # no CDP tab opened
    # only the staging plan is written; no collection artifacts
    assert not (ctx.staging / "batch_summary.json").exists()
    assert not (ctx.staging / "collection_summary.json").exists()


# === confirm hard-blocks (D4-3b1: no live capability) ========================
def test_confirm_no_pending_clarifies(ctx):
    out = ctx.confirm()
    assert out["executed"] is False and out["intent"] == "action_confirm"


def test_confirm_not_authorized_when_flag_off(ctx, monkeypatch):
    monkeypatch.delenv("AGENT_COLLECT_LIVE_ENABLED", raising=False)
    ctx.propose(target=GOODS)
    out = ctx.confirm(authorize_live=True)   # per-turn yes, but infra flag off
    assert out["intent"] == "action_blocked"
    assert out["failed_check"] == "collect_not_authorized"


def test_confirm_requires_per_turn_auth(ctx, monkeypatch):
    monkeypatch.setenv("AGENT_COLLECT_LIVE_ENABLED", "1")
    ctx.propose(target=GOODS)
    out = ctx.confirm(authorize_live=False)  # infra on, per-turn missing
    assert out["failed_check"] == "collect_not_authorized"


def test_confirm_collect_live_not_enabled(ctx, monkeypatch):
    # both keys satisfied -> reaches the seam -> D4-3b1 has no live path
    monkeypatch.setenv("AGENT_COLLECT_LIVE_ENABLED", "1")
    ctx.propose(target=GOODS)
    out = ctx.confirm(authorize_live=True)
    assert out["intent"] == "action_blocked"
    assert out["failed_check"] == "collect_live_not_enabled"
    assert ad.get_pending_action(OP) is None  # single-use cleared


def test_seam_default_raises():
    # the live seam itself must refuse in D4-3b1
    with pytest.raises(ad.CollectNotAuthorized):
        ad._collect_fn(GOODS, SORT, True)


def test_plan_hash_mismatch_blocks(ctx):
    ctx.propose(target=GOODS)
    _write_queue(ctx.queue, status="pending")  # row advanced after propose
    out = ctx.confirm(authorize_live=True)
    assert out["intent"] == "action_blocked"
    assert out["failed_check"] == "plan_hash_mismatch"
    assert ad.get_pending_action(OP) is None


# === dispatcher wiring =======================================================
def test_collect_report_only_without_queue(ctx):
    v = ai.validate({"intent": "collect_reviews", "targets": {"target": GOODS}})
    out = idp.dispatch_intent(v, operator_discord_id=OP, repo_root=ctx.root)
    assert out["executed"] is False
    assert ad.get_pending_action(OP) is None  # no pending armed


def test_collect_via_dispatcher_proposes(ctx, monkeypatch):
    monkeypatch.setattr(ad, "check_collect_preconditions", lambda **k: (None, None))
    v = ai.validate({"intent": "collect_reviews", "targets": {"target": GOODS}})
    out = idp.dispatch_intent(
        v, operator_discord_id=OP, repo_root=ctx.root,
        collect_queue_path=ctx.queue, collect_staging_root=ctx.staging)
    assert out["intent"] == "action_propose"
    assert ad.get_pending_action(OP)["kind"] == "collect"


def test_dispatcher_confirm_routes_collect(ctx, monkeypatch):
    monkeypatch.setattr(ad, "check_collect_preconditions", lambda **k: (None, None))
    v = ai.validate({"intent": "collect_reviews", "targets": {"target": GOODS}})
    idp.dispatch_intent(
        v, operator_discord_id=OP, repo_root=ctx.root,
        collect_queue_path=ctx.queue, collect_staging_root=ctx.staging)
    cv = ai.validate({"intent": "confirm_pending", "targets": {}})
    out = idp.dispatch_intent(cv, operator_discord_id=OP, repo_root=ctx.root)
    # routed to confirm_collect; planner NL never sets authorize_live
    assert out.get("failed_check") == "collect_not_authorized"


@pytest.mark.parametrize("intent,targets", [
    ("send_outreach", {"task_id": "t1"}),
    ("publish_post", {"target": "ig1"}),
])
def test_send_publish_report_only(ctx, intent, targets):
    v = ai.validate({"intent": intent, "targets": targets})
    out = idp.dispatch_intent(
        v, operator_discord_id=OP, repo_root=ctx.root,
        collect_queue_path=ctx.queue)
    assert out["executed"] is False
    assert ad.get_pending_action(OP) is None
