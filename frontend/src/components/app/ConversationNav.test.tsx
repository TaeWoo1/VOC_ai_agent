// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { ConversationProvider } from "../../lib/conversation/ConversationProvider";
import { AgentPanelProvider } from "../../lib/agentPanel";
import { ConversationNav } from "./ConversationNav";
import { agentTurn } from "../../test/conversationFixtures";

vi.mock("../../lib/conversation/conversationClient", () => ({
  conversationClient: {
    createConversation: vi.fn(async () => ({ conversationId: "c-new", createdAt: "x" })),
    getConversation: vi.fn(),
    listConversations: vi.fn(async () => [
      { conversationId: "c-1", headline: "지난 리뷰 확인", turnCount: 4, updatedAt: new Date().toISOString(), createdAt: "x" },
      { conversationId: "c-2", headline: null, turnCount: 1, updatedAt: new Date().toISOString(), createdAt: "x" },
    ]),
    sendTurn: vi.fn(),
  },
}));
import { conversationClient } from "../../lib/conversation/conversationClient";

function Where() {
  return <p data-testid="where">{useLocation().pathname}</p>;
}
function shell(path = "/reviews") {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AgentPanelProvider>
        <ConversationProvider>
          <ConversationNav />
          <Routes><Route path="*" element={<Where />} /></Routes>
        </ConversationProvider>
      </AgentPanelProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  window.localStorage.clear();
  vi.mocked(conversationClient.getConversation).mockReset();
});

describe("sidebar conversation list (Chat UI v1)", () => {
  it("lists the threads with the current one marked, and 「새 대화」 is an icon control that goes home", async () => {
    window.localStorage.setItem("reviewnary.conversation.current", "c-1");
    vi.mocked(conversationClient.getConversation).mockResolvedValue({ conversationId: "c-1", createdAt: "x", updatedAt: "x", turns: [agentTurn({ conversationId: "c-1" })], workingSet: null, pendingHumanAction: null, pendingPrepared: null });
    shell();
    const current = await screen.findByRole("button", { name: /지난 리뷰 확인/ });
    await waitFor(() => expect(current).toHaveAttribute("aria-current", "true"));
    expect(screen.getByRole("button", { name: /제목 없는 대화/ })).not.toHaveAttribute("aria-current");
    await userEvent.click(screen.getByRole("button", { name: "새 대화" }));
    expect(screen.getByTestId("where")).toHaveTextContent("/");
    expect(window.localStorage.getItem("reviewnary.conversation.current")).toBeNull();
  });

  it("opens an earlier thread from the sidebar and lands on the home", async () => {
    vi.mocked(conversationClient.getConversation).mockResolvedValue({ conversationId: "c-1", createdAt: "x", updatedAt: "x", turns: [agentTurn({ conversationId: "c-1", message: "지난 답변입니다." })], workingSet: null, pendingHumanAction: null, pendingPrepared: null });
    shell();
    await userEvent.click(await screen.findByRole("button", { name: /지난 리뷰 확인/ }));
    await waitFor(() => expect(window.localStorage.getItem("reviewnary.conversation.current")).toBe("c-1"));
    expect(screen.getByTestId("where")).toHaveTextContent("/");
  });

  it("collapses and expands", async () => {
    shell();
    await screen.findByRole("list", { name: "지난 대화" });
    await userEvent.click(screen.getByRole("button", { name: "대화", expanded: true }));
    expect(screen.queryByRole("list", { name: "지난 대화" })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "대화", expanded: false }));
    expect(await screen.findByRole("list", { name: "지난 대화" })).toBeInTheDocument();
  });
});
