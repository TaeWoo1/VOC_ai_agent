/**
 * Agentic Experience + UI/UX v2 — the runtime half.
 *
 * §8 <b>The catalogue is a capability, not a refusal.</b> 「우리 상품 목록 보여줘」 had no need kind to
 *    live in, so it reached ProductOps as a product question that named no product and was answered
 *    with the resolver's honest refusal — 「어떤 상품을 묻는지 확인하지 못했습니다」. A missing capability
 *    wearing a refusal's words is the worst of both: the seller reads it as their own mistake.
 * §5 <b>A ranking answers WHICH ONE.</b> 「제일 급한 문의가 뭐야」 was answered with a count and a card
 *    the seller then had to read. The judgement, its reason and the object are one sentence now.
 * §2 <b>The answer and its limits are different fields.</b> Same sentences, said once, in their own place.
 *
 * Every assertion below counts reads and reads fields — never how a sentence was phrased by a model,
 * because none of these sentences is written by one.
 */
import { describe, it, expect } from "vitest";
import { TODAY, TOKEN, artifact, harness, say } from "./support";
import type { AgentPlanView } from "../../src/spring/types";
import { urgencySentence } from "../../src/operator/graph/inquiryWorkloadStep";
import { TOOL_CAPABILITIES } from "../../src/operator/tools/ToolReachability";
import { OPERATOR_TOOL } from "../../src/operator/tools/OperatorTools";

const V3 = "test-planner/v3";

/** What the planner emits for a catalogue question: one ORG need, one tool, no product mention. */
const CATALOG_PLAN: AgentPlanView = {
  available: true, supported: true, userGoal: "등록된 상품 목록을 보고 싶다", unresolvedEntities: [],
  informationNeeds: [
    { id: "n1", question: "이 판매자가 등록한 상품은 무엇인가", kind: "PRODUCT_CATALOG", why: "", required: true },
  ],
  specialists: ["PRODUCT_OPS"], tools: [OPERATOR_TOOL.LIST_PRODUCTS], retrievalOrder: ["n1"], retrievalParallel: [],
  retrievalStopWhen: null, evidenceRequirements: [], riskClass: "ROUTINE", maxIterations: 1, maxToolCalls: 4,
  stopWhenEnough: null, clarificationNeeded: false, clarificationReason: null, rationale: null,
  providerVersion: V3, requestedAction: "NONE", tone: null,
  filters: { period: null, rating: null, channel: null, scope: null, topic: null },
  target: { selector: "NONE", index: null },
};

describe("§8 — the seller's catalogue is answerable in chat", () => {
  it("a PRODUCT_CATALOG need reads the catalogue, draws the rows, and resolves no product", async () => {
    const h = harness({ plansByGoal: { "우리 상품 목록 보여줘": CATALOG_PLAN } });
    const id = (await h.service.create(TOKEN)).conversationId;
    const { turn } = await say(h, id, "우리 상품 목록 보여줘");

    const list = artifact(turn, "PRODUCT_LIST");
    expect(list.items.map((p) => p.productName)).toEqual(["전선몰딩 1호", "케이블타이 2호"]);
    expect(list.items.every((p) => p.to.startsWith("/products/"))).toBe(true);
    // The catalogue is the answer, said as a fact about the org — not 「어떤 상품을 묻는지…」.
    expect(turn.message).toContain("등록된 상품은 2개입니다.");
    expect(turn.message).not.toContain("어떤 상품을 묻는지");
    // Two rows is fewer than the ceiling, so this IS the catalogue and there is nowhere else to send them.
    expect(list.more).toBeUndefined();
    // The rows the seller is looking at become the set 「그중 첫 번째」 can point at.
    expect(turn.continuation.workingSet?.kind).toBe("PRODUCTS");
    expect(turn.continuation.workingSet?.count).toBe(2);
    // <b>Nothing was resolved.</b> The question named no product, so no resolve call may be spent
    // looking for one — the defect was exactly that a catalogue question went down the resolver path.
    expect(h.operator.productQueries).toEqual([""]);
  });

  it("the tool is declared READ, serves the catalogue need, and requires nothing but the org", () => {
    const row = TOOL_CAPABILITIES.find((r) => r.tool === OPERATOR_TOOL.LIST_PRODUCTS);
    expect(row?.specialist).toBe("PRODUCT_OPS");
    expect(row?.needKinds).toEqual(["PRODUCT_CATALOG"]);
    // The one product read that must not wait for a product; a question that named one is another need.
    expect(row?.requires).toEqual(["NONE"]);
  });
});

describe("§5 — a ranking names the object, its wait, and its criterion", () => {
  it("urgencySentence leads with the row that came first", () => {
    const said = urgencySentence("답변이 필요한 문의", 12, 3, { title: "현금영수증 발행 부탁드립니다", waitingDays: 40 });
    expect(said).toContain("먼저 보실 것은 「현금영수증 발행 부탁드립니다」입니다");
    expect(said).toContain("40일째 대기 중입니다");
    // The count did not go away — it moved behind the judgement, where it explains the order.
    expect(said).toContain("답변이 필요한 문의 12건 중 먼저 보실 3건입니다");
    expect(said).toContain("고객이 기다린 시간을 기준으로 정했습니다");
  });

  it("today's row is not called 「0일째 대기」, and a row with no title still gets the order sentence", () => {
    expect(urgencySentence("답변이 필요한 문의", 2, 1, { title: "오늘 온 문의", waitingDays: 0 }))
      .toContain("「오늘 온 문의」입니다 — 오늘 들어왔습니다.");
    const untitled = urgencySentence("답변이 필요한 문의", 2, 1, { title: null, waitingDays: 3 });
    expect(untitled).not.toContain("먼저 보실 것은 「");
    expect(untitled).toContain("고객이 기다린 시간을 기준으로 정했습니다");
    // An empty queue says so, and says nothing about an order it does not have.
    expect(urgencySentence("답변이 필요한 문의", 0, 0, null)).toBe("답변이 필요한 문의는 없습니다.");
  });
});

describe("§2 — the answer and its limits are separate fields", () => {
  it("the ranked turn answers in `message` and states its limit in `notes` — each exactly once", async () => {
    const h = harness();
    const id = (await h.service.create(TOKEN)).conversationId;
    const { turn } = await say(h, id, "미응답 문의 중 가장 시급한 건?");
    // The judgement names the row that came first — the seller no longer has to read the card to
    // learn WHICH inquiry the ranking picked.
    expect(turn.message).toContain("먼저 보실 것은 「배송 언제 오나요」입니다");
    expect(turn.message).toContain("고객이 기다린 시간을 기준으로 정했습니다");
    // The criterion's LIMIT is not part of the answer; it is what the answer could not see.
    expect(turn.message).not.toContain("답변 기한 정보는 아직 없어");
    expect((turn.notes ?? []).join(" ")).toContain("답변 기한 정보는 아직 없어");
    // …and a limit the answer already said is never printed under it a second time.
    for (const note of turn.notes ?? []) expect(turn.message).not.toContain(note);
  });
});

describe("§6 — a specialist that was asked nothing reports nothing", () => {
  it("neither ORDER_OPS nor REVIEW_OPS contributes a note when the plan gave it no need", async () => {
    const h = harness({ plansByGoal: { "우리 상품 목록 보여줘": CATALOG_PLAN } });
    const id = (await h.service.create(TOKEN)).conversationId;
    const { turn } = await say(h, id, "우리 상품 목록 보여줘");
    const everything = [turn.message, ...(turn.notes ?? [])].join(" ");
    // A sentence about OUR plan is not a fact about the seller's business.
    expect(everything).not.toContain("이번 조사 계획에 포함되지 않았습니다");
  });
});

/** The reference date every turn above is pinned to — stated so a failure names a date, not a drift. */
it("the harness answers as of the fixed reference date", () => {
  expect(TODAY).toMatch(/^\d{4}-\d{2}-\d{2}$/);
});
