// What a row of 실행 대기 is actually waiting for. No React, no I/O.
//
// The section used to carry ONE badge — 「승인함 · 등록 전」 — over every row in it. That sentence is
// true of a review reply, which reaches this list because a `ReviewReplyApproval` stands; it was
// false of every inquiry row, which reaches it on the predicate «a reply draft row exists» with the
// work item still OPEN or PROPOSED and no approval anywhere. The one screen whose job is to tell a
// seller what is outstanding was telling them they had approved something they had not.
//
// So the word is per row and derived from truth the backend already had, not from a status token
// invented for this screen: `kind` says which lifecycle the row belongs to, and `phase` is the work
// item's own `InquiryWorkItemPhase`.

import type { HomePreparedItem } from "./types";

/** 승인됨 · 등록 대기 — the seller decided; nothing has been posted to the channel yet. */
const APPROVED_UNSENT = "승인됨 · 등록 대기";
/** 초안 준비됨 — reviewnary wrote something; the seller has not decided anything about it. */
const DRAFT_READY = "초안 준비됨";
/** 등록 확인 중 — a send went out and its result is not settled. */
const CHECKING = "등록 확인 중";
/** 등록 실패 — a send was refused. The row stays because the customer is still unanswered. */
const FAILED = "등록 실패";

/**
 * The one thing this row is waiting for, in the seller's words.
 *
 * `null` — meaning the row says nothing extra — is deliberately possible: a word that repeats on
 * every row of a list is noise, and `IMPROVEMENT_DRAFT` rows are all the same state.
 *
 * A phase this build does not know about returns `null` rather than its raw token. Printing
 * `ACTION_PENDING` at a seller is worse than printing nothing, and a build that meets a newer
 * backend should go quiet rather than leak vocabulary.
 */
export function preparedStateWord(row: Pick<HomePreparedItem, "kind" | "phase">): string | null {
  // A review reply is on this list BECAUSE an approval stands — that is the query behind it, and the
  // review lane has no phase of this shape to read.
  if (row.kind === "REVIEW_REPLY") return APPROVED_UNSENT;
  if (row.kind !== "INQUIRY_REPLY") return null;
  switch (row.phase) {
    case "OPEN":
    case "PROPOSED":
      return DRAFT_READY;
    // Bound and waiting on a transport: the approval is spent and nothing has left yet.
    case "APPROVED":
    case "ACTION_PENDING":
      return APPROVED_UNSENT;
    case "EXECUTED":
      return CHECKING;
    case "FAILED":
      return FAILED;
    default:
      return null;
  }
}
