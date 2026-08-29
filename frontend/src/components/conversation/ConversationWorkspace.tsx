import type { ReactNode } from "react";
import { ConversationTimeline } from "./ConversationTimeline";
import { Composer } from "./Composer";
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
            onPrompt={send}
            onResume={(turnId) => void conversation.resume(turnId)}
          />
        </div>
      </div>
      <div className={`shrink-0 ${compact ? "border-t border-line bg-surface px-4 py-3" : "bg-canvas px-4 pb-4 pt-2 md:px-8"}`}>
        <div className={compact ? "" : "mx-auto w-full max-w-[840px]"}>
          {conversation.plannerOff ? (
            <p className="mb-2 rounded-lg border border-warn/40 bg-warn/10 px-3 py-2 text-sm text-warn" role="status">
              이 계정에서는 자유 문장 요청이 아직 열려 있지 않습니다.
            </p>
          ) : null}
          {disabledReason}
          <Composer
            onSend={send}
            onStop={conversation.stop}
            busy={conversation.busy}
            disabled={blocked}
            placeholder={placeholder ?? placeholderFor(registered?.label)}
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
