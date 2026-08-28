// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { AgentPanelProvider, useAgentSurface } from "../../lib/agentPanel";
import { ConversationProvider } from "../../lib/conversation/ConversationProvider";
import { AgentPanelDock } from "./AgentPanel";
import { AgentLaunch } from "../ui/AgentLaunch";
import { ConversationWorkspace } from "../conversation/ConversationWorkspace";
import { agentTurn, CAPS } from "../../test/conversationFixtures";

vi.mock("../../lib/bridge/localAgentHint", () => ({ probeLocalAgent: async () => "PAIRED" }));
vi.mock("../../lib/agentRuntime/agentClient", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/agentRuntime/agentClient")>()),
  agentRuntime: { capabilities: vi.fn(async () => CAPS), startRun: vi.fn(), resumeRun: vi.fn(), getRun: vi.fn() },
}));
vi.mock("../../lib/conversation/conversationClient", () => ({
  conversationClient: {
    createConversation: vi.fn(async () => ({ conversationId: "c-1", createdAt: "2026-08-27T00:00:00Z" })),
    getConversation: vi.fn(),
    listConversations: vi.fn(async () => []),
    sendTurn: vi.fn(),
  },
}));
import { conversationClient } from "../../lib/conversation/conversationClient";

function ProductPage() {
  useAgentSurface({ surface: "product", productId: "p-1", label: "이 상품 · 선바로 몰딩" });
  return <AgentLaunch context={{ surface: "product", productId: "p-1" }} label="이 상품에 대해 물어보기" />;
}

function InquiryPage({ workItemId }: { workItemId?: string }) {
  const focused = workItemId != null;
  useAgentSurface({ surface: "inquiries", label: focused ? "이 문의" : "문의 목록", ...(focused ? { workItemId } : {}) });
  return <AgentLaunch context={{ surface: "inquiries", ...(focused ? { workItemId } : {}) }} label={focused ? "이 문의에 대해 물어보기" : "문의에 대해 물어보기"} />;
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <MemoryRouter initialEntries={["/products/p-1"]}>
      <AgentPanelProvider>
        <ConversationProvider>
          {children}
          <AgentPanelDock />
        </ConversationProvider>
      </AgentPanelProvider>
    </MemoryRouter>
  );
}

beforeEach(() => {
  vi.mocked(conversationClient.sendTurn).mockReset();
  vi.mocked(conversationClient.createConversation).mockClear();
  window.localStorage.clear();
});

describe("contextual Agent panel — the same conversation, beside the workspace", () => {
  it("is closed by default and opens from a launcher with an EMPTY box that names the object", async () => {
    render(<Shell><ProductPage /></Shell>);
    expect(screen.queryByTestId("agent-panel")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "이 상품에 대해 물어보기" }));
    await screen.findByTestId("agent-panel");
    expect(screen.getByTestId("agent-panel-context")).toHaveTextContent("이 상품 · 선바로 몰딩");
    const box = screen.getByLabelText("무엇이든 물어보세요");
    expect(box).toHaveValue("");
    expect(box).toHaveAttribute("placeholder", "이 상품 · 선바로 몰딩에 대해 무엇이든 물어보세요");
    expect(conversationClient.sendTurn).not.toHaveBeenCalled();
    expect(conversationClient.createConversation).not.toHaveBeenCalled();
  });

  it("sends the product as a structured hint, never inside the sentence, and renders the answer as objects", async () => {
    vi.mocked(conversationClient.sendTurn).mockResolvedValue(agentTurn());
    render(<Shell><ProductPage /></Shell>);
    await userEvent.click(screen.getByRole("button", { name: "이 상품에 대해 물어보기" }));
    await userEvent.type(await screen.findByLabelText("무엇이든 물어보세요"), "이 상품 어때?");
    await userEvent.click(screen.getByRole("button", { name: "보내기" }));
    await waitFor(() => expect(conversationClient.sendTurn).toHaveBeenCalledTimes(1));
    const [id, request] = vi.mocked(conversationClient.sendTurn).mock.calls[0]!;
    expect(id).toBe("c-1");
    expect(request.productId).toBe("p-1");
    expect(request.text).toBe("이 상품 어때?");
    expect(request.text).not.toContain("p-1");
    expect(await screen.findByText("이 상품에 미답변 문의는 없습니다.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /선바로 몰딩/ })).toHaveAttribute("href", "/products/p-1");
  });

  it("sends the inquiry work item as a structured hint", async () => {
    vi.mocked(conversationClient.sendTurn).mockResolvedValue(agentTurn());
    render(<Shell><InquiryPage workItemId="w-1" /></Shell>);
    await userEvent.click(screen.getByRole("button", { name: "이 문의에 대해 물어보기" }));
    expect(screen.getByTestId("agent-panel-context")).toHaveTextContent("이 문의");
    await userEvent.type(await screen.findByLabelText("무엇이든 물어보세요"), "이 문의 정리해줘");
    await userEvent.click(screen.getByRole("button", { name: "보내기" }));
    await waitFor(() => expect(conversationClient.sendTurn).toHaveBeenCalledTimes(1));
    const request = vi.mocked(conversationClient.sendTurn).mock.calls[0]![1];
    expect(request.workItemId).toBe("w-1");
    expect(request.productId).toBeUndefined();
  });

  it("without a work item the launcher does not promise 「이 문의」", async () => {
    render(<Shell><InquiryPage /></Shell>);
    expect(screen.queryByRole("button", { name: "이 문의에 대해 물어보기" })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "문의에 대해 물어보기" }));
    expect(screen.getByTestId("agent-panel-context")).toHaveTextContent("문의 목록");
  });

  it("closes with the close control and with Escape", async () => {
    render(<Shell><ProductPage /></Shell>);
    await userEvent.click(screen.getByRole("button", { name: "이 상품에 대해 물어보기" }));
    await screen.findByTestId("agent-panel");
    await userEvent.click(screen.getByRole("button", { name: "AI 담당자 닫기" }));
    expect(screen.queryByTestId("agent-panel")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "이 상품에 대해 물어보기" }));
    await screen.findByTestId("agent-panel");
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByTestId("agent-panel")).toBeNull();
  });

  it("prints the approval boundary under a sentence that asks to send; a failed plan is a real state", async () => {
    vi.mocked(conversationClient.sendTurn).mockResolvedValue(agentTurn({ status: "FAILED", failureCode: "NO_PLAN", failureReason: "보낼 수 없습니다", artifacts: [], suggestedActions: [] }));
    render(<Shell><ProductPage /></Shell>);
    await userEvent.click(screen.getByRole("button", { name: "이 상품에 대해 물어보기" }));
    await userEvent.type(await screen.findByLabelText("무엇이든 물어보세요"), "답변 보내줘");
    expect(screen.getByTestId("agent-send-fence")).toHaveTextContent("보내는 일은 AI 담당자가 하지 않습니다");
    await userEvent.click(screen.getByRole("button", { name: "보내기" }));
    expect(await screen.findByText("이 요청은 계획을 세우지 못했습니다")).toBeInTheDocument();
    expect(screen.getByText("보낼 수 없습니다")).toBeInTheDocument();
  });

  it("follows the page: the header reads the current surface when the route changes", async () => {
    function A() { useAgentSurface({ surface: "products", label: "상품 목록" }); return null; }
    function B() { useAgentSurface({ surface: "orders", label: "주문 · 최근 7일" }); return null; }
    function Pages({ which }: { which: "a" | "b" }) { return which === "a" ? <A /> : <B />; }
    const { rerender } = render(<Shell><Pages which="a" /><ProductPage /></Shell>);
    await userEvent.click(screen.getByRole("button", { name: "이 상품에 대해 물어보기" }));
    await screen.findByTestId("agent-panel");
    await act(async () => { rerender(<Shell><Pages which="b" /></Shell>); });
    expect(screen.getByTestId("agent-panel-context")).toHaveTextContent("주문 · 최근 7일");
  });

  it("is ONE conversation: a sentence sent from the home workspace appears in the panel", async () => {
    vi.mocked(conversationClient.sendTurn).mockResolvedValue(agentTurn());
    render(
      <Shell>
        <section aria-label="홈"><ConversationWorkspace surface="home" chips={[]} /></section>
        <ProductPage />
      </Shell>,
    );
    const boxes = screen.getAllByLabelText("무엇이든 물어보세요");
    await userEvent.type(boxes[0]!, "요즘 문제 생기는 상품 있어?");
    await userEvent.click(screen.getAllByRole("button", { name: "보내기" })[0]!);
    await screen.findByText("이 상품에 미답변 문의는 없습니다.");
    await userEvent.click(screen.getByRole("button", { name: "이 상품에 대해 물어보기" }));
    const panel = await screen.findByTestId("agent-panel");
    expect(panel).toHaveTextContent("요즘 문제 생기는 상품 있어?");
    expect(panel).toHaveTextContent("이 상품에 미답변 문의는 없습니다.");
    expect(conversationClient.createConversation).toHaveBeenCalledTimes(1);
  });
});
