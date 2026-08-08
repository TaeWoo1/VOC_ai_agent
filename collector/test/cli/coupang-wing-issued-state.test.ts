/**
 * Tests for `wingIssuedStateFrom` — the derivation that was supposed to tell an issued WING account from one
 * with no key, and which is now deliberately incapable of doing so.
 *
 * **The defect these lock is a wrong answer on real data.** The verdict used to return `issued` whenever
 * `credentialAnchorPresent` was true. On 2026-08-08 the operator stood in front of a genuine post-delete no-key
 * issuance form and the probe read `credentialAnchorPresent: true` — the no-key form carries the fixed text
 * "Access Key" as well. So the anchor is a proven false positive for issued-state, and the account was NOT
 * still holding a key; the deletion was fine.
 *
 * What replaced it is nothing, on purpose. The comparative audit of the only two real captures shows every
 * signal recorded on BOTH sides is identical, and the four that might discriminate (readonly / editable / form
 * counts, submit affordance) were never TRANSCRIBED from the issued-page run — they were measured and printed,
 * but the output is not in the repo. Either way they are not in hand, so a predicate written today would be
 * inventing the issued-page side. `indeterminate` removes a wrong answer instead of guessing a right one.
 *
 * These tests therefore assert the ABSENCE of a verdict, and — more importantly — pin the evidence that would
 * be needed to restore one, so that "we still cannot tell" stays a measured statement rather than a habit.
 */
import { describe, it, expect } from "vitest";
import {
  WING_ISSUED_STATES,
  WING_REAL_EVIDENCE_ISSUED_2026_08_07,
  WING_REAL_EVIDENCE_NO_KEY_2026_08_08,
  corroborationVerdictFor,
  observeFrom,
  wingDeletionEvidenceFrom,
  wingIssuedStateFrom,
  type WingObservation,
  type WingPageCategory,
  type WingRealEvidence,
  type WingSignals,
  type WingStructuralCensus,
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

/** Rebuild an observation from a recorded real capture, through the REAL classifier where the data allows. */
function observationFromEvidence(e: WingRealEvidence): WingObservation {
  const census: WingStructuralCensus = {
    passwordFieldPresent: false,
    submitAffordancePresent: e.buckets.submitAffordancePresent ?? false,
    formCount: 1,
    editableTextInputCount: e.buckets.editableTextInputCountBucket === "many" ? 50 : 1,
    readonlyFieldCount: e.buckets.readonlyFieldCountBucket === "none" ? 0 : 3,
    listLikeContainerCount: e.buckets.listLikeContainerCountBucket === "many" ? 50 : 1,
    openApiMarkerPresent: e.openApiMarkerPresent,
    credentialAnchorPresent: e.credentialAnchorPresent,
    markerScanTruncated: e.buckets.markerScanTruncated ?? false,
  };
  return observeFrom("wing_host", census);
}

describe("the real captures — the audit inputs, as data", () => {
  it("both real surfaces classify as the SAME page category — the category cannot answer the question", () => {
    for (const e of [WING_REAL_EVIDENCE_ISSUED_2026_08_07, WING_REAL_EVIDENCE_NO_KEY_2026_08_08]) {
      expect(observationFromEvidence(e).pageCategory, e.recordIds.join()).toBe("open_api_issuance");
    }
  });

  it("the credential anchor is TRUE on both — the proven false positive, asserted from the record", () => {
    expect(WING_REAL_EVIDENCE_ISSUED_2026_08_07.credentialAnchorPresent).toBe(true);
    expect(WING_REAL_EVIDENCE_NO_KEY_2026_08_08.credentialAnchorPresent).toBe(true);
    // …and the no-key surface is operator-confirmed, which is what makes it a false positive rather than a
    // failed deletion. If this attestation is ever weakened, the whole correction loses its grounding.
    expect(WING_REAL_EVIDENCE_NO_KEY_2026_08_08.surface).toBe("no_key_issuance_form");
    expect(WING_REAL_EVIDENCE_NO_KEY_2026_08_08.surfaceAttestation).toBe("OPERATOR_CONFIRMED");
  });

  it("the form marker is FALSE on both — it discriminates nothing and remains unvalidated", () => {
    expect(WING_REAL_EVIDENCE_ISSUED_2026_08_07.openApiMarkerPresent).toBe(false);
    expect(WING_REAL_EVIDENCE_NO_KEY_2026_08_08.openApiMarkerPresent).toBe(false);
  });

  it("self_dev and call_ip matched 0 on BOTH — so they are wrong labels, not form-only controls", () => {
    // This retires a specific claim from the 2026-08-06 calibration doc: that these two are "form-only controls,
    // matchCount=0 on the already-issued page". The real form gives 0 as well, so absence there was never
    // evidence of form-only-ness — and the "coherent already-issued shape" conclusion drawn from it is void.
    for (const e of [WING_REAL_EVIDENCE_ISSUED_2026_08_07, WING_REAL_EVIDENCE_NO_KEY_2026_08_08]) {
      expect(e.targetMatchCounts.self_dev, e.recordIds.join()).toBe(0);
      expect(e.targetMatchCounts.call_ip, e.recordIds.join()).toBe(0);
    }
  });

  it("the issued capture RETAINS no buckets — the reason a discriminator cannot be written from what we hold", () => {
    // Corrected after review: the buckets WERE measured on 2026-08-06 (the census emitted them and the CLI
    // printed the whole observation) — they were simply never transcribed, and the run output is not in the
    // repo. `bucketsRetained` says exactly that. Claiming "unmeasured" would have been the same
    // unmeasured-vs-measured-zero conflation this unit exists to correct.
    expect(WING_REAL_EVIDENCE_ISSUED_2026_08_07.bucketsRetained).toBe(false);
    expect(Object.keys(WING_REAL_EVIDENCE_ISSUED_2026_08_07.buckets)).toHaveLength(0);
    expect(WING_REAL_EVIDENCE_NO_KEY_2026_08_08.bucketsRetained).toBe(true);
  });

  it("every target count names the run it came from — the issued row is a UNION of two differently-scoped runs", () => {
    // A reader auditing `wingrec_c01e673ebc61` (approved scope: ["delete"]) must not be sent looking for five
    // counts that a different run produced.
    const e = WING_REAL_EVIDENCE_ISSUED_2026_08_07;
    expect(e.recordIds.length).toBe(2);
    for (const k of Object.keys(e.targetMatchCounts)) {
      expect(e.recordIds, k).toContain(e.targetMatchCountSource[k as keyof typeof e.targetMatchCountSource]);
    }
    expect(e.targetMatchCountSource.delete).toBe("wingrec_c01e673ebc61");
    expect(e.targetMatchCountSource.issue).not.toBe("wingrec_c01e673ebc61");
  });

  it("every signal recorded on BOTH sides is equal — the audit conclusion, computed not asserted", () => {
    const a = WING_REAL_EVIDENCE_ISSUED_2026_08_07;
    const b = WING_REAL_EVIDENCE_NO_KEY_2026_08_08;
    expect(a.pageCategory).toBe(b.pageCategory);
    expect(a.credentialAnchorPresent).toBe(b.credentialAnchorPresent);
    expect(a.openApiMarkerPresent).toBe(b.openApiMarkerPresent);
    // Target counts: equal where they discriminate nothing; vendor_info differs by one (9 vs 8) but is
    // non-unique on both, so it separates nothing either.
    expect(a.targetMatchCounts.issue).toBe(b.targetMatchCounts.issue);
    expect((a.targetMatchCounts.vendor_info ?? 0) > 1 && (b.targetMatchCounts.vendor_info ?? 0) > 1).toBe(true);
  });
});

describe("wingIssuedStateFrom — the anchor can no longer produce a verdict", () => {
  it("REGRESSION: the real no-key form does NOT read as issued", () => {
    // The exact wrong answer this unit exists to remove.
    const r = wingIssuedStateFrom(observationFromEvidence(WING_REAL_EVIDENCE_NO_KEY_2026_08_08));
    expect(r.state).not.toBe("issued");
    expect(r).toEqual({ state: "indeterminate", reason: "NO_DISCRIMINATING_SIGNAL" });
  });

  it("the real ISSUED page also yields no verdict — the fix is symmetric, not a flip", () => {
    // A "fix" that simply inverted the anchor would pass the regression above and be just as wrong. Both real
    // surfaces must be indeterminate, because nothing recorded tells them apart.
    const r = wingIssuedStateFrom(observationFromEvidence(WING_REAL_EVIDENCE_ISSUED_2026_08_07));
    expect(r).toEqual({ state: "indeterminate", reason: "NO_DISCRIMINATING_SIGNAL" });
  });

  it("no combination of anchor and marker can produce issued or not_issued", () => {
    for (const credentialAnchorPresent of [true, false]) {
      for (const openApiMarkerPresent of [true, false]) {
        const r = wingIssuedStateFrom(observation({ credentialAnchorPresent, openApiMarkerPresent }));
        expect(r.state, `anchor=${credentialAnchorPresent} marker=${openApiMarkerPresent}`).toBe("indeterminate");
      }
    }
  });

  it("nor can any combination of the structural buckets — they have no measured issued-page side", () => {
    // Guards against someone reaching for the buckets as a discriminator without capturing the other side.
    for (const readonlyFieldCountBucket of ["none", "few", "many"] as const) {
      for (const editableTextInputCountBucket of ["none", "few", "many"] as const) {
        for (const submitAffordancePresent of [true, false]) {
          const r = wingIssuedStateFrom(
            observation({ readonlyFieldCountBucket, editableTextInputCountBucket, submitAffordancePresent,
              credentialAnchorPresent: true }),
          );
          expect(r.state).toBe("indeterminate");
        }
      }
    }
  });

  it("an ambiguous mixed structure is indeterminate, and says so with the honest reason", () => {
    const r = wingIssuedStateFrom(observation({
      credentialAnchorPresent: true, openApiMarkerPresent: true,
      readonlyFieldCountBucket: "few", editableTextInputCountBucket: "many",
    }));
    expect(r).toEqual({ state: "indeterminate", reason: "NO_DISCRIMINATING_SIGNAL" });
  });
});

describe("wingIssuedStateFrom — the surviving distinctions still work", () => {
  it("a surface that cannot answer the question reports NOT_OPEN_API_SURFACE, not the generic reason", () => {
    for (const pageCategory of ["login", "wing_home", "unknown"] as const) {
      expect(wingIssuedStateFrom(observation({ pageCategory })), pageCategory).toEqual({
        state: "indeterminate", reason: "NOT_OPEN_API_SURFACE",
      });
    }
  });

  it("an off-target host cannot produce a verdict — through the REAL classifier, not a hand-built object", () => {
    const census: WingStructuralCensus = {
      passwordFieldPresent: false, submitAffordancePresent: true, formCount: 1,
      editableTextInputCount: 2, readonlyFieldCount: 0, listLikeContainerCount: 2,
      openApiMarkerPresent: true, credentialAnchorPresent: false, markerScanTruncated: false,
    };
    expect(wingIssuedStateFrom(observeFrom("unknown", census)).reason).toBe("NOT_OPEN_API_SURFACE");
    expect(wingIssuedStateFrom(observeFrom("wing_host", census)).reason).toBe("NO_DISCRIMINATING_SIGNAL");
  });

  it("a TRUNCATED scan is reported distinctly from a complete-but-undiscriminating one", () => {
    // Both are indeterminate, but they are not the same problem: truncation may improve with a better read,
    // while NO_DISCRIMINATING_SIGNAL needs new evidence. Collapsing them would hide which is which in a record.
    expect(wingIssuedStateFrom(observation({ markerScanTruncated: true })).reason).toBe("SCAN_TRUNCATED");
    expect(wingIssuedStateFrom(observation({ markerScanTruncated: false })).reason).toBe("NO_DISCRIMINATING_SIGNAL");
  });

  it("a truncated scan produces no verdict in EITHER direction", () => {
    for (const credentialAnchorPresent of [true, false]) {
      const r = wingIssuedStateFrom(observation({ markerScanTruncated: true, credentialAnchorPresent }));
      expect(r.state).toBe("indeterminate");
    }
  });

  it("no observation at all ⇒ indeterminate / NO_OBSERVATION", () => {
    expect(wingIssuedStateFrom(null)).toEqual({ state: "indeterminate", reason: "NO_OBSERVATION" });
  });

  it("every verdict is one of the three closed states with a closed reason", () => {
    for (const c of [null, observation({ credentialAnchorPresent: true }), observation({ pageCategory: "login" })]) {
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

  it("does not mutate the observation, and is deterministic", () => {
    const obs = observation({ credentialAnchorPresent: true });
    const before = JSON.stringify(obs);
    expect(wingIssuedStateFrom(obs)).toEqual(wingIssuedStateFrom(obs));
    expect(JSON.stringify(obs)).toBe(before);
  });

  it("the recorded evidence carries no text, value or PII — counts, booleans and enums only", () => {
    for (const e of [WING_REAL_EVIDENCE_ISSUED_2026_08_07, WING_REAL_EVIDENCE_NO_KEY_2026_08_08]) {
      const serialized = JSON.stringify(e);
      for (const forbidden of ["http", "coupang.com", "Secret", "업체코드", "/Users/"]) {
        expect(serialized, e.recordIds.join()).not.toContain(forbidden);
      }
      for (const v of Object.values(e.targetMatchCounts)) expect(typeof v).toBe("number");
    }
  });
});

describe("corroborationVerdictFor — the rule itself, tested directly because nothing can reach it", () => {
  // Review found that hardcoding `allNotIssued = false` inside the rule passed the ENTIRE suite: with
  // `not_issued` no longer emitted, the confirming branch is unreachable through `wingDeletionEvidenceFrom`,
  // and `main`'s test for it was removed along with the falsified expectations. A rule nothing executes is a
  // rule a refactor deletes silently — so it is exercised here over states directly.
  it("two agreeing not_issued readings ⇒ confirmed (the branch the public entrypoint can no longer reach)", () => {
    expect(corroborationVerdictFor(["not_issued", "not_issued"])).toEqual({
      confirmedNotIssued: true, reason: "STABLE_NOT_ISSUED", readingCount: 2,
    });
  });

  it("any disagreement withholds the verdict — NOT a majority vote", () => {
    for (const states of [
      ["not_issued", "issued"], ["not_issued", "not_issued", "issued"], ["not_issued", "indeterminate"],
    ] as const) {
      expect(corroborationVerdictFor(states), states.join("+")).toEqual({
        confirmedNotIssued: false, reason: "READINGS_DISAGREE", readingCount: states.length,
      });
    }
  });

  it("fewer than two readings is never enough — including zero", () => {
    expect(corroborationVerdictFor([])).toEqual({
      confirmedNotIssued: false, reason: "SINGLE_READING_ONLY", readingCount: 0,
    });
    expect(corroborationVerdictFor(["not_issued"])).toEqual({
      confirmedNotIssued: false, reason: "SINGLE_READING_ONLY", readingCount: 1,
    });
  });

  it("all-issued readings are never reported as confirmed-deleted", () => {
    expect(corroborationVerdictFor(["issued", "issued"]).confirmedNotIssued).toBe(false);
  });
});

describe("wingDeletionEvidenceFrom — the rule survives; its input does not", () => {
  it("cannot confirm a deletion from ANY readings, because no reading can say not_issued", () => {
    const noKey = observationFromEvidence(WING_REAL_EVIDENCE_NO_KEY_2026_08_08);
    for (const readings of [[noKey, noKey], [noKey, noKey, noKey], [noKey, null]]) {
      const r = wingDeletionEvidenceFrom(readings);
      expect(r.confirmedNotIssued, JSON.stringify(r)).toBe(false);
    }
  });

  it("a single reading is still short of the corroboration bar — the rule is intact for when input returns", () => {
    expect(wingDeletionEvidenceFrom([observation({})])).toMatchObject({
      confirmedNotIssued: false, reason: "SINGLE_READING_ONLY", readingCount: 1,
    });
  });

  it("two readings report READINGS_DISAGREE rather than a confident false — 'unavailable', not 'no'", () => {
    // The distinction a caller depends on: nothing here may be read as "the key is still there".
    const r = wingDeletionEvidenceFrom([observation({}), observation({})]);
    expect(r).toEqual({ confirmedNotIssued: false, reason: "READINGS_DISAGREE", readingCount: 2 });
  });
});
