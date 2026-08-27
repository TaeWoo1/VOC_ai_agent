import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { OperatorAnswerView } from "./OperatorAnswerView";
import { Btn } from "../ui/Btn";
import { useAgentPanel, type AgentSurface } from "../../lib/agentPanel";
import type { AgentContext } from "../../lib/agentContext";
import { agentRuntime } from "../../lib/agentRuntime/agentClient";
import { explainAgentError } from "../../lib/agentRuntime/explain";
import { asksToSend, SEND_FENCE_COPY } from "../../lib/agentSendFence";
import type { AgentRunView } from "../../lib/agentRuntime/types";

/**
 * The contextual Agent panel (docs/reviewnary_design.md §8-A).
 *
 * <b>The workspace stays primary.</b> 400px on the right, closed by default, opened by a launcher that
 * names the object in view. Below 1440px it overlays the page without a backdrop — the list the seller
 * was reading is still there to the left; at ≥1440px it can be pinned, and then it sits in the flow
 * and the page keeps its own scroll. No resize handle: one width, two modes.
 *
 * <b>What it knows, it was told.</b> The header shows the page's registered surface (「이 상품 ·
 * …」); the run carries `productId` as a structured hint the runtime verifies. The panel never appends
 * context to the sentence.
 *
 * <b>What it cannot do, it says before the wait.</b> A sentence that asks to send gets the approval
 * boundary printed under the box; the runtime has no WRITE tool, and nothing in this module imports
 * one (`agentPanelWriteFence.test.tsx`).
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

function surfaceLabel(surface: AgentSurface | null): string {
  return surface?.label ?? "전체";
}

function AgentPanelBody({ canPin }: { canPin: boolean }) {
  const panel = useAgentPanel()!;
  const { surface, request, closePanel, pinned, togglePinned } = panel;
  const [text, setText] = useState("");
  const [run, setRun] = useState<AgentRunView | null>(null);
  const [askedOn, setAskedOn] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [runtimeDown, setRuntimeDown] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
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

  useEffect(() => {
    if (!busy) {
      setElapsed(0);
      return;
    }
    const started = Date.now();
    const timer = window.setInterval(() => setElapsed(Math.round((Date.now() - started) / 1000)), 1000);
    return () => window.clearInterval(timer);
  }, [busy]);

  const ask = useCallback(
    async (sentence: string, context: AgentContext) => {
      const goal = sentence.trim();
      if (!goal) return;
      setBusy(true);
      setError(null);
      setRun(null);
      setAskedOn(surfaceLabel(surface));
      try {
        const view = await agentRuntime.startRun({
          goalText: goal,
          // A structured hint the runtime verifies with an org-scoped read — never a fact, never text.
          ...(context.productId ? { productId: context.productId } : {}),
        });
        setRun(view);
      } catch (err) {
        setError(explainAgentError(err));
      } finally {
        setBusy(false);
      }
    },
    [surface],
  );

  // A new request from a launcher or the home box: put the sentence in the box; run it only when the
  // seller already pressed send on it (home). Otherwise focus so the next press is theirs.
  useEffect(() => {
    if (!request || request.seq === handledSeq.current) return;
    handledSeq.current = request.seq;
    const sentence = request.context.goal ?? "";
    setText(sentence);
    setRun(null);
    setError(null);
    if (request.autorun && sentence.trim()) {
      void ask(sentence, request.context);
    } else {
      window.setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [request, ask]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") closePanel();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [closePanel]);

  const context: AgentContext = {
    ...(surface?.productId ? { productId: surface.productId } : {}),
    ...(surface?.channelCode ? { channelCode: surface.channelCode } : {}),
    ...(surface?.surface ? { surface: surface.surface } : {}),
  };
  const plannerOff = run?.status === "FAILED" && run.failureCode === "PLANNER_CAPABILITY_OFF";
  const disabled = runtimeDown || plannerOff;
  const sendAsked = asksToSend(text);
  const contextChanged = run != null && askedOn != null && askedOn !== surfaceLabel(surface);

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

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4">
        {runtimeDown ? (
          <p className="rounded-lg border border-warn/40 bg-warn/10 px-3 py-2 text-sm text-warn" role="status">
            AI 담당자 서비스에 연결하지 못했습니다. 채널 연결과는 관계없는 문제입니다.
          </p>
        ) : null}
        {plannerOff ? (
          <p className="rounded-lg border border-warn/40 bg-warn/10 px-3 py-2 text-sm text-warn" role="status">
            이 계정에서는 자유 문장 요청이 아직 열려 있지 않습니다.
          </p>
        ) : null}

        <form
          aria-label="AI 담당자에게 요청"
          onSubmit={(e) => {
            e.preventDefault();
            if (busy || disabled) return;
            void ask(text, context);
          }}
          className="space-y-2"
        >
          <label htmlFor="agent-panel-input" className="sr-only">
            무엇을 확인해 드릴까요?
          </label>
          <textarea
            id="agent-panel-input"
            ref={inputRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={2}
            disabled={disabled}
            placeholder={surface ? `${surface.label}에 대해 무엇을 확인해 드릴까요?` : "무엇을 확인해 드릴까요?"}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                if (!busy && !disabled) void ask(text, context);
              }
            }}
            className="w-full resize-none rounded-lg border border-line bg-surface px-3 py-2 text-base text-ink placeholder:text-muted focus:border-brand-700 focus:outline-none disabled:opacity-50"
          />
          {sendAsked ? (
            <p className="break-keep rounded-lg bg-canvas px-3 py-2 text-sm text-muted" data-testid="agent-send-fence">
              {SEND_FENCE_COPY}
            </p>
          ) : null}
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm tabular-nums text-muted" aria-live="polite">
              {busy ? `확인하는 중 · ${elapsed}초` : ""}
            </span>
            <Btn type="submit" size="sm" disabled={busy || disabled || !text.trim()}>
              {busy ? "확인 중…" : "확인 요청"}
            </Btn>
          </div>
        </form>

        {error ? <p className="text-sm text-bad">{error}</p> : null}

        {run?.status === "FAILED" && !plannerOff ? (
          <div className="rounded-lg border border-line bg-canvas px-3 py-2" role="status">
            <p className="text-sm font-semibold text-ink">이 요청은 계획을 세우지 못했습니다</p>
            {run.failureReason ? <p className="mt-1 break-keep text-sm text-muted">{run.failureReason}</p> : null}
          </div>
        ) : null}

        {run?.answer ? (
          <div>
            {contextChanged ? (
              <p className="mb-1 text-xs text-muted" data-testid="agent-asked-on">
                {askedOn}에서 물었던 답입니다
              </p>
            ) : null}
            <OperatorAnswerView answer={run.answer} compact />
          </div>
        ) : null}
        {run && run.status !== "FAILED" && !run.answer ? (
          <p className="text-sm text-muted">
            이 요청은 전체 화면에서 이어집니다.{" "}
            <Link to="/agent" className="font-semibold text-brand-700">운영 에이전트 열기</Link>
          </p>
        ) : null}
      </div>

      <footer className="border-t border-line px-4 py-2 text-xs text-muted">
        확인만 합니다 · 외부로 보내지 않습니다 ·{" "}
        <Link to="/agent" className="font-medium text-ink hover:underline">전체 화면</Link>
      </footer>
    </>
  );
}
