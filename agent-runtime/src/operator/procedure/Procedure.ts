/**
 * <b>The six business procedures this product actually runs — and, for each, the one place that decides
 * whether it can run and what it means when it cannot.</b>
 *
 * Agent Procedure Layer v1. Not a workflow engine, not a DSL, not a graph: a procedure here is a record
 * with a PRECONDITION over {@link WorldState} and a NEXT STEP for when that precondition fails. The
 * planner still chooses the goal; the specialists still do the reading; the tools, needs, artifacts,
 * `ActiveTask` values and the approval boundary are all untouched. What moves into this file is the one
 * judgement that was being made in several places at once.
 *
 * <b>Why it exists, from the audit's measurement.</b>
 * `docs/agent_runtime_architecture_audit_v1.md` found the same three judgements duplicated:
 *
 * <ul>
 *   <li><b>readiness</b> — the coverage table was read and interpreted in four places;</li>
 *   <li><b>absence</b> — 「없습니다」 was decided in three, and one of them said it about rows that could
 *       not exist (a clean organisation, measured live 2026-09-05);</li>
 *   <li><b>draft precondition</b> — 「can this object take a draft right now」 was asked by five callers,
 *       of which one (the tone revision of a review) did not ask at all.</li>
 * </ul>
 *
 * <b>The rule this file makes executable.</b> {@code ChannelDataState} has always stated it in its own
 * docblock — «`ZERO` is the scarcest value. It is the only one from which an answer may say 없습니다» —
 * and nothing enforced it. {@link AbsenceReason} is that rule as a closed type: `ZERO_MEASURED` is the
 * only value whose sentence is an assertion about the seller's store; every other value says what was
 * missing instead.
 *
 * <b>What this file may never become.</b> A router (the planner routes), a sentence bank keyed to
 * example phrases (nothing here reads the seller's words — the inputs are a world state and a closed
 * per-object verdict), or a place where a new capability is declared (`ONBOARD_CHANNEL` promises
 * exactly what the coverage table says this deployment supports).
 */
import type { WorldState } from "../state/WorldState";
import type { InquiryActionability } from "../../conversation/inquiryActionability";
import { ACTIONABILITY_SENTENCE } from "../../conversation/inquiryActionability";
import type { ChannelCapabilityVerdict } from "../capability/ChannelCapability";
import { EXECUTION_REASON } from "../capability/ChannelCapability";

/** The procedures this product runs. Six, because six is what it has — not a budget. */
export type ProcedureId =
  /** 판매 채널 연결 — the only procedure whose precondition is the absence of every other one's. */
  | "ONBOARD_CHANNEL"
  /** 오늘 할 일 — the checklist: what is waiting, across objects. */
  | "DAILY_WORK"
  /** 문의 하나에 답변 준비 → 승인 → 전송. */
  | "ANSWER_INQUIRY"
  /** 리뷰 하나에 답글 준비 → 승인 → 실행(채널별). */
  | "ANSWER_REVIEW"
  /** 빠진 답변 기준을 판매자에게 묻고, 저장하고, 하던 일을 한 번 재개. */
  | "CAPTURE_KNOWLEDGE"
  /** 반복되는 문제에서 개선 기회 도출. */
  | "IMPROVE_FROM_ISSUES";

/**
 * Why a procedure cannot run — closed, and ordered from «no source» to «measured nothing».
 *
 * The distinction the product kept losing is between the last value and the first two: a read that
 * returned nothing because there was nothing to read from is not a fact about the shop.
 */
export type AbsenceReason =
  /** No channel is connected: nothing operational can be read, and there is one next step. */
  | "NO_CHANNEL"
  /** Connected, and nothing has been collected yet — or the first collection landed empty. */
  | "NO_DATA_YET"
  /** The read happened over a real source and genuinely found nothing. The only assertable zero. */
  | "ZERO_MEASURED"
  /** The object exists but is not in a state this procedure accepts. */
  | "NOT_ACTIONABLE"
  /** This channel has no path for what the procedure would do. */
  | "NOT_SUPPORTED"
  /** Something needed to decide was not readable. Claim nothing. */
  | "UNKNOWN";

export type Precondition = { readonly ok: true } | { readonly ok: false; readonly absence: AbsenceReason };

const OK: Precondition = { ok: true };
const no = (absence: AbsenceReason): Precondition => ({ ok: false, absence });

/** The one screen that performs the step a seller with no connected channel has. */
export const CONNECT_STEP = { label: "판매 채널 연결하기", to: "/connect" } as const;

export interface NextStep {
  readonly label: string;
  readonly to: string;
}

/**
 * Can anything operational be read for this seller at all?
 *
 * The shared half of every procedure that touches rows. `UNKNOWN` is NOT a failure here: a coverage read
 * that did not happen must not stop a seller with rows from being answered, so it passes and the answer
 * is whatever the rows say — the same behaviour as before this layer existed.
 */
export function operationalPrecondition(world: WorldState): Precondition {
  if (world.readiness.kind === "NO_CHANNEL") return no("NO_CHANNEL");
  if (world.readiness.kind === "NO_DATA") return no("NO_DATA_YET");
  return OK;
}

/**
 * 문의 하나가 지금 초안을 받을 수 있는가 — the gate that was asked in three places and skipped in a fourth.
 *
 * <b>{@link operationalPrecondition} is deliberately NOT part of this.</b> Holding the object is proof
 * of the source: a seller with an inquiry in hand has a connected channel by construction, so asking the
 * world here would buy a coverage read to confirm something the argument already proves.
 */
export function inquiryDraftPrecondition(actionability: InquiryActionability, hasTarget: boolean): Precondition {
  return actionability === "DRAFTABLE" && hasTarget ? OK : no("NOT_ACTIONABLE");
}

/**
 * 리뷰 하나가 지금 답글 초안을 받을 수 있는가.
 *
 * Two refusals, and they are different claims: a channel that does not support seller replies, and a
 * channel whose reply semantics could not be read. The second must refuse too — «a draft for a place
 * that may not exist is the Coupang loophole by another door» (Acceptance Closure §10).
 */
export function reviewDraftPrecondition(verdict: ChannelCapabilityVerdict): Precondition {
  if (verdict.execution !== "NOT_SUPPORTED") return OK;
  return no(verdict.reason === EXECUTION_REASON.CHANNEL_UNSUPPORTED ? "NOT_SUPPORTED" : "UNKNOWN");
}

/**
 * <b>What an empty answer MEANS.</b> One function, so the product cannot say 「없습니다」 and
 * 「연결하시면…」 about the same state on two screens.
 *
 * `null` where nothing should be said: an `UNKNOWN` world claims neither way, and `NOT_ACTIONABLE` /
 * `NOT_SUPPORTED` are per-object refusals whose sentences belong to the object's own vocabulary
 * ({@link ACTIONABILITY_SENTENCE}, the channel capability wording) rather than to this table.
 */
export function absenceSentence(id: ProcedureId, reason: AbsenceReason, world: WorldState): string | null {
  if (reason === "NO_CHANNEL") {
    return "아직 연결된 판매 채널이 없어서, 확인해 드릴 자료가 없습니다. 판매 채널을 연결하시면 그날 하실 일을 여기에 정리해 두겠습니다.";
  }
  if (reason === "NO_DATA_YET") {
    return `${world.readiness.connected.join(" · ")} 연결은 끝났고, 아직 가져온 자료가 없습니다. 들어오는 대로 여기에 먼저 정리해 두겠습니다.`;
  }
  // The only reason whose sentence asserts something about the shop — and only DAILY_WORK asks it,
  // because 「지금 먼저 하실 일은 없습니다」 is a claim about the checklist and about nothing else.
  if (reason === "ZERO_MEASURED") return id === "DAILY_WORK" ? "지금 먼저 하실 일은 없습니다." : null;
  return null;
}

/**
 * <b>May the checklist say 「없습니다」?</b> Only when this turn measured nothing.
 *
 * Measured live on the Demo organisation (2026-09-06): the checklist came back empty because the run
 * produced FINDINGS rather than a list artifact, and the answer opened 「지금 먼저 하실 일은 없습니다」
 * directly above its own sentence saying 24 inquiries were waiting. `ZERO_MEASURED` is the one reason
 * whose sentence asserts something about the shop, and a turn that found work has not earned it — the
 * findings are then the answer, and this claim is simply not made.
 */
export function honestZero(itemCount: number, findingCount: number): boolean {
  return itemCount === 0 && findingCount === 0;
}

/** The one step behind a failed precondition, when there is one. Never a prompt — a screen. */
export function nextStepFor(reason: AbsenceReason): NextStep | null {
  return reason === "NO_CHANNEL" ? CONNECT_STEP : null;
}

/**
 * The per-object refusal sentence — the object's own vocabulary, reached through one door.
 *
 * Kept beside {@link absenceSentence} rather than merged with it because the two answer different
 * questions: that one is about the seller's whole store, this one about one row the seller pointed at.
 */
export function objectRefusalSentence(
  id: "ANSWER_INQUIRY" | "ANSWER_REVIEW", reason: AbsenceReason, actionability: InquiryActionability, channelSentence: string,
): string {
  if (id === "ANSWER_INQUIRY") {
    return ACTIONABILITY_SENTENCE[actionability === "DRAFTABLE" ? "NOT_WORKABLE" : actionability];
  }
  return reason === "NOT_SUPPORTED" ? channelSentence
    : `${channelSentence}에서 리뷰 답글을 어떻게 처리할 수 있는지 확인하지 못해 초안을 준비하지 않았습니다.`;
}
