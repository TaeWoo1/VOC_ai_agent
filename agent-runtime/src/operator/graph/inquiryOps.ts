/**
 * InquiryOps — what customers are asking, what we said before, and what keeps coming back.
 *
 * <b>v2 removes the fixed retrieval order, which was the specialist's real defect.</b> v1 always read
 * the inbox and then the repeats, in that order, for every goal that reached it. So "폭이 몇
 * mm인가요?", "교환 가능한가요?" and "전에 산 것과 색이 달라요" produced the same two reads and the
 * same two sentences. Now the planner declares needs and their order, and this specialist runs one
 * step per need it can serve — a volume question reads the inbox, a history question reads precedents,
 * and a question about a product's spec is not this specialist's at all.
 *
 * <b>It still reuses the existing inquiry graphs rather than re-implementing them.</b> The approve loop
 * and the draft graph are untouched and still reached through their own intents. What this adds is the
 * READ half an Operator answer needs.
 *
 * <b>The customer's words never reach this file.</b> The queue read returns work-item metadata, the
 * context read is explicitly body-free, and the recall read returns closed-vocabulary cues plus the
 * operator's own past approved reply.
 */
import type { EvidenceRef, Finding, SpecialistResult } from "../state/OperatorState";
import type { NeedState } from "../plan/InvestigationPlan";
import { OPERATOR_TOOL } from "../tools/OperatorTools";
import type { SpecialistInput } from "./specialistInput";
import type { OrgKnowledgeSearchResult } from "../../spring/types";
import type {
  CustomerMemorySearch, InboxSummary, InquiryQueueResponse, RepeatedInquiry,
} from "../../spring/types";
import { attemptTool, skippedTool, terminalOf } from "../failure/SpecialistOutcome";
import { eventOn, eventRange, observationDate } from "../scope/EvidenceTime";
import { groupingLimitSentence, groupingSupportOf } from "../tools/ToolReachability";
import { groupsBy } from "../group/ProductGrouping";
import { channelFindings, readChannelCoverage } from "./channelCoverageStep";
import type { ChannelCoverageCache } from "./channelCoverageStep";
import { REPEAT_WINDOW_DAYS } from "../defaults/OperationalDefaults";
import type { ToolFailure } from "../failure/SpecialistOutcome";
import { log } from "../../log";
import type { ResolvedEntity } from "../plan/InvestigationPlan";
import { inquiryIntentOf, readInquiryWorkload } from "./inquiryWorkloadStep";
import { readInquiryRows } from "./inquiryRowsStep";

/** Where the POLICY answer comes from — a store that does not exist, named honestly. Not a tool. */
/** Where the company's rules are written and read — the only link a policy finding may carry. */
const POLICY_SCREEN = "/settings/policies";
/** Passages quoted per POLICY need. The draft lane keeps one per lane; three is enough to say a rule. */
const POLICY_PASSAGES_MAX = 3;
/** `OrgKnowledgeType` → the seller's word for it (mirror of the backend's `labelKo`). */
const ORG_KNOWLEDGE_LABEL: Record<string, string> = {
  SHIPPING_POLICY: "배송", CANCELLATION_POLICY: "주문 취소", EXCHANGE_REFUND_POLICY: "교환 · 반품 · 환불",
  PAYMENT_POLICY: "결제", TAX_INVOICE: "세금계산서", CASH_RECEIPT: "현금영수증", GENERAL_CS_FAQ: "공통 안내", OTHER: "기타",
};
/**
 * The noun the seller used → the seller-facing word and the retrieval query.
 *
 * The query is the NOUN, not the sentence: the rules store is searched by a lexical retriever with an
 * absence gate over the question's content words, and 「이 문의에 우리 배송 정책 기준으로 답변해줘」
 * carries five words no policy contains. Live, that sentence found nothing beside a shipping policy
 * whose title was 「배송 안내」. The noun is what the seller asked about; the rest was addressed to us.
 */
const POLICY_TOPIC_WORDS: ReadonlyArray<readonly [RegExp, string, string]> = [
  [/배송|택배|출고|발송/, "배송", "배송"], [/교환|반품|환불/, "교환·반품·환불", "교환 반품 환불"],
  [/취소/, "주문 취소", "주문 취소"], [/세금계산서/, "세금계산서", "세금계산서"],
  [/현금영수증/, "현금영수증", "현금영수증"], [/결제|카드|무통장/, "결제", "결제"],
];

function policyTopicOf(input: SpecialistInput, need: { readonly question: string }): readonly [string, string] | null {
  const topic = input.filters?.topic;
  if (topic === "SHIPPING") return ["배송", "배송"];
  if (topic === "EXCHANGE_RETURN") return ["교환·반품·환불", "교환 반품 환불"];
  for (const text of [input.goalText ?? "", input.plannerGoal ?? "", need.question]) {
    const hit = POLICY_TOPIC_WORDS.find(([re]) => re.test(text));
    if (hit) return [hit[1], hit[2]];
  }
  return null;
}

function policyQueryOf(input: SpecialistInput, need: { readonly question: string }): string {
  const topic = policyTopicOf(input, need);
  if (topic) return topic[1];
  const goal = (input.goalText ?? input.plannerGoal ?? "").trim();
  return (goal.length > 0 ? goal : need.question).slice(0, 400);
}

function policyTopicWord(input: SpecialistInput, need: { readonly question: string }): string {
  return policyTopicOf(input, need)?.[0] ?? "운영";
}

/**
 * How much of the queue one read takes, and what counts as having waited.
 *
 * The page cap is the endpoint's own maximum; asking for it means a demo-sized queue comes back whole
 * and says so, and a large one comes back truncated and says that instead.
 */
const QUEUE_PAGE = 100;
const WAITING_DAYS = 30;

/** The need kinds this specialist answers. */
export const INQUIRY_NEEDS = ["INQUIRY_VOLUME", "CUSTOMER_HISTORY", "REPEAT_PATTERN", "POLICY"] as const;

export interface InquiryOpsResult extends SpecialistResult {
  readonly needStates: readonly NeedState[];
}

export async function runInquiryOps(input: SpecialistInput): Promise<InquiryOpsResult> {
  const { registry, budget, evidence, allowedTools } = input;
  const findings: Finding[] = [];
  const refs: EvidenceRef[] = [];
  const notes: string[] = [];
  const needStates: NeedState[] = [];
  // Isolation state. `succeeded` counts reads that came back — including ones that came back empty,
  // because an empty answer from a working source is a fact, not a failure.
  const failures: ToolFailure[] = [];
  let succeeded = 0;
  // One queue read per RUN, not per need. A plan may declare two INQUIRY_VOLUME needs — "총 몇 건" and
  // "첫 페이지 목록" are a real decomposition and the live planner writes it — and they are answered by
  // the same page. Reading it twice would buy the same rows twice and print the same sentence twice.
  const queue: { read: QueueRead | null } = { read: null };
  // One coverage read per RUN, for the same reason the queue has one: the channels a seller sells on
  // do not change between two needs, and a second read would mint a second set of rows saying so.
  const coverage: ChannelCoverageCache = { read: null };
  let pushedCoverage = false;
  // The one inquiry this run was opened on, when the screen said which (Contextual Agent Contract
  // Completion v1). Resolved by the runtime with one org-scoped read; the ref it minted is the only
  // evidence about this inquiry the specialist will ever cite — see {@link focusedInquiry}.
  const focus = focusedInquiry(input);

  // One workload read per RUN (Agentic Operating Workspace v2) — the classified queue answers every
  // INQUIRY_VOLUME need the plan declared, the same way one inbox read does on the count path.
  let workloadRead = false;
  const artifacts: import("../../conversation/contract").Artifact[] = [];
  // Query Accuracy v1: ONE explicit routing decision per run, from the plan's closed `inquiryIntent`
  // token — ROWS (the customer's inquiries), WORKLOAD (the seller's queue) or COUNT (one number). Never
  // from whether some other filter happened to be set.
  const intent = inquiryIntentOf(input);

  for (const need of input.needs) {
    if (need.kind === "INQUIRY_VOLUME" && focus) {
      // <b>A run about ONE inquiry has no use for the org's queue, whichever shape it was asked in.</b>
      // The gate would refuse every row of it (ORG evidence for an ITEM need), so the read is not made
      // and the need says why. This used to hold only on the COUNT path: a draft turn opened on one
      // inquiry is a WORKLOAD intent by definition, so it read the whole queue, had it refused, and
      // printed 「전체 집계뿐이라 이 상품의 근거로는 쓸 수 없습니다」 under a draft for one inquiry
      // (Knowledge Context v1-A closure, live 2026-08-30). The C3 rule is about the entity, not the
      // intent token.
      needStates.push({
        id: need.id,
        status: "UNSATISFIABLE",
        evidenceIds: [],
        reason: "이 문의 하나를 조사하는 중이라 전체 대기열 집계는 읽지 않았습니다.",
      });
      continue;
    }
    if (need.kind === "INQUIRY_VOLUME" && intent !== "COUNT") {
      if (workloadRead) {
        needStates.push({ id: need.id, status: "PENDING", evidenceIds: [] });
        continue;
      }
      workloadRead = true;
      const read = intent === "ROWS" ? await readInquiryRows(input, need.id) : await readInquiryWorkload(input, need.id);
      failures.push(...read.failures);
      if (read.evidence.length > 0) succeeded += 1;
      refs.push(...read.evidence);
      findings.push(...read.findings);
      notes.push(...read.notes);
      artifacts.push(...read.artifacts);
      needStates.push(read.needState);
      continue;
    }
    if (need.kind === "INQUIRY_VOLUME"
        && (groupsBy(input.grouping, "CHANNEL") || input.channelScope != null)) {
      // <b>The org total is the wrong shape for this question, and the gate already knows it.</b> A
      // run that names a channel has every org-wide citation refused as CHANNEL_UNPROVEN — correctly,
      // and until now with nothing to accept instead, so the answer was a withholding note. Coverage
      // rows carry `locator.channelCode`, which is the first evidence in this runtime that a claim
      // about NAVER can be checked as a claim about NAVER.
      const read = await readChannelCoverage(input, "INQUIRY_OPS", coverage, need.id);
      failures.push(...read.failures);
      if (read.evidence.length === 0) {
        needStates.push({ id: need.id, status: "PENDING", evidenceIds: [] });
        continue;
      }
      succeeded += 1;
      // <b>The evidence is the RUN's, not this need's.</b> A plan may declare two volume needs — the
      // live planner wrote "전체 건수" and "채널별 건수" as separate needs on 2026-08-24 — and both are
      // answered from one coverage read. Pushing its refs once per need printed all nine rows twice.
      if (!pushedCoverage) {
        pushedCoverage = true;
        refs.push(...read.evidence);
      }
      const produced = channelFindings(
        read, "INQUIRY", "INQUIRY_OPS", need.id, input.channelScope,
      );
      findings.push(...produced.findings);
      if (produced.rows.length === 0) {
        notes.push("요청한 채널의 문의 수집 상태를 확인할 수 없었습니다.");
      }
      // <b>Answering one axis is not answering both.</b> "채널별 상품 문의" asks for a cross, and the
      // channel half alone would read as the whole answer. The queue row carries a channel and no
      // product, so the cross fails on the product half — and the run says which half.
      if (groupsBy(input.grouping, "PRODUCT")) {
        const cross = groupingLimitSentence(
          need.kind, groupingSupportOf(need.kind, "PRODUCT_CHANNEL"), produced.rows.length > 0,
        );
        if (cross) {
          const gap = evidence.add({
            kind: "GROUPING_GAP",
            sourceTool: OPERATOR_TOOL.GET_CHANNEL_COVERAGE,
            args: { grouping: "PRODUCT_CHANNEL" },
            locator: { count: produced.rows.length, label: "상품×채널 문의" },
            events: null,
            coverage: "COVERED",
            provenance: "channel-coverage/cross:no-product-axis",
          });
          refs.push(gap);
          findings.push({
            findingId: `f-${gap.evidenceId}`,
            specialist: "INQUIRY_OPS",
            statement: cross,
            evidenceIds: [gap.evidenceId],
            confidence: "NEEDS_REVIEW",
            verdict: null,
            surfaceLink: null,
            claimsCoverageLimit: true,
            needId: need.id,
          });
        }
      }
      needStates.push({
        id: need.id,
        status: produced.findings.length > 0 ? "SATISFIED" : "PENDING",
        evidenceIds: read.evidence
          .filter((e) => produced.rows.some((r) => r.channelCode === e.locator.channelCode))
          .map((e) => e.evidenceId),
      });
      continue;
    }

    if (need.kind === "INQUIRY_VOLUME") {
      // (A focused run never reaches here — the entity rule above answered the need first.)
      // <b>The org inbox cannot answer a product question, and the run may already hold one that
      // can.</b> `get_today_inbox` returns the whole org's unanswered depth; for a need about a
      // resolved product the scope gate refuses it (ORG_EVIDENCE_FOR_PRODUCT_NEED) and always will.
      // When ProductOps has already read this product's own unanswered count, spending a tool call to
      // produce a row that will be thrown away — and a withholding note beside an answer that was in
      // fact given — is worse than not reading. Same precedence rule as ReviewOps', by evidence.
      const product = input.resolved.find((e) => e.kind === "PRODUCT");
      if (product && hasProductInquiryCount(input.priorEvidence, product.id)) {
        needStates.push({ id: need.id, status: "PENDING", evidenceIds: [] });
        continue;
      }
      if (!budget.spend("tool")) {
        needStates.push({ id: need.id, status: "PENDING", evidenceIds: [] });
        continue;
      }
      const attempt = await attemptTool(
        { specialist: "INQUIRY_OPS", tool: OPERATOR_TOOL.GET_TODAY_INBOX, needId: need.id },
        () => registry.invoke<InboxSummary>(OPERATOR_TOOL.GET_TODAY_INBOX, {}, allowedTools),
      );
      if (!attempt.ok) {
        failures.push(attempt.failure);
        needStates.push({ id: need.id, status: "PENDING", evidenceIds: [] });
        continue;
      }
      succeeded += 1;
      const inbox = attempt.value;
      const ref = evidence.add({
        kind: "INBOX_COUNT",
        sourceTool: OPERATOR_TOOL.GET_TODAY_INBOX,
        args: {},
        locator: { count: inbox.unansweredInquiries, label: "미답변 문의" },
        // <b>A snapshot of the CURRENT state, not a period's intake.</b> `unansweredInquiries` is the
        // depth of the queue at the moment of the read: the rows in it may have arrived this morning or
        // last year, and this read cannot tell which. So it gets an observation time (the builder's,
        // automatically) and NO event range — which is what stops it from ever answering "오늘 몇 건
        // 들어왔어". See `scope/EvidenceTime.ts`.
        events: null,
        // The org-wide unanswered count is a server-side total with no attribution question, so its
        // coverage is genuinely COVERED — unlike anything product- or account-scoped.
        coverage: "COVERED",
        provenance: "inbox/SERVER:unansweredInquiries",
      });
      refs.push(ref);
      if (inbox.unansweredInquiries > 0) {
        findings.push({
          findingId: `f-${ref.evidenceId}`,
          specialist: "INQUIRY_OPS",
          // The server's uncapped number — the SAME one the home screen prints. A report that
          // recounted it off a page printed ≤50 under the same label; that is the defect this pins.
          // "현재" is load-bearing, not politeness: the evidence proves a queue depth now, and a
          // sentence without it invites the reader to hear an intake for today.
          statement: `현재 답변이 필요한 문의가 ${inbox.unansweredInquiries}건 있습니다.`,
          evidenceIds: [ref.evidenceId],
          confidence: "NEEDS_REVIEW",
          verdict: null,
          surfaceLink: "/inquiries?state=NEEDS_REPLY",
          needId: need.id,
        });
      } else {
        notes.push("답변이 필요한 문의는 없습니다.");
      }

      // <b>A count is not a priority order.</b> "우선순위대로 정리해줘" asked which ones to do first, and
      // the total answers a different question. The queue page carries a work-item id and a receipt
      // time per row — and no customer text, by the endpoint's own construction — so the run can order
      // by how long each has waited, which is a basis the rows themselves prove. Anything else would be
      // a ranking this runtime invented (§4 of the package: no arbitrary ranking).
      const first = queue.read == null;
      const queued = queue.read ?? (queue.read = await readQueue(input, need.id, inbox.unansweredInquiries));
      if (first) {
        refs.push(...queued.evidence);
        findings.push(...queued.findings);
        notes.push(...queued.notes);
        failures.push(...queued.failures);
        if (queued.evidence.length > 0) {
          succeeded += 1;
        }
      }
      // Settled by everything that answered it — the count and, when it ran, the queue behind it. A
      // need state that named only the count would leave the priority sentences citing evidence the
      // need does not admit to resting on.
      needStates.push({
        id: need.id,
        status: "SATISFIED",
        evidenceIds: [ref.evidenceId, ...queued.evidence.map((e) => e.evidenceId)],
      });

      // The axis, when one was asked for. `Inquiry.productId` exists and the backend counts by it —
      // but only for a product already named, and the queue row carries no product at all. So the
      // limit is stated instead of being worked around, and the total is labelled as a total.
      if (groupsBy(input.grouping, "PRODUCT")) {
        const limit = groupingLimitSentence(need.kind, groupingSupportOf(need.kind, "PRODUCT"));
        if (limit) {
          const gap = evidence.add({
            kind: "GROUPING_GAP",
            sourceTool: OPERATOR_TOOL.SEARCH_UNANSWERED_INQUIRIES,
            args: { grouping: "PRODUCT" },
            locator: { count: inbox.unansweredInquiries, label: "상품별 미답변 문의" },
            events: null,
            coverage: "COVERED",
            provenance: "inquiry-queue/OPEN:no-product-axis",
          });
          refs.push(gap);
          findings.push({
            findingId: `f-${gap.evidenceId}`,
            specialist: "INQUIRY_OPS",
            statement: limit,
            evidenceIds: [gap.evidenceId],
            confidence: "NEEDS_REVIEW",
            verdict: null,
            surfaceLink: null,
            claimsCoverageLimit: true,
            needId: need.id,
          });
        }
      }
      continue;
    }

    if (need.kind === "REPEAT_PATTERN") {
      if (!budget.spend("tool")) {
        needStates.push({ id: need.id, status: "PENDING", evidenceIds: [] });
        continue;
      }
      const attempt = await attemptTool(
        { specialist: "INQUIRY_OPS", tool: OPERATOR_TOOL.LIST_REPEATED_INQUIRIES, needId: need.id },
        () => registry.invoke<RepeatedInquiry[]>(
          OPERATOR_TOOL.LIST_REPEATED_INQUIRIES,
          { ...(input.referenceDate ? { referenceDate: input.referenceDate } : {}) },
          allowedTools,
        ),
      );
      if (!attempt.ok) {
        failures.push(attempt.failure);
        needStates.push({ id: need.id, status: "PENDING", evidenceIds: [] });
        continue;
      }
      succeeded += 1;
      const repeats = attempt.value;
      // The window this run was actually answered on comes from the ROWS, not from our mirror of the
      // backend constant. A mismatch means the contract moved and `OperationalDefaults` is now describing
      // a window nobody applied — worth a log line, never worth silently preferring our own number.
      const echoed = repeats.find((r) => r.windowDays > 0)?.windowDays;
      if (echoed != null && echoed !== REPEAT_WINDOW_DAYS) {
        log("operator_default_drift", {
          tool: OPERATOR_TOOL.LIST_REPEATED_INQUIRIES, declared: REPEAT_WINDOW_DAYS, applied: echoed,
        });
      }
      const cited: string[] = [];
      for (const repeat of repeats.slice(0, 3)) {
        const ref = evidence.add({
          kind: "REPEATED_INQUIRY",
          sourceTool: OPERATOR_TOOL.LIST_REPEATED_INQUIRIES,
          args: { referenceDate: input.referenceDate ?? null },
          locator: { count: repeat.occurrences, label: repeat.labelKo },
          // The rows' OWN span, from the data. Not the 30-day window the query asked for: asking for a
          // window never proves a row fell inside it.
          events: eventRange(repeat.firstSeenOn, repeat.lastSeenOn),
          coverage: "COVERED",
          provenance: `customer-memory/${repeat.axis}`,
        });
        refs.push(ref);
        cited.push(ref.evidenceId);
        findings.push({
          findingId: `f-${ref.evidenceId}`,
          specialist: "INQUIRY_OPS",
          // A fully-answered repeat is a documentation gap; a partly-answered one is a backlog. Saying
          // which is the difference between "FAQ에 넣으세요" and "답변이 밀렸습니다".
          statement: repeat.answeredOccurrences >= repeat.occurrences
            ? `"${repeat.labelKo}" 문의가 최근 ${repeat.windowDays}일 동안 ${repeat.occurrences}건 반복됐고 모두 답변했습니다.`
            : `"${repeat.labelKo}" 문의가 최근 ${repeat.windowDays}일 동안 ${repeat.occurrences}건 반복됐습니다`
              + ` (${repeat.answeredOccurrences}건 답변 완료).`,
          evidenceIds: [ref.evidenceId],
          confidence: "NEEDS_REVIEW",
          verdict: null,
          surfaceLink: "/inquiries",
          needId: need.id,
        });
      }
      if (repeats.length === 0) {
        notes.push("반복해서 들어온 문의는 확인되지 않았습니다.");
      }
      // <b>"최근 28일 반복 0건" is an ORG answer, and the seller asked about products.</b> A repeat row
      // is a cluster of inquiries by signature and carries no product anywhere in it, so the axis
      // cannot be produced — from this read or any other. Saying so is the difference between "이
      // 상품들에는 반복이 없습니다" (a claim about products, unproven) and "상품별로는 나눌 수
      // 없습니다" (the truth). Live 2026-08-23·24: Q3 answered the first shape twice.
      if (groupsBy(input.grouping, "PRODUCT")) {
        const limit = groupingLimitSentence(
          need.kind, groupingSupportOf(need.kind, "PRODUCT"), repeats.length > 0,
        );
        const gap = evidence.add({
          kind: "GROUPING_GAP",
          sourceTool: OPERATOR_TOOL.LIST_REPEATED_INQUIRIES,
          args: { grouping: "PRODUCT" },
          locator: { count: repeats.length, label: "상품별 반복 문의" },
          events: null,
          coverage: "COVERED",
          provenance: "customer-memory/repeats:no-product-axis",
        });
        refs.push(gap);
        findings.push({
          findingId: `f-${gap.evidenceId}`,
          specialist: "INQUIRY_OPS",
          statement: limit ?? "",
          evidenceIds: [gap.evidenceId],
          confidence: "NEEDS_REVIEW",
          verdict: null,
          surfaceLink: null,
          claimsCoverageLimit: true,
          needId: need.id,
        });
      }
      needStates.push({
        id: need.id,
        status: cited.length > 0 ? "SATISFIED" : "UNSATISFIABLE",
        evidenceIds: cited,
        ...(cited.length === 0 ? { reason: "이 기간에 반복 패턴이 확인되지 않았습니다." } : {}),
      });
      continue;
    }

    if (need.kind === "CUSTOMER_HISTORY") {
      // <b>The anchor is checked BEFORE the call, and its absence is a reason rather than a 400.</b>
      // `/api/customer-memory/search` requires one of inquiryId / signatureKey / topic / productId and
      // refuses the rest — correctly: without an anchor the "past cases" lookup is a whole-org trawl,
      // which is a different and much wider read than the one this need asked for. Live 2026-08-23 this
      // specialist asked anyway, with `{limit: 5}`, and the backend's correct refusal took the whole
      // specialist down with it (`docs/agent_real_validation_v1.md` §3 Q5).
      //
      // A resolved product is the only anchor reachable here today. The seller's own words are NOT an
      // anchor: a customer sentence is never a query string, which is why the endpoint has no free-text
      // parameter. So when there is no product, this need is not served and SAYS it is not served.
      // <b>The inquiry itself is the exact anchor when the run has one.</b> `inquiryId` is what the
      // endpoint documents for "cases like this one"; a product is the wider net and is used only when
      // no inquiry was named. The id came out of the runtime's verified read, never from the URL.
      const focusInquiryId = focus?.ref.locator.inquiryId ?? null;
      const product = input.resolved.find((e) => e.kind === "PRODUCT");
      if (!focusInquiryId && !product) {
        failures.push(skippedTool({
          specialist: "INQUIRY_OPS",
          tool: OPERATOR_TOOL.SEARCH_CUSTOMER_MEMORY,
          needId: need.id,
        }));
        needStates.push({
          id: need.id,
          status: "UNSATISFIABLE",
          evidenceIds: [],
          reason: "과거 대응 사례는 대상 상품이나 문의를 먼저 특정해야 찾을 수 있습니다.",
        });
        continue;
      }
      // Charged only now: the budget pays for calls that happen. Live 2026-08-23 the re-run spent three
      // tool charges on three needs whose call was correctly skipped, which is a run buying nothing.
      if (!budget.spend("tool")) {
        needStates.push({ id: need.id, status: "PENDING", evidenceIds: [] });
        continue;
      }
      const attempt = await attemptTool(
        { specialist: "INQUIRY_OPS", tool: OPERATOR_TOOL.SEARCH_CUSTOMER_MEMORY, needId: need.id },
        () => registry.invoke<CustomerMemorySearch>(
          OPERATOR_TOOL.SEARCH_CUSTOMER_MEMORY,
          focusInquiryId ? { inquiryId: focusInquiryId, limit: 5 } : { productId: product!.id, limit: 5 },
          allowedTools,
        ),
      );
      if (!attempt.ok) {
        failures.push(attempt.failure);
        needStates.push({ id: need.id, status: "PENDING", evidenceIds: [] });
        continue;
      }
      succeeded += 1;
      const recall = attempt.value;
      const cited: string[] = [];
      for (const hit of recall.hits.slice(0, 3)) {
        const ref = evidence.add({
          kind: "CUSTOMER_MEMORY",
          sourceTool: OPERATOR_TOOL.SEARCH_CUSTOMER_MEMORY,
          args: focusInquiryId ? { inquiryId: focusInquiryId } : { productId: product!.id },
          locator: {
            ...(focusInquiryId ? { inquiryId: focusInquiryId, workItemId: focus!.entity.id } : {}),
            ...(hit.productId ? { productId: hit.productId } : {}),
            ...(hit.productName ? { productName: hit.productName } : {}),
            ...(hit.channelCode ? { channelCode: hit.channelCode } : {}),
            label: hit.signatureKey ?? hit.topic ?? "과거 사례",
          },
          events: eventOn(hit.occurredOn),
          coverage: recall.coverage.coverage,
          provenance: `${recall.coverage.provenance}/${hit.retrieverKind}:${hit.retrieverVersion}`,
        });
        refs.push(ref);
        cited.push(ref.evidenceId);
        findings.push({
          findingId: `f-${ref.evidenceId}`,
          specialist: "INQUIRY_OPS",
          statement: hit.answered
            ? `"${hit.signatureKey ?? hit.topic}" 건은 과거에 같은 유형으로 답변한 적이 있습니다`
              + `${hit.occurredOn ? ` (${hit.occurredOn})` : ""}.`
            : `"${hit.signatureKey ?? hit.topic}" 건이 과거에도 있었고 아직 답변되지 않았습니다`
              + `${hit.occurredOn ? ` (${hit.occurredOn})` : ""}.`,
          evidenceIds: [ref.evidenceId],
          confidence: "NEEDS_REVIEW",
          verdict: null,
          surfaceLink: "/memory",
          needId: need.id,
        });
      }
      if (recall.hits.length === 0) {
        notes.push("같은 유형의 과거 대응 기록은 찾지 못했습니다.");
      }
      needStates.push({
        id: need.id,
        status: cited.length > 0 ? "SATISFIED" : "UNSATISFIABLE",
        evidenceIds: cited,
        ...(cited.length === 0 ? { reason: "색인된 과거 사례가 없습니다." } : {}),
      });
      continue;
    }

    // POLICY — the company's own operating rules, read on the turn that needs them (Knowledge Context
    // v1-A). Before this the branch was a fixed sentence — 「판매 정책은 보관하고 있지 않아」 — and it
    // was wrong for every org that had written one: `org_knowledge_sources` existed, the inquiry draft
    // lane read it, and the Agent lane could not reach it. Now the same corpus is searched, org-scoped
    // by the bearer, and an empty result is the gap it always was — said with the seller's own noun and
    // the screen where the rule can be written. Nothing here composes a policy: the sentence quotes the
    // passage or says none is registered.
    if (!budget.spend("tool")) {
      needStates.push({ id: need.id, status: "PENDING", evidenceIds: [] });
      continue;
    }
    const query = policyQueryOf(input, need);
    const topic = policyTopicWord(input, need);
    const attempt = await attemptTool(
      { specialist: "INQUIRY_OPS", tool: OPERATOR_TOOL.SEARCH_ORG_KNOWLEDGE, needId: need.id },
      () => registry.invoke<OrgKnowledgeSearchResult>(
        OPERATOR_TOOL.SEARCH_ORG_KNOWLEDGE, { query, limit: POLICY_PASSAGES_MAX }, allowedTools,
      ),
    );
    if (!attempt.ok) {
      failures.push(attempt.failure);
      needStates.push({ id: need.id, status: "PENDING", evidenceIds: [] });
      continue;
    }
    succeeded += 1;
    const found = attempt.value;
    if (found.passages.length === 0) {
      const registered = found.documentsSearched > 0;
      const ref = evidence.add({
        kind: "ORG_POLICY_GAP",
        sourceTool: OPERATOR_TOOL.SEARCH_ORG_KNOWLEDGE,
        args: { query },
        locator: { facet: "POLICY", label: `${topic} 기준 없음` },
        coverage: "COVERED",
        provenance: `org-knowledge/${registered ? "NO_MATCH" : "EMPTY"}`,
      });
      refs.push(ref);
      findings.push({
        findingId: `f-${ref.evidenceId}`,
        specialist: "INQUIRY_OPS",
        statement: registered
          ? `등록된 운영 기준 중 ${topic}에 해당하는 내용이 아직 없습니다.`
          : `등록된 ${topic} 기준이 아직 없습니다.`,
        evidenceIds: [ref.evidenceId],
        confidence: "NEEDS_REVIEW",
        verdict: null,
        surfaceLink: POLICY_SCREEN,
        claimsCoverageLimit: true,
        needId: need.id,
      });
      needStates.push({
        id: need.id, status: "UNSATISFIABLE", evidenceIds: [ref.evidenceId],
        reason: registered ? "등록된 운영 기준이 이 질문을 다루지 않습니다." : "등록된 운영 기준이 없습니다.",
      });
      continue;
    }
    const cited: string[] = [];
    for (const passage of found.passages.slice(0, POLICY_PASSAGES_MAX)) {
      const ref = evidence.add({
        kind: "ORG_POLICY",
        sourceTool: OPERATOR_TOOL.SEARCH_ORG_KNOWLEDGE,
        args: { query },
        // Metadata only: the title is the label, the body stays in the finding the seller reads.
        locator: { facet: String(passage.knowledgeType), label: passage.title, title: passage.title,
          sourceId: passage.sourceId, chunkId: passage.chunkId },
        asOf: passage.updatedAt ? passage.updatedAt.slice(0, 10) : null,
        coverage: "COVERED",
        provenance: `org-knowledge/${passage.knowledgeType}:v${passage.version}`,
      });
      refs.push(ref);
      cited.push(ref.evidenceId);
      const kindLabel = ORG_KNOWLEDGE_LABEL[String(passage.knowledgeType)] ?? "운영";
      findings.push({
        findingId: `f-${ref.evidenceId}`,
        specialist: "INQUIRY_OPS",
        // The seller reads their own words, attributed as theirs.
        statement: `판매자가 등록한 ${kindLabel} 기준 "${passage.title}"에 이렇게 적혀 있습니다: ${passage.content}`,
        // The judge learns that a rule of this kind and title covers the question — never its text.
        judgeStatement: `판매자가 등록한 ${kindLabel} 기준 "${passage.title}"이(가) 이 질문에 해당하는 내용을 담고 있습니다.`,
        evidenceIds: [ref.evidenceId],
        confidence: "NEEDS_REVIEW",
        verdict: null,
        surfaceLink: POLICY_SCREEN,
        needId: need.id,
      });
    }
    needStates.push({ id: need.id, status: "SATISFIED", evidenceIds: cited });
  }

  // <b>What the run may say about the inquiry it was opened on — from the runtime's ref, no read.</b>
  // Attached to the specialist's first answerable need: the ref is the run's, and a finding has to
  // rest on a need in the plan. Counted as a successful read because the read that produced the ref
  // succeeded — before this node, in the runtime.
  if (focus) {
    const at = needStates.findIndex((n) => n.status === "SATISFIED" || n.status === "PENDING");
    const hostAt = at >= 0 ? at : needStates.length > 0 ? 0 : -1;
    if (hostAt >= 0) {
      const host = needStates[hostAt]!;
      findings.push(...focusFindings(focus, host.id));
      needStates[hostAt] = {
        ...host,
        status: host.status === "PENDING" ? "SATISFIED" : host.status,
        evidenceIds: host.evidenceIds.includes(focus.ref.evidenceId)
          ? host.evidenceIds
          : [...host.evidenceIds, focus.ref.evidenceId],
      };
      succeeded += 1;
    }
  }

  const terminal = terminalOf({ succeeded, failures });
  log("inquiry_ops", {
    needs: input.needs.length, findings: findings.length, succeeded, failed: failures.length, terminal,
  });
  return {
    specialist: "INQUIRY_OPS",
    findings,
    evidence: refs,
    coverage: [],
    needStates,
    failures,
    terminal,
    ...(artifacts.length > 0 ? { artifacts } : {}),
    // Deduped: one read serves every need of its kind, so "반복 문의는 없었습니다" is one fact however
    // many needs asked for it. Three copies of a true sentence read as three findings.
    ...(notes.length > 0 ? { note: [...new Set(notes)].join(" ") } : {}),
  };
}

/**
 * The queue behind the count: how many are waiting, and which has waited longest.
 *
 * <b>Nothing the customer wrote leaves this function.</b> `InquiryQueueItem.title` is the seller-visible
 * subject line and is deliberately never read here — the run needs the receipt time and the work-item
 * id, and reading a subject would put customer words into an answer that has no lane for them.
 *
 * <b>The two totals are different reads and are labelled as such.</b> `get_today_inbox` counts rows with
 * status UNANSWERED; this page lists rows in phase OPEN. Live 2026-08-24 on the demo org they were 69
 * and 68. Presenting either as "the" number would make one of them wrong, so both are named with what
 * they counted, and the gap is disclosed rather than reconciled by this runtime.
 */
interface QueueRead {
  readonly findings: Finding[];
  readonly evidence: EvidenceRef[];
  readonly notes: string[];
  readonly failures: ToolFailure[];
}

async function readQueue(
  input: SpecialistInput, needId: string, countedUnanswered: number,
): Promise<QueueRead> {
  const { registry, budget, evidence, allowedTools } = input;
  const empty = { findings: [] as Finding[], evidence: [] as EvidenceRef[], notes: [] as string[],
    failures: [] as ToolFailure[] };
  // A product-scoped run has no use for the org queue — the gate would refuse every row of it, and a
  // call whose result is known to be unusable is a call not worth making (the C3 precedence rule).
  if (input.resolved.some((e) => e.kind === "PRODUCT" || e.kind === "INQUIRY")) {
    return empty;
  }
  if (!budget.spend("tool")) {
    return empty;
  }
  const attempt = await attemptTool(
    { specialist: "INQUIRY_OPS", tool: OPERATOR_TOOL.SEARCH_UNANSWERED_INQUIRIES, needId },
    () => registry.invoke<InquiryQueueResponse>(
      OPERATOR_TOOL.SEARCH_UNANSWERED_INQUIRIES, { page: 0, size: QUEUE_PAGE }, allowedTools,
    ),
  );
  if (!attempt.ok) {
    return { ...empty, failures: [attempt.failure] };
  }
  const page = attempt.value;
  const rows = [...page.content].sort((a, b) => a.receivedAt.localeCompare(b.receivedAt));
  if (rows.length === 0) {
    return empty;
  }
  const oldest = rows[0]!;
  const oldestOn = oldest.receivedAt.slice(0, 10);
  const today = observationDate(input.referenceDate);
  const waiting = rows.filter((r) => daysBetween(r.receivedAt.slice(0, 10), today) >= WAITING_DAYS).length;
  const complete = rows.length >= page.totalElements;

  const pageRef = evidence.add({
    kind: "INQUIRY",
    sourceTool: OPERATOR_TOOL.SEARCH_UNANSWERED_INQUIRIES,
    args: { page: 0, size: QUEUE_PAGE },
    locator: { count: page.totalElements, label: "답변 대기 문의" },
    // The rows' OWN receipt dates — the queue is the one inquiry read that can date what is in it.
    events: eventRange(oldestOn, rows[rows.length - 1]!.receivedAt.slice(0, 10)),
    coverage: "COVERED",
    provenance: "inquiry-queue/OPEN",
  });
  const oldestRef = evidence.add({
    kind: "INQUIRY",
    sourceTool: OPERATOR_TOOL.SEARCH_UNANSWERED_INQUIRIES,
    args: { workItemId: oldest.workItemId },
    locator: { workItemId: oldest.workItemId, label: "가장 오래 기다린 문의" },
    events: eventOn(oldestOn),
    coverage: "COVERED",
    provenance: "inquiry-queue/OPEN:oldest",
  });

  const findings: Finding[] = [{
    findingId: `f-${pageRef.evidenceId}`,
    specialist: "INQUIRY_OPS",
    // "먼저 볼 순서" is the receipt order, and the sentence says so: the basis is the rows' dates, not
    // an importance this runtime has no way to judge.
    statement: `답변 대기열에서 ${page.totalElements}건을 확인했고, 접수 순서대로 보면 `
      + `${oldestOn}에 접수된 건이 가장 오래 기다렸습니다`
      + (complete ? "" : ` (${rows.length}건까지만 확인)`) + ".",
    evidenceIds: [pageRef.evidenceId, oldestRef.evidenceId],
    confidence: "NEEDS_REVIEW",
    verdict: null,
    surfaceLink: "/inquiries?state=NEEDS_REPLY",
    needId,
  }];
  if (waiting > 0) {
    findings.push({
      findingId: `f-${pageRef.evidenceId}-aging`,
      specialist: "INQUIRY_OPS",
      statement: `그중 ${waiting}건은 접수된 지 ${WAITING_DAYS}일이 넘었습니다.`,
      evidenceIds: [pageRef.evidenceId],
      confidence: "NEEDS_REVIEW",
      verdict: null,
      surfaceLink: "/inquiries?state=NEEDS_REPLY",
      needId,
    });
  }
  const notes: string[] = [];
  if (countedUnanswered !== page.totalElements) {
    notes.push(`미답변 집계(${countedUnanswered}건)와 답변 대기열 목록(${page.totalElements}건)은 `
      + "세는 대상이 서로 완전히 같지는 않습니다.");
  }
  log("inquiry_queue", {
    total: page.totalElements, read: rows.length, complete, waiting,
    matchesCount: countedUnanswered === page.totalElements,
  });
  return { findings, evidence: [pageRef, oldestRef], notes, failures: [] };
}

/** Whole days between two ISO dates. Dates only — no clock, no zone, nothing to drift. */
function daysBetween(from: string, to: string): number {
  const ms = Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`);
  return Number.isNaN(ms) ? 0 : Math.floor(ms / 86_400_000);
}

/** Whether the run already holds THIS product's own unanswered-inquiry count. */
function hasProductInquiryCount(
  priorEvidence: readonly EvidenceRef[] | undefined, productId: string,
): boolean {
  return (priorEvidence ?? []).some(
    (e) => e.kind === "INQUIRY" && e.locator.productId === productId,
  );
}

/** The inquiry this run was opened on, with the ref the runtime minted for it — or null. */
interface FocusedInquiry {
  readonly entity: ResolvedEntity;
  readonly ref: EvidenceRef;
}

/**
 * The resolved INQUIRY entity paired with its context ref.
 *
 * <b>Both or neither.</b> An INQUIRY entity without a ref would be one the planner named and no tool
 * resolved — impossible today (the planner mints no ids, V6) — and a ref without the entity would be a
 * second pass re-citing the first. Pairing them here is what keeps "the seller is standing on this
 * inquiry" a single fact with a single source.
 */
function focusedInquiry(input: SpecialistInput): FocusedInquiry | null {
  const entity = input.resolved.find((e) => e.kind === "INQUIRY");
  if (!entity) return null;
  const ref = (input.priorEvidence ?? []).find(
    (e) => e.kind === "INQUIRY" && e.locator.workItemId === entity.id
      && e.provenance === "inquiry-detail/context",
  );
  return ref ? { entity, ref } : null;
}

/** Closed backend vocabulary → seller words. Unknown values produce NO clause rather than a token. */
const ANSWER_STATUS_SENTENCE: Record<string, string> = {
  UNANSWERED: "아직 답변되지 않았습니다",
  ANSWERED: "채널에서 이미 답변됐습니다",
};
const WORK_PHASE_SENTENCE: Record<string, string> = {
  OPEN: "초안은 아직 없습니다",
  // PROPOSED says a proposal exists, not that a draft does: the product's own path moves an item to
  // PROPOSED before it asks the model, and the model may write nothing (NO_ANSWER_BASIS). Whether a
  // draft version exists is a separate scalar on the ref (`locator.draftVersion`); focusFindings
  // chooses the sentence, so this entry is the fallback wording only.
  PROPOSED: "답변을 준비하는 중입니다",
  APPROVED: "답변이 승인돼 전송을 기다립니다",
  ACTION_PENDING: "답변 전송이 진행 중입니다",
  EXECUTED: "답변이 전송됐습니다",
  COMPLETED: "답변이 전송됐습니다",
};

/**
 * What one contextual run says about its inquiry: channel, receipt date, work state, bound product.
 *
 * Every clause is a scalar from the ref's locator. The customer's title and body are not here and
 * cannot be — the locator has no field for them (`EvidenceLocator`).
 */
function focusFindings(focus: FocusedInquiry, needId: string): Finding[] {
  const loc = focus.ref.locator;
  const receivedOn = focus.ref.events?.from ?? null;
  const status = loc.status ? ANSWER_STATUS_SENTENCE[loc.status] : undefined;
  // 「AI 초안이 준비돼 있습니다」 is a claim about a saved draft version, and only the version proves it:
  // a PROPOSED item is one the product is preparing, with or without a draft yet.
  const phase = loc.phase === "PROPOSED"
    ? (loc.draftVersion != null ? "AI 초안이 준비돼 있습니다" : "답변을 준비하는 중이며 초안은 아직 없습니다")
    : loc.phase ? WORK_PHASE_SENTENCE[loc.phase] : undefined;
  const state = [status, phase].filter(Boolean).join(", ");
  const findings: Finding[] = [{
    findingId: `f-${focus.ref.evidenceId}`,
    specialist: "INQUIRY_OPS",
    statement: `이 문의는 ${focus.entity.label}로${receivedOn ? ` ${receivedOn}에` : ""} 접수됐고`
      + (state ? `, ${state}.` : "."),
    evidenceIds: [focus.ref.evidenceId],
    confidence: "NEEDS_REVIEW",
    verdict: null,
    surfaceLink: `/inquiries/${loc.inquiryId ?? loc.workItemId}`,
    needId,
  }];
  if (loc.productId && loc.productName) {
    findings.push({
      findingId: `f-${focus.ref.evidenceId}-product`,
      specialist: "INQUIRY_OPS",
      statement: `이 문의에 연결된 상품은 "${loc.productName}"입니다.`,
      evidenceIds: [focus.ref.evidenceId],
      confidence: "NEEDS_REVIEW",
      verdict: null,
      surfaceLink: `/products/${loc.productId}`,
      needId,
    });
  }
  return findings;
}
