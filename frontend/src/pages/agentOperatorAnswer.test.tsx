// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";

const agentMock = vi.hoisted(() => ({
  capabilities: vi.fn(),
  startRun: vi.fn(),
  resumeRun: vi.fn(),
  getRun: vi.fn(),
}));
vi.mock("../lib/agentRuntime/agentClient", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/agentRuntime/agentClient")>()),
  agentRuntime: agentMock,
}));
vi.mock("../lib/auth", () => ({
  useAuth: () => ({
    user: { id: "u1", email: "d@e.f", name: "데모", role: "OWNER", orgId: "o1", orgName: "데모사" },
    ready: true,
  }),
}));

import { Agent } from "./Agent";
import { OperatorAnswerView } from "../components/agent/OperatorAnswerView";
import { renderWithRouter, screen, waitFor } from "../test/renderWithRouter";
import userEvent from "@testing-library/user-event";
import { api } from "../lib/apiClient";
import type { AgentRunView, CapabilitiesView, OperatorAnswer } from "../lib/agentRuntime/types";

const CAPS: CapabilitiesView = {
  service: "sellerops-agent-runtime",
  version: "test",
  env: "test",
  intents: [
    { intent: "OPERATOR_GOAL", domain: "OPERATOR", hasCheckpoint: false, requiresAccountScope: false, sampleGoals: [] },
  ],
  runStore: { kind: "memory", durable: false, multiInstanceSafe: false },
  externalSend: "disabled",
};

function answer(overrides: Partial<OperatorAnswer> = {}): OperatorAnswer {
  return {
    goalEcho: "오늘 뭐부터 봐야 해?",
    plannerKind: "LLM",
    plannerVersion: "agent-plan/v2+test",
    needs: [
      { id: "n1", question: "답변이 필요한 문의가 몇 건인가", status: "SATISFIED", required: true,
        evidenceIds: ["e1"] },
    ],
    specialists: ["INQUIRY_OPS"],
    findings: [
      {
        findingId: "f-e1",
        specialist: "INQUIRY_OPS",
        statement: "답변이 필요한 문의가 3208건 있습니다.",
        evidenceIds: ["e1"],
        confidence: "SUPPORTED",
        verdict: {
          hasEvidence: true, supportingEvidenceIds: ["e1"], unsafeAssertion: false, unsafeReason: null,
          needsMore: false, needsMoreTool: null, needsMoreReason: null,
          judgeKind: "RULE_BASED", judgeVersion: "operator-judge-rules/v1",
        },
        surfaceLink: "/inquiries?state=NEEDS_REPLY",
      },
    ],
    evidence: [
      {
        evidenceId: "e1",
        kind: "INBOX_COUNT",
        sourceTool: "get_today_inbox",
        sourceCall: "aabbccdd",
        locator: { count: 3208, label: "미답변 문의" },
        asOf: "2026-08-23",
        events: null,
        coverage: "COVERED",
        provenance: "inbox/SERVER:unansweredInquiries",
      },
    ],
    coverage: [],
    knowledgeCoverage: [],
    nextActions: [{ label: "문의 확인하기", actionClass: "READ", surfaceLink: "/inquiries?state=NEEDS_REPLY" }],
    clarification: null,
    budget: { iterations: 1, toolCalls: 2, llmCalls: 0, elapsedMs: 12, exhausted: false, stopReason: "COMPLETE" },
    ...overrides,
  };
}

function run(a: OperatorAnswer): AgentRunView {
  return { threadId: "t-1", domain: "OPERATOR", status: "DONE", trail: ["planned"], answer: a };
}

// Conversation Core v1: free language belongs to the home conversation; this page carries no
// free-text entry any more. The answer-rendering contract is the COMPONENT's, tested directly.
async function ask(view: AgentRunView) {
  renderWithRouter(<OperatorAnswerView answer={view.answer!} />);
  await waitFor(() =>
    expect(screen.getByRole("heading", { level: 3, name: "운영 판단" })).toBeInTheDocument(),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  agentMock.capabilities.mockResolvedValue(CAPS);
  vi.spyOn(api, "getSellerAccountsStrict").mockResolvedValue([]);
  vi.spyOn(api, "getChannelsStrict").mockResolvedValue([]);
});

describe("운영 판단 — the Operator answer", () => {
  it("§8 — an answer about products comes back as products, with somewhere to press", async () => {
    await ask(run(answer({
      findings: [{
        findingId: "f1", specialist: "PRODUCT_OPS",
        statement: "반복되는 문제가 있는 상품이 2개 있습니다.",
        evidenceIds: ["e1", "e2"], confidence: "SUPPORTED", verdict: null, surfaceLink: null,
      }],
      evidence: [
        { evidenceId: "e1", kind: "REVIEW_ISSUE", sourceTool: "t", sourceCall: "c",
          locator: { productId: "p1", productName: "전선몰딩", label: "반복되는 리뷰 문제", count: 3 },
          asOf: "2026-08-27", events: null, coverage: "COVERED", provenance: "p" },
        { evidenceId: "e2", kind: "REVIEW_ISSUE", sourceTool: "t", sourceCall: "c",
          locator: { productId: "p2", productName: "케이블타이", label: "반복되는 리뷰 문제", count: 1 },
          asOf: "2026-08-27", events: null, coverage: "COVERED", provenance: "p" },
      ],
    })));

    expect(screen.getByText("이 답변이 가리키는 상품 2개")).toBeInTheDocument();
    expect(screen.getByText("전선몰딩")).toBeInTheDocument();
    expect(screen.getByText("반복되는 리뷰 문제 3건")).toBeInTheDocument();
    const links = screen.getAllByRole("link", { name: "확인하기" });
    expect(links.map((l) => l.getAttribute("href"))).toEqual(["/products/p1", "/products/p2"]);
  });

  it("§8 — an org-wide answer offers no product object rather than an empty one", async () => {
    await ask(run(answer()));

    expect(screen.queryByText(/이 답변이 가리키는 상품/)).toBeNull();
  });

  it("shows a statement together with the evidence it rests on", async () => {
    await ask(run(answer()));

    expect(screen.getByText("답변이 필요한 문의가 3208건 있습니다.")).toBeInTheDocument();
    // The evidence line is what makes the number checkable rather than merely printed. What it may
    // NOT contain is the machine's own vocabulary (Core Daily Loop UX Integration v1 §4): the
    // internal evidence id and the provenance string 「inbox/SERVER:unansweredInquiries」 named a call,
    // not a thing the seller can go and look at.
    expect(screen.getByText(/미답변 문의 3208건/)).toBeInTheDocument();
    expect(screen.queryByText(/inbox\/SERVER:unansweredInquiries/)).toBeNull();
    expect(screen.queryByText(/근거 e1/)).toBeNull();
  });

  it("labels a NEEDS_REVIEW finding as something to check, and says why", async () => {
    await ask(run(answer({
      findings: [{
        ...answer().findings[0]!,
        confidence: "NEEDS_REVIEW",
        statement: "접착 문제가 늘고 있습니다.",
        verdict: {
          hasEvidence: true, supportingEvidenceIds: ["e1"], unsafeAssertion: true,
          unsafeReason: "근거 대비 과일반화", needsMore: false, needsMoreTool: null,
          needsMoreReason: null, judgeKind: "RULE_BASED", judgeVersion: "operator-judge-rules/v1",
        },
      }],
    })));

    expect(screen.getByText("확인 필요")).toBeInTheDocument();
    expect(screen.queryByText("확인됨")).toBeNull();
    expect(screen.getByText(/단정하지 않은 이유: 근거 대비 과일반화/)).toBeInTheDocument();
  });

  it("renders an explicit cannot-tell notice instead of letting an empty answer read as calm", async () => {
    await ask(run(answer({
      findings: [],
      coverage: [
        { signal: "REVIEW", coverage: "UNCERTAIN_PRODUCT_UNLINKED", linked: 0, unlinked: 980, provenance: "review-store/INGEST:canonical" },
      ],
      note: "케이블타이 2호에 기록된 반복 문제나 미답변 문의는 없습니다.",
    })));

    expect(screen.getByText("일부 데이터는 판단할 수 없습니다.")).toBeInTheDocument();
    expect(screen.getByText(/연결되지 않은 자료 980건/)).toBeInTheDocument();
    expect(screen.getByText(/비어 있는 것이 문제가 없다는 뜻은 아닙니다/)).toBeInTheDocument();
  });

  it("labels the interpretation as AI, and names the plan version", async () => {
    // There is one planner in Operator Graph v2, so there is one label — and the version is printed so
    // an answer can be traced to the model that planned it, the same reason a draft prints its provider.
    await ask(run(answer()));

    expect(screen.getByText(/AI 해석/)).toBeInTheDocument();
    expect(screen.getByText(/계획: agent-plan\/v2\+test/)).toBeInTheDocument();
    expect(screen.queryByText(/규칙 해석/)).toBeNull();
  });

  it("shows what the agent set out to check, including what it could not", async () => {
    await ask(run(answer({
      needs: [
        { id: "n1", question: "답변이 필요한 문의가 몇 건인가", status: "SATISFIED", required: true,
          evidenceIds: ["e1"] },
        { id: "n2", question: "교환 정책이 무엇인가", status: "UNSATISFIABLE", required: true,
          evidenceIds: [], reason: "판매 정책이 저장돼 있지 않습니다." },
      ],
    })));

    // A run that answered one of two questions must not read as a complete reply.
    expect(screen.getByText(/확인한 항목 1\/2/)).toBeInTheDocument();
    expect(screen.getByText(/교환 정책이 무엇인가 — 판매 정책이 저장돼 있지 않습니다./)).toBeInTheDocument();
  });

  it("says 'we do not hold this' for a missing product fact, never 'the product lacks it'", async () => {
    await ask(run(answer({
      knowledgeCoverage: [
        { facet: "SPEC", coverage: "UNAVAILABLE", known: 0, newestObservedAt: null, provenance: "" },
      ],
    })));

    expect(screen.getByText("아직 갖고 있지 않은 상품 정보가 있습니다.")).toBeInTheDocument();
    expect(screen.getByText(/규격·스펙: reviewnary가 이 정보를 갖고 있지 않습니다/)).toBeInTheDocument();
    expect(screen.getByText(/상품에 그 값이 없다는 뜻은 아닙니다/)).toBeInTheDocument();
  });

  it("renders a clarification as the answer, not as an empty result", async () => {
    await ask(run(answer({
      findings: [], needs: [], clarification: "어떤 상품을 말씀하시는지 알려주세요.",
      budget: { iterations: 1, toolCalls: 0, llmCalls: 1, elapsedMs: 5, exhausted: false,
        stopReason: "CLARIFICATION_NEEDED" },
    })));

    expect(screen.getByText("어떤 상품을 말씀하시는지 알려주세요.")).toBeInTheDocument();
    expect(screen.queryByText("말씀드릴 만한 것을 찾지 못했습니다.")).toBeNull();
  });

  it("prints the note when a run stopped early, so a partial answer never looks complete", async () => {
    await ask(run(answer({
      budget: { iterations: 3, toolCalls: 12, llmCalls: 6, elapsedMs: 900, exhausted: true, stopReason: "BUDGET_EXHAUSTED" },
      note: "조회 예산에 도달해 일부는 확인하지 못했습니다.",
    })));

    expect(screen.getByText("조회 예산에 도달해 일부는 확인하지 못했습니다.")).toBeInTheDocument();
  });

  it("every offered next action is a link to an authorized screen", async () => {
    await ask(run(answer()));

    const action = screen.getByRole("link", { name: "문의 확인하기" });
    expect(action).toHaveAttribute("href", "/inquiries?state=NEEDS_REPLY");
  });
});

/**
 * The button lane, on screen (invariant I2's user-visible half): a shortcut names its intent the way
 * a menu item does — it never types a sentence, so it keeps working when free-text planning is off.
 * (The free-text half of the old two-lane test left with the legacy lane — Conversation Core v1.)
 */
describe("the Dashboard shortcuts send an intent, not a sentence", () => {
  it("a shortcut press starts a run with the closed intent and no goalText", async () => {
    agentMock.startRun.mockResolvedValue({
      threadId: "t-int", domain: "INQUIRY", status: "DONE", trail: ["searched"],
    } as AgentRunView);
    renderWithRouter(<Agent />);
    const shortcut = await screen.findByRole("button", { name: "미답변 문의 처리" });
    expect(shortcut).toBeEnabled();

    await userEvent.click(shortcut);
    await waitFor(() => expect(agentMock.startRun).toHaveBeenCalled());
    const sent = agentMock.startRun.mock.calls[0]![0] as Record<string, unknown>;
    expect(sent.intent).toBe("HANDLE_UNANSWERED_INQUIRIES");
    expect(sent.goalText).toBeUndefined();
  });
});
