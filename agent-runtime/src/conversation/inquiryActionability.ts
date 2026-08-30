/**
 * Whether an inquiry the seller pointed at can take a reply draft RIGHT NOW — decided from the closed
 * state the row already carries, before any retrieval, proposal or model call (Conversation Object
 * Integrity v1, 2026-08-30).
 *
 * <b>Inquiry identity ≠ work-item identity.</b> A row is selectable by its inquiry id whether or not a
 * work item exists; the work item is only what says whether a draft can be prepared and in which phase
 * the product's own draft path (propose → generate) will accept it. Found live: a COMPLETED inquiry
 * launched from the panel spent four READs and one draft-model call before the backend answered 409,
 * and the turn then vanished with a generic error. This gate is the deterministic reason that call is
 * never made: the same {@code inquiries.status} and work-item phase the screens read, nothing inferred.
 */

export type InquiryActionability =
  /** OPEN or PROPOSED work item — the product's draft path accepts it. */
  | "DRAFTABLE"
  /** `status=ANSWERED`, or a work item that EXECUTED/COMPLETED: the customer already has a reply. */
  | "ALREADY_ANSWERED"
  /** APPROVED / ACTION_PENDING: an approved answer is on its way; a new draft would compete with it. */
  | "AWAITING_SEND"
  /** No workable item (none at all, or DISMISSED/REJECTED/FAILED): nothing a draft can attach to. */
  | "NOT_WORKABLE";

const DRAFTABLE_PHASES = new Set(["OPEN", "PROPOSED"]);
const AWAITING_SEND_PHASES = new Set(["APPROVED", "ACTION_PENDING"]);
const ANSWERED_PHASES = new Set(["EXECUTED", "COMPLETED"]);

export function actionabilityOf(row: {
  readonly workItemId: string | null; readonly phase: string | null | undefined; readonly status: string | null | undefined;
}): InquiryActionability {
  const phase = (row.phase ?? "").toUpperCase();
  const status = (row.status ?? "").toUpperCase();
  // The effective answer state wins over any phase: an ANSWERED row is answered whatever its work item says.
  if (status === "ANSWERED" || ANSWERED_PHASES.has(phase)) return "ALREADY_ANSWERED";
  if (row.workItemId && DRAFTABLE_PHASES.has(phase)) return "DRAFTABLE";
  if (row.workItemId && AWAITING_SEND_PHASES.has(phase)) return "AWAITING_SEND";
  return "NOT_WORKABLE";
}

/** The seller-facing sentence for a non-draftable inquiry. Closed; never a backend message or a phase token. */
export const ACTIONABILITY_SENTENCE: Record<Exclude<InquiryActionability, "DRAFTABLE">, string> = {
  ALREADY_ANSWERED: "이미 답변된 문의라 새 초안은 만들지 않았습니다.",
  AWAITING_SEND: "승인된 답변이 전송을 기다리고 있는 문의라 새 초안은 만들지 않았습니다.",
  NOT_WORKABLE: "지금은 답변 준비 대상이 아닌 문의라 초안을 만들지 않았습니다. 문의 화면에서 상태를 확인해 주세요.",
};
