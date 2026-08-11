/**
 * **The promotion gate for the four guided controls the walk names but cannot point at.**
 *
 * Steps 3 and 4 describe the `OPEN API` option, `확인` and the two consent boxes in prose while the seller looks
 * at a screen with no ring on it. Each has been measured in SOME sense — a derived accessible name, a signature
 * stable across three runs, a transcribed sentence — and none of them in the sense a ring requires, which is one
 * painting element resolved by a query we ship.
 *
 * This file is the thing that stops the gap between those two senses from being closed by an edit. A promotion
 * may only be written down together with the live reading that justifies it: the same standard `issue_final` had
 * to meet on 2026-08-11, and the standard the 삭제 record failed when its `matchCount: 1` turned out to predate
 * the visibility filter.
 */
import { describe, it, expect } from "vitest";
import {
  WING_GUIDED_HIGHLIGHT_TARGETS,
  WING_GUIDED_HIGHLIGHT_PROMOTIONS,
  WING_GUIDED_HIGHLIGHT_EVIDENCE,
  WING_GUIDED_HIGHLIGHT_PHASE,
  WING_CONSENT_PAIRING_LIVE_BASIS,
  WING_TERMS_CHECKBOX_PROMOTION_BLOCKED,
  WING_STAGE2_RECON_CANDIDATES,
  wingGuidedHighlightPromotion,
  wingCandidateSpecById,
  wingScreenMarkerTargets,
  wingDiscoveryScopeGap,
  type WingGuidedHighlightTarget,
  type WingStage2ReconTarget,
} from "../../../src/action-window/coupang-wing-label-recon";
import {
  WING_ISSUANCE_FLOW_DISCOVERY_PHASE,
  discoveryScopeRefusal,
} from "../../../src/cli/probe-wing-issuance-selectors";

const PROMOTED = WING_GUIDED_HIGHLIGHT_PROMOTIONS.filter((p) => p.promoted);
const ALL_CANDIDATE_IDS = Object.values(WING_STAGE2_RECON_CANDIDATES)
  .flat()
  .map((c) => c.id);

describe("the guided-highlight promotion record", () => {
  it("names the measuring phase as a literal, pinned to the CLI's own constant", () => {
    // The leaf cannot import the CLI (the dependency runs the other way), so the string is written twice. This
    // is the assertion that buys what the import would have: a phase renamed in one place fails here rather
    // than producing an evidence record that names a phase nothing runs.
    expect(WING_GUIDED_HIGHLIGHT_PHASE).toBe(WING_ISSUANCE_FLOW_DISCOVERY_PHASE);
  });

  it("has exactly one entry per target, and no entry for anything else", () => {
    expect(WING_GUIDED_HIGHLIGHT_PROMOTIONS.map((p) => p.target)).toEqual([...WING_GUIDED_HIGHLIGHT_TARGETS]);
    for (const t of WING_GUIDED_HIGHLIGHT_TARGETS) expect(wingGuidedHighlightPromotion(t).target).toBe(t);
  });

  it("throws for a target with no entry rather than answering 'not promoted'", () => {
    // A missing entry read as a refusal is the failure mode that matters: it looks exactly like a deliberate
    // decision not to ring something, and it would survive review as one.
    expect(() => wingGuidedHighlightPromotion("nope" as WingGuidedHighlightTarget)).toThrow(/no guided-highlight promotion entry/);
  });

  it("**every promotion is backed by a live reading of the candidate it names, on the screen it names**", () => {
    for (const p of PROMOTED) {
      expect(p.candidateId, p.target).not.toBeNull();
      expect(p.blockedReason, p.target).toBeNull();
      const backing = WING_GUIDED_HIGHLIGHT_EVIDENCE.readings.filter(
        (r) => r.candidateId === p.candidateId && r.screen === p.screen,
      );
      // A reading from another screen is not evidence about this one. Every earlier reading of the key-creation
      // control came from PURPOSE, where it matches one HIDDEN node, and promoting on those would have put the
      // ring on nothing.
      expect(backing.length, `${p.target}: no reading of ${p.candidateId} on ${p.screen}`).toBeGreaterThan(0);
      for (const r of backing) {
        expect(r.visibleCount, p.target).toBe(1);
        // A unique match nobody can see is what invalidated the 삭제 record and refuted the 발급 one.
        expect(r.hiddenCount, p.target).toBe(0);
        // MEASURED, never expected. `role: "button"` entered a calibration record by hand and was wrong.
        expect(r.observedTag, p.target).toBeTruthy();
      }
    }
  });

  it("**a target that is NOT promoted always says why**", () => {
    // Otherwise "no ring here" is indistinguishable from "nobody got round to it", and the difference is the
    // whole content of a fail-closed default.
    for (const p of WING_GUIDED_HIGHLIGHT_PROMOTIONS.filter((x) => !x.promoted)) {
      expect(p.blockedReason, p.target).toBeTruthy();
      // …and it names no candidate, so a half-finished promotion cannot leave a query behind for someone to
      // reach for. This is the "측정 전 임의 selector 승격 금지" rule, mechanized.
      expect(p.candidateId, p.target).toBeNull();
    }
  });

  it("every reading names a REAL shipped candidate, so a rename breaks the record instead of orphaning it", () => {
    for (const r of WING_GUIDED_HIGHLIGHT_EVIDENCE.readings) {
      expect(ALL_CANDIDATE_IDS, r.candidateId).toContain(r.candidateId);
      expect(() => wingCandidateSpecById(r.candidateId)).not.toThrow();
    }
    expect(() => wingCandidateSpecById("stage2.nothing.at.all")).toThrow(/no candidate for id/);
  });

  it("a run identity is on the evidence as soon as anything is promoted", () => {
    // An evidence block with readings and no run identity cannot be re-derived, re-run, or disputed. The nulls
    // are honest only while the readings are empty.
    if (PROMOTED.length > 0 || WING_GUIDED_HIGHLIGHT_EVIDENCE.readings.length > 0) {
      expect(WING_GUIDED_HIGHLIGHT_EVIDENCE.measuredOn).toBeTruthy();
      expect(WING_GUIDED_HIGHLIGHT_EVIDENCE.gitSha).toBeTruthy();
      expect(WING_GUIDED_HIGHLIGHT_EVIDENCE.runId).toBeTruthy();
      expect(WING_GUIDED_HIGHLIGHT_EVIDENCE.approvalId).toBeTruthy();
    }
  });

  it("**a consent ring additionally requires the per-row structural pairing, not the aggregate**", () => {
    // The instruction this encodes: the terms checkboxes have no accessible association, so nothing may claim to
    // know where an individual box is. What IS available is the consent-BLOCK pairing — a consent's box is the
    // single visible checkbox inside the nearest ancestor holding exactly that one sentence.
    //
    // The 2026-08-11 walk proved that pairing held, but only through the fail-closed AGGREGATE conjunction: the
    // per-row verdicts never crossed the page boundary. So the aggregate is a precondition, not the measurement,
    // and a ring drawn from it alone would be pointing with a fact the evidence does not carry.
    const consentPromotions = PROMOTED.filter((p) => p.target === "consent_api" || p.target === "consent_category");
    if (consentPromotions.length > 0) {
      const pairing = WING_GUIDED_HIGHLIGHT_EVIDENCE.consentPairing;
      expect(pairing, "a consent ring needs the per-row consent-block census").not.toBeNull();
      expect(pairing!.consentsCompared).toBeGreaterThanOrEqual(2);
      // Every consent claimed by exactly one box's nearest block. Anything less and the pairing identifies
      // neither consent, which is the `NEAREST_BLOCK_HOLDS_SEVERAL_CONSENTS` verdict's whole point.
      expect(pairing!.consentsMatchedExactlyOnce).toBe(pairing!.consentsCompared);
      expect(pairing!.visibleCheckboxCount).toBe(pairing!.consentsCompared);
      expect(pairing!.ancestorDepths.length).toBe(pairing!.consentsCompared);
      for (const d of pairing!.ancestorDepths) expect(d).toBeGreaterThan(0);
    }
    // The prior basis stays on the record after the census runs — it is what the claim rested on before, and
    // deleting it would erase the distinction the census exists to close.
    expect(WING_GUIDED_HIGHLIGHT_EVIDENCE.priorBasis).toBe(WING_CONSENT_PAIRING_LIVE_BASIS);
    expect(WING_CONSENT_PAIRING_LIVE_BASIS).toContain("PER_ROW_CENSUS_NEVER_RUN");
  });

  it("**no promotion points at a checkbox INPUT** — the association that would justify it does not exist", () => {
    // `WING_TERMS_CHECKBOX_PROMOTION_BLOCKED` records the 2026-08-10 measurement: both boxes read
    // `nameSource: NONE`, `labelForCount: 0`, `ancestorLabelCount: 0`. A ring on the input would be a claim
    // about which box is which, derived from document order — the one fact nobody has measured.
    expect(WING_TERMS_CHECKBOX_PROMOTION_BLOCKED).toBe("NO_ACCESSIBLE_ASSOCIATION_MEASURED_2026_08_10");
    for (const p of PROMOTED) {
      const spec = wingCandidateSpecById(p.candidateId!);
      const tags = spec.candidateQuery.split(",").map((t) => t.trim());
      expect(tags, p.target).not.toContain("input");
      expect(spec.candidateQuery, p.target).not.toMatch(/checkbox/);
    }
  });

  it("what is ringed TODAY, in one line a reviewer can read", () => {
    // Deliberately hardcoded. Every other assertion here is a rule; this one is the state, and it must be
    // edited by the same commit that lands a reading — which is exactly the review moment this unit is about.
    expect(PROMOTED.map((p) => p.target)).toEqual([]);
    expect(WING_GUIDED_HIGHLIGHT_EVIDENCE.readings).toEqual([]);
    expect(WING_GUIDED_HIGHLIGHT_EVIDENCE.consentPairing).toBeNull();
  });
});

describe("the candidates the calibration will measure", () => {
  const byId = (id: string) => Object.values(WING_STAGE2_RECON_CANDIDATES).flat().find((c) => c.id === id)!;
  const tagCount = (id: string) => byId(id).candidateQuery.split(",").length;

  it("every narrowing carries its base candidate's string CHARACTER for character", () => {
    // A narrowing exists to change the QUERY. A narrowing that also retouched the text would be measuring a
    // different hypothesis under a name that says it is the same one — and the trailing period on the consent
    // sentences is exactly the kind of character that gets tidied away.
    for (const [base, narrowed] of [
      ["stage2.confirm.confirm", "stage2.confirm.actionable"],
      ["stage3.terms.api_agree", "stage3.terms.api_agree.label"],
      ["stage3.terms.api_agree", "stage3.terms.api_agree.p"],
      ["stage3.terms.api_agree", "stage3.terms.api_agree.span"],
      ["stage3.terms.api_agree", "stage3.terms.api_agree.div"],
      ["stage3.terms.category_agree", "stage3.terms.category_agree.label"],
      ["stage3.terms.category_agree", "stage3.terms.category_agree.p"],
      ["stage3.terms.category_agree", "stage3.terms.category_agree.span"],
      ["stage3.terms.category_agree", "stage3.terms.category_agree.div"],
    ] as const) {
      expect(byId(narrowed).exactText, narrowed).toBe(byId(base).exactText);
      expect(tagCount(narrowed), narrowed).toBeLessThan(tagCount(base));
    }
  });

  it("the consent narrowings cover EVERY tag family the broad query asks for", () => {
    // The point of sweeping them together: if the broad query's two matches are a wrapper and its inner run,
    // exactly two narrowings return 1 and the pair is a nesting rather than an ambiguity. That reading is only
    // available if no family is left unmeasured.
    for (const base of ["stage3.terms.api_agree", "stage3.terms.category_agree"]) {
      const families = byId(base).candidateQuery.split(",").map((t) => t.trim());
      for (const f of families) {
        expect(byId(`${base}.${f}`), `${base}.${f}`).toBeTruthy();
        expect(byId(`${base}.${f}`).candidateQuery).toBe(f);
      }
    }
  });

  it("the `OPEN API` locate candidates are new, and none of them is the association census's answer", () => {
    // The trap this set is built around. The association census established that radio 0's NAME is `OPEN API`;
    // it walked OUT from the control to whatever named it. A locate walks IN from a query to whatever carries
    // the text, and the two can disagree. So the narrow `label` query is a PRIOR, and the broad one is swept
    // beside it precisely so a count above 1 there is visible rather than assumed away.
    expect(byId("stage2.purpose_open_api.label").exactText).toBe("OPEN API");
    expect(byId("stage2.purpose_open_api.label").candidateQuery).toBe("label");
    expect(tagCount("stage2.purpose_open_api.label")).toBeLessThan(tagCount("stage2.purpose_open_api.broad"));
    for (const id of ["stage2.purpose_open_api.label", "stage2.purpose_open_api.broad", "stage2.purpose_open_api.input"]) {
      expect(byId(id).exactText, id).toBe("OPEN API");
    }
  });

  it("no candidate string is invented — every one of the new labels already existed on the record", () => {
    // The candidate sets may grow with new QUERIES freely; new WORDING is a transcription, and a transcription
    // is a human reading a live screen under an approval. Nothing in this unit had one.
    const knownStrings = new Set([
      "확인",
      "OPEN API",
      "API 이용 약관에 동의합니다.",
      "카테고리 자동 매칭 서비스 이용에 동의합니다.",
    ]);
    for (const id of [
      "stage2.confirm.actionable",
      "stage2.purpose_open_api.label",
      "stage2.purpose_open_api.broad",
      "stage2.purpose_open_api.input",
      "stage3.terms.api_agree.label",
      "stage3.terms.api_agree.p",
      "stage3.terms.api_agree.span",
      "stage3.terms.api_agree.div",
      "stage3.terms.category_agree.label",
      "stage3.terms.category_agree.p",
      "stage3.terms.category_agree.span",
      "stage3.terms.category_agree.div",
    ]) {
      expect(knownStrings, id).toContain(byId(id).exactText);
      // NFC + no exotic whitespace, the two silent-mismatch modes the transcribed labels are already pinned
      // against. A copy that normalizes differently matches nothing and reports a confident absence.
      expect(byId(id).exactText.normalize("NFC")).toBe(byId(id).exactText);
      expect(byId(id).exactText).not.toMatch(/[   -​  　]/);
    }
  });
});

/* ─────────── the scope gap that would burn the sitting this calibration needs ─────────── */

describe("discoveryScopeRefusal — a scope that cannot say which screen it is on", () => {
  const FULL = wingScreenMarkerTargets();

  it("names EVERY target carrying a flow-screen marker, derived rather than listed", () => {
    // `wingFlowScreenFrom` needs all three markers PROBED — a missing row cannot distinguish "not on this
    // screen" from "not asked about". Derived from the marker ids so a marker moving between targets moves
    // this set with it, instead of leaving a hand-written list quietly wrong.
    expect(FULL).toEqual(["purpose", "terms_heading", "terms_issue_final"]);
  });

  it("**refuses BEFORE the browser launches when a marker target is missing**", () => {
    // The gate downstream is correct and fails closed: every reading reads NOT_MEASURED and the run halts on
    // SCREEN_NOT_AS_EXPECTED. It just halts at the SECOND checkpoint — after the operator has logged in,
    // navigated, and pressed `API Key 발급 받기` on a real marketplace. It cannot give the sitting back.
    const refusal = discoveryScopeRefusal(true, ["purpose", "confirm", "terms_heading"]);
    expect(refusal).toContain("terms_issue_final");
    expect(refusal).toContain("No browser launched");
    // …and it tells the operator the scope that would work, rather than only what is wrong with theirs.
    expect(refusal).toContain(FULL.join(","));
  });

  it("passes a complete scope, and narrowing that keeps the markers stays legitimate", () => {
    // Narrowing a discovery run is what the scope is FOR. This refuses only the narrowing that removes the
    // run's ability to say where it is.
    expect(discoveryScopeRefusal(true, [...FULL])).toBeNull();
    expect(discoveryScopeRefusal(true, [...FULL, "confirm", "purpose_open_api"])).toBeNull();
  });

  it("says nothing about a run that is not a discovery run", () => {
    // The other Stage-2 phases take ONE reading of a screen the operator already reached; they never derive a
    // screen and never gate a checkpoint on one.
    expect(discoveryScopeRefusal(false, [])).toBeNull();
  });

  it("the scope THIS unit's calibration needs covers both the markers and the four candidates", () => {
    // The concrete run: the three screen markers, plus the targets carrying the controls being measured.
    const scope: readonly WingStage2ReconTarget[] = [
      "purpose",
      "confirm",
      "terms_heading",
      "terms_api_agree",
      "terms_category_agree",
      "terms_issue_final",
      "purpose_open_api",
    ];
    expect(discoveryScopeRefusal(true, scope)).toBeNull();
    expect(wingDiscoveryScopeGap(scope)).toEqual([]);
    // …and the consent-BLOCK census is taken only when BOTH consent targets are in scope, which is the reading
    // a consent ring is additionally gated on.
    expect(scope).toContain("terms_api_agree");
    expect(scope).toContain("terms_category_agree");
  });
});
