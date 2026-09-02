/**
 * <b>The channel the conversation is about, and how long it stays that.</b>
 *
 * <b>The defect this closes is not a renderer's.</b> Observed 2026-09-02: 「네이버 최신 리뷰 확인해줘」
 * answered with NAVER rows, and the very next sentence — 「오늘 들어온 리뷰 있나?」 — came back with a
 * Cafe24 inquiry list above it and human-action cards for NAVER *and* Coupang. The previous package hid
 * the foreign card; the read underneath was still org-wide. Hiding a card that a read produced is not
 * continuity, it is a different answer with one column painted over.
 *
 * <b>Focus is the last channel the SELLER named.</b> Not the last channel an answer happened to draw:
 * an answer's channels are ours, a sentence's channel is theirs, and a scope inherited from our own
 * output would narrow the seller's next question by something they never said. Derived from the
 * transcript on every turn, so it survives reload and needs no stored field — the same choice
 * `ContextBar`'s label makes about the anchored object.
 *
 * <b>It only ever fills a hole.</b> A plan that names a channel keeps it (the sentence said so); a
 * sentence that asks for every channel clears the focus; a plan with no channel and a focus in the
 * thread gets the focus. So the failure direction is "not narrowed", never "narrowed to the wrong one".
 */
import type { InvestigationPlan, PlanFilters } from "../operator/plan/InvestigationPlan";
import type { SentenceSubject } from "../operator/plan/scopeOverride";
import { scopeOverrideOf } from "../operator/plan/scopeOverride";
import type { TurnView, WorkingSetView } from "./contract";

/** The seller's own words for a channel → its code. Closed: a word not here names no channel. */
const CHANNEL_WORDS: ReadonlyArray<readonly [string, string]> = [
  ["스마트스토어", "NAVER"],
  ["스마트 스토어", "NAVER"],
  ["네이버", "NAVER"],
  ["naver", "NAVER"],
  ["쿠팡", "COUPANG"],
  ["coupang", "COUPANG"],
  ["카페24", "CAFE24"],
  ["카페 24", "CAFE24"],
  ["cafe24", "CAFE24"],
];

/** 「전체 채널」 — the sentence that ends a focus. Deliberately narrow: only phrases that say ALL of them. */
const ALL_CHANNELS = ["전체 채널", "모든 채널", "채널 전체", "채널별", "전 채널", "채널 다"];

/**
 * The one channel this sentence names, or null.
 *
 * Two different channels in one sentence name none: 「네이버랑 쿠팡 비교해줘」 is a question about both,
 * and answering it about the first one mentioned would be the wrong kind of confident.
 */
export function channelInSentence(text: string): string | null {
  const lower = (text ?? "").toLowerCase();
  const found = new Set<string>();
  for (const [word, code] of CHANNEL_WORDS) {
    if (lower.includes(word)) found.add(code);
  }
  return found.size === 1 ? [...found][0]! : null;
}

/** Does the sentence ask about every channel? Then no focus may narrow it. */
export function namesAllChannels(text: string): boolean {
  const lower = (text ?? "").toLowerCase();
  return ALL_CHANNELS.some((w) => lower.includes(w));
}

/** How far back a focus may reach. A thread older than this has moved on. */
const FOCUS_DEPTH = 20;

/**
 * The channel in focus for the turn being planned — the newest seller sentence that settles the
 * question, reading backwards. 「전체 채널」 settles it as "none" just as firmly as naming one settles it.
 */
export function channelFocusOf(turns: readonly TurnView[], currentText?: string | null): string | null {
  const said = [...turns.filter((t) => t.role === "USER").map((t) => t.text ?? "")];
  if (currentText != null) said.push(currentText);
  let seen = 0;
  for (let i = said.length - 1; i >= 0 && seen < FOCUS_DEPTH; i -= 1, seen += 1) {
    const text = said[i] ?? "";
    if (namesAllChannels(text)) return null;
    const named = channelInSentence(text);
    if (named) return named;
  }
  return null;
}

/**
 * The focus this turn may actually use.
 *
 * <b>A question that voided its own refine is a new question of the ORG</b> (Conversation Core v1 §9): the
 * planner marked it a follow-up, the override proved it was not, and the inherited axes were dropped for
 * exactly the reason a channel must not come back — 「최근 문의 7개 보여줘」 after a NAVER list is a request
 * for seven of the org's inquiries. Re-supplying the channel from the transcript would reintroduce that
 * defect one layer up, so a voided refine takes the focus with it.
 *
 * Every other turn keeps it: a follow-up that stands, and a plain new read that named no channel, are both
 * questions asked inside a conversation that is about one channel.
 */
export function focusForAxis(
  plan: InvestigationPlan, workingSet: WorkingSetView | null, subject: SentenceSubject | undefined,
  goalText: string | null | undefined, focus: string | null,
): string | null {
  if (!focus) return null;
  const reason = scopeOverrideOf(plan, workingSet, subject, goalText ?? undefined);
  return reason == null || FOCUS_SURVIVES.has(reason) ? focus : null;
}

/**
 * The two overrides that do NOT mean "a new question of the org".
 *
 * `EMPTY_SET` fires on a sentence that IS a refine and only lacks rows to refine; `ACQUISITION_REQUEST`
 * fires on an instruction to collect, which is about the channel in focus and nothing else — dropping the
 * focus there would send 「그럼 최신화해줘」 at every channel the seller has.
 */
const FOCUS_SURVIVES: ReadonlySet<string> = new Set(["EMPTY_SET", "ACQUISITION_REQUEST"]);

/** Fill the plan's channel axis from the thread's focus — never replace one the plan already carries. */
export function withChannelFocus<T extends { filters: PlanFilters }>(axis: T, focus: string | null): T {
  if (!focus || axis.filters.channel != null) return axis;
  return { ...axis, filters: { ...axis.filters, channel: focus } };
}
