/**
 * **The ring at step ⑦ sits on the control that ISSUES THE KEY, so it must not appear over an empty form.**
 *
 * Reported by the product owner after the 2026-08-12 live walk, and it is the sharpest of the four things they
 * found: they filled 업체명 / URL / IP themselves because they knew to, and observed that a seller following the
 * ring would press 확인 without doing so. The panel mentions the fields; the ring points at the button. A ring
 * beats a sentence.
 *
 * So step ⑥'s advance — the press that hands over to that ring — checks first. Once. What this file pins is both
 * halves of that: it refuses a press over an empty form, and it never refuses twice.
 *
 * Driven over a fake page. The census answers structurally, so a "filled field" here is a count, exactly as it
 * is on WING.
 */
import { describe, expect, it, beforeEach } from "vitest";
import { CoupangWingIssuanceDriver } from "../../../src/action-window/coupang-wing-issuance-driver";
import { WING_VENDOR_METHOD_SCREEN_MARKER_SPECS, wingCandidateSpecById } from "../../../src/action-window/coupang-wing-label-recon";
import { clearLogSink, getLogSink } from "../../../src/log";

const FIELD_IDS = ["stage2.vendor_info.baseline", "stage2.vendor_url.url", "stage2.call_ip.ip_addr"] as const;

/**
 * A fake vendor screen. `filled` says which of the three fields the seller has completed — `IP 주소` counting a
 * REGISTERED ENTRY rather than typed text, because 추가 is a press whose result is a row.
 */
class FakeVendorPage {
  pressed = false;
  /** Presses the page has seen cleared by the driver's re-arm. Proves the gate does not eat a press silently. */
  resets = 0;
  /** Mounted overlay briefs, in order. The gate's whole visible effect is the second one. */
  mounts: string[] = [];
  filled = new Set<string>();
  censusReads = 0;

  /**
   * From which census read the registered-address chip paints. `1` = the ordinary case (reading #1 is the
   * step's before-picture, the chip arrives after it); `0` = a form that was already complete when ⑥ armed.
   */
  ipRegisteredFromRead = 1;

  url(): string {
    return "https://wing.coupang.com/vendor/open-api";
  }
  on(): void {}

  private ipChipShowing(): boolean {
    return this.filled.has("stage2.call_ip.ip_addr") && this.censusReads > this.ipRegisteredFromRead;
  }

  async evaluate(script: unknown, arg?: unknown): Promise<unknown> {
    if (typeof script === "string") {
      if (script.includes("wing-field-region-census")) {
        this.censusReads += 1;
        return {
          readings: FIELD_IDS.map((id) => ({
            id,
            visibleCount: 1,
            hiddenCount: 0,
            observedTag: "DT",
            association: "DT_NEXT_DD",
            regionTag: "DD",
            inputCount: 1,
            textInputCount: 1,
            // The MEASURED WING shape (2026-08-13 READ_ONLY sitting, wt-017b33239e33): a registered address is a
            // chip carrying its own remove button, so the region's button count rises from 1 (the `추가` control)
            // to 2 while `entryRowCount` stays ZERO on both sides. This fixture modelled the registration as a
            // ROW appearing — a shape the live screen was then measured NOT to have — and every test here passed
            // against it while the live walk read the same form as incomplete.
            //
            // It is a TRANSITION, not a constant: the readiness rule compares the region against the one the
            // step armed on, so `ipRegisteredFromRead` decides which reading the chip first appears in.
            buttonCount: id === "stage2.call_ip.ip_addr" ? (this.ipChipShowing() ? 2 : 1) : 0,
            entryRowCount: 0,
            filledTextInputCount: id !== "stage2.call_ip.ip_addr" && this.filled.has(id) ? 1 : 0,
          })),
        };
      }
      // The vendor markers paint: this IS the vendor screen.
      const painting = WING_VENDOR_METHOD_SCREEN_MARKER_SPECS.some((s) => script.includes(s.exactText));
      return painting ? { count: 1, sig: "abcdef0123456789", hiddenCount: 0 } : { count: 0, hiddenCount: 0 };
    }
    if (arg !== undefined) {
      // The overlay's own calls, told apart by what they are handed. The token-carrying reads take a STRING (the
      // opaque step token); the mount takes the panel options object. Discriminating on the function body alone
      // would not work: the mount arms the same token global the re-arm writes, so it contains the same name.
      if (typeof arg === "string") {
        if (String(script).includes("delete")) {
          this.resets += 1;
          this.pressed = false;
          return undefined;
        }
        if (String(script).includes("press_count")) {
          return { presses: this.pressed ? 1 : 0, latched: this.pressed, tokenArmed: true, panelMounted: true };
        }
        return this.pressed;
      }
      const a = arg as Record<string, unknown>;
      if (typeof a["label"] === "string") {
        this.mounts.push(a["label"] as string);
        return undefined;
      }
      return this.pressed;
    }
    return true;
  }
}

/**
 * The overlay module talks to the page through `evaluate(fn, arg)`, and the arg shapes differ per call. Rather
 * than model all of them, the driver is given a page whose evaluate is inspected by the tests above for the two
 * shapes that matter (the census script, and the latch). This keeps the fake honest about what it stands in for.
 */
function driverOn(page: FakeVendorPage, observeTimeoutMs = 400): CoupangWingIssuanceDriver {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return new CoupangWingIssuanceDriver(page as any, { observeTimeoutMs });
}

function logged(event: string): boolean {
  return getLogSink().some((l) => l.event === event);
}

/** Spin until a condition holds, so a test can act BETWEEN the driver's own polls. */
async function waitFor(cond: () => boolean): Promise<void> {
  for (let i = 0; i < 2_000 && !cond(); i++) await new Promise<void>((r) => setTimeout(r, 1));
  expect(cond(), "condition never held").toBe(true);
}

beforeEach(() => clearLogSink());

describe("the vendor-form gate at step ⑥", () => {
  it("**refuses the press that would hand over to the 확인 ring while the form reads empty**", async () => {
    const page = new FakeVendorPage();
    page.pressed = true; // the seller presses 선택했어요 · 다음 with nothing filled in
    const advanced = await driverOn(page).observeUserAction("vendor_method");
    expect(advanced).toBe(false);
    expect(logged("aw_coupang_vendor_form_not_ready")).toBe(true);
  });

  it("advances when all three are done — 업체명 · URL typed, and the IP actually ADDED", async () => {
    // The seller fills the form in while the step watches, which is when the registration is observable at all:
    // the chip has to arrive after the reading the step baselined on.
    const page = new FakeVendorPage();
    page.filled = new Set(FIELD_IDS);
    const observing = driverOn(page, 3_000).observeUserAction("vendor_method");
    await waitFor(() => page.censusReads > 1);
    page.pressed = true;
    expect(await observing).toBe(true);
    expect(logged("aw_coupang_vendor_form_not_ready")).toBe(false);
  });

  it("**a form already complete when ⑥ armed refuses one press, then yields**", async () => {
    // The named cost of comparing against a before-picture: a walk re-anchoring on a form the seller finished
    // earlier cannot tell it from a form nobody has touched, so it reads NOT_READY and the seller presses twice.
    // Recorded here rather than left to be rediscovered live.
    const page = new FakeVendorPage();
    page.filled = new Set(FIELD_IDS);
    page.ipRegisteredFromRead = 0;
    page.pressed = true;
    const observing = driverOn(page, 3_000).observeUserAction("vendor_method");
    await waitFor(() => page.resets > 0);
    expect(logged("aw_coupang_vendor_form_not_ready")).toBe(true);
    page.pressed = true;
    expect(await observing).toBe(true);
  });

  it("**an IP typed but never ADDED is not ready** — 추가 is the press that registers it", async () => {
    const page = new FakeVendorPage();
    // The two text fields are in; the IP region holds no registered row, which is what 추가 produces.
    page.filled = new Set(["stage2.vendor_info.baseline", "stage2.vendor_url.url"]);
    page.pressed = true;
    expect(await driverOn(page).observeUserAction("vendor_method")).toBe(false);
  });

  it("**refuses ONCE — the second press goes through whatever the census says**", async () => {
    // Manual progress always remains available. This association has never been calibrated on a live screen, so
    // a fence that could trap a seller behind a misread field would be worse than the defect it closes.
    const page = new FakeVendorPage();
    page.pressed = true;
    const driver = driverOn(page, 2_000);
    const observing = driver.observeUserAction("vendor_method");
    // The refusal RE-ARMS the latch, so the walk is now waiting on a genuinely new press rather than re-reading
    // the one it just declined. Without that the gate would be a message and nothing else.
    await waitFor(() => page.resets > 0);
    expect(page.pressed).toBe(false);
    page.pressed = true; // the seller presses again, having read the panel
    expect(await observing).toBe(true);
    // …and they were told why before it yielded.
    expect(page.mounts.some((m) => m.includes("한 번 더 누르시면"))).toBe(true);
  });

  it("tells the seller what is missing, without saying what they typed", async () => {
    const page = new FakeVendorPage();
    page.pressed = true;
    await driverOn(page, 2_000).observeUserAction("vendor_method");
    const warning = page.mounts.find((m) => m.includes("잠깐"));
    expect(warning).toBeDefined();
    expect(warning).toContain("업체명");
    expect(warning).toContain("추가");
  });

  it("**a census it cannot resolve does not hold the seller** — UNKNOWN is not NOT_READY", async () => {
    // Only the LABELS have ever been measured on this screen; what they are attached to has not. A page that
    // does not answer must not be able to make the key unreachable.
    const page = new FakeVendorPage();
    page.evaluate = async (script: unknown, arg?: unknown): Promise<unknown> => {
      if (typeof script === "string" && script.includes("wing-field-region-census")) {
        return { readings: FIELD_IDS.map((id) => ({ id, visibleCount: 0, hiddenCount: 2 })) };
      }
      return FakeVendorPage.prototype.evaluate.call(page, script, arg);
    };
    page.pressed = true;
    expect(await driverOn(page).observeUserAction("vendor_method")).toBe(true);
    expect(logged("aw_coupang_vendor_form_not_ready")).toBe(false);
  });

  it("**gates step ⑥ and nothing else** — no other step consults the form", async () => {
    // The gate belongs to the one press that hands over to a ring on the key-issuing control. Putting it
    // anywhere else would be a form check standing between the seller and steps that have nothing to do with it.
    for (const target of ["issue", "confirm_purpose", "issue_final", "credentials"] as const) {
      clearLogSink();
      const page = new FakeVendorPage();
      page.pressed = true;
      expect(await driverOn(page).observeUserAction(target), target).toBe(true);
      expect(page.censusReads, target).toBe(0);
    }
  });

  it("its field readings carry an id, booleans and STRUCTURE — never a value", async () => {
    // The structural counts joined the line on 2026-08-13: the census had computed them from the start and
    // logged none, so a live walk that read `IP 주소` as not-ready for ninety seconds could not say what the
    // region actually held. Every one of them is an integer or a tag name; what the seller typed is still
    // represented only by `ready`.
    const page = new FakeVendorPage();
    page.filled = new Set(["stage2.vendor_info.baseline"]);
    page.pressed = true;
    await driverOn(page).observeUserAction("vendor_method");
    const rows = getLogSink().filter((l) => l.event === "aw_coupang_vendor_form_field");
    expect(rows.length).toBeGreaterThan(0);
    const allowed = ["fieldId", "ready", "resolved", "regionTag", "inputCount", "textInputCount", "buttonCount", "entryRowCount", "visibleCount", "repeat"];
    for (const row of rows) {
      const meta = (row.meta ?? {}) as Record<string, unknown>;
      for (const key of Object.keys(meta)) expect(allowed, key).toContain(key);
      expect(typeof meta["ready"]).toBe("boolean");
      // Nothing derived from a VALUE travels — not even the emptiness count the readiness rule itself uses.
      expect(meta["filledTextInputCount"]).toBeUndefined();
      for (const value of Object.values(meta)) expect(["string", "number", "boolean"]).toContain(typeof value);
    }
  });
});

describe("the fields the gate reads are the MEASURED ones", () => {
  it("resolves each from the recon candidate by id — never a second hand-written label", () => {
    // The same rule every other spec in this walk follows: a duplicate `exactText` is how a locator drifts away
    // from the measurement that justifies it.
    for (const id of FIELD_IDS) {
      const spec = wingCandidateSpecById(id);
      expect(spec.id).toBe(id);
      expect(spec.exactText.length).toBeGreaterThan(0);
    }
  });
});
