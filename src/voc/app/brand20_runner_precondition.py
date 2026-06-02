"""Precondition gate for the Brand-20 queue runner.

Runs the per-session checks the operator would otherwise run by hand
(HEAD verification, no competing collection process, CDP reachable,
target tab open on the product page, queue-wide cooldown horizon)
before any subprocess is invoked. Returns a structured
`PreconditionResult` so the CLI and tests can branch on a single
typed value.

Design boundaries
-----------------
- Pure aside from the four well-bounded I/O calls: `subprocess.run`
  for `git rev-parse` and `pgrep`, and two-or-three HTTP GETs / PUT
  via `cdp_tab_probe` (`get_version` + `list_tabs`, plus a single
  `open_tab` + re-`list_tabs` when phase B's
  `allow_open_tab=True` AND `authorize_live=True` AND the target
  tab is missing).
- All I/O calls are pluggable so tests can replace them without
  forking processes or contacting the network.
- The gate only opens a tab when BOTH `allow_open_tab=True` AND
  `authorize_live=True` are passed. Without authorization the gate
  refuses to call `/json/new` and returns
  `target_tab_missing_without_authorization` so the operator sees
  that the flag was parsed but the action was suppressed (preserves
  phase A's "never open without auth" guarantee).
"""
from __future__ import annotations

import os
import subprocess
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Callable

from src.voc.app import cdp_tab_probe as default_cdp_probe
from src.voc.app.brand20_queue import Brand20Queue, _parse_iso


# ---------------------------------------------------------------------------
# Result type
# ---------------------------------------------------------------------------


@dataclass
class PreconditionResult:
    """Outcome of `evaluate_preconditions`.

    On success: `ok=True`, `failed_check=None`, `required_action=None`,
    `notes` may carry informational entries (e.g. queue-wide cooldown
    horizon).

    On failure: `ok=False`, `failed_check` is a short token the
    operator-facing report uses verbatim (matches the convention in
    `update_brand20_queue_from_batch.py` and
    `inspect_brand20_collection_status.py`), and `required_action`
    describes the operator step that would unblock the run.
    """

    ok: bool
    failed_check: str | None = None
    required_action: str | None = None
    notes: list[str] = field(default_factory=list)


# ---------------------------------------------------------------------------
# Default I/O helpers (test-replaceable)
# ---------------------------------------------------------------------------


def _default_git_head_short() -> str:
    """Return `git rev-parse --short HEAD` or the empty string on
    failure. Test code replaces this so no test forks `git`."""
    try:
        out = subprocess.run(  # nosec B603,B607
            ["git", "rev-parse", "--short", "HEAD"],
            check=False,
            capture_output=True,
            text=True,
            shell=False,
        )
        return out.stdout.strip()
    except (OSError, subprocess.SubprocessError):
        return ""


def _default_pgrep(cmd: str) -> list[int]:
    """Return PIDs (excluding the current process) for processes whose
    command line matches `cmd`. Test code replaces this so no test
    forks `pgrep`.

    `cmd` is the literal substring passed to `pgrep -f`. The current
    process's PID is excluded so a self-match (e.g. when the runner
    itself is being inspected) does not falsely trip the gate.
    """
    try:
        out = subprocess.run(  # nosec B603,B607
            ["pgrep", "-f", cmd],
            check=False,
            capture_output=True,
            text=True,
            shell=False,
        )
    except (OSError, subprocess.SubprocessError):
        return []
    pids: list[int] = []
    self_pid = os.getpid()
    for token in (out.stdout or "").split():
        try:
            pid = int(token.strip())
        except ValueError:
            continue
        if pid == self_pid:
            continue
        pids.append(pid)
    return pids


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _matches_target(url: str, goods_no: str) -> bool:
    """Return True if `url` looks like a product-detail page for
    `goods_no`. URL-only heuristic — no DOM inspection (see planning
    handoff §10 risk #2)."""
    if not url:
        return False
    if "getGoodsDetail.do" not in url:
        return False
    needle = f"goodsNo={goods_no}"
    return needle in url


def _looks_off_product_page(url: str) -> bool:
    """Return True if `url` is on an auth wall or interstitial that the
    runner should refuse to launch collection against. Conservative
    URL-only check: only `/member/login` and `/captcha` are flagged
    here; Cloudflare interstitials typically preserve the product URL
    and are caught post-attempt by the connector classifier."""
    if not url:
        return False
    return ("/member/login" in url) or ("/captcha" in url)


# ---------------------------------------------------------------------------
# Main gate
# ---------------------------------------------------------------------------


def evaluate_preconditions(
    queue: Brand20Queue,
    *,
    goods_no: str,
    sort_type: str,
    now: datetime,
    allow_open_tab: bool,
    authorize_live: bool = False,
    head_baseline: str | None = None,
    cdp_probe: Any = None,
    pgrep_runner: Callable[[str], list[int]] | None = None,
    git_head_runner: Callable[[], str] | None = None,
) -> PreconditionResult:
    """Run the precondition checks for `(goods_no, sort_type)`.

    Checks run in order; the first failure short-circuits and the
    informational notes accumulated up to that point are preserved on
    the returned result.

    Parameters
    ----------
    queue:
        Loaded `Brand20Queue` (the runner has already deserialised
        the queue file once; this avoids a second disk read).
    goods_no, sort_type:
        The target row. Both must be present so the cooldown check
        can scope correctly even if the target row is itself in
        cooldown.
    now:
        Timezone-aware UTC datetime. The CLI passes
        `datetime.now(timezone.utc)`; tests pass a fixed instant.
    allow_open_tab:
        Forwarded from the CLI's `--allow-open-tab` flag. The gate
        calls `cdp_probe.open_tab` exactly once when this is True AND
        `authorize_live=True` AND the target tab is missing; without
        authorization the gate refuses to call `/json/new` and
        reports `target_tab_missing_without_authorization`.
    authorize_live:
        Forwarded from the CLI's `--i-authorize-live-collection`
        flag. Required (alongside `allow_open_tab=True`) for the
        gate to actually open a missing tab. Defaults to False so
        every existing test that omits this kwarg keeps the
        "never opens without auth" guarantee.
    head_baseline:
        When non-None, the result of `git rev-parse --short HEAD` must
        equal this value.
    cdp_probe / pgrep_runner / git_head_runner:
        Pluggable I/O dependencies, replaced by tests.
    """
    notes: list[str] = []

    # Resolve module-level defaults at CALL time (not function-
    # definition time) so monkeypatching `precond._default_pgrep` /
    # `precond._default_git_head_short` / `default_cdp_probe` from
    # tests takes effect.
    if cdp_probe is None:
        cdp_probe = default_cdp_probe
    if pgrep_runner is None:
        pgrep_runner = _default_pgrep
    if git_head_runner is None:
        git_head_runner = _default_git_head_short

    if now.tzinfo is None:
        now = now.replace(tzinfo=timezone.utc)

    # ---- Check 1: HEAD verification ----------------------------------
    if head_baseline is not None:
        actual_head = git_head_runner()
        if actual_head != head_baseline:
            return PreconditionResult(
                ok=False,
                failed_check="head_mismatch",
                required_action=(
                    f"HEAD is {actual_head!r}, expected "
                    f"{head_baseline!r}. Verify branch / commit before "
                    f"re-running."
                ),
                notes=notes,
            )

    # ---- Check 2: no competing collection process --------------------
    try:
        competing = pgrep_runner("run_oy_collection_batch")
    except Exception as exc:  # noqa: BLE001
        # pgrep failure is itself a precondition failure — the operator
        # should know we couldn't verify the no-competing-process rule.
        return PreconditionResult(
            ok=False,
            failed_check="competing_collection_process",
            required_action=(
                f"pgrep probe failed ({exc!r}); cannot verify that no "
                f"competing run_oy_collection_batch process is active."
            ),
            notes=notes,
        )
    if competing:
        pretty = ", ".join(str(p) for p in competing)
        return PreconditionResult(
            ok=False,
            failed_check="competing_collection_process",
            required_action=(
                f"competing run_oy_collection_batch process(es) "
                f"detected: PIDs={pretty}. Wait for them to finish "
                f"before re-running."
            ),
            notes=notes,
        )

    # ---- Check 3: CDP reachable --------------------------------------
    try:
        cdp_probe.get_version()
    except default_cdp_probe.CdpUnreachableError as exc:
        return PreconditionResult(
            ok=False,
            failed_check="cdp_unreachable",
            required_action=(
                f"CDP /json/version unreachable at 127.0.0.1:9222 "
                f"({exc}). Start Chrome with --remote-debugging-port=9222."
            ),
            notes=notes,
        )

    # ---- Check 4: target tab open ------------------------------------
    try:
        tabs = cdp_probe.list_tabs()
    except default_cdp_probe.CdpUnreachableError as exc:
        # /json/list failing after /json/version succeeded is rare but
        # classified as cdp_unreachable for operator clarity.
        return PreconditionResult(
            ok=False,
            failed_check="cdp_unreachable",
            required_action=(
                f"CDP /json/list unreachable at 127.0.0.1:9222 "
                f"({exc})."
            ),
            notes=notes,
        )
    target_tab: dict | None = None
    for tab in tabs:
        url = str(tab.get("url") or "")
        if _matches_target(url, goods_no):
            target_tab = tab
            break

    if target_tab is None:
        target_url = (
            f"https://www.oliveyoung.co.kr/store/goods/getGoodsDetail.do"
            f"?goodsNo={goods_no}&tab=review"
        )
        if allow_open_tab and not authorize_live:
            # Phase-B path A: operator passed --allow-open-tab but
            # withheld --i-authorize-live-collection. The gate refuses
            # to call /json/new because tab opening is a side effect
            # the operator may not want without an authorized run.
            # This preserves phase A's "never opens without explicit
            # operator authorization" guarantee.
            return PreconditionResult(
                ok=False,
                failed_check="target_tab_missing_without_authorization",
                required_action=(
                    f"target tab for goods_no={goods_no!r} is not open. "
                    f"--allow-open-tab is set but "
                    f"--i-authorize-live-collection is NOT. The gate "
                    f"refuses to call /json/new without explicit live-"
                    f"collection authorization. Pass both flags, or "
                    f"open the URL manually: {target_url}"
                ),
                notes=notes,
            )
        if allow_open_tab and authorize_live:
            # Phase-B path B: operator authorized BOTH the open and
            # the live run. Open the tab once, then re-list to confirm
            # the new tab matches the target. NEVER eval JS, NEVER
            # interact with login / captcha / Cloudflare — this is
            # /json/new + /json/list only.
            try:
                cdp_probe.open_tab(target_url)
            except default_cdp_probe.CdpUnreachableError as exc:
                return PreconditionResult(
                    ok=False,
                    failed_check="cdp_unreachable",
                    required_action=(
                        f"CDP /json/new failed at 127.0.0.1:9222 "
                        f"({exc})."
                    ),
                    notes=notes,
                )
            try:
                tabs_after = cdp_probe.list_tabs()
            except default_cdp_probe.CdpUnreachableError as exc:
                return PreconditionResult(
                    ok=False,
                    failed_check="cdp_unreachable",
                    required_action=(
                        f"CDP /json/list unreachable after open_tab "
                        f"({exc})."
                    ),
                    notes=notes,
                )
            for tab in tabs_after:
                url = str(tab.get("url") or "")
                if _matches_target(url, goods_no):
                    target_tab = tab
                    break
            if target_tab is None:
                return PreconditionResult(
                    ok=False,
                    failed_check="target_tab_open_did_not_resolve",
                    required_action=(
                        f"cdp_tab_probe.open_tab was invoked for "
                        f"goods_no={goods_no!r} but a matching tab was "
                        f"not found in the post-open /json/list response. "
                        f"Verify the attached Chrome session is responsive "
                        f"and re-run. URL: {target_url}"
                    ),
                    notes=notes,
                )
            notes.append(
                "phase B: cdp_tab_probe.open_tab invoked once; matching "
                "tab confirmed in post-open /json/list."
            )
        else:
            return PreconditionResult(
                ok=False,
                failed_check="target_tab_missing",
                required_action=(
                    f"target tab for goods_no={goods_no!r} is not open. "
                    f"Open the URL in the attached Chrome window before "
                    f"re-running. URL: {target_url}"
                ),
                notes=notes,
            )

    # ---- Check 5: target tab is on a product page --------------------
    matched_url = str(target_tab.get("url") or "")
    if _looks_off_product_page(matched_url):
        return PreconditionResult(
            ok=False,
            failed_check="target_tab_off_product_page",
            required_action=(
                f"target tab URL looks like an auth wall / captcha "
                f"({matched_url!r}). Operator must log in or pass the "
                f"human-check in the attached Chrome window, then "
                f"re-run with --goods-no {goods_no} "
                f"--sort-type {sort_type}. After the next collection "
                f"attempt lands in manual_checkpoint, clear it via: "
                f"python3 scripts/mark_brand20_checkpoint_certified.py "
                f"--goods-no {goods_no} --sort-type {sort_type} "
                f"--note '<note>'."
            ),
            notes=notes,
        )

    # ---- Check 6: queue-wide cooldown horizon + target cooldown -----
    earliest_cooling: str | None = None
    cooling_count = 0
    for it in queue.items:
        if it.status != "retry_after_cooldown":
            continue
        nra = _parse_iso(it.next_run_after)
        if nra is None:
            continue
        if nra <= now:
            continue
        cooling_count += 1
        if earliest_cooling is None or (it.next_run_after or "") < earliest_cooling:
            earliest_cooling = it.next_run_after

    if earliest_cooling is not None:
        notes.append(
            f"queue-wide cooldown: {cooling_count} row(s) still cooling; "
            f"earliest next_run_after={earliest_cooling}"
        )

    target_item = queue.find(goods_no, sort_type)
    if target_item is not None and target_item.status == "retry_after_cooldown":
        nra = _parse_iso(target_item.next_run_after)
        if nra is not None and nra > now:
            return PreconditionResult(
                ok=False,
                failed_check="target_in_cooldown",
                required_action=(
                    f"target row (goods_no={goods_no!r}, "
                    f"sort_type={sort_type!r}) is in active cooldown; "
                    f"next_run_after={target_item.next_run_after}. "
                    f"Wait for the cooldown to elapse before re-running."
                ),
                notes=notes,
            )

    if allow_open_tab and not any("open_tab invoked" in n for n in notes):
        # The tab was already present at check 4 — open_tab was not
        # called. Surface the flag-was-parsed signal so the operator
        # sees the gate respected `--allow-open-tab` without needing
        # to act on it.
        notes.append(
            "--allow-open-tab is accepted; target tab was already "
            "present, no /json/new call made."
        )

    return PreconditionResult(ok=True, failed_check=None, required_action=None, notes=notes)
