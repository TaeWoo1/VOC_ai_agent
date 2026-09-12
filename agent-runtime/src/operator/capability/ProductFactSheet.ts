/**
 * <b>ProductSelfKnowledge as a GROUNDING SOURCE rather than a sentence generator.</b>
 *
 * Grounded Conversation Lane v1 §3. The file this one sits beside answers five questions, each with a
 * composed answer, and a sixth question needs a sixth token — which is the structural defect that
 * package existed to close: 「너랑 사방넷이랑 뭐가 달라?」, 「내가 매일 여기 들어와야 돼?」 and 「세 군데 다
 * 연결하면 같은 문의가 중복으로 보여?」 are three more product questions and none of them is an aspect.
 *
 * <b>So the same derivations are flattened into FACTS.</b> Every line below comes from a source of
 * truth that already exists — the registered tool catalogue, the catalogue's action classes, the
 * turn's own coverage snapshot, the capability resolver every execution path uses, and (since Product
 * Self-Knowledge Truth Closure v1) the deployment's own collection posture. Add a channel to the
 * coverage table and the sheet gains it; turn execution off in the deployment and the sheet loses the
 * promise in the same breath as the path that would have refused.
 *
 * <b>What changed in Truth Closure v1, and why the shape mattered more than the wording.</b> Manual QA
 * produced seven sentences that were each grounded in a line of this sheet and wrong as stated. The
 * sheet's own shape invited it: seven unqualified product lines came FIRST and twelve per-channel lines
 * came after, so the honest reading of the whole was the summary at the top. Three things follow:
 *
 * <ul>
 *   <li><b>Every fact carries a key</b> ({@link ProductFact}) — `NAVER.REVIEW.ACQUISITION`,
 *       `RUNTIME.COLLECTION`, `PRODUCT.APPROVAL_BOUNDARY`. Before this, a QA sentence could not be
 *       traced back to the lines it stood on; the log said `facts=29` and nothing else.</li>
 *   <li><b>The channel rows cover all four operating objects</b>, not two. PRODUCT had no per-channel
 *       answer anywhere and ORDER had no acquisition row, so both were asserted at product level and
 *       unfalsifiable per channel.</li>
 *   <li><b>The product-level lines say they are not the whole answer.</b> `PRODUCT.AREAS` states that
 *       the per-channel facts win, and no line claims exclusivity — 「…뿐입니다」 turned a derived list
 *       into a denial of capabilities this runtime holds tools for.</li>
 * </ul>
 *
 * <b>What must never happen here.</b> A fact keyed to an example sentence, or a fact nobody can check.
 * {@link STRUCTURAL_FACTS} is the one hand-written set, each entry names the code that makes it true,
 * and a test pins the COUNT so that growing it is a decision rather than a habit.
 *
 * <b>What changed when the Canonical Product Source arrived.</b> Most of what this sheet derived about
 * the PRODUCT now has a reviewed sentence behind it, and two copies of one fact in one payload is the
 * defect the ledger exists to end — the older copy is the one that goes stale. So when a canonical
 * slice is present, the derived product-level lines and the derived per-channel capability lines are
 * NOT emitted; what remains here is everything the ledger cannot know:
 *
 * <ul>
 *   <li><b>This deployment</b> — is the scheduler running, is direct execution wired ({@code RUNTIME.*}).</li>
 *   <li><b>This seller</b> — what is connected, what has been collected ({@code SELLER.*}, {@code *.OFFER}).</li>
 *   <li><b>The divergence between them</b> — {@code RUNTIME.{CH}.{OBJ}.EXECUTION}, said only when the
 *       runtime is narrower than the reviewed capability. It never rewrites the capability; it stands
 *       beside it, which is the whole shape of {@code INVARIANT.CAPABILITY_VS_STATE}.</li>
 * </ul>
 *
 * The one product fact that stays is {@code PRODUCT.OBJECT_IDENTITY}: nothing in the ledger says it,
 * and dropping a true fact because a file does not repeat it would be the wrong direction.
 */
import type { CollectionPostureView } from "../../spring/types";
import type { ChannelObjectTruth, OperatingObject, SelfKnowledgeInputs } from "./ProductTruth";
import {
  OBJECT_WORD, acquisitionSentence, channelOffers, executionSentence,
  proactivePostureFact, runtimeCollectionFact, sellerCollectionFact,
} from "./ProductTruth";
import type { CanonicalFact } from "./CanonicalProductTruth";
import { capabilityDomains, boundarySentence, supportingCapabilities } from "./AssistantCapability";
import { withObject } from "../../korean";

/**
 * The slice of the reviewed ledger this turn asked for, already selected.
 *
 * <b>Selection happens before this file, and that is the seam.</b> Which items a question may stand on
 * is decided from the planner's closed tokens (`CanonicalProductTruth.planSelection`); composing them
 * with the live state is decided here. Keeping the two apart is what lets the caller log the two layers
 * separately without either of them being re-derived.
 *
 * Absent (`null`) is a real state and not a degraded one: an older backend has no such read, and a
 * deployment whose ledger failed to load answers with an empty view. Either way the sheet falls back to
 * the derived facts it has always built — the conversation lane keeps working, it just stops standing
 * on sentences a person approved.
 */
export interface CanonicalContext {
  readonly facts: readonly CanonicalFact[];
  /**
   * Whether this deployment's live state belongs beside those facts — the selection plan's own answer.
   *
   * <b>Absent means yes</b>, because that is what almost every question needs: 「할 수 있다」 and 「지금
   * 하고 있다」 are different sentences and the overlay is what keeps them apart. It is false only for
   * the two questions that are not about now — what the product IS, and what it WILL BE — where a line
   * about this host's switches finished an answer about the product with a fact about the QA machine.
   */
  readonly runtimeOverlay?: boolean;
}

/**
 * One fact and its stable key.
 *
 * <b>The key is for us, the text is for the model.</b> Only the text is sent (`AgentConversePrompt`'s
 * payload floor is unchanged — the keys stay in this process and in the log), and the key is what makes
 * a seller-facing sentence traceable to the lines it was allowed to stand on.
 */
export interface ProductFact {
  readonly key: string;
  readonly text: string;
}

/** The axis a channel fact is about. Two, because a channel differs on exactly these two questions. */
type Axis = "ACQUISITION" | "EXECUTION";

/** `NAVER.REVIEW.ACQUISITION` — channel, object, axis. Uppercase and dotted, like every closed token. */
export function channelFactKey(channelCode: string, object: OperatingObject, axis: Axis): string {
  return `${channelCode.toUpperCase()}.${object}.${axis}`;
}

/**
 * Facts about how this product WORKS that no read returns — each one a contract this repository holds
 * somewhere, named here so a grounded answer can use it and a reader can check it.
 *
 * <b>Four, and the count is asserted.</b> The temptation this list exists to resist is the brochure:
 * every sentence added here is one nobody re-derives, and the fifth is how a fact sheet becomes a
 * feature list that goes stale the first time the product changes.
 *
 * <b>`PRODUCT.DATA_BOUNDARY` was rewritten in Truth Closure v1, and it was wrong rather than vague.</b>
 * It said 「제가 보는 자료는 이 회사의 채널에서 가져온 것뿐입니다. …채널 밖의 정보는 보지 않습니다」 while the
 * line directly above it said drafts are written from 「판매자님이 등록해 두신 답변 기준」 — which is not a
 * channel. The two sentences contradicted each other in one payload, and the false half is the one a
 * seller would act on: it tells them their own registered knowledge is not being read. What replaces it
 * names the two boundaries that ARE true — one company, and the retrievable scopes this repository
 * actually has ({@code KnowledgeScope}: PRODUCT · ORG_OPERATIONS · PAST_ANSWER, plus the company
 * profile the Agent reads on the turn that asks) — and nothing wider.
 */
export const STRUCTURAL_FACTS: ReadonlyArray<ProductFact> = [
  // `InquiryWorkItemWriter` / the connectors' ingest: an object is identified by its channel's own
  // external id under one seller account, so re-collection updates and never duplicates.
  {
    key: "PRODUCT.OBJECT_IDENTITY",
    text: "문의와 리뷰는 채널이 매긴 원본 글 단위로 저장합니다. 같은 글을 여러 번 가져와도 하나로 유지되고, 채널이 다르면 서로 다른 글로 셉니다.",
  },
  // `answer_applicability_v1` §9 / `InquiryDraftComposer`: NO_ANSWER_BASIS calls no model and saves no draft.
  {
    key: "PRODUCT.DRAFT_BASIS",
    text: "답변 초안은 판매자님이 등록해 두신 답변 기준을 근거로 만듭니다. 근거가 없으면 초안을 지어내지 않고, 어떤 기준이 없는지 말씀드립니다.",
  },
  // Every Spring read is org-scoped by the forwarded bearer; the retrievable corpora are the three
  // `KnowledgeScope` values plus the org profile `get_seller_profile` reads.
  {
    key: "PRODUCT.DATA_BOUNDARY",
    text: "제가 보는 자료는 이 회사의 것뿐입니다 — 연결한 채널에서 가져온 문의·리뷰·주문·상품과,"
      + " 이 회사가 등록해 두신 상품 정보·답변 기준·운영 기준·과거 답변·회사 소개입니다."
      + " 다른 회사의 자료는 보지 않습니다.",
  },
  // The approval invariant. `OperatorToolRegistry` refuses to construct with a non-READ tool, and the
  // send itself is the Action Executor's — bound to an approved draft version and its fingerprint.
  {
    key: "PRODUCT.APPROVAL_BOUNDARY",
    text: "외부 고객이나 판매 채널에 영향을 주는 일은 판매자님이 확인하시기 전에는 하지 않습니다."
      + " 확인하신 뒤에 reviewnary가 직접 처리할 수 있는 일과 판매자님이 마지막 단계를 완료하셔야 하는 일은"
      + " 채널과 대상에 따라 다릅니다.",
  },
];

/**
 * The whole sheet, in the order a seller learns the product: what it is, what it works with, what it
 * can and cannot do per channel and per object, what is actually running, and how it behaves.
 *
 * @param matrix the per-(channel × object) truths for the channels this deployment offers — read by
 *     the caller on the turn that needs them, from the same resolver the execution paths use
 */
export function productFactSheet(
  input: SelfKnowledgeInputs, matrix: readonly ChannelObjectTruth[],
  canonical?: CanonicalContext | null,
): ProductFact[] {
  const facts: ProductFact[] = [];
  const push = (key: string, text: string) => facts.push({ key, text });
  const offers = channelOffers(input.coverage);
  if (canonical) {
    for (const f of canonical.facts) push(f.id, f.text);
    if (canonical.runtimeOverlay !== false) facts.push(...runtimeOverlay(input, matrix, offers));
    // Not in the ledger, and true. See the class note.
    facts.push(...STRUCTURAL_FACTS.filter((f) => f.key === "PRODUCT.OBJECT_IDENTITY"));
    return facts;
  }
  const domains = capabilityDomains(input.registeredTools);

  if (domains.length > 0) {
    const nouns = domains.map((d) => d.short).join(" · ");
    push("PRODUCT.IDENTITY",
      `reviewnary는 판매자를 대신해 ${withObject(nouns)} 확인하고 정리하는 AI 운영 담당자입니다.`);
    for (const d of domains) push(`PRODUCT.AREA.${d.short}`, `${d.short} — ${d.line}`);
    // <b>Not an exclusion.</b> The old line was 「제가 다루는 영역은 …입니다. 이 목록에 없는 판매자센터
    // 작업은 하지 않습니다」, which made a derived list into a denial — and the denial was false, since
    // this runtime holds registered reads for several capabilities that are not one of the four nouns.
    // What is true and useful is the opposite instruction: the per-channel rows below win.
    push("PRODUCT.AREAS",
      `제가 다루는 핵심 운영 데이터는 ${nouns}입니다.`
      + " 다만 채널마다 되는 범위가 다르므로, 아래 채널별 사실이 이 요약보다 우선합니다.");
  }
  const supporting = supportingCapabilities(input.registeredTools);
  if (supporting.length > 0) {
    push("PRODUCT.SUPPORTING_AREAS",
      `이 밖에 ${supporting.join(" · ")}도 함께 확인합니다.`);
  }
  // Said once as a product fact rather than as six identical per-channel rows: a product and an order
  // have no reply anywhere, and repeating that per channel would crowd out the rows that differ.
  push("PRODUCT.READ_ONLY_OBJECTS",
    "상품과 주문은 확인하고 정리하는 대상입니다 — 이 둘에 대해 채널로 내보내는 동작은 하지 않습니다.");
  // The order scope, stated as its ceiling. `get_sales_trend` is the one ORDER read and it answers
  // period counts, the sales trend and the per-channel split; `ChannelOrder` holds no line item, no
  // shipping state ({PAID, UNKNOWN}) and no customer, so anything further would be invented.
  push("PRODUCT.ORDER_SCOPE",
    "주문은 기간별 주문 건수와 매출 흐름, 채널별 집계까지 확인해 드립니다."
    + " 주문에 담긴 상품 구성, 배송 상세 관리, 고객 정보, 주문 수정은 다루지 않습니다.");
  push("PRODUCT.CONVERSATION_BOUNDARY", boundarySentence(input.actionClasses));

  if (offers.length > 0) {
    push("CHANNEL.LIST", `연결할 수 있는 판매 채널은 ${offers.map((o) => o.name).join(" · ")}입니다.`);
    for (const o of offers) {
      const works = o.works.length > 0
        ? `${withObject(o.works.join(" · "))} 가져옵니다`
        : "가져올 수 있는 자료가 아직 없습니다";
      push(`${o.code}.OFFER`,
        `${o.name} — ${works}. ${o.connected ? "지금 연결돼 있습니다." : "아직 연결돼 있지 않습니다."}`);
    }
  }

  // The per-(channel × object) rows. Acquisition for all four objects; execution only for the two that
  // have one — the read-only pair is answered once above.
  for (const truth of matrix) {
    const word = OBJECT_WORD[truth.object];
    push(channelFactKey(truth.channelCode, truth.object, "ACQUISITION"),
      `${truth.channelName} ${word} 가져오기 — ${acquisitionSentence(truth)}.`);
    if (truth.execution !== "READ_ONLY") {
      push(channelFactKey(truth.channelCode, truth.object, "EXECUTION"),
        `${truth.channelName} ${word} 답변 보내기 — ${executionSentence(truth)}.`);
    }
  }

  // This shop's own state — the part of the sheet that is about the seller rather than the product.
  push("SELLER.READINESS", input.readiness.kind === "NO_CHANNEL"
    ? "이 판매자님은 아직 연결한 판매 채널이 없어, 지금은 가져와 둔 자료가 없습니다."
    : input.readiness.kind === "NO_DATA"
      ? `연결된 채널은 ${input.readiness.connected.join(" · ")}이고, 아직 가져온 자료가 없습니다.`
      : input.readiness.kind === "WORKING"
        ? `지금 연결된 채널은 ${input.readiness.connected.join(" · ")}입니다.`
        : "지금은 연결 상태를 확인하지 못했습니다.");
  if (input.readiness.connectable.length > 0) {
    push("SELLER.CONNECTABLE", `아직 연결하지 않은 채널은 ${input.readiness.connectable.join(" · ")}입니다.`);
  }
  // The two layers a capability word cannot carry. Both are always said — the old rule returned nothing
  // when no channel was connected, which left 「자동」 unqualified for the seller deciding whether to.
  const posture: CollectionPostureView | null = input.posture ?? null;
  push("RUNTIME.COLLECTION", runtimeCollectionFact(posture));
  push("SELLER.COLLECTION", sellerCollectionFact(input.coverage, posture));

  facts.push(...STRUCTURAL_FACTS);
  return facts;
}

/**
 * <b>Everything the reviewed ledger cannot know — this deployment, this seller, and where they are
 * narrower than the product.</b>
 *
 * The order is the one a seller reads in: which channels exist and which are connected, what state
 * this shop is in, whether collection is actually running, and finally the per-channel places where a
 * capability the product HAS is not available here right now.
 *
 * <b>The last group is the shape {@code INVARIANT.CAPABILITY_VS_STATE} describes.</b> Cafe24 inquiry
 * answering is `DIRECT_WITH_APPROVAL` in the ledger and stays that way in a deployment with execution
 * switched off; what changes is that a second sentence arrives beside it saying so. Before the ledger,
 * that same deployment produced 「reviewnary는 직접 전송하지 못합니다」 — a posture rendered as a
 * specification, which is the defect the whole package exists to end.
 */
function runtimeOverlay(
  input: SelfKnowledgeInputs, matrix: readonly ChannelObjectTruth[],
  offers: ReturnType<typeof channelOffers>,
): ProductFact[] {
  const facts: ProductFact[] = [];
  const push = (key: string, text: string) => facts.push({ key, text });

  if (offers.length > 0) {
    push("CHANNEL.LIST", `연결할 수 있는 판매 채널은 ${offers.map((o) => o.name).join(" · ")}입니다.`);
    for (const o of offers) {
      push(`${o.code}.OFFER`,
        `${o.name} — ${o.connected ? "지금 연결돼 있습니다." : "아직 연결돼 있지 않습니다."}`);
    }
  }
  push("SELLER.READINESS", input.readiness.kind === "NO_CHANNEL"
    ? "이 판매자님은 아직 연결한 판매 채널이 없어, 지금은 가져와 둔 자료가 없습니다."
    : input.readiness.kind === "NO_DATA"
      ? `연결된 채널은 ${input.readiness.connected.join(" · ")}이고, 아직 가져온 자료가 없습니다.`
      : input.readiness.kind === "WORKING"
        ? `지금 연결된 채널은 ${input.readiness.connected.join(" · ")}입니다.`
        : "지금은 연결 상태를 확인하지 못했습니다.");
  if (input.readiness.connectable.length > 0) {
    push("SELLER.CONNECTABLE", `아직 연결하지 않은 채널은 ${input.readiness.connectable.join(" · ")}입니다.`);
  }
  const posture: CollectionPostureView | null = input.posture ?? null;
  push("RUNTIME.COLLECTION", runtimeCollectionFact(posture));
  push("SELLER.COLLECTION", sellerCollectionFact(input.coverage, posture));
  // Said only when it was read. See `proactivePostureFact`.
  const proactive = proactivePostureFact(posture);
  if (proactive) push("RUNTIME.PROACTIVE", proactive);

  for (const truth of matrix) {
    // Only where this deployment is NARROWER than the product, and only when it knows that it is.
    // `UNKNOWN` is not narrower — it is unread, and a sentence built on it would be this layer
    // inventing an outage. `NOT_SUPPORTED` is the channel's own answer and the ledger already has it.
    if (truth.execution !== "SELLER_FINAL_SUBMIT" && truth.execution !== "PREPARE_ONLY") continue;
    push(`RUNTIME.${truth.channelCode}.${truth.object}.EXECUTION`,
      `${truth.channelName} ${OBJECT_WORD[truth.object]} — 지금 이 환경에서는 채널에 바로 등록하는 기능이`
      + " 켜져 있지 않습니다. 그래서 초안까지 준비해 드리고, 채널에 올리는 마지막 단계는 판매자님이 하십니다."
      + " 제품이 그 채널에 등록할 수 있는지는 위의 제품 사실이 답합니다.");
  }
  return facts;
}
