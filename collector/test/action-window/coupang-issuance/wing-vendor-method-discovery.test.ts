/**
 * **The VENDOR-METHOD DISCOVERY phase: the run that asks for the press every earlier manifest promised not to.**
 *
 * `약관 동의 및 Key 발급받기` was believed to create the key, was pressed twice on live walks, and issued none.
 * That measurement is the whole licence for this phase — so the properties worth testing are not about the
 * instrument (it is the discovery phase's, unchanged) but about the boundary that moved and the one that did not:
 * the plan may now cross a control that turned out to be reversible, and it still may not reach the one past it.
 */
import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  WING_CHECKPOINT_EXPECTED_SCREEN,
  WING_FLOW_CHECKPOINTS,
  WING_FLOW_PLANS,
  WING_FLOW_PLAN_IDS,
  WING_FLOW_SCREENS,
  WING_ISSUANCE_FLOW_PLAN,
  WING_KEY_CREATION_CONTROL_ID,
  WING_KEY_ISSUING_CONTROL,
  WING_PURPOSE_SCREEN_MARKER_ID,
  WING_STAGE2_RECON_CANDIDATES,
  WING_STAGE2_RECON_TARGETS,
  WING_STAGE4_VENDOR_METHOD_OPTION_CANDIDATES,
  WING_TERMS_SCREEN_MARKER_IDS,
  WING_VENDOR_METHOD_CHECKPOINTS,
  WING_VENDOR_METHOD_PLAN,
  WING_VENDOR_METHOD_SCREEN_MARKER_IDS,
  WING_VENDOR_METHOD_SCREEN_EVIDENCE,
  WING_KEY_CREATION_CONTROL_REFUTATION,
  WING_KEY_ABSENCE_ATTRIBUTION,
  WING_VENDOR_METHOD_PRODUCT_DECISION,
  WING_VENDOR_FORM_REVEAL,
  wingGuidedHighlightReadingFor,
  WING_VENDOR_METHOD_PROMPT_MARKER_REFUTED,
  WING_GUIDED_HIGHLIGHT_PROMOTIONS,
  WING_CHOICE_LABEL_CANDIDATES,
  WING_VENDOR_METHOD_SCREEN_MARKER_MEASURED,
  WING_VENDOR_METHOD_SCREEN_MARKER_SPECS,
  resolveWingFlowCheckpoints,
  wingCandidateSpecById,
  wingDiscoveryScopeGap,
  wingFlowScreenFrom,
  wingScreenMarkerTargets,
  type WingFlowCheckpoint,
  type WingStage2Presence,
} from "../../../src/action-window/coupang-wing-label-recon";
import {
  WING_ISSUANCE_FLOW_DISCOVERY_PHASE,
  WING_PHASE_FLOW_PLANS,
  WING_STAGE2_LABEL_CALIBRATION_PHASE,
  WING_STAGE2_PHASES,
  WING_STAGE2_RECON_PHASE,
  WING_VENDOR_METHOD_DISCOVERY_PHASE,
  discoveryScopeRefusal,
  runWingFlowDiscovery,
  wingPhaseCalibrates,
  wingPhaseFlowPlan,
  type WingSelectorRecordDeps,
} from "../../../src/cli/probe-wing-issuance-selectors";
import { observeFrom, type WingStructuralCensus } from "../../../src/cli/coupang-wing-classifier";

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = (rel: string): string => readFileSync(resolve(HERE, "../../../src", rel), "utf8");

/* ══════════════════════════ the PLAN, and where each one ends ══════════════════════════ */

describe("two plans, each carrying its own stop", () => {
  it("the vendor plan is the issuance flow plus two — a PREFIX relationship, not a rewrite", () => {
    // "Start at the vendor screen" is not a shorter run; there is no way to be standing on that screen without
    // having advanced through the ones before it, so the plan has to contain them.
    expect(WING_VENDOR_METHOD_PLAN.checkpoints.slice(0, WING_FLOW_CHECKPOINTS.length)).toEqual([
      ...WING_FLOW_CHECKPOINTS,
    ]);
    expect(WING_VENDOR_METHOD_PLAN.checkpoints.slice(WING_FLOW_CHECKPOINTS.length)).toEqual([
      ...WING_VENDOR_METHOD_CHECKPOINTS,
    ]);
    expect(WING_VENDOR_METHOD_PLAN.lastCheckpoint).toBe("VENDOR_METHOD_SELECTED_BY_OPERATOR");
  });

  it("**the issuance plan is UNCHANGED** — a second plan existing does not widen the first", () => {
    // The failure this guards is silent: appending the two new checkpoints to `WING_FLOW_CHECKPOINTS` would have
    // been the shortest way to build this, and it would have widened every grant already described as ending on
    // the terms screen.
    expect(WING_ISSUANCE_FLOW_PLAN.checkpoints).toEqual([...WING_FLOW_CHECKPOINTS]);
    expect(WING_ISSUANCE_FLOW_PLAN.lastCheckpoint).toBe("TERMS_CHECKED_BY_OPERATOR");
    expect(WING_FLOW_CHECKPOINTS).not.toContain("VENDOR_METHOD_SCREEN_UNTOUCHED");
  });

  it("each plan names the control it stops in front of, and only one of them mutates the live account", () => {
    expect(WING_ISSUANCE_FLOW_PLAN.nextControl).toBe(WING_KEY_CREATION_CONTROL_ID);
    // Creates nothing, on the OPERATOR's report. This is the fact the whole phase rests on, and it is a fact
    // about ONE control.
    expect(WING_ISSUANCE_FLOW_PLAN.nextControlMutatesLiveAccount).toBe(false);
    expect(WING_VENDOR_METHOD_PLAN.nextControl).toBe(WING_KEY_ISSUING_CONTROL);
    // Renamed from `nextControlIsIrreversible` on 2026-08-12: the key-issuing 확인 changes live account state,
    // and a separate deletion undoes it. Only the 삭제 phase is irreversible.
    expect(WING_VENDOR_METHOD_PLAN.nextControlMutatesLiveAccount).toBe(true);
    // The key-issuing control is named as an OPERATOR REPORT, not as a candidate id: naming a candidate would
    // claim a locator for it exists, and nothing has read that screen.
    expect(WING_KEY_ISSUING_CONTROL).toContain("OPERATOR_REPORTED_NOT_MEASURED");
    expect(() => wingCandidateSpecById(WING_KEY_ISSUING_CONTROL)).toThrow();
  });

  it("every plan id resolves, and every plan's last checkpoint is its own last entry", () => {
    for (const id of WING_FLOW_PLAN_IDS) {
      const plan = WING_FLOW_PLANS[id];
      expect(plan.id).toBe(id);
      expect(plan.checkpoints[plan.checkpoints.length - 1]).toBe(plan.lastCheckpoint);
    }
  });
});

/* ══════════════════════════ phase → plan ══════════════════════════ */

describe("a phase resolves to its OWN plan, or to none", () => {
  it("is TOTAL over the Stage-2 phases — a missing branch is the failure mode", () => {
    // Both directions matter. A discovery phase falling through to `null` takes one reading under a manifest
    // promising several; a single-reading phase falling through to a plan advances the operator through a flow
    // nobody approved.
    for (const phase of WING_STAGE2_PHASES) {
      expect(Object.prototype.hasOwnProperty.call(WING_PHASE_FLOW_PLANS, phase), phase).toBe(true);
    }
    expect(wingPhaseFlowPlan(WING_STAGE2_RECON_PHASE)).toBeNull();
    expect(wingPhaseFlowPlan(WING_STAGE2_LABEL_CALIBRATION_PHASE)).toBeNull();
    expect(wingPhaseFlowPlan(WING_ISSUANCE_FLOW_DISCOVERY_PHASE)).toBe(WING_ISSUANCE_FLOW_PLAN);
    expect(wingPhaseFlowPlan(WING_VENDOR_METHOD_DISCOVERY_PHASE)).toBe(WING_VENDOR_METHOD_PLAN);
  });

  it("the vendor phase takes the calibration instruments too", () => {
    // The association census is what can say whether 연동업체 선택 / 자체개발(직접입력) are radios with labels or
    // a select's options — which decides whether either could ever be ringed.
    expect(wingPhaseCalibrates(WING_VENDOR_METHOD_DISCOVERY_PHASE)).toBe(true);
  });

  it("the consent-block census is gated on HAVING A PLAN, not on one phase's name", () => {
    // The vendor run walks through the same terms screen. An equality check against the discovery phase would
    // have taken no census on it — the shape that silently downgraded discovery to a bare recon once already.
    const src = SRC("cli/probe-wing-issuance-selectors.ts");
    expect(src).toContain("wingPhaseFlowPlan(phase) !== null && consentInScope");
  });
});

/* ══════════════════════════ resolving a per-run prefix ══════════════════════════ */

describe("resolveWingFlowCheckpoints — against the plan it was given", () => {
  it("defaults to the named plan's whole list, not to the flow's", () => {
    expect(resolveWingFlowCheckpoints(undefined, WING_VENDOR_METHOD_PLAN)).toEqual({
      ok: true,
      checkpoints: [...WING_VENDOR_METHOD_PLAN.checkpoints],
    });
    expect(resolveWingFlowCheckpoints("  ", WING_ISSUANCE_FLOW_PLAN)).toEqual({
      ok: true,
      checkpoints: [...WING_FLOW_CHECKPOINTS],
    });
  });

  it("**refuses a vendor checkpoint under the ISSUANCE plan** — the manifest describes the shorter run", () => {
    const r = resolveWingFlowCheckpoints(
      [...WING_FLOW_CHECKPOINTS, "VENDOR_METHOD_SCREEN_UNTOUCHED"].join(","),
      WING_ISSUANCE_FLOW_PLAN,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toContain("ISSUANCE_FLOW");
      // A COUNT, never the tokens — the env value is whatever was typed.
      expect(r.reason).toContain("1 checkpoint name(s)");
    }
  });

  it("accepts the issuance prefix under the VENDOR plan — ending early is always legitimate", () => {
    const r = resolveWingFlowCheckpoints(WING_FLOW_CHECKPOINTS.join(","), WING_VENDOR_METHOD_PLAN);
    expect(r).toEqual({ ok: true, checkpoints: [...WING_FLOW_CHECKPOINTS] });
  });

  it("still refuses a reordering or a gap, on either plan", () => {
    for (const plan of [WING_ISSUANCE_FLOW_PLAN, WING_VENDOR_METHOD_PLAN]) {
      const r = resolveWingFlowCheckpoints("PURPOSE_SCREEN_UNTOUCHED,AFTER_OPERATOR_CONFIRM", plan);
      expect(r.ok, plan.id).toBe(false);
      if (!r.ok) expect(r.reason).toContain("PREFIX");
    }
    const midStart = resolveWingFlowCheckpoints("VENDOR_METHOD_SCREEN_UNTOUCHED", WING_VENDOR_METHOD_PLAN);
    expect(midStart.ok).toBe(false);
  });
});

/* ══════════════════════════ the VENDOR_METHOD screen ══════════════════════════ */

type Row = { id: string; presence: WingStage2Presence };
const ALL_MARKER_IDS = [
  WING_PURPOSE_SCREEN_MARKER_ID,
  ...WING_TERMS_SCREEN_MARKER_IDS,
  ...WING_VENDOR_METHOD_SCREEN_MARKER_IDS,
];
const allMarkers = (visible: string | null): Row[] =>
  ALL_MARKER_IDS.map((id) => ({
    id,
    presence: (id === visible ? "PRESENT_VISIBLE" : "PRESENT_HIDDEN_ONLY") as WingStage2Presence,
  }));

describe("the vendor screen, identified", () => {
  it("is a screen the vocabulary knows about", () => {
    expect(WING_FLOW_SCREENS).toContain("VENDOR_METHOD");
  });

  it("outranks TERMS when both paint — a precaution whose original reason was falsified", () => {
    // It was ordered first expecting a DIALOG over the terms screen. Measured 2026-08-12: the vendor screen
    // REPLACES it and both terms markers go back to hidden, so this case has never actually occurred. Kept,
    // because the rule it follows — resolve to the screen where stopping is correct — has been right every time.
    const both = allMarkers(null).map((c) =>
      (WING_VENDOR_METHOD_SCREEN_MARKER_IDS as readonly string[]).includes(c.id) ||
      (WING_TERMS_SCREEN_MARKER_IDS as readonly string[]).includes(c.id)
        ? { ...c, presence: "PRESENT_VISIBLE" as const }
        : c,
    );
    expect(wingFlowScreenFrom({ precondition: "OK", faultCount: 0, candidates: both })).toBe("VENDOR_METHOD");
    // EITHER marker alone is sufficient, like the terms pair — a method selection that hid one option must not
    // make the screen unrecognizable.
    for (const id of WING_VENDOR_METHOD_SCREEN_MARKER_IDS) {
      expect(wingFlowScreenFrom({ precondition: "OK", faultCount: 0, candidates: allMarkers(id) }), id).toBe(
        "VENDOR_METHOD",
      );
    }
  });

  it("an UNPROBED vendor marker makes every screen NOT_MEASURED — which is why it is required of every scope", () => {
    // The rule is unchanged: a missing row cannot distinguish "not on this screen" from "not asked about". What
    // is new is that it now applies to a marker the terms-screen phase does not need — and the alternative (a
    // per-screen probed-ness rule) would let a run standing on the vendor screen report TERMS because it never
    // asked.
    const withoutVendor = allMarkers(WING_TERMS_SCREEN_MARKER_IDS[0]!).filter(
      (c) => !(WING_VENDOR_METHOD_SCREEN_MARKER_IDS as readonly string[]).includes(c.id),
    );
    expect(wingFlowScreenFrom({ precondition: "OK", faultCount: 0, candidates: withoutVendor })).toBe("NOT_MEASURED");
    expect(wingScreenMarkerTargets()).toEqual(
      expect.arrayContaining(["vendor_partner", "vendor_self_dev"]),
    );
    // …so a scope missing them is refused BEFORE Chrome, for BOTH discovery phases.
    const gapScope = WING_STAGE2_RECON_TARGETS.filter((t) => t !== "vendor_partner");
    expect(wingDiscoveryScopeGap(gapScope)).toEqual(["vendor_partner"]);
    for (const phase of [WING_ISSUANCE_FLOW_DISCOVERY_PHASE, WING_VENDOR_METHOD_DISCOVERY_PHASE]) {
      const refusal = discoveryScopeRefusal(phase, gapScope);
      expect(refusal, phase).toContain("vendor_partner");
      expect(refusal, phase).toContain(phase);
      expect(refusal, phase).toContain("No browser launched");
    }
    // A phase that takes one reading derives no screen and gates no checkpoint, so it is not refused.
    expect(discoveryScopeRefusal(WING_STAGE2_RECON_PHASE, gapScope)).toBeNull();
    expect(discoveryScopeRefusal(null, gapScope)).toBeNull();
  });

  it("**the markers are the two MEASURED option labels** — the transcribed one was refuted", () => {
    expect(WING_VENDOR_METHOD_SCREEN_MARKER_SPECS.map((s) => s.exactText)).toEqual([
      "연동업체 선택",
      "자체개발(직접입력)",
    ]);
    for (const spec of WING_VENDOR_METHOD_SCREEN_MARKER_SPECS) expect(spec.candidateQuery).toBe("label");
    expect(WING_VENDOR_METHOD_SCREEN_MARKER_MEASURED).toBe(true);
    // The first marker shipped was `업체 입력 방식`, transcribed off the live screen. It matched NOTHING as whole
    // text on any of five readings — including the vendor screen's own — so the run halted at the last
    // checkpoint. The candidate stays in the sweep because the absence is the evidence.
    expect(WING_VENDOR_METHOD_PROMPT_MARKER_REFUTED).toContain("PRESENT_NOT_WHOLE_TEXT_ON_ITS_OWN_SCREEN");
    const refutedSpec = wingCandidateSpecById("stage4.vendor.method_prompt");
    expect(refutedSpec.exactText).toBe("업체 입력 방식");
    expect(WING_VENDOR_METHOD_SCREEN_MARKER_IDS as readonly string[]).not.toContain(refutedSpec.id);
    // The screen's TITLE is excluded, and now for a measured reason: it paints on EVERY screen in the flow.
    const headingSpec = wingCandidateSpecById("stage4.vendor.heading");
    expect(headingSpec.exactText).toBe("OPEN API 키 발급");
    expect(WING_VENDOR_METHOD_SCREEN_MARKER_IDS as readonly string[]).not.toContain(headingSpec.id);
  });

  it("**every vendor reading was taken TWICE**, on the two checkpoints of that screen", () => {
    const e = WING_VENDOR_METHOD_SCREEN_EVIDENCE;
    expect(e.vendorCheckpointsRead).toBe(2);
    for (const r of e.readings) {
      expect(r.screen, r.candidateId).toBe("VENDOR_METHOD");
      expect(r.checkpointsAgreeing, r.candidateId).toBe(2);
    }
    // The sitting BEFORE this one read the screen once and is not folded in — its marker was refuted, so its
    // sixth checkpoint never ran. A record names a run, an approval and a git sha; widening one to cover a
    // second run makes those fields describe only part of what they appear to.
    expect(e.recordId).toBe("wingrec_c7d61cd70f63");
    // Every promotion drawn on this screen cites a row from THIS record.
    const vendorIds = new Set(e.readings.map((r) => r.candidateId));
    for (const p of WING_GUIDED_HIGHLIGHT_PROMOTIONS) {
      if (p.promoted && p.screen === "VENDOR_METHOD") {
        expect(vendorIds.has(p.candidateId ?? ""), `${p.candidateId} has no vendor-screen reading`).toBe(true);
      }
    }
    // The two instruments agreed from opposite directions — the strongest thing on this record, and still one
    // checkpoint. Indices, never wording.
    expect(e.choiceAssociation.rows.map((r) => r.exactCandidateIndex)).toEqual([8, 9]);
    expect(WING_CHOICE_LABEL_CANDIDATES[8]!.exactText).toBe("연동업체 선택");
    expect(WING_CHOICE_LABEL_CANDIDATES[9]!.exactText).toBe("자체개발(직접입력)");
    // …and what it does NOT establish is written down, not left to the absence of a field.
    expect(e.notEstablished).toContain("WHAT_THE_VENDOR_SCREENS_CONFIRM_DOES_NEVER_PRESSED");
    expect(e.notEstablished).toContain("WHICH_OF_THE_TWO_METHODS_THE_OPERATOR_SELECTED");
  });

  it("**the 업체명 · URL · IP reveal is recorded as a finding, and NOT as a locator**", () => {
    // The product owner's original flow description ended with these three fields. `URL` and `IP 주소` read
    // hidden on every screen of every run for three days, and painted for the first time on the checkpoint after
    // a method was selected. The account was right end to end.
    expect(WING_VENDOR_FORM_REVEAL.candidateIds).toEqual(["stage2.vendor_url.url", "stage2.call_ip.ip_addr"]);
    expect(WING_VENDOR_FORM_REVEAL.atCheckpoint).toBe("VENDOR_METHOD_SELECTED_BY_OPERATOR");
    // ONE checkpoint. The reveal is the finding; the locators are not, and nothing may ring them.
    expect(WING_VENDOR_FORM_REVEAL.checkpointsAgreeing).toBe(1);
    expect(WING_VENDOR_FORM_REVEAL.promotable).toBe(false);
    for (const id of WING_VENDOR_FORM_REVEAL.candidateIds) {
      expect(wingGuidedHighlightReadingFor(id, "VENDOR_METHOD"), id).toBeUndefined();
    }
  });

  it("**the method choice is recorded as a PRODUCT DECISION**, with what it does not rest on", () => {
    const d = WING_VENDOR_METHOD_PRODUCT_DECISION;
    expect(d.basis).toBe("PRODUCT_DECISION_NOT_A_MEASUREMENT");
    expect(d.decidedBy).toBe("PRODUCT_OWNER");
    // The ringed candidate is resolved by id, never re-typed — and its text IS the decided method.
    expect(wingCandidateSpecById(d.candidateId).exactText).toBe(d.method);
    // The alternative is measured to the same standard and simply not chosen. What would have to be established
    // for it is an EXTERNAL fact nothing here can read.
    expect(wingGuidedHighlightReadingFor(d.notChosenCandidateId, "VENDOR_METHOD")?.visibleCount).toBe(1);
    expect(d.unmeasuredForTheAlternative).toBe("WHETHER_SELLEROPS_IS_IN_COUPANGS_VENDOR_LIST");
  });

  it("the checkpoint that ASKS for the press expects TERMS, so an unmatched marker cannot cost the sweep", () => {
    // The expectation is checked against the PREVIOUS reading. If it expected VENDOR_METHOD, a wrong marker
    // would halt the run BEFORE the vendor screen's own sweep — losing the one reading the sitting is for.
    expect(WING_CHECKPOINT_EXPECTED_SCREEN.VENDOR_METHOD_SCREEN_UNTOUCHED).toBe("TERMS");
    expect(WING_CHECKPOINT_EXPECTED_SCREEN.VENDOR_METHOD_SELECTED_BY_OPERATOR).toBe("VENDOR_METHOD");
  });
});

/* ══════════════════════════ candidates ══════════════════════════ */

describe("the vendor screen's candidates", () => {
  const ids = Object.values(WING_STAGE2_RECON_CANDIDATES)
    .flat()
    .map((c) => c.id);

  it("are APPENDED, so an earlier run's records still read back by id", () => {
    const targets = [...WING_STAGE2_RECON_TARGETS];
    expect(targets.slice(-4)).toEqual([
      "vendor_method_heading",
      "vendor_method_prompt",
      "vendor_partner",
      "vendor_self_dev",
    ]);
  });

  it("reuse the existing targets for 업체명 / 취소 / 확인 rather than duplicating their strings", () => {
    // A second target carrying a duplicate `exactText` is how the purpose heading's drift got measured as
    // absent. A reading is stamped with its SCREEN, so the same candidate on a new screen is already a new row.
    const texts = Object.values(WING_STAGE2_RECON_CANDIDATES)
      .flat()
      .filter((c) => ["업체명", "취소", "확인"].includes(c.exactText))
      .map((c) => c.id);
    for (const id of texts) expect(id.startsWith("stage4.")).toBe(false);
  });

  it("carry a broad sibling beside each narrowing, which is what makes a narrow 1 a finding", () => {
    for (const stem of ["stage4.vendor.partner", "stage4.vendor.self_dev"]) {
      expect(ids).toContain(`${stem}.label`);
      expect(ids).toContain(`${stem}.broad`);
      const narrow = wingCandidateSpecById(`${stem}.label`);
      const broad = wingCandidateSpecById(`${stem}.broad`);
      expect(narrow.exactText).toBe(broad.exactText);
      expect(broad.candidateQuery.split(",").length).toBeGreaterThan(narrow.candidateQuery.split(",").length);
      // `option` is in the broad query on purpose: this may be a select's placeholder rather than a radio's
      // label, and that distinction decides whether it can be ringed at all.
      expect(broad.candidateQuery).toContain("option");
    }
  });

  it("the option labels are APPENDED to the census list, leaving every earlier INDEX unmoved", () => {
    expect(WING_STAGE4_VENDOR_METHOD_OPTION_CANDIDATES.map((c) => c.exactText)).toEqual([
      "연동업체 선택",
      "자체개발(직접입력)",
    ]);
    for (const c of WING_STAGE4_VENDOR_METHOD_OPTION_CANDIDATES) expect(c.provenance).toBe("OPERATOR_TRANSCRIBED");
  });

  it("every id is unique", () => {
    expect(new Set(ids).size).toBe(ids.length);
  });
});

/* ══════════════════════════ the runner's hard stop ══════════════════════════ */

const CENSUS: WingStructuralCensus = {
  passwordFieldPresent: false,
  submitAffordancePresent: false,
  dialogLikePresent: false,
  choiceControlCount: 2,
  actionControlCount: 3,
  formCount: 2,
  editableTextInputCount: 6,
  readonlyFieldCount: 0,
  listLikeContainerCount: 5,
  markerScanTruncated: false,
  openApiMarkerPresent: false,
  credentialAnchorPresent: true,
};

/** A fake WING with THREE screens: purpose, terms, then the vendor dialog over it. */
function fakeVendorFlow(over: { vendorFrom?: number; termsFrom?: number } = {}) {
  const asked: WingFlowCheckpoint[] = [];
  let reads = 0;
  let waits = 0;
  const termsFrom = over.termsFrom ?? 3;
  const vendorFrom = over.vendorFrom ?? 5;
  const PURPOSE_TEXT = "키의 사용 목적을 골라주세요";
  const TERMS_TEXT = "약관 동의 및 Key 발급받기";
  // The two MEASURED markers — the option labels. The transcribed `업체 입력 방식` never matched anything.
  const VENDOR_TEXTS = ["연동업체 선택", "자체개발(직접입력)"];
  const paints = (t: string): boolean => {
    if (VENDOR_TEXTS.includes(t)) return reads >= vendorFrom;
    // The terms markers keep painting behind the dialog, which is the case the precedence exists for.
    if (t === TERMS_TEXT) return reads >= termsFrom;
    if (t === PURPOSE_TEXT) return reads < termsFrom;
    return false;
  };
  const deps: WingSelectorRecordDeps = {
    waitForReady: async () => {
      waits += 1;
      return "ready";
    },
    observeSurface: async () => {
      reads += 1;
      return observeFrom("wing_host", CENSUS);
    },
    probeTarget: async () => {
      throw new Error("a discovery run probes no shipped locator");
    },
    probeCandidate: async (spec) =>
      paints(spec.exactText) ? { matchCount: 1, canHighlight: true } : { matchCount: 0, canHighlight: false },
    // The CONTAINMENT reading is what `presence` is derived from under a calibrating phase — and this phase
    // calibrates. A fake that answered only `probeCandidate` would make every marker read ABSENT_EVERYWHERE.
    probeContainment: async (spec) =>
      paints(spec.exactText)
        ? { exactVisible: 1, exactHidden: 0, deepestContainsVisible: 1, deepestContainsHidden: 0, scanTruncated: false }
        : { exactVisible: 0, exactHidden: 0, deepestContainsVisible: 0, deepestContainsHidden: 0, scanTruncated: false },
    choiceAssociationCensus: async (candidates) => ({
      visibleChoiceControlCount: 2,
      hiddenChoiceControlCount: 0,
      rows: [],
      rowsTruncated: false,
      nameGroupCount: 1,
      largestNameGroupSize: 2,
      ungroupedCount: 0,
      scanTruncated: false,
      candidatesCompared: candidates.length,
    }),
    announceCheckpoint: (c) => {
      asked.push(c);
    },
  };
  return { deps, asked, waits: () => waits };
}

const ALL_TARGETS = [...WING_STAGE2_RECON_TARGETS] as const;

describe("runWingFlowDiscovery under the vendor plan", () => {
  it("runs all six checkpoints and reads the vendor screen as VENDOR_METHOD", async () => {
    const { deps, asked } = fakeVendorFlow();
    const r = await runWingFlowDiscovery(deps, {
      targets: ALL_TARGETS,
      phase: WING_VENDOR_METHOD_DISCOVERY_PHASE,
    });
    expect(asked).toEqual([...WING_VENDOR_METHOD_PLAN.checkpoints]);
    expect(r.halted).toBeNull();
    expect(r.readings.map((x) => x.screen)).toEqual([
      "PURPOSE",
      "PURPOSE",
      "TERMS",
      "TERMS",
      "VENDOR_METHOD",
      "VENDOR_METHOD",
    ]);
    expect(r.agentSelections).toBe(0);
  });

  it("**an unmatched vendor marker keeps the vendor screen's own sweep** and halts one checkpoint later", async () => {
    // The marker has never been matched by anything. This is the expected failure, and what it costs is the
    // SECOND vendor reading — never the first, which carries the screen's full candidate sweep.
    const { deps } = fakeVendorFlow({ vendorFrom: 99 });
    const r = await runWingFlowDiscovery(deps, {
      targets: ALL_TARGETS,
      phase: WING_VENDOR_METHOD_DISCOVERY_PHASE,
    });
    expect(r.readings).toHaveLength(5);
    expect(r.readings[4]!.checkpoint).toBe("VENDOR_METHOD_SCREEN_UNTOUCHED");
    expect(r.halted).toBe("SCREEN_NOT_AS_EXPECTED");
    expect(r.screenMismatch).toEqual({
      checkpoint: "VENDOR_METHOD_SELECTED_BY_OPERATOR",
      expected: "VENDOR_METHOD",
      actual: "TERMS",
    });
  });

  it("**THROWS rather than running a seventh checkpoint** — the next press issues a real key", async () => {
    const { deps } = fakeVendorFlow();
    await expect(
      runWingFlowDiscovery(deps, {
        targets: ALL_TARGETS,
        phase: WING_VENDOR_METHOD_DISCOVERY_PHASE,
        checkpoints: [...WING_VENDOR_METHOD_PLAN.checkpoints, "VENDOR_METHOD_SELECTED_BY_OPERATOR"],
      }),
    ).rejects.toThrow(/ISSUES A REAL KEY and needs its own mode-WRITE approval/);
  });

  it("the ISSUANCE plan still throws at ITS end, with ITS reason — the stop travels with the plan", async () => {
    const { deps } = fakeVendorFlow();
    await expect(
      runWingFlowDiscovery(deps, {
        targets: ALL_TARGETS,
        phase: WING_ISSUANCE_FLOW_DISCOVERY_PHASE,
        checkpoints: [...WING_FLOW_CHECKPOINTS, "VENDOR_METHOD_SCREEN_UNTOUCHED"],
      }),
    ).rejects.toThrow(
      new RegExp(`no checkpoint may follow TERMS_CHECKED_BY_OPERATOR in the ISSUANCE_FLOW plan.*${WING_KEY_CREATION_CONTROL_ID}`),
    );
  });

  it("**refuses a phase that runs no plan** rather than inheriting the issuance flow's checkpoints", async () => {
    const { deps } = fakeVendorFlow();
    await expect(
      runWingFlowDiscovery(deps, { targets: ALL_TARGETS, phase: WING_STAGE2_RECON_PHASE }),
    ).rejects.toThrow(/runs no checkpoint plan/);
  });
});

/* ══════════════════════════ what the operator is told ══════════════════════════ */

describe("the instructions the operator reads", () => {
  const CLI_SRC = SRC("cli/probe-wing-issuance-selectors.ts");

  it("**the vendor checkpoint attributes the no-key claim to the OPERATOR**, not to a measurement", () => {
    // The justification for asking anyone to press this control. It read "MEASURED not to create a key" in
    // eight places until the 2026-08-12 audit: the apparatus cannot discriminate an issued surface from a
    // no-key one, so nothing it captured ever said that. Two operator reports is the best evidence here, and
    // rounding it up to "measured" is the same shape as the label-derived claim it replaced.
    const branch = CLI_SRC.slice(CLI_SRC.indexOf('checkpoint === "VENDOR_METHOD_SCREEN_UNTOUCHED"'));
    const body = branch.slice(0, branch.indexOf('checkpoint === "VENDOR_METHOD_SELECTED_BY_OPERATOR"'));
    expect(body).toContain("the OPERATOR reported no key either time");
    expect(body).toContain("SellerOps cannot corroborate it");
    expect(body).not.toContain("MEASURED not to create a key");
    expect(body).toContain("NEVER been read by any apparatus");
    // …and it names the control on the NEXT screen that creates the key, in the same breath.
    expect(body).toContain("issues a real API key");
  });

  it("the LAST checkpoint refuses the press that would issue the key, and says a grant cannot be assumed", () => {
    const branch = CLI_SRC.slice(CLI_SRC.indexOf('checkpoint === "VENDOR_METHOD_SELECTED_BY_OPERATOR"'));
    const body = branch.slice(0, branch.indexOf("} else {"));
    expect(body).toContain("DO NOT press '확인'");
    expect(body).toContain("REAL API KEY");
    expect(body).toContain("SEPARATE manifest");
    // The product decision is NOT made here, and the instruction says so rather than nudging.
    expect(body).toContain("product decision");
  });

  it("**the terms instruction stops forbidding the press when the plan continues past it**", () => {
    // Printing one plan's prohibition against another plan's very next step is how a bootstrap once told the
    // operator the opposite of the manifest they were about to read.
    const branch = CLI_SRC.slice(CLI_SRC.indexOf('checkpoint === "TERMS_CHECKED_BY_OPERATOR"'));
    const body = branch.slice(0, branch.indexOf('checkpoint === "VENDOR_METHOD_SCREEN_UNTOUCHED"'));
    expect(body).toContain("const last = index + 1 === total");
    expect(body).toContain("the next checkpoint asks for it");
  });
});

/* ══════════════════════════ the manifest ══════════════════════════ */

describe("the manifest the operator approves", () => {
  const MANIFEST_SRC = SRC("cli/approval-manifest.ts");
  const CLI_SRC = SRC("cli/approval-manifest-cli.ts");

  it("the phase is in EVERY list a WING phase has to be in", () => {
    // The WING phase list exists because three separate `phase === … ||` chains had accumulated and a fourth
    // phase added to two of the three was screened against the wrong host.
    for (const list of ["CALIBRATION_PHASES", "WING_PHASES", "WING_STAGE2_MANIFEST_PHASES", "ENTRYPOINT_PHASES"]) {
      const start = MANIFEST_SRC.indexOf(`export const ${list}`);
      expect(start, list).toBeGreaterThan(-1);
      const body = MANIFEST_SRC.slice(start, MANIFEST_SRC.indexOf("];", start));
      expect(body, list).toContain("COUPANG_WING_VENDOR_METHOD_DISCOVERY");
    }
  });

  it("the OPERATION text names the key-issuing control and refuses to recommend a method", () => {
    const branch = CLI_SRC.slice(CLI_SRC.indexOf("isWingVendorMethod\n    ? `WING VENDOR-METHOD DISCOVERY"));
    const operation = branch.slice(0, branch.indexOf("\n    : isWingGuidedWalk"));
    expect(operation).toContain("ISSUES A REAL API KEY");
    expect(operation).toContain("separate mode-WRITE grant");
    expect(operation).toContain("no checkpoint of this phase stands in front of it");
    // The press it DOES ask for is justified by the measurement, never by the button's label — which is exactly
    // what the refuted claim was justified by.
    expect(operation).toContain("the OPERATOR reported no key either time");
    expect(operation).toContain("rests on that REPORT");
    expect(operation).toContain("The report is not a measurement");
    expect(operation).toContain("PRODUCT DECISION");
  });

  it("the OPERATOR SUMMARY — the copy at the keyboard — carries the same two facts", () => {
    const start = MANIFEST_SRC.indexOf("COUPANG_WING_VENDOR_METHOD_DISCOVERY: {\n    entrypointType");
    const entry = MANIFEST_SRC.slice(start, MANIFEST_SRC.indexOf("emitsFrontendUrl: false", start));
    expect(entry).toContain("판매자가 키가 발급되지 않았다고 보고했습니다");
    expect(entry).toContain("측정이 아니라 보고입니다");
    expect(entry).not.toContain("이미 측정되었습니다");
    expect(entry).toContain("실제 API 키를 발급해 라이브 계정 상태를 바꾸는 control");
    expect(entry).not.toContain("되돌릴 수 없");
    expect(entry).toContain("별도 manifest");
    expect(entry).toContain("측정이 아니라 제품 결정");
  });

  it("the agent's own budget is still zero, and the phase still allows no highlight", () => {
    const start = MANIFEST_SRC.indexOf("COUPANG_WING_VENDOR_METHOD_DISCOVERY: {\n    phase:");
    const spec = MANIFEST_SRC.slice(start, MANIFEST_SRC.indexOf("},", MANIFEST_SRC.indexOf("mode:", start)));
    expect(spec).toContain("allowsHighlight: false");
    expect(spec).toContain('mode: "READ_ONLY"');
  });
});

/* ══════════════════════════ the epistemic audit, machine-checked ══════════════════════════ */

describe("every vendor-method claim is filed under what actually supports it", () => {
  it("**no promotion cites the run whose confirmations were fabricated**", () => {
    // 2026-08-12: a checkpoint was advanced on a `3번 됐어` that the operator never sent — Claude generated the
    // user text. That run (`wingrec_0653cb92f342` / `apr-87fb0614a39f`) halted at checkpoint 4 and is cited
    // NOWHERE. The promotions rest on `wingrec_c7d61cd70f63`, whose six sentinels the operator created directly.
    const SRC_DIR = resolve(HERE, "../../../src");
    const files = ["action-window/coupang-wing-label-recon.ts", "cli/approval-manifest.ts", "cli/approval-manifest-cli.ts"];
    for (const f of files) {
      const src = readFileSync(resolve(SRC_DIR, f), "utf8");
      for (const tainted of ["wingrec_0653cb92f342", "apr-87fb0614a39f", "wt-587eb18e72f3"]) {
        expect(src, `${f} cites the fabricated-confirmation run`).not.toContain(tainted);
      }
    }
    expect(WING_VENDOR_METHOD_SCREEN_EVIDENCE.recordId).toBe("wingrec_c7d61cd70f63");
  });

  it("**'no key was issued' is the OPERATOR's report**, and the record says so", () => {
    // The apparatus cannot corroborate it. `wingIssuedStateFrom` returns NO_DISCRIMINATING_SIGNAL, and that is
    // itself a MEASURED result — every sanitized signal is identical on an issued and a no-key surface. The
    // field sat un-attributed beside `revealedScreenAttribution`, which is how the claim came to be repeated as
    // "MEASURED not to create a key" in eight operator-facing places.
    expect(WING_KEY_CREATION_CONTROL_REFUTATION.keyIssued).toBe(false);
    expect(WING_KEY_CREATION_CONTROL_REFUTATION.keyIssuedAttribution).toBe(WING_KEY_ABSENCE_ATTRIBUTION);
    expect(WING_KEY_ABSENCE_ATTRIBUTION).toContain("APPARATUS_CANNOT_DISCRIMINATE");
  });

  it("**no source or harness rounds that report up to a measurement**", () => {
    const roots = [resolve(HERE, "../../../src"), resolve(HERE, "../../../../tools/coupang-local")];
    const forbidden = ["MEASURED not to create a key", "MEASURED to create no key", "measured to issue no key", "이미 측정되었습니다"];
    for (const root of roots) {
      // grep exits 1 on "no match", which is the PASSING case here.
      let out = "";
      try {
        out = execFileSync("grep", ["-rl", ...forbidden.flatMap((f) => ["-e", f]), root], { encoding: "utf8" }).trim();
      } catch {
        out = "";
      }
      expect(out, `a file still calls the operator report a measurement:\n${out}`).toBe("");
    }
  });

  it("**the key-ISSUING boundary is still operator-reported**, and nothing claims otherwise", () => {
    // What two checkpoints measured is the SCREEN — that it exists, what it is made of, and that its 확인
    // resolves to one painting BUTTON. That pressing it creates the key is the operator's account of a press
    // nothing has performed. The WRITE run is what will settle it.
    expect(WING_KEY_ISSUING_CONTROL).toContain("OPERATOR_REPORTED_NOT_MEASURED");
    expect(WING_VENDOR_METHOD_SCREEN_EVIDENCE.notEstablished).toContain(
      "WHAT_THE_VENDOR_SCREENS_CONFIRM_DOES_NEVER_PRESSED",
    );
  });

  it("**the URL/IP reveal is not stretched to cover 업체명, nor to a particular method**", () => {
    // 업체명 was ALREADY painting on the untouched vendor screen; only these two appeared on selection. And only
    // one method was ever selected — which one is not on the record.
    expect(WING_VENDOR_FORM_REVEAL.candidateIds).toEqual(["stage2.vendor_url.url", "stage2.call_ip.ip_addr"]);
    expect(WING_VENDOR_FORM_REVEAL.candidateIds as readonly string[]).not.toContain("stage2.vendor_info.baseline");
    expect(wingGuidedHighlightReadingFor("stage2.vendor_info.baseline", "VENDOR_METHOD")?.checkpointsAgreeing).toBe(2);
    expect(WING_VENDOR_METHOD_SCREEN_EVIDENCE.notEstablished).toContain("WHICH_OF_THE_TWO_METHODS_THE_OPERATOR_SELECTED");
  });
});
