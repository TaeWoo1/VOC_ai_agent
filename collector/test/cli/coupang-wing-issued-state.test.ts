/**
 * Tests for `wingIssuedStateFrom` — the derivation that turns a sanitized observation into machine-checkable
 * evidence about whether an open-API key is currently issued.
 *
 * Why it exists: the first live deletion produced `pageCategory: open_api_issuance` BOTH before and after the
 * operator deleted their key (the already-issued page classifies that way via the credential anchor; the
 * post-delete issuance FORM classifies that way via the form marker). The category alone therefore said nothing
 * about the deletion in either direction, and the outcome could only be recorded as operator-attested.
 *
 * The load-bearing property is the ASYMMETRY: `not_issued` needs POSITIVE form-marker evidence, so a page that
 * failed to load — which also lacks the credential anchor — reports `indeterminate` instead of masquerading as
 * proof of deletion. These tests exist mostly to keep that asymmetry from being "simplified" away.
 */
import { describe, it, expect } from "vitest";
import {
  WING_ISSUED_STATES,
  wingIssuedStateFrom,
  type WingObservation,
  type WingPageCategory,
  type WingSignals,
} from "../../src/cli/coupang-wing-classifier";

function observation(over: Partial<WingSignals> & { pageCategory?: WingPageCategory } = {}): WingObservation {
  const { pageCategory = "open_api_issuance", ...signalOver } = over;
  const signals: WingSignals = {
    urlCategory: "wing_host",
    passwordFieldPresent: false,
    submitAffordancePresent: true,
    formCountBucket: "few",
    editableTextInputCountBucket: "few",
    readonlyFieldCountBucket: "few",
    listLikeContainerCountBucket: "few",
    openApiMarkerPresent: false,
    credentialAnchorPresent: false,
    ...signalOver,
  };
  return { urlCategory: signals.urlCategory, pageCategory, signals, blockers: ["LIVE_DOM_CALIBRATION_PENDING"] };
}

describe("wingIssuedStateFrom — ISSUED", () => {
  it("the live-confirmed credential anchor ⇒ issued", () => {
    // This is the shape the 2026-08-07 pre-delete capture actually had: anchor true, form marker FALSE.
    const r = wingIssuedStateFrom(observation({ credentialAnchorPresent: true, openApiMarkerPresent: false }));
    expect(r).toEqual({ state: "issued", reason: "CREDENTIAL_ANCHOR_PRESENT" });
  });

  it("the anchor wins even when the form marker is also present", () => {
    // A page showing both is still showing a credential region — never report that as nothing-issued.
    const r = wingIssuedStateFrom(observation({ credentialAnchorPresent: true, openApiMarkerPresent: true }));
    expect(r.state).toBe("issued");
  });

  it("holds on the credential_shown surface too", () => {
    const r = wingIssuedStateFrom(observation({ pageCategory: "credential_shown", credentialAnchorPresent: true }));
    expect(r.state).toBe("issued");
  });
});

describe("wingIssuedStateFrom — NOT_ISSUED requires POSITIVE evidence", () => {
  it("form marker present + no credential anchor ⇒ not_issued (the post-delete evidence)", () => {
    const r = wingIssuedStateFrom(observation({ openApiMarkerPresent: true, credentialAnchorPresent: false }));
    expect(r).toEqual({ state: "not_issued", reason: "FORM_MARKER_WITHOUT_CREDENTIAL_ANCHOR" });
  });

  it("a MISSING anchor alone is NOT enough — that is what a broken read looks like", () => {
    // The single most important case in this file. A page that failed to load, hydrated late, or rendered an
    // error has no credential anchor either. Reading that as "the key is gone" would let a failed read
    // masquerade as deletion evidence — the one mistake this verdict must never make.
    const r = wingIssuedStateFrom(observation({ openApiMarkerPresent: false, credentialAnchorPresent: false }));
    expect(r).toEqual({ state: "indeterminate", reason: "THIN_SIGNALS" });
    expect(r.state).not.toBe("not_issued");
  });
});

describe("wingIssuedStateFrom — INDETERMINATE is the absence of evidence, never evidence of the opposite", () => {
  it("no observation at all ⇒ indeterminate", () => {
    expect(wingIssuedStateFrom(null)).toEqual({ state: "indeterminate", reason: "NO_OBSERVATION" });
  });

  it("a surface that cannot answer the question ⇒ indeterminate, never not_issued", () => {
    for (const pageCategory of ["login", "wing_home", "unknown"] as const) {
      const r = wingIssuedStateFrom(observation({ pageCategory, openApiMarkerPresent: true }));
      expect(r, pageCategory).toEqual({ state: "indeterminate", reason: "NOT_OPEN_API_SURFACE" });
    }
  });

  it("an off-target host cannot produce a verdict", () => {
    // Off-target already forces pageCategory `unknown` upstream, so it lands in the same branch — asserted so a
    // future classifier change cannot quietly let a non-WING page answer an issued-state question.
    const off = observation({ pageCategory: "unknown" });
    const r = wingIssuedStateFrom({ ...off, urlCategory: "unknown", signals: { ...off.signals, urlCategory: "unknown" } });
    expect(r.state).toBe("indeterminate");
  });

  it("every verdict is one of the three closed states, with a closed reason", () => {
    const cases = [
      null,
      observation({ credentialAnchorPresent: true }),
      observation({ openApiMarkerPresent: true }),
      observation({}),
      observation({ pageCategory: "login" }),
    ];
    for (const c of cases) {
      const r = wingIssuedStateFrom(c);
      expect(WING_ISSUED_STATES as readonly string[]).toContain(r.state);
      expect(r.reason).toMatch(/^[A-Z_]+$/);
    }
  });
});

describe("wingIssuedStateFrom — value-free and pure", () => {
  it("reads only booleans and the page category — it cannot leak a value", () => {
    const src = wingIssuedStateFrom.toString();
    for (const forbidden of ["textContent", "innerText", "value", "querySelector", "getAttribute"]) {
      expect(src, `must not reference ${forbidden}`).not.toContain(forbidden);
    }
  });

  it("does not mutate the observation it is given", () => {
    const obs = observation({ credentialAnchorPresent: true });
    const before = JSON.stringify(obs);
    wingIssuedStateFrom(obs);
    expect(JSON.stringify(obs)).toBe(before);
  });

  it("is deterministic for the same input", () => {
    const obs = observation({ openApiMarkerPresent: true });
    expect(wingIssuedStateFrom(obs)).toEqual(wingIssuedStateFrom(obs));
  });
});
