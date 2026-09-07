/**
 * <b>What both lanes know about where this conversation is standing — derived, never a second store.</b>
 *
 * Grounded Conversation Lane v1 §2. The audit that opened this package asked one question: where does
 * conversational context live? The answer was «in six places, each correct, none named»:
 *
 * <ul>
 *   <li>the raw turns — {@code ConversationStore}, bounded to 40 and stripped of customer text;</li>
 *   <li>the current object — {@code WorkingSetView.selectedInquiry} / {@code selectedObject}, ids only;</li>
 *   <li>the candidate set an ordinal picks from — {@code WorkingSetView.ids} / {@code workItemIds};</li>
 *   <li>the step in flight — {@code ConversationView.activeTask} and {@code pendingPrepared};</li>
 *   <li>the procedure in flight — the AOP cursor, keyed {@code conversationId:procedureId};</li>
 *   <li>the screen the seller sent from — {@code StartTurnRequest.surface} / {@code productId};</li>
 *   <li>what the planner is told — {@code priorContext}, built by {@code priorLineOf}.</li>
 * </ul>
 *
 * <b>This file adds no seventh.</b> It is a projection: every field below is READ from one of those,
 * and nothing here is persisted, cached or reconciled. That is deliberate — a package that answered
 * «context is scattered» by introducing a durable envelope would have made a second copy of the anchor
 * and, the first time the two disagreed, no one could say which was the conversation's.
 *
 * <b>Refs, never content.</b> The envelope carries ids, closed tokens and counts. The facts behind them
 * are re-read from the surface that owns them, exactly as {@code persistableTurn} already requires of
 * the transcript. The one place prose appears is {@link ContextEnvelope.recentTurns}, which is the
 * seller's own sentences and ours — the two classes this repository already sends to a model.
 */
import type {
  ActiveTask, ConversationView, PendingKnowledgeCapture, TurnView, WorkingSetView,
} from "./contract";
import type { ProcedureId } from "../operator/procedure/Procedure";
import type { SellerReadinessKind } from "../operator/capability/SellerReadiness";

/** The kinds of object a conversation can stand on. The first three are anchors; the last two are scopes. */
export type FocusKind = "REVIEW" | "INQUIRY" | "PRODUCT" | "ISSUE" | "REPORT";

/** Which object, exactly — the same ids the working set already holds, and no name or body. */
export interface FocusRef {
  readonly kind: FocusKind;
  readonly id: string;
  /** The product this object IS, or the one it is about. Null when there is no binding. */
  readonly productId: string | null;
  readonly channelCode: string | null;
}

/**
 * What the seller is being asked to do, when they are.
 *
 * <b>Derived, and it is the fence §4 asks for.</b> A conversational turn may see that an approval is
 * standing; it may never BE one. Only the closed intents the deterministic lanes recognise advance a
 * procedure, and this token exists so a grounded answer can say 「지금 이 초안은 판매자님 확인을
 * 기다리고 있습니다」 without being able to give that confirmation.
 */
export type AwaitingKind = "HUMAN_ACTION" | "APPROVAL" | "KNOWLEDGE_ANSWER" | "DRAFT_REVIEW";

export interface ContextEnvelope {
  readonly conversationId: string;
  /** The screen the seller sent from, when they sent from one. A closed token from the frontend. */
  readonly surface: string | null;
  readonly readiness: SellerReadinessKind;
  readonly focus: FocusRef | null;
  /** The rows the last list put on the table — what 「두 번째 거」 and 「그중」 point at. */
  readonly workingSet: {
    readonly kind: WorkingSetView["kind"]; readonly count: number; readonly shown: number;
  } | null;
  /** The procedure this turn is running, when one claimed it. */
  readonly activeProcedure: { readonly id: ProcedureId; readonly version: string } | null;
  readonly activeTask: ActiveTask | null;
  readonly awaiting: AwaitingKind | null;
  /** The last few sentences of this thread, oldest first — the seller's and ours. */
  readonly recentTurns: readonly { readonly role: "SELLER" | "AGENT"; readonly text: string }[];
}

/** How many turns of the thread travel. Six is three exchanges — enough for 「그건」, short enough to read. */
export const ENVELOPE_TURNS = 6;

/** The one anchor the conversation is standing on, as a ref. */
export function focusOf(set: WorkingSetView | null): FocusRef | null {
  if (!set) return null;
  if (set.selectedObject) {
    return {
      kind: set.selectedObject.kind, id: set.selectedObject.id,
      productId: set.selectedObject.productId, channelCode: set.selectedObject.channelCode,
    };
  }
  if (set.selectedInquiry) {
    return {
      kind: "INQUIRY", id: set.selectedInquiry.inquiryId,
      productId: set.selectedInquiry.productId, channelCode: set.selectedInquiry.channelCode,
    };
  }
  return null;
}

function awaitingOf(view: ConversationView, capture: PendingKnowledgeCapture | null): AwaitingKind | null {
  if (view.pendingHumanAction) return "HUMAN_ACTION";
  if (capture) return "KNOWLEDGE_ANSWER";
  if (view.activeTask === "APPROVE_REPLY") return "APPROVAL";
  if (view.pendingPrepared) return "DRAFT_REVIEW";
  return null;
}

/** The seller's sentence and ours, as the thread recorded them. Empty turns are not sent. */
function turnsOf(turns: readonly TurnView[]): ContextEnvelope["recentTurns"] {
  return turns
    .map((t) => ({
      role: (t.role === "USER" ? "SELLER" : "AGENT") as "SELLER" | "AGENT",
      text: (t.role === "USER" ? t.text ?? "" : t.message ?? "").trim(),
    }))
    .filter((t) => t.text.length > 0)
    .slice(-ENVELOPE_TURNS);
}

export function envelopeOf(input: {
  readonly conversationId: string;
  readonly view: ConversationView;
  readonly readiness: SellerReadinessKind;
  readonly surface?: string | null;
  readonly procedure?: { readonly id: ProcedureId; readonly version: string } | null;
}): ContextEnvelope {
  const { view } = input;
  const set = view.workingSet;
  return {
    conversationId: input.conversationId,
    surface: input.surface ?? null,
    readiness: input.readiness,
    focus: focusOf(set),
    workingSet: set ? { kind: set.kind, count: set.count, shown: set.ids.length } : null,
    activeProcedure: input.procedure ?? null,
    activeTask: view.activeTask ?? null,
    awaiting: awaitingOf(view, view.pendingCapture ?? null),
    recentTurns: turnsOf(view.turns),
  };
}

/**
 * The envelope as closed {@code key=value} lines — the only shape allowed past the backend's floor.
 *
 * <b>Ids do not travel.</b> WHICH review is anchored is not something a sentence-writing model needs
 * or could check; that the conversation is standing on a review is. This is the same rule
 * {@code priorLineOf} has followed since Agent Interaction Model v2, and stating it as tokens is what
 * lets {@code ConverseRequestFloor} refuse the day a name or a body appears on this line.
 */
export function envelopeTokens(envelope: ContextEnvelope): string[] {
  const lines = [
    `readiness=${envelope.readiness}`,
    `focus=${envelope.focus?.kind ?? "NONE"}`,
    `surface=${envelope.surface ?? "CHAT"}`,
  ];
  if (envelope.workingSet) {
    lines.push(`shownList=${envelope.workingSet.kind} shownRows=${envelope.workingSet.shown} totalRows=${envelope.workingSet.count}`);
  }
  if (envelope.activeProcedure) lines.push(`procedure=${envelope.activeProcedure.id}`);
  if (envelope.activeTask) lines.push(`step=${envelope.activeTask}`);
  if (envelope.awaiting) lines.push(`awaiting=${envelope.awaiting}`);
  return [lines.join(" ")];
}

/** The thread excerpt, labelled with who said each line. */
export function envelopeTurnLines(envelope: ContextEnvelope): string[] {
  return envelope.recentTurns.map((t) => `${t.role === "SELLER" ? "판매자" : "reviewnary"}: ${t.text}`);
}
