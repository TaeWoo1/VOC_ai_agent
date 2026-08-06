/**
 * Behavioral test for the READ-ONLY recorder seams added to `CoupangWingIssuanceDriver`
 * (`probeTargetMatch` + `observeSurface`), driven over a FAKE page — no browser, no WING.
 *
 * It locks that: (a) `probeTargetMatch` returns ONLY `{ matchCount, canHighlight, sig? }` (an opaque 16-hex sig
 * ONLY on a unique match, never on a 0/many match); (b) `observeSurface` returns the sanitized `WingObservation`
 * (pageCategory + bucketized signals + the always-present `LIVE_DOM_CALIBRATION_PENDING` blocker); and (c) the
 * driver reads NO field value — the fake page exposes ONLY `evaluate` / `url` / `on`, so any `.inputValue` /
 * `.textContent` / `.getAttribute` / clipboard / screenshot read would throw and fail the test.
 */
import { describe, expect, it } from "vitest";
import { CoupangWingIssuanceDriver } from "../../../src/action-window/coupang-wing-issuance-driver";
import type { WingStructuralCensus } from "../../../src/cli/coupang-wing-classifier";

const ISSUANCE_CENSUS: WingStructuralCensus = {
  passwordFieldPresent: false,
  submitAffordancePresent: true,
  formCount: 1,
  editableTextInputCount: 2,
  readonlyFieldCount: 0,
  listLikeContainerCount: 2,
  openApiMarkerPresent: true,
};

type EvalReturn = unknown;

/** A minimal read-only fake Page: ONLY `evaluate` / `url` / `on`. No value-read methods exist, by design. */
class FakePage {
  public readonly scripts: string[] = [];
  constructor(
    private readonly locate: EvalReturn,
    private readonly census: WingStructuralCensus,
    private readonly urlStr: string,
  ) {}
  url(): string {
    return this.urlStr;
  }
  on(): void {
    /* close handler — never fires in the test */
  }
  async evaluate(script: string): Promise<EvalReturn> {
    this.scripts.push(script);
    // The census IIFE returns `{ passwordFieldPresent: ... }`; the fixed-label locate IIFE returns `{ count, sig? }`.
    if (script.includes("passwordFieldPresent")) return this.census;
    return this.locate;
  }
}

function driverWith(locate: EvalReturn, url = "https://wing.coupang.com/vendor/open-api"): {
  driver: CoupangWingIssuanceDriver;
  page: FakePage;
} {
  const page = new FakePage(locate, ISSUANCE_CENSUS, url);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const driver = new CoupangWingIssuanceDriver(page as any);
  return { driver, page };
}

describe("CoupangWingIssuanceDriver.probeTargetMatch — read-only recorder seam", () => {
  it("reports matchCount + a 16-hex sig for a UNIQUE match", async () => {
    const { driver } = driverWith({ count: 1, sig: "0123456789abcdef" });
    const res = await driver.probeTargetMatch("issue");
    expect(res.matchCount).toBe(1);
    expect(res.canHighlight).toBe(true);
    expect(res.sig).toBe("0123456789abcdef");
    // Sanitized shape only — no other keys leak.
    expect(Object.keys(res).sort()).toEqual(["canHighlight", "matchCount", "sig"]);
  });

  it("reports NO sig when the candidate does not resolve uniquely (0 or many)", async () => {
    for (const count of [0, 3]) {
      const { driver } = driverWith({ count });
      const res = await driver.probeTargetMatch("call_ip");
      expect(res.matchCount).toBe(count);
      expect(res.canHighlight).toBe(false);
      expect(res.sig).toBeUndefined();
      expect(Object.keys(res).sort()).toEqual(["canHighlight", "matchCount"]);
    }
  });

  it("coerces a malformed count to 0 (fail-closed, non-unique)", async () => {
    const { driver } = driverWith({ count: -1 });
    const res = await driver.probeTargetMatch("self_dev");
    expect(res.matchCount).toBe(0);
    expect(res.canHighlight).toBe(false);
  });

  it("runs the value-free fixed-label LOCATE script (never the tag variant) and reads no field value", async () => {
    const { driver, page } = driverWith({ count: 1, sig: "0123456789abcdef" });
    await driver.probeTargetMatch("credentials");
    // The one script it evaluated is the locate (not tag) IIFE — it does not write data-aw-target.
    expect(page.scripts).toHaveLength(1);
    expect(page.scripts[0]).toContain("issuance-fixed-label-locate");
    expect(page.scripts[0]).not.toContain("setAttribute('data-aw-target'");
  });
});

describe("CoupangWingIssuanceDriver.observeSurface — sanitized observation", () => {
  it("returns the sanitized WingObservation with the always-present calibration blocker", async () => {
    const { driver } = driverWith({ count: 1, sig: "0123456789abcdef" });
    const obs = await driver.observeSurface();
    expect(obs.urlCategory).toBe("wing_host");
    expect(obs.pageCategory).toBe("open_api_issuance");
    expect(obs.blockers).toContain("LIVE_DOM_CALIBRATION_PENDING");
    // Signals are bucketized — never a raw count/value.
    expect(obs.signals.editableTextInputCountBucket).toBe("few");
    expect(obs.signals.openApiMarkerPresent).toBe(true);
  });
});
