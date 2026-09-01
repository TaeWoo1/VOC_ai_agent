/**
 * What reviewnary can do — derived from what it is actually wired to do.
 *
 * <b>The defect this closes.</b> 「너는 어떤 일을 도와줄 수 있어?」 was planned as `EXPLAIN_CAPABILITY`,
 * which existed for exactly one shape of question — 「쿠팡 건은 왜 답변 못 해?」, a CHANNEL's capability —
 * so a question about the assistant itself came back as 「어느 채널에 대한 질문인지 알려주세요」 beside a
 * quote of the seller's own 배송 기준 (measured live, 2026-09-01). The action was right; it had one
 * answer and the question had another.
 *
 * <b>Derived, not written down.</b> A domain is said only when a REGISTERED tool serves it
 * ({@link TOOL_CAPABILITIES} ∩ the catalogue the runtime builds), and the boundary sentence is chosen
 * from the catalogue's own action classes. Add a tool with a caller and the answer gains its domain;
 * a catalogue that ever held a WRITE tool could not keep saying the read-only sentence — and it cannot
 * hold one, because {@link OperatorToolRegistry} refuses to construct with it. The seller-facing WORDS
 * are ours, as every seller sentence in this runtime is (`wording/sellerWording.ts`); what is derived
 * is which of them are true today.
 *
 * <b>What it must never become.</b> A hand-maintained feature list, or a canned reply keyed to an
 * example sentence. Both were available and both are the thing that goes stale the first time the
 * product changes.
 */
import type { SpecialistName } from "../state/OperatorState";
import type { ActionClass } from "../state/OperatorState";
import { TOOL_CAPABILITIES } from "../tools/ToolReachability";

interface Domain {
  /** The noun in the one-line answer — 「문의 · 리뷰 · 상품」. */
  readonly short: string;
  /** What is actually done with it, in the seller's words. */
  readonly line: string;
  /** A sentence this conversation already understands, offered as the next move. */
  readonly chip: string;
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
  },
  PRODUCT_OPS: {
    short: "상품",
    line: "상품별로 무엇이 쌓이고 있는지, 어떤 답변 기준이 있는지 봅니다.",
    chip: "우리 상품 목록 보여줘",
  },
  ORDER_OPS: {
    short: "주문",
    line: "주문과 매출 흐름을 기간·채널로 확인합니다.",
    chip: "최근 7일 매출 알려줘",
  },
};

/** The order a seller's day runs in — not the order of the table it is derived from. */
const ORDER: readonly SpecialistName[] = ["INQUIRY_OPS", "REVIEW_OPS", "PRODUCT_OPS", "ORDER_OPS"];

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

export interface AssistantCapabilityAnswer {
  readonly headline: string;
  readonly lines: readonly string[];
  readonly chips: readonly string[];
}

/**
 * The whole answer, composed.
 *
 * `connectedChannels` is the one part that is a claim about the seller's business, and it comes from a
 * real org-scoped read. `null` = that read was not made or failed, and then the answer simply does not
 * mention channels — an assistant that invents which channels are connected is worse than one that
 * talks only about itself.
 */
export function assistantCapabilityAnswer(
  registeredTools: readonly string[],
  actionClasses: readonly ActionClass[],
  connectedChannels: readonly string[] | null,
): AssistantCapabilityAnswer {
  const domains = capabilityDomains(registeredTools);
  const headline = domains.length > 0
    ? `${domains.map((d) => d.short).join(" · ")}을 대신 확인하고, 다음에 하실 일까지 준비해 드립니다.`
    : "지금은 확인해 드릴 수 있는 항목이 없습니다.";
  const channels = connectedChannels == null
    ? []
    : connectedChannels.length > 0
      ? [`지금 연결된 채널은 ${connectedChannels.join(" · ")}입니다.`]
      : ["아직 연결된 판매 채널이 없어, 채널을 연결하시면 여기서 바로 확인해 드릴 수 있습니다."];
  return {
    headline,
    lines: [...domains.map((d) => d.line), ...channels, boundarySentence(actionClasses)],
    chips: domains.map((d) => d.chip),
  };
}
