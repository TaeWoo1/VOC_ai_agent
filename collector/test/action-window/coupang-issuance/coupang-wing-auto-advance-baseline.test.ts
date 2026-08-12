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
import {
  CoupangWingIssuanceDriver,
  WING_HIGHLIGHT_LABELS,
} from "../../../src/action-window/coupang-wing-issuance-driver";
import {
  WING_PURPOSE_SCREEN_MARKER_SPEC,
  WING_TERMS_SCREEN_MARKER_SPECS,
  WING_VENDOR_METHOD_SCREEN_MARKER_SPECS,
} from "../../../src/action-window/coupang-wing-label-recon";
import { clearLogSink, getLogSink } from "../../../src/log";

type Screen = "ISSUANCE" | "PURPOSE" | "TERMS" | "VENDOR" | "ISSUED";

/** Which marker texts paint on each screen. `ISSUANCE` paints none of them — the walk's starting surface. */
function markersFor(screen: Screen): readonly string[] {
  if (screen === "PURPOSE") return [WING_PURPOSE_SCREEN_MARKER_SPEC.exactText];
  if (screen === "TERMS") return WING_TERMS_SCREEN_MARKER_SPECS.map((s) => s.exactText);
  if (screen === "VENDOR") return WING_VENDOR_METHOD_SCREEN_MARKER_SPECS.map((s) => s.exactText);
  // The issued screen keeps the vendor markers painting BESIDE the credential label. Deliberate: what happens
  // to the screen behind WING's success dialog has never been measured, so the credential observation must not
  // be resting on the vendor markers going away.
  if (screen === "ISSUED") {
    return [...WING_VENDOR_METHOD_SCREEN_MARKER_SPECS.map((s) => s.exactText), WING_HIGHLIGHT_LABELS.credentials.exactText];
  }
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
  /**
   * Reads of the credential label by the fixed-label LOCATE — how a test knows the key step's baseline has been
   * taken. Matched on the locate's own candidate query as well as the text, because the structural census
   * carries the same label as a credential anchor: counting that too made this fire before the baseline read,
   * and the test then flipped the screen underneath it and asserted the opposite of what it says.
   */
  credentialReads = 0;
  /** Whether the step overlay is still on the page. A WING navigation takes it with the document. */
  overlayPresent = false;
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
      if (
        script.includes(WING_HIGHLIGHT_LABELS.credentials.exactText) &&
        script.includes(WING_HIGHLIGHT_LABELS.credentials.candidateQuery)
      ) {
        this.credentialReads += 1;
      }
      return painting ? { count: 1, sig: "abcdef0123456789", hiddenCount: 0 } : { count: 0, hiddenCount: 0 };
    }
    // `readOverlayAdvancePressed` is the only function-with-argument read on this path.
    if (arg !== undefined) return this.pressed;
    // …and the only argument-less one is `overlayMounted`, which is how the driver notices WING navigated the
    // guidance out from under the seller.
    return this.overlayPresent;
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

  /* ────────────────── the step that issues the key: it advances on the CREDENTIAL appearing ────────────────── */

  it("**the key-issuing step completes when the credential label appears** — the result, not the press", async () => {
    // Two live sittings issued a real key and this step never completed itself, because what it waited for was
    // the page CATEGORY becoming `credential_shown` — and `classifyWingPage` answers `open_api_issuance` while
    // the open-API marker is present, which it still is when WING shows the keys. The category could not change.
    // What can, and does, is the credential label painting where it measurably was not.
    const { driver, page } = driverOn("VENDOR", 4_000);
    const observing = driver.observeUserAction("vendor_confirm");
    await waitFor(() => page.credentialReads > 0);
    page.screen = "ISSUED"; // the seller pressed 확인 themselves; WING put the keys on the glass
    expect(await observing).toBe(true);
  });

  it("**a run that STARTS on a screen already showing a key cannot report the seller just made one**", async () => {
    // The same baseline rule as every other advance here, and the reason it matters more on this one: this is
    // the step that brings a real marketplace credential into existence, so "it was already there" and
    // "the seller just made it" must never be confusable.
    const { driver } = driverOn("ISSUED");
    expect(await driver.observeUserAction("vendor_confirm")).toBe(false);
  });

  it("the seller's own button still completes the key step from the issued screen — the fence is not a stall", async () => {
    const { driver, page } = driverOn("ISSUED");
    page.pressed = true;
    expect(await driver.observeUserAction("vendor_confirm")).toBe(true);
  });

  it("no OTHER step advances on the credential label — it is the key step's own observation", async () => {
    // A credential painting is evidence about one act. Wiring it to a second step would make an unrelated
    // checkpoint complete itself on an already-issued page.
    const { driver } = driverOn("VENDOR");
    for (const target of ["issue", "confirm_purpose", "vendor_method"] as const) {
      const { driver: d, page } = driverOn("VENDOR");
      page.screen = "ISSUED";
      expect(await d.observeUserAction(target), target).toBe(false);
    }
    expect(await driver.observeUserAction("credentials")).toBe(false);
  });

  /* ────────────────── the guidance has to survive WING navigating out from under it ────────────────── */

  it("**a checkpoint whose overlay vanished re-mounts it** — WING bouncing to login is not a dead end", async () => {
    // Observed 2026-08-12, immediately after the key-issuing 확인: WING sent the window back to login. A
    // navigation destroys the overlay with the document, and nothing noticed — the latch poll kept reading a
    // page with no panel on it, and the window ran out with the seller looking at WING with no guidance and no
    // button to press. Everything "worked"; there was simply nothing on the glass.
    clearLogSink();
    const { driver, page } = driverOn("VENDOR", 1_200);
    page.overlayPresent = false;
    await driver.observeUserAction("vendor_confirm");
    expect(getLogSink().filter((e) => e.event === "aw_coupang_overlay_remount").length).toBeGreaterThan(0);
  });

  it("…and leaves a LIVE overlay alone — a remount every poll would restart the step's own presentation", async () => {
    clearLogSink();
    const { driver, page } = driverOn("VENDOR", 1_200);
    page.overlayPresent = true;
    await driver.observeUserAction("vendor_confirm");
    expect(getLogSink().filter((e) => e.event === "aw_coupang_overlay_remount")).toHaveLength(0);
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
