/**
 * Tests for `wingIssuedStateFrom` — the derivation that turns a sanitized observation into machine-checkable
 * evidence about whether an open-API key is currently issued.
 *
 * Why it exists: the first live deletion produced `pageCategory: open_api_issuance` BOTH before and after the
 * operator deleted their key (the already-issued page classifies that way via the credential anchor; the
 * post-delete issuance FORM classifies that way via the form marker). The category alone therefore said nothing
 * about the deletion in either direction, and the outcome could only be recorded as operator-attested.
 *
 * IMPORTANT, and corrected after review: the form-marker requirement does NOT make a single reading safe.
 * `classifyWingPage` reaches `open_api_issuance` only when marker-or-anchor is present, so on that category an
 * absent anchor already implies the marker — the guard excludes nothing there and the verdict reduces to
 * `!credentialAnchorPresent`. A late-hydrating page (static shell painted, credential XHR still in flight) will
 * therefore read `not_issued` while the key still exists. What actually closes that is `wingDeletionEvidenceFrom`
 * over TWO independent readings, tested at the bottom of this file; the truncation guard closes the other
 * false-negative (a bounded scan that stopped before reaching the credential heading).
 */
import { describe, it, expect } from "vitest";
import {
  WING_ISSUED_STATES,
  observeFrom,
  wingDeletionEvidenceFrom,
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
    markerScanTruncated: false,
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

  it("holds on the credential_shown surface too — though the classifier cannot actually produce that pair", () => {
    // Honest note: `classifyWingPage` reaches `credential_shown` only when BOTH markers are false, so this
    // combination is hand-built and unreachable from `observeFrom`. It is asserted anyway so that if the
    // classifier ever does route an anchored page here, the verdict does not silently become `indeterminate`.
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

  it("an off-target host cannot produce a verdict — asserted through the REAL classifier, not a hand-built object", () => {
    // A hand-built `{pageCategory:"unknown"}` would only re-test the category branch and would still pass if the
    // upstream off-target guard were deleted. Going through `observeFrom` makes this test depend on the actual
    // defence: `classifyWingPage` forcing `unknown` for a non-WING host.
    const census = {
      passwordFieldPresent: false, submitAffordancePresent: true, formCount: 1,
      editableTextInputCount: 2, readonlyFieldCount: 0, listLikeContainerCount: 2,
      openApiMarkerPresent: true, credentialAnchorPresent: false, markerScanTruncated: false,
    };
    expect(wingIssuedStateFrom(observeFrom("unknown", census)).state).toBe("indeterminate");
    // …while the same census on the real host DOES produce a verdict, so the assertion above is about the host.
    expect(wingIssuedStateFrom(observeFrom("wing_host", census)).state).toBe("not_issued");
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

describe("wingIssuedStateFrom — a TRUNCATED scan cannot produce deletion evidence", () => {
  it("absent anchor + truncated scan ⇒ indeterminate, never not_issued", () => {
    // The marker/anchor scan is bounded. On a large DOM it can stop before reaching the credential heading, so
    // "anchor absent" would mean "not found in the part we looked at" — a false 'deleted' from page size alone.
    const r = wingIssuedStateFrom(observation({ openApiMarkerPresent: true, markerScanTruncated: true }));
    expect(r).toEqual({ state: "indeterminate", reason: "SCAN_TRUNCATED" });
  });

  it("a FOUND anchor is still trusted from a truncated scan — truncation can only hide, never invent", () => {
    const r = wingIssuedStateFrom(observation({ credentialAnchorPresent: true, markerScanTruncated: true }));
    expect(r.state).toBe("issued");
  });
});

describe("wingDeletionEvidenceFrom — one reading is a signal, two agreeing readings are evidence", () => {
  const notIssued = observation({ openApiMarkerPresent: true, credentialAnchorPresent: false });
  const issued = observation({ credentialAnchorPresent: true });

  it("two independent not_issued readings ⇒ confirmed", () => {
    expect(wingDeletionEvidenceFrom([notIssued, notIssued])).toEqual({
      confirmedNotIssued: true, reason: "STABLE_NOT_ISSUED", readingCount: 2,
    });
  });

  it("ONE reading is never enough — a hydration race looks exactly like a deleted key", () => {
    // The failure this prevents: WING paints its static shell (including the issuance heading) before the
    // credential card's XHR resolves. A single read in that window says `not_issued` while the key still exists.
    expect(wingDeletionEvidenceFrom([notIssued])).toEqual({
      confirmedNotIssued: false, reason: "SINGLE_READING_ONLY", readingCount: 1,
    });
    expect(wingDeletionEvidenceFrom([])).toMatchObject({ confirmedNotIssued: false, reason: "SINGLE_READING_ONLY" });
  });

  it("any disagreement withholds the verdict — NOT a majority vote", () => {
    // On an irreversible action "mostly gone" is not a state worth reporting.
    for (const readings of [[notIssued, issued], [notIssued, notIssued, issued], [notIssued, null], [notIssued, observation({})]]) {
      const r = wingDeletionEvidenceFrom(readings);
      expect(r.confirmedNotIssued, JSON.stringify(readings.map((x) => x && x.pageCategory))).toBe(false);
      expect(r.reason).toBe("READINGS_DISAGREE");
    }
  });

  it("readings that are all issued are not 'confirmed deleted' by any reading of the result", () => {
    expect(wingDeletionEvidenceFrom([issued, issued]).confirmedNotIssued).toBe(false);
  });
});
