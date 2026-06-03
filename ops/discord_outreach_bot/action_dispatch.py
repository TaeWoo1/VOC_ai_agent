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


class RenderNotAuthorized(RuntimeError):
    """Raised when a live render is attempted without AGENT_RENDER_ENABLED."""


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
    if not pend:
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
