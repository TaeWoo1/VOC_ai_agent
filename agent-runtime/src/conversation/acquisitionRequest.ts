/**
 * <b>Did the seller ASK for the collection, or ask a question about it?</b>
 *
 * 「네이버 리뷰 최신화해줘」 and 「오늘 네이버 리뷰 있어?」 reach the same place — stale rows, a channel
 * whose only path is a guided run — and until now they got the same card: a button saying 최신 리뷰
 * 가져오기, under a sentence the seller had just written in the imperative. A seller who has already
 * said "do it" and is handed a button that says "do it" has been asked to say it twice.
 *
 * <b>A press is still what authorizes the seller center to open — and the press already happened.</b>
 * This module decides one thing: whether the sentence IS that instruction. It never widens what may be
 * done. A guided acquisition is a READ the seller performs in their own window, nothing is clicked or
 * downloaded for them, and every marketplace WRITE, composer fill and submission keeps the approval it
 * has (`docs/sellerops_live_approval_contract.md` — none of those paths reads this file).
 *
 * <b>Closed vocabulary, and a question is never an instruction.</b> The reader wants an action word AND
 * the object it acts on, and refuses anything shaped like a question — 「가져올 수 있어?」 is asking what
 * the product can do, and answering it by opening a browser window is worse than answering it wrong.
 */

/** The verbs that ASK for a fetch. Stems, so the polite and plain endings are one entry each. */
const ACTION_WORDS = [
  "최신화",
  "새로 가져",
  "새로가져",
  "다시 가져",
  "다시가져",
  "가져와",
  "가져다",
  "가져오기",
  "가져올게",
  "갱신",
  "업데이트",
  "동기화",
  "수집해",
  "불러와",
  "받아와",
];

/** What may be acquired this way. Reviews only: no other data type has a guided acquisition to start. */
const OBJECT_WORDS = ["리뷰", "후기"];

/**
 * Operational objects that are NOT reviews. A sentence that names one of these is about that thing, so the
 * conversation's review rows may not stand in as its object — 「문의 최신화해줘」 after a review list is a
 * request about inquiries, and answering it by opening the review export would be the demonstrative
 * quietly changing what it points at.
 */
const OTHER_OBJECT_WORDS = ["문의", "주문", "상품", "정책", "지식", "매출"];

/**
 * Endings and words that make the sentence a QUESTION about the action rather than the action.
 * 「가져올 수 있어?」·「최신화 되나?」·「업데이트 언제 했어?」 all ask; none instructs.
 */
const QUESTION_WORDS = ["있어", "있나", "있을까", "될까", "되나", "되니", "가능", "어때", "언제", "why", "?"];

/**
 * Does this sentence instruct reviewnary to go and collect reviews now?
 *
 * <b>The object may be the conversation's.</b> 「그럼 최신화해줘」 said under a list of reviews is the same
 * instruction as 「리뷰 최신화해줘」 — that is how people talk, and refusing to read it means the seller has
 * to name the thing they are looking at. The context may only SUPPLY a missing object, never override one:
 * a sentence that names another operational object is about that object, whatever is on screen.
 */
export function isAcquisitionRequest(text: string, opts?: { reviewsInContext?: boolean }): boolean {
  const s = (text ?? "").trim();
  if (s.length === 0) return false;
  const lower = s.toLowerCase();
  if (QUESTION_WORDS.some((w) => lower.includes(w))) return false;
  if (!ACTION_WORDS.some((w) => lower.includes(w))) return false;
  if (OBJECT_WORDS.some((w) => lower.includes(w))) return true;
  if (OTHER_OBJECT_WORDS.some((w) => lower.includes(w))) return false;
  return opts?.reviewsInContext === true;
}
