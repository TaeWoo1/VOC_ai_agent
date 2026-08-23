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
import type { CustomerMemorySearch, InboxSummary, RepeatedInquiry } from "../../spring/types";
import { attemptTool, skippedTool, terminalOf } from "../failure/SpecialistOutcome";
import { eventOn, eventRange } from "../scope/EvidenceTime";
import { REPEAT_WINDOW_DAYS } from "../defaults/OperationalDefaults";
import type { ToolFailure } from "../failure/SpecialistOutcome";
import { log } from "../../log";

/** Where the POLICY answer comes from — a store that does not exist, named honestly. Not a tool. */
const POLICY_STORE = "policy-store";

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

  for (const need of input.needs) {
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
        needStates.push({ id: need.id, status: "SATISFIED", evidenceIds: [ref.evidenceId] });
      } else {
        notes.push("답변이 필요한 문의는 없습니다.");
        needStates.push({ id: need.id, status: "SATISFIED", evidenceIds: [ref.evidenceId] });
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

/** Whether the run already holds THIS product's own unanswered-inquiry count. */
function hasProductInquiryCount(
  priorEvidence: readonly EvidenceRef[] | undefined, productId: string,
): boolean {
  return (priorEvidence ?? []).some(
    (e) => e.kind === "INQUIRY" && e.locator.productId === productId,
  );
}
