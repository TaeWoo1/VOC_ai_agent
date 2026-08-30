/**
 * ProductOps — what the seller is selling, and what is happening to it.
 *
 * <b>v2 makes this a knowledge specialist, not a signal lookup.</b> v1 answered one question ("무슨
 * 문제가 있어?") by resolving a product and reading its signals, always in that order. It could not
 * answer "폭이 몇 mm인가요?" at all, because SellerOps held no product fact to answer it with — the
 * entire product context was a name and a SKU. v2 reads a Product Knowledge layer whose every value
 * carries a source and an observation time, and cites those values as evidence.
 *
 * <b>The two coverage axes are both reported and never merged.</b> `AttentionCoverage` says whether a
 * SIGNAL can be attributed to this product; `KnowledgeCoverage` says whether a FACT is held at all. A
 * product can be perfectly attributed and completely unknown, or fully catalogued with unattributable
 * reviews. Collapsing them would make "판단할 수 없습니다" and "갖고 있지 않습니다" the same sentence,
 * and only one of them is about the product.
 *
 * <b>Absence is never a negative fact.</b> An empty spec list under `SPEC: UNAVAILABLE` produces
 * "규격 정보를 갖고 있지 않습니다" — never "이 상품에는 규격이 없습니다".
 */
import { excerpt, factSourceLabel, retrievalSentence } from "../wording/sellerWording";
import type { EvidenceRef, Finding, SpecialistResult } from "../state/OperatorState";
import type { NeedState, ResolvedEntity } from "../plan/InvestigationPlan";
import { OPERATOR_TOOL } from "../tools/OperatorTools";
import { outcomeOf } from "../../spring/types";
import { eventRange } from "../scope/EvidenceTime";
import { attemptTool } from "../failure/SpecialistOutcome";
import type { ToolFailure } from "../failure/SpecialistOutcome";
import type { SpecialistInput } from "./specialistInput";
import type {
  IssueEvidenceSummary,
  KnowledgeCoverageRow,
  KnowledgeSearchResult,
  ProductFact,
  ProductKnowledge,
  ProductMatchSurface,
  ProductSummary,
  SignalCoverage,
} from "../../spring/types";
import { log } from "../../log";
import { channelLabel, moneyLabel, sellingStatusLabel } from "../sellerVocabulary";
import { withTopic } from "../../korean";

/**
 * How many of a product's live issues get their split read, and how many are then stated.
 *
 * <b>Two numbers because ranking and stating are different jobs.</b> The backend returns this product's
 * issues ordered by severity and then by the ISSUE's org-wide evidence count — which is not this
 * product's importance. Live 2026-08-24 on a real product that had 15 live issues, the top five by that
 * order were 7·4·2·1·1 of the product's own rows, while its two largest problems (16 rows and 8) fell
 * outside the cut entirely. Ranking a product's answer by another scope's number is defect C4 one level
 * up, so the splits are read first and the STATEMENTS are ranked by the product's own count.
 */
const ISSUE_READ_LIMIT = 8;
const ISSUE_STATE_LIMIT = 5;

/** The surfaces on which a whole name matched. Two candidates on one of these are indistinguishable. */
const EXACT_SURFACES: readonly ProductMatchSurface[] = [
  "SKU_EXACT", "CANONICAL_NAME_EXACT", "CHANNEL_PRODUCT_NAME_EXACT",
];

/** The need kinds this specialist answers. Anything else belongs to another one. */
export const PRODUCT_NEEDS = [
  "PRODUCT_FACT", "PRODUCT_LISTING", "PRODUCT_VARIANT", "PRODUCT_KNOWLEDGE_DOC",
  "REVIEW_SIGNAL", "INQUIRY_VOLUME",
] as const;

/**
 * How many of the seller's own passages one answer may rest on.
 *
 * <b>Grounding, not transcription.</b> Three passages is enough to answer a usage or policy question
 * from more than one place in the library; pasting the whole document back would make the evidence
 * card unreadable and would let a weak match ride along under a strong one.
 */
const KNOWLEDGE_PASSAGE_LIMIT = 3;

export interface ProductOpsResult extends SpecialistResult {
  /** Entities this specialist resolved — the only place a productId can enter the run's state. */
  readonly resolvedEntities: readonly ResolvedEntity[];
  readonly needStates: readonly NeedState[];
  readonly knowledge: Record<string, ProductKnowledge>;
  readonly knowledgeCoverage: readonly KnowledgeCoverageRow[];
}

export async function runProductOps(input: SpecialistInput): Promise<ProductOpsResult> {
  const { registry, budget, evidence, allowedTools } = input;
  const findings: Finding[] = [];
  const refs: EvidenceRef[] = [];
  const notes: string[] = [];
  const needStates: NeedState[] = [];
  const knowledge: Record<string, ProductKnowledge> = {};
  // Per-read isolation, same contract as InquiryOps and ReviewOps (A2): one unreadable issue summary
  // costs that issue's number and nothing else.
  const failures: ToolFailure[] = [];
  /** One settled outcome per signal need kind — see the note at the call site. */
  const answered = new Map<string, NeedState>();

  // ── 1. Resolve. The planner could not: it has no id and is refused if it invents one.
  const already = input.resolved.find((e) => e.kind === "PRODUCT");
  let productId = already?.id ?? null;
  let productName = already?.label ?? null;
  let ambiguous = already?.ambiguous ?? false;
  let usedMention = already?.mention ?? input.mentions[0] ?? "";
  const resolvedEntities: ResolvedEntity[] = [];

  if (!productId) {
    if (input.mentions.length === 0) {
      // A run opened on one inquiry that names no product: the honest sentence is about the
      // inquiry's binding, not a request to type a SKU the seller never had in mind (live 2026-08-27).
      if (input.resolved.some((e) => e.kind === "INQUIRY")) {
        return empty(input, "이 문의에 연결된 상품이 없어 상품 정보는 확인하지 않았습니다.");
      }
      return empty(input, "어떤 상품을 묻는지 확인하지 못했습니다. 상품명이나 SKU를 함께 알려주세요.");
    }
    for (const mention of input.mentions) {
      if (!budget.spend("tool")) {
        return empty(input, "상품을 조회하기 전에 예산이 끝났습니다.");
      }
      const candidates = await registry.invoke<ProductSummary[]>(
        OPERATOR_TOOL.RESOLVE_PRODUCT, { query: mention, limit: 5 }, allowedTools,
      );
      if (candidates.length > 0) {
        const top = candidates[0]!;
        // <b>A tie on an exact surface is not resolvable, and must not be resolved.</b> The seller
        // typed a whole name and the catalogue holds it twice — the demo org has ten such titles,
        // one shared by four separate products. Taking the first is a coin flip, and a coin flip
        // answered confidently is the worst outcome here. A tie among PARTIAL matches is a different
        // situation: the seller gave a fragment, so the run proceeds and discloses which it took.
        const tied = candidates.filter((c) => c.matchedOn === top.matchedOn);
        if (tied.length > 1 && EXACT_SURFACES.includes(top.matchedOn as ProductMatchSurface)) {
          return empty(input, `"${mention}"이라는 이름으로 등록된 상품이 ${tied.length}개 있어 어느 쪽을 `
            + "말씀하시는지 정하지 못했습니다. 상품코드(SKU)나 채널을 함께 알려주세요.");
        }
        productId = top.id;
        // The listing title when that is what matched — a Coupang/Cafe24 catalogue stores a SKU
        // number in `name`, and reading "15223228019" back at a seller who typed the product's title
        // is not an answer about their product.
        productName = top.matchedName ?? top.name;
        ambiguous = candidates.length > 1;
        usedMention = mention;
        resolvedEntities.push({
          kind: "PRODUCT", mention, id: productId, label: productName,
          resolvedBy: OPERATOR_TOOL.RESOLVE_PRODUCT, ...(ambiguous ? { ambiguous: true } : {}),
        });
        break;
      }
    }
  }
  if (!productId || !productName) {
    return empty(input, `"${input.mentions[0] ?? ""}"에 해당하는 상품을 찾지 못했습니다.`);
  }
  if (ambiguous) {
    notes.push(`"${usedMention}"에 해당하는 상품이 여러 개여서 ${productName} 기준으로 답했습니다.`);
  }

  // ── 2. One read per need, in the planner's order. A need this specialist cannot serve is left
  // PENDING for another one rather than answered badly here.
  // Held in a box rather than a `let`: TypeScript narrows a `let` from its initializer and would
  // conclude that every read after the closure sees `null`, which is exactly backwards — the closure is
  // what fills it. A one-field holder keeps the union honest without an assertion.
  const cache: { view: ProductKnowledge | null } = { view: null };
  const loadKnowledge = async (): Promise<ProductKnowledge | null> => {
    if (cache.view) return cache.view;
    if (!budget.spend("tool")) {
      notes.push(`${productName}의 상품 정보를 읽기 전에 예산이 끝났습니다.`);
      return null;
    }
    cache.view = await registry.invoke<ProductKnowledge>(
      OPERATOR_TOOL.GET_PRODUCT_KNOWLEDGE,
      { productId, ...(input.referenceDate ? { referenceDate: input.referenceDate } : {}) },
      allowedTools,
    );
    knowledge[productId!] = cache.view;
    return cache.view;
  };

  for (const need of input.needs) {
    if (need.kind === "PRODUCT_FACT") {
      const keys = factKeysFor(need.question, input.goalText ?? "");
      if (!budget.spend("tool")) {
        needStates.push({ id: need.id, status: "PENDING", evidenceIds: [] });
        continue;
      }
      const facts = await registry.invoke<ProductFact[]>(
        OPERATOR_TOOL.SEARCH_PRODUCT_FACTS, { productId, factKeys: keys }, allowedTools,
      );
      const view = await loadKnowledge();
      const specCoverage = coverageOf(view, "SPEC");
      if (facts.length === 0) {
        // The whole point of the layer: "we do not hold this" is a finding, not silence, and it is
        // supported BY the coverage row rather than undermined by it.
        const ref = evidence.add({
          kind: "PRODUCT_KNOWLEDGE_GAP",
          sourceTool: OPERATOR_TOOL.SEARCH_PRODUCT_FACTS,
          args: { productId, factKeys: keys },
          locator: { productId, productName, facet: "SPEC", label: keys.join("|") || "spec" },
          coverage: "COVERED",
          provenance: specCoverage ? `product-knowledge/${specCoverage.coverage}` : "product-knowledge/UNAVAILABLE",
        });
        refs.push(ref);
        findings.push({
          findingId: `f-${ref.evidenceId}`,
          specialist: "PRODUCT_OPS",
          statement: `${productName}의 ${keys.length > 0 ? `${keys.map(label).join(", ")} ` : ""}`
            + "규격 정보가 아직 저장돼 있지 않습니다. 상품에 그 규격이 없다는 뜻은 아닙니다.",
          evidenceIds: [ref.evidenceId],
          confidence: "NEEDS_REVIEW",
          verdict: null,
          surfaceLink: "/connect",
          claimsCoverageLimit: true,
          needId: need.id,
        });
        needStates.push({ id: need.id, status: "UNSATISFIABLE", evidenceIds: [ref.evidenceId],
          reason: "상품 사실이 저장돼 있지 않습니다." });
        continue;
      }
      const cited: string[] = [];
      for (const fact of facts.slice(0, 6)) {
        const ref = evidence.add({
          kind: "PRODUCT_FACT",
          sourceTool: OPERATOR_TOOL.SEARCH_PRODUCT_FACTS,
          args: { productId, factKey: fact.factKey },
          locator: {
            productId, productName, factKey: fact.factKey, factSource: fact.source,
            label: `${fact.value}${fact.unit ? " " + fact.unit : ""}`,
          },
          // When the fact was captured — an observation, not an event. A spec does not "happen".
          asOf: dateOnly(fact.observedAt),
          coverage: "COVERED",
          provenance: `product-fact/${fact.source}:${fact.confidence}`,
        });
        refs.push(ref);
        cited.push(ref.evidenceId);
        findings.push({
          findingId: `f-${ref.evidenceId}`,
          specialist: "PRODUCT_OPS",
          statement: `${productName}의 ${withTopic(label(fact.factKey))} ${fact.value}`
            + `${fact.unit ? fact.unit : ""}입니다 (${factSourceLabel(fact.source)}).`,
          evidenceIds: [ref.evidenceId],
          confidence: "NEEDS_REVIEW",
          verdict: null,
          surfaceLink: null,
          needId: need.id,
        });
      }
      needStates.push({ id: need.id, status: "SATISFIED", evidenceIds: cited });
      continue;
    }

    if (need.kind === "PRODUCT_KNOWLEDGE_DOC") {
      if (!budget.spend("tool")) {
        needStates.push({ id: need.id, status: "PENDING", evidenceIds: [] });
        continue;
      }
      // The need's own question is the query. Not the seller's whole sentence: a goal carries the
      // product name and the pleasantries, and matching a library against "누비아 사용법 좀 알려줘"
      // scores every passage that happens to contain the product's name.
      const query = need.question || input.goalText || "";
      const found = await registry.invoke<KnowledgeSearchResult>(
        OPERATOR_TOOL.SEARCH_PRODUCT_KNOWLEDGE,
        { productId, query, limit: KNOWLEDGE_PASSAGE_LIMIT },
        allowedTools,
      );
      if (found.passages.length === 0) {
        // <b>Three absences, three sentences</b> (Retrieval & Grounding Correctness v1). Nothing written,
        // nothing covering the question, and something matching that is declared about another topic
        // are different facts about the LIBRARY, and none is a fact about the product. The backend
        // already asked the question in its bounded forms, so a miss here is a miss of the subject too
        // — never 「해당하는 내용이 없습니다」 said of a library that was searched with a planner's sentence.
        const outcome = outcomeOf(found);
        const ref = evidence.add({
          kind: "PRODUCT_KNOWLEDGE_GAP",
          sourceTool: OPERATOR_TOOL.SEARCH_PRODUCT_KNOWLEDGE,
          args: { productId, query },
          // The label is the seller-facing topic word, never the planner's sentence.
          locator: { productId, productName, facet: "KNOWLEDGE_DOC", label: outcome === "ABSENT" ? "상품 지식 없음" : outcome === "NOT_APPLICABLE" ? "상품 지식 비적용" : "상품 지식 근거 없음", outcome },
          coverage: "COVERED",
          provenance: `product-knowledge-library/${outcome}`,
        });
        refs.push(ref);
        findings.push({
          findingId: `f-${ref.evidenceId}`,
          specialist: "PRODUCT_OPS",
          statement: retrievalSentence("PRODUCT", outcome === "FOUND" ? "NO_RELEVANT_EVIDENCE" : outcome,
            { subject: productName, documents: found.documentsSearched }),
          evidenceIds: [ref.evidenceId],
          confidence: "NEEDS_REVIEW",
          verdict: null,
          surfaceLink: `/products/${productId}`,
          claimsCoverageLimit: true,
          needId: need.id,
        });
        needStates.push({ id: need.id, status: "UNSATISFIABLE", evidenceIds: [ref.evidenceId],
          reason: outcome === "ABSENT" ? "등록된 상품 지식이 없습니다."
            : outcome === "NOT_APPLICABLE" ? "등록된 상품 지식이 이 질문에 적용되지 않습니다."
            : "등록된 상품 정보에서 이 질문의 근거를 찾지 못했습니다." });
        continue;
      }
      const cited: string[] = [];
      for (const passage of found.passages) {
        const ref = evidence.add({
          kind: "PRODUCT_KNOWLEDGE_DOC",
          sourceTool: OPERATOR_TOOL.SEARCH_PRODUCT_KNOWLEDGE,
          args: { productId, query },
          locator: {
            productId, productName,
            facet: passage.sourceType,
            // The label is the document's TITLE. The passage body is what the seller reads in the
            // finding, not what leaves for the judge: the digest is metadata (Knowledge Context v1-A).
            label: passage.title,
            sourceId: passage.sourceId,
            chunkId: passage.chunkId,
            title: passage.title,
          },
          asOf: dateOnly(passage.updatedAt),
          coverage: "COVERED",
          provenance: `product-knowledge-library/${passage.sourceType}`
            + `${passage.authorName ? `:${passage.authorName}` : ""}`,
        });
        refs.push(ref);
        cited.push(ref.evidenceId);
        findings.push({
          findingId: `f-${ref.evidenceId}`,
          specialist: "PRODUCT_OPS",
          // The sentence names WHOSE words these are. A grounded answer that reads as SellerOps's own
          // knowledge invites the seller to trust it further than its source allows.
          statement: `${productName} — 등록된 ${sourceTypeLabel(passage.sourceType)} 「${passage.title}」: ${excerpt(passage.content)}`,
          // The judge sees that a document of this kind and title covers the question — not its text.
          judgeStatement: `${productName} — 판매자가 등록한 ${sourceTypeLabel(passage.sourceType)}`
            + `"${passage.title}"이(가) 이 질문에 해당하는 내용을 담고 있습니다.`,
          evidenceIds: [ref.evidenceId],
          confidence: "NEEDS_REVIEW",
          verdict: null,
          surfaceLink: `/products/${productId}`,
          needId: need.id,
        });
      }
      needStates.push({ id: need.id, status: "SATISFIED", evidenceIds: cited });
      continue;
    }

    if (need.kind === "PRODUCT_LISTING" || need.kind === "PRODUCT_VARIANT") {
      const view = await loadKnowledge();
      if (!view) {
        needStates.push({ id: need.id, status: "PENDING", evidenceIds: [] });
        continue;
      }
      const rows = need.kind === "PRODUCT_LISTING" ? view.listings : view.variants;
      if (rows.length === 0) {
        const facet = need.kind === "PRODUCT_LISTING" ? "LISTING" : "VARIANT";
        const ref = evidence.add({
          kind: "PRODUCT_KNOWLEDGE_GAP",
          sourceTool: OPERATOR_TOOL.GET_PRODUCT_KNOWLEDGE,
          args: { productId, facet },
          locator: { productId, productName, facet },
          coverage: "COVERED",
          provenance: `product-knowledge/${coverageOf(view, facet)?.coverage ?? "UNAVAILABLE"}`,
        });
        refs.push(ref);
        findings.push({
          findingId: `f-${ref.evidenceId}`,
          specialist: "PRODUCT_OPS",
          statement: need.kind === "PRODUCT_LISTING"
            ? `${productName}의 채널 등록 정보가 아직 저장돼 있지 않습니다.`
            : `${productName}의 옵션 정보가 아직 저장돼 있지 않습니다.`,
          evidenceIds: [ref.evidenceId],
          confidence: "NEEDS_REVIEW",
          verdict: null,
          surfaceLink: "/connect",
          claimsCoverageLimit: true,
          needId: need.id,
        });
        needStates.push({ id: need.id, status: "UNSATISFIABLE", evidenceIds: [ref.evidenceId],
          reason: "채널 상품 읽기가 아직 이 상품을 채우지 않았습니다." });
        continue;
      }
      const cited: string[] = [];
      for (const row of rows.slice(0, 5)) {
        const isListing = need.kind === "PRODUCT_LISTING";
        const listing = isListing ? (row as ProductKnowledge["listings"][number]) : null;
        const variant = isListing ? null : (row as ProductKnowledge["variants"][number]);
        const ref = evidence.add({
          kind: isListing ? "PRODUCT_LISTING" : "PRODUCT_VARIANT",
          sourceTool: OPERATOR_TOOL.GET_PRODUCT_KNOWLEDGE,
          args: { productId },
          locator: {
            productId, productName,
            channelCode: (listing ?? variant)!.channelCode,
            ...(listing?.listingName ? { label: listing.listingName } : {}),
            ...(variant?.optionName ? { label: variant.optionName } : {}),
            ...(variant?.externalVariantId ? { variantId: variant.externalVariantId } : {}),
          },
          asOf: dateOnly((listing ?? variant)!.observedAt),
          coverage: "COVERED",
          provenance: `product-knowledge/${(listing ?? variant)!.source ?? "UNKNOWN"}`,
        });
        refs.push(ref);
        cited.push(ref.evidenceId);
        findings.push({
          findingId: `f-${ref.evidenceId}`,
          specialist: "PRODUCT_OPS",
          statement: listing
            ? `${withTopic(productName)} ${channelLabel(listing)}에 `
              + `${listing.listingName ? `"${listing.listingName}" 으로 ` : ""}등록돼 있습니다`
              + `${listing.price != null ? ` (가격 ${moneyLabel(listing.price, listing.currency)})` : ""}`
              + `${sellingStatusLabel(listing.sellingStatus) ? `, ${sellingStatusLabel(listing.sellingStatus)}` : ""}.`
            : `${productName}에 옵션 "${variant!.optionName ?? variant!.externalVariantId}"이(가) `
              + `${channelLabel(variant!)}에 있습니다.`,
          evidenceIds: [ref.evidenceId],
          confidence: "NEEDS_REVIEW",
          verdict: null,
          surfaceLink: listing?.productUrl ? null : null,
          needId: need.id,
        });
      }
      needStates.push({ id: need.id, status: "SATISFIED", evidenceIds: cited });
      continue;
    }

    // REVIEW_SIGNAL / INQUIRY_VOLUME for a resolved product.
    //
    // <b>Split, where v1 answered both from one function.</b> A REVIEW_SIGNAL need was being handed an
    // unanswered-inquiry finding and an INQUIRY_VOLUME need a list of review issues, because the two
    // shared a code path — so `needId` pointed at whichever need happened to run first and the answer
    // card attributed each sentence to the wrong question.
    const view = await loadKnowledge();
    if (!view) {
      needStates.push({ id: need.id, status: "PENDING", evidenceIds: [] });
      continue;
    }
    //
    // <b>One read serves every need of its kind.</b> A plan may declare two REVIEW_SIGNAL needs; the
    // product's issue index is the same index for both, and reading it twice buys the same rows at
    // twice the budget and then prints each sentence twice for `compose` to dedupe. Live 2026-08-24 a
    // three-need plan spent twelve tool calls where seven would do, and the five deduped sentences
    // were then reported to the seller as "근거가 확인되지 않아 제외했습니다" — which they were not.
    // The later need cites the SAME evidence, which is what makes it satisfied by the same fact.
    const settled = answered.get(need.kind);
    if (settled) {
      needStates.push({ ...settled, id: need.id });
      continue;
    }
    const state = need.kind === "INQUIRY_VOLUME"
      ? inquiryVolumeFinding(view, productId, productName, need.id, evidence, refs, findings)
      : await reviewSignalFindings(
          { registry, budget, evidence, allowedTools, refs, findings, failures, notes },
        view, productId, productName, need.id,
      );
    answered.set(need.kind, state);
    needStates.push(state);
  }

  const view = cache.view;
  const uncertain = (view?.signals.coverage ?? []).filter((c) => c.coverage !== "COVERED");
  if (view && uncertain.length > 0) {
    // The uncertain-coverage finding — "we could not tell" as a THING THE OPERATOR SAYS, not merely a
    // field a UI might render. Same reasoning as v1, kept verbatim.
    const ref = evidence.add({
      kind: "PRODUCT_SIGNAL",
      sourceTool: OPERATOR_TOOL.GET_PRODUCT_KNOWLEDGE,
      args: { productId },
      locator: {
        productId, productName,
        count: uncertain.reduce((sum, c) => sum + c.unlinked, 0),
        label: uncertain.map((c) => c.signal).join("|"),
      },
      // The snapshot's own as-of date. A coverage gap is a state, so it needs no event range.
      asOf: view.signals.referenceDate,
      coverage: uncertain[0]!.coverage,
      provenance: uncertain[0]!.provenance,
    });
    refs.push(ref);
    findings.push({
      findingId: `f-${ref.evidenceId}`,
      specialist: "PRODUCT_OPS",
      statement: `${productName}에 대해 일부 데이터는 상품과 연결되지 않아 판단할 수 없습니다`
        + ` (${uncertain.map((c) => c.signal).join(", ")}).`,
      evidenceIds: [ref.evidenceId],
      confidence: "NEEDS_REVIEW",
      verdict: null,
      surfaceLink: "/connect",
      claimsCoverageLimit: true,
    });
  }

  log("product_ops", {
    resolved: true, ambiguous, needs: input.needs.length, findings: findings.length,
    uncertainSources: uncertain.length,
  });

  return {
    specialist: "PRODUCT_OPS",
    findings,
    evidence: refs,
    coverage: view?.signals.coverage ?? [],
    resolvedEntities,
    needStates,
    failures,
    knowledge,
    knowledgeCoverage: view?.knowledgeCoverage ?? [],
    ...(notes.length > 0 ? { note: notes.join(" ") } : {}),
  };
}

/** What the two signal readers below share — the registry seam plus the buffers they append to. */
interface SignalReaderDeps {
  readonly registry: SpecialistInput["registry"];
  readonly budget: SpecialistInput["budget"];
  readonly evidence: SpecialistInput["evidence"];
  readonly allowedTools: readonly string[];
  readonly refs: EvidenceRef[];
  readonly findings: Finding[];
  readonly failures: ToolFailure[];
  readonly notes: string[];
}

/**
 * The product's review-issue signal — and, for the first time, the product's OWN number.
 *
 * <b>Why a second read for a count we appear to already have.</b> The backend selects this issue list
 * from `review_issue_evidence` rows that belong to THIS product, so membership in the list is
 * product-scoped and trustworthy. Every count on the rows is not: `ReviewIssueView.evidenceCount` is
 * the issue's org-wide total, and until 2026-08-23 it was read back to the seller as though it were
 * theirs — "판도리…에서 '접착 탈락' 신호가 근거 69건으로 기록돼 있습니다" when the product's share of
 * those 69 was two (defect C4). `get_review_issue_evidence_summary` is the only read that splits an
 * issue by product; it is now reachable from here (`tools/ToolReachability.ts`), and it is the same
 * call ReviewOps makes, not a new capability.
 *
 * <b>Both numbers appear, and they are labelled.</b> The product's count is the claim; the issue's
 * total is context in the same sentence, so the smaller number can never be read as the larger one.
 *
 * <b>Zero is an answer when the source could see the whole scope.</b> `COVERED` on the REVIEW_ISSUE
 * signal means every issue-evidence row in this org is attributed to some product, so a product with
 * none genuinely has none. Saying so is the "clean signal" a seller asked for; saying it under any
 * `UNCERTAIN_*` value would be the false calm this graph exists to prevent, and there it stays silent
 * and lets the uncertain-coverage finding speak instead.
 */
async function reviewSignalFindings(
  deps: SignalReaderDeps,
  view: ProductKnowledge, productId: string, productName: string, needId: string,
): Promise<NeedState> {
  const { evidence, refs, findings } = deps;
  const issueCoverage = view.signals.coverage.find((c: SignalCoverage) => c.signal === "REVIEW_ISSUE");
  const coverage = issueCoverage?.coverage ?? "COVERED";
  const considered = view.signals.issues.slice(0, ISSUE_READ_LIMIT);
  const cited: string[] = [];

  // ── 1. Read each split, then rank by what the product actually holds.
  const rows: Array<{ issue: typeof considered[number]; share: { count: number; total: number } | null }> = [];
  for (const issue of considered) {
    rows.push({ issue, share: await productShareOf(deps, issue.id, productId, needId) });
  }
  const ranked = [...rows]
    // A row whose split could not be read keeps the backend's place rather than being promoted or
    // dropped: an unknown count is not a small one, and it is not a large one either.
    .sort((a, b) => (b.share?.count ?? -1) - (a.share?.count ?? -1))
    .slice(0, ISSUE_STATE_LIMIT);

  // ── 2. Say them.
  for (const { issue, share } of ranked) {
    if (share && share.count <= 0) {
      // The list says this product has rows behind this issue and the split says it does not. They
      // read the same table, so this is a race, not a fact — and a disagreement is never a sentence.
      continue;
    }
    const known = share != null;
    const ref = evidence.add({
      kind: known ? "ISSUE_EVIDENCE" : "REVIEW_ISSUE",
      sourceTool: known ? OPERATOR_TOOL.GET_ISSUE_EVIDENCE_SUMMARY : OPERATOR_TOOL.GET_PRODUCT_KNOWLEDGE,
      args: known ? { issueId: issue.id } : { productId },
      locator: {
        issueId: issue.id, productId, productName,
        count: known ? share!.count : issue.evidenceCount,
        label: issue.title, severity: issue.severity,
      },
      // <b>No event range on the product's own slice.</b> The issue's first/last dates span every
      // product in it; lending them here would let another product's recent review prove this
      // product's "최근". The whole-issue row keeps its dates, because that is what it is about.
      ...(known ? {} : { events: eventRange(issue.firstEvidenceOn, issue.lastEvidenceOn) }),
      coverage,
      provenance: known
        ? `issue-memory/${issue.extractorKind}:evidence-summary`
        : issueCoverage?.provenance ?? `issue-memory/${issue.extractorKind}`,
    });
    refs.push(ref);
    cited.push(ref.evidenceId);
    // The change labels belong to the ISSUE, not to this product's share of it — they are computed
    // org-wide by `IssueChangeRules` — so they sit inside the clause that quotes the issue's total.
    const change = issue.change.labelsKo.length > 0 ? `, ${issue.change.labelsKo.join(", ")}` : "";
    findings.push({
      findingId: `f-${ref.evidenceId}`,
      specialist: "PRODUCT_OPS",
      statement: known
        ? `${productName}에 "${issue.title}" 문제로 기록된 리뷰 근거가 ${share!.count}건 있습니다`
          + ` (이 문제 전체 ${share!.total}건 중${change}).`
        : `${withTopic(productName)} "${issue.title}" 문제에 리뷰 근거가 연결돼 있습니다`
          + ` (이 문제 전체 ${issue.evidenceCount}건${change} — 이 상품 몫은 확인하지 못했습니다).`,
      evidenceIds: [ref.evidenceId],
      confidence: "NEEDS_REVIEW",
      verdict: null,
      surfaceLink: `/memory/${issue.id}`,
      needId,
    });
  }

  if (cited.length > 0) {
    const total = view.signals.issues.length;
    const complete = considered.length >= total && ranked.length >= rows.length;
    if (!complete) {
      // A bounded read that reports as complete is invented certainty, wherever the bound sits.
      // <b>Two bounds, said separately, because they are different limits.</b> How many issues were
      // OPENED and how many were STATED are not the same number, and one sentence covering both would
      // claim the ranking was over the whole list when it was over what was read.
      deps.notes.push(`${productName}에 기록된 반복 리뷰 문제 ${total}건 가운데 `
        + `${considered.length}건을 확인해 근거가 많은 ${cited.length}건을 정리했습니다.`);
    }
    return {
      id: needId, status: "SATISFIED", evidenceIds: cited, coverage,
      complete, settledBy: "PRODUCT_OPS",
    };
  }
  if (view.signals.issues.length === 0 && coverage === "COVERED") {
    // The measured zero. Not flagged as a coverage limit: it is a positive fact about the data, so it
    // must face the same scope gate every other claim does — and a period question, whose evidence
    // would have to be dated, correctly withholds it.
    const ref = evidence.add({
      kind: "ISSUE_EVIDENCE",
      sourceTool: OPERATOR_TOOL.GET_PRODUCT_KNOWLEDGE,
      args: { productId, signal: "REVIEW_ISSUE" },
      locator: { productId, productName, count: 0, label: "이 상품에 귀속된 리뷰 이슈 근거" },
      asOf: view.signals.referenceDate,
      coverage: "COVERED",
      provenance: issueCoverage?.provenance ?? "issue-memory/RULE_BASED",
    });
    refs.push(ref);
    findings.push({
      findingId: `f-${ref.evidenceId}`,
      specialist: "PRODUCT_OPS",
      statement: `${productName}에 반복 문제로 기록된 리뷰 근거는 없습니다`
        + " (리뷰 근거가 모두 상품에 연결돼 있어 확인 가능한 결과입니다).",
      evidenceIds: [ref.evidenceId],
      confidence: "NEEDS_REVIEW",
      verdict: null,
      surfaceLink: null,
      needId,
    });
    return {
      id: needId, status: "SATISFIED", evidenceIds: [ref.evidenceId],
      coverage: "COVERED", complete: true, settledBy: "PRODUCT_OPS",
    };
  }
  return {
    id: needId, status: "UNSATISFIABLE", evidenceIds: [], coverage, complete: false,
    settledBy: "PRODUCT_OPS",
    reason: coverage === "COVERED"
      ? "이 상품에 기록된 리뷰 문제 근거를 확인하지 못했습니다."
      : "이 상품에 연결되지 않은 리뷰 근거가 있어 판단할 수 없습니다.",
  };
}

/** One issue's share for one product, or `null` when the split could not be read. */
async function productShareOf(
  deps: SignalReaderDeps, issueId: string, productId: string, needId: string,
): Promise<{ count: number; total: number } | null> {
  if (!deps.budget.spend("tool")) {
    return null;
  }
  const attempt = await attemptTool(
    { specialist: "PRODUCT_OPS", tool: OPERATOR_TOOL.GET_ISSUE_EVIDENCE_SUMMARY, needId },
    () => deps.registry.invoke<IssueEvidenceSummary>(
      OPERATOR_TOOL.GET_ISSUE_EVIDENCE_SUMMARY, { issueId }, deps.allowedTools,
    ),
  );
  if (!attempt.ok) {
    deps.failures.push(attempt.failure);
    return null;
  }
  const row = attempt.value.byProduct.find((p) => p.productId === productId);
  return { count: row?.evidenceCount ?? 0, total: attempt.value.totalEvidence };
}

/**
 * The product's unanswered-inquiry depth — and its zero.
 *
 * <b>A product-scoped count the run already had and never said when it was zero.</b> The backend
 * counts UNANSWERED rows for THIS product, so an empty queue under `COVERED` is a measured zero and
 * answers "문의는 어떤가" directly. Saying nothing left the org-wide inbox total (which the scope gate
 * correctly refuses for a product need) as the only inquiry sentence in reach, so a seller asking
 * about one product's inquiries got either someone else's number or silence.
 */
function inquiryVolumeFinding(
  view: ProductKnowledge, productId: string, productName: string, needId: string,
  evidence: SpecialistInput["evidence"], refs: EvidenceRef[], findings: Finding[],
): NeedState {
  const inquiryCoverage = view.signals.coverage.find((c: SignalCoverage) => c.signal === "INQUIRY");
  const coverage = inquiryCoverage?.coverage ?? "COVERED";
  const unanswered = view.signals.volume.unansweredInquiries;
  if (unanswered === 0 && coverage !== "COVERED") {
    return {
      id: needId, status: "UNSATISFIABLE", evidenceIds: [], coverage, complete: false,
      settledBy: "PRODUCT_OPS",
      reason: "이 상품에 연결되지 않은 문의가 있어 문의량을 판단할 수 없습니다.",
    };
  }
  const ref = evidence.add({
    kind: "INQUIRY",
    sourceTool: OPERATOR_TOOL.GET_PRODUCT_KNOWLEDGE,
    args: { productId },
    locator: { productId, productName, count: unanswered, label: "미답변 문의" },
    // Same snapshot semantics as the org-wide inbox count: a queue depth now, no arrival span.
    asOf: view.signals.referenceDate,
    coverage,
    provenance: inquiryCoverage?.provenance ?? "inquiry-store/INGEST:canonical",
  });
  refs.push(ref);
  findings.push({
    findingId: `f-${ref.evidenceId}`,
    specialist: "PRODUCT_OPS",
    statement: unanswered > 0
      ? `${productName}에 답변이 필요한 문의가 ${unanswered}건 있습니다.`
      : `${productName}에 답변이 필요한 문의는 없습니다`
        + ` (이 상품에 연결된 문의 ${view.signals.volume.inquiries}건 기준).`,
    evidenceIds: [ref.evidenceId],
    confidence: "NEEDS_REVIEW",
    verdict: null,
    surfaceLink: unanswered > 0 ? "/inquiries?state=NEEDS_REPLY" : null,
    needId,
  });
  return {
    id: needId, status: "SATISFIED", evidenceIds: [ref.evidenceId],
    coverage, complete: true, settledBy: "PRODUCT_OPS",
  };
}

/**
 * Which fact keys a need is asking for.
 *
 * <b>A small closed list, matched against the need's own question — never a free-text search.</b> The
 * backend accepts a bare name and expands it across namespaces, so "길이" finds `spec:길이`. Anything
 * unmatched sends an empty list, which reads every stored fact for that product: a slightly wider read
 * is a better failure than a confident "규격 정보가 없습니다" caused by a spelling difference.
 */
function factKeysFor(question: string, goalText: string): string[] {
  const haystack = `${question} ${goalText}`;
  const table: Array<[string, readonly string[]]> = [
    ["길이", ["길이", "폭", "너비", "mm", "cm", "센치", "센티"]],
    ["용량", ["용량", "ml", "리터", "L"]],
    ["중량", ["무게", "중량", "kg", "그램"]],
    ["수량", ["수량", "개수", "매", "몇 개", "몇개"]],
    ["원산지", ["원산지", "제조국"]],
  ];
  const keys = table.filter(([, words]) => words.some((w) => haystack.includes(w))).map(([key]) => key);
  return keys;
}

function coverageOf(view: ProductKnowledge | null, facet: string): KnowledgeCoverageRow | undefined {
  return view?.knowledgeCoverage.find((c) => c.facet === facet);
}

/**
 * The seller's word for a fact key.
 *
 * <b>`spec:길이` → `길이` was right; `taxonomy:brand` → `brand` was not.</b> Most keys carry the
 * channel's own Korean attribute label verbatim, which is exactly what a seller should read back. The
 * handful SellerOps names ITSELF ({@code FactKeys.TAXONOMY_BRAND} and its siblings) are English
 * identifiers, and stripping the namespace off one of those left "…의 brand은(는) 선바로입니다" on
 * screen — measured on a live run, 2026-08-24. Unknown keys keep the old behaviour: the channel's
 * label is the best word available and inventing a translation for it would be worse.
 */
const FACT_KEY_LABEL: Record<string, string> = {
  brand: "브랜드",
  manufacturer: "제조사",
  category: "카테고리",
  summary: "상세 설명",
};

function label(factKey: string): string {
  const at = factKey.indexOf(":");
  const name = at >= 0 ? factKey.slice(at + 1) : factKey;
  return FACT_KEY_LABEL[name] ?? name;
}

/**
 * The seller's word for the kind of document a passage came from.
 *
 * The English enum is a storage vocabulary; a sentence that says "POLICY 문서" to a seller is a
 * sentence written for the database. Unknown values fall back to the neutral noun rather than the raw
 * token, so a new type added server-side degrades to plain Korean instead of leaking an identifier.
 */
function sourceTypeLabel(sourceType: string): string {
  switch (sourceType) {
    case "DESCRIPTION": return "상품 설명 ";
    case "FAQ": return "자주 묻는 질문 ";
    case "USAGE": return "사용법 ";
    case "POLICY": return "정책 ";
    case "LINK": return "참고 자료 ";
    default: return "상품 지식 ";
  }
}

function dateOnly(instant: string | null): string | null {
  return instant ? instant.slice(0, 10) : null;
}

function empty(input: SpecialistInput, note: string): ProductOpsResult {
  return {
    specialist: "PRODUCT_OPS",
    findings: [],
    evidence: [],
    coverage: [],
    resolvedEntities: [],
    // Every need this specialist was given stays PENDING — the run must be able to say what it did
    // not find out, and a silently dropped need is exactly the silence v2 exists to end.
    needStates: input.needs.map((n) => ({ id: n.id, status: "PENDING" as const, evidenceIds: [] })),
    knowledge: {},
    knowledgeCoverage: [],
    note,
  };
}
