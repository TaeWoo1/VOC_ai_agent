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

/** Where the POLICY answer comes from — a store that does not exist, named honestly. Not a tool. */
const POLICY_STORE = "policy-store";

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

  for (const need of input.needs) {
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
      const product = input.resolved.find((e) => e.kind === "PRODUCT");
      if (!product) {
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
          { productId: product.id, limit: 5 },
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
          args: { productId: product.id },
          locator: {
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

    // POLICY — declared, and honestly unanswerable today.
    //
    // Nothing in this repository stores a seller or channel policy: not the exchange window, not the
    // return conditions, not the warranty. v2 lets the planner DECLARE that need — which is what makes
    // "교환 가능한가요?" a structurally different investigation from "폭이 몇 mm인가요?" — and then says
    // plainly that it cannot be met. Answering it from a review or a past reply would be inventing a
    // policy from anecdote, which is the exact failure invariant I3 forbids.
    const ref = evidence.add({
      kind: "PRODUCT_KNOWLEDGE_GAP",
      // <b>Not a tool name.</b> No tool produced this row and none could: the absence of a policy store
      // is the fact. It used to be stamped `get_inquiry_thread_context`, a tool nothing in the runtime
      // has ever invoked, which made a dead capability look like a read that had happened (A5).
      sourceTool: POLICY_STORE,
      args: { need: need.id },
      locator: { facet: "POLICY", label: "정책" },
      coverage: "COVERED",
      provenance: "policy-store/UNAVAILABLE",
    });
    refs.push(ref);
    findings.push({
      findingId: `f-${ref.evidenceId}`,
      specialist: "INQUIRY_OPS",
      statement: "교환·반품·보증 같은 판매 정책은 SellerOps가 아직 보관하고 있지 않아 확인할 수 없습니다.",
      evidenceIds: [ref.evidenceId],
      confidence: "NEEDS_REVIEW",
      verdict: null,
      surfaceLink: null,
      claimsCoverageLimit: true,
      needId: need.id,
    });
    needStates.push({
      id: need.id, status: "UNSATISFIABLE", evidenceIds: [ref.evidenceId],
      reason: "판매 정책이 저장돼 있지 않습니다.",
    });
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
  if (input.resolved.some((e) => e.kind === "PRODUCT")) {
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
