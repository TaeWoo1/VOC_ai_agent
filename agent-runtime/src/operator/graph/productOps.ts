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
import type { EvidenceRef, Finding, SpecialistResult } from "../state/OperatorState";
import type { NeedState, ResolvedEntity } from "../plan/InvestigationPlan";
import { OPERATOR_TOOL } from "../tools/OperatorTools";
import type { SpecialistInput } from "./specialistInput";
import type {
  KnowledgeCoverageRow,
  ProductFact,
  ProductKnowledge,
  ProductSummary,
  SignalCoverage,
} from "../../spring/types";
import { log } from "../../log";

/** The need kinds this specialist answers. Anything else belongs to another one. */
export const PRODUCT_NEEDS = [
  "PRODUCT_FACT", "PRODUCT_LISTING", "PRODUCT_VARIANT", "REVIEW_SIGNAL", "INQUIRY_VOLUME",
] as const;

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

  // ── 1. Resolve. The planner could not: it has no id and is refused if it invents one.
  const already = input.resolved.find((e) => e.kind === "PRODUCT");
  let productId = already?.id ?? null;
  let productName = already?.label ?? null;
  let ambiguous = already?.ambiguous ?? false;
  let usedMention = already?.mention ?? input.mentions[0] ?? "";
  const resolvedEntities: ResolvedEntity[] = [];

  if (!productId) {
    if (input.mentions.length === 0) {
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
        // More than one candidate is REPORTED, not silently resolved: the first of two plausible
        // products is a coin flip, and a coin flip answered confidently is the worst outcome here.
        productId = candidates[0]!.id;
        productName = candidates[0]!.name;
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
          statement: `${productName}에 대해 ${keys.length > 0 ? `"${keys.join(", ")}" ` : ""}`
            + "규격 정보를 SellerOps가 갖고 있지 않습니다. (상품에 그 규격이 없다는 뜻이 아닙니다.)",
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
          observedOn: dateOnly(fact.observedAt),
          coverage: "COVERED",
          provenance: `product-fact/${fact.source}:${fact.confidence}`,
        });
        refs.push(ref);
        cited.push(ref.evidenceId);
        findings.push({
          findingId: `f-${ref.evidenceId}`,
          specialist: "PRODUCT_OPS",
          statement: `${productName}의 ${label(fact.factKey)}은(는) ${fact.value}`
            + `${fact.unit ? fact.unit : ""}입니다 (출처 ${fact.source}).`,
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
            ? `${productName}의 채널 리스팅 정보를 SellerOps가 갖고 있지 않습니다.`
            : `${productName}의 옵션 정보를 SellerOps가 갖고 있지 않습니다.`,
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
          observedOn: dateOnly((listing ?? variant)!.observedAt),
          coverage: "COVERED",
          provenance: `product-knowledge/${(listing ?? variant)!.source ?? "UNKNOWN"}`,
        });
        refs.push(ref);
        cited.push(ref.evidenceId);
        findings.push({
          findingId: `f-${ref.evidenceId}`,
          specialist: "PRODUCT_OPS",
          statement: listing
            ? `${productName}은(는) ${listing.channelCode}에 `
              + `${listing.listingName ? `"${listing.listingName}" 으로 ` : ""}등록돼 있습니다`
              + `${listing.price != null ? ` (가격 ${listing.price}${listing.currency ?? ""})` : ""}`
              + `${listing.sellingStatus ? `, 판매상태 ${listing.sellingStatus}` : ""}.`
            : `${productName}에 옵션 "${variant!.optionName ?? variant!.externalVariantId}"이(가) `
              + `${variant!.channelCode}에 있습니다.`,
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

    // REVIEW_SIGNAL / INQUIRY_VOLUME for a resolved product — the v1 behaviour, kept intact.
    const view = await loadKnowledge();
    if (!view) {
      needStates.push({ id: need.id, status: "PENDING", evidenceIds: [] });
      continue;
    }
    const cited = signalFindings(view, productId, productName, need.id, evidence, refs, findings);
    needStates.push({
      id: need.id,
      status: cited.length > 0 ? "SATISFIED" : "UNSATISFIABLE",
      evidenceIds: cited,
      ...(cited.length === 0 ? { reason: "이 상품에 기록된 신호가 없습니다." } : {}),
    });
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
      observedOn: view.signals.referenceDate,
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
    knowledge,
    knowledgeCoverage: view?.knowledgeCoverage ?? [],
    ...(notes.length > 0 ? { note: notes.join(" ") } : {}),
  };
}

/** Signals for a resolved product — issues and unanswered volume, unchanged from v1 in substance. */
function signalFindings(
  view: ProductKnowledge, productId: string, productName: string, needId: string,
  evidence: SpecialistInput["evidence"], refs: EvidenceRef[], findings: Finding[],
): string[] {
  const cited: string[] = [];
  const issueCoverage = view.signals.coverage.find((c: SignalCoverage) => c.signal === "REVIEW_ISSUE");
  for (const issue of view.signals.issues.slice(0, 5)) {
    const ref = evidence.add({
      kind: "REVIEW_ISSUE",
      sourceTool: OPERATOR_TOOL.GET_PRODUCT_KNOWLEDGE,
      args: { productId },
      locator: {
        issueId: issue.id, productId, productName, count: issue.evidenceCount,
        label: issue.title, severity: issue.severity,
      },
      observedOn: issue.lastEvidenceOn,
      coverage: issueCoverage?.coverage ?? "COVERED",
      provenance: issueCoverage?.provenance ?? `issue-memory/${issue.extractorKind}`,
    });
    refs.push(ref);
    cited.push(ref.evidenceId);
    findings.push({
      findingId: `f-${ref.evidenceId}`,
      specialist: "PRODUCT_OPS",
      statement: `${productName}에서 "${issue.title}" 신호가 근거 ${issue.evidenceCount}건으로 기록돼 있습니다`
        + `${issue.change.labelsKo.length > 0 ? ` (${issue.change.labelsKo.join(", ")})` : ""}.`,
      evidenceIds: [ref.evidenceId],
      confidence: "NEEDS_REVIEW",
      verdict: null,
      surfaceLink: `/memory/${issue.id}`,
      needId,
    });
  }
  if (view.signals.volume.unansweredInquiries > 0) {
    const inquiryCoverage = view.signals.coverage.find((c: SignalCoverage) => c.signal === "INQUIRY");
    const ref = evidence.add({
      kind: "INQUIRY",
      sourceTool: OPERATOR_TOOL.GET_PRODUCT_KNOWLEDGE,
      args: { productId },
      locator: {
        productId, productName,
        count: view.signals.volume.unansweredInquiries, label: "미답변 문의",
      },
      observedOn: view.signals.referenceDate,
      coverage: inquiryCoverage?.coverage ?? "COVERED",
      provenance: inquiryCoverage?.provenance ?? "inquiry-store/INGEST:canonical",
    });
    refs.push(ref);
    cited.push(ref.evidenceId);
    findings.push({
      findingId: `f-${ref.evidenceId}`,
      specialist: "PRODUCT_OPS",
      statement: `${productName}에 답변이 필요한 문의가 ${view.signals.volume.unansweredInquiries}건 있습니다.`,
      evidenceIds: [ref.evidenceId],
      confidence: "NEEDS_REVIEW",
      verdict: null,
      surfaceLink: "/inquiries?state=NEEDS_REPLY",
      needId,
    });
  }
  return cited;
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

/** `spec:길이` → `길이`. The namespace is storage detail and has no place in a sentence. */
function label(factKey: string): string {
  const at = factKey.indexOf(":");
  return at >= 0 ? factKey.slice(at + 1) : factKey;
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
