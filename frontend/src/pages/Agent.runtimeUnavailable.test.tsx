// @vitest-environment jsdom
//
// Disconnected Channel Onboarding Live Walkthrough v1 §11/§19-F.
//
// The runtime is a separate process. When it is not answering, this screen knew it at mount and used
// to throw the fact away: the box stayed enabled, the seller typed, pressed, waited, and read a
// failure. And the failure has to say the thing a seller cannot work out for themselves — that their
// CHANNEL is fine.
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
  useAuth: () => ({ user: { id: "u1", email: "d@e.f", name: "데모", role: "OWNER", orgId: "o1", orgName: "데모사" }, ready: true }),
}));

import { Agent } from "./Agent";
import { renderWithRouter, screen, waitFor } from "../test/renderWithRouter";
import { api } from "../lib/apiClient";

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(api, "getSellerAccountsStrict").mockResolvedValue([]);
  vi.spyOn(api, "getChannelsStrict").mockResolvedValue([]);
  vi.spyOn(api, "getProactiveCases").mockResolvedValue({ items: [], total: 0 } as never);
});

describe("Agent — the runtime did not answer (§11)", () => {
  it("says so before the seller types, and disables the box rather than letting it look ready", async () => {
    agentMock.capabilities.mockRejectedValue(new Error("connect ECONNREFUSED"));
    renderWithRouter(<Agent />);

    await waitFor(() => expect(screen.getByText("AI 도우미를 시작하지 못했습니다.")).toBeInTheDocument());
    expect(screen.getByLabelText("확인할 내용")).toBeDisabled();
    expect(screen.getByRole("button", { name: "물어보기" })).toBeDisabled();
    // Not a run failure banner: nothing was requested, so nothing was refused.
    expect(screen.queryByText("요청을 처리하지 못했습니다.")).toBeNull();
    // And no run was started to discover what the page already knew.
    expect(agentMock.startRun).not.toHaveBeenCalled();
  });

  it("separates a dead runtime from a broken channel, and points at what still works", async () => {
    agentMock.capabilities.mockRejectedValue(new Error("connect ECONNREFUSED"));
    renderWithRouter(<Agent />);

    // Never a claim about the seller's channels: on an org with nothing connected, 「채널 연결에는
    // 문제가 없습니다」 would be false.
    expect(screen.queryByText(/채널 연결에는 문제가 없습니다/)).toBeNull();
    const notice = await screen.findByText(/채널 연결과는 관계없는 문제입니다/);
    expect(notice).toHaveTextContent("문의·리뷰·주문 화면은 그대로 사용할 수 있고");
    expect(notice).toHaveTextContent("무엇을 도와드릴까요?");
    expect(screen.getByRole("link", { name: "홈으로 가기" })).toHaveAttribute("href", "/");
  });

  it("puts the reason above the control it disables, not under it", async () => {
    agentMock.capabilities.mockRejectedValue(new Error("connect ECONNREFUSED"));
    renderWithRouter(<Agent />);

    const notice = await screen.findByText("AI 도우미를 시작하지 못했습니다.");
    const box = screen.getByLabelText("확인할 내용");
    // Node.DOCUMENT_POSITION_FOLLOWING — the box comes after the notice in document order.
    expect(notice.compareDocumentPosition(box) & 4).toBeTruthy();
  });

  it("stays out of the way when the runtime is healthy", async () => {
    agentMock.capabilities.mockResolvedValue({
      service: "sellerops-agent-runtime",
      version: "test",
      env: "test",
      intents: [],
      runStore: { kind: "file", durable: true, multiInstanceSafe: false },
      externalSend: "disabled",
    } as never);
    renderWithRouter(<Agent />);

    await waitFor(() => expect(screen.getByLabelText("확인할 내용")).not.toBeDisabled());
    expect(screen.queryByText("AI 도우미를 시작하지 못했습니다.")).toBeNull();
  });
});
