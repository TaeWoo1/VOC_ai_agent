// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { AgentPanelProvider } from "../../lib/agentPanel";
import { ConversationProvider, completedAfter, currentKeyFor } from "../../lib/conversation/ConversationProvider";
import { AgentRuntimeError } from "../../lib/agentRuntime/agentClient";
import { ConversationWorkspace } from "./ConversationWorkspace";
import { agentTurn } from "../../test/conversationFixtures";
import type { ConversationView, ProgressEvent } from "../../lib/conversation/types";

vi.mock("../../lib/bridge/localAgentHint", () => ({ probeLocalAgent: async () => "PAIRED" }));
// The provider namespaces its remembered-conversation pointer by the signed-in org (§0).
vi.mock("../../lib/auth", () => ({ useOptionalAuth: () => ({ user: { orgId: "org-t" } }) }));
const CURRENT_KEY = currentKeyFor("org-t")!;
vi.mock("../../lib/conversation/conversationClient", () => ({
  conversationClient: {
    createConversation: vi.fn(async () => ({ conversationId: "c-new", createdAt: "2026-08-27T00:00:00Z" })),
    getConversation: vi.fn(),
    listConversations: vi.fn(async () => []),
    sendTurn: vi.fn(),
  },
}));
import { conversationClient } from "../../lib/conversation/conversationClient";

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <MemoryRouter>
      <AgentPanelProvider>
        <ConversationProvider>{children}</ConversationProvider>
      </AgentPanelProvider>
    </MemoryRouter>
  );
}

const STORED: ConversationView = {
  conversationId: "c-stored",
  createdAt: "x",
  updatedAt: "x",
  turns: [
    { ...agentTurn({ turnId: "u-1", role: "USER", text: "지난 질문", message: "", artifacts: [], suggestedActions: [] }) },
    agentTurn({ turnId: "a-1", conversationId: "c-stored" }),
  ],
  workingSet: null,
  pendingHumanAction: null,
  pendingPrepared: null,
};

beforeEach(() => {
  vi.mocked(conversationClient.sendTurn).mockReset();
  vi.mocked(conversationClient.getConversation).mockReset();
  vi.mocked(conversationClient.createConversation).mockClear();
  window.localStorage.clear();
});

describe("conversation provider + workspace", () => {
  it("reloads the remembered conversation on mount", async () => {
    window.localStorage.setItem(CURRENT_KEY, "c-stored");
    vi.mocked(conversationClient.getConversation).mockResolvedValue(STORED);
    render(<Shell><ConversationWorkspace surface="home" chips={[]} /></Shell>);
    expect(await screen.findByText("지난 질문")).toBeInTheDocument();
    expect(screen.getByText("이 상품에 미답변 문의는 없습니다.")).toBeInTheDocument();
    expect(conversationClient.getConversation).toHaveBeenCalledWith("c-stored");
    expect(conversationClient.createConversation).not.toHaveBeenCalled();
  });

  it("a remembered conversation the runtime no longer has is a fresh start, and the first send creates one", async () => {
    window.localStorage.setItem(CURRENT_KEY, "c-gone");
    vi.mocked(conversationClient.getConversation).mockRejectedValue(new AgentRuntimeError(404, "NOT_FOUND"));
    vi.mocked(conversationClient.sendTurn).mockResolvedValue(agentTurn());
    render(<Shell><ConversationWorkspace surface="home" chips={[]} /></Shell>);
    await waitFor(() => expect(window.localStorage.getItem(CURRENT_KEY)).toBeNull());
    await userEvent.type(screen.getByLabelText("무엇이든 물어보세요"), "오늘 리뷰 뭐 들어왔어?");
    await userEvent.keyboard("{Enter}");
    await waitFor(() => expect(conversationClient.createConversation).toHaveBeenCalledTimes(1));
    expect(vi.mocked(conversationClient.sendTurn).mock.calls[0]![0]).toBe("c-new");
    // The pairing HINT rides as a request field — the runtime chooses the guided path honestly from it.
    expect(vi.mocked(conversationClient.sendTurn).mock.calls[0]![1].localAgent).toBe("PAIRED");
    expect(window.localStorage.getItem(CURRENT_KEY)).toBe("c-new");
  });

  it("sending appends the seller's turn, then the agent's — and shows only the stages received, in order", async () => {
    let finish!: () => void;
    vi.mocked(conversationClient.sendTurn).mockImplementation((_id, _req, onEvent: (e: ProgressEvent) => void) => {
      onEvent({ type: "stage", stage: "UNDERSTANDING", label: "요청을 이해했습니다", at: "1" });
      onEvent({ type: "stage", stage: "READING", label: "리뷰를 읽는 중", at: "2" });
      return new Promise((resolve) => {
        finish = () => resolve(agentTurn());
      });
    });
    render(<Shell><ConversationWorkspace surface="home" chips={[]} /></Shell>);
    await userEvent.type(screen.getByLabelText("무엇이든 물어보세요"), "오늘 리뷰 뭐 들어왔어?");
    await userEvent.click(screen.getByRole("button", { name: "보내기" }));
    expect(await screen.findByTestId("user-turn")).toHaveTextContent("오늘 리뷰 뭐 들어왔어?");
    const progress = await screen.findByTestId("conversation-progress");
    // Chat density: the latest stage is the line; the earlier ones are quiet checks above it.
    expect(progress).toHaveTextContent("리뷰를 읽는 중");
    const items = progress.querySelectorAll("li");
    expect(Array.from(items).map((li) => li.textContent)).toEqual(["✓요청을 이해했습니다"]);
    expect(progress).not.toHaveTextContent("계획");
    // Stop is real and sits where Send was.
    // The control swaps in place with a short crossfade, so it is awaited, never assumed.
    expect(await screen.findByRole("button", { name: "중지" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "보내기" })).toBeNull();
    await act(async () => finish());
    expect(await screen.findByText("이 상품에 미답변 문의는 없습니다.")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByTestId("conversation-progress")).toBeNull());
    // Evidence is folded, not first — a small 「근거 N」 affordance (Agent Interaction Model v2 §5).
    expect(screen.getByText("근거")).toBeInTheDocument();
  });

  it("Stop closes the stream: the turn ends as 「요청을 중지했습니다」, nothing is claimed, the box is free again", async () => {
    vi.mocked(conversationClient.sendTurn).mockImplementation((_id, _req, _onEvent, signal?: AbortSignal) =>
      new Promise((_resolve, reject) => {
        signal?.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
      }),
    );
    render(<Shell><ConversationWorkspace surface="home" chips={[]} /></Shell>);
    await userEvent.type(screen.getByLabelText("무엇이든 물어보세요"), "오늘 리뷰 뭐 들어왔어?");
    await userEvent.keyboard("{Enter}");
    await userEvent.click(await screen.findByRole("button", { name: "중지" }));
    expect(await screen.findByText("요청을 중지했습니다. 이미 시작된 확인은 되돌리지 않습니다.")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
    await waitFor(() => expect(screen.queryByTestId("conversation-progress")).toBeNull());
    expect(await screen.findByRole("button", { name: "보내기" })).toBeInTheDocument();
    const turnsShown = screen.getAllByTestId("agent-turn");
    expect(turnsShown[turnsShown.length - 1]).toHaveAttribute("data-status", "FAILED");
  });

  it("a suggested prompt is sent as the seller's next sentence", async () => {
    vi.mocked(conversationClient.sendTurn).mockResolvedValue(agentTurn());
    render(<Shell><ConversationWorkspace surface="home" chips={[]} /></Shell>);
    await userEvent.type(screen.getByLabelText("무엇이든 물어보세요"), "첫 질문");
    await userEvent.keyboard("{Enter}");
    await screen.findByText("이 상품에 미답변 문의는 없습니다.");
    await userEvent.click(screen.getByRole("button", { name: "문의에서도 같은 문제가 있는지 봐줘" }));
    await waitFor(() => expect(conversationClient.sendTurn).toHaveBeenCalledTimes(2));
    expect(vi.mocked(conversationClient.sendTurn).mock.calls[1]![1].text).toBe("문의에서도 같은 문제가 있는지 봐줘");
  });

  it("a pending human action resumes the turn when the seller's collection finishes", () => {
    expect(completedAfter([{ finishedAt: "2026-08-27T10:00:00Z", status: "SUCCESS" }], "2026-08-27T09:00:00Z")).toBe(true);
    expect(completedAfter([{ finishedAt: "2026-08-27T08:00:00Z", status: "SUCCESS" }], "2026-08-27T09:00:00Z")).toBe(false);
    expect(completedAfter([{ finishedAt: "2026-08-27T10:00:00Z", status: "FAILED" }], "2026-08-27T09:00:00Z")).toBe(false);
    expect(completedAfter([{ finishedAt: null, status: "RUNNING" }], "2026-08-27T09:00:00Z")).toBe(false);
  });
});
