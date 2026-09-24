// @vitest-environment jsdom
/**
 * **The dock's fade may fall on padding; it may never fall on content.**
 *
 * The composer dock hangs a short gradient over the strip of transcript directly above it, so the
 * thread slides under a deliberate edge instead of stopping at a hard line. That is only honest while
 * the scroller keeps enough bottom padding to end BELOW the gradient — with padding equal to the fade,
 * the last line of content comes to rest exactly inside it.
 *
 * Measured on the demo Home at 1440×900 (2026-09-25): the briefing ran 837px inside a 736px scroller,
 * and the final row — 「최근 7일 부정 리뷰 6건」, the only thing on that screen a seller can press —
 * sat at y=738 against a dock whose top edge is y=736. The fix is arithmetic between two numbers that
 * live in the same component, which is exactly what this pins: **bottom padding ≥ 2 × fade**.
 *
 * It does not assert that the briefing FITS. At 1366 and 1152 it cannot without redesigning what the
 * morning screen says, and a test that demanded it would be a test about content length.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { AgentPanelProvider } from "../../lib/agentPanel";
import { ConversationProvider } from "../../lib/conversation/ConversationProvider";
import { ConversationWorkspace } from "./ConversationWorkspace";

vi.mock("../../lib/bridge/localAgentHint", () => ({ probeLocalAgent: async () => "PAIRED" }));
vi.mock("../../lib/auth", () => ({ useOptionalAuth: () => ({ user: { orgId: "org-t" } }) }));
vi.mock("../../lib/conversation/conversationClient", () => ({
  conversationClient: {
    createConversation: vi.fn(async () => ({ conversationId: "c-new", createdAt: "2026-09-25T00:00:00Z" })),
    getConversation: vi.fn(),
    listConversations: vi.fn(async () => []),
    sendTurn: vi.fn(),
  },
}));

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <MemoryRouter>
      <AgentPanelProvider>
        <ConversationProvider>{children}</ConversationProvider>
      </AgentPanelProvider>
    </MemoryRouter>
  );
}

/** `pb-16` → 16, `py-8` → 8, absent → 0. Tailwind's scale, which is what these classes are. */
function bottomPadding(cls: string): number {
  const pb = /(?:^|\s)pb-(\d+)(?:\s|$)/.exec(cls);
  if (pb) return Number(pb[1]);
  const py = /(?:^|\s)py-(\d+)(?:\s|$)/.exec(cls);
  return py ? Number(py[1]) : 0;
}

/** The gradient's own height, read off the element that draws it. */
function fadeHeight(cls: string): number {
  const h = /(?:^|\s)h-(\d+)(?:\s|$)/.exec(cls);
  return h ? Number(h[1]) : 0;
}

describe("composer dock clearance", () => {
  it("the scroller's bottom padding clears the dock's fade twice over", () => {
    render(<Shell><ConversationWorkspace surface="home" chips={[]} lead={<p>브리핑</p>} /></Shell>);

    const workspace = screen.getByTestId("conversation-workspace");
    const scroller = workspace.querySelector(".overflow-y-auto");
    expect(scroller).not.toBeNull();

    const dock = screen.getByTestId("composer-dock");
    const fade = dock.querySelector('[aria-hidden="true"].pointer-events-none');
    expect(fade).not.toBeNull();

    const padding = bottomPadding((scroller as HTMLElement).className);
    const fadeH = fadeHeight((fade as HTMLElement).className);

    expect(fadeH).toBeGreaterThan(0);
    expect(padding).toBeGreaterThanOrEqual(fadeH * 2);
  });

  it("the dock is a sibling of the scroller, not something laid over it", () => {
    render(<Shell><ConversationWorkspace surface="home" chips={[]} lead={<p>브리핑</p>} /></Shell>);

    const workspace = screen.getByTestId("conversation-workspace");
    const dock = screen.getByTestId("composer-dock");
    const scroller = workspace.querySelector(".overflow-y-auto");
    // The dock's own box is in flow after the scroller — only its fade reaches upward, and the test
    // above is what keeps that reach off the content.
    expect(dock.parentElement).toBe(workspace);
    expect(dock.previousElementSibling).toBe(scroller);
    expect(dock.className).not.toMatch(/\b(absolute|fixed)\b/);
  });
});
