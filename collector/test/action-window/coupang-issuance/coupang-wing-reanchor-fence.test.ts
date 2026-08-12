/**
 * **A re-anchor is a claim about WHICH SCREEN the seller is on, and it was not being checked.**
 *
 * Live, 2026-08-12, mid-step-⑦: WING bounced the window to its password-confirm page. The overlay went with the
 * document, the recovery re-resolved the fixed label `확인` against whatever was there, found exactly one — the
 * password form's submit — and ringed it, still carrying "이 화면의 '확인'에서 실제 API 키가 발급됩니다".
 *
 * Nothing was wrong with any individual check. The label matched, once, and it painted. "The control is on this
 * page" and "this is the page the step is about" are different claims, and only the second one licenses
 * guidance — so the recovery now establishes the second before it acts on the first.
 *
 * It then span: back on the salesinfo page `확인` matched nothing, so it retried every second with
 * `panelMounted: false` in every heartbeat, no panel on the seller's screen, and a log that looked healthy.
 *
 * Driven over a fake page, like the baseline suite: a "screen" here is which markers paint, and a "page" is what
 * the sanitized census classifies to.
 */
import { describe, expect, it, beforeEach } from "vitest";
import { CoupangWingIssuanceDriver } from "../../../src/action-window/coupang-wing-issuance-driver";
import { WING_VENDOR_METHOD_SCREEN_MARKER_SPECS, WING_TERMS_SCREEN_MARKER_SPECS } from "../../../src/action-window/coupang-wing-label-recon";
import { clearLogSink, getLogSink } from "../../../src/log";

type Screen = "VENDOR" | "TERMS" | "NONE";
/** What the sanitized census classifies to. `LOGIN` is the live shape: WING's password-confirm page. */
type PageKind = "ISSUANCE" | "LOGIN" | "HOME";

class FakePage {
  /** Whether the step overlay is on the page. A WING navigation takes it with the document. */
  overlayPresent = true;
  screen: Screen = "VENDOR";
  page: PageKind = "ISSUANCE";
  pressed = false;
  /** Re-anchor attempts that actually reached the highlight path. The number the fence is about. */
  highlights = 0;
  /** Overlay unmounts — how the test sees "nothing is left on the glass". */
  unmounts = 0;

  url(): string {
    return "https://wing.coupang.com/tenants/wing-account/vendor/salesinfo";
  }
  on(): void {}

  private census(): Record<string, unknown> {
    return {
      passwordFieldPresent: this.page === "LOGIN",
      submitAffordancePresent: false,
      formCount: 1,
      editableTextInputCount: 0,
      readonlyFieldCount: 0,
      listLikeContainerCount: this.page === "HOME" ? 3 : 0,
      openApiMarkerPresent: this.page === "ISSUANCE",
      credentialAnchorPresent: false,
    };
  }

  private paints(script: string): boolean {
    const specs = this.screen === "VENDOR" ? WING_VENDOR_METHOD_SCREEN_MARKER_SPECS : this.screen === "TERMS" ? WING_TERMS_SCREEN_MARKER_SPECS : [];
    return specs.some((s) => script.includes(s.exactText));
  }

  async evaluate(script: unknown, arg?: unknown): Promise<unknown> {
    if (typeof script === "string") {
      if (script.includes("coupang-wing-census") || script.includes("passwordFieldPresent")) return this.census();
      if (script.includes("coupang-issuance-cleartag")) return true;
      // The RING PLAN — how `vendor_confirm` is actually resolved. Its candidate is the bare `확인`, which is
      // exactly why the live bounce was dangerous: that label resolves on the password page too. So the fake
      // resolves it wherever a `확인` would really be found, and the fence is what has to say no.
      const ringPlan = script.includes("issuance-ring-plan-");
      const confirmResolves = this.page === "LOGIN" || this.screen === "VENDOR";
      if (ringPlan) {
        return confirmResolves
          ? { resolved: true, rows: [{ count: 1, sig: "abcdef0123456789" }] }
          : { resolved: false, rows: [{ count: 0 }] };
      }
      // A single fixed-label locate — the screen markers the flow probe reads.
      return this.paints(script) ? { count: 1, sig: "abcdef0123456789", hiddenCount: 0 } : { count: 0, hiddenCount: 0 };
    }
    const body = String(script);
    if (arg !== undefined) {
      if (typeof arg === "string") {
        if (body.includes("delete")) return undefined;
        if (body.includes("press_count")) {
          return { presses: 0, latched: false, tokenArmed: true, panelMounted: this.overlayPresent };
        }
        return this.pressed;
      }
      // The mount. It only lands where the anchor resolved, and it puts the overlay back — which the driver
      // then VERIFIES with `overlayMounted`, because a mount that ran and painted nothing used to read exactly
      // like one that worked.
      this.highlights += 1;
      this.overlayPresent = true;
      return undefined;
    }
    if (body.includes("removeChild") || body.includes("__aw_overlay__") === false) {
      // The unmount seam — `unmountOverlay` takes no argument.
      this.unmounts += 1;
      return true;
    }
    return this.overlayPresent;
  }
}

function driverOn(page: FakePage, observeTimeoutMs = 3_000): CoupangWingIssuanceDriver {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return new CoupangWingIssuanceDriver(page as any, { observeTimeoutMs });
}

const events = (): string[] => getLogSink().map((l) => l.event);
const metaOf = (event: string): Record<string, unknown> | undefined =>
  getLogSink().find((l) => l.event === event)?.meta as Record<string, unknown> | undefined;

/** Spin until a condition holds, so a test can act BETWEEN the driver's own polls. */
async function waitFor(cond: () => boolean, label = "condition"): Promise<void> {
  for (let i = 0; i < 4_000 && !cond(); i++) await new Promise<void>((r) => setTimeout(r, 1));
  expect(cond(), `${label} never held`).toBe(true);
}

beforeEach(() => clearLogSink());

describe("the re-anchor refuses a page this walk does not live on", () => {
  it("**does not ring the password page's 확인** — the 2026-08-12 defect, in one assertion", async () => {
    const page = new FakePage();
    const driver = driverOn(page);
    const observing = driver.observeUserAction("vendor_confirm");
    // WING bounces to its password-confirm screen: the document is replaced, so the overlay is gone, and a lone
    // `확인` is on the page. Every check the walk had was satisfied by it.
    page.overlayPresent = false;
    page.page = "LOGIN";
    await waitFor(() => events().includes("aw_coupang_reanchor_off_page"), "the off-page refusal");
    expect(page.highlights).toBe(0);
    expect(metaOf("aw_coupang_reanchor_off_page")).toMatchObject({ target: "vendor_confirm", pageCategory: "login" });
    // …and the seller is left with nothing on the glass rather than a ring on a stranger.
    expect(events()).toContain("aw_coupang_guidance_suspended");
    await observing;
  });

  it("carries a category enum and never a URL — the refusal is logged", async () => {
    const page = new FakePage();
    const driver = driverOn(page);
    const observing = driver.observeUserAction("vendor_confirm");
    page.overlayPresent = false;
    page.page = "HOME";
    await waitFor(() => events().includes("aw_coupang_reanchor_off_page"));
    expect(JSON.stringify(metaOf("aw_coupang_reanchor_off_page"))).not.toContain("coupang.com");
    await observing;
  });
});

describe("the re-anchor refuses the wrong SCREEN of the right page", () => {
  it("will not re-anchor the vendor step onto the terms screen", async () => {
    const page = new FakePage();
    const driver = driverOn(page);
    const observing = driver.observeUserAction("vendor_confirm");
    page.overlayPresent = false;
    page.screen = "TERMS"; // still the issuance page, and still not this step's screen
    await waitFor(() => events().includes("aw_coupang_reanchor_off_screen"));
    expect(page.highlights).toBe(0);
    expect(metaOf("aw_coupang_reanchor_off_screen")).toMatchObject({
      target: "vendor_confirm",
      expected: "VENDOR_METHOD",
      observed: "TERMS",
    });
    await observing;
  });

  it("**re-anchors when it IS the step's own screen** — the fence is not a blanket refusal", async () => {
    const page = new FakePage();
    const driver = driverOn(page);
    const observing = driver.observeUserAction("vendor_confirm");
    page.overlayPresent = false; // the overlay was lost, but the seller never left the vendor screen
    await waitFor(() => page.highlights > 0, "the re-anchor");
    expect(events()).toContain("aw_coupang_overlay_remount");
    expect(events()).not.toContain("aw_coupang_reanchor_off_page");
    expect(events()).not.toContain("aw_coupang_reanchor_off_screen");
    await observing;
  });
});

describe("what happens while the seller is away", () => {
  it("takes the guidance down ONCE, not on every poll", async () => {
    const page = new FakePage();
    const driver = driverOn(page);
    const observing = driver.observeUserAction("vendor_confirm");
    page.overlayPresent = false;
    page.page = "LOGIN";
    await waitFor(() => events().includes("aw_coupang_guidance_suspended"));
    // Several more polls go by; the suspension is a state, not an event that repeats.
    await new Promise<void>((r) => setTimeout(r, 1_200));
    expect(events().filter((e) => e === "aw_coupang_guidance_suspended")).toHaveLength(1);
    await observing;
  });

  it("**re-anchors by itself the moment the seller's own screen comes back**", async () => {
    const page = new FakePage();
    const driver = driverOn(page);
    const observing = driver.observeUserAction("vendor_confirm");
    page.overlayPresent = false;
    page.page = "LOGIN";
    await waitFor(() => events().includes("aw_coupang_guidance_suspended"));
    // The seller finishes re-authenticating and WING puts them back. Nothing here navigates them.
    page.page = "ISSUANCE";
    await waitFor(() => page.highlights > 0, "the recovery re-anchor");
    expect(events()).toContain("aw_coupang_guidance_resumed");
    expect(metaOf("aw_coupang_guidance_resumed")).toHaveProperty("polls");
    await observing;
  });

  it("**gives up after a bounded wait** rather than polling a page it cannot guide", async () => {
    // The live failure's second half: a re-mount attempt every second, `panelMounted: false` throughout, and a
    // run that looked healthy. Returning false hands back to the session, which parks with a recoverable
    // blocker — so the seller gets a "다시 확인" instead of silence.
    const page = new FakePage();
    // A short observe window: the property is that it gives up, and the bound is checked by the source below.
    const driver = driverOn(page, 2_500);
    page.overlayPresent = false;
    page.page = "LOGIN";
    expect(await driver.observeUserAction("vendor_confirm")).toBe(false);
    expect(page.highlights).toBe(0);
  });
});

describe("the repeating observations are sampled, not silenced", () => {
  it("writes the first line and then samples — the state and its duration both survive", async () => {
    const page = new FakePage();
    const driver = driverOn(page, 2_500);
    page.overlayPresent = false;
    page.page = "LOGIN";
    await driver.observeUserAction("vendor_confirm");
    const offPage = getLogSink().filter((l) => l.event === "aw_coupang_reanchor_off_page");
    // The first one is the transition — the moment it started — and it carries no repeat count.
    expect(offPage.length).toBeGreaterThanOrEqual(1);
    expect(offPage[0]!.meta).not.toHaveProperty("repeat");
    // …and far fewer than one per poll. Two-and-a-half seconds of polling produced at most a couple of lines.
    expect(offPage.length).toBeLessThan(5);
  });
});
