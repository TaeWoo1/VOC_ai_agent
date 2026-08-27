/**
 * The inquiry the seller was standing on, carried into the run — Contextual Agent Contract Completion v1.
 *
 * <b>The launcher said 「이 문의 조사하기」 and the run investigated the queue.</b> `AgentContext` carried
 * `productId` and nothing for an inquiry, so a run opened from an inquiry's own screen had no way to
 * know which inquiry — it planned an org-wide look and answered about the inbox. Not a copy bug: a
 * contract bug, on the same seam `currentPageContext.test.ts` covers for products.
 *
 * <b>Same rule, one kind over.</b> The work-item id arrives as a structured hint and proves nothing.
 * One org-scoped `GET /api/inquiries/{workItemId}` — the read the screen itself makes — turns it into a
 * verified INQUIRY entity, a bound PRODUCT entity when the backend has one, and one evidence ref of
 * ids, closed states and a date. The customer's text is in that read and is dropped with it: no
 * finding, no evidence and no log line carries it, and this file asserts that with the fixture's own
 * phone-number token.
 */
import { describe, expect, it } from "vitest";
import { OperatorAgentRuntime } from "../../src/operator/operatorRuntime";
import { FakeOperatorSpringClient } from "../support/FakeOperatorSpringClient";
import { FakeSpringClient } from "../support/FakeSpringClient";
import type { SeedInquiry } from "../support/FakeSpringClient";
import { FakeIssueSpringClient } from "../support/FakeIssueSpringClient";
import { NEWER_WORK_ITEM, PHONE_TOKEN, twoInquiries } from "../support/fixtures";
import { fourIssues } from "../support/issueFixtures";
import {
  ANALYSES, CABLE, CUP_BIN, INBOX, KNOWLEDGE, MEMORY, MOLDING, REPEATS,
  coveredSignals, cupBinKnowledge, cupBinSignals, unlinkedSignals,
} from "../support/operatorFixtures";
import { RECORDED_PLANS, REPAIRED_PLANS } from "../support/recordedPlans";
import { clearLogSink, getLogSink } from "../../src/log";

const INQUIRY_GOAL = "이 문의를 조사해 줘";
const FOREIGN = "00000000-0000-0000-0000-000000000000";

function build(seeds: SeedInquiry[] = twoInquiries()) {
  const operator = new FakeOperatorSpringClient({
    inbox: INBOX,
    products: [MOLDING, CABLE, CUP_BIN],
    signals: {
      [MOLDING.id]: coveredSignals(),
      [CABLE.id]: unlinkedSignals(),
      [CUP_BIN.id]: cupBinSignals(),
    },
    knowledge: { ...KNOWLEDGE, [CUP_BIN.id]: cupBinKnowledge() },
    customerMemory: MEMORY,
    repeats: REPEATS,
    itemAnalyses: ANALYSES,
    plansByGoal: RECORDED_PLANS,
    repairedPlansByGoal: REPAIRED_PLANS,
  });
  const inquiry = new FakeSpringClient(seeds);
  return {
    operator,
    inquiry,
    runtime: new OperatorAgentRuntime({
      operator,
      inquiry,
      issue: new FakeIssueSpringClient(fourIssues()),
    }),
  };
}

function boundSeeds(): SeedInquiry[] {
  const [newer, older] = twoInquiries();
  return [
    { ...newer!, channelCode: "CAFE24", channelNameKo: "카페24",
      productId: MOLDING.id, productName: MOLDING.name, productBinding: "USER_CONFIRMED" },
    older!,
  ];
}

describe("the current inquiry reaches the run", () => {
  it("TC-CTX-INQ-01 — with the hint the run is about THIS inquiry: one verified read, no queue, memory anchored on it", async () => {
    const { operator, inquiry, runtime } = build(boundSeeds());
    const sink = getLogSink();
    try {
      const result = await runtime.run("t-inq", { text: INQUIRY_GOAL, workItemId: NEWER_WORK_ITEM });

      expect(result.status).toBe("DONE");
      if (result.status !== "DONE") return;
      // Verified by a READ, not by assignment.
      expect(inquiry.calls.detail).toBe(1);
      // A run about one inquiry does not read the org's inbox or its queue.
      expect(operator.calls.inbox).toBe(0);
      expect(inquiry.calls.list).toBe(0);
      // Past cases are looked up for THIS inquiry — the exact anchor, not the product's wider net.
      expect(operator.lastMemoryParams?.inquiryId).toBe("aaaa1111-0000-0000-0000-000000000001");
      // The bound product came out of the same read: nothing was resolved by name.
      expect(operator.calls.products).toBe(0);
      // The planner was TOLD the inquiry is fixed — in closed words, without the id, the channel or
      // the customer's title (live 2026-08-27 it asked 「어떤 문의인지」 when it was not told).
      const told = operator.lastPlanInput?.priorContext ?? "";
      expect(told).toContain("(INQUIRY)");
      expect(told).toContain("(PRODUCT)");
      expect(told).not.toContain(NEWER_WORK_ITEM);
      expect(told).not.toContain("카페24");
      expect(told).not.toContain(MOLDING.name);

      const focus = result.answer.evidence.find((e) => e.locator.workItemId === NEWER_WORK_ITEM);
      expect(focus?.locator.inquiryId).toBe("aaaa1111-0000-0000-0000-000000000001");
      expect(focus?.locator.channelCode).toBe("CAFE24");
      expect(focus?.locator.productId).toBe(MOLDING.id);
      expect(focus?.locator.status).toBe("UNANSWERED");
      expect(focus?.events?.from).toBe("2026-07-20");

      const sentences = result.answer.findings.map((f) => f.statement);
      expect(sentences.some((s) => s.startsWith("이 문의는 카페24 문의로 2026-07-20에 접수됐고"))).toBe(true);
      expect(sentences.some((s) => s.includes(`"${MOLDING.name}"`))).toBe(true);
      // The seller is sent back to the inquiry they were on, not to the queue.
      expect(result.answer.findings.some((f) => f.surfaceLink === "/inquiries/aaaa1111-0000-0000-0000-000000000001")).toBe(true);

      // The customer's text was in the read and nowhere after it.
      const everything = JSON.stringify(result) + JSON.stringify(sink);
      expect(everything).not.toContain(PHONE_TOKEN);
      expect(everything).not.toContain("사이즈 문의");
    } finally {
      clearLogSink();
    }
  });

  it("TC-CTX-INQ-02 — an id this org cannot read is dropped in silence and nothing leaks", async () => {
    const { operator, inquiry, runtime } = build(boundSeeds());

    const result = await runtime.run("t-foreign", { text: INQUIRY_GOAL, workItemId: FOREIGN });

    expect(inquiry.calls.detail).toBe(1);
    expect(result.status).toBe("DONE");
    if (result.status !== "DONE") return;
    // No INQUIRY entity, no product, no anchor: the history need is declared unservable rather than
    // served from another org's row — and the fake, like the endpoint, has no row to give.
    expect(operator.calls.memory).toBe(0);
    expect(result.answer.evidence.some((e) => e.locator.workItemId === FOREIGN)).toBe(false);
    expect(result.answer.evidence.some((e) => e.locator.workItemId === NEWER_WORK_ITEM)).toBe(false);
    expect(result.answer.needs.some((n) => n.status === "UNSATISFIABLE")).toBe(true);
  });

  it("an unbound inquiry resolves without inventing a product", async () => {
    const { operator, inquiry, runtime } = build();

    const result = await runtime.run("t-unbound", { text: INQUIRY_GOAL, workItemId: NEWER_WORK_ITEM });

    expect(inquiry.calls.detail).toBe(1);
    expect(result.status).toBe("DONE");
    if (result.status !== "DONE") return;
    const focus = result.answer.evidence.find((e) => e.locator.workItemId === NEWER_WORK_ITEM);
    expect(focus).toBeDefined();
    expect(focus?.locator.productId).toBeUndefined();
    expect(operator.calls.products).toBe(0);
    expect(result.answer.findings.some((f) => f.statement.includes("연결된 상품"))).toBe(false);
    // The channel label falls back to nothing named — never to a raw code the fixture did not carry.
    expect(result.answer.findings.some((f) => f.statement.startsWith("이 문의는 문의로"))).toBe(true);
  });

  it("TC-CTX-PROD-01 — the product hint still works exactly as before, and the two hints coexist", async () => {
    const { operator, inquiry, runtime } = build();

    const result = await runtime.run("t-both", {
      text: "전선몰딩 상품 요즘 문제 있어?", productId: MOLDING.id, workItemId: NEWER_WORK_ITEM,
    });

    expect(result.status).toBe("DONE");
    expect(operator.calls.products).toBe(0);
    expect(operator.calls.signals).toBeGreaterThan(0);
    expect(inquiry.calls.detail).toBe(1);
  });
});
