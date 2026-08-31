// @vitest-environment jsdom
/**
 * Agent Responsiveness v1 §4 — the seller's own sentence is drawn before anything is awaited.
 *
 * The turn itself is a model call and takes seconds; that is the measurement this package acted on.
 * What has no excuse is the wait BEFORE it: the user bubble used to be appended after `ensureId()`, so
 * on the first message of a conversation the words someone had just typed sat invisible for a round
 * trip, and `send` awaited a local-helper health probe (up to 1.5s on a paired browser) before even
 * that. Neither wait is about the sentence.
 *
 * These assertions hold the ordering, not a duration: with the conversation-create and the turn both
 * still unresolved, the bubble is already on screen.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { AgentPanelProvider } from "../agentPanel";
import type { TurnView } from "./types";

vi.mock("./conversationClient", () => ({
  conversationClient: {
    createConversation: vi.fn(),
    getConversation: vi.fn(),
    listConversations: vi.fn(async () => []),
    sendTurn: vi.fn(),
  },
}));
vi.mock("../auth", () => ({ useOptionalAuth: () => ({ user: { orgId: "org-a" } }) }));
/** A paired browser whose helper never answers — the slowest honest case for the probe. */
vi.mock("../bridge/localAgentHint", () => ({
  probeLocalAgent: vi.fn(() => new Promise(() => undefined)),
}));

import { conversationClient } from "./conversationClient";
import { ConversationProvider, useConversation } from "./ConversationProvider";

function Probe() {
  const conversation = useConversation();
  return (
    <div>
      <p data-testid="turns">{conversation?.turns.map((t) => `${t.role}:${t.text ?? t.message}`).join("|") ?? ""}</p>
      <button type="button" onClick={() => void conversation?.send("최근 문의 3개 보여줘")}>보내기</button>
    </div>
  );
}

function mount() {
  render(
    <MemoryRouter>
      <AgentPanelProvider>
        <ConversationProvider>
          <Probe />
        </ConversationProvider>
      </AgentPanelProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
  vi.clearAllMocks();
});

describe("the sentence is on screen before the network", () => {
  it("draws the user's turn while the conversation is still being created", async () => {
    // Never resolves: if the bubble waited on this, it would never appear.
    vi.mocked(conversationClient.createConversation).mockImplementation(() => new Promise(() => undefined));

    mount();
    await act(async () => {
      screen.getByRole("button", { name: "보내기" }).click();
    });

    await waitFor(() => expect(screen.getByTestId("turns")).toHaveTextContent("USER:최근 문의 3개 보여줘"));
    expect(conversationClient.sendTurn).not.toHaveBeenCalled();
  });

  it("still sends the helper hint — it is resolved beside the request, not in front of the sentence", async () => {
    vi.mocked(conversationClient.createConversation).mockResolvedValue({ conversationId: "c-1", createdAt: "x" } as never);
    let resolveProbe: (() => void) | null = null;
    const { probeLocalAgent } = await import("../bridge/localAgentHint");
    vi.mocked(probeLocalAgent).mockImplementation(
      () => new Promise((resolve) => { resolveProbe = () => resolve("ABSENT"); }),
    );
    const answered: TurnView = {
      turnId: "t1", conversationId: "c-1", role: "AGENT", message: "네", artifacts: [], suggestedActions: [],
      continuation: { workingSet: null, pendingHumanAction: null, pendingPrepared: null },
      status: "DONE", createdAt: "x",
    };
    vi.mocked(conversationClient.sendTurn).mockResolvedValue(answered as never);

    mount();
    await act(async () => {
      screen.getByRole("button", { name: "보내기" }).click();
    });

    // The bubble is up while the probe is still outstanding…
    await waitFor(() => expect(screen.getByTestId("turns")).toHaveTextContent("USER:최근 문의 3개 보여줘"));
    expect(conversationClient.sendTurn).not.toHaveBeenCalled();

    // …and the hint still reaches the runtime once it is known.
    await act(async () => {
      resolveProbe?.();
    });
    await waitFor(() => expect(conversationClient.sendTurn).toHaveBeenCalled());
    const [, request] = vi.mocked(conversationClient.sendTurn).mock.calls[0]!;
    expect((request as { localAgent?: string }).localAgent).toBe("ABSENT");
  });
});
