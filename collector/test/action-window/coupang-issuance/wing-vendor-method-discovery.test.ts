/**
 * **The VENDOR-METHOD DISCOVERY phase: the run that asks for the press every earlier manifest promised not to.**
 *
 * `약관 동의 및 Key 발급받기` was believed to create the key, was pressed twice on live walks, and issued none.
 * That measurement is the whole licence for this phase — so the properties worth testing are not about the
 * instrument (it is the discovery phase's, unchanged) but about the boundary that moved and the one that did not:
 * the plan may now cross a control that turned out to be reversible, and it still may not reach the one past it.
 */
import { describe, expect, it } from "vitest";
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
  WING_VENDOR_METHOD_SCREEN_MARKER_ID,
  WING_VENDOR_METHOD_SCREEN_MARKER_MEASURED,
  WING_VENDOR_METHOD_SCREEN_MARKER_SPEC,
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

  it("each plan names the control it stops in front of, and only one of them is irreversible", () => {
    expect(WING_ISSUANCE_FLOW_PLAN.nextControl).toBe(WING_KEY_CREATION_CONTROL_ID);
    // MEASURED reversible. This is the fact the whole phase rests on, and it is a fact about ONE control.
    expect(WING_ISSUANCE_FLOW_PLAN.nextControlIsIrreversible).toBe(false);
    expect(WING_VENDOR_METHOD_PLAN.nextControl).toBe(WING_KEY_ISSUING_CONTROL);
    expect(WING_VENDOR_METHOD_PLAN.nextControlIsIrreversible).toBe(true);
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
const allMarkers = (visible: string | null): Row[] =>
  [WING_PURPOSE_SCREEN_MARKER_ID, ...WING_TERMS_SCREEN_MARKER_IDS, WING_VENDOR_METHOD_SCREEN_MARKER_ID].map((id) => ({
    id,
    presence: (id === visible ? "PRESENT_VISIBLE" : "PRESENT_HIDDEN_ONLY") as WingStage2Presence,
  }));

describe("the vendor screen, identified", () => {
  it("is a screen the vocabulary knows about", () => {
    expect(WING_FLOW_SCREENS).toContain("VENDOR_METHOD");
  });

  it("**outranks TERMS when both paint** — it is reported as a dialog OVER the terms screen", () => {
    const both = allMarkers(null).map((c) =>
      c.id === WING_VENDOR_METHOD_SCREEN_MARKER_ID || (WING_TERMS_SCREEN_MARKER_IDS as readonly string[]).includes(c.id)
        ? { ...c, presence: "PRESENT_VISIBLE" as const }
        : c,
    );
    expect(wingFlowScreenFrom({ precondition: "OK", faultCount: 0, candidates: both })).toBe("VENDOR_METHOD");
  });

  it("an UNPROBED vendor marker makes every screen NOT_MEASURED — which is why it is required of every scope", () => {
    // The rule is unchanged: a missing row cannot distinguish "not on this screen" from "not asked about". What
    // is new is that it now applies to a marker the terms-screen phase does not need — and the alternative (a
    // per-screen probed-ness rule) would let a run standing on the vendor screen report TERMS because it never
    // asked.
    const withoutVendor = allMarkers(WING_TERMS_SCREEN_MARKER_IDS[0]!).filter(
      (c) => c.id !== WING_VENDOR_METHOD_SCREEN_MARKER_ID,
    );
    expect(wingFlowScreenFrom({ precondition: "OK", faultCount: 0, candidates: withoutVendor })).toBe("NOT_MEASURED");
    expect(wingScreenMarkerTargets()).toContain("vendor_method_prompt");
    // …so a scope missing it is refused BEFORE Chrome, for BOTH discovery phases.
    const gapScope = WING_STAGE2_RECON_TARGETS.filter((t) => t !== "vendor_method_prompt");
    expect(wingDiscoveryScopeGap(gapScope)).toEqual(["vendor_method_prompt"]);
    for (const phase of [WING_ISSUANCE_FLOW_DISCOVERY_PHASE, WING_VENDOR_METHOD_DISCOVERY_PHASE]) {
      const refusal = discoveryScopeRefusal(phase, gapScope);
      expect(refusal, phase).toContain("vendor_method_prompt");
      expect(refusal, phase).toContain(phase);
      expect(refusal, phase).toContain("No browser launched");
    }
    // A phase that takes one reading derives no screen and gates no checkpoint, so it is not refused.
    expect(discoveryScopeRefusal(WING_STAGE2_RECON_PHASE, gapScope)).toBeNull();
    expect(discoveryScopeRefusal(null, gapScope)).toBeNull();
  });

  it("**exactly ONE marker**, and the screen's title is deliberately not it", () => {
    // This screen sorts FIRST, so a marker that paints earlier in the flow would make every reading of the whole
    // run report VENDOR_METHOD. The title `OPEN API 키 발급` is one 오픈/OPEN away from the walk's own first page.
    expect(WING_VENDOR_METHOD_SCREEN_MARKER_SPEC.exactText).toBe("업체 입력 방식");
    const headingSpec = wingCandidateSpecById("stage4.vendor.heading");
    expect(headingSpec.exactText).toBe("OPEN API 키 발급");
    expect(headingSpec.id).not.toBe(WING_VENDOR_METHOD_SCREEN_MARKER_ID);
    // Never matched by anything. Auto-advance built on it must degrade to the seller's own advance.
    expect(WING_VENDOR_METHOD_SCREEN_MARKER_MEASURED).toBe(false);
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
  formCount: 1,
  inputCount: 4,
  buttonCount: 6,
  linkCount: 20,
  tableCount: 1,
  headingCount: 3,
  maskedFieldCount: 0,
  choiceControlCount: 2,
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
  const VENDOR_TEXT = "업체 입력 방식";
  const paints = (t: string): boolean => {
    if (t === VENDOR_TEXT) return reads >= vendorFrom;
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

  it("the vendor checkpoint says the press is MEASURED not to create a key, and why that matters", () => {
    const branch = CLI_SRC.slice(CLI_SRC.indexOf('checkpoint === "VENDOR_METHOD_SCREEN_UNTOUCHED"'));
    const body = branch.slice(0, branch.indexOf('checkpoint === "VENDOR_METHOD_SELECTED_BY_OPERATOR"'));
    expect(body).toContain("MEASURED not to create a key");
    expect(body).toContain("NEVER been read by any apparatus");
    // …and it names the control on the NEXT screen that is the irreversible one, in the same breath.
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

  it("the OPERATION text names the irreversible control and refuses to recommend a method", () => {
    const branch = CLI_SRC.slice(CLI_SRC.indexOf("isWingVendorMethod\n    ? `WING VENDOR-METHOD DISCOVERY"));
    const operation = branch.slice(0, branch.indexOf("\n    : isWingGuidedWalk"));
    expect(operation).toContain("ISSUES A REAL API KEY");
    expect(operation).toContain("separate mode-WRITE grant");
    expect(operation).toContain("no checkpoint of this phase stands in front of it");
    // The press it DOES ask for is justified by the measurement, never by the button's label — which is exactly
    // what the refuted claim was justified by.
    expect(operation).toContain("issued NO key either time");
    expect(operation).toContain("PRODUCT DECISION");
  });

  it("the OPERATOR SUMMARY — the copy at the keyboard — carries the same two facts", () => {
    const start = MANIFEST_SRC.indexOf("COUPANG_WING_VENDOR_METHOD_DISCOVERY: {\n    entrypointType");
    const entry = MANIFEST_SRC.slice(start, MANIFEST_SRC.indexOf("emitsFrontendUrl: false", start));
    expect(entry).toContain("키를 만들지 않는 것이 이미 측정되었습니다");
    expect(entry).toContain("실제 API 키를 발급하는(되돌릴 수 없는) control");
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
