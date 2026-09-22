import type { ReviewDecisionLogEntry, ReviewTriageTier, TriageDisposition } from "./types";
import { TRIAGE_TIER_LABEL } from "./reviewTriage";
import { TRIAGE_OPTIONS } from "./vocItems";

/**
 * How the Decision Workspace reads — the words for the decisions the product already records.
 *
 * <b>No new vocabulary.</b> Every label here maps a value that already exists on the wire onto a
 * sentence: the response decision is `TriageDisposition`, the seller's judgment is
 * `ReviewTriageTier`, the recorded act is `TriageActionKind`, the approval is
 * `ReviewReplyApprovalState`, the outcome is `OperatorOutcomeName`. A workspace that invented its
 * own words for these would be a second taxonomy for the same five facts, and the second taxonomy is
 * the one that drifts.
 */

/**
 * What the 조치 선택 step promises, and it depends on the channel.
 *
 * <b>No second label vocabulary.</b> The three buttons keep the words they already had
 * (`TRIAGE_OPTIONS`: 대응 필요 / 두고 보기 / 조치 불필요) — a workspace that renamed them would leave the
 * worklist, the record and the audit trail describing the same three values in different words. What
 * the workspace adds is the sentence UNDER them, and that sentence depends on why a draft is or is
 * not on offer. There are three reasons and they are three different facts: the channel has a reply
 * flow; the channel has none at all (Coupang 상품평, per the capability table); or the channel has one
 * and this org has no account on it, which is a fact about this seller's setup and not about the
 * marketplace. Saying the second when the third is true tells a seller their channel cannot do
 * something it can — which is exactly the sentence they would stop trying to fix.
 */
export const DECISION_ACTION_NOTE = {
  withReply:
    "「대응 필요」로 정하면 아래에서 답변 초안을 준비하고 승인할 수 있습니다. 승인한 답변은 판매자님이 판매자센터에 직접 올리십니다.",
  withoutReply:
    "이 채널에서는 reviewnary가 답변을 작성하지 않습니다. 조치는 판매자님이 직접 하시고, 여기에는 무엇으로 정했는지만 기록됩니다.",
  withoutAccount:
    "이 채널에 연결된 판매 계정이 없어 답변 초안은 준비할 수 없습니다. 조치는 판매자님이 직접 하시고, 여기에는 무엇으로 정했는지만 기록됩니다.",
} as const;

/** The short word for a recorded decision — the same three the worklist and the record use. */
export const DECISION_ACTION_WORD: Record<TriageDisposition, string> =
  Object.fromEntries(TRIAGE_OPTIONS.map((o) => [o.value, o.label])) as Record<TriageDisposition, string>;

/**
 * 완료 기록 — what the seller did off this screen.
 *
 * <b>조치 불필요 is deliberately absent.</b> `TriageActionKind.ACTION_NOT_NEEDED` exists and is still
 * written by the pilot's controls on the record screen, but the workspace's own 조치 선택 step already
 * records exactly that statement as `NO_ACTION`, with its own audit trail. Offering both would put one
 * press into two spines at two evidential strengths — the thing the triage contract §5-C says must not
 * happen — so this screen records the two acts the decision spine has no word for, and no more.
 */
export const DECISION_DONE_LABEL = {
  ACTION_STARTED: "조치 시작함",
  ACTION_COMPLETED: "조치 완료함",
} as const;

export type DecisionDoneKind = keyof typeof DECISION_DONE_LABEL;

/** The recorded act as the log says it. Covers the pilot's third value, which the log can still read. */
const ACTION_KIND_WORD: Record<string, string> = {
  ACTION_STARTED: "조치를 시작했다고 기록",
  ACTION_COMPLETED: "조치를 완료했다고 기록",
  ACTION_NOT_NEEDED: "조치가 필요 없다고 기록",
  REPLY_DRAFTED: "답변 초안을 작성했다고 기록",
  REPLY_SUBMITTED: "답변을 올렸다고 기록",
};

const APPROVAL_WORD: Record<string, string> = {
  APPROVED: "답변을 승인",
  WITHDRAWN: "답변 승인을 되돌림",
};

const OUTCOME_WORD: Record<string, string> = {
  OPERATOR_REPORTED_SUBMITTED: "판매자센터에 올렸다고 기록",
  SUBMISSION_ABORTED: "올리지 않고 중단했다고 기록",
};

function tierWord(value: string | null): string | null {
  if (!value) return null;
  return TRIAGE_TIER_LABEL[value as ReviewTriageTier] ?? null;
}

/**
 * One log entry as a sentence, or null when nothing honest can be said about it.
 *
 * <b>Null is a real outcome and must render as nothing.</b> Every value here is a closed enum, but the
 * server's vocabulary can grow ahead of this screen — and a row rendered as its own raw token
 * (`ACTION_RECORDED · REPLY_DRAFTED`) is the internal-word leak this product removes from screens
 * everywhere else. An entry this build cannot name is an entry it does not draw.
 */
export function decisionLogSentence(entry: ReviewDecisionLogEntry): string | null {
  switch (entry.kind) {
    case "SELLER_JUDGMENT_SET": {
      const to = tierWord(entry.to);
      if (!to) return null;
      const from = tierWord(entry.from);
      return from ? `판매자 판단을 ${from}에서 ${to}로 바꿈` : `판매자 판단을 ${to}(으)로 기록`;
    }
    case "SELLER_JUDGMENT_WITHDRAWN":
      return "판매자 판단을 되돌림";
    case "ACTION_CHOSEN": {
      const to = entry.to ? DECISION_ACTION_WORD[entry.to as TriageDisposition] : null;
      return to ? `조치를 ${to}(으)로 정함` : null;
    }
    case "ACTION_RECORDED":
      return entry.to ? (ACTION_KIND_WORD[entry.to] ?? null) : null;
    case "REPLY_APPROVAL":
      return entry.to ? (APPROVAL_WORD[entry.to] ?? null) : null;
    case "REPLY_OUTCOME":
      return entry.to ? (OUTCOME_WORD[entry.to] ?? null) : null;
    default:
      return null;
  }
}

/**
 * The one sentence the whole workspace rests on, said once at the bottom.
 *
 * A seller who has just recorded four things is entitled to know that none of them left the building.
 */
export const DECISION_LOG_DISCLOSURE =
  "여기 기록한 판단과 조치는 reviewnary 안에만 남습니다. 마켓플레이스에는 아무것도 전송되지 않습니다.";
