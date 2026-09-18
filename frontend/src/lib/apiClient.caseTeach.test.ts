import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * <b>Teaching a case is two model calls, and it must be given their budget</b> (Past Answer Prefill browser proof,
 * 2026-09-19). The server saves the seller's knowledge, re-investigates and re-drafts before it answers; measured at
 * ~17s. Under the ordinary 8s ceiling the screen reported a failure over a save and a GROUNDED draft that had both
 * happened. What is pinned is the budget, not a duration. The case's other writes call no model and stay ordinary.
 */
const post = vi.fn();
vi.mock("axios", () => ({
  default: {
    create: () => ({
      get: vi.fn(),
      post: (...a: unknown[]) => post(...a),
      interceptors: { request: { use: () => {} }, response: { use: () => {} } },
    }),
    isAxiosError: () => false,
  },
  isAxiosError: () => false,
}));

const { api } = await import("./apiClient");

const ORDINARY_CEILING_MS = 8_000;

describe("Case Teach — the call that re-investigates and re-drafts carries a model's budget", () => {
  beforeEach(() => {
    post.mockReset().mockResolvedValue({ data: {} });
  });

  it("teach runs with more than the ordinary ceiling", async () => {
    await api.teachOperationsCase("case-1", { content: "생활 방수가 됩니다.", scope: "PRODUCT" });
    const config = (post.mock.calls[0] as [string, unknown, { timeout?: number }])[2];
    expect(config?.timeout).toBeGreaterThan(ORDINARY_CEILING_MS);
  });

  it("rewriting the draft calls no model and stays an ordinary write", async () => {
    await api.editOperationsCaseDraft("case-1", { body: "고쳐 쓴 초안", remember: false, scope: "PRODUCT" });
    const config = (post.mock.calls[0] as [string, unknown, { timeout?: number } | undefined])[2];
    expect(config?.timeout).toBeUndefined();
  });
});
