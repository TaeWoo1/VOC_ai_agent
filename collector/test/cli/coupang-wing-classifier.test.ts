/**
 * Read-only Coupang WING page classifier — offline/synthetic tests. Proves the classifier is counts/booleans/
 * enums only, that it never surfaces a value or raw URL, that classification is structural + fail-closed, and
 * that it always flags itself as an unvalidated (calibration-pending) instrument.
 */
import { describe, it, expect } from "vitest";
import {
  branchAfterWingProbe,
  classifyWingPage,
  classifyWingUrlCategory,
  countBucket,
  observeFrom,
  resolveWingUrlCategory,
  screenWingUrl,
  toWingSignals,
  wingPageCategoryFromCensus,
  type WingStructuralCensus,
} from "../../src/cli/coupang-wing-classifier";

function census(o: Partial<WingStructuralCensus> = {}): WingStructuralCensus {
  return {
    passwordFieldPresent: false,
    submitAffordancePresent: false,
    formCount: 0,
    editableTextInputCount: 0,
    readonlyFieldCount: 0,
    listLikeContainerCount: 0,
    ...o,
  };
}

describe("classifyWingUrlCategory — host category, never the raw URL", () => {
  it("maps the WING host and the Coupang auth hosts", () => {
    expect(classifyWingUrlCategory("https://wing.coupang.com/tenants/seller/some/path?q=1")).toBe("wing_host");
    expect(classifyWingUrlCategory("https://xauth.coupang.com/login")).toBe("coupang_auth_host");
    expect(classifyWingUrlCategory("https://login.coupang.com/x")).toBe("coupang_auth_host");
  });

  it("treats any other host as other_host and unparseable input as unknown (fail-closed)", () => {
    expect(classifyWingUrlCategory("https://example.com/wing")).toBe("other_host");
    expect(classifyWingUrlCategory("not a url")).toBe("unknown");
  });

  it("resolveWingUrlCategory prefers an explicit category and never requires the URL", () => {
    expect(resolveWingUrlCategory({ category: "wing_host" })).toBe("wing_host");
    expect(resolveWingUrlCategory({ url: "https://wing.coupang.com/x" })).toBe("wing_host");
    expect(resolveWingUrlCategory({})).toBe("unknown");
  });
});

describe("countBucket", () => {
  it("buckets by ≤0 / ≤3 / else", () => {
    expect(countBucket(0)).toBe("none");
    expect(countBucket(3)).toBe("few");
    expect(countBucket(4)).toBe("many");
  });
});

describe("classifyWingPage — structural, fail-closed, always calibration-pending", () => {
  const onTarget = (c: Partial<WingStructuralCensus>) => toWingSignals("wing_host", census(c));

  it("always reports LIVE_DOM_CALIBRATION_PENDING (never a proven detector)", () => {
    const r = classifyWingPage(onTarget({ passwordFieldPresent: true }));
    expect(r.blockers).toContain("LIVE_DOM_CALIBRATION_PENDING");
  });

  it("login = password field present (wins over any other signal — precedence)", () => {
    expect(classifyWingPage(onTarget({ passwordFieldPresent: true })).pageCategory).toBe("login");
    expect(
      classifyWingPage(onTarget({ passwordFieldPresent: true, readonlyFieldCount: 5, openApiMarkerPresent: true, listLikeContainerCount: 5 })).pageCategory,
    ).toBe("login");
  });

  it("open_api_issuance = the form marker present, winning over a read-only field + list (no dead-end)", () => {
    // The specific issuance-form marker beats the generic read-only-field heuristic, so an issuance page that
    // pre-fills 업체코드 read-only (or carries a disabled submit) is still recognized as the issuance page.
    expect(classifyWingPage(onTarget({ openApiMarkerPresent: true, listLikeContainerCount: 5 })).pageCategory).toBe("open_api_issuance");
    expect(
      classifyWingPage(onTarget({ readonlyFieldCount: 3, openApiMarkerPresent: true, listLikeContainerCount: 5 })).pageCategory,
    ).toBe("open_api_issuance");
  });

  it("credential_shown = read-only fields present with NO form marker (issued keys, past the entry form)", () => {
    expect(classifyWingPage(onTarget({ readonlyFieldCount: 3, listLikeContainerCount: 5 })).pageCategory).toBe(
      "credential_shown",
    );
  });

  it("wing_home = a list-like container, no login/credential/marker signal", () => {
    expect(classifyWingPage(onTarget({ listLikeContainerCount: 4 })).pageCategory).toBe("wing_home");
    // A stray editable input (a search box) on the home is NOT enough to read as the issuance page — fail-closed.
    expect(classifyWingPage(onTarget({ listLikeContainerCount: 4, editableTextInputCount: 1 })).pageCategory).toBe("wing_home");
  });

  it("unknown = no category signal at all (fail-closed, AMBIGUOUS_SIGNALS)", () => {
    const r = classifyWingPage(onTarget({}));
    expect(r.pageCategory).toBe("unknown");
    expect(r.blockers).toContain("AMBIGUOUS_SIGNALS");
  });

  it("unknown = off-target host (OFF_TARGET_HOST) — refuses to classify a non-WING page", () => {
    const r = classifyWingPage(toWingSignals("other_host", census({ openApiMarkerPresent: true, readonlyFieldCount: 5 })));
    expect(r.pageCategory).toBe("unknown");
    expect(r.blockers).toContain("OFF_TARGET_HOST");
  });

  it("observeFrom folds url-category + census into the sanitized observation", () => {
    const obs = observeFrom("wing_host", census({ openApiMarkerPresent: true }));
    expect(obs.pageCategory).toBe("open_api_issuance");
    expect(obs.urlCategory).toBe("wing_host");
    expect(obs.signals.openApiMarkerPresent).toBe(true);
  });
});

describe("branchAfterWingProbe — the issuance-engine branch, calibration-pending, fail-closed", () => {
  it("maps each category to its branch, and everything unexpected to page_mismatch", () => {
    expect(branchAfterWingProbe("login")).toEqual({ branch: "login", calibration: "LIVE_DOM_CALIBRATION_PENDING" });
    expect(branchAfterWingProbe("wing_home").branch).toBe("wing_home");
    expect(branchAfterWingProbe("open_api_issuance").branch).toBe("open_api");
    for (const cat of ["credential_shown", "unknown"] as const) {
      expect(branchAfterWingProbe(cat).branch).toBe("page_mismatch");
    }
  });

  it("wingPageCategoryFromCensus delegates to the same classifier", () => {
    const { pageCategory } = wingPageCategoryFromCensus("wing_host", census({ passwordFieldPresent: true }));
    expect(pageCategory).toBe("login");
  });
});

describe("screenWingUrl — fail-closed pre-launch screen (reason enum + host category only)", () => {
  it("accepts the WING / auth host", () => {
    expect(screenWingUrl("https://wing.coupang.com/tenants/seller")).toEqual({ ok: true, reason: "ok", urlCategory: "wing_host" });
    expect(screenWingUrl("https://xauth.coupang.com/login").ok).toBe(true);
  });

  it("rejects placeholders, unparseable URLs, and off-target hosts", () => {
    expect(screenWingUrl("https://example.com/your-wing")).toMatchObject({ ok: false, reason: "placeholder" });
    expect(screenWingUrl("COUPANG_WING_URL")).toMatchObject({ ok: false, reason: "placeholder" });
    expect(screenWingUrl("https://naver.com/")).toMatchObject({ ok: false, reason: "off_target" });
  });
});
