import type { ReactNode } from "react";
import { ConversationTimeline } from "./ConversationTimeline";
import { Composer } from "./Composer";
import { placeholderFor, promptsFor } from "./surfacePrompts";
import { useConversation, type DisplayTurn, type TurnHints } from "../../lib/conversation/ConversationProvider";
import { useAgentPanel } from "../../lib/agentPanel";
import type { ConversationSurface } from "../../lib/analytics/events";

/**
 * Timeline + composer over the ONE shared conversation. The home, the `/agent` page and the
 * contextual panel all render this; the only differences are compactness, the hints the surface
 * registers, and what sits above (a first turn) or below (chips). Outside the provider it renders
 * nothing — a bare page render has no conversation to show.
 */
export function ConversationWorkspace({
  surface,
  compact = false,
  leadingTurns = [],
  chips,
  placeholder,
  initialText,
  autoFocus = false,
  disabled = false,
  disabledReason,
  footer,
  composerClassName = "",
  onBeforeSend,
}: {
  surface: ConversationSurface;
  compact?: boolean;
  /** Client-composed turns shown before the conversation (the home's proactive opener). */
  leadingTurns?: DisplayTurn[];
  chips?: readonly string[];
  placeholder?: string;
  initialText?: string;
  autoFocus?: boolean;
  disabled?: boolean;
  disabledReason?: ReactNode;
  footer?: ReactNode;
  composerClassName?: string;
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

  return (
    <div className={compact ? "flex min-h-0 flex-1 flex-col" : "space-y-4"}>
      <div className={compact ? "min-h-0 flex-1 overflow-y-auto px-4 py-4" : ""}>
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
      <div className={compact ? "border-t border-line bg-surface px-4 py-3" : composerClassName}>
        {conversation.plannerOff ? (
          <p className="mb-2 rounded-lg border border-warn/40 bg-warn/10 px-3 py-2 text-sm text-warn" role="status">
            이 계정에서는 자유 문장 요청이 아직 열려 있지 않습니다.
          </p>
        ) : null}
        {disabledReason}
        <Composer
          onSend={send}
          busy={conversation.busy}
          disabled={blocked}
          placeholder={placeholder ?? placeholderFor(registered?.label)}
          initialText={initialText}
          autoFocus={autoFocus}
          chips={chips ?? promptsFor(registered?.surface)}
          compact={compact}
          inputId={compact ? "agent-panel-input" : "conversation-input"}
          footer={footer}
        />
      </div>
    </div>
  );
}
