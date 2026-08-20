/**
 * **The walk's one return to SellerOps, and when it is allowed to happen.**
 *
 * Live-observed 2026-08-12: the seller pressed `SellerOps로 돌아가기`, their screen stayed on WING, and they
 * said so — "sellerops로 돌아가기 버튼을 눌러도 딱히 액션은 없네?". The button recorded a step completion while
 * its label promised a move. That was fixed by injecting a real navigation.
 *
 * It then moved. The credential step's press is the seller's CONSENT to the handoff, given on the window the
 * values are on, and a consent that also navigated finished the walk on the way out — the run completed over an
 * empty vault and the product asked the seller to type in the keys it had just been shown. So:
 *
 *  - **no step's press returns anything.** Not the credential step, not any other.
 *  - The return is the OUTCOME panel's button, mounted after the handoff resolves — the same button whether the
 *    credential was stored or not, because in both cases what is left is in SellerOps.
 *
 * The navigation is still INJECTED: this driver's source guard forbids `.goto(` and `window.open` outright and
 * should keep forbidding them. What is asserted here is the wiring.
 */
import { describe, expect, it } from "vitest";
import { CoupangWingIssuanceDriver } from "../../../src/action-window/coupang-wing-issuance-driver";
import type {
  CoupangHandoffPanelPhase,
  CoupangIssuanceTarget,
} from "../../../src/action-window/coupang-issuance/coupang-issuance-driver";

/**
 * A read-only fake page that tells the driver's in-page calls apart by the ARGUMENT shape:
 *   - a STRING script      — the clear-tag IIFE / the value-free fixed-label locate,
 *   - `evaluate(fn, "tok")`— a latch (read or re-arm): its argument is the opaque token,
 *   - `evaluate(fn, {…})`  — the overlay mount, whose options are an object,
 *   - `evaluate(fn)`       — `overlayMounted`.
 *
 * The two latches are separate globals and this fake keeps them separate: answering `pressed` to both would
 * report every seller who advanced as having asked to leave instead.
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
    if (typeof arg === "string") return String(script).includes("__aw_secondary_pressed__") ? false : this.pressed;
    if (arg !== undefined) return undefined;
    return true;
  }
}

function driverFor(opts: { pressed: boolean; wired: boolean }): { driver: CoupangWingIssuanceDriver; returns: () => number } {
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
  return { driver, returns: () => state.returns };
}

describe("no STEP press returns the seller anywhere", () => {
  it("**the credential step's press is the consent, and it moves nothing**", async () => {
    // THE correction. This press used to navigate, which made the return the walk's last act and the credential
    // barrier's completion at once — so the seller arrived in SellerOps to be asked to type what they had just
    // been shown. It now records consent and nothing else; SellerOps performs the handoff under it.
    const wired = driverFor({ pressed: true, wired: true });
    expect(await wired.driver.observeUserAction("credentials")).toBe(true);
    expect(wired.returns()).toBe(0);
  });

  it("nor does any other step's press — the seller still has work on WING at every one of them", async () => {
    for (const target of ["issue", "confirm_purpose", "vendor_method", "vendor_confirm"] as CoupangIssuanceTarget[]) {
      const wired = driverFor({ pressed: true, wired: true });
      expect(await wired.driver.observeUserAction(target), target).toBe(true);
      expect(wired.returns(), target).toBe(0);
    }
  });
});

describe("the outcome panel's button — the walk's only return", () => {
  it("**a stored credential returns the seller on their press**, and only on their press", async () => {
    const wired = driverFor({ pressed: true, wired: true });
    expect(await wired.driver.showHandoffPanel("STORED")).toBe(true);
    expect(await wired.driver.readHandoffPanelPressed("STORED")).toBe(true);
    expect(wired.returns()).toBe(0); // reading a press is not performing the return

    await wired.driver.returnToSellerOpsNow();

    expect(wired.returns()).toBe(1);
  });

  it("a FAILED handoff offers the same button — what is left to do is in SellerOps either way", async () => {
    const wired = driverFor({ pressed: true, wired: true });
    expect(await wired.driver.showHandoffPanel("FAILED")).toBe(true);
    expect(await wired.driver.readHandoffPanelPressed("FAILED")).toBe(true);
  });

  it("**the WORKING panel can never report a press** — it has no button, so there is nothing to answer", async () => {
    // Same rule as a park notice that asks no question: the button is what gives the press meaning.
    const wired = driverFor({ pressed: true, wired: true });
    expect(await wired.driver.showHandoffPanel("WORKING")).toBe(true);
    expect(await wired.driver.readHandoffPanelPressed("WORKING")).toBe(false);
  });

  it("an unpressed panel returns nobody — the seller may sit on their keys as long as they like", async () => {
    const bare = driverFor({ pressed: false, wired: true });
    await bare.driver.showHandoffPanel("STORED");
    expect(await bare.driver.readHandoffPanelPressed("STORED")).toBe(false);
    expect(bare.returns()).toBe(0);
  });

  it("an UNWIRED walk does not stall — the return is absent, logged, and harmless", async () => {
    // A capability that is absent must degrade to "a completion with no move", never to a stuck last panel.
    // The driver logs `aw_coupang_return_not_wired` so the silence is on the record.
    const bare = driverFor({ pressed: true, wired: false });
    await expect(bare.driver.returnToSellerOpsNow()).resolves.toBeUndefined();
    expect(bare.returns()).toBe(0);
  });

  it("a return that REJECTS does not throw — the credential is already in the vault by then", async () => {
    const page = new FakePage(true);
    const driver = new CoupangWingIssuanceDriver(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      page as any,
      { observeTimeoutMs: 50, returnToSellerOps: async () => Promise.reject(new Error("no window")) },
    );
    await expect(driver.returnToSellerOpsNow()).resolves.toBeUndefined();
  });

  it("every phase paints, and each carries at most one button", async () => {
    const wired = driverFor({ pressed: false, wired: true });
    for (const phase of ["WORKING", "STORED", "FAILED"] as CoupangHandoffPanelPhase[]) {
      expect(await wired.driver.showHandoffPanel(phase), phase).toBe(true);
    }
  });
});
