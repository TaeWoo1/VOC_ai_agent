import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * <b>A report call is a model call, and it must be given a model's budget</b> (pilot QA 2026-09-06).
 *
 * A period's FIRST open builds the edition, and building it narrates. Measured on the demo org: the
 * backend logged `narrated=true … ms=15533` in the same second the screen said
 * 「리포트를 불러오지 못했습니다」 — the report had been written, and the default 8s ceiling had already
 * given up on it. It self-heals on reload off the snapshot, which is why nobody caught it: every
 * seller meets it exactly once, on the open that introduces the feature.
 *
 * What is pinned is the BUDGET, not a duration: these two calls must not run under the ordinary
 * ceiling. The read of the snapshot list and one stored edition are ordinary reads and stay so.
 */
const get = vi.fn();
const post = vi.fn();
vi.mock("axios", () => ({
  default: {
    create: () => ({
      get: (...a: unknown[]) => get(...a),
      post: (...a: unknown[]) => post(...a),
      interceptors: { request: { use: () => {} }, response: { use: () => {} } },
    }),
    isAxiosError: () => false,
  },
  isAxiosError: () => false,
}));

const { api } = await import("./apiClient");

const ORDINARY_CEILING_MS = 8_000;

describe("운영 리포트 — the calls that narrate carry a model's budget", () => {
  beforeEach(() => {
    get.mockReset().mockResolvedValue({ data: {} });
    post.mockReset().mockResolvedValue({ data: {} });
  });

  it("the current report is fetched with more than the ordinary ceiling", async () => {
    await api.getCurrentAgentReport("WEEKLY");
    const [, config] = get.mock.calls[0] as [string, { timeout?: number }];
    expect(config?.timeout).toBeGreaterThan(ORDINARY_CEILING_MS);
  });

  it("regenerate — which always narrates — carries it too", async () => {
    await api.regenerateAgentReport("WEEKLY");
    const config = (post.mock.calls[0] as [string, unknown, { timeout?: number }])[2];
    expect(config?.timeout).toBeGreaterThan(ORDINARY_CEILING_MS);
  });

  it("reading a stored edition stays an ordinary read", async () => {
    await api.getAgentReport("rep-1");
    const [, config] = get.mock.calls[0] as [string, { timeout?: number } | undefined];
    expect(config?.timeout).toBeUndefined();
  });
});
