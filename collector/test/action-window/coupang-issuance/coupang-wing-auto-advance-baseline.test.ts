/**
 * **An auto-advance must observe a CHANGE, not a state.**
 *
 * Four steps of the guided walk advance on what the runtime reads on WING rather than on the seller pressing
 * anything. That is only an observation of the seller's act if the screen it watches for was NOT already there
 * when the step was armed.
 *
 * It was not checked. `observeOverlayAdvance` ran its first screen probe at `i === 0`, immediately after
 * `armObserve` and before any sleep, and simply asked "is the expected screen showing". WING keeps later screens
 * in the same document — the recorded marker evidence has `stage3.terms.heading` at `hiddenCount: 1` while the
 * reading was taken on PURPOSE — and no reading of the purpose marker has ever been taken ON the issuance page.
 * So a purpose marker that paints before 발급 is pressed completed step 2 by itself and the walk guided step 3
 * while the seller had done nothing at all.
 *
 * Driven over a FAKE page: no browser, no WING. The fake answers the value-free fixed-label locate scripts by
 * matching the label text they embed, so a "screen" here is just which markers paint.
 */
import { describe, expect, it } from "vitest";
import { CoupangWingIssuanceDriver } from "../../../src/action-window/coupang-wing-issuance-driver";
import {
  WING_PURPOSE_SCREEN_MARKER_SPEC,
  WING_TERMS_SCREEN_MARKER_SPECS,
} from "../../../src/action-window/coupang-wing-label-recon";

type Screen = "ISSUANCE" | "PURPOSE" | "TERMS";

/** Which marker texts paint on each screen. `ISSUANCE` paints none of them — the walk's starting surface. */
function markersFor(screen: Screen): readonly string[] {
  if (screen === "PURPOSE") return [WING_PURPOSE_SCREEN_MARKER_SPEC.exactText];
  if (screen === "TERMS") return WING_TERMS_SCREEN_MARKER_SPECS.map((s) => s.exactText);
  return [];
}

/**
 * A read-only fake page whose screen can change between reads — which is the whole point: it lets a test say
 * "the marker was already painting when the step was armed" versus "it appeared afterwards".
 */
class FakePage {
  screen: Screen;
  /** Whether the seller has pressed the WING-resident advance button. */
  pressed = false;
  /** Completed `probeFlowScreen` passes. The purpose marker is read LAST, so it counts whole passes. */
  screenReads = 0;
  constructor(screen: Screen) {
    this.screen = screen;
  }
  url(): string {
    return "https://wing.coupang.com/vendor/open-api";
  }
  on(): void {
    /* close handler — never fires here */
  }
  async evaluate(script: unknown, arg?: unknown): Promise<unknown> {
    if (typeof script === "string") {
      // A fixed-label locate: does the label it embeds paint on the current screen?
      const painting = markersFor(this.screen).find((text) => script.includes(text));
      if (script.includes(WING_PURPOSE_SCREEN_MARKER_SPEC.exactText)) this.screenReads += 1;
      return painting ? { count: 1, sig: "abcdef0123456789", hiddenCount: 0 } : { count: 0, hiddenCount: 0 };
    }
    // `readOverlayAdvancePressed` is the only function-with-argument read on this path.
    if (arg !== undefined) return this.pressed;
    return false;
  }
}

function driverOn(screen: Screen, observeTimeoutMs = 30): { driver: CoupangWingIssuanceDriver; page: FakePage } {
  const page = new FakePage(screen);
  // A short observe window by default: the property under test is about the FIRST reading, not about patience.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { driver: new CoupangWingIssuanceDriver(page as any, { observeTimeoutMs }), page };
}

/** Spin until a condition holds, so a test can act BETWEEN the driver's own reads. */
async function waitFor(cond: () => boolean): Promise<void> {
  for (let i = 0; i < 2_000 && !cond(); i++) await new Promise<void>((r) => setTimeout(r, 1));
  expect(cond(), "condition never held").toBe(true);
}

describe("the screen-based auto-advance requires the screen to CHANGE", () => {
  it("**does not complete a step whose expected screen was ALREADY showing when it was armed**", async () => {
    // The seller has not pressed 발급. If the purpose marker is painting anyway — which nothing has ever
    // measured NOT to happen on the issuance page — step 2 must not complete itself.
    const { driver } = driverOn("PURPOSE");
    expect(await driver.observeUserAction("issue")).toBe(false);
  });

  it("completes when the expected screen APPEARS after arming — the seller's own act", async () => {
    const { driver, page } = driverOn("ISSUANCE", 4_000);
    // The baseline is taken at arm time and reads ISSUANCE; the seller then presses 발급 and WING moves to the
    // purpose screen. Flipped only once the baseline read has actually happened, or the test would be asserting
    // the case above instead.
    const observing = driver.observeUserAction("issue");
    await waitFor(() => page.screenReads > 0);
    page.screen = "PURPOSE";
    expect(await observing).toBe(true);
  });

  it("the seller's own advance button still works from ANY starting screen — the fence is not a stall", async () => {
    // Fail-closed must degrade to the WING-resident button, never to a run that cannot move. This is the
    // property that makes the check above safe to take.
    const { driver, page } = driverOn("PURPOSE");
    page.pressed = true;
    expect(await driver.observeUserAction("issue")).toBe(true);
  });

  it("an UNREADABLE baseline disables screen-advance too", async () => {
    // Not knowing where the seller started is exactly the state in which "the expected screen is showing"
    // cannot be told apart from "it was showing all along".
    const page = new FakePage("ISSUANCE");
    let firstRead = true;
    const original = page.evaluate.bind(page);
    page.evaluate = async (script: unknown, arg?: unknown): Promise<unknown> => {
      if (typeof script === "string" && firstRead) {
        firstRead = false;
        throw new Error("execution context was destroyed");
      }
      return original(script, arg);
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const driver = new CoupangWingIssuanceDriver(page as any, { observeTimeoutMs: 30 });
    const observing = driver.observeUserAction("issue");
    page.screen = "PURPOSE";
    expect(await observing).toBe(false);
  });

  it("**the key-creation step has no screen advance at all**, whatever the page says", async () => {
    // `issue_final` is absent from the advance map on purpose and must stay absent: it is the one control that
    // mutates marketplace state, and nothing about it may auto-advance. Asserted from BOTH screens so it cannot
    // pass by the fake happening to sit somewhere unrecognized.
    for (const screen of ["TERMS", "PURPOSE", "ISSUANCE"] as const) {
      const { driver } = driverOn(screen);
      expect(await driver.observeUserAction("issue_final"), screen).toBe(false);
    }
  });
});
