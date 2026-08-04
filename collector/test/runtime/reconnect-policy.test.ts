import { describe, it, expect } from "vitest";
import { decideBindRetry, nextReconnectDelayMs } from "../../src/runtime/reconnect-policy";

describe("nextReconnectDelayMs — bounded exponential backoff", () => {
  it("doubles from the base and caps at max", () => {
    expect(nextReconnectDelayMs(0, { baseMs: 500, maxMs: 30_000 })).toBe(500);
    expect(nextReconnectDelayMs(1, { baseMs: 500, maxMs: 30_000 })).toBe(1000);
    expect(nextReconnectDelayMs(2, { baseMs: 500, maxMs: 30_000 })).toBe(2000);
    expect(nextReconnectDelayMs(6, { baseMs: 500, maxMs: 30_000 })).toBe(30_000); // 500*64=32000 -> capped
    expect(nextReconnectDelayMs(100, { baseMs: 500, maxMs: 30_000 })).toBe(30_000); // no overflow
  });

  it("is deterministic (no jitter)", () => {
    expect(nextReconnectDelayMs(3)).toBe(nextReconnectDelayMs(3));
  });
});

describe("decideBindRetry", () => {
  it("proceeds on a successful bind", () => {
    expect(decideBindRetry("ok", 0, 5)).toEqual({ action: "PROCEED" });
  });

  it("retries a transient failure with backoff", () => {
    const d = decideBindRetry("already_running", 0, 5, { baseMs: 500 });
    expect(d).toEqual({ action: "RETRY", delayMs: 1000, nextAttempt: 1 });
  });

  it("gives up once attempts are exhausted (never spins forever)", () => {
    expect(decideBindRetry("error", 4, 5)).toEqual({ action: "GIVE_UP" });
    expect(decideBindRetry("already_running", 9, 5)).toEqual({ action: "GIVE_UP" });
  });
});
