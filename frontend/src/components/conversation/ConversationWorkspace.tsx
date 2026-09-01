import { useMemo, type ReactNode } from "react";
import { AnimatePresence } from "motion/react";
import { ConversationTimeline } from "./ConversationTimeline";
import { ContextBar } from "./ContextBar";
import { Composer } from "./Composer";
import { currentContext } from "../../lib/conversation/currentContext";
import { placeholderFor, promptsFor } from "./surfacePrompts";
import { useConversation, type DisplayTurn, type TurnHints } from "../../lib/conversation/ConversationProvider";
import { useAgentPanel } from "../../lib/agentPanel";
import type { ConversationSurface } from "../../lib/analytics/events";

/**
 * Transcript + composer over the ONE shared conversation — conversation-first (Chat UI v1).
 *
 * The transcript is the main surface and owns its own scroll; the composer is docked at the bottom of
 * the viewport (`flex` column: scroll area `flex-1 min-h-0`, composer after it — nothing floats below
 * the box). The home, the `/agent` page and the contextual panel all render this; the differences are
 * compactness (`compact` = the 400px panel), what sits above the thread (`lead`: the home's greeting
 * and context line, shown only while the conversation is empty), and the hints the surface registers.
 * Example prompts appear only on an EMPTY conversation — after the first message the thread speaks.
 * Outside the provider it renders nothing — a bare page render has no conversation to show.
 */
export function ConversationWorkspace({
  surface,
  compact = false,
  leadingTurns = [],
  lead,
  chips,
  placeholder,
  initialText,
  autoFocus = false,
  disabled = false,
  disabledReason,
  footer,
  onBeforeSend,
}: {
  surface: ConversationSurface;
  compact?: boolean;
  /** Client-composed turns shown before the conversation (the home's proactive opener). */
  leadingTurns?: DisplayTurn[];
  /** What the empty thread opens with (a greeting, a context line). Hidden once the thread has turns. */
  lead?: ReactNode;
  chips?: readonly string[];
  placeholder?: string;
  initialText?: string;
  autoFocus?: boolean;
  disabled?: boolean;
  disabledReason?: ReactNode;
  footer?: ReactNode;
  /** A chance to answer locally (a palette shortcut). Return true when the sentence was handled. */
  onBeforeSend?: (text: string) => boolean;
}) {
  const conversation = useConversation();
  const panel = useAgentPanel();
  if (!conversation) return null;
  const registered = panel?.surface ?? null;
  const hints: TurnHints = {
    ...(registered?.productId ? { productId: registered.productId } : {}),
    ...(registered?.workItemId ? { workItemId: registered.workItemId } : {}),
    ...(registered?.channelCode ? { channelCode: registered.channelCode } : {}),
    ...(registered?.surface ? { surface: registered.surface } : {}),
  };
  const send = (text: string) => {
    if (onBeforeSend?.(text)) return;
    void conversation.send(text, hints, surface);
  };
  const blocked = disabled || conversation.plannerOff;
  const empty = conversation.turns.length === 0;
  // Working Context v1 §1: what the next sentence will be about, resolved from what the thread already
  // drew. Null while the conversation holds nothing — the common case at the start, and it renders nothing.
  // <b>Everything the seller can SEE, not only what the server persisted.</b> The bar names the anchor
  // from the rows the thread already drew — and the home's brief is a client-composed leading turn, so
  // pressing one of ITS rows anchored an inquiry the bar could only call 「선택한 문의」 (measured live).
  // The rows are on screen either way; which list they came from is not something a seller can see.
  const context = useMemo(
    () => currentContext(conversation.workingSet, conversation.activeTask, [...leadingTurns, ...conversation.turns]),
    [conversation.workingSet, conversation.activeTask, conversation.turns, leadingTurns],
  );
  // §4: the box asks for what the agent asked for. A gap question ends with the seller typing the
  // answer, and 「무엇이든 물어보세요」 above the cursor was the one place that did not say so.
  const askedPlaceholder = conversation.activeTask === "CAPTURE_KNOWLEDGE" ? "답변 기준을 여기에 적어 주세요" : null;

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="conversation-workspace">
      <div className={`min-h-0 flex-1 overflow-y-auto ${compact ? "px-4 py-4" : "px-4 py-5 md:px-8"}`}>
        <div className={compact ? "" : "mx-auto w-full max-w-[840px]"}>
          {empty && lead ? <div className="mb-6">{lead}</div> : null}
          <ConversationTimeline
            turns={[...leadingTurns, ...conversation.turns]}
            busy={conversation.busy}
            stages={conversation.stages}
            elapsed={conversation.elapsed}
            error={conversation.error}
            compact={compact}
            dockKey={context ? `${context.kind}:${context.label}:${context.task ?? ""}` : ""}
            onPrompt={send}
            onResume={(turnId) => void conversation.resume(turnId)}
            onCaptureDecision={(captureId, fingerprint, decision) => void conversation.decideCapture(captureId, fingerprint, decision)}
          />
        </div>
      </div>
      {/* The dock (Chat Motion v1): the box sits 20px off the viewport edge on a solid ground, and the
          transcript slides UNDER a short fade above it — a deliberate edge, not a box floating in the
          scroll. One fade, one place; it is the only gradient in the shell. */}
      <div className={`relative shrink-0 ${compact ? "border-t border-line bg-surface px-4 py-3" : "bg-canvas px-4 pb-5 pt-1 md:px-8"}`} data-testid="composer-dock">
        {!compact ? <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 -top-6 h-6 bg-gradient-to-t from-canvas to-transparent" /> : null}
        <div className={compact ? "" : "mx-auto w-full max-w-[840px]"}>
          {conversation.plannerOff ? (
            <p className="mb-2 rounded-lg border border-warn/40 bg-warn/10 px-3 py-2 text-sm text-warn" role="status">
              이 계정에서는 자유 문장 요청이 아직 열려 있지 않습니다.
            </p>
          ) : null}
          {disabledReason}
          <AnimatePresence initial={false}>
            {context ? (
              <ContextBar key="context" context={context} onClear={() => void conversation.clearSelection()} />
            ) : null}
          </AnimatePresence>
          <Composer
            onSend={send}
            onStop={conversation.stop}
            busy={conversation.busy}
            disabled={blocked}
            attachedTop={context != null}
            placeholder={askedPlaceholder ?? placeholder ?? placeholderFor(registered?.label)}
            initialText={initialText}
            autoFocus={autoFocus}
            chips={empty ? (chips ?? promptsFor(registered?.surface)) : []}
            compact={compact}
            inputId={compact ? "agent-panel-input" : "conversation-input"}
            footer={footer}
          />
        </div>
      </div>
    </div>
  );
}
