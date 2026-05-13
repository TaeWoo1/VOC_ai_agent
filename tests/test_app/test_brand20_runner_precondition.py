"""Tests for `src.voc.app.brand20_runner_precondition` (phase A).

Every CDP call is patched; no test contacts 127.0.0.1:9222. Every
pgrep / git call is patched; no test forks `pgrep` or `git`.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from src.voc.app import cdp_tab_probe as real_cdp_probe
from src.voc.app.brand20_queue import (
    Brand20Queue,
    QueueItem,
    QueueMeta,
    make_full_sort_set,
)
from src.voc.app.brand20_runner_precondition import (
    PreconditionResult,
    evaluate_preconditions,
)


# ---------------------------------------------------------------------------
# Fixtures / helpers
# ---------------------------------------------------------------------------


def _now() -> datetime:
    return datetime(2026, 5, 13, 12, 0, 0, tzinfo=timezone.utc)


def _two_sku_queue() -> Brand20Queue:
    rows: list[QueueItem] = []
    rows.extend(make_full_sort_set(goods_no="A000000111111", product_name="Brand-A"))
    rows.extend(make_full_sort_set(goods_no="A000000222222", product_name="Brand-B"))
    return Brand20Queue(meta=QueueMeta(schema_version=1), items=rows)


class _FakeCdpProbe:
    """Mimics `cdp_tab_probe` enough for the gate. Each public method
    raises if not pre-configured."""

    # Real exception class re-exported so the gate can catch it
    # without monkey-patching the module attribute.
    CdpUnreachableError = real_cdp_probe.CdpUnreachableError

    def __init__(
        self,
        *,
        version: dict | None = None,
        version_raises: Exception | None = None,
        tabs: list[dict] | None = None,
        tabs_raises: Exception | None = None,
    ) -> None:
        self._version = version
        self._version_raises = version_raises
        self._tabs = tabs or []
        self._tabs_raises = tabs_raises
        self.open_tab_calls: list[Any] = []

    def get_version(self) -> dict:
        if self._version_raises is not None:
            raise self._version_raises
        return self._version or {"Browser": "Chrome/123"}

    def list_tabs(self) -> list[dict]:
        if self._tabs_raises is not None:
            raise self._tabs_raises
        return list(self._tabs)

    def open_tab(self, target_url: str) -> dict:
        # The gate must NEVER call this in phase A. The CLI tests
        # assert the same property at the script level.
        self.open_tab_calls.append(target_url)
        raise AssertionError("phase A must not call cdp_tab_probe.open_tab")


def _tab_on_product(goods_no: str) -> dict:
    return {
        "id": f"tab-{goods_no}",
        "url": (
            f"https://www.oliveyoung.co.kr/store/goods/getGoodsDetail.do?"
            f"goodsNo={goods_no}&tab=review"
        ),
        "title": "OliveYoung product detail",
    }


def _no_pgrep(_cmd: str) -> list[int]:
    return []


def _fake_head(short: str):
    def _runner() -> str:
        return short
    return _runner


# ---------------------------------------------------------------------------
# Happy path
# ---------------------------------------------------------------------------


def test_gate_happy_path_returns_ok() -> None:
    queue = _two_sku_queue()
    probe = _FakeCdpProbe(tabs=[_tab_on_product("A000000111111")])
    result = evaluate_preconditions(
        queue,
        goods_no="A000000111111",
        sort_type="DATETIME_DESC",
        now=_now(),
        allow_open_tab=False,
        cdp_probe=probe,
        pgrep_runner=_no_pgrep,
    )
    assert result.ok is True
    assert result.failed_check is None
    assert result.required_action is None


# ---------------------------------------------------------------------------
# Check 1 — HEAD
# ---------------------------------------------------------------------------


def test_gate_head_mismatch_fails() -> None:
    queue = _two_sku_queue()
    probe = _FakeCdpProbe(tabs=[_tab_on_product("A000000111111")])
    result = evaluate_preconditions(
        queue,
        goods_no="A000000111111",
        sort_type="DATETIME_DESC",
        now=_now(),
        allow_open_tab=False,
        head_baseline="deadbee",
        cdp_probe=probe,
        pgrep_runner=_no_pgrep,
        git_head_runner=_fake_head("1ad399d"),
    )
    assert result.ok is False
    assert result.failed_check == "head_mismatch"


def test_gate_head_matches_passes() -> None:
    queue = _two_sku_queue()
    probe = _FakeCdpProbe(tabs=[_tab_on_product("A000000111111")])
    result = evaluate_preconditions(
        queue,
        goods_no="A000000111111",
        sort_type="DATETIME_DESC",
        now=_now(),
        allow_open_tab=False,
        head_baseline="1ad399d",
        cdp_probe=probe,
        pgrep_runner=_no_pgrep,
        git_head_runner=_fake_head("1ad399d"),
    )
    assert result.ok is True


# ---------------------------------------------------------------------------
# Check 2 — competing collection process
# ---------------------------------------------------------------------------


def test_gate_competing_process_fails() -> None:
    queue = _two_sku_queue()
    probe = _FakeCdpProbe(tabs=[_tab_on_product("A000000111111")])
    result = evaluate_preconditions(
        queue,
        goods_no="A000000111111",
        sort_type="DATETIME_DESC",
        now=_now(),
        allow_open_tab=False,
        cdp_probe=probe,
        pgrep_runner=lambda _: [54321],
    )
    assert result.ok is False
    assert result.failed_check == "competing_collection_process"
    assert "54321" in (result.required_action or "")


# ---------------------------------------------------------------------------
# Check 3 — CDP reachable
# ---------------------------------------------------------------------------


def test_gate_cdp_unreachable_fails() -> None:
    queue = _two_sku_queue()
    probe = _FakeCdpProbe(
        version_raises=real_cdp_probe.CdpUnreachableError("connection refused"),
    )
    result = evaluate_preconditions(
        queue,
        goods_no="A000000111111",
        sort_type="DATETIME_DESC",
        now=_now(),
        allow_open_tab=False,
        cdp_probe=probe,
        pgrep_runner=_no_pgrep,
    )
    assert result.ok is False
    assert result.failed_check == "cdp_unreachable"


# ---------------------------------------------------------------------------
# Check 4 — target tab open
# ---------------------------------------------------------------------------


def test_gate_target_tab_missing_without_allow_open_tab_fails() -> None:
    queue = _two_sku_queue()
    probe = _FakeCdpProbe(tabs=[
        # An unrelated tab — does NOT match the target goodsNo.
        {"id": "x", "url": "https://www.google.com/", "title": "Google"},
    ])
    result = evaluate_preconditions(
        queue,
        goods_no="A000000111111",
        sort_type="DATETIME_DESC",
        now=_now(),
        allow_open_tab=False,
        cdp_probe=probe,
        pgrep_runner=_no_pgrep,
    )
    assert result.ok is False
    assert result.failed_check == "target_tab_missing"
    assert probe.open_tab_calls == []  # phase A never opens


def test_gate_target_tab_missing_with_allow_open_tab_without_auth_fails() -> None:
    """`--allow-open-tab` alone does NOT authorize a /json/new call.
    The gate refuses to open the tab without
    `--i-authorize-live-collection` and reports
    `target_tab_missing_without_authorization`. This preserves the
    phase-A guarantee that the runner never opens a tab silently."""
    queue = _two_sku_queue()
    probe = _FakeCdpProbe(tabs=[
        {"id": "x", "url": "https://www.google.com/", "title": "Google"},
    ])
    result = evaluate_preconditions(
        queue,
        goods_no="A000000111111",
        sort_type="DATETIME_DESC",
        now=_now(),
        allow_open_tab=True,
        authorize_live=False,
        cdp_probe=probe,
        pgrep_runner=_no_pgrep,
    )
    assert result.ok is False
    assert result.failed_check == "target_tab_missing_without_authorization"
    assert probe.open_tab_calls == []


def test_gate_target_tab_missing_with_allow_open_tab_and_auth_opens_then_passes(
    monkeypatch,
) -> None:
    """When BOTH `--allow-open-tab` AND `--i-authorize-live-collection`
    are passed and the target tab is missing, the gate calls
    `cdp_probe.open_tab` exactly once and then re-lists tabs. On the
    second list the matching tab is present, so the gate passes."""
    queue = _two_sku_queue()

    list_calls = {"count": 0}
    open_calls: list[str] = []

    class _ProbeWithOpen:
        CdpUnreachableError = real_cdp_probe.CdpUnreachableError

        def get_version(self) -> dict:
            return {"Browser": "Chrome/123"}

        def list_tabs(self) -> list[dict]:
            list_calls["count"] += 1
            if list_calls["count"] == 1:
                return [{"id": "x", "url": "https://www.google.com/"}]
            return [_tab_on_product("A000000111111")]

        def open_tab(self, target_url: str) -> dict:
            open_calls.append(target_url)
            return {"id": "new-tab", "url": target_url}

    probe = _ProbeWithOpen()
    result = evaluate_preconditions(
        queue,
        goods_no="A000000111111",
        sort_type="DATETIME_DESC",
        now=_now(),
        allow_open_tab=True,
        authorize_live=True,
        cdp_probe=probe,
        pgrep_runner=_no_pgrep,
    )
    assert result.ok is True, (
        f"expected gate to pass after open_tab; got {result!r}"
    )
    assert len(open_calls) == 1
    assert "goodsNo=A000000111111" in open_calls[0]
    assert "&tab=review" in open_calls[0]
    assert list_calls["count"] == 2  # one before open, one after
    assert any("open_tab invoked" in n for n in result.notes)


def test_gate_target_tab_open_did_not_resolve_fails() -> None:
    """If open_tab succeeds but the post-open /json/list still does
    not contain a matching tab, the gate fails with
    `target_tab_open_did_not_resolve`."""
    queue = _two_sku_queue()
    open_calls: list[str] = []

    class _StubbornProbe:
        CdpUnreachableError = real_cdp_probe.CdpUnreachableError

        def get_version(self) -> dict:
            return {"Browser": "Chrome/123"}

        def list_tabs(self) -> list[dict]:
            return [{"id": "x", "url": "https://www.google.com/"}]

        def open_tab(self, target_url: str) -> dict:
            open_calls.append(target_url)
            return {"id": "new-tab", "url": target_url}

    probe = _StubbornProbe()
    result = evaluate_preconditions(
        queue,
        goods_no="A000000111111",
        sort_type="DATETIME_DESC",
        now=_now(),
        allow_open_tab=True,
        authorize_live=True,
        cdp_probe=probe,
        pgrep_runner=_no_pgrep,
    )
    assert result.ok is False
    assert result.failed_check == "target_tab_open_did_not_resolve"
    assert len(open_calls) == 1


# ---------------------------------------------------------------------------
# Check 5 — target tab on product page
# ---------------------------------------------------------------------------


def test_gate_target_tab_on_login_page_fails() -> None:
    """A tab whose URL matched getGoodsDetail + goodsNo but redirected
    to /member/login should be flagged as off-product."""
    queue = _two_sku_queue()
    probe = _FakeCdpProbe(tabs=[{
        "id": "x",
        "url": (
            "https://www.oliveyoung.co.kr/store/goods/getGoodsDetail.do?"
            "goodsNo=A000000111111&tab=review/member/login"
        ),
        "title": "Login",
    }])
    result = evaluate_preconditions(
        queue,
        goods_no="A000000111111",
        sort_type="DATETIME_DESC",
        now=_now(),
        allow_open_tab=False,
        cdp_probe=probe,
        pgrep_runner=_no_pgrep,
    )
    assert result.ok is False
    assert result.failed_check == "target_tab_off_product_page"
    assert "mark_brand20_checkpoint_certified.py" in (result.required_action or "")


def test_gate_target_tab_on_captcha_fails() -> None:
    queue = _two_sku_queue()
    probe = _FakeCdpProbe(tabs=[{
        "id": "x",
        "url": (
            "https://www.oliveyoung.co.kr/store/goods/getGoodsDetail.do?"
            "goodsNo=A000000111111&tab=review/captcha/challenge"
        ),
        "title": "Captcha",
    }])
    result = evaluate_preconditions(
        queue,
        goods_no="A000000111111",
        sort_type="DATETIME_DESC",
        now=_now(),
        allow_open_tab=False,
        cdp_probe=probe,
        pgrep_runner=_no_pgrep,
    )
    assert result.ok is False
    assert result.failed_check == "target_tab_off_product_page"


# ---------------------------------------------------------------------------
# Check 6 — cooldown horizon
# ---------------------------------------------------------------------------


def test_gate_target_row_in_active_cooldown_fails() -> None:
    queue = _two_sku_queue()
    for it in queue.items:
        if it.goods_no == "A000000111111" and it.sort_type == "DATETIME_DESC":
            it.status = "retry_after_cooldown"
            it.next_run_after = "2026-05-13T13:00:00Z"
    probe = _FakeCdpProbe(tabs=[_tab_on_product("A000000111111")])
    result = evaluate_preconditions(
        queue,
        goods_no="A000000111111",
        sort_type="DATETIME_DESC",
        now=_now(),
        allow_open_tab=False,
        cdp_probe=probe,
        pgrep_runner=_no_pgrep,
    )
    assert result.ok is False
    assert result.failed_check == "target_in_cooldown"


def test_gate_other_row_in_cooldown_is_informational_only() -> None:
    """A DIFFERENT row in cooldown does not block the target row; the
    horizon shows up in notes."""
    queue = _two_sku_queue()
    cooldown_iso = "2026-05-13T13:00:00Z"
    # Brand-B primary is cooling; we're targeting Brand-A primary.
    for it in queue.items:
        if it.goods_no == "A000000222222" and it.sort_type == "DATETIME_DESC":
            it.status = "retry_after_cooldown"
            it.next_run_after = cooldown_iso
    probe = _FakeCdpProbe(tabs=[_tab_on_product("A000000111111")])
    result = evaluate_preconditions(
        queue,
        goods_no="A000000111111",
        sort_type="DATETIME_DESC",
        now=_now(),
        allow_open_tab=False,
        cdp_probe=probe,
        pgrep_runner=_no_pgrep,
    )
    assert result.ok is True
    # Notes should mention the cooldown horizon.
    assert any("next_run_after" in n for n in result.notes)
    assert any(cooldown_iso in n for n in result.notes)


def test_gate_allow_open_tab_note_when_passing() -> None:
    """When the tab IS already open and --allow-open-tab is passed,
    the gate passes WITHOUT calling /json/new and emits an
    informational note so the operator knows the flag was respected
    but no action was taken."""
    queue = _two_sku_queue()
    probe = _FakeCdpProbe(tabs=[_tab_on_product("A000000111111")])
    result = evaluate_preconditions(
        queue,
        goods_no="A000000111111",
        sort_type="DATETIME_DESC",
        now=_now(),
        allow_open_tab=True,
        cdp_probe=probe,
        pgrep_runner=_no_pgrep,
    )
    assert result.ok is True
    assert any(
        "no /json/new call made" in n or "already present" in n
        for n in result.notes
    )
    assert probe.open_tab_calls == []


def test_gate_returns_precondition_result_type() -> None:
    """Smoke: the function returns the documented dataclass."""
    queue = _two_sku_queue()
    probe = _FakeCdpProbe(tabs=[_tab_on_product("A000000111111")])
    result = evaluate_preconditions(
        queue,
        goods_no="A000000111111",
        sort_type="DATETIME_DESC",
        now=_now(),
        allow_open_tab=False,
        cdp_probe=probe,
        pgrep_runner=_no_pgrep,
    )
    assert isinstance(result, PreconditionResult)
