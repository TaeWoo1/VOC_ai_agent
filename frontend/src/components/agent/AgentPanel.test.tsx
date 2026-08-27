// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { AgentPanelProvider, useAgentSurface } from "../../lib/agentPanel";
import { AgentPanelDock } from "./AgentPanel";
import { AgentLaunch } from "../ui/AgentLaunch";
import type { AgentRunView } from "../../lib/agentRuntime/types";

vi.mock("../../lib/agentRuntime/agentClient", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/agentRuntime/agentClient")>()),
  agentRuntime: {
    capabilities: vi.fn(async () => ({ service: "x", version: "1", env: "test", intents: [], runStore: { kind: "memory", durable: false, multiInstanceSafe: false }, externalSend: "disabled" })),
    startRun: vi.fn(),
    resumeRun: vi.fn(),
    getRun: vi.fn(),
  },
}));
import { agentRuntime } from "../../lib/agentRuntime/agentClient";

const ANSWER: AgentRunView = {
  threadId: "t1",
  domain: "OPERATOR",
  status: "DONE",
  trail: [],
  answer: {
    goalEcho: "g", plannerKind: "LLM", plannerVersion: "agent-plan/v1+openai:model-x", needs: [], specialists: [],
    findings: [{ findingId: "f1", specialist: "ProductOps", statement: "이 상품에 미답변 문의는 없습니다", evidenceIds: ["e1"], confidence: "SUPPORTED", verdict: null, surfaceLink: "/products/p-1" }],
    evidence: [{ evidenceId: "e1", kind: "COUNT", sourceTool: "t", sourceCall: "c", locator: { productId: "p-1", productName: "선바로 몰딩", label: "미답변 문의", count: 0 }, asOf: "2026-08-27", events: null, coverage: "COVERED", provenance: "x" }],
    coverage: [], knowledgeCoverage: [], nextActions: [], clarification: null,
    budget: { iterations: 1, toolCalls: 1, llmCalls: 1, elapsedMs: 10, exhausted: false, stopReason: "COMPLETE" },
  },
};

function ProductPage() {
  useAgentSurface({ surface: "product", productId: "p-1", label: "이 상품 · 선바로 몰딩", goal: "선바로 몰딩 상품을 분석해 줘" });
  return <AgentLaunch context={{ surface: "product", productId: "p-1", goal: "선바로 몰딩 상품을 분석해 줘" }} label="이 상품 분석하기" />;
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <MemoryRouter>
      <AgentPanelProvider>
        {children}
        <AgentPanelDock />
      </AgentPanelProvider>
    </MemoryRouter>
  );
}

beforeEach(() => {
  vi.mocked(agentRuntime.startRun).mockReset();
  window.localStorage.clear();
});

describe("contextual Agent panel", () => {
  it("is closed by default and opens from a launcher with the page's sentence in the box — not sent", async () => {
    render(<Shell><ProductPage /></Shell>);
    expect(screen.queryByTestId("agent-panel")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "이 상품 분석하기" }));
    const panel = await screen.findByTestId("agent-panel");
    expect(panel).toBeInTheDocument();
    expect(screen.getByTestId("agent-panel-context")).toHaveTextContent("이 상품 · 선바로 몰딩");
    expect(screen.getByLabelText("무엇을 확인해 드릴까요?")).toHaveValue("선바로 몰딩 상품을 분석해 줘");
    expect(agentRuntime.startRun).not.toHaveBeenCalled();
  });

  it("sends the product as a structured hint, never inside the sentence, and renders the answer as objects", async () => {
    vi.mocked(agentRuntime.startRun).mockResolvedValue(ANSWER);
    render(<Shell><ProductPage /></Shell>);
    await userEvent.click(screen.getByRole("button", { name: "이 상품 분석하기" }));
    await userEvent.click(await screen.findByRole("button", { name: "확인 요청" }));
    await waitFor(() => expect(agentRuntime.startRun).toHaveBeenCalledTimes(1));
    const request = vi.mocked(agentRuntime.startRun).mock.calls[0]![0];
    expect(request.productId).toBe("p-1");
    expect(request.goalText).toBe("선바로 몰딩 상품을 분석해 줘");
    expect(request.goalText).not.toContain("p-1");
    expect(await screen.findByText("이 상품에 미답변 문의는 없습니다")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "확인하기" })).toHaveAttribute("href", "/products/p-1");
    // The panel never prints a planner or model id.
    expect(screen.queryByText(/openai:model-x/)).toBeNull();
  });

  it("closes with the close control and with Escape", async () => {
    render(<Shell><ProductPage /></Shell>);
    await userEvent.click(screen.getByRole("button", { name: "이 상품 분석하기" }));
    await screen.findByTestId("agent-panel");
    await userEvent.click(screen.getByRole("button", { name: "AI 담당자 닫기" }));
    expect(screen.queryByTestId("agent-panel")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "이 상품 분석하기" }));
    await screen.findByTestId("agent-panel");
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByTestId("agent-panel")).toBeNull();
  });

  it("prints the approval boundary under a sentence that asks to send, and still starts no write", async () => {
    vi.mocked(agentRuntime.startRun).mockResolvedValue({ threadId: "t2", domain: "OPERATOR", status: "FAILED", trail: [], failureCode: "NO_PLAN", failureReason: "보낼 수 없습니다" });
    render(<Shell><ProductPage /></Shell>);
    await userEvent.click(screen.getByRole("button", { name: "이 상품 분석하기" }));
    const box = await screen.findByLabelText("무엇을 확인해 드릴까요?");
    await userEvent.clear(box);
    await userEvent.type(box, "답변 보내줘");
    expect(screen.getByTestId("agent-send-fence")).toHaveTextContent("보내는 일은 AI 담당자가 하지 않습니다");
    await userEvent.click(screen.getByRole("button", { name: "확인 요청" }));
    expect(await screen.findByText("이 요청은 계획을 세우지 못했습니다")).toBeInTheDocument();
    // Only the runtime's READ-only start; resume (the approval path) is never called from here.
    expect(agentRuntime.resumeRun).not.toHaveBeenCalled();
  });

  it("follows the page: the header reads the current surface when the route changes", async () => {
    function A() { useAgentSurface({ surface: "products", label: "상품 목록" }); return null; }
    function B() { useAgentSurface({ surface: "orders", label: "주문 · 최근 7일" }); return null; }
    function Pages({ which }: { which: "a" | "b" }) { return which === "a" ? <A /> : <B />; }
    const { rerender } = render(<Shell><Pages which="a" /><ProductPage /></Shell>);
    await userEvent.click(screen.getByRole("button", { name: "이 상품 분석하기" }));
    await screen.findByTestId("agent-panel");
    await act(async () => { rerender(<Shell><Pages which="b" /></Shell>); });
    expect(screen.getByTestId("agent-panel-context")).toHaveTextContent("주문 · 최근 7일");
  });
});

describe("home command box → panel", () => {
  it("hands an unrecognised sentence to the panel and runs it, because the seller already pressed send", async () => {
    const { CommandInput } = await import("../home/CommandInput");
    vi.mocked(agentRuntime.startRun).mockResolvedValue(ANSWER);
    render(<Shell><CommandInput unansweredCount={3} /></Shell>);
    await userEvent.type(screen.getByLabelText("무엇을 도와드릴까요?"), "최근 반복되는 문제가 있는 상품 있어?");
    await userEvent.click(screen.getByRole("button", { name: "물어보기" }));
    await screen.findByTestId("agent-panel");
    await waitFor(() => expect(agentRuntime.startRun).toHaveBeenCalledWith(expect.objectContaining({ goalText: "최근 반복되는 문제가 있는 상품 있어?" })));
    expect(await screen.findByText("이 상품에 미답변 문의는 없습니다")).toBeInTheDocument();
  });

  it("a recognised sentence stays an object on the home and opens no panel", async () => {
    const { CommandInput } = await import("../home/CommandInput");
    render(<Shell><CommandInput unansweredCount={3} /></Shell>);
    await userEvent.type(screen.getByLabelText("무엇을 도와드릴까요?"), "오늘 할 일 알려줘");
    await userEvent.click(screen.getByRole("button", { name: "물어보기" }));
    expect(await screen.findByTestId("command-result")).toBeInTheDocument();
    expect(screen.queryByTestId("agent-panel")).toBeNull();
    expect(agentRuntime.startRun).not.toHaveBeenCalled();
  });
});
