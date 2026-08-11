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
  interpretWingStage2Recon,
  WING_GUIDED_HIGHLIGHT_HIDDEN_TWIN_POLICY,
  wingScreenMarkerTargets,
  wingConfirmGateTargets,
  wingDiscoveryRequiredTargets,
  wingDiscoveryScopeGap,
  type WingGuidedHighlightTarget,
  type WingStage2ReconTarget,
} from "../../../src/action-window/coupang-wing-label-recon";
import {
  WING_ISSUANCE_FLOW_DISCOVERY_PHASE,
  WING_STAGE2_RECON_PHASE,
  discoveryScopeRefusal,
  runWingSelectorRecord,
  stage2RecordFor,
} from "../../../src/cli/probe-wing-issuance-selectors";
import { observeFrom } from "../../../src/cli/coupang-wing-classifier";

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
        // The whole bar: ONE painting match. A unique match nobody can see is what invalidated the 삭제 record
        // and refuted the 발급 one, and the visibility filter is what excludes it.
        expect(r.visibleCount, p.target).toBe(1);
        // MEASURED, never expected. `role: "button"` entered a calibration record by hand and was wrong.
        expect(r.observedTag, p.target).toBeTruthy();
        // …and reproduced. One observation is a reading; two agreeing checkpoints of the same screen is what
        // separates a measurement from a moment. It is NOT a cross-session stability claim and none is made.
        expect(r.checkpointsAgreeing, p.target).toBeGreaterThanOrEqual(2);
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

  it("**a hidden twin is recorded as fragility and is NOT a bar** — and the record shows which rings carry one", () => {
    // The bar read `hiddenCount === 0` for half a day, which was an over-generalisation from ONE reading:
    // the key-creation control happened to measure `hidden: 0` on TERMS and measures `hidden: 1` on PURPOSE, so
    // the same clause would have refused it on the other screen. A hidden twin is excluded from the candidate
    // set before the count is taken, so it cannot be what a ring lands on — the visibility filter is the guard,
    // and this count is the diagnostic that made the 발급 failure legible.
    expect(WING_GUIDED_HIGHLIGHT_HIDDEN_TWIN_POLICY).toBe("RECORDED_AS_FRAGILITY_NOT_A_PROMOTION_BAR");
    // Recorded, not zeroed away: three of the four promoted rings sit beside a hidden twin, and a reviewer can
    // see which. If one ever paints the locate returns 2 and the step fails closed — a recoverable park with
    // the seller's own control still on screen, never a misplaced ring.
    const promotedReadings = PROMOTED.map((p) =>
      WING_GUIDED_HIGHLIGHT_EVIDENCE.readings.find((r) => r.candidateId === p.candidateId && r.screen === p.screen)!,
    );
    expect(promotedReadings.filter((r) => r.hiddenCount > 0)).toHaveLength(3);
    for (const r of promotedReadings) expect(Number.isInteger(r.hiddenCount)).toBe(true);
  });

  it("**each narrowing is legible** — its broad sibling is on the record beside it", () => {
    // Four bare `visibleCount: 1` rows would say nothing about WHY the shipped query is the narrow one. The
    // broad siblings are what make each promotion checkable: `.broad` measuring 2 is why `label` is a
    // disambiguation, and the consent sentences measuring 2 visible each is why their narrowings are a nesting.
    const byId = (id: string) => WING_GUIDED_HIGHLIGHT_EVIDENCE.readings.find((r) => r.candidateId === id)!;
    expect(byId("stage2.purpose_open_api.broad").visibleCount).toBe(2);
    expect(byId("stage3.terms.api_agree").visibleCount).toBe(2);
    expect(byId("stage3.terms.category_agree").visibleCount).toBe(2);
    // 확인 is the exception, and the record says so rather than leaving it to be assumed: the broad query
    // resolved to the SAME element (identical signature), so nothing needed disambiguating on this page.
    expect(byId("stage2.confirm.confirm").sig16).toBe(byId("stage2.confirm.actionable").sig16);
    expect(byId("stage2.confirm.confirm").visibleCount).toBe(1);
  });

  it("what is ringed TODAY, in one line a reviewer can read", () => {
    // Deliberately hardcoded. Every other assertion here is a rule; this one is the state, and it must be
    // edited by the same commit that lands a reading — which is exactly the review moment this unit is about.
    expect(PROMOTED.map((p) => p.target)).toEqual(["purpose_open_api", "confirm", "consent_api", "consent_category"]);
    expect(PROMOTED.map((p) => p.candidateId)).toEqual([
      "stage2.purpose_open_api.label",
      "stage2.confirm.actionable",
      "stage3.terms.api_agree.label",
      "stage3.terms.category_agree.label",
    ]);
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

describe("discoveryScopeRefusal — a scope that cannot finish the flow it is measuring", () => {
  const FULL = wingDiscoveryRequiredTargets();

  it("names EVERY target carrying a flow-screen marker, derived rather than listed", () => {
    // `wingFlowScreenFrom` needs EVERY marker PROBED — a missing row cannot distinguish "not on this
    // screen" from "not asked about". Derived from the marker ids so a marker moving between targets moves
    // this set with it, instead of leaving a hand-written list quietly wrong.
    //
    // The VENDOR marker is required of THIS phase too, which does not reach that screen. It has to be: the
    // requirement is that the screen be IDENTIFIABLE, and a run that could not tell the seller had moved on to
    // the vendor screen would report the terms screen — the screen it expects — while they stood somewhere else.
    expect(wingScreenMarkerTargets()).toEqual([
      "purpose",
      "terms_heading",
      "terms_issue_final",
      "vendor_method_prompt",
    ]);
  });

  it("**…and every target the 확인 advisory reads, which is the half that cost a live sitting**", () => {
    // Learned the expensive way on 2026-08-11. A scope carrying the screen markers plus the four controls
    // being calibrated passed the marker check and then halted at CONFIRM_ADVISORY_STOP / STOP_NOT_MEASURED,
    // after the operator had logged in, pressed 발급 and confirmed the purpose option — because
    // `wingConfirmAdvisory` reads the vendor-form rows and they were not in the sweep. The guard that had just
    // been added covered one gate and left its sibling standing.
    expect(wingConfirmGateTargets()).toEqual(["vendor_info", "vendor_url", "call_ip"]);
    // The requirement is the UNION of the two gates, in canonical order — not a list either of them owns.
    expect(FULL).toEqual([
      "purpose",
      "vendor_info",
      "vendor_url",
      "call_ip",
      "terms_heading",
      "terms_issue_final",
      "vendor_method_prompt",
    ]);
  });

  it("**refuses BEFORE the browser launches when a required target is missing**", () => {
    // The gates downstream are correct and fail closed. They just fail at the second or third checkpoint —
    // after the operator has logged in, navigated, and pressed `API Key 발급 받기` on a real marketplace.
    const refusal = discoveryScopeRefusal(WING_ISSUANCE_FLOW_DISCOVERY_PHASE, ["purpose", "confirm", "terms_heading"]);
    expect(refusal).toContain("terms_issue_final");
    expect(refusal).toContain("vendor_info");
    expect(refusal).toContain("No browser launched");
    // …and it tells the operator the scope that would work, rather than only what is wrong with theirs.
    expect(refusal).toContain(FULL.join(","));
  });

  it("passes a complete scope, and narrowing that keeps the markers stays legitimate", () => {
    // Narrowing a discovery run is what the scope is FOR. This refuses only the narrowing that removes the
    // run's ability to say where it is.
    expect(discoveryScopeRefusal(WING_ISSUANCE_FLOW_DISCOVERY_PHASE, [...FULL])).toBeNull();
    expect(discoveryScopeRefusal(WING_ISSUANCE_FLOW_DISCOVERY_PHASE, [...FULL, "confirm", "purpose_open_api"])).toBeNull();
  });

  it("says nothing about a run that is not a discovery run", () => {
    // The other Stage-2 phases take ONE reading of a screen the operator already reached; they never derive a
    // screen and never gate a checkpoint on one.
    expect(discoveryScopeRefusal(WING_STAGE2_RECON_PHASE, [])).toBeNull();
  });

  it("the scope THIS unit's calibration needs covers both the markers and the four candidates", () => {
    // The concrete run: the three screen markers, plus the targets carrying the controls being measured.
    const scope: readonly WingStage2ReconTarget[] = [
      "purpose",
      "self_dev",
      "vendor_info",
      "vendor_url",
      "call_ip",
      "confirm",
      "terms_heading",
      "terms_api_agree",
      "terms_category_agree",
      "terms_cancel",
      "terms_issue_final",
      "purpose_open_api",
      "vendor_method_prompt",
    ];
    expect(discoveryScopeRefusal(WING_ISSUANCE_FLOW_DISCOVERY_PHASE, scope)).toBeNull();
    expect(wingDiscoveryScopeGap(scope)).toEqual([]);
    // …and the consent-BLOCK census is taken only when BOTH consent targets are in scope, which is the reading
    // a consent ring is additionally gated on.
    expect(scope).toContain("terms_api_agree");
    expect(scope).toContain("terms_category_agree");
  });
});

/* ─────────── the measured tag, which the sweep used to drop on the floor ─────────── */

describe("the recon row carries the MEASURED tag", () => {
  it("**a unique match's tag survives the fold** — a promotion may not cite an expected one", () => {
    // The locate script has returned `tag` since the 발급 recalibration, and this seam dropped it. So every
    // candidate a Stage-2 sweep measured could only ever have justified a promotion from `WING_TARGET_EXPECTED_
    // ROLE` — the exact substitution that put `role: "button"` on a record nobody had measured.
    const [folded] = interpretWingStage2Recon(["confirm"], [
      { targetId: "stage2.confirm.actionable", matchCount: 1, sig: "abc123abc123abcd", hiddenCount: 0, tag: "BUTTON" },
    ]);
    const row = folded!.candidates.find((c) => c.id === "stage2.confirm.actionable")!;
    expect(row.verdict).toBe("UNIQUE");
    expect(row.observedTag).toBe("BUTTON");
    expect(row.hiddenMatchCount).toBe(0);
  });

  it("a tag is null when the count is not 1 — there is no 'the match' to have a tag", () => {
    const [folded] = interpretWingStage2Recon(["confirm"], [
      { targetId: "stage2.confirm.confirm", matchCount: 2, tag: "DIV" },
    ]);
    expect(folded!.candidates[0]!.observedTag).toBeNull();
  });

  it("a reading that carried NO tag stays null, never a guess", () => {
    const [folded] = interpretWingStage2Recon(["confirm"], [
      { targetId: "stage2.confirm.actionable", matchCount: 1, sig: "abc123abc123abcd" },
    ]);
    const row = folded!.candidates.find((c) => c.id === "stage2.confirm.actionable")!;
    expect(row.verdict).toBe("UNIQUE");
    expect(row.observedTag).toBeNull();
  });

  it("two readings of one candidate that DISAGREE on the tag are NOT_MEASURED, like any other disagreement", () => {
    // The conflict shape is per-field for a reason: two rows agreeing on the count while disagreeing on what
    // they measured is precisely the case where the last one silently wins.
    const [folded] = interpretWingStage2Recon(["confirm"], [
      { targetId: "stage2.confirm.actionable", matchCount: 1, tag: "BUTTON" },
      { targetId: "stage2.confirm.actionable", matchCount: 1, tag: "A" },
    ]);
    const row = folded!.candidates.find((c) => c.id === "stage2.confirm.actionable")!;
    expect(row.verdict).toBe("NOT_MEASURED");
    expect(row.observedTag).toBeNull();
  });
});

/* ─────────── the tag's whole journey, asserted at the artefact rather than per layer ─────────── */

describe("the MEASURED tag survives every layer between the page and the record", () => {
  /**
   * The tag was dropped at FOUR separate seams — `probeCandidate`'s type, the sweep's raw row, the fold, and the
   * emitted record — and each of those layers had passing tests throughout. That is the argument for asserting
   * it here, at the only artefact a live sitting leaves behind: a per-layer test cannot see a field that the
   * NEXT layer discards, and four of them in a row did not.
   */
  function deps(observedTag: string | undefined) {
    return {
      waitForReady: async () => "ready" as const,
      observeSurface: async () =>
        observeFrom("wing_host", {
          passwordFieldPresent: false,
          submitAffordancePresent: false,
          dialogLikePresent: false,
          choiceControlCount: 2,
          actionControlCount: 3,
          formCount: 1,
          editableTextInputCount: 0,
          readonlyFieldCount: 0,
          listLikeContainerCount: 1,
          markerScanTruncated: false,
          openApiMarkerPresent: true,
          credentialAnchorPresent: true,
        }),
      probeTarget: async () => ({ matchCount: 0, canHighlight: false }),
      probeCandidate: async () => ({
        matchCount: 1,
        canHighlight: true,
        sig: "abc123abc123abcd",
        hiddenMatchCount: 0,
        ...(observedTag ? { observedTag } : {}),
      }),
    };
  }

  async function rowFor(observedTag: string | undefined) {
    const r = await runWingSelectorRecord(deps(observedTag), [], { stage2: ["confirm"] });
    const rec = stage2RecordFor(r.stage2)!;
    return rec.targets[0]!.candidates.find((c) => c.id === "stage2.confirm.actionable")!;
  }

  it("**reaches the emitted record** — the artefact a promotion is written from", async () => {
    const row = await rowFor("BUTTON");
    expect(row.canHighlight).toBe(true);
    expect(row.observedTag).toBe("BUTTON");
  });

  it("sits beside the EXPECTED role rather than being substituted for it", async () => {
    // The original defect in one line: a record carrying an expectation and not the measurement reads like
    // evidence. Stage-2 targets have no shipped locator, so the expectation is explicitly not applicable —
    // and the measurement is a separate field that either holds a reading or holds null.
    const row = await rowFor("BUTTON");
    expect(row.expectedRole).toBe("NOT_APPLICABLE_NO_SHIPPED_LOCATOR");
    expect(row.observedTag).not.toBe(row.expectedRole);
  });

  it("stays null when the page never reported one — an absent reading is never filled in", async () => {
    const row = await rowFor(undefined);
    expect(row.canHighlight).toBe(true);
    expect(row.observedTag).toBeNull();
  });
});
