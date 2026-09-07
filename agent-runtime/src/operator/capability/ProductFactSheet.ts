/**
 * <b>ProductSelfKnowledge as a GROUNDING SOURCE rather than a sentence generator.</b>
 *
 * Grounded Conversation Lane v1 §3. The file this one sits beside answers five questions, each with a
 * composed answer, and a sixth question needs a sixth token — which is the structural defect this
 * package exists to close: 「너랑 사방넷이랑 뭐가 달라?」, 「내가 매일 여기 들어와야 돼?」 and 「세 군데 다
 * 연결하면 같은 문의가 중복으로 보여?」 are three more product questions and none of them is an aspect.
 *
 * <b>So the same derivations are flattened into FACTS.</b> Every line below comes from a source of
 * truth that already exists — the registered tool catalogue, the catalogue's action classes, the
 * turn's own coverage snapshot, the capability resolver every execution path uses — and the model is
 * asked to answer the seller's actual question from them. Add a channel to the coverage table and the
 * sheet gains it; turn execution off in the deployment and the sheet loses the promise in the same
 * breath as the path that would have refused.
 *
 * <b>What must never happen here.</b> A fact keyed to an example sentence, or a fact nobody can check.
 * {@link STRUCTURAL_FACTS} is the one hand-written set, it is four lines, each names the code that
 * makes it true, and a test pins the COUNT so that growing it is a decision rather than a habit.
 */
import type { ChannelCoverageRow } from "../../spring/types";
import type { SelfKnowledgeInputs, ChannelActionFacts } from "./ProductSelfKnowledge";
import { actionLines, channelOffers } from "./ProductSelfKnowledge";
import { capabilityDomains, boundarySentence } from "./AssistantCapability";
import { withObject } from "../../korean";

/**
 * Facts about how this product WORKS that no read returns — each one a contract this repository holds
 * somewhere, named here so a grounded answer can use it and a reader can check it.
 *
 * <b>Four, and the count is asserted.</b> The temptation this list exists to resist is the brochure:
 * every sentence added here is one nobody re-derives, and the fifth is how a fact sheet becomes a
 * feature list that goes stale the first time the product changes.
 */
export const STRUCTURAL_FACTS: readonly string[] = [
  // `InquiryWorkItemWriter` / the connectors' ingest: an object is identified by its channel's own
  // external id under one seller account, so re-collection updates and never duplicates.
  "문의와 리뷰는 채널이 매긴 원본 글 단위로 저장합니다. 같은 글을 여러 번 가져와도 하나로 유지되고, 채널이 다르면 서로 다른 글로 셉니다.",
  // `answer_applicability_v1` §9 / `InquiryDraftComposer`: NO_ANSWER_BASIS calls no model and saves no draft.
  "답변 초안은 판매자님이 등록해 두신 답변 기준을 근거로 만듭니다. 근거가 없으면 초안을 지어내지 않고, 어떤 기준이 없는지 말씀드립니다.",
  // `ConversationService` / every Spring read is org-scoped by the forwarded bearer.
  "제가 보는 자료는 이 회사의 채널에서 가져온 것뿐입니다. 다른 회사의 자료나 채널 밖의 정보는 보지 않습니다.",
  // `OperatorToolRegistry` refuses to construct with a non-READ tool; sending is the Action Executor's.
  "제가 채널에 무언가를 보내거나 고치는 일은 판매자님이 확인하신 뒤에만 일어납니다. 확인 전에는 읽고 정리하는 것까지만 합니다.",
];

/**
 * <b>Whether this deployment collects on its own, from the coverage table rather than from a claim.</b>
 *
 * 「내가 매일 여기 들어와야 돼?」 is answered by whether routine collection is actually running for this
 * seller's channels — a field the coverage row already carries. A product that told every seller
 * 「자동으로 가져옵니다」 would be wrong for exactly the deployments where the scheduler is off.
 */
function routineFact(coverage: readonly ChannelCoverageRow[] | null): string | null {
  if (!coverage || coverage.length === 0) return null;
  const connected = coverage.filter((r) => r.connected);
  if (connected.length === 0) return null;
  const on = connected.filter((r) => r.routineEnabled);
  if (on.length === 0) {
    return "지금은 정기 수집이 켜져 있지 않아, 새 자료는 수집을 실행할 때 들어옵니다.";
  }
  const names = [...new Set(on.map((r) => r.channelNameKo ?? r.channelCode))];
  return `${withObject(names.join(" · "))} 정기적으로 다시 확인하고 있어, 판매자님이 매번 누르지 않아도 새 자료가 들어옵니다.`;
}

/**
 * The whole sheet, in the order a seller learns the product: what it is, what it works with, what it
 * can and cannot do per channel, and how it behaves.
 *
 * @param matrix the per-channel verdicts for the channels this deployment offers — read by the caller
 *     on the turn that needs them, from the same resolver the execution paths use
 */
export function productFactSheet(
  input: SelfKnowledgeInputs, matrix: readonly ChannelActionFacts[],
): string[] {
  const facts: string[] = [];
  const domains = capabilityDomains(input.registeredTools);
  if (domains.length > 0) {
    facts.push(`reviewnary는 판매자를 대신해 ${withObject(domains.map((d) => d.short).join(" · "))} 확인하고 정리하는 AI 운영 담당자입니다.`);
    for (const d of domains) facts.push(`${d.short} — ${d.line}`);
    // 「할 수 없는 건 뭔데?」 — derived from the same list, so it cannot promise a domain that is gone
    // and cannot deny one that arrived.
    facts.push(`제가 다루는 영역은 ${domains.map((d) => d.short).join(" · ")}입니다. 이 목록에 없는 판매자센터 작업은 하지 않습니다.`);
  }
  facts.push(boundarySentence(input.actionClasses));

  const offers = channelOffers(input.coverage);
  if (offers.length > 0) {
    facts.push(`연결할 수 있는 판매 채널은 ${offers.map((o) => o.name).join(" · ")}입니다.`);
    for (const o of offers) {
      const works = o.works.length > 0
        ? `${withObject(o.works.join(" · "))} 가져옵니다`
        : "가져올 수 있는 자료가 아직 없습니다";
      facts.push(`${o.name} — ${works}. ${o.connected ? "지금 연결돼 있습니다." : "아직 연결돼 있지 않습니다."}`);
    }
  }
  for (const f of matrix) {
    for (const line of actionLines(f)) facts.push(`${f.name} ${line}`);
  }

  // This shop's own state — the one part of the sheet that is about the seller rather than the product.
  facts.push(input.readiness.kind === "NO_CHANNEL"
    ? "이 판매자님은 아직 연결한 판매 채널이 없어, 지금은 가져와 둔 자료가 없습니다."
    : input.readiness.kind === "NO_DATA"
      ? `연결된 채널은 ${input.readiness.connected.join(" · ")}이고, 아직 가져온 자료가 없습니다.`
      : input.readiness.kind === "WORKING"
        ? `지금 연결된 채널은 ${input.readiness.connected.join(" · ")}입니다.`
        : "지금은 연결 상태를 확인하지 못했습니다.");
  if (input.readiness.connectable.length > 0) {
    facts.push(`아직 연결하지 않은 채널은 ${input.readiness.connectable.join(" · ")}입니다.`);
  }
  const routine = routineFact(input.coverage);
  if (routine) facts.push(routine);

  facts.push(...STRUCTURAL_FACTS);
  return facts;
}
