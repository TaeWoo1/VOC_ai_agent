import { useRef } from "react";
import { useProjection } from "../../hooks/useProjection";
import type { ProjectionInput } from "../../lib/bridge/projectionProtocol";

/**
 * Browser Projection V0 surface (slice §F). Renders the live projected page as binary JPEG frames (no iframe,
 * no Electron), relays only reviewed pointer/scroll/keyboard input while this tab holds control, and shows a
 * persistent local-only indicator + a distinct control-owner indicator. Seller-facing language; no red
 * recording dot, no Guided-Connection steps/coach marks, no raw URL/title, no download/screenshot control.
 *
 * Desktop-only. Mounted behind `VITE_ENABLE_AGENT_PROJECTION`. Exact visual styling stays within the app's
 * design system (card / btn-* / text-* / bg-* tokens).
 */
export function ProjectionView() {
  const { state, frameUrl, onImageLoad, requestControl, releaseControl, requestTargetSwitch, retry, sendInput } = useProjection();
  const surfaceRef = useRef<HTMLDivElement | null>(null);
  const controlling = state.control === "owned" && state.phase === "active";

  const norm = (e: { clientX: number; clientY: number }): { x: number; y: number } | null => {
    const el = surfaceRef.current;
    if (!el) return null;
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return null;
    const x = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    const y = Math.min(1, Math.max(0, (e.clientY - r.top) / r.height));
    return { x, y };
  };
  const relay = (input: ProjectionInput) => { if (controlling) sendInput(input); };

  return (
    <section className="card p-5" aria-label="브라우저 화면 보기">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-lg font-semibold text-ink">브라우저 화면 보기</h2>
        <div className="flex items-center gap-2">
          <LocalOnlyBadge />
          <ControlBadge control={state.control} controlling={controlling} />
        </div>
      </div>

      {STATUS_MESSAGE[state.phase] && <p className="mb-3 text-muted">{STATUS_MESSAGE[state.phase]}</p>}

      {state.phase === "desktop_only" && (
        <p className="text-muted">브라우저 화면 보기는 SellerOps 도우미가 실행 중인 <strong className="text-ink">컴퓨터</strong>에서 사용해 주세요.</p>
      )}
      {(state.phase === "unreachable" || state.phase === "unavailable" || state.phase === "disconnected" || state.phase === "target_closed") && (
        <button className="btn-ghost mt-1" onClick={retry}>다시 시도</button>
      )}

      {(state.phase === "active" || state.phase === "paused" || state.phase === "starting") && (
        <div className="space-y-3">
          <div
            ref={surfaceRef}
            className="relative w-full overflow-hidden rounded-xl bg-canvas"
            style={{ aspectRatio: "16 / 9", cursor: controlling ? "crosshair" : "default" }}
            tabIndex={controlling ? 0 : -1}
            role="application"
            aria-label="투사된 브라우저 화면 (로컬 전용)"
            onPointerMove={(e) => { const p = norm(e); if (p) relay({ kind: "pointer_move", x: p.x, y: p.y }); }}
            onPointerDown={(e) => { const p = norm(e); if (p) relay({ kind: "pointer_down", x: p.x, y: p.y, button: "left" }); }}
            onPointerUp={(e) => { const p = norm(e); if (p) relay({ kind: "pointer_up", x: p.x, y: p.y, button: "left" }); }}
            onWheel={(e) => { const p = norm(e); if (p) relay({ kind: "wheel", x: p.x, y: p.y, dy: e.deltaY, dx: e.deltaX }); }}
            onKeyDown={(e) => { if (controlling) { e.preventDefault(); relay({ kind: "key_down", key: e.key, code: e.code }); } }}
            onKeyUp={(e) => { if (controlling) { e.preventDefault(); relay({ kind: "key_up", key: e.key, code: e.code }); } }}
            onContextMenu={(e) => e.preventDefault()}
          >
            {frameUrl ? (
              <img src={frameUrl} onLoad={onImageLoad} alt="" draggable={false} className="pointer-events-none h-full w-full object-contain" />
            ) : (
              <div className="flex h-full items-center justify-center text-muted">화면을 불러오는 중…</div>
            )}
            {state.phase === "paused" && <div className="absolute inset-0 flex items-center justify-center bg-canvas/70 text-muted">일시 중지됨</div>}
          </div>

          <div className="flex items-center justify-between">
            <ControlActions control={state.control} onRequest={requestControl} onRelease={releaseControl} />
            {state.targetState === "popup_available" && (
              <button className="btn-ghost" onClick={requestTargetSwitch}>새로 열린 창으로 전환</button>
            )}
          </div>

          <p className="text-xs text-muted">
            이 화면과 입력은 <strong className="text-ink">내 PC 안에서만</strong> 처리되며 저장·전송되지 않습니다.
          </p>
        </div>
      )}
    </section>
  );
}

const STATUS_MESSAGE: Partial<Record<string, string>> = {
  connecting: "연결하는 중…",
  unreachable: "SellerOps 도우미에 연결하지 못했습니다.",
  unpaired: "먼저 내 PC와 연결(페어링)해 주세요.",
  unavailable: "지금은 보여줄 브라우저 화면이 없습니다.",
  starting: "화면을 준비하는 중…",
  disconnected: "연결이 끊어졌습니다. 다시 연결하는 중…",
  target_closed: "브라우저 창이 닫혔습니다.",
  incompatible: "버전이 호환되지 않습니다. 업데이트해 주세요.",
  revoked: "연결이 해제되었습니다. 다시 연결해 주세요.",
};

function LocalOnlyBadge() {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-good/15 px-2 py-0.5 text-xs font-medium text-good" title="이 화면은 내 PC 안에서만 처리됩니다">
      <span className="inline-block h-2 w-2 rounded-full bg-good" aria-hidden="true" />
      로컬 전용
    </span>
  );
}

function ControlBadge({ control, controlling }: { control: string; controlling: boolean }) {
  if (controlling) return <span className="rounded-full bg-warn/15 px-2 py-0.5 text-xs font-medium text-warn">이 탭이 조작 중</span>;
  if (control === "held_by_other") return <span className="rounded-full bg-muted/15 px-2 py-0.5 text-xs font-medium text-muted">다른 탭이 조작 중</span>;
  return <span className="rounded-full bg-muted/15 px-2 py-0.5 text-xs font-medium text-muted">보기 전용</span>;
}

function ControlActions({ control, onRequest, onRelease }: { control: string; onRequest: () => void; onRelease: () => void }) {
  if (control === "owned") return <button className="btn-ghost" onClick={onRelease}>조작 종료</button>;
  if (control === "held_by_other") return <span className="text-sm text-muted">다른 탭이 조작 중입니다.</span>;
  if (control === "requesting") return <span className="text-sm text-muted">조작 권한 요청 중…</span>;
  return <button className="btn-primary" onClick={onRequest}>이 화면 조작하기</button>;
}
