"""D4-3a: guarded execution for the yellow `render_report` pipeline action (SELF).

A pipeline-action executor parallel to agent_dispatch (which is for Claude Code
runs). It gates a deterministic local render behind: target resolution +
Python preconditions + a single explicit confirmation, then calls the EXISTING
renderer into a STAGING dir only. It never:
  - writes into the packet dir, or mutates status.json / send_log.md;
  - copies output back into a packet;
  - runs collect / send / publish;
  - modifies Phase 2E detector/aggregation/scoring or report wording.

Two steps mirror the dispatch lifecycle:
  propose_render(...) -> resolve + precondition gate -> arm a single-use action
                        pending + a plan hash. NO render.
  confirm_action(...) -> re-verify the plan hash, then run the (env-gated) live
                        renderer into staging. Default tests monkeypatch
                        `_render_fn` so NO real PDF is produced.
Live render additionally requires AGENT_RENDER_ENABLED (default off).
"""

from __future__ import annotations

import ast
import json
import os
import re
import subprocess
import sys
import time
from pathlib import Path
from typing import Any, Callable, Optional

import approval_log as _approval

_PENDING_ACTIONS: dict[str, dict[str, Any]] = {}
_PENDING_TTL_SECONDS = 600

_RENDER_ENV_FLAG = "AGENT_RENDER_ENABLED"
_REPORT_FILENAME = "analysis_report.json"
_COLLECTION_SUMMARY_FILENAME = "collection_summary.json"
_BLOCKED_MARKER = "render.blocked"
_DENY_BASENAMES = ("status.json", "send_log.md")

# The active seller renderer is the standalone PDF script (NOT seller_dashboard).
# Loaded by file path, mirroring src/voc/reporting/outbound/package.py.
_RENDERER_FUNC = "render_seller_business_report_v3"
_RENDERER_SCRIPT_REL = ("scripts", "generate_phase2e_pdf_v2.py")

# D4-3b1: collect_reviews plan/dry-run. Live collect (D4-3b2) is double-gated by
# AGENT_COLLECT_LIVE_ENABLED (infra) + an explicit per-turn authorize_live. In
# D4-3b1 there is NO live capability: the `_collect_fn` seam always raises.
_COLLECT_ENV_FLAG = "AGENT_COLLECT_LIVE_ENABLED"
_COLLECT_PRIMARY_SORT = "DATETIME_DESC"   # the only primary corpus (CLAUDE.md)
_COLLECT_PLAN_FILENAME = "collect_plan.json"
_DEFAULT_ARTIFACT_REL = ("data", "collection_artifacts")
_DEFAULT_CORPUS_DIR_REL = ("data",)
# Queue statuses that gate themselves on an explicit operator transition and so
# must NOT be collected straight from a planner intent.
_COLLECT_BLOCKED_STATUSES = ("manual_checkpoint", "running", "done", "inconclusive")
_GOODS_NO_RE = re.compile(r"^A\d{5,}$")
_URL_GOODS_RE = re.compile(r"goodsNo=([A-Za-z0-9]+)")
_NEXT_TOKENS = ("next", "다음", "다음거", "다음 거", "다음것")

# D4-3b2: live collect shells out to the EXISTING orchestrator (re-gates, builds
# the manifest, runs the collection child, INSERT OR IGNORE, applies batch_summary
# to the queue). D4-3b2 reimplements none of that — it only launches + maps.
_RUNNER_SCRIPT_REL = ("scripts", "run_brand20_queue_runner.py")
_COLLECT_TIMEOUT_S = 1800
_COLLECT_RUNS_REL = ("outputs", "agent_collect_runs")
_RUNNER_STDOUT_LOG = "runner_stdout.log"
_BATCH_SUMMARY_GLOB = "*/batch_summary.json"


class RenderNotAuthorized(RuntimeError):
    """Raised when a live render is attempted without AGENT_RENDER_ENABLED."""


class CollectNotAuthorized(RuntimeError):
    """Raised when live collect is attempted but the capability is unavailable.

    In D4-3b1 the `_collect_fn` seam ALWAYS raises this — there is no live
    collection path yet; D4-3b2 replaces the seam with a guarded subprocess to
    the brand-20 runner."""


# === pending handshake =======================================================
def reset_pending_actions() -> None:
    _PENDING_ACTIONS.clear()


def _op_key(operator_id: Optional[str]) -> str:
    return str(operator_id) if operator_id is not None else "_anon"


def get_pending_action(operator_id: Optional[str]) -> Optional[dict[str, Any]]:
    key = _op_key(operator_id)
    pend = _PENDING_ACTIONS.get(key)
    if not pend:
        return None
    if time.time() - pend.get("created_at", 0) > _PENDING_TTL_SECONDS:
        _PENDING_ACTIONS.pop(key, None)
        return None
    return pend


# back-compat internal alias
_get_pending_action = get_pending_action


def _clear_pending_action(operator_id: Optional[str]) -> None:
    _PENDING_ACTIONS.pop(_op_key(operator_id), None)


# === renderer seam (tests monkeypatch _render_fn) ============================
def _render_authorized() -> bool:
    return os.environ.get(_RENDER_ENV_FLAG, "").strip().lower() in (
        "1", "true", "yes", "on")


def _renderer_script_path() -> Path:
    """Absolute path to the standalone PDF script (repo_root/scripts/...)."""
    return Path(__file__).resolve().parents[2].joinpath(*_RENDERER_SCRIPT_REL)


def _load_json(path: Path) -> dict[str, Any]:
    """Read a JSON object. Raises ValueError if it is not a dict."""
    obj = json.loads(Path(path).read_text(encoding="utf-8"))
    if not isinstance(obj, dict):
        raise ValueError(f"{Path(path).name} is not a JSON object")
    return obj


def _load_collection_summary(packet_dir: Path) -> dict[str, Any]:
    """collection_summary.json beside analysis_report.json (or under shared/)
    if present; else {}. The renderer reads every field via `.get(...) or
    default`, so {} renders a 'no collection metadata' report. A present-but-
    malformed file raises (deterministic action_failed downstream)."""
    for cand in (packet_dir / _COLLECTION_SUMMARY_FILENAME,
                 packet_dir / "shared" / _COLLECTION_SUMMARY_FILENAME):
        if cand.is_file():
            return _load_json(cand)
    return {}


def _load_renderer() -> Callable[..., Any]:
    """Load render_seller_business_report_v3 from the standalone PDF script by
    file path (mirrors package.py:_load_pdf_renderer). The real exec_module —
    and its heavy reporting deps — happens HERE, at confirm/render time only."""
    import importlib.util
    import sys

    src = _renderer_script_path()
    spec = importlib.util.spec_from_file_location("_pdf_v2_for_agent_render", src)
    if spec is None or spec.loader is None:
        raise ImportError(f"cannot load renderer spec from {src}")
    mod = importlib.util.module_from_spec(spec)
    sys.modules["_pdf_v2_for_agent_render"] = mod
    spec.loader.exec_module(mod)
    fn = getattr(mod, _RENDERER_FUNC, None)
    if fn is None:
        raise ImportError(f"{_RENDERER_FUNC} not found in {src}")
    return fn


def _live_render(packet_dir: Path, staging_dir: Path) -> list[str]:
    """Default renderer: env-gated; calls the real seller report renderer
    keyword-only, writing ONLY into staging_dir. Tests replace this seam."""
    if not _render_authorized():
        raise RenderNotAuthorized("AGENT_RENDER_ENABLED is not set")
    analysis_report = _load_json(packet_dir / _REPORT_FILENAME)
    collection_summary = _load_collection_summary(packet_dir)
    renderer = _load_renderer()
    staging_dir.mkdir(parents=True, exist_ok=True)
    out = staging_dir / "seller_business_report_v3.pdf"
    renderer(  # keyword-only contract; writes into staging only
        analysis_report=analysis_report,
        collection_summary=collection_summary,
        out_path=out,
        run_id=packet_dir.name,
    )
    return [str(out)]


_render_fn: Callable[[Path, Path], list[str]] = _live_render


# === precondition gate =======================================================
def _plan_hash(packet_dir: Path) -> str:
    """Stable hash binding the proposal to the packet + report content."""
    report = packet_dir / _REPORT_FILENAME
    try:
        body = report.read_text(encoding="utf-8")
    except OSError:
        body = ""
    return _approval.prompt_hash(f"{packet_dir}\n{body}")


def _is_denied_output(staging_dir: Path, packet_dir: Path) -> bool:
    sd, pd = Path(staging_dir).resolve(), Path(packet_dir).resolve()
    if sd == pd or pd in sd.parents:        # never write inside the packet
        return True
    return Path(staging_dir).name in _DENY_BASENAMES


def check_render_preconditions(
    *, task_id: str, packet_dir: Path, staging_dir: Path,
) -> tuple[Optional[str], Optional[str]]:
    """Return (failed_check, required_action) or (None, None) on pass."""
    packet_dir = Path(packet_dir)
    if not task_id or not packet_dir.is_dir():
        return ("target_unresolved",
                "대상 task의 패킷/런 디렉터리를 찾지 못했습니다.")
    if not (packet_dir / _REPORT_FILENAME).is_file():
        return ("analysis_report_missing",
                "analysis_report.json이 없습니다. 먼저 분석 리포트를 생성/배치하세요.")
    if (packet_dir / _BLOCKED_MARKER).exists():
        return ("packet_blocked", "패킷이 blocked 상태입니다 (render.blocked).")
    if _render_fn is _live_render and not _renderer_importable():
        return ("renderer_unavailable", "렌더러를 불러올 수 없습니다.")
    if _is_denied_output(staging_dir, packet_dir):
        return ("output_path_denied",
                "출력 경로가 패킷/금지 경로입니다 (스테이징만 허용).")
    # writability: nearest EXISTING ancestor must be writable. We do NOT create
    # the staging dir here — propose is side-effect free; confirm creates it.
    anc = Path(staging_dir)
    while not anc.exists() and anc != anc.parent:
        anc = anc.parent
    if not os.access(anc, os.W_OK):
        return ("output_dir_unwritable", "스테이징 출력 디렉터리에 쓸 수 없습니다.")
    return (None, None)


def _renderer_importable() -> bool:
    """True iff the standalone PDF script exists AND defines the renderer
    symbol. Verified by AST scan (not a module-spec check, not a full import):
    stricter than spec-only, yet cheap and side-effect-free so the propose-time
    precondition gate never execs the heavy PDF module."""
    script = _renderer_script_path()
    try:
        tree = ast.parse(script.read_text(encoding="utf-8"))
    except (OSError, SyntaxError):
        return False
    return any(isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef))
               and n.name == _RENDERER_FUNC for n in tree.body)


# === propose / confirm =======================================================
def _reply(intent: str, text: str, *, executed: bool, **extra) -> dict[str, Any]:
    return {"intent": intent, "handled": True, "reply": text,
            "executed": executed, **extra}


def propose_render(
    operator_id: Optional[str], *, task_id: str,
    packets_root: Path, staging_root: Optional[Path] = None,
) -> dict[str, Any]:
    """Resolve + precondition-gate a render. Arms a single-use pending on pass.
    NO render happens here."""
    packets_root = Path(packets_root)
    packet_dir = packets_root / task_id
    staging_dir = Path(staging_root) if staging_root else (
        packets_root.parent / "agent_render" / task_id)

    failed, action = check_render_preconditions(
        task_id=task_id, packet_dir=packet_dir, staging_dir=staging_dir)
    if failed:
        return _reply("action_blocked",
                      f"⛔ 차단됨 (blocked)\n- failed_check: {failed}\n"
                      f"- required_action: {action}\n- (렌더 안 함)",
                      executed=False, failed_check=failed)

    _PENDING_ACTIONS[_op_key(operator_id)] = {
        "kind": "render", "task_id": task_id, "packet_dir": str(packet_dir),
        "staging_dir": str(staging_dir), "plan_hash": _plan_hash(packet_dir),
        "created_at": time.time(),
    }
    return _reply("action_propose",
                  f"🟡 render_report 준비됨 (task `{task_id}`)\n"
                  "- analysis_report.json: ✓ · 출력: 스테이징(생성물만, 패킷 미변경)\n"
                  '실행하려면 "진행해" / 취소 "취소"',
                  executed=False)


def confirm_action(
    operator_id: Optional[str], *,
    approval_log_path: Optional[Path] = None,
) -> dict[str, Any]:
    """Consume a render pending, re-verify the plan hash, run the env-gated
    renderer into staging. Single-use. No packet mutation, no copy-back."""
    pend = _get_pending_action(operator_id)
    if not pend or pend.get("kind", "render") != "render":
        return _reply("action_confirm",
                      "대기 중인 작업 제안이 없습니다.", executed=False)

    packet_dir = Path(pend["packet_dir"])
    staging_dir = Path(pend["staging_dir"])
    if _plan_hash(packet_dir) != pend["plan_hash"]:
        _clear_pending_action(operator_id)
        return _reply("action_blocked",
                      "⛔ 입력(analysis_report.json)이 제안 이후 변경되었습니다. "
                      "다시 제안해 주세요 (stale plan blocked).", executed=False,
                      failed_check="plan_hash_mismatch")

    _clear_pending_action(operator_id)  # single-use BEFORE executing
    _approval.append_record(
        _approval.make_record(
            target_slug=pend["task_id"], current_state="render_report",
            approved_stage="render_report", prompt=str(packet_dir),
            operator_discord_id=_op_key(operator_id),
            execution_mode="manual_record",
            notes=f"render to staging {staging_dir} (no packet mutation)"),
        approval_log_path)

    try:
        artifacts = _render_fn(packet_dir, staging_dir)
    except RenderNotAuthorized:
        return _reply("action_blocked",
                      "⛔ 라이브 렌더가 승인되지 않았습니다 "
                      f"({_RENDER_ENV_FLAG} 미설정).", executed=False,
                      failed_check="render_not_authorized")
    except Exception as exc:  # noqa: BLE001 - report any pipeline failure
        return _reply("action_failed",
                      f"⚠ 렌더 실패: {exc.__class__.__name__}", executed=False)

    lines = ["✅ render 완료 (스테이징, 패킷 미변경)"]
    lines += [f"- 산출물: `{a}`" for a in artifacts]
    return _reply("action_done", "\n".join(lines), executed=True,
                  artifacts=artifacts)


# === D4-3b1: collect_reviews plan / dry-run ==================================
def _repo_root() -> Path:
    """repo_root = parents[2] of ops/discord_outreach_bot/action_dispatch.py."""
    return Path(__file__).resolve().parents[2]


def _collect_live_enabled() -> bool:
    return os.environ.get(_COLLECT_ENV_FLAG, "").strip().lower() in (
        "1", "true", "yes", "on")


def _path_writable(path: Path) -> bool:
    """Walk to the nearest existing ancestor and check write access. We do NOT
    create anything here — resolution/gating must be side-effect-free."""
    anc = Path(path)
    while not anc.exists() and anc != anc.parent:
        anc = anc.parent
    return os.access(anc, os.W_OK)


def _build_product_url(goods_no: str) -> str:
    """The canonical OY review-tab URL the runner would target. Read-only; this
    only describes the plan — it never opens a tab."""
    return (
        "https://www.oliveyoung.co.kr/store/goods/getGoodsDetail.do"
        f"?goodsNo={goods_no}&tab=review")


def _resolve_collect_target(
    target: Optional[str], *, queue: Any, now: Any,
    sort_type: Optional[str] = None,
) -> Optional[tuple[str, str]]:
    """Read-only resolution of an operator target string to (goods_no, sort_type).

    Order: product URL (goodsNo=) -> explicit goodsNo (A#####...) -> "next"/"다음"
    via pick_next_runnable. NEVER opens a tab, never mutates. Returns None when
    unresolvable (e.g. a bare task_id) so the caller reports target_unresolved.
    """
    sort_type = sort_type or _COLLECT_PRIMARY_SORT
    if not isinstance(target, str) or not target.strip():
        return None
    t = target.strip()
    m = _URL_GOODS_RE.search(t)
    if m:
        return (m.group(1), sort_type)
    if _GOODS_NO_RE.match(t):
        return (t, sort_type)
    if t.lower() in _NEXT_TOKENS:
        from src.voc.app.brand20_runner_core import pick_next_runnable
        try:
            item = pick_next_runnable(queue, now=now)
        except Exception:
            return None
        return (item.goods_no, item.sort_type)
    return None


def _collect_plan_hash(
    queue: Any, goods_no: str, sort_type: str, head_baseline: Optional[str],
) -> str:
    """Bind the proposal to (goods_no, sort_type, HEAD, queue-row snapshot) so a
    confirm after the row advances (another run, a status change) blocks."""
    item = queue.find(goods_no, sort_type) if queue is not None else None
    row = item.model_dump_json() if item is not None else ""
    return _approval.prompt_hash(
        f"{goods_no}\n{sort_type}\n{head_baseline}\n{row}")


def check_collect_preconditions(
    *, goods_no: str, sort_type: str, queue: Any, repo_root: Path,
    head_baseline: Optional[str] = None, now: Any = None,
    cdp_probe: Any = None, pgrep_runner: Any = None, git_head_runner: Any = None,
    corpus_dir: Optional[Path] = None, artifact_root: Optional[Path] = None,
) -> tuple[Optional[str], Optional[str]]:
    """D4-3b-owned gates, then delegate site/CDP/tab/cooldown to the existing
    evaluate_preconditions (allow_open_tab=False, authorize_live=False). Returns
    (failed_check, required_action) or (None, None)."""
    item = queue.find(goods_no, sort_type) if queue is not None else None
    if item is None:
        return ("goods_no_not_in_queue",
                f"큐에 (goods_no={goods_no}, sort_type={sort_type}) 행이 없습니다. "
                "먼저 큐에 추가하세요.")
    if item.status in _COLLECT_BLOCKED_STATUSES:
        return ("candidate_not_approved",
                f"행 상태가 `{item.status}` 라 수집 대상이 아닙니다 "
                "(명시적 운영 전환 필요).")

    corpus_dir = Path(corpus_dir) if corpus_dir else repo_root.joinpath(
        *_DEFAULT_CORPUS_DIR_REL)
    if not _path_writable(corpus_dir):
        return ("corpus_db_unwritable",
                "리뷰 코퍼스 DB 디렉터리에 쓸 수 없습니다.")
    artifact_root = Path(artifact_root) if artifact_root else repo_root.joinpath(
        *_DEFAULT_ARTIFACT_REL)
    if not _path_writable(artifact_root):
        return ("artifact_root_unwritable",
                "수집 아티팩트 디렉터리에 쓸 수 없습니다.")

    from datetime import datetime, timezone

    from src.voc.app.brand20_runner_precondition import evaluate_preconditions
    res = evaluate_preconditions(
        queue, goods_no=goods_no, sort_type=sort_type,
        now=now or datetime.now(timezone.utc),
        allow_open_tab=False, authorize_live=False, head_baseline=head_baseline,
        cdp_probe=cdp_probe, pgrep_runner=pgrep_runner,
        git_head_runner=git_head_runner)
    if not res.ok:
        return (res.failed_check, res.required_action)
    return (None, None)


def _parse_runner_failed_check(stdout: str) -> tuple[Optional[str], Optional[str]]:
    """Pull the runner's two-line failed_check / required_action block."""
    fc = ra = None
    for line in (stdout or "").splitlines():
        s = line.strip()
        if s.startswith("failed_check:") and fc is None:
            fc = s.split(":", 1)[1].strip() or None
        elif s.startswith("required_action:") and ra is None:
            ra = s.split(":", 1)[1].strip() or None
    return fc, ra


def _map_collect_outcome(
    batch_summary: Optional[dict[str, Any]], *, exit_code: Optional[int], stdout: str,
) -> dict[str, Any]:
    """PURE: classify a runner result into one operator-facing outcome.

    Precedence: manual_review -> rate_limited -> partial -> done -> blocked
    (exit 2 + failed_check, only when NO summary) -> failed. The exit code is
    NEVER trusted over a present batch_summary (auth-wall halts exit 1 but still
    write a summary). cursor 429 is FIRST-CLASS rate_limited, not failure."""
    if batch_summary is None:
        if exit_code == 2 and "failed_check:" in (stdout or ""):
            fc, ra = _parse_runner_failed_check(stdout)
            return {"outcome": "collect_blocked", "executed": False,
                    "failed_check": fc or "runner_precondition_failed",
                    "required_action": ra}
        return {"outcome": "collect_failed", "executed": False,
                "detail": f"no batch_summary (exit={exit_code})"}

    products = batch_summary.get("products") or []
    p0 = products[0] if products else {}
    summary = p0.get("summary") or {}
    status = str(p0.get("status") or "").lower()
    retry_intent = summary.get("retry_intent") or p0.get("retry_intent")
    rows = p0.get("rows_inserted")
    review_count = (summary.get("review_count_analyzed")
                    or p0.get("records_parsed"))

    # 1) manual review (auth wall / human check)
    if retry_intent == "manual_review_required" or status in (
            "anti_bot", "auth_expired_mid_batch"):
        return {"outcome": "collect_manual_review", "executed": True,
                "rows_inserted": rows, "status": status}
    # 2) rate limited (cursor 429 / silenced) — first-class, no DOM recovery
    if (summary.get("cursor_api_rate_limited") or summary.get("http_429_seen")
            or summary.get("cursor_api_silenced")
            or retry_intent == "retry_after_cooldown"):
        return {"outcome": "collect_rate_limited", "executed": True,
                "retry_intent": "retry_after_cooldown", "retry_after_minutes": 90,
                "rows_inserted": rows}
    # 3) partial
    if (batch_summary.get("partial_success") or summary.get("partial_success")
            or (status == "max_cap_reached"
                and not p0.get("pagination_exhausted", False))):
        return {"outcome": "collect_partial", "executed": True,
                "rows_inserted": rows, "status": status}
    # 4) done
    if status in ("complete", "ok"):
        return {"outcome": "collect_done", "executed": True,
                "rows_inserted": rows, "review_count": review_count,
                "duplicate_count": p0.get("duplicate_count")}
    # 5) anything else
    return {"outcome": "collect_failed", "executed": False,
            "detail": f"status={status!r} exit={exit_code}"}


def _collect_interpreter() -> str:
    return sys.executable


def _locate_batch_summary(artifact_root: Path) -> Optional[Path]:
    """The runner writes exactly one <batch_id>/batch_summary.json under a fresh
    artifact_root. Return it (newest if several), else None."""
    hits = sorted(Path(artifact_root).glob(_BATCH_SUMMARY_GLOB),
                  key=lambda p: p.stat().st_mtime if p.exists() else 0)
    return hits[-1] if hits else None


def _killpg(proc: Any) -> None:
    import signal
    try:
        os.killpg(os.getpgid(proc.pid), signal.SIGTERM)
    except Exception:  # noqa: BLE001
        pass
    try:
        proc.kill()
    except Exception:  # noqa: BLE001
        pass


# narrow subprocess seam (tests monkeypatch _COLLECT_POPEN)
_COLLECT_POPEN = subprocess.Popen


def _live_collect(goods_no: str, sort_type: str, authorize_live: bool) -> dict[str, Any]:
    """D4-3b2: launch the EXISTING runner (re-gates + collects + routes the queue),
    capture stdout, locate batch_summary.json, map the outcome. The caller has
    already verified the two-key gate. Writes ONLY into a fresh artifact_root;
    queue/DB mutations happen inside the runner and are acknowledged in the card.

    NEVER passes --allow-open-tab / --dry-run / --check. shell=False, group-kill
    on timeout, DATETIME_DESC-or-given primary sort, --max-items-per-session 1."""
    repo_root = _repo_root()
    run_tag = (f"{goods_no}__{sort_type}__"
               f"{time.strftime('%Y%m%dT%H%M%SZ', time.gmtime())}_{os.getpid()}")
    artifact_root = repo_root.joinpath(*_COLLECT_RUNS_REL) / run_tag
    artifact_root.mkdir(parents=True, exist_ok=True)
    argv = [
        _collect_interpreter(),
        str(repo_root.joinpath(*_RUNNER_SCRIPT_REL)),
        "--goods-no", goods_no,
        "--sort-type", sort_type,
        "--i-authorize-live-collection",
        "--artifact-root", str(artifact_root),
        "--max-items-per-session", "1",
    ]
    log_path = artifact_root / _RUNNER_STDOUT_LOG
    proc = _COLLECT_POPEN(
        argv, cwd=str(repo_root), shell=False,
        stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
        start_new_session=True, text=True, env=dict(os.environ))
    try:
        out, _err = proc.communicate(timeout=_COLLECT_TIMEOUT_S)
        exit_code = proc.returncode
    except subprocess.TimeoutExpired:
        _killpg(proc)
        try:
            out, _err = proc.communicate(timeout=10)
        except Exception:  # noqa: BLE001
            out = ""
        log_path.write_text((out or "") + "\n[timeout: group-killed]\n",
                            encoding="utf-8")
        return {"outcome": "collect_failed", "executed": False,
                "detail": f"timeout {_COLLECT_TIMEOUT_S}s (group-killed)",
                "artifact_root": str(artifact_root)}

    log_path.write_text(out or "", encoding="utf-8")
    bs_path = _locate_batch_summary(artifact_root)
    summary: Optional[dict[str, Any]] = None
    if bs_path is not None:
        try:
            summary = json.loads(bs_path.read_text(encoding="utf-8"))
        except Exception:  # noqa: BLE001
            summary = None
    result = _map_collect_outcome(summary, exit_code=exit_code, stdout=out or "")
    result["artifact_root"] = str(artifact_root)
    if bs_path is not None:
        result["batch_summary_path"] = str(bs_path)
    return result


_collect_fn: Callable[[str, str, bool], dict[str, Any]] = _live_collect


def propose_collect(
    operator_id: Optional[str], *, target: Optional[str], queue_path: Path,
    staging_root: Path, repo_root: Optional[Path] = None,
    head_baseline: Optional[str] = None, sort_type: Optional[str] = None,
    now: Any = None, cdp_probe: Any = None, pgrep_runner: Any = None,
    git_head_runner: Any = None, corpus_dir: Optional[Path] = None,
    artifact_root: Optional[Path] = None,
) -> dict[str, Any]:
    """Resolve target + gate (reusing evaluate_preconditions). On pass: arm a
    single-use collect pending and write a staging collect_plan.json. NO live
    collection, NO subprocess, NO CDP tab, NO DB/queue write."""
    from datetime import datetime, timezone

    now = now or datetime.now(timezone.utc)
    repo_root = Path(repo_root) if repo_root else _repo_root()

    try:
        from src.voc.app.brand20_queue import load_queue
        queue = load_queue(queue_path)
    except Exception:
        return _reply("action_blocked",
                      "⛔ 차단됨 (blocked)\n- failed_check: queue_unreadable\n"
                      "- required_action: 큐 파일을 읽을 수 없습니다.\n- (수집 안 함)",
                      executed=False, failed_check="queue_unreadable")

    resolved = _resolve_collect_target(target, queue=queue, now=now,
                                       sort_type=sort_type)
    if resolved is None:
        return _reply("action_blocked",
                      "⛔ 차단됨 (blocked)\n- failed_check: target_unresolved\n"
                      "- required_action: goodsNo / 상품 URL / \"다음\" 중 하나로 "
                      "대상을 지정하세요.\n- (수집 안 함)",
                      executed=False, failed_check="target_unresolved")
    goods_no, sort_t = resolved

    failed, action = check_collect_preconditions(
        goods_no=goods_no, sort_type=sort_t, queue=queue, repo_root=repo_root,
        head_baseline=head_baseline, now=now, cdp_probe=cdp_probe,
        pgrep_runner=pgrep_runner, git_head_runner=git_head_runner,
        corpus_dir=corpus_dir, artifact_root=artifact_root)
    if failed:
        return _reply("action_blocked",
                      f"⛔ 차단됨 (blocked)\n- failed_check: {failed}\n"
                      f"- required_action: {action}\n- (수집 안 함)",
                      executed=False, failed_check=failed)

    # dry-run writes ONLY this staging plan (no DB/queue/tab).
    staging_dir = Path(staging_root)
    staging_dir.mkdir(parents=True, exist_ok=True)
    plan_path = staging_dir / _COLLECT_PLAN_FILENAME
    would_run_argv = [
        "scripts/run_brand20_queue_runner.py",
        "--goods-no", goods_no, "--sort-type", sort_t,
        "--i-authorize-live-collection",
    ]
    plan = {
        "kind": "collect_plan", "mode": "dry_run",
        "goods_no": goods_no, "sort_type": sort_t,
        "product_url": _build_product_url(goods_no),
        "preconditions": "ok", "would_run_argv": would_run_argv,
        "live_collect_enabled": False,
        "note": ("plan/dry-run only — no collection performed. Live collect is "
                 "D4-3b2 and requires AGENT_COLLECT_LIVE_ENABLED + per-turn "
                 "authorization."),
    }
    plan_path.write_text(json.dumps(plan, ensure_ascii=False, indent=2),
                         encoding="utf-8")

    _PENDING_ACTIONS[_op_key(operator_id)] = {
        "kind": "collect", "goods_no": goods_no, "sort_type": sort_t,
        "queue_path": str(queue_path), "head_baseline": head_baseline,
        "plan_path": str(plan_path),
        "plan_hash": _collect_plan_hash(queue, goods_no, sort_t, head_baseline),
        "created_at": time.time(),
    }
    return _reply("action_propose",
                  f"🟡 collect_reviews 준비됨 (plan / dry-run)\n"
                  f"- target: `{goods_no}` · sort: `{sort_t}` (primary)\n"
                  "- preconditions: ✓ · 출력: 스테이징 plan만 (수집 안 함)\n"
                  f"- plan: `{plan_path.name}`\n"
                  "라이브 수집은 명시 승인 필요 (D4-3b2 예정).",
                  executed=False)


def confirm_collect(
    operator_id: Optional[str], *, authorize_live: bool = False,
    approval_log_path: Optional[Path] = None,
) -> dict[str, Any]:
    """Consume a collect pending, re-verify the plan hash, then HARD-BLOCK.

    D4-3b1 has no live capability: even with the two-key gate satisfied, the
    `_collect_fn` seam raises -> collect_live_not_enabled. Without the gate ->
    collect_not_authorized. NO subprocess, NO DB/queue write, NO CDP tab."""
    pend = _get_pending_action(operator_id)
    if not pend or pend.get("kind") != "collect":
        return _reply("action_confirm",
                      "대기 중인 수집 제안이 없습니다.", executed=False)

    try:
        from src.voc.app.brand20_queue import load_queue
        queue = load_queue(pend["queue_path"])
    except Exception:
        queue = None
    current = (_collect_plan_hash(queue, pend["goods_no"], pend["sort_type"],
                                  pend.get("head_baseline"))
               if queue is not None else None)
    if current != pend["plan_hash"]:
        _clear_pending_action(operator_id)
        return _reply("action_blocked",
                      "⛔ 큐 상태가 제안 이후 변경되었습니다. 다시 제안해 주세요 "
                      "(stale plan blocked).", executed=False,
                      failed_check="plan_hash_mismatch")

    _clear_pending_action(operator_id)  # single-use BEFORE any execution attempt

    goods_no, sort_t = pend["goods_no"], pend["sort_type"]

    # Two-key gate. `authorize_live` is set ONLY by the distinct deterministic
    # phrase "라이브 수집 승인"; the planner / generic "진행해" path passes False, so
    # broad NL can never live-collect.
    if not (_collect_live_enabled() and authorize_live):
        return _reply("action_blocked",
                      "⛔ 라이브 수집이 승인되지 않았습니다 "
                      f"({_COLLECT_ENV_FLAG} + 명시 per-turn 승인 필요).",
                      executed=False, failed_check="collect_not_authorized")

    # Audit BEFORE launch. Queue/DB mutations are runner-owned (acknowledged below).
    _approval.append_record(
        _approval.make_record(
            target_slug=goods_no, current_state="collect_reviews",
            approved_stage="live_collect",
            prompt=(f"run_brand20_queue_runner --goods-no {goods_no} "
                    f"--sort-type {sort_t} --i-authorize-live-collection"),
            operator_discord_id=_op_key(operator_id),
            execution_mode="local_run",
            notes="live OY collect via runner subprocess; queue/DB owned by runner"),
        approval_log_path)

    try:
        res = _collect_fn(goods_no, sort_t, authorize_live)
    except CollectNotAuthorized:
        # defensive: a seam that declines (e.g. capability removed) is not a run.
        return _reply("action_blocked",
                      "⛔ 라이브 수집 경로가 구성되지 않았습니다.",
                      executed=False, failed_check="collect_live_not_enabled")
    except Exception as exc:  # noqa: BLE001 - report any launch/parse failure
        return _reply("action_failed",
                      f"⚠ 수집 실패: {exc.__class__.__name__}", executed=False)

    return _format_collect_card(res, goods_no=goods_no, sort_type=sort_t)


def _collect_artifacts(res: dict[str, Any]) -> dict[str, Any]:
    extra = {}
    for k in ("artifact_root", "batch_summary_path"):
        if res.get(k):
            extra[k] = res[k]
    return extra


def _format_collect_card(
    res: dict[str, Any], *, goods_no: str, sort_type: str,
) -> dict[str, Any]:
    """Map a `_map_collect_outcome` result to a Discord card. No auto-render,
    no send/publish — a done card explicitly defers the next step."""
    outcome = res.get("outcome")
    tail = _collect_artifacts(res)
    g, s = goods_no, sort_type
    if outcome == "collect_done":
        return _reply("collect_done",
                      f"✅ 수집 완료 (collect_done)\n- {g} / {s} · rows_inserted: "
                      f"{res.get('rows_inserted')} · 분석가능: {res.get('review_count')}"
                      f" · 중복: {res.get('duplicate_count')}\n"
                      "- 큐/DB는 러너가 갱신 (acknowledged). 분석/렌더는 자동 실행 안 함.",
                      executed=True, **tail)
    if outcome == "collect_rate_limited":
        return _reply("collect_rate_limited",
                      "🟠 레이트리밋 (collect_rate_limited) — 실패 아님\n"
                      f"- cursor 429 관측. 부분 수집 보존 (rows_inserted: "
                      f"{res.get('rows_inserted')}).\n- retry_intent: "
                      f"{res.get('retry_intent')} · retry_after_minutes: "
                      f"{res.get('retry_after_minutes')} · DOM 복구 안 함.\n"
                      '- ~90분 뒤 다시 제안 + "라이브 수집 승인"으로 재개 (INSERT OR IGNORE).',
                      executed=True, retry_intent=res.get("retry_intent"),
                      retry_after_minutes=res.get("retry_after_minutes"), **tail)
    if outcome == "collect_manual_review":
        return _reply("collect_manual_review",
                      "🔵 수동 확인 필요 (collect_manual_review)\n"
                      "- auth wall / 403 → manual_review_required. 큐: manual_checkpoint.\n"
                      "- Chrome에서 로그인/휴먼체크 후 mark_brand20_checkpoint_certified로 해제.",
                      executed=True, **tail)
    if outcome == "collect_partial":
        return _reply("collect_partial",
                      f"🟡 부분 수집 (collect_partial)\n- {g} / {s} · rows_inserted: "
                      f"{res.get('rows_inserted')}\n- 재실행 시 이어서 수집됩니다 (idempotent).",
                      executed=True, **tail)
    if outcome == "collect_blocked":
        return _reply("action_blocked",
                      f"⛔ 차단됨 (collect_blocked)\n- failed_check: "
                      f"{res.get('failed_check')}\n- required_action: "
                      f"{res.get('required_action')}\n- (수집 미완료)",
                      executed=False, failed_check=res.get("failed_check"), **tail)
    # collect_failed / unknown
    return _reply("action_failed",
                  f"⚠ 수집 실패 (collect_failed)\n- {res.get('detail')}",
                  executed=False, **tail)
