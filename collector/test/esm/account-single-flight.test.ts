import { describe, expect, it } from "vitest";
import { AccountSingleFlight } from "../../src/esm/account-single-flight";

describe("account-single-flight — one active sync per account", () => {
  it("tryAcquire is exclusive per key; release frees it (and is idempotent)", () => {
    const gate = new AccountSingleFlight();
    const a = gate.tryAcquire("acct-1");
    expect(a).not.toBeNull();
    expect(gate.isHeld("acct-1")).toBe(true);

    // A second acquire for the same key is refused while held → caller skips/queues.
    expect(gate.tryAcquire("acct-1")).toBeNull();

    // A different account is independent.
    const b = gate.tryAcquire("acct-2");
    expect(b).not.toBeNull();

    a!.release();
    expect(gate.isHeld("acct-1")).toBe(false);
    a!.release(); // idempotent — does not throw, does not free acct-2
    expect(gate.isHeld("acct-2")).toBe(true);

    // Re-acquire works after release.
    expect(gate.tryAcquire("acct-1")).not.toBeNull();
  });

  it("runExclusive SKIPS an overlapping run for the same account (never double-runs)", async () => {
    const gate = new AccountSingleFlight();
    let running = 0;
    let maxConcurrent = 0;
    let release!: () => void;
    const gateInner = new Promise<void>((r) => (release = r));

    const body = async (): Promise<string> => {
      running += 1;
      maxConcurrent = Math.max(maxConcurrent, running);
      await gateInner; // hold the lock open until we release it
      running -= 1;
      return "done";
    };

    const first = gate.runExclusive("acct-1", body);
    // While the first is in flight, an overlapping tick for the same account skips.
    const overlap = await gate.runExclusive("acct-1", body);
    expect(overlap).toEqual({ ran: false });

    release();
    expect(await first).toEqual({ ran: true, value: "done" });
    expect(maxConcurrent).toBe(1); // the body never ran concurrently for one account
  });

  it("runExclusive runs different accounts concurrently", async () => {
    const gate = new AccountSingleFlight();
    const r1 = await gate.runExclusive("acct-1", async () => 1);
    const r2 = await gate.runExclusive("acct-2", async () => 2);
    expect(r1).toEqual({ ran: true, value: 1 });
    expect(r2).toEqual({ ran: true, value: 2 });
  });

  it("releases the lock even when the body throws", async () => {
    const gate = new AccountSingleFlight();
    await expect(
      gate.runExclusive("acct-1", async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    // Lock was released despite the throw → the account is free again.
    expect(gate.isHeld("acct-1")).toBe(false);
    expect(gate.tryAcquire("acct-1")).not.toBeNull();
  });
});
