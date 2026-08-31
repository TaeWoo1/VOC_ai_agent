import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useAgentPanel } from "../../lib/agentPanel";
import { agentRuntime } from "../../lib/agentRuntime/agentClient";
import { useConversation } from "../../lib/conversation/ConversationProvider";
import { ConversationWorkspace } from "../conversation/ConversationWorkspace";

/**
 * The contextual Agent panel (docs/reviewnary_design.md §8-A) — since Agentic Operating Workspace v2
 * the SAME conversation as the home, beside the workspace.
 *
 * <b>The workspace stays primary.</b> 400px on the right, closed by default, opened by a launcher that
 * names the object in view. Below 1440px it overlays the page without a backdrop; at ≥1440px it can be
 * pinned and sits in the flow. No resize handle: one width, two modes.
 *
 * <b>What it knows, it was told.</b> The header shows the page's registered surface; a send carries
 * the surface's ids as structured hints the runtime verifies. The launcher lands no sentence — the
 * box is empty and the placeholder names the object.
 *
 * <b>Nothing here sends, approves or resumes a marketplace action.</b> The runtime has no WRITE tool,
 * and this module imports nothing that can reach one (`agentPanelWriteFence.test.ts`).
 */
const WIDE_QUERY = "(min-width: 1440px)";

function canMatchMedia(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function";
}

function useWide(): boolean {
  const [wide, setWide] = useState(() => (canMatchMedia() ? window.matchMedia(WIDE_QUERY).matches : false));
  useEffect(() => {
    if (!canMatchMedia()) return;
    const mq = window.matchMedia(WIDE_QUERY);
    const onChange = () => setWide(mq.matches);
    mq.addEventListener?.("change", onChange);
    return () => mq.removeEventListener?.("change", onChange);
  }, []);
  return wide;
}

/** Where a pinned panel sits: in the flow next to the page. Rendered by the shell, not fixed. */
export function AgentPanelDock() {
  const panel = useAgentPanel();
  const wide = useWide();
  if (!panel || !panel.open) return null;
  const docked = panel.pinned && wide;
  return (
    <aside
      role="complementary"
      aria-label="AI 담당자"
      data-testid="agent-panel"
      data-mode={docked ? "docked" : "overlay"}
      className={
        docked
          ? "hidden w-[400px] shrink-0 flex-col border-l border-line bg-surface md:flex"
          : "fixed inset-y-0 right-0 z-40 flex w-full max-w-[400px] flex-col border-l border-line bg-surface shadow-card"
      }
    >
      <AgentPanelBody canPin={wide} />
    </aside>
  );
}

function AgentPanelBody({ canPin }: { canPin: boolean }) {
  const panel = useAgentPanel()!;
  const { surface, request, closePanel, pinned, togglePinned } = panel;
  const conversation = useConversation();
  const [runtimeDown, setRuntimeDown] = useState(false);
  const [initialText, setInitialText] = useState("");
  const handledSeq = useRef(0);

  // The runtime is asked once per open. A box that cannot work says so while it is still empty.
  useEffect(() => {
    let live = true;
    agentRuntime
      .capabilities()
      .then(() => live && setRuntimeDown(false))
      .catch(() => live && setRuntimeDown(true));
    return () => {
      live = false;
    };
  }, []);

  // A request from a launcher carries no sentence; the box is empty and focused. A sentence the seller
  // already pressed send on elsewhere (`autorun`) is sent as their turn.
  useEffect(() => {
    if (!request || request.seq === handledSeq.current) return;
    handledSeq.current = request.seq;
    const sentence = request.context.goal ?? "";
    if (request.autorun && sentence.trim() && conversation) {
      setInitialText("");
      void conversation.send(sentence, {
        ...(request.context.productId ? { productId: request.context.productId } : {}),
        ...(request.context.workItemId ? { workItemId: request.context.workItemId } : {}),
        ...(request.context.surface ? { surface: request.context.surface } : {}),
      }, "panel");
    } else {
      setInitialText(sentence);
    }
  }, [request, conversation]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") closePanel();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [closePanel]);

  return (
    <>
      <header className="flex items-center gap-2 border-b border-line px-4 py-3">
        <span aria-hidden="true" className="text-brand-700">✳︎</span>
        <div className="min-w-0 flex-1">
          <p className="text-base font-semibold text-ink">AI 담당자</p>
          <p className="truncate text-sm text-muted" data-testid="agent-panel-context">
            {surface ? surface.label : "화면 전체"}
          </p>
        </div>
        {canPin ? (
          <button
            type="button"
            onClick={togglePinned}
            aria-pressed={pinned}
            aria-label={pinned ? "고정 해제" : "옆에 고정"}
            title={pinned ? "고정 해제" : "옆에 고정"}
            className={`rounded-md p-1.5 transition focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-700 ${pinned ? "bg-canvas text-ink" : "text-muted hover:bg-canvas hover:text-ink"}`}
          >
            <svg viewBox="0 0 20 20" aria-hidden="true" className="h-4 w-4">
              <path d="M8 3h4l-.5 4 2.5 3v1H6v-1l2.5-3zM10 11v6" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" />
            </svg>
          </button>
        ) : null}
        <button
          type="button"
          onClick={closePanel}
          aria-label="AI 담당자 닫기"
          className="rounded-md p-1.5 text-muted transition hover:bg-canvas hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-700"
        >
          <svg viewBox="0 0 20 20" aria-hidden="true" className="h-4 w-4">
            <path d="M5 5l10 10M15 5 5 15" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
        </button>
      </header>

      {conversation ? (
        <ConversationWorkspace
          surface="panel"
          compact
          autoFocus
          initialText={initialText}
          disabled={runtimeDown}
          disabledReason={
            runtimeDown ? (
              <p className="mb-2 rounded-lg border border-warn/40 bg-warn/10 px-3 py-2 text-sm text-warn" role="status">
                AI 담당자 서비스에 연결하지 못했습니다. 채널 연결과는 관계없는 문제입니다.
              </p>
            ) : null
          }
        />
      ) : (
        <p className="px-4 py-4 text-sm text-muted">대화는 앱 화면 안에서 이어집니다.</p>
      )}

      {/* 전체 화면 = the home conversation — the SAME thread this panel renders, at full width. It
          pointed at the legacy /agent page, which embedded a second copy of this conversation under a
          legacy form (Conversation Core v1 audit: the dead 「전체 화면」 defect). */}
      <footer className="border-t border-line px-4 py-2 text-xs text-muted">
        확인만 합니다 · 보내는 일은 승인 뒤에 ·{" "}
        <Link to="/" className="font-medium text-ink hover:underline">전체 화면</Link>
      </footer>
    </>
  );
}
