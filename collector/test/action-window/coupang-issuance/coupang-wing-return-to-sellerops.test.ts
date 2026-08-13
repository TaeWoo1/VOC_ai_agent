/**
 * **The walk's last button, and whether it does what it says.**
 *
 * Live-observed 2026-08-12: the seller pressed `SellerOps로 돌아가기`, their screen stayed on WING, and they
 * said so — "sellerops로 돌아가기 버튼을 눌러도 딱히 액션은 없네?". The button recorded a step completion while
 * its label promised a move, and the SellerOps tab was in a different window the walk cannot reach.
 *
 * The return is INJECTED, because this driver's source guard forbids `.goto(` and `window.open` outright and
 * should keep forbidding them. What is asserted here is the wiring: it fires on that press, on that step, once,
 * and never on any other step — and a walk with no capability wired still completes rather than stalling.
 */
import { describe, expect, it } from "vitest";
import { CoupangWingIssuanceDriver } from "../../../src/action-window/coupang-wing-issuance-driver";
import type { CoupangIssuanceTarget } from "../../../src/action-window/coupang-issuance/coupang-issuance-driver";

/**
 * A read-only fake page that can tell the driver's in-page calls apart by the ARGUMENT shape:
 *   - a STRING script      — the clear-tag IIFE / the value-free fixed-label locate,
 *   - `evaluate(fn, "tok")`— the advance latch (read or re-arm): its argument is the opaque token,
 *   - `evaluate(fn, {…})`  — the overlay mount, whose options are an object,
 *   - `evaluate(fn)`       — `overlayMounted`.
 */
class FakePage {
  constructor(private readonly pressed: boolean) {}
  url(): string {
    return "https://wing.coupang.com/vendor/open-api";
  }
  on(): void {
    /* close handler — never fires here */
  }
  async evaluate(script: unknown, arg?: unknown): Promise<unknown> {
    if (typeof script === "string") return script.includes("coupang-issuance-cleartag") ? true : { count: 1, sig: "a1b2c3d4e5f60718" };
    if (typeof arg === "string") return this.pressed;
    if (arg !== undefined) return undefined;
    return true;
  }
}

function driverFor(
  opts: { pressed: boolean; wired: boolean },
): { driver: CoupangWingIssuanceDriver; returns: number } {
  const state = { returns: 0 };
  const page = new FakePage(opts.pressed);
  const driver = new CoupangWingIssuanceDriver(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    page as any,
    {
      observeTimeoutMs: 50,
      ...(opts.wired
        ? {
            returnToSellerOps: async () => {
              state.returns += 1;
            },
          }
        : {}),
    },
  );
  return {
    driver,
    get returns() {
      return state.returns;
    },
  } as { driver: CoupangWingIssuanceDriver; returns: number };
}

describe("SellerOps로 돌아가기 — the return actually happens", () => {
  it("**fires when the seller presses it**, and the step still completes", async () => {
    // The press is now the CREDENTIALS step's own CTA (`SellerOps에 연결`) — the walk's last button. There is
    // no separate return step: it existed only because this step used to ask for a hand-copy.
    const wired = driverFor({ pressed: true, wired: true });
    expect(await wired.driver.observeUserAction("credentials")).toBe(true);
    expect(wired.returns).toBe(1);
  });

  it("does NOT fire on any other step's press — nothing moves the window mid-walk", async () => {
    // The seller still has work on WING at every other checkpoint — including the one that creates the key.
    for (const target of ["issue", "confirm_purpose", "vendor_method", "vendor_confirm"] as CoupangIssuanceTarget[]) {
      const wired = driverFor({ pressed: true, wired: true });
      expect(await wired.driver.observeUserAction(target), target).toBe(true);
      expect(wired.returns, target).toBe(0);
    }
  });

  it("does not fire while the seller has NOT pressed it — an elapsed window returns them nowhere", async () => {
    const wired = driverFor({ pressed: false, wired: true });
    expect(await wired.driver.observeUserAction("credentials")).toBe(false);
    expect(wired.returns).toBe(0);
  });

  it("an UNWIRED walk still completes the step — the button is no worse than it was", async () => {
    // A capability that is absent must degrade to the old behaviour (a completion with no move), never to a
    // stalled last step. The driver logs `aw_coupang_return_not_wired` so the silence is on the record.
    const bare = driverFor({ pressed: true, wired: false });
    expect(await bare.driver.observeUserAction("credentials")).toBe(true);
    expect(bare.returns).toBe(0);
  });

  it("a return that REJECTS does not fail the walk — the keys already exist by then", async () => {
    const page = new FakePage(true);
    const driver = new CoupangWingIssuanceDriver(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      page as any,
      { observeTimeoutMs: 50, returnToSellerOps: async () => Promise.reject(new Error("no window")) },
    );
    await expect(driver.observeUserAction("credentials")).resolves.toBe(true);
  });
});
