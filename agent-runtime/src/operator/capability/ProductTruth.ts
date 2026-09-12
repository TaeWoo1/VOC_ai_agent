/**
 * <b>What reviewnary can do, per OPERATING OBJECT and per CHANNEL — one normalized model.</b>
 *
 * <b>The defect this closes (Product Self-Knowledge Truth Closure v1).</b> Manual QA on a clean seller
 * produced seven product sentences that were each grounded in a line of the fact sheet and wrong as
 * stated. They failed one way, seven times: a fact the sheet held PER CHANNEL, PER OBJECT or as a
 * CAPABILITY came back as a claim about the whole product in the present tense —
 * 「자동으로 문의·리뷰·주문을 가져와 읽고」 with 「네이버·쿠팡 리뷰 가져오기 — 판매자님이 …확인해 주시면」 two
 * lines below it; 「다루는 영역은 문의·리뷰·상품·주문뿐」 from a derived list; 「채널 밖의 자료는 보지
 * 못합니다」 from a hand-written line that contradicted its own neighbour about answer bases.
 *
 * <b>The audit found the shape, not the wording.</b> Three structural holes made the collapse the
 * likeliest reading of the sheet:
 *
 * <ul>
 *   <li><b>PRODUCT had no channel axis at all</b> — absent from the coverage table, from the capability
 *       overview, from the acquisition registry and from the routine types. One of the four operating
 *       objects was asserted and could not be checked against any channel.</li>
 *   <li><b>ORDER had no per-channel line</b> — it appeared in a channel's 「…을 가져옵니다」 list and then
 *       in no acquisition or execution row, so nothing said whether it was automatic.</li>
 *   <li><b>「자동」 was one word for three different facts</b> — a channel CAN be polled, a deployment IS
 *       running the scheduler, and a seller HAS connected and been provisioned. Only the third was
 *       readable, and it reports an enabled schedule ROW, which stays true in a process whose scheduler
 *       bean does not exist. That combination is live today.</li>
 * </ul>
 *
 * <b>So this file resolves (channel × object) into a small closed vocabulary and owns the sentences
 * for it.</b> Every value is derived from a source that already exists — the live capability overview,
 * the reference table beside it, the audited inquiry transports, the review channel capability, the
 * turn's coverage snapshot, and the deployment's own collection posture. Nothing here is a written-down
 * capability list, and nothing here reads the seller's words.
 *
 * <b>Two rules the values enforce rather than describe.</b> A capability is never stated more strongly
 * than its weakest source ({@link supportOf}: two disagreeing sources make `PARTIAL`, never the
 * stronger one). And a capability sentence never claims the present tense: 「자동으로 가져올 수 있습니다」
 * is the channel's, 「지금 자동으로 가져오고 있습니다」 needs the runtime and the seller too, and those
 * are said by {@link runtimeCollectionFact} and {@link sellerCollectionFact}.
 */
import type { ChannelCoverageRow, CollectionPostureView } from "../../spring/types";
import type { ActionClass } from "../state/OperatorState";
import type { ChannelCapabilitySources, ChannelCapabilityVerdict, SupportVerdict } from "./ChannelCapability";
import { EXECUTION_REASON, SUPPORT_REASON, acquisitionOf, inquiryExecutionOf, reviewExecutionOf, supportOf } from "./ChannelCapability";
import type { SellerReadiness } from "./SellerReadiness";
import { withObject } from "../../korean";

/* ─────────────────────────────── the four operating objects ─────────────────────────────── */

/**
 * The product's operating objects. FOUR, and this is a product-level classification — it does not say
 * that every channel serves all four, which is exactly what the per-channel truth below is for.
 *
 * SALES is deliberately not one of them: a sales trend is a derived measure of ORDER, and adding it
 * here would put a fifth noun in every seller sentence for a thing that is not a separate object.
 */
export type OperatingObject = "INQUIRY" | "REVIEW" | "PRODUCT" | "ORDER";

/** The order a seller's day runs in — the same order the domain list uses. */
export const OPERATING_OBJECTS: readonly OperatingObject[] = ["INQUIRY", "REVIEW", "PRODUCT", "ORDER"];

/** The seller-facing noun. One place, so a channel line and a domain line cannot call it two things. */
export const OBJECT_WORD: Readonly<Record<OperatingObject, string>> = {
  INQUIRY: "문의", REVIEW: "리뷰", PRODUCT: "상품", ORDER: "주문",
};

/** The collected data type each object is stored as. ORDER is `ORDER_SUMMARY` in every registry. */
export const OBJECT_DATA_TYPE: Readonly<Record<OperatingObject, "INQUIRY" | "REVIEW" | "PRODUCT" | "ORDER_SUMMARY">> = {
  INQUIRY: "INQUIRY", REVIEW: "REVIEW", PRODUCT: "PRODUCT", ORDER: "ORDER_SUMMARY",
};

/** The data types the coverage snapshot carries — PRODUCT is not one, and its absence is UNKNOWN. */
const COVERED_DATA_TYPES = new Set(["INQUIRY", "REVIEW", "ORDER_SUMMARY"]);

/**
 * <b>Objects a seller can be answered ABOUT but never answers ON.</b>
 *
 * A product and an order have no reply. Saying so once, as a product fact, is both shorter and more
 * honest than six per-channel rows repeating 「보내는 동작이 없습니다」 — and it keeps the per-channel
 * execution rows to the two objects where channels genuinely differ.
 */
const READ_ONLY_OBJECTS: ReadonlySet<OperatingObject> = new Set<OperatingObject>(["PRODUCT", "ORDER"]);

/* ─────────────────────────────── inputs ─────────────────────────────── */

/** Everything the product answers are derived from. Every field is a read the turn already makes. */
export interface SelfKnowledgeInputs {
  readonly registeredTools: readonly string[];
  readonly actionClasses: readonly ActionClass[];
  readonly readiness: SellerReadiness;
  readonly coverage: readonly ChannelCoverageRow[] | null;
  /** Does this DEPLOYMENT collect on its own — `null` when the read failed or the backend predates it. */
  readonly posture?: CollectionPostureView | null;
}

/* ─────────────────────── channels, from the coverage snapshot ─────────────────────── */

const WORK_WORD: Readonly<Record<string, string>> = { INQUIRY: "문의", REVIEW: "리뷰", ORDER_SUMMARY: "주문" };

export interface ChannelOffer {
  readonly code: string;
  readonly name: string;
  readonly connected: boolean;
  /** The seller-facing names of the data types THIS channel declares — never a written list. */
  readonly works: readonly string[];
}

/**
 * Which channels this deployment can work with, and what each one offers.
 *
 * The rows are the turn's own coverage snapshot, so this costs nothing and cannot disagree with the
 * connection screen. A channel with no offered type is still listed: 「지원한다」 and 「이 채널에서 리뷰를
 * 가져올 수 있다」 are different claims and the second is per-type.
 *
 * <b>PRODUCT is deliberately absent from `works`.</b> The coverage table does not carry it, and putting
 * 상품 in this list on the strength of a different read would make one sentence answer two questions.
 * The per-object truth below is where PRODUCT is answered, from the capability overview.
 */
export function channelOffers(coverage: readonly ChannelCoverageRow[] | null): readonly ChannelOffer[] {
  if (!coverage || coverage.length === 0) return [];
  const byCode = new Map<string, { name: string; connected: boolean; works: string[] }>();
  for (const row of coverage) {
    const code = row.channelCode.toUpperCase();
    const entry = byCode.get(code)
      ?? { name: row.channelNameKo ?? row.channelCode, connected: false, works: [] };
    if (row.connected) entry.connected = true;
    const word = WORK_WORD[row.dataType.toUpperCase()];
    if (row.supported && word && !entry.works.includes(word)) entry.works.push(word);
    byCode.set(code, entry);
  }
  return [...byCode.entries()].map(([code, e]) => ({ code, name: e.name, connected: e.connected, works: e.works }));
}

/* ─────────────────────────── (channel × object) truth ─────────────────────────── */

/**
 * How an approved answer reaches this channel for this object — the closed vocabulary the product
 * decision names.
 *
 * `SELLER_FINAL_SUBMIT` and `PREPARE_ONLY` are not the same state and the difference is what a seller
 * does next: the first means we prepare a draft and the seller posts it themselves (a route exists and
 * it runs through their hands); the second means a draft can be prepared and this deployment cannot say
 * how it would reach the channel. `NOT_SUPPORTED` is the channel refusing, not us.
 */
export type ExecutionMode =
  | "READ_ONLY"
  | "PREPARE_ONLY"
  | "DIRECT_WITH_APPROVAL"
  | "GUIDED_WITH_APPROVAL"
  | "SELLER_FINAL_SUBMIT"
  | "NOT_SUPPORTED"
  | "UNKNOWN";

export interface ChannelObjectTruth {
  readonly channelCode: string;
  readonly channelName: string;
  readonly object: OperatingObject;
  readonly connected: boolean;
  /** How strongly this channel can be said to serve the object, and why it is not SUPPORTED. */
  readonly support: SupportVerdict;
  /** The channel's own acquisition capability — never the deployment's current behaviour. */
  readonly acquisition: ChannelCapabilityVerdict["acquisition"];
  readonly guidedPath: ChannelCapabilityVerdict["guidedPath"];
  readonly execution: ExecutionMode;
  /** Closed diagnostic reason behind `execution`; never rendered verbatim. */
  readonly executionReason: string | null;
}

/** One channel's four objects, resolved from the sources the caller already read. */
export function channelObjectTruths(
  code: string, name: string, sources: ChannelCapabilitySources, connected: boolean,
): readonly ChannelObjectTruth[] {
  return OPERATING_OBJECTS.map((object) => {
    const dataType = OBJECT_DATA_TYPE[object];
    const acquisition = acquisitionOf(code, dataType, sources);
    return {
      channelCode: code.toUpperCase(),
      channelName: name,
      object,
      connected,
      support: supportOf(code, dataType, sources),
      acquisition: acquisition.acquisition,
      guidedPath: acquisition.guidedPath,
      ...executionOf(object, code, sources),
    };
  });
}

function executionOf(
  object: OperatingObject, code: string, sources: ChannelCapabilitySources,
): { execution: ExecutionMode; executionReason: string | null } {
  if (READ_ONLY_OBJECTS.has(object)) {
    return { execution: "READ_ONLY", executionReason: null };
  }
  if (object === "REVIEW") {
    // A marketplace that gives sellers no reply feature is a CHANNEL fact, knowable before anyone
    // connects. Without this the verdict for an unconnected Coupang would be «확인하지 못했다», and
    // Coupang review would fall into the 「초안을 복사해 올리시면 됩니다」 group it must never be in.
    if ((sources.overview?.unsupportedScopes ?? []).some((s) => s.code.toUpperCase() === "REVIEW_REPLY")) {
      return { execution: "NOT_SUPPORTED", executionReason: EXECUTION_REASON.CHANNEL_UNSUPPORTED };
    }
    return modeOf(reviewExecutionOf(sources));
  }
  const rows = (sources.transports ?? []).filter((r) => r.channelCode.toUpperCase() === code.toUpperCase());
  // A channel whose subtypes agree has one answer even though no object was named; subtypes that
  // disagree stay unknown rather than picking one — the per-object lane is where a subtype is chosen.
  const verdicts = rows.length > 0
    ? rows.map((r) => inquiryExecutionOf(code, r.sourceSubtype ?? null, sources))
    : [inquiryExecutionOf(code, null, sources)];
  const first = verdicts[0]!;
  const agree = verdicts.every((v) => v.execution === first.execution && v.reason === first.reason);
  return agree
    ? modeOf(first)
    : { execution: "UNKNOWN", executionReason: EXECUTION_REASON.CAPABILITY_UNKNOWN };
}

function modeOf(
  verdict: { execution: string; reason: string | null },
): { execution: ExecutionMode; executionReason: string | null } {
  if (verdict.execution === "API_EXECUTION") {
    return { execution: "DIRECT_WITH_APPROVAL", executionReason: null };
  }
  if (verdict.execution === "GUIDED_BROWSER_EXECUTION") {
    return { execution: "GUIDED_WITH_APPROVAL", executionReason: null };
  }
  const reason = verdict.reason ?? EXECUTION_REASON.CAPABILITY_UNKNOWN;
  if (reason === EXECUTION_REASON.CHANNEL_UNSUPPORTED || reason === "UNSUPPORTED") {
    return { execution: "NOT_SUPPORTED", executionReason: reason };
  }
  // The audited transport exists and this deployment has not turned it on, or the platform publishes
  // one we have not built. Either way the answer reaches the channel through the seller's own hands.
  if (reason === EXECUTION_REASON.EXECUTION_DISABLED || reason === "PLATFORM_SUPPORTED_NOT_IMPLEMENTED") {
    return { execution: "SELLER_FINAL_SUBMIT", executionReason: reason };
  }
  return { execution: "UNKNOWN", executionReason: reason };
}

/* ─────────────────────────────── sentences ─────────────────────────────── */

/**
 * <b>The acquisition sentence is about the CHANNEL, in the potential mood.</b>
 *
 * 「자동으로 가져옵니다」 was a present-tense claim built from a capability word, and it was false in a
 * deployment whose scheduler is not running — which is the deployment that produced the QA. What this
 * verdict can honestly say is what the channel allows; whether it is happening is
 * {@link runtimeCollectionFact} and {@link sellerCollectionFact}, and they say it once.
 */
export function acquisitionSentence(truth: ChannelObjectTruth): string {
  if (truth.support.support === "UNKNOWN") {
    return "지금은 가져올 수 있는지 확인하지 못했습니다";
  }
  const base = truth.acquisition === "AUTOMATIC"
    ? "자동으로 가져올 수 있습니다"
    : truth.acquisition === "GUIDED_HUMAN_ACTION"
      ? (truth.guidedPath === "FILE_UPLOAD"
        ? "판매자님이 파일로 올려 주시면 가져옵니다"
        : "판매자님이 판매자센터에서 한 번 확인해 주시면 이어서 가져옵니다")
      : "아직 가져올 경로가 없습니다";
  return base + qualifier(truth.support);
}

/** What a PARTIAL adds to a capability sentence — the honest half-step, never a stronger word. */
function qualifier(support: SupportVerdict): string {
  if (support.support !== "PARTIAL") return "";
  if (support.reason === SUPPORT_REASON.SOURCE_DIVERGENCE) {
    return " (다만 어디까지 되는지는 아직 확실하게 확인되지 않았습니다)";
  }
  if (support.reason === SUPPORT_REASON.NEEDS_VERIFICATION) {
    return " (다만 실제로 확인된 범위는 아직 일부입니다)";
  }
  return "";
}

/**
 * <b>How an approved answer gets to the channel — and who performs the last step.</b>
 *
 * 「reviewnary는 직접 보내거나 수정하지 않습니다」 is the sentence this replaces. It was true about the
 * chat lane and false about the product: an approved Cafe24 inquiry answer and an approved NAVER
 * 상품문의 answer have both been posted live by this repository. So the boundary a seller needs is not
 * 「보내지 않는다」 but 「확인하시기 전에는 하지 않고, 확인하신 뒤에 무엇이 일어나는지는 채널마다 다르다」.
 */
export function executionSentence(truth: ChannelObjectTruth): string {
  switch (truth.execution) {
    case "READ_ONLY":
      return "확인하고 정리하는 대상이라 채널로 내보내는 동작이 없습니다";
    case "DIRECT_WITH_APPROVAL":
      return "판매자님이 확인하고 승인하시면 reviewnary가 채널에 등록하고 결과를 확인합니다";
    case "GUIDED_WITH_APPROVAL":
      return "판매자님이 승인하시면 reviewnary가 그 자리를 찾아 초안을 채워 두고, 등록 버튼은 판매자님이 누르십니다";
    case "SELLER_FINAL_SUBMIT":
      return "초안까지 준비해 드리고, 채널에 올리는 마지막 단계는 판매자님이 하십니다";
    case "NOT_SUPPORTED":
      return "이 채널에는 판매자가 답을 남기는 기능이 없어, 답변 초안도 준비하지 않습니다";
    case "PREPARE_ONLY":
      return "초안까지 준비해 드릴 수 있고, 채널로 보내는 경로는 아직 없습니다";
    default:
      return truth.connected
        ? "지금은 어떻게 보낼 수 있는지 확인하지 못했습니다"
        : "연결하신 뒤에 확인해 드릴 수 있습니다";
  }
}

/* ───────────────────────── runtime posture and seller state ───────────────────────── */

/**
 * <b>Does this DEPLOYMENT collect on its own — layer B of the three.</b>
 *
 * `null` posture is UNKNOWN and says so: a read that failed is not evidence that nothing runs. The
 * sentence never names the switch — a seller cannot act on a configuration key, and printing one is
 * the internal-word defect this runtime already refuses elsewhere.
 */
export function runtimeCollectionFact(posture: CollectionPostureView | null | undefined): string {
  if (posture == null) {
    return "지금 정기 수집이 실제로 돌고 있는지는 확인하지 못했습니다.";
  }
  return posture.schedulerRunning
    ? "이 서비스는 연결된 채널을 정기적으로 다시 확인하도록 실행되고 있습니다."
    : "지금 이 서비스는 정기 수집을 실행하고 있지 않아, 새 자료는 수집을 실행할 때 들어옵니다.";
}

/**
 * <b>Is work being prepared before the seller asks for it — the same question, one layer up.</b>
 *
 * The ledger's own feature row says out loud that it cannot answer this: whether preparing tomorrow's
 * work is switched on is a deployment fact. Without a reading the Agent said 「이 환경에서 켜져 있는지는
 * 여기서 확인되지 않습니다」 about something this process knows, so the reading is here and the sentence
 * is exact.
 *
 * <b>Silence when it is unread, and that is the point.</b> A backend older than this field sends
 * nothing; guessing 「꺼져 있습니다」 from an absent boolean would be this layer inventing an outage, and
 * saying 「모릅니다」 would put our plumbing into a seller's answer. Neither is worth a sentence.
 */
export function proactivePostureFact(
  posture: CollectionPostureView | null | undefined,
): string | null {
  if (posture == null || posture.proactiveRunning == null) return null;
  return posture.proactiveRunning
    ? "이 환경에서는 오늘 확인할 일을 미리 조사해 두는 기능이 켜져 있습니다."
    : "이 환경에서는 오늘 확인할 일을 미리 조사해 두는 기능이 켜져 있지 않습니다.";
}

/**
 * <b>Is it happening for THIS seller — layer C.</b>
 *
 * The old rule returned nothing at all when no channel was connected, which left 「자동」 unqualified for
 * the one seller who is deciding whether to connect. It now always says something, and what it says
 * needs all three layers to be true before it uses the present tense.
 */
export function sellerCollectionFact(
  coverage: readonly ChannelCoverageRow[] | null, posture: CollectionPostureView | null | undefined,
): string {
  if (!coverage || coverage.length === 0) {
    return "지금 이 회사의 수집 상태는 확인하지 못했습니다.";
  }
  const connected = coverage.filter((r) => r.connected);
  if (connected.length === 0) {
    return "아직 연결한 판매 채널이 없어, 지금 자동으로 가져오고 있는 자료는 없습니다.";
  }
  const routine = connected.filter((r) => r.routineEnabled && COVERED_DATA_TYPES.has(r.dataType.toUpperCase()));
  if (posture == null || !posture.schedulerRunning || routine.length === 0) {
    return "연결은 돼 있지만, 지금 자동으로 다시 확인하고 있는 채널은 없습니다 — 새 자료는 수집을 실행할 때 들어옵니다.";
  }
  const names = [...new Set(routine.map((r) => r.channelNameKo ?? r.channelCode))];
  const works = [...new Set(routine.map((r) => WORK_WORD[r.dataType.toUpperCase()]).filter(Boolean))];
  return `지금은 ${names.join(" · ")}의 ${withObject(works.join(" · "))} 정기적으로 다시 확인하고 있어,`
    + " 판매자님이 매번 누르지 않아도 새 자료가 들어옵니다.";
}
