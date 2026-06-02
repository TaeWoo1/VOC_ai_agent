"""Tests for the DOM-probe widening + `sort_control_unreachable` terminal
status path on `_PlaywrightReviewSession`.

Background
----------
RATING_ASC + RATING_DESC have been recurring `is_sort_control_failure=true`
on OY post-login sessions across SKUs and categories. QA triage
(`ops/agent_handoffs/I-OY-RATING-SORTS.md`) traced this to DOM render
variability on the rating-axis sort tabs — the connector's selectors are
correct when the labels are present, but the labels are not always
inline-rendered at hunt time.

The fix:

  1. `_widen_sort_row_probe` runs once before the existing deadline
     hunt. Scrolls the first sort-container hit into view, then probes
     the curated `SORT_DISCLOSURE_AFFORDANCE_LABELS_KO` allow-list
     (exact-text only, scoped to the sort container, ONE click max).
  2. When the deadline still expires without a click,
     `_click_sort_button_robust` sets `_sort_control_unreachable=True`.
     The connector drains this into `ConnectorRunSummary`. The batch
     classifier then maps it to a distinct terminal status
     (`sort_control_unreachable`) instead of `blocked_or_empty_state`.

Tests in this module exercise the rescue path (a) and the terminal-status
path (b) entirely against fake Playwright surfaces — no live browser.
The connector / session interactions remain the operator's named
contract; this file pins them.
"""
from __future__ import annotations

import pytest

from src.voc.connectors import oliveyoung_browser_api as mod
from src.voc.connectors.oliveyoung_browser_api import (
    OliveYoungBrowserAPIConnector,
)


# ---------------------------------------------------------------------------
# Constants the implementation contract pins on the connector class
# ---------------------------------------------------------------------------


def test_disclosure_affordance_labels_constant_present():
    """The new constant exists on the connector class and matches the
    operator-curated allow-list: `정렬 / 더보기 / 전체보기 / 필터 /
    정렬 기준`. Substring labels are deliberately excluded — broader
    matching has been observed to misdirect clicks (the `랭킹` element
    contains `랭`).
    """
    expected = ("정렬", "더보기", "전체보기", "필터", "정렬 기준")
    assert (
        OliveYoungBrowserAPIConnector.SORT_DISCLOSURE_AFFORDANCE_LABELS_KO
        == expected
    )


def test_session_threading_sort_disclosure_labels():
    """The connector's `_build_session` must thread the disclosure
    constant down to `_PlaywrightReviewSession`. We construct the
    connector and verify `_build_session()` produces a session whose
    `_sort_disclosure_affordance_labels_ko` attribute matches the
    connector class constant."""
    real_cls = mod._PlaywrightReviewSession
    captured: dict = {}

    class _CaptureSession(real_cls):
        def __init__(self, **kw):
            captured.update(kw)
            # Don't call super().__init__ — it would try to start
            # Playwright. We only care about the kwargs the connector
            # passes us.

    mod._PlaywrightReviewSession = _CaptureSession
    try:
        c = OliveYoungBrowserAPIConnector(
            product_url=(
                "https://www.oliveyoung.co.kr/store/goods/"
                "getGoodsDetail.do?goodsNo=A000000179126&tab=review"
            ),
            sort_type="RATING_ASC",
        )
        c._build_session()
    finally:
        mod._PlaywrightReviewSession = real_cls

    assert captured["sort_disclosure_affordance_labels_ko"] == (
        "정렬", "더보기", "전체보기", "필터", "정렬 기준",
    )
    # And the rating-tab label is forwarded as expected.
    assert captured["sort_button_label_ko"] == "평점 낮은순"


# ---------------------------------------------------------------------------
# Fake Playwright surfaces. Each "element" carries (text, kind) and
# records click attempts. The sort container hits are ordered so the
# first-hit semantics of `_widen_sort_row_probe` are observable in tests.
# ---------------------------------------------------------------------------


class _FakeElement:
    """Single button-shaped element. `text` is what `inner_text` returns;
    `clicks` accumulates any click() invocations so tests can assert
    on the click target."""

    def __init__(self, text: str, *, parent_log: list | None = None):
        self.text = text
        self._parent_log = parent_log if parent_log is not None else []
        self.scroll_calls = 0

    async def inner_text(self, timeout=None):
        return self.text

    async def scroll_into_view_if_needed(self, timeout=None):
        self.scroll_calls += 1
        return None

    async def click(self, timeout=None):
        self._parent_log.append(self.text)
        return None


class _FakeElementGroup:
    """Locator wrapping N elements of one tag. `count()` returns N;
    `nth(i)` returns the ith element."""

    def __init__(self, elements: list[_FakeElement]):
        self._elements = elements

    async def count(self):
        return len(self._elements)

    def nth(self, i: int):
        return self._elements[i]


class _FakeContainer:
    """A sort-container locator. Mocks Playwright's `.locator(child)`
    semantics by mapping child selectors (`button`, `a`, etc.) to
    pre-recorded elements. `count()` returns 1 if the container is
    "present" on the page, else 0.

    `mutable_button_texts` is the LIVE list of `<button>` text values.
    We re-sample it each time `.locator("button")` is called so tests
    can mutate it after a disclosure click to simulate the sort row
    rendering the previously-hidden rating tabs.
    """

    def __init__(
        self,
        present: bool,
        mutable_button_texts: list[str],
        click_log: list,
    ):
        self.present = present
        self._mutable = mutable_button_texts
        self._click_log = click_log
        self.scroll_calls = 0
        # `first` is `self` — Playwright's `locator(...).first` is
        # idempotent on a single element.
        self.first = self

    async def count(self):
        return 1 if self.present else 0

    async def scroll_into_view_if_needed(self, timeout=None):
        self.scroll_calls += 1

    def locator(self, child_selector: str):
        if child_selector == "button":
            elements = [
                _FakeElement(t, parent_log=self._click_log)
                for t in self._mutable
            ]
            return _FakeElementGroup(elements)
        # Other selectors (a, [role='button']) match nothing.
        return _FakeElementGroup([])


class _FakePage:
    """Routes a hand-curated map of selectors to FakeContainers, fakes
    everything else as zero-count.

    `containers_by_selector` keys are the connector's
    `SORT_CONTAINER_CANDIDATES` strings (e.g. "div.pc-sort"). The first
    one that resolves to a present container wins.
    """

    def __init__(
        self,
        containers_by_selector: dict[str, _FakeContainer],
        click_log: list,
    ):
        self._containers = containers_by_selector
        self._click_log = click_log

    def locator(self, selector: str):
        if selector in self._containers:
            return self._containers[selector]
        # Unknown selectors → empty group (Playwright would also return
        # something with count()=0).
        return _FakeContainer(
            present=False,
            mutable_button_texts=[],
            click_log=self._click_log,
        )


def _fresh_session(
    *,
    page,
    target_label: str,
    settle_s: float,
    poll_interval_s: float = 0.01,
):
    """Bypass `_PlaywrightReviewSession.__init__` and pin only the
    attributes `_widen_sort_row_probe` + `_click_sort_button_robust`
    actually read. Mirrors the
    `test_trigger_review_list_api_runs_without_attribute_error`
    pattern."""
    sess_cls = mod._PlaywrightReviewSession
    sess = object.__new__(sess_cls)
    sess._page = page
    sess._sort_button_label_ko = target_label
    sess._sort_button_selector = None
    sess._sort_container_candidates = (
        "div.pc-sort",
        ".sort-container",
        "[class*='sort']",
    )
    sess._sort_disclosure_affordance_labels_ko = (
        "정렬", "더보기", "전체보기", "필터", "정렬 기준",
    )
    sess._sort_hunt_settle_s = settle_s
    sess._sort_hunt_poll_interval_s = poll_interval_s
    sess._expected_sort_type = "RATING_ASC"
    sess._last_seen_sort_labels = []
    sess._sort_control_unreachable = False
    return sess


# ---------------------------------------------------------------------------
# (a) Sort row absent on initial poll → disclosure click → rescue
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_widening_probe_clicks_disclosure_when_target_absent_then_recovers():
    """Operator's test case (a). On first poll the sort container is
    present but the rating label `평점 낮은순` is absent. The widening
    probe identifies a `정렬` disclosure affordance inside the sort
    scope, clicks it, and the next poll surfaces the rating label —
    `_click_sort_button_robust` then clicks it cleanly.

    Asserts:
      - the disclosure affordance was clicked (single click, not all 5)
      - the rating label was clicked AFTER the disclosure click
      - `_sort_control_unreachable` is False (rescue succeeded)
    """
    click_log: list = []
    # Initial sort-container button labels: 3 visible sort tabs
    # (`최신순`, `유용한 순`, `도움순`) plus a `정렬` disclosure. The
    # rating label is NOT initially present.
    button_texts = ["최신순", "유용한 순", "도움순", "정렬"]

    container = _FakeContainer(
        present=True,
        mutable_button_texts=button_texts,
        click_log=click_log,
    )

    # Other container candidates miss; only `div.pc-sort` is "present".
    page = _FakePage(
        containers_by_selector={
            "div.pc-sort": container,
            ".sort-container": _FakeContainer(False, [], click_log),
            "[class*='sort']": _FakeContainer(False, [], click_log),
        },
        click_log=click_log,
    )

    sess = _fresh_session(
        page=page, target_label="평점 낮은순", settle_s=2.0,
        poll_interval_s=0.01,
    )

    # Mutate the button list AFTER the disclosure clicks — emulates the
    # PDP re-rendering the rating tab. We hook this by monkey-patching
    # `_FakeElement.click` on the `정렬` element to mutate the parent
    # container's buttons.
    original_click = _FakeElement.click

    async def _disclosure_click(self, timeout=None):
        await original_click(self, timeout=timeout)
        if self.text == "정렬":
            # After clicking 정렬, the rating tab becomes visible.
            container._mutable.append("평점 낮은순")

    _FakeElement.click = _disclosure_click  # type: ignore[assignment]
    try:
        await sess._click_sort_button_robust()
    finally:
        _FakeElement.click = original_click  # type: ignore[assignment]

    # Disclosure was clicked exactly once.
    assert click_log.count("정렬") == 1
    # Target rating label was eventually clicked.
    assert "평점 낮은순" in click_log
    # The disclosure click happened BEFORE the rating-label click.
    assert click_log.index("정렬") < click_log.index("평점 낮은순")
    # Rescue succeeded → no terminal flag.
    assert sess._sort_control_unreachable is False
    assert sess.get_sort_control_unreachable() is False


@pytest.mark.asyncio
async def test_widening_probe_skips_disclosure_when_target_already_visible():
    """Idempotency: when the rating label is already inline-rendered on
    the first poll, the widening probe MUST NOT click any disclosure
    affordance. Only the target label gets clicked. This is the
    espoir-style success path; we cannot regress it."""
    click_log: list = []
    button_texts = ["최신순", "유용한 순", "평점 낮은순", "정렬"]

    container = _FakeContainer(
        present=True, mutable_button_texts=button_texts, click_log=click_log,
    )
    page = _FakePage(
        containers_by_selector={
            "div.pc-sort": container,
            ".sort-container": _FakeContainer(False, [], click_log),
            "[class*='sort']": _FakeContainer(False, [], click_log),
        },
        click_log=click_log,
    )
    sess = _fresh_session(
        page=page, target_label="평점 낮은순", settle_s=2.0,
        poll_interval_s=0.01,
    )

    await sess._click_sort_button_robust()

    # Disclosure was NOT clicked — target was already visible.
    assert "정렬" not in click_log
    # Target was clicked once.
    assert click_log == ["평점 낮은순"]
    assert sess._sort_control_unreachable is False


# ---------------------------------------------------------------------------
# (b) Sort row absent after disclosure click → terminal status
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_terminal_unreachable_when_disclosure_does_not_reveal_target():
    """Operator's test case (b). The widening probe runs, clicks one
    disclosure affordance (`정렬`), but the rating label still does
    NOT appear. The deadline poll then exhausts. The terminal flag
    `_sort_control_unreachable` flips True; the getter reports it.
    """
    click_log: list = []
    # Sort container has 3 visible tabs + 1 disclosure, but no rating
    # tab even after clicking 정렬 (we don't mutate the list).
    button_texts = ["최신순", "유용한 순", "도움순", "정렬"]

    container = _FakeContainer(
        present=True, mutable_button_texts=button_texts, click_log=click_log,
    )
    page = _FakePage(
        containers_by_selector={
            "div.pc-sort": container,
            ".sort-container": _FakeContainer(False, [], click_log),
            "[class*='sort']": _FakeContainer(False, [], click_log),
        },
        click_log=click_log,
    )

    # Short settle window — 0.2s is plenty given poll_interval=0.01s,
    # and tests don't need to actually wait for production timeouts.
    sess = _fresh_session(
        page=page, target_label="평점 낮은순", settle_s=0.2,
        poll_interval_s=0.01,
    )

    await sess._click_sort_button_robust()

    # Disclosure was clicked once during widening, then the deadline
    # poll never found the rating tab (because we did not mutate the
    # list).
    assert click_log.count("정렬") == 1
    assert "평점 낮은순" not in click_log
    # Terminal flag flipped.
    assert sess._sort_control_unreachable is True
    assert sess.get_sort_control_unreachable() is True


@pytest.mark.asyncio
async def test_unreachable_flag_reset_between_hunts():
    """The terminal flag is per-hunt. A subsequent successful hunt on
    the same session must reset the flag to False — the operator-
    visible `sort_control_unreachable` reflects the MOST RECENT hunt."""
    click_log: list = []
    button_texts: list[str] = []  # initially empty → first hunt fails

    container = _FakeContainer(
        present=True, mutable_button_texts=button_texts, click_log=click_log,
    )
    page = _FakePage(
        containers_by_selector={
            "div.pc-sort": container,
            ".sort-container": _FakeContainer(False, [], click_log),
            "[class*='sort']": _FakeContainer(False, [], click_log),
        },
        click_log=click_log,
    )
    sess = _fresh_session(
        page=page, target_label="평점 낮은순", settle_s=0.1,
        poll_interval_s=0.01,
    )

    await sess._click_sort_button_robust()
    assert sess._sort_control_unreachable is True

    # Now mutate the button list so the rating tab is visible, and
    # re-run. The flag must reset.
    container._mutable.append("평점 낮은순")
    await sess._click_sort_button_robust()
    assert sess._sort_control_unreachable is False


# ---------------------------------------------------------------------------
# Disclosure-click contract: at most ONE click per probe, exact-text only
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_disclosure_probe_never_substring_matches():
    """Substring-matching against page-wide labels has historically
    misdirected clicks. The probe must use EQUALITY of normalized
    text — `랭킹` (which contains the substring `랭`, not the substring
    `정렬`) must NOT trigger a disclosure click. Same for `더보기 보기`
    or any longer label that contains an allow-listed string but is
    not exactly equal to it."""
    click_log: list = []
    # Only labels that CONTAIN allow-listed strings as substrings, but
    # are not exact matches.
    button_texts = ["랭킹", "더보기 보기", "랭킹 정렬"]

    container = _FakeContainer(
        present=True, mutable_button_texts=button_texts, click_log=click_log,
    )
    page = _FakePage(
        containers_by_selector={
            "div.pc-sort": container,
            ".sort-container": _FakeContainer(False, [], click_log),
            "[class*='sort']": _FakeContainer(False, [], click_log),
        },
        click_log=click_log,
    )
    sess = _fresh_session(
        page=page, target_label="평점 낮은순", settle_s=0.1,
        poll_interval_s=0.01,
    )

    await sess._click_sort_button_robust()

    # No clicks at all — substring-only matches must not trigger.
    assert click_log == []
    # And the deadline expires → terminal flag set.
    assert sess._sort_control_unreachable is True


@pytest.mark.asyncio
async def test_disclosure_probe_clicks_only_first_match():
    """When MULTIPLE allow-listed disclosure affordances are visible
    inside the sort scope, only the FIRST match is clicked. Operator
    contract: at most one disclosure click per probe attempt."""
    click_log: list = []
    # Both `정렬` and `더보기` are allow-listed. The probe must click
    # only the first one it encounters.
    button_texts = ["정렬", "더보기"]

    container = _FakeContainer(
        present=True, mutable_button_texts=button_texts, click_log=click_log,
    )
    page = _FakePage(
        containers_by_selector={
            "div.pc-sort": container,
            ".sort-container": _FakeContainer(False, [], click_log),
            "[class*='sort']": _FakeContainer(False, [], click_log),
        },
        click_log=click_log,
    )
    sess = _fresh_session(
        page=page, target_label="평점 낮은순", settle_s=0.1,
        poll_interval_s=0.01,
    )

    await sess._click_sort_button_robust()

    # Exactly ONE disclosure click. Either 정렬 OR 더보기, not both.
    disclosure_clicks = [c for c in click_log if c in ("정렬", "더보기")]
    assert len(disclosure_clicks) == 1
    # Specifically the FIRST (button order = enumeration order).
    assert disclosure_clicks[0] == "정렬"
