/**
 * What reviewnary can do — derived from what it is actually wired to do, said for the state this
 * seller is actually in.
 *
 * <b>The defect this closes (v1).</b> 「너는 어떤 일을 도와줄 수 있어?」 was planned as `EXPLAIN_CAPABILITY`,
 * which existed for exactly one shape of question — 「쿠팡 건은 왜 답변 못 해?」, a CHANNEL's capability —
 * so a question about the assistant itself came back as 「어느 채널에 대한 질문인지 알려주세요」 beside a
 * quote of the seller's own 배송 기준 (measured live, 2026-09-01). The action was right; it had one
 * answer and the question had another.
 *
 * <b>The defect this closes (v2, first-use).</b> Measured live on a clean org (2026-09-05), two
 * different questions one turn apart — 「이 서비스를 통해 할 수 있는 일이 뭐야?」 and 「아직 쇼핑몰을
 * 연결하지 않았는데 어떻게 시작해?」 — came back with the SAME eight-line brochure. The trace says why and
 * it is not history, not a fallback and not the planner misreading: both plans were
 * `EXPLAIN_CAPABILITY` with `informationNeeds: 0`, and the one answer this file composed was a pure
 * function of the tool catalogue plus a coverage read — it took no input from the seller's sentence and
 * no input from what the conversation had already said, so identical inputs produced an identical
 * answer. Two things follow, and both are structural rather than a wording exception:
 *
 * <ul>
 *   <li><b>The answer is shaped by readiness.</b> A seller with nothing connected is told what
 *       connecting hands over and given the one action that exists; the chips stop being 「답변 안 한
 *       문의 보여줘」, which that seller cannot ask.</li>
 *   <li><b>A fact is said once</b> (the rule this repository already applies to titles, shared words and
 *       collection state). The capability card is drawn once; asking again is answered with the next
 *       step instead of the same list. <b>Narrowed on 2026-09-07</b> — see the closing note: keyed per
 *       conversation, this rule made every later product question return one fixed answer.</li>
 * </ul>
 *
 * <b>Derived, not written down.</b> A domain is said only when a REGISTERED tool serves it
 * ({@link TOOL_CAPABILITIES} ∩ the catalogue the runtime builds), the boundary sentence is chosen from
 * the catalogue's own action classes, and the channels named in the getting-started answer come from the
 * coverage table rather than a list in this file. Add a tool with a caller and the answer gains its
 * domain; a catalogue that ever held a WRITE tool could not keep saying the read-only sentence — and it
 * cannot hold one, because {@link OperatorToolRegistry} refuses to construct with it. The seller-facing
 * WORDS are ours, as every seller sentence in this runtime is (`wording/sellerWording.ts`); what is
 * derived is which of them are true today.
 *
 * <b>What it must never become.</b> A hand-maintained feature list, or a canned reply keyed to an
 * example sentence. Both were available and both are the thing that goes stale the first time the
 * product changes. Nothing here reads the seller's words.
 *
 * <b>Where the sentences went (2026-09-07).</b> This file is now the DERIVATION only — which domains
 * are real, and what the boundary is. The answers themselves live in
 * {@link ../capability/ProductSelfKnowledge}, because 「뭘 할 수 있어?」 turned out to be one of five
 * different product questions and this file could only ever answer it as one. Keeping a second copy of
 * 「연결부터 하시면 됩니다」 here would be the same defect the split closes.
 */
import type { SpecialistName } from "../state/OperatorState";
import type { ActionClass } from "../state/OperatorState";
import { TOOL_CAPABILITIES } from "../tools/ToolReachability";
import { OPERATOR_TOOL } from "../tools/OperatorTools";
import type { OperatorToolName } from "../tools/OperatorTools";
import { CONNECT_STEP } from "../procedure/Procedure";

interface Domain {
  /** The noun in the one-line answer — 「문의 · 리뷰 · 상품」. */
  readonly short: string;
  /** What is actually done with it, in the seller's words. */
  readonly line: string;
  /** A sentence this conversation already understands, offered as the next move. */
  readonly chip: string;
  /**
   * One more thing this domain can do — said only when the tool behind it is REGISTERED, and said as a
   * CLAUSE of the domain's own item rather than a line of its own.
   *
   * <b>Why a per-tool clause rather than a longer `line`.</b> The domain line is true as soon as the
   * specialist owns any tool; a capability that arrives with ONE read (an exact single review, the
   * catalogue) would otherwise either be missing from the answer or promised before it existed. This
   * keeps the answer derived at the granularity the catalogue actually changes at.
   *
   * <b>Why a clause and not a second bullet.</b> Six bullets for four domains is the document shape
   * this answer was reported for; one scannable item per domain is the shape it is now, and the
   * derivation is unchanged — the clause still appears only when its tool is registered.
   */
  readonly extra?: { readonly tool: OperatorToolName; readonly line: string };
}

/**
 * One entry per specialist that can own a tool. Presence in the ANSWER is decided by the catalogue;
 * this table only says how a present domain is described.
 */
const DOMAIN: Partial<Record<SpecialistName, Domain>> = {
  INQUIRY_OPS: {
    short: "문의",
    line: "고객 문의를 확인하고, 등록해 두신 기준으로 답변 초안까지 준비합니다.",
    chip: "답변 안 한 문의 보여줘",
  },
  REVIEW_OPS: {
    short: "리뷰",
    line: "새 리뷰와 반복해서 올라오는 문제를 찾아 드립니다.",
    chip: "별점 낮은 리뷰 보여줘",
    // Agent Object v1 — true only once the exact single-review read is in the catalogue.
    extra: {
      tool: OPERATOR_TOOL.GET_REVIEW_DETAIL,
      line: "리뷰 하나를 고르시면 그 리뷰만 따로 봐 드립니다.",
    },
  },
  PRODUCT_OPS: {
    short: "상품",
    line: "상품별로 무엇이 쌓이고 있는지, 어떤 답변 기준이 있는지 봅니다.",
    chip: "우리 상품 목록 보여줘",
    extra: {
      tool: OPERATOR_TOOL.LIST_PRODUCTS,
      line: "등록된 상품 목록도 바로 보여 드립니다.",
    },
  },
  ORDER_OPS: {
    short: "주문",
    line: "주문과 매출 흐름을 기간·채널로 확인합니다.",
    chip: "최근 7일 매출 알려줘",
  },
};

/** The order a seller's day runs in — not the order of the table it is derived from. */
const ORDER: readonly SpecialistName[] = ["INQUIRY_OPS", "REVIEW_OPS", "PRODUCT_OPS", "ORDER_OPS"];

/**
 * The one action a seller with no connected channel has, and the only screen that performs it —
 * re-exported from {@link CONNECT_STEP} so the chat card and the checklist item cannot name it
 * differently (Agent Procedure Layer v1 §3).
 */
export const CONNECT_ACTION = CONNECT_STEP;

/** The domains this runtime can actually work in: a domain is real when a registered tool serves it. */
export function capabilityDomains(registeredTools: readonly string[]): Domain[] {
  const names = new Set(registeredTools);
  const owning = new Set(TOOL_CAPABILITIES.filter((row) => names.has(row.tool)).map((row) => row.specialist));
  return ORDER.filter((s) => owning.has(s)).map((s) => DOMAIN[s]).filter((d): d is Domain => d != null);
}

/**
 * The boundary, from the catalogue's action classes.
 *
 * READ-only is the shipped state and the registry enforces it; the other branch exists so that a
 * catalogue which ever held anything else could not go on saying this one.
 */
export function boundarySentence(actionClasses: readonly ActionClass[]): string {
  const readOnly = actionClasses.length > 0 && actionClasses.every((c) => c === "READ");
  return readOnly
    ? "제가 직접 채널에 보내거나 고치는 일은 없습니다 — 초안까지 준비해 두고, 보내는 것은 확인하신 뒤에 진행합니다."
    : "채널로 나가는 일은 확인하신 뒤에만 진행합니다.";
}
