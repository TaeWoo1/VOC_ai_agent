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

async function ask(view: AgentRunView) {
  agentMock.startRun.mockResolvedValue(view);
  renderWithRouter(<Agent />);
  await screen.findByRole("heading", { level: 1 });
  await userEvent.type(screen.getByRole("textbox"), "오늘 뭐부터 봐야 해?");
  await userEvent.click(screen.getByRole("button", { name: /실행|보내기|요청/ }));
  // The card's own heading — "운영 판단" also appears as the run's domain label above it.
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
  it("shows a statement together with the evidence it rests on", async () => {
    await ask(run(answer()));

    expect(screen.getByText("답변이 필요한 문의가 3208건 있습니다.")).toBeInTheDocument();
    // The evidence line is what makes the number checkable rather than merely printed.
    expect(screen.getByText(/근거 e1 · 미답변 문의 3208건/)).toBeInTheDocument();
    expect(screen.getByText(/inbox\/SERVER:unansweredInquiries/)).toBeInTheDocument();
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
    expect(screen.getByText(/규격·스펙: SellerOps가 이 정보를 갖고 있지 않습니다/)).toBeInTheDocument();
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
 * The two lanes, on screen.
 *
 * <b>Invariant I2's user-visible half.</b> When free-text planning is unavailable the input must stop
 * inviting sentences that cannot be answered — and the Dashboard shortcuts must keep working, because
 * they never needed a plan. A screen that disabled both would be reporting a capability outage as a
 * product outage.
 */
describe("planner unavailable — the Agent lane stops, the Dashboard lane does not", () => {
  const FAILED: AgentRunView = {
    threadId: "t-fail",
    domain: "OPERATOR",
    status: "FAILED",
    trail: ["plan_unavailable"],
    failureCode: "PLANNER_CAPABILITY_OFF",
    failureReason:
      "AI 계획 기능이 꺼져 있어 지금은 대화형 요청을 처리할 수 없습니다. 홈·문의·리뷰·리포트 화면은 평소대로 사용할 수 있습니다.",
  };

  async function askAndFail() {
    agentMock.startRun.mockResolvedValue(FAILED);
    renderWithRouter(<Agent />);
    await screen.findByRole("heading", { level: 1 });
    await userEvent.type(screen.getByRole("textbox"), "오늘 뭐부터 봐야 해?");
    await userEvent.click(screen.getByRole("button", { name: /실행/ }));
    await waitFor(() => expect(screen.getByText("처리하지 못함")).toBeInTheDocument());
  }

  it("renders the reason instead of an empty answer", async () => {
    await askAndFail();
    expect(screen.getByText(/AI 계획 기능이 꺼져 있어/)).toBeInTheDocument();
    // The one thing it must not look like: a clean answer with nothing in it.
    expect(screen.queryByRole("heading", { level: 3, name: "운영 판단" })).toBeNull();
    expect(screen.queryByText("말씀드릴 만한 것을 찾지 못했습니다.")).toBeNull();
  });

  it("disables the free-text input rather than inviting another guaranteed failure", async () => {
    await askAndFail();
    expect(screen.getByRole("textbox")).toBeDisabled();
    // The disabled input explains itself in ONE place; the run's own reason lives on the run card.
    expect(screen.getByText(/지금은 문장으로 요청할 수 없습니다/)).toBeInTheDocument();
  });

  it("the Dashboard shortcuts remain enabled and send an intent, not a sentence", async () => {
    await askAndFail();
    const shortcut = screen.getByRole("button", { name: "미답변 문의 처리" });
    expect(shortcut).toBeEnabled();

    agentMock.startRun.mockClear();
    await userEvent.click(shortcut);
    await waitFor(() => expect(agentMock.startRun).toHaveBeenCalled());
    const sent = agentMock.startRun.mock.calls[0]![0] as Record<string, unknown>;
    // A chip that typed the words would go through the planner and fail like everything else.
    expect(sent.intent).toBe("HANDLE_UNANSWERED_INQUIRIES");
    expect(sent.goalText).toBeUndefined();
  });
});
