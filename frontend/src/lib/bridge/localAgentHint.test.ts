// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { probeLocalAgent, resetLocalAgentHintForTests } from "./localAgentHint";
import { BRIDGE_TOKEN_KEY } from "./bridgeClient";

const realFetch = globalThis.fetch;

beforeEach(() => {
  resetLocalAgentHintForTests();
  window.localStorage.clear();
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

describe("local agent hint — a health probe, never a pairing", () => {
  it("PAIRED only when the agent answers AND a pairing token is held", async () => {
    globalThis.fetch = vi.fn(async () => ({ ok: true })) as unknown as typeof fetch;
    window.localStorage.setItem(BRIDGE_TOKEN_KEY, "t");
    expect(await probeLocalAgent(2_000)).toBe("PAIRED");
    const calls = (globalThis.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls;
    expect(String(calls[0]![0])).toMatch(/\/bridge\/health$/);
    expect(calls.every((c) => c[1] == null || !("method" in (c[1] as object)) )).toBe(true);
  });

  it("without a pairing token nothing is probed — ABSENT, and no refused connection reaches the console", async () => {
    globalThis.fetch = vi.fn(async () => ({ ok: true })) as unknown as typeof fetch;
    expect(await probeLocalAgent(1_000)).toBe("ABSENT");
    expect((globalThis.fetch as unknown as { mock: { calls: unknown[] } }).mock.calls).toHaveLength(0);
  });

  it("an unreachable agent is ABSENT; a probe that does not answer in time is UNKNOWN; answers are cached", async () => {
    window.localStorage.setItem(BRIDGE_TOKEN_KEY, "t");
    globalThis.fetch = vi.fn(async () => { throw new TypeError("refused"); }) as unknown as typeof fetch;
    expect(await probeLocalAgent(1_000)).toBe("ABSENT");
    expect(await probeLocalAgent(2_000)).toBe("ABSENT");
    expect((globalThis.fetch as unknown as { mock: { calls: unknown[] } }).mock.calls).toHaveLength(1);
    resetLocalAgentHintForTests();
    globalThis.fetch = vi.fn(async () => { const e = new Error("aborted"); e.name = "AbortError"; throw e; }) as unknown as typeof fetch;
    expect(await probeLocalAgent(5_000)).toBe("UNKNOWN");
  });
});
