/**
 * **The ISSUANCE-FLOW DISCOVERY phase: the first WING run in which the operator changes marketplace state.**
 *
 * Everything else in this workstream has been a reading of a screen someone else reached. This one asks the
 * operator to advance the flow, which means the properties worth testing are not about what the agent measures
 * — that is unchanged — but about what the run is willing to ASK FOR, and when it refuses to ask.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  WING_CONFIRM_ADVISORIES,
  WING_FLOW_CHECKPOINTS,
  WING_FLOW_HALT_REASONS,
  WING_VENDOR_FORM_CANDIDATE_IDS,
  WING_PURPOSE_SCREEN_MARKER_ID,
  WING_TERMS_SCREEN_MARKER_IDS,
  WING_CHECKPOINT_EXPECTED_SCREEN,
  WING_TERMS_CHECKBOX_PROMOTION_BLOCKED,
  wingFlowScreenFrom,
  resolveWingFlowCheckpoints,
  WING_FLOW_LAST_CHECKPOINT,
  WING_KEY_CREATION_CONTROL_ID,
  WING_CHOICE_LABEL_CANDIDATES,
  WING_STAGE3_TERMS_OPTION_CANDIDATES,
  WING_STAGE2_RECON_CANDIDATES,
  WING_STAGE2_RECON_TARGETS,
  wingConfirmAdvisory,
  wingRevealedBetween,
  type WingFlowCheckpoint,
  type WingStage2Presence,
} from "../../../src/action-window/coupang-wing-label-recon";
import {
  WING_ISSUANCE_FLOW_DISCOVERY_PHASE,
  WING_STAGE2_LABEL_CALIBRATION_PHASE,
  WING_STAGE2_PHASES,
  WING_STAGE2_RECON_PHASE,
  runWingFlowDiscovery,
  wingPhaseCalibrates,
  type WingSelectorRecordDeps,
} from "../../../src/cli/probe-wing-issuance-selectors";
import { observeFrom, WING_PROBE_TARGET_NAMES, type WingStructuralCensus } from "../../../src/cli/coupang-wing-classifier";
import {
  CALIBRATION_PHASES,
  WING_STAGE2_MANIFEST_PHASES,
  WING_PHASES,
  PHASE_ENTRYPOINTS,
  PHASE_SPECS,
} from "../../../src/cli/approval-manifest";

const HERE = dirname(fileURLToPath(import.meta.url));

/* ══════════════════════════ the 확인 gate ══════════════════════════ */

type Row = { id: string; presence: WingStage2Presence };

/** The screen markers, in the state that identifies one screen or the other. */
const markers = (screen: "PURPOSE" | "TERMS" | "NEITHER"): Row[] => [
  { id: WING_PURPOSE_SCREEN_MARKER_ID, presence: screen === "PURPOSE" ? "PRESENT_VISIBLE" : "PRESENT_HIDDEN_ONLY" },
  ...WING_TERMS_SCREEN_MARKER_IDS.map((id) => ({
    id,
    presence: (screen === "TERMS" ? "PRESENT_VISIBLE" : "PRESENT_HIDDEN_ONLY") as WingStage2Presence,
  })),
];

/** A complete PURPOSE-screen reading with the vendor labels in the given state. */
const vendorSeen = (presence: WingStage2Presence): Row[] => [
  ...markers("PURPOSE"),
  ...WING_VENDOR_FORM_CANDIDATE_IDS.map((id) => ({ id, presence })),
];

describe("wingConfirmAdvisory — may the run INVITE the 확인 press?", () => {
  it("advances only when every vendor-form label is measured and none of them PAINTS", () => {
    // The reading the previous three runs actually produced on the purpose screen: the vendor labels match
    // hidden nodes only. That is the whole basis for believing 확인 advances rather than submits.
    expect(
      wingConfirmAdvisory({ precondition: "OK", faultCount: 0, candidates: vendorSeen("PRESENT_HIDDEN_ONLY") }),
    ).toBe("ADVANCE_FORM_NOT_YET_REVEALED");
    for (const p of ["ABSENT_EVERYWHERE", "PRESENT_NOT_WHOLE_TEXT", "ABSENT_WITHIN_SCAN_BOUND"] as const) {
      expect(wingConfirmAdvisory({ precondition: "OK", faultCount: 0, candidates: vendorSeen(p) })).toBe(
        "ADVANCE_FORM_NOT_YET_REVEALED",
      );
    }
  });

  it("STOPS when ANY vendor label is already on screen — 확인 would submit a form, not open one", () => {
    // The case that makes this function worth having. If 업체명 / URL / IP are visible when the option is
    // selected, the flow description's "확인 comes last" reading is the live one, and pressing it may create a
    // key. One visible label is enough; they do not have to agree.
    for (const id of WING_VENDOR_FORM_CANDIDATE_IDS) {
      const candidates = vendorSeen("PRESENT_HIDDEN_ONLY").map((c) =>
        c.id === id ? { ...c, presence: "PRESENT_VISIBLE" as const } : c,
      );
      expect(wingConfirmAdvisory({ precondition: "OK", faultCount: 0, candidates }), id).toBe(
        "STOP_FORM_ALREADY_VISIBLE",
      );
    }
  });

  it("STOPS on anything unmeasured — a page it could not read never authorizes a press", () => {
    const ok = vendorSeen("PRESENT_HIDDEN_ONLY");
    // A failed precondition: the sweep took no candidate rows at all.
    expect(wingConfirmAdvisory({ precondition: "NO_VISIBLE_CHOICE_CONTROL", faultCount: 0, candidates: ok })).toBe(
      "STOP_NOT_MEASURED",
    );
    expect(wingConfirmAdvisory({ precondition: "NOT_OBSERVED", faultCount: 0, candidates: ok })).toBe("STOP_NOT_MEASURED");
    // Any probe or containment fault: some row is missing and we cannot say which.
    expect(wingConfirmAdvisory({ precondition: "OK", faultCount: 1, candidates: ok })).toBe("STOP_NOT_MEASURED");
    // A candidate absent from the reading. "Not in the list" is not "not on the page" — the distinction this
    // whole workstream keeps relearning, here deciding whether a human presses a key-creating control.
    for (const id of WING_VENDOR_FORM_CANDIDATE_IDS) {
      expect(wingConfirmAdvisory({ precondition: "OK", faultCount: 0, candidates: ok.filter((c) => c.id !== id) }), id).toBe(
        "STOP_NOT_MEASURED",
      );
    }
    // An explicit NOT_MEASURED verdict is the same thing said out loud.
    expect(wingConfirmAdvisory({ precondition: "OK", faultCount: 0, candidates: vendorSeen("NOT_MEASURED") })).toBe(
      "STOP_NOT_MEASURED",
    );
    // The degenerate input: nothing measured at all.
    expect(wingConfirmAdvisory({ precondition: "OK", faultCount: 0, candidates: [] })).toBe("STOP_NOT_MEASURED");
    // …and a reading missing only a SCREEN MARKER is unmeasured too. Screen identity is the first question, and
    // it must never be answered from an absence of rows.
    for (const id of [WING_PURPOSE_SCREEN_MARKER_ID, ...WING_TERMS_SCREEN_MARKER_IDS]) {
      expect(
        wingConfirmAdvisory({ precondition: "OK", faultCount: 0, candidates: ok.filter((c) => c.id !== id) }),
        id,
      ).toBe("STOP_NOT_MEASURED");
    }
  });

  it("**STOPS on the TERMS screen — the defect the 2026-08-10 run walked into**", () => {
    // That run's gate asked only about the vendor fields. They are hidden on EVERY screen in this flow, so it
    // answered "advance" while the operator was already on the terms screen, and the harness printed "press
    // 확인" for a screen whose visible control was 약관 동의 및 Key 발급받기. Nothing was pressed only because
    // 확인 was no longer there. The vendor answer is unchanged and irrelevant; the screen decides.
    const onTerms: Row[] = [
      ...markers("TERMS"),
      ...WING_VENDOR_FORM_CANDIDATE_IDS.map((id) => ({ id, presence: "PRESENT_HIDDEN_ONLY" as const })),
    ];
    expect(wingConfirmAdvisory({ precondition: "OK", faultCount: 0, candidates: onTerms })).toBe(
      "STOP_ALREADY_PAST_THE_PURPOSE_SCREEN",
    );
    // Either marker alone is enough — the heading OR the key-creation button.
    for (const id of WING_TERMS_SCREEN_MARKER_IDS) {
      const onlyOne: Row[] = [
        ...markers("NEITHER").map((m) => (m.id === id ? { ...m, presence: "PRESENT_VISIBLE" as const } : m)),
        ...WING_VENDOR_FORM_CANDIDATE_IDS.map((v) => ({ id: v, presence: "PRESENT_HIDDEN_ONLY" as const })),
      ];
      expect(wingConfirmAdvisory({ precondition: "OK", faultCount: 0, candidates: onlyOne }), id).toBe(
        "STOP_ALREADY_PAST_THE_PURPOSE_SCREEN",
      );
    }
  });

  it("TERMS wins when both marker families paint, and an unknown screen stops too", () => {
    // Ambiguity resolves to the screen where stopping is correct — the one holding the key-creation control.
    const both: Row[] = [
      { id: WING_PURPOSE_SCREEN_MARKER_ID, presence: "PRESENT_VISIBLE" },
      ...WING_TERMS_SCREEN_MARKER_IDS.map((id) => ({ id, presence: "PRESENT_VISIBLE" as const })),
      ...WING_VENDOR_FORM_CANDIDATE_IDS.map((id) => ({ id, presence: "PRESENT_HIDDEN_ONLY" as const })),
    ];
    expect(wingFlowScreenFrom({ precondition: "OK", faultCount: 0, candidates: both })).toBe("TERMS");
    expect(wingConfirmAdvisory({ precondition: "OK", faultCount: 0, candidates: both })).toBe(
      "STOP_ALREADY_PAST_THE_PURPOSE_SCREEN",
    );
    const nowhere: Row[] = [
      ...markers("NEITHER"),
      ...WING_VENDOR_FORM_CANDIDATE_IDS.map((id) => ({ id, presence: "PRESENT_HIDDEN_ONLY" as const })),
    ];
    expect(wingFlowScreenFrom({ precondition: "OK", faultCount: 0, candidates: nowhere })).toBe("UNRECOGNIZED");
    expect(wingConfirmAdvisory({ precondition: "OK", faultCount: 0, candidates: nowhere })).toBe("STOP_SCREEN_UNRECOGNIZED");
  });

  it("only ONE of its three values lets the run continue", () => {
    // Stated as a property rather than left implicit in the branches: a fourth advisory added later has to
    // decide, explicitly, whether it is a go — the default must never be "proceed".
    const advancing = WING_CONFIRM_ADVISORIES.filter((a) => !a.startsWith("STOP_"));
    expect(advancing).toEqual(["ADVANCE_FORM_NOT_YET_REVEALED"]);
    expect(WING_CONFIRM_ADVISORIES.length).toBeGreaterThan(4);
  });

  it("watches the three VENDOR-FORM labels, and each is a real Stage-2 candidate id", () => {
    // An id that matches no candidate would be permanently `undefined` in the reading, which fails closed — safe,
    // but it would also mean the gate never actually looks at the form. Both halves matter.
    const known = new Set(Object.values(WING_STAGE2_RECON_CANDIDATES).flat().map((c) => c.id));
    for (const id of WING_VENDOR_FORM_CANDIDATE_IDS) expect(known).toContain(id);
    expect(WING_VENDOR_FORM_CANDIDATE_IDS).toEqual([
      "stage2.vendor_info.baseline",
      "stage2.vendor_url.url",
      "stage2.call_ip.ip_addr",
    ]);
  });
});

/* ══════════════════════════ the reveal ══════════════════════════ */

describe("wingRevealedBetween — what APPEARED, not what is present", () => {
  it("counts a hidden-or-absent label that became visible, and nothing else", () => {
    const before = [
      { id: "a", presence: "PRESENT_HIDDEN_ONLY" as const },
      { id: "b", presence: "ABSENT_EVERYWHERE" as const },
      { id: "c", presence: "PRESENT_VISIBLE" as const },
    ];
    const after = [
      { id: "a", presence: "PRESENT_VISIBLE" as const },
      { id: "b", presence: "PRESENT_VISIBLE" as const },
      { id: "c", presence: "PRESENT_VISIBLE" as const },
    ];
    // `c` was already visible — a reveal it is not, and counting it would inflate the headline finding.
    expect(wingRevealedBetween(before, after)).toEqual(["a", "b"]);
  });

  it("an UNMEASURED row on either side contributes nothing", () => {
    expect(
      wingRevealedBetween([{ id: "a", presence: "NOT_MEASURED" }], [{ id: "a", presence: "PRESENT_VISIBLE" }]),
    ).toEqual([]);
    expect(
      wingRevealedBetween([{ id: "a", presence: "PRESENT_HIDDEN_ONLY" }], [{ id: "a", presence: "NOT_MEASURED" }]),
    ).toEqual([]);
    // A row that only exists AFTER cannot be a transition: there is no before-state to have changed from.
    expect(wingRevealedBetween([], [{ id: "a", presence: "PRESENT_VISIBLE" }])).toEqual([]);
  });

  it("a label that went the other way is not a reveal either", () => {
    expect(
      wingRevealedBetween([{ id: "a", presence: "PRESENT_VISIBLE" }], [{ id: "a", presence: "PRESENT_HIDDEN_ONLY" }]),
    ).toEqual([]);
  });
});

/* ══════════════════════════ the runner ══════════════════════════ */

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

/**
 * A fake WING that models the two screens the live flow actually has. `termsFrom` is the 1-based read at which
 * pressing 확인 has taken effect; before it the purpose heading paints, after it the terms heading and the
 * key-creation button do. The vendor labels are hidden on BOTH, because that is what three live runs measured
 * — and it is exactly why the gate cannot be built on them.
 */
function fakeFlow(
  over: { termsFrom?: number; vendorVisible?: boolean; signals?: readonly ("ready" | "abort" | "timeout")[]; choiceControls?: number } = {},
) {
  const asked: WingFlowCheckpoint[] = [];
  const steps: Array<{ index: number; total: number }> = [];
  let reads = 0;
  const signals = over.signals ?? (["ready", "ready", "ready", "ready"] as const);
  let waits = 0;
  const termsFrom = over.termsFrom ?? 3;
  const onTerms = (): boolean => reads >= termsFrom;
  const PURPOSE_TEXT = "키의 사용 목적을 골라주세요";
  const TERMS_TEXT = "약관 동의 및 Key 발급받기";
  const VENDOR = ["업체명", "URL", "IP 주소"];
  const paints = (t: string): boolean =>
    VENDOR.includes(t) ? over.vendorVisible === true : t === TERMS_TEXT ? onTerms() : t === PURPOSE_TEXT ? !onTerms() : false;
  const deps: WingSelectorRecordDeps = {
    waitForReady: async () => signals[waits++] ?? "timeout",
    observeSurface: async () => {
      reads += 1;
      return observeFrom("wing_host", { ...CENSUS, choiceControlCount: over.choiceControls ?? 2 });
    },
    probeTarget: async () => {
      throw new Error("a discovery run probes no shipped locator");
    },
    probeCandidate: async (spec) =>
      paints(spec.exactText) ? { matchCount: 1, canHighlight: true } : { matchCount: 0, canHighlight: false },
    probeContainment: async (spec) =>
      paints(spec.exactText)
        ? { exactVisible: 1, exactHidden: 0, deepestContainsVisible: 1, deepestContainsHidden: 0, scanTruncated: false }
        : { exactVisible: 0, exactHidden: 2, deepestContainsVisible: 0, deepestContainsHidden: 3, scanTruncated: false },
    // Echoes back how many candidates it was handed — the one thing this fake needs to prove about the union.
    choiceAssociationCensus: async (candidates) => ({
      visibleChoiceControlCount: 2,
      hiddenChoiceControlCount: 10,
      rows: [],
      rowsTruncated: false,
      nameGroupCount: 1,
      largestNameGroupSize: 2,
      ungroupedCount: 0,
      scanTruncated: false,
      candidatesCompared: candidates.filter((c) => c.trim().length > 0).length,
    }),
    announceCheckpoint: (c, index, total) => {
      asked.push(c);
      steps.push({ index, total });
    },
  };
  return { deps, asked, steps, reads: () => reads };
}

// The FULL scope. A discovery run narrowed to the purpose targets would never probe the terms markers, and
// `wingFlowScreenFrom` would read NOT_MEASURED at every checkpoint — fail-closed, but useless.
const ALL_TARGETS = [...WING_STAGE2_RECON_TARGETS] as const;

describe("runWingFlowDiscovery — one reading per operator-advanced checkpoint", () => {
  it("takes every checkpoint when the form stays hidden, and reports the reveal", async () => {
    // The form appears only at the THIRD read — i.e. 확인 opened it, which is the outcome the flow description
    // predicts and no run has yet observed.
    const { deps, asked } = fakeFlow();
    const r = await runWingFlowDiscovery(deps, { targets: ALL_TARGETS, phase: WING_ISSUANCE_FLOW_DISCOVERY_PHASE });
    expect(r.readings.map((x) => x.checkpoint)).toEqual([...WING_FLOW_CHECKPOINTS]);
    expect(r.readings[r.readings.length - 1]!.checkpoint).toBe(WING_FLOW_LAST_CHECKPOINT);
    expect(asked).toEqual([...WING_FLOW_CHECKPOINTS]);
    expect(r.advisory).toBe("ADVANCE_FORM_NOT_YET_REVEALED");
    expect(r.halted).toBeNull();
    expect(r.aborted).toBe(false);
    // What appeared between the first and last readings is the TERMS screen, not the vendor form — which is
    // what three live runs measured and what the old fixture got wrong.
    expect([...r.revealedCandidateIds].sort()).toEqual([...WING_TERMS_SCREEN_MARKER_IDS].sort());
    expect(r.readings.map((x) => x.screen)).toEqual(["PURPOSE", "PURPOSE", "TERMS", "TERMS"]);
    expect(r.screenMismatch).toBeNull();
    expect(r.agentSelections).toBe(0);
  });

  it("**HALTS before checkpoint 3 is even ANNOUNCED when the form is already visible**", async () => {
    // The property this whole phase is built around. Not "warns", not "asks the operator to decide" — the
    // instruction to press 확인 is never printed, because printing it is the harm. An operator who is told to
    // press a button generally presses it.
    const { deps, asked } = fakeFlow({ vendorVisible: true });
    const r = await runWingFlowDiscovery(deps, { targets: ALL_TARGETS, phase: WING_ISSUANCE_FLOW_DISCOVERY_PHASE });
    expect(r.advisory).toBe("STOP_FORM_ALREADY_VISIBLE");
    expect(r.halted).toBe("CONFIRM_ADVISORY_STOP");
    expect(asked).toEqual(["PURPOSE_SCREEN_UNTOUCHED", "PURPOSE_OPTION_SELECTED_BY_OPERATOR"]);
    expect(asked).not.toContain("AFTER_OPERATOR_CONFIRM");
    // …and the readings it did take are KEPT. A cautious halt is a result; discarding its evidence would make
    // it indistinguishable from a crash, and the reading is the very thing that justified stopping.
    expect(r.readings).toHaveLength(2);
    expect(r.readings[1]!.stage2.precondition).toBe("OK");
  });

  it("a page it cannot read halts too, at the same point and for the same reason", async () => {
    // No visible choice control ⇒ the precondition fails ⇒ no candidate rows ⇒ the gate has nothing to go on.
    // Two halts are possible here and the earlier one wins; what matters is that neither advances.
    const { deps, asked } = fakeFlow({ choiceControls: 0 });
    const r = await runWingFlowDiscovery(deps, { targets: ALL_TARGETS, phase: WING_ISSUANCE_FLOW_DISCOVERY_PHASE });
    expect(r.halted).toBe("PRECONDITION_FAILED");
    expect(asked).not.toContain("AFTER_OPERATOR_CONFIRM");
    expect(r.advisory).toBeNull();
  });

  it("an operator abort or a timeout stops the loop and says which", async () => {
    const abort = await runWingFlowDiscovery(fakeFlow({ signals: ["ready", "abort"] }).deps, {
      targets: ALL_TARGETS,
      phase: WING_ISSUANCE_FLOW_DISCOVERY_PHASE,
    });
    expect(abort.halted).toBe("OPERATOR_ABORTED");
    expect(abort.aborted).toBe(true);
    expect(abort.readings).toHaveLength(1);

    const timeout = await runWingFlowDiscovery(fakeFlow({ signals: ["ready", "timeout"] }).deps, {
      targets: ALL_TARGETS,
      phase: WING_ISSUANCE_FLOW_DISCOVERY_PHASE,
    });
    expect(timeout.halted).toBe("OPERATOR_SIGNAL_TIMEOUT");
    // A timeout is not an abort. The operator who walked away did not decline.
    expect(timeout.aborted).toBe(false);
  });

  it("aborting at the FIRST checkpoint takes no reading and claims no reveal", async () => {
    const r = await runWingFlowDiscovery(fakeFlow({ signals: ["abort"] }).deps, {
      targets: ALL_TARGETS,
      phase: WING_ISSUANCE_FLOW_DISCOVERY_PHASE,
    });
    expect(r.readings).toEqual([]);
    expect(r.revealedCandidateIds).toEqual([]);
    expect(r.advisory).toBeNull();
  });

  it("one reading is never compared against itself", async () => {
    // With a single checkpoint, first === last. Diffing them would report every visible label as a reveal.
    const { deps } = fakeFlow();
    const r = await runWingFlowDiscovery(deps, {
      targets: ALL_TARGETS,
      phase: WING_ISSUANCE_FLOW_DISCOVERY_PHASE,
      checkpoints: ["PURPOSE_SCREEN_UNTOUCHED"],
    });
    expect(r.readings).toHaveLength(1);
    expect(r.revealedCandidateIds).toEqual([]);
  });

  it("every checkpoint waits for its OWN operator signal", async () => {
    // No reading is ever taken on a timer or on the back of a previous signal: three checkpoints, three waits.
    let waits = 0;
    const { deps } = fakeFlow();
    const counted: WingSelectorRecordDeps = {
      ...deps,
      waitForReady: async () => {
        waits += 1;
        return "ready";
      },
    };
    const r = await runWingFlowDiscovery(counted, { targets: ALL_TARGETS, phase: WING_ISSUANCE_FLOW_DISCOVERY_PHASE });
    expect(waits).toBe(r.readings.length);
    expect(waits).toBe(WING_FLOW_CHECKPOINTS.length);
  });

  it("takes the CALIBRATION instruments at every checkpoint, not a bare recon", async () => {
    // The discovery phase compares association readings across checkpoints, so a phase gate that tested
    // `=== CALIBRATION` would have left it with no association reading to compare.
    const { deps } = fakeFlow();
    const r = await runWingFlowDiscovery(deps, { targets: ALL_TARGETS, phase: WING_ISSUANCE_FLOW_DISCOVERY_PHASE });
    for (const reading of r.readings) {
      expect(reading.stage2.calibration).toBe(true);
      // The containment probe ran: every candidate carries a quad rather than an absent one.
      for (const c of reading.stage2.targets.flatMap((t) => t.candidates)) expect(c.containment).not.toBeNull();
    }
  });
});

/* ══════════════════════════ the phase, and what it is allowed to be ══════════════════════════ */

describe("the discovery PHASE is wired everywhere a Stage-2 phase must be", () => {
  it("is a Stage-2 phase, and a CALIBRATING one", () => {
    expect(WING_STAGE2_PHASES).toContain(WING_ISSUANCE_FLOW_DISCOVERY_PHASE);
    expect(wingPhaseCalibrates(WING_ISSUANCE_FLOW_DISCOVERY_PHASE)).toBe(true);
    expect(wingPhaseCalibrates(WING_STAGE2_LABEL_CALIBRATION_PHASE)).toBe(true);
    // …and the recon still is not. Widening the predicate to "every Stage-2 phase" would make the recon take
    // two measurements its own manifest never described.
    expect(wingPhaseCalibrates(WING_STAGE2_RECON_PHASE)).toBe(false);
  });

  it("is in the manifest vocabulary, the WING set, and the Stage-2 manifest set", () => {
    // The lesson the WING phase list already recorded: a phase added to some lists and not others gets screened
    // against the wrong host, or silently loses its scope binding.
    expect(CALIBRATION_PHASES).toContain("COUPANG_WING_ISSUANCE_FLOW_DISCOVERY");
    expect(WING_PHASES).toContain("COUPANG_WING_ISSUANCE_FLOW_DISCOVERY");
    expect(WING_STAGE2_MANIFEST_PHASES).toContain("COUPANG_WING_ISSUANCE_FLOW_DISCOVERY");
  });

  it("the shell harness accepts it in EVERY place it lists the other Stage-2 phases", () => {
    // Three shell files decide whether this phase can be bootstrapped, preflighted and described. A phase
    // missing from one of them fails at a different layer than the one that would explain it.
    const tools = resolve(HERE, "../../../../tools/coupang-local");
    for (const f of ["wing-probe-bootstrap.sh", "wing-probe-preflight.sh"]) {
      const src = readFileSync(resolve(tools, f), "utf8");
      const predicate = src.split("\n").find((l) => l.includes("case \"$1\" in COUPANG_WING_STAGE2_RECON"));
      expect(predicate, `${f} has no is_stage2_phase predicate`).toBeTruthy();
      expect(predicate, `${f} predicate omits discovery`).toContain("COUPANG_WING_ISSUANCE_FLOW_DISCOVERY");
    }
  });

  it("the BOOTSTRAP note branches too — it is the first copy the operator reads", () => {
    // Found by running it: the bootstrap printed "choose nothing, and never press '확인'" under a discovery
    // banner, contradicting the manifest the very next command prints. The preflight had already been fixed;
    // the bootstrap is a second place saying the same thing, which is how one of them stays wrong.
    const src = readFileSync(resolve(HERE, "../../../../tools/coupang-local/wing-probe-bootstrap.sh"), "utf8");
    const branch = src.indexOf('if [ "$PHASE" = "COUPANG_WING_ISSUANCE_FLOW_DISCOVERY" ]; then\n    # Discovery ASKS');
    expect(branch, "the bootstrap note does not branch on the discovery phase").toBeGreaterThan(-1);
    // Bounded at the `else`, not at the `fi` — the shared copy lives between them, and a slice that swallowed
    // it would let the discovery branch say anything at all while this test read the branch below it.
    const block = src.slice(branch, src.indexOf("  else", branch));
    expect(block).toContain("YOU advance the flow");
    expect(block).toContain("ONLY if");
    expect(block).not.toContain("never press");
  });

  it("the preflight gives discovery its OWN operator warning — the shared one FORBIDS what it asks for", () => {
    // The Stage-2 warning says "Choose no purpose … NEVER press 확인". Printed above a discovery manifest it
    // would contradict the manifest directly over it, and the operator would have to guess which is binding.
    const src = readFileSync(resolve(HERE, "../../../../tools/coupang-local/wing-probe-preflight.sh"), "utf8");
    const discoveryBranch = src.indexOf('if [ "$PHASE" = "COUPANG_WING_ISSUANCE_FLOW_DISCOVERY" ]; then');
    const sharedBranch = src.indexOf('elif is_stage2_phase "$PHASE"; then');
    expect(discoveryBranch).toBeGreaterThan(-1);
    // The discovery branch must come FIRST, or the shared one swallows it.
    expect(sharedBranch).toBeGreaterThan(discoveryBranch);
    const block = src.slice(discoveryBranch, sharedBranch);
    // It has to state the conditionality, the reason, and the halt — not just "you may press 확인".
    expect(block).toContain("ADVANCES THE REAL FLOW");
    expect(block).toContain("KEY-CREATION control");
    expect(block).toContain("HALTS");
    expect(block).toContain("Fail-closed");
    // …and it must READ as English. A shell-escaping leak (`run'\''s`) shipped into the middle of the sentence
    // explaining why the run halts before a key-creating control — the one paragraph that has to be legible.
    expect(block).not.toMatch(/\\'/);
    expect(block).not.toContain("'\\''");
  });
});

/* ══════════════════════════ the agent still does nothing ══════════════════════════ */

describe("the widening is in what the OPERATOR does — the agent's budget is unchanged", () => {
  it("the discovery runner reaches no click, selection, or input path", () => {
    // A phase whose whole subject is selecting a radio is exactly where a `.check()` would look reasonable.
    const src = readFileSync(resolve(HERE, "../../../src/cli/probe-wing-issuance-selectors.ts"), "utf8");
    const body = src.slice(src.indexOf("export async function runWingFlowDiscovery"));
    const runner = body.slice(0, body.indexOf("\n/* ─"));
    for (const f of [".click(", ".check(", ".selectOption(", ".fill(", ".type(", ".press(", ".goto(", ".setChecked("]) {
      expect(runner, `runWingFlowDiscovery must not reach ${f}`).not.toContain(f);
    }
  });

  it("the DRIVER gained no new seam for this phase", () => {
    // Discovery takes more readings, not different ones. If it had needed a new page interaction, that would be
    // a capability the manifest's action list does not carry.
    const src = readFileSync(resolve(HERE, "../../../src/action-window/coupang-wing-issuance-driver.ts"), "utf8");
    for (const f of ["check(", "selectOption(", "setChecked("]) {
      expect(src, `driver must not reach ${f}`).not.toContain(f);
    }
  });
});

/* ══════════════════════════ the TERMS screen ══════════════════════════ */

describe("the terms screen — transcribed verbatim, and the key-creation boundary named", () => {
  const byId = (id: string) => Object.values(WING_STAGE2_RECON_CANDIDATES).flat().find((c) => c.id === id)!;

  it("holds EXACTLY the five strings the operator read, and no sixth", () => {
    const terms = Object.values(WING_STAGE2_RECON_CANDIDATES)
      .flat()
      .filter((c) => c.id.startsWith("stage3.terms."));
    expect(terms.map((c) => [c.id, c.exactText])).toEqual([
      ["stage3.terms.heading", "약관 동의 및 Key 발급받기"],
      ["stage3.terms.api_agree", "API 이용 약관에 동의합니다."],
      ["stage3.terms.category_agree", "카테고리 자동 매칭 서비스 이용에 동의합니다."],
      ["stage3.terms.cancel", "취소"],
      ["stage3.terms.issue_final", "약관 동의 및 Key 발급받기"],
    ]);
  });

  it("**the heading and the key-creating button carry the SAME text** — the query is what separates them", () => {
    // The trap this screen sets. An exact-text locator for the issue button matches the heading too, so text
    // alone cannot name the control that creates a key. The two candidates differ ONLY in their element query,
    // and whether that narrowing yields a unique match is a MEASUREMENT this run has not taken yet — it is not
    // an assumption, and nothing may be promoted on it.
    expect(byId("stage3.terms.issue_final").exactText).toBe(byId("stage3.terms.heading").exactText);
    expect(byId("stage3.terms.issue_final").candidateQuery).toBe("button,a");
    expect(byId("stage3.terms.heading").candidateQuery).not.toBe("button,a");
    // The issue button's query must stay narrower than the heading's, or the disambiguation is gone.
    const issueTags = byId("stage3.terms.issue_final").candidateQuery.split(",");
    const headingTags = byId("stage3.terms.heading").candidateQuery.split(",");
    expect(issueTags.length).toBeLessThan(headingTags.length);
  });

  it("names the KEY-CREATION control once, and that id is a real candidate", () => {
    expect(WING_KEY_CREATION_CONTROL_ID).toBe("stage3.terms.issue_final");
    expect(byId(WING_KEY_CREATION_CONTROL_ID)).toBeTruthy();
    // Its rationale must say what it is. A control that creates a key, described as "the submit button", is
    // how a later reader promotes it into a tutorial step.
    expect(byId(WING_KEY_CREATION_CONTROL_ID).rationale).toContain("KEY-CREATION");
    expect(byId(WING_KEY_CREATION_CONTROL_ID).rationale).toContain("never");
  });

  it("the flow CANNOT continue past the terms screen — enforced, not documented", async () => {
    // The structural stop. A fifth checkpoint could only be asking the operator to press the key-creating
    // control, so the runner refuses to be the thing that asks — and it THROWS rather than halting, because a
    // caller who added one made a mistake in code and a code mistake must not read as a cautious measurement.
    expect(WING_FLOW_CHECKPOINTS[WING_FLOW_CHECKPOINTS.length - 1]).toBe(WING_FLOW_LAST_CHECKPOINT);
    const { deps } = fakeFlow();
    await expect(
      runWingFlowDiscovery(deps, {
        targets: ALL_TARGETS,
        phase: WING_ISSUANCE_FLOW_DISCOVERY_PHASE,
        checkpoints: [...WING_FLOW_CHECKPOINTS, "PURPOSE_SCREEN_UNTOUCHED"],
      }),
    ).rejects.toThrow(/no checkpoint may follow/);
  });

  it("the last checkpoint's copy forbids the press, and says why, in the operator's own terms", () => {
    const src = readFileSync(resolve(HERE, "../../../src/cli/probe-wing-issuance-selectors.ts"), "utf8");
    const from = src.indexOf("the TERMS screen. Tick the two consent boxes YOURSELF");
    expect(from).toBeGreaterThan(-1);
    const block = src.slice(from, src.indexOf("\n  }", from));
    expect(block).toContain("DO NOT press");
    expect(block).toContain("CREATES THE KEY");
    expect(block).toContain("SEPARATE approval");
    // …and it must not agree to the terms on the seller's behalf, or advise on them.
    expect(block).toContain("SellerOps does not read them");
    expect(block).toContain("decide for yourself");
  });

  it("the two consents are SEPARATE candidates and never bundled", () => {
    // Two checkboxes, two decisions. A single "agreed to the terms" candidate would let a tutorial present one
    // tick as covering both, which is a consent claim SellerOps has no standing to make.
    expect(WING_STAGE3_TERMS_OPTION_CANDIDATES).toHaveLength(2);
    const texts = WING_STAGE3_TERMS_OPTION_CANDIDATES.map((c) => c.exactText);
    expect(texts).toEqual(["API 이용 약관에 동의합니다.", "카테고리 자동 매칭 서비스 이용에 동의합니다."]);
    for (const c of WING_STAGE3_TERMS_OPTION_CANDIDATES) {
      expect(c.provenance).toBe("OPERATOR_TRANSCRIBED");
      // Same two silent-mismatch modes the purpose options are pinned against.
      expect(c.exactText.normalize("NFC")).toBe(c.exactText);
      expect(c.exactText).not.toMatch(/[   -​  　]/);
      expect(c.exactText.trim()).toBe(c.exactText);
      // The trailing period is part of what was read. Trimming it is the kind of "tidying" that produces a
      // measured non-match against a character-perfect page.
      expect(c.exactText.endsWith(".")).toBe(true);
    }
  });

  it("the census compares against purpose AND terms labels, with the earlier indices unmoved", () => {
    // `exactCandidateIndex` is an INDEX. The 2026-08-10 record says radio 0 matched index 4 and radio 1 index
    // 5; prepending the terms labels would silently re-aim both.
    expect(WING_CHOICE_LABEL_CANDIDATES.map((c) => c.id).slice(0, 6)).toEqual([
      "purpose_option.self_dev",
      "purpose_option.self_dev_spaced",
      "purpose_option.direct_input",
      "purpose_option.direct_input_spaced",
      "purpose_option.open_api",
      "purpose_option.playauto_web_solution",
    ]);
    expect(WING_CHOICE_LABEL_CANDIDATES[4]!.exactText).toBe("OPEN API");
    expect(WING_CHOICE_LABEL_CANDIDATES[5]!.exactText).toBe("플레이오토 웹 솔루션");
    expect(WING_CHOICE_LABEL_CANDIDATES.slice(6)).toEqual([...WING_STAGE3_TERMS_OPTION_CANDIDATES]);
    // Unique ids and unique texts across the union — a collision would make the reported index order-dependent.
    const ids = WING_CHOICE_LABEL_CANDIDATES.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    const texts = WING_CHOICE_LABEL_CANDIDATES.map((c) => c.exactText);
    expect(new Set(texts).size).toBe(texts.length);
  });

  it("the discovery runner compares against the UNION, not the purpose-only list", async () => {
    // A terms checkbox measured against four purpose strings would report `-1` — a measured non-match — for a
    // label we transcribed ourselves.
    const { deps } = fakeFlow();
    const r = await runWingFlowDiscovery(deps, { targets: ALL_TARGETS, phase: WING_ISSUANCE_FLOW_DISCOVERY_PHASE });
    for (const reading of r.readings) {
      expect(reading.stage2.association?.candidatesCompared).toBe(WING_CHOICE_LABEL_CANDIDATES.length);
    }
  });
});

/* ══════════════════════════ the manifest must describe THIS run ══════════════════════════ */

describe("the manifest cannot under-describe the flow it approves", () => {
  const CLI_SRC = readFileSync(resolve(HERE, "../../../src/cli/approval-manifest-cli.ts"), "utf8");
  const ENTRY = PHASE_ENTRYPOINTS.COUPANG_WING_ISSUANCE_FLOW_DISCOVERY;
  const SPEC = PHASE_SPECS.COUPANG_WING_ISSUANCE_FLOW_DISCOVERY;

  it("**states the checkpoint count from the resolved PLAN, not from prose**", () => {
    // Found by RUNNING the harness twice, in both directions. First the manifest said "3 read-only checkpoint
    // readings" while the code had four — the undescribed fourth being the one in front of the key-creating
    // button. Then, once a run could be narrowed, it promised four for a three-checkpoint run. Both are one
    // defect: a document the operator grants on, describing a run other than the one that will happen.
    const branch = CLI_SRC.slice(CLI_SRC.indexOf("isWingFlowDiscovery\n    ? \"operator-performed"));
    const maxActions = branch.slice(0, branch.indexOf("\n    : isWingReveal"));
    expect(maxActions).toContain("${checkpoints.length} read-only checkpoint readings");
    expect(maxActions).toContain("checkpoints.join");
    // A literal count anywhere in that string is the defect coming back.
    expect(maxActions).not.toMatch(/\b[0-9]+ read-only checkpoint readings/);
    // …and steps the plan does not reach are not promised.
    expect(maxActions).toContain("reachesTerms ?");
    expect(maxActions).toContain("reachesConfirm ?");
  });

  it("an invalid checkpoint plan REFUSES rather than falling back to the whole flow", () => {
    const head = CLI_SRC.slice(CLI_SRC.indexOf("const flowPlan = isWingFlowDiscovery"));
    expect(head.slice(0, 900)).toContain("WING_FLOW_CHECKPOINTS_MISMATCH");
    expect(head.slice(0, 900)).toContain("resolveWingFlowCheckpoints");
  });

  it("the OPERATION text names the key-creation boundary and the separate approval", () => {
    const branch = CLI_SRC.slice(CLI_SRC.indexOf('isWingFlowDiscovery\n    ? "WING OPEN-API'));
    const operation = branch.slice(0, branch.indexOf("\n    : isWingReveal"));
    expect(operation).toContain("KEY-CREATION control");
    expect(operation).toContain("never pressed");
    expect(operation).toContain("separate phase");
    expect(operation).toContain("TERMS screen");
    // …and it must not consent on the seller's behalf.
    expect(operation).toContain("does not read, evaluate, agree to, or advise on the terms");
  });

  it("the OPERATOR SUMMARY — the copy the seller actually reads — carries the same boundary", () => {
    // The operation is for a reviewer; this is for the person at the keyboard. Both have to say it, because a
    // run that stops one control short of key creation is only safe if the person knows which control that is.
    expect(ENTRY.operatorActionSummary).toContain("약관 동의 및 Key 발급받기");
    expect(ENTRY.operatorActionSummary).toContain("절대 누르지 않습니다");
    expect(ENTRY.operatorActionSummary).toContain("별도 승인");
    expect(ENTRY.operatorActionSummary).toContain("대신 동의하지 않습니다");
    // Four numbered steps, matching the four checkpoints.
    for (const marker of ["①", "②", "③", "④"]) expect(ENTRY.operatorActionSummary).toContain(marker);
    expect(ENTRY.operatorActionSummary).not.toContain("⑤");
  });

  it("declares EXACTLY one read beyond the calibration's, and names it", () => {
    // Discovery reads the calibration's eight plus the consent-block census. That census is a real additional
    // measurement, so it is declared — a phase quietly taking a ninth read under a manifest naming eight is
    // precisely the failure the action list exists to prevent. What must not happen is a TENTH arriving
    // unnoticed, so this pins the difference rather than the list.
    const base = [...PHASE_SPECS.COUPANG_WING_STAGE2_LABEL_CALIBRATION.capableActions];
    expect([...SPEC.capableActions]).toEqual([...base, "CONSENT_BLOCK_CENSUS"]);
    expect(SPEC.mode).toBe("READ_ONLY");
    expect(SPEC.allowsHighlight).toBe(false);
  });

  it("the preflight builds its step list FROM THE PLAN, and hard-codes no count", () => {
    const src = readFileSync(resolve(HERE, "../../../../tools/coupang-local/wing-probe-preflight.sh"), "utf8");
    const from = src.indexOf('if [ "$PHASE" = "COUPANG_WING_ISSUANCE_FLOW_DISCOVERY" ]; then');
    const block = src.slice(from, src.indexOf('elif is_stage2_phase "$PHASE"; then', from));
    // Derived: it loops the plan and numbers as it goes.
    expect(block).toContain("for CP in $PLAN");
    expect(block).toContain("STEP_I=$((STEP_I + 1))");
    // Every checkpoint has a copy branch, or a plan naming it prints a blank step.
    for (const c of WING_FLOW_CHECKPOINTS) expect(block, c).toContain(`${c})`);
    // No literal step number survives.
    expect(block).not.toMatch(/echo "    [0-9]+\)/);
    expect(block).toContain("KEY-CREATION control");
    expect(block).toContain("no fifth checkpoint");
  });

  it("the warning does not repeat a claim its own runs have since falsified", () => {
    // It said "nobody has ever pressed 확인, and no run has measured what it does" — true when written, false
    // after two runs pressed it and measured that it opens the terms screen. Safety copy that keeps asserting
    // a retired unknown teaches the reader to discount it, and the paragraph it sat in is the one explaining
    // why the run may stop before a key-creating control.
    const src = readFileSync(resolve(HERE, "../../../../tools/coupang-local/wing-probe-preflight.sh"), "utf8");
    const from = src.indexOf('if [ "$PHASE" = "COUPANG_WING_ISSUANCE_FLOW_DISCOVERY" ]; then');
    const block = src.slice(from, src.indexOf('elif is_stage2_phase "$PHASE"; then', from));
    expect(block).not.toContain("nobody has ever pressed");
    expect(block).not.toContain("no run has measured what it does");
    // Nor the OPPOSITE over-claim, which replaced it and was itself retracted: two later runs reached the terms
    // screen before the 확인 step, so "확인 opens the TERMS screen" is not established either.
    expect(block).not.toContain("'확인' opens the TERMS screen");
    expect(block).toContain("What '확인' DOES is not established");
    // What IS measured stays stated, and so does the defect the gate closes.
    expect(block).toContain("never appear anywhere in this flow");
    expect(block).toContain("WAS printed against the terms screen");
  });
});

/* ══════════════════════════ screen identity gates the INSTRUCTION ══════════════════════════ */

describe("no instruction is printed for a screen the flow is not on", () => {
  it("**halts WITHOUT announcing when the flow has already moved past the checkpoint's screen**", async () => {
    // The 2026-08-10 run's actual failure, reproduced: the flow reached the terms screen before checkpoint 2's
    // reading, and the harness went on to print "press 확인" — for a screen where 확인 no longer exists and the
    // key-creation button does. `termsFrom: 1` puts the very first reading on the terms screen.
    const { deps, asked } = fakeFlow({ termsFrom: 1 });
    const r = await runWingFlowDiscovery(deps, { targets: ALL_TARGETS, phase: WING_ISSUANCE_FLOW_DISCOVERY_PHASE });
    expect(r.halted).toBe("SCREEN_NOT_AS_EXPECTED");
    expect(r.screenMismatch).toEqual({
      checkpoint: "PURPOSE_OPTION_SELECTED_BY_OPERATOR",
      expected: "PURPOSE",
      actual: "TERMS",
    });
    // The instruction for the mismatched checkpoint was never printed — that is the whole property.
    expect(asked).toEqual(["PURPOSE_SCREEN_UNTOUCHED"]);
    // …and the reading it did take is kept, so the halt is explainable from the record.
    expect(r.readings).toHaveLength(1);
    expect(r.readings[0]!.screen).toBe("TERMS");
  });

  it("halts before the TERMS checkpoint if 확인 never took effect", async () => {
    // The mirror case: the operator signalled after pressing nothing, so the flow is still on the purpose
    // screen when checkpoint 4 wants to talk about consent boxes. Asking them to tick boxes that are not there
    // is the same failure wearing the other hat.
    const { deps, asked } = fakeFlow({ termsFrom: 99 });
    const r = await runWingFlowDiscovery(deps, { targets: ALL_TARGETS, phase: WING_ISSUANCE_FLOW_DISCOVERY_PHASE });
    expect(r.halted).toBe("SCREEN_NOT_AS_EXPECTED");
    expect(r.screenMismatch).toEqual({
      checkpoint: "TERMS_CHECKED_BY_OPERATOR",
      expected: "TERMS",
      actual: "PURPOSE",
    });
    expect(asked).not.toContain("TERMS_CHECKED_BY_OPERATOR");
  });

  it("the FIRST checkpoint has no expectation — nothing has been read yet", () => {
    // The operator is still navigating when it is printed, so an expectation there could only be a guess.
    expect(WING_CHECKPOINT_EXPECTED_SCREEN.PURPOSE_SCREEN_UNTOUCHED).toBeNull();
    // Every other checkpoint names one, or a future addition silently inherits "anything goes".
    for (const c of WING_FLOW_CHECKPOINTS.slice(1)) {
      expect(WING_CHECKPOINT_EXPECTED_SCREEN[c], c).not.toBeNull();
    }
  });

  it("each reading carries the screen it was OF, derived from its own markers", async () => {
    const { deps } = fakeFlow();
    const r = await runWingFlowDiscovery(deps, { targets: ALL_TARGETS, phase: WING_ISSUANCE_FLOW_DISCOVERY_PHASE });
    // Never assumed from the checkpoint's name: checkpoint 3 is called AFTER_OPERATOR_CONFIRM and the screen it
    // records is measured, so a 확인 that silently did nothing shows up as PURPOSE rather than being narrated
    // as TERMS by the label.
    expect(r.readings.map((x) => [x.checkpoint, x.screen])).toEqual([
      ["PURPOSE_SCREEN_UNTOUCHED", "PURPOSE"],
      ["PURPOSE_OPTION_SELECTED_BY_OPERATOR", "PURPOSE"],
      ["AFTER_OPERATOR_CONFIRM", "TERMS"],
      ["TERMS_CHECKED_BY_OPERATOR", "TERMS"],
    ]);
  });
});

/* ══════════════════════════ the step counter, and the promotion block ══════════════════════════ */

describe("the operator-facing step counter is computed, not typed", () => {
  it("passes the index and the total to every announcement", async () => {
    // The drift this closes: the banners read 1/3, 2/3, 3/4, 4/4 in one run — three literals, two of them
    // stale, contradicting the manifest the operator had just granted on.
    const { deps, steps } = fakeFlow();
    await runWingFlowDiscovery(deps, { targets: ALL_TARGETS, phase: WING_ISSUANCE_FLOW_DISCOVERY_PHASE });
    expect(steps).toEqual(WING_FLOW_CHECKPOINTS.map((_, i) => ({ index: i, total: WING_FLOW_CHECKPOINTS.length })));
  });

  it("the printer interpolates the counter and contains no hard-coded N/M", () => {
    const src = readFileSync(resolve(HERE, "../../../src/cli/probe-wing-issuance-selectors.ts"), "utf8");
    const from = src.indexOf("function printDiscoveryCheckpoint");
    const body = src.slice(from, src.indexOf("\nfunction printInstructions", from));
    expect(body).toContain("const step = `DISCOVERY ${index + 1}/${total}`");
    // Any surviving literal step counter is the defect coming back.
    expect(body).not.toMatch(/DISCOVERY [0-9]+\/[0-9]+/);
  });
});

describe("the terms checkboxes are blocked from promotion, by name", () => {
  it("records WHY, and the reason is a measurement", () => {
    // Not "we have not got round to it": both boxes were measured to have no accessible name at all, and
    // neither consent sentence is unique. The pairing is unknown, and the unknown thing is which box the
    // seller is ticking.
    expect(WING_TERMS_CHECKBOX_PROMOTION_BLOCKED).toBe("NO_ACCESSIBLE_ASSOCIATION_MEASURED_2026_08_10");
    const src = readFileSync(resolve(HERE, "../../../src/action-window/coupang-wing-label-recon.ts"), "utf8");
    const from = src.indexOf("export const WING_TERMS_CHECKBOX_PROMOTION_BLOCKED");
    const doc = src.slice(src.lastIndexOf("/**", from), from);
    expect(doc).toContain("nameSource: NONE");
    expect(doc).toContain("neither sentence is unique");
    expect(doc).toContain("no locator, no");
  });

  it("no terms checkbox candidate is a shipped locator", () => {
    // The shipped-locator namespace is separate on purpose; this asserts the consent labels never leaked into
    // it. `WING_PROBE_TARGET_NAMES` is what an ordinary selector probe can be pointed at.
    for (const t of ["terms_api_agree", "terms_category_agree"]) {
      expect(WING_PROBE_TARGET_NAMES as readonly string[]).not.toContain(t);
    }
  });
});

/* ══════════════════════════ the per-run checkpoint PLAN ══════════════════════════ */

describe("a run may end the flow early, but never start it in the middle", () => {
  it("accepts a PREFIX and defaults to the whole flow", () => {
    expect(resolveWingFlowCheckpoints(undefined)).toEqual({ ok: true, checkpoints: [...WING_FLOW_CHECKPOINTS] });
    expect(resolveWingFlowCheckpoints("  ")).toEqual({ ok: true, checkpoints: [...WING_FLOW_CHECKPOINTS] });
    const three = resolveWingFlowCheckpoints(WING_FLOW_CHECKPOINTS.slice(0, 3).join(","));
    expect(three).toEqual({ ok: true, checkpoints: [...WING_FLOW_CHECKPOINTS.slice(0, 3)] });
  });

  it("**refuses a subset or a reordering** — each checkpoint's screen is reached by the ones before it", () => {
    // "Start at the terms screen" is not a shorter run; it is a different one whose first reading nobody has
    // established. A gap in the middle is worse: the flow would be somewhere the plan never accounted for.
    for (const bad of [
      "AFTER_OPERATOR_CONFIRM",
      "PURPOSE_SCREEN_UNTOUCHED,AFTER_OPERATOR_CONFIRM",
      "PURPOSE_OPTION_SELECTED_BY_OPERATOR,PURPOSE_SCREEN_UNTOUCHED",
      "TERMS_CHECKED_BY_OPERATOR",
    ]) {
      const r = resolveWingFlowCheckpoints(bad);
      expect(r.ok, bad).toBe(false);
      if (!r.ok) expect(r.reason).toContain("PREFIX");
    }
  });

  it("reports a COUNT for unknown names, never the tokens", () => {
    const r = resolveWingFlowCheckpoints("PURPOSE_SCREEN_UNTOUCHED,<script>alert(1)</script>");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toContain("1 unrecognized");
      expect(r.reason).not.toContain("script");
    }
  });
});

describe("the 확인 gate is bound to the checkpoint it GUARDS", () => {
  it("**still fires on a plan that omits the selection checkpoint**", async () => {
    // The gate used to be evaluated after PURPOSE_OPTION_SELECTED_BY_OPERATOR by name. A minimal plan that
    // dropped that checkpoint would then have invited the 확인 press with no gate at all — a guard bound to
    // its neighbour's name rather than to the thing it guards.
    const { deps, asked } = fakeFlow({ vendorVisible: true });
    const r = await runWingFlowDiscovery(deps, {
      targets: ALL_TARGETS,
      phase: WING_ISSUANCE_FLOW_DISCOVERY_PHASE,
      checkpoints: ["PURPOSE_SCREEN_UNTOUCHED", "AFTER_OPERATOR_CONFIRM"],
    });
    expect(r.advisory).toBe("STOP_FORM_ALREADY_VISIBLE");
    expect(r.halted).toBe("CONFIRM_ADVISORY_STOP");
    expect(asked).toEqual(["PURPOSE_SCREEN_UNTOUCHED"]);
  });

  it("clears a two-checkpoint plan when the purpose screen reads clean", async () => {
    const { deps, asked, steps } = fakeFlow({ termsFrom: 2 });
    const r = await runWingFlowDiscovery(deps, {
      targets: ALL_TARGETS,
      phase: WING_ISSUANCE_FLOW_DISCOVERY_PHASE,
      checkpoints: ["PURPOSE_SCREEN_UNTOUCHED", "AFTER_OPERATOR_CONFIRM"],
    });
    expect(r.advisory).toBe("ADVANCE_FORM_NOT_YET_REVEALED");
    expect(r.halted).toBeNull();
    expect(asked).toEqual(["PURPOSE_SCREEN_UNTOUCHED", "AFTER_OPERATOR_CONFIRM"]);
    expect(r.readings.map((x) => x.screen)).toEqual(["PURPOSE", "TERMS"]);
    // The step counter follows the PLAN, not the full flow — "1/2", not "1/4".
    expect(steps).toEqual([{ index: 0, total: 2 }, { index: 1, total: 2 }]);
  });
});

/* ══════════════════════════ the guided-walk manifest describes THIS run ══════════════════════════ */

describe("the guided-walk manifest is not the fallback", () => {
  const CLI = readFileSync(resolve(HERE, "../../../src/cli/approval-manifest-cli.ts"), "utf8");

  it("**has its own operation and maxActions branches** — it fell through to the default", () => {
    // Fourth instance of one defect in this workstream. The phase was added everywhere the gate looks and
    // nowhere the OPERATOR looks, so the prepared manifest read "API issuance highlight proof (new-app or
    // existing-app)" and "1 highlight proof session" — a real, displayed, grantable manifest for a different
    // run. Every phase that reaches the operator needs a branch in BOTH.
    expect(CLI).toContain("isWingGuidedWalk\n    ? \"WING GUIDED ISSUANCE WALK");
    expect(CLI).toContain("isWingGuidedWalk\n    ? \"operator-performed: the whole tutorial");
  });

  it("the operation names the boundary, the two highlight classes, and what is out of scope", () => {
    const from = CLI.indexOf('isWingGuidedWalk\n    ? "WING GUIDED ISSUANCE WALK');
    const op = CLI.slice(from, CLI.indexOf("\n    : isWingReveal", from));
    expect(op).toContain("CREATES THE KEY");
    expect(op).toContain("never pressed");
    expect(op).toContain("separate phase");
    expect(op).toContain("TEXT-GUIDES");
    expect(op).toContain("drawing no ring");
    expect(op).toContain("NAVIGATES nothing");
    expect(op).toContain("no connect-test, no sync");
  });

  it("the maxActions budget counts zero presses of the key-creating control", () => {
    const from = CLI.indexOf('isWingGuidedWalk\n    ? "operator-performed: the whole tutorial');
    const max = CLI.slice(from, CLI.indexOf("\n    : isWingReveal", from));
    expect(max).toContain("0 presses of the key-creating");
    expect(max).toContain("0 navigations");
    expect(max).toContain("2 highlights");
    expect(max).toContain("4 text-guided");
  });
});

/* ══════════════════════════ the text-guided steps have a presentation of their own ══════════════════════════ */

describe("stale spotlight — the defect the dev-host live proof surfaced", () => {
  const DRV = readFileSync(resolve(HERE, "../../../src/action-window/coupang-wing-issuance-driver.ts"), "utf8");
  const OVL = readFileSync(resolve(HERE, "../../../src/action-window/overlay.ts"), "utf8");

  it("**a text-guided step clears the prior tag BEFORE mounting**", () => {
    // Live-confirmed 2026-08-10: it did not, so `mountOverlay` found the PREVIOUS step's `data-aw-target` —
    // still on `API Key 발급 받기` — removed the old box and rebuilt it in the same place with this step's
    // text. The operator saw a ring on one control while the panel described another, three steps running.
    const body = DRV.slice(DRV.indexOf("  async highlightTarget("));
    const fn = body.slice(0, body.indexOf("\n  /**"));
    const clearIdx = fn.indexOf("IN_PAGE_CLEAR_TAG");
    const mountIdx = fn.indexOf("this.mountStepOverlay(page, target, true)");
    expect(clearIdx).toBeGreaterThan(-1);
    expect(mountIdx).toBeGreaterThan(-1);
    // Order is the property: clearing AFTER the mount would leave the ring drawn for the step's whole life.
    expect(clearIdx).toBeLessThan(mountIdx);
  });

  it("**panel-only mode does not bail on a missing anchor** — otherwise the step shows nothing at all", () => {
    // The other half. `mountOverlay` returns early when `querySelector("[data-aw-target]")` is null, so once
    // the tag is cleared a text-guided step would render neither ring nor panel. Clearing alone would have
    // replaced a misplaced panel with no panel.
    expect(OVL).toContain("if (!target && !o.dockedPanelOnly) {");
    // …and it must IGNORE a stale anchor rather than look one up: using it is the defect.
    expect(OVL).toContain('const target = o.dockedPanelOnly ? null : document.querySelector("[data-aw-target]");');
  });

  it("docked mode draws no ring, no dimming and no badge — it claims no location", () => {
    const from = OVL.indexOf("if (o.dockedPanelOnly) {");
    const block = OVL.slice(from, OVL.indexOf("}", OVL.indexOf("box.style.height", from)));
    expect(block).toContain('box.style.border = "none"');
    expect(block).toContain('box.style.boxShadow = "none"');
    expect(OVL).toContain("if (o.dockedPanelOnly) badge.style.display = \"none\";");
    // Nothing is scrolled either: moving the seller's view toward a control we cannot locate is a claim too.
    expect(OVL).toContain("if (target) (target as Element).scrollIntoView(");
  });

  it("the mode is ADDITIVE and OFF by default — the renewal and deletion drivers are untouched", () => {
    // `overlay.ts` is shared. Every existing caller must keep the anchored ring it has today.
    expect(OVL).toContain("dockedPanelOnly?: boolean;");
    for (const f of ["coupang-wing-renewal-driver.ts", "coupang-wing-deletion-driver.ts"]) {
      const src = readFileSync(resolve(HERE, `../../../src/action-window/${f}`), "utf8");
      expect(src, f).not.toContain("dockedPanelOnly");
    }
    // …and the issuance driver passes it ONLY on the text-guided path.
    expect(DRV.split("dockedPanelOnly").length - 1).toBeLessThanOrEqual(4);
  });

  it("only CALIBRATED targets are spotlit — the two with a locator, and no others", () => {
    const guided = DRV.slice(DRV.indexOf("const TEXT_GUIDED_SIG"), DRV.indexOf("};", DRV.indexOf("const TEXT_GUIDED_SIG")));
    for (const t of ["purpose_option", "confirm_purpose", "terms_consent", "issue_final"]) {
      expect(guided, t).toContain(t);
    }
    for (const t of ["issue:", "credentials:"]) expect(guided).not.toContain(t);
  });
});
