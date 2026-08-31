/**
 * WHAT THE CONVERSATION IS WORKING ON RIGHT NOW — the fact the seller could not see.
 *
 * <b>The defect.</b> Clicking a row anchors the conversation on that inquiry: the runtime persists the
 * selection, the next 「답변 준비해줘」 acts on it, a knowledge gap is asked about it. Every part of that
 * was already true and NONE of it was on screen. The only feedback was a tint on the row itself, which
 * scrolls away — so a seller three turns later, looking at a question like 「현금영수증 발행 기준이
 * 필요해요」, had no way to tell WHICH inquiry it was about, and 「이 문의」 was a word they had to trust.
 * The state existed (`WorkingSetView.selectedInquiry`, `ActiveTask`); nothing stood on it.
 *
 * <b>Where the name comes from.</b> Not from new state: the anchor is ids and closed tokens by
 * contract (a stored conversation must not accumulate a second copy of what a customer wrote), so the
 * label is resolved from the artifacts the thread ALREADY drew — the row's own subject line, which
 * survives a reload because it is part of the persisted artifact. Nothing is fetched, nothing is
 * cached, and when the transcript cannot name the anchor the bar says the honest generic thing rather
 * than inventing a title.
 *
 * <b>What it never shows.</b> The customer's message body, ids, phases, `activeTask` tokens, filter
 * enum names. The bar is one line of what a person would say: the object, where it came from, and —
 * only when a step is genuinely in flight — what is being done with it.
 */
import type { ActiveTask, Artifact, TurnView, WorkingSetView } from "./types";

export interface CurrentContext {
  /** ANCHOR = one selected object; SET = the rows on screen, with nothing chosen out of them. */
  kind: "ANCHOR" | "SET";
  /** The object's own name, or an honest generic when the transcript cannot name it. */
  label: string;
  /** Closed facts beside the name — channel, product, how many. Never a customer sentence. */
  meta: string | null;
  /** What is being done with it, in seller words. Null when nothing is in flight. */
  task: string | null;
  /** The object's workspace, when the thread drew one. */
  to: string | null;
  /** Only an anchored object can be released — a set is left by asking for another one. */
  clearable: boolean;
}

/**
 * The task words. INSPECT is deliberately absent: the bar showing the object IS the inspection, and a
 * 「보는 중」 beside it would be the same fact twice. Only a step that changes something gets a word.
 */
const TASK_WORD: Partial<Record<ActiveTask, string>> = {
  PREPARE_REPLY: "답변 준비 중",
  REVISE_DRAFT: "말투 다듬는 중",
  CAPTURE_KNOWLEDGE: "답변 기준 확인 중",
  APPROVE_REPLY: "보내기 확인 중",
};

interface NamedRow {
  title: string | null;
  channelNameKo: string | null;
  productName: string | null;
  to: string | null;
}

/** The most recent thing the thread drew about this inquiry, or null. Detail first — it is more specific. */
function namedFromArtifacts(artifacts: readonly Artifact[], inquiryId: string): NamedRow | null {
  for (let i = artifacts.length - 1; i >= 0; i -= 1) {
    const a = artifacts[i]!;
    if (a.type === "INQUIRY_DETAIL" && a.inquiryId === inquiryId) {
      return { title: a.title || null, channelNameKo: a.channelNameKo, productName: a.productName, to: a.to };
    }
    if (a.type === "INQUIRY_LIST") {
      for (const group of a.groups) {
        const item = group.items.find((row) => row.inquiryId === inquiryId);
        if (item) return { title: item.title ?? null, channelNameKo: item.channelNameKo, productName: item.productName, to: item.to };
      }
    }
  }
  return null;
}

/** Walk the thread backwards: the newest drawing of the object is the one the seller is looking at. */
export function nameSelected(turns: readonly TurnView[], inquiryId: string): NamedRow | null {
  for (let i = turns.length - 1; i >= 0; i -= 1) {
    const found = namedFromArtifacts(turns[i]!.artifacts, inquiryId);
    if (found) return found;
  }
  return null;
}

/** How the set on screen was narrowed, in the seller's own words — the subject word they typed included. */
function setMeta(set: WorkingSetView): string | null {
  const parts: string[] = [];
  if (set.filters.term) parts.push(`'${set.filters.term}' 관련`);
  if (set.filters.channelCode) parts.push(CHANNEL_WORD[set.filters.channelCode] ?? set.filters.channelCode);
  if (set.filters.status === "UNANSWERED") parts.push("답변 필요");
  else if (set.filters.status === "ANSWERED") parts.push("답변함");
  if (set.count > 0) parts.push(`${set.count.toLocaleString("ko-KR")}건`);
  return parts.length > 0 ? parts.join(" · ") : null;
}

/**
 * The three channels this product shows a seller. A code with no word here is printed as it came —
 * the alternative is dropping a fact the set was actually narrowed by.
 */
const CHANNEL_WORD: Record<string, string> = { NAVER: "네이버", COUPANG: "쿠팡", CAFE24: "카페24" };

const SET_LABEL: Record<WorkingSetView["kind"], string> = {
  INQUIRIES: "화면에 있는 문의",
  REVIEWS: "화면에 있는 리뷰",
  PRODUCTS: "화면에 있는 상품",
  ORDERS: "화면에 있는 주문",
  ISSUES: "화면에 있는 문제",
};

/**
 * What to show above the box, or null when the conversation is holding nothing — an empty thread, or
 * one whose last turn drew no object. Null is the common case at the start and must render nothing:
 * a bar that is always there says nothing when it matters.
 */
export function currentContext(
  workingSet: WorkingSetView | null,
  activeTask: ActiveTask | null,
  turns: readonly TurnView[],
): CurrentContext | null {
  if (!workingSet) return null;
  const task = activeTask ? TASK_WORD[activeTask] ?? null : null;
  const selected = workingSet.selectedInquiry ?? null;
  if (selected) {
    const named = nameSelected(turns, selected.inquiryId);
    const meta = [named?.channelNameKo, named?.productName].filter(Boolean).join(" · ");
    return {
      kind: "ANCHOR",
      // A thread reloaded past its persisted-artifact window can hold an anchor it can no longer name.
      // 「선택한 문의」 is true then; a made-up title would not be.
      label: named?.title?.trim() || "선택한 문의",
      meta: meta || null,
      task,
      to: named?.to ?? null,
      clearable: true,
    };
  }
  // A set of one is not a set the seller chose between — but it is still what is on screen, and saying
  // so is how 「그중」 stays meaningful. Zero rows is nothing to hold.
  if (workingSet.count === 0) return null;
  return { kind: "SET", label: SET_LABEL[workingSet.kind], meta: setMeta(workingSet), task, to: null, clearable: false };
}
