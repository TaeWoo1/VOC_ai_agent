// @vitest-environment jsdom
/**
 * Agent Interaction Model v2 §0 — org/session binding on the client.
 *
 * AUTH ORG A must never render ORG B's conversation, and an identity transition must leave nothing of
 * the previous identity behind: the remembered-conversation pointer is namespaced by org, the provider
 * resets its whole thread state when the signed-in org changes, and logout tears down every
 * session-scoped key (conversation pointers, the helper pairing token, connection-flow state).
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { MemoryRouter } from "react-router-dom";
import { AgentPanelProvider } from "../agentPanel";
import type { ConversationView } from "./types";

vi.mock("./conversationClient", () => ({
  conversationClient: {
    createConversation: vi.fn(async () => ({ conversationId: "c-new", createdAt: "x" })),
    getConversation: vi.fn(),
    listConversations: vi.fn(async () => []),
    sendTurn: vi.fn(),
  },
}));
const authState: { user: { orgId: string } | null } = { user: { orgId: "org-a" } };
vi.mock("../auth", () => ({ useOptionalAuth: () => authState }));
import { conversationClient } from "./conversationClient";
import { ConversationProvider, currentKeyFor, useConversation } from "./ConversationProvider";
import { clearSessionScopedState } from "../sessionScope";

function viewOf(id: string): ConversationView {
  return {
    conversationId: id, createdAt: "x", updatedAt: "x",
    turns: [{
      turnId: "t1", conversationId: id, role: "AGENT", message: `thread of ${id}`, artifacts: [],
      suggestedActions: [], continuation: { workingSet: null, pendingHumanAction: null, pendingPrepared: null },
      status: "DONE", createdAt: "x",
    }],
    workingSet: null, pendingHumanAction: null, pendingPrepared: null,
  };
}

function Probe() {
  const conversation = useConversation();
  return <p data-testid="probe">{conversation?.turns.map((t) => t.message).join("|") ?? ""}</p>;
}

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
  vi.mocked(conversationClient.getConversation).mockReset();
  authState.user = { orgId: "org-a" };
});

describe("org-scoped conversation pointer", () => {
  it("each org reads ONLY its own remembered conversation key", async () => {
    window.localStorage.setItem(currentKeyFor("org-a")!, "c-a");
    window.localStorage.setItem(currentKeyFor("org-b")!, "c-b");
    vi.mocked(conversationClient.getConversation).mockImplementation(async (id: string) => viewOf(id));
    render(
      <MemoryRouter><AgentPanelProvider><ConversationProvider><Probe /></ConversationProvider></AgentPanelProvider></MemoryRouter>,
    );
    await waitFor(() => expect(screen.getByTestId("probe")).toHaveTextContent("thread of c-a"));
    expect(conversationClient.getConversation).toHaveBeenCalledWith("c-a");
    expect(conversationClient.getConversation).not.toHaveBeenCalledWith("c-b");
  });

  it("when the signed-in org changes, the previous org's thread state is fully reset", async () => {
    window.localStorage.setItem(currentKeyFor("org-a")!, "c-a");
    vi.mocked(conversationClient.getConversation).mockImplementation(async (id: string) => viewOf(id));
    function Harness() {
      const [, force] = useState(0);
      return (
        <MemoryRouter>
          <AgentPanelProvider>
            <ConversationProvider>
              <Probe />
              <button type="button" onClick={() => { authState.user = { orgId: "org-b" }; force((v) => v + 1); }}>switch</button>
            </ConversationProvider>
          </AgentPanelProvider>
        </MemoryRouter>
      );
    }
    render(<Harness />);
    await waitFor(() => expect(screen.getByTestId("probe")).toHaveTextContent("thread of c-a"));
    await act(async () => screen.getByText("switch").click());
    await waitFor(() => expect(screen.getByTestId("probe")).toHaveTextContent(""));
    expect(conversationClient.getConversation).not.toHaveBeenCalledWith("c-b");
  });
});

describe("logout teardown", () => {
  it("clears every conversation pointer, the bridge pairing token and connection-flow state", () => {
    window.localStorage.setItem("reviewnary.conversation.current", "legacy");
    window.localStorage.setItem(currentKeyFor("org-a")!, "c-a");
    window.localStorage.setItem(currentKeyFor("org-b")!, "c-b");
    window.localStorage.setItem("sellerops_bridge_token", "pairing");
    window.localStorage.setItem("sellerops_token", "jwt-stays-for-clearToken");
    window.sessionStorage.setItem("cafe24_tutorial_v1", "{}");
    clearSessionScopedState();
    expect(window.localStorage.getItem("reviewnary.conversation.current")).toBeNull();
    expect(window.localStorage.getItem(currentKeyFor("org-a")!)).toBeNull();
    expect(window.localStorage.getItem(currentKeyFor("org-b")!)).toBeNull();
    expect(window.localStorage.getItem("sellerops_bridge_token")).toBeNull();
    expect(window.sessionStorage.getItem("cafe24_tutorial_v1")).toBeNull();
    // The JWT itself is `clearToken`'s job — this teardown never touches it.
    expect(window.localStorage.getItem("sellerops_token")).toBe("jwt-stays-for-clearToken");
  });
});
