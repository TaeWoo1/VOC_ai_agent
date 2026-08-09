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
  WING_FLOW_LAST_CHECKPOINT,
  WING_KEY_CREATION_CONTROL_ID,
  WING_CHOICE_LABEL_CANDIDATES,
  WING_STAGE3_TERMS_OPTION_CANDIDATES,
  WING_STAGE2_RECON_CANDIDATES,
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
import { observeFrom, type WingStructuralCensus } from "../../../src/cli/coupang-wing-classifier";
import {
  CALIBRATION_PHASES,
  WING_STAGE2_MANIFEST_PHASES,
  WING_PHASES,
  PHASE_ENTRYPOINTS,
  PHASE_SPECS,
} from "../../../src/cli/approval-manifest";

const HERE = dirname(fileURLToPath(import.meta.url));

/* ══════════════════════════ the 확인 gate ══════════════════════════ */

const vendorSeen = (presence: WingStage2Presence): { id: string; presence: WingStage2Presence }[] =>
  WING_VENDOR_FORM_CANDIDATE_IDS.map((id) => ({ id, presence }));

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
  });

  it("only ONE of its three values lets the run continue", () => {
    // Stated as a property rather than left implicit in the branches: a fourth advisory added later has to
    // decide, explicitly, whether it is a go — the default must never be "proceed".
    const advancing = WING_CONFIRM_ADVISORIES.filter((a) => !a.startsWith("STOP_"));
    expect(advancing).toEqual(["ADVANCE_FORM_NOT_YET_REVEALED"]);
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
 * A fake WING whose vendor labels are hidden until `revealAfter` reads have been taken. That is the live page's
 * shape as measured three times: the form exists in the DOM and does not paint.
 */
function fakeFlow(over: { revealAfter?: number; signals?: readonly ("ready" | "abort" | "timeout")[]; choiceControls?: number } = {}) {
  const asked: WingFlowCheckpoint[] = [];
  let reads = 0;
  const signals = over.signals ?? (["ready", "ready", "ready", "ready"] as const);
  let waits = 0;
  const visibleNow = (): boolean => over.revealAfter !== undefined && reads > over.revealAfter;
  const deps: WingSelectorRecordDeps = {
    waitForReady: async () => signals[waits++] ?? "timeout",
    observeSurface: async () => {
      reads += 1;
      return observeFrom("wing_host", { ...CENSUS, choiceControlCount: over.choiceControls ?? 2 });
    },
    probeTarget: async () => {
      throw new Error("a discovery run probes no shipped locator");
    },
    probeCandidate: async (spec) => {
      const isVendor = ["업체명", "URL", "IP 주소"].includes(spec.exactText);
      return isVendor && visibleNow() ? { matchCount: 1, canHighlight: true } : { matchCount: 0, canHighlight: false };
    },
    probeContainment: async (spec) => {
      const isVendor = ["업체명", "URL", "IP 주소"].includes(spec.exactText);
      return isVendor
        ? visibleNow()
          ? { exactVisible: 1, exactHidden: 0, deepestContainsVisible: 1, deepestContainsHidden: 0, scanTruncated: false }
          : { exactVisible: 0, exactHidden: 2, deepestContainsVisible: 0, deepestContainsHidden: 3, scanTruncated: false }
        : { exactVisible: 0, exactHidden: 0, deepestContainsVisible: 0, deepestContainsHidden: 0, scanTruncated: false };
    },
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
    announceCheckpoint: (c) => asked.push(c),
  };
  return { deps, asked, reads: () => reads };
}

const ALL_TARGETS = ["purpose", "self_dev", "vendor_info", "vendor_url", "call_ip", "confirm"] as const;

describe("runWingFlowDiscovery — one reading per operator-advanced checkpoint", () => {
  it("takes every checkpoint when the form stays hidden, and reports the reveal", async () => {
    // The form appears only at the THIRD read — i.e. 확인 opened it, which is the outcome the flow description
    // predicts and no run has yet observed.
    const { deps, asked } = fakeFlow({ revealAfter: 2 });
    const r = await runWingFlowDiscovery(deps, { targets: ALL_TARGETS, phase: WING_ISSUANCE_FLOW_DISCOVERY_PHASE });
    expect(r.readings.map((x) => x.checkpoint)).toEqual([...WING_FLOW_CHECKPOINTS]);
    expect(r.readings[r.readings.length - 1]!.checkpoint).toBe(WING_FLOW_LAST_CHECKPOINT);
    expect(asked).toEqual([...WING_FLOW_CHECKPOINTS]);
    expect(r.advisory).toBe("ADVANCE_FORM_NOT_YET_REVEALED");
    expect(r.halted).toBeNull();
    expect(r.aborted).toBe(false);
    expect([...r.revealedCandidateIds].sort()).toEqual([...WING_VENDOR_FORM_CANDIDATE_IDS].sort());
    expect(r.agentSelections).toBe(0);
  });

  it("**HALTS before checkpoint 3 is even ANNOUNCED when the form is already visible**", async () => {
    // The property this whole phase is built around. Not "warns", not "asks the operator to decide" — the
    // instruction to press 확인 is never printed, because printing it is the harm. An operator who is told to
    // press a button generally presses it.
    const { deps, asked } = fakeFlow({ revealAfter: 1 });
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
    const { deps } = fakeFlow({ revealAfter: 0 });
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
    const { deps } = fakeFlow({ revealAfter: 2 });
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
    const { deps } = fakeFlow({ revealAfter: 2 });
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
    expect(block).toContain("CREATES THE KEY");
    expect(block).toContain("HALTS");
    expect(block).toContain("fail-closed");
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
    const { deps } = fakeFlow({ revealAfter: 99 });
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
    const from = src.indexOf('console.error("DISCOVERY 4/4');
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
    const { deps } = fakeFlow({ revealAfter: 99 });
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

  it("**states the checkpoint count from the CONSTANT, not from prose**", () => {
    // Found by RUNNING the harness, not by reading it: the manifest said "3 read-only checkpoint readings" and
    // the warning said "Three checkpoints" while the code had four — and the undescribed fourth is the one
    // standing in front of the key-creating button. A hand-typed count in a safety document drifts the moment
    // the code moves, so the guard is the TIE, not the number.
    const branch = CLI_SRC.slice(CLI_SRC.indexOf("isWingFlowDiscovery\n    ? \"operator-performed"));
    const maxActions = branch.slice(0, branch.indexOf("\n    : isWingReveal"));
    expect(maxActions).toContain("${WING_FLOW_CHECKPOINTS.length} read-only checkpoint readings");
    expect(maxActions).toContain("WING_FLOW_CHECKPOINTS.join");
    // A literal count anywhere in that string is the defect coming back.
    expect(maxActions).not.toMatch(/\b[0-9]+ read-only checkpoint readings/);
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

  it("the agent's declared action list gained NOTHING for this phase", () => {
    // The whole justification for reusing the calibration's capability set is that discovery reads the same
    // eight things. A ninth here means the phase stopped being what its manifest says it is.
    expect([...SPEC.capableActions]).toEqual([...PHASE_SPECS.COUPANG_WING_STAGE2_LABEL_CALIBRATION.capableActions]);
    expect(SPEC.mode).toBe("READ_ONLY");
    expect(SPEC.allowsHighlight).toBe(false);
  });

  it("the preflight warning counts the checkpoints the same way the manifest does", () => {
    // Two documents, one flow. The prose said "Three" while the constant said four.
    const src = readFileSync(resolve(HERE, "../../../../tools/coupang-local/wing-probe-preflight.sh"), "utf8");
    const from = src.indexOf('if [ "$PHASE" = "COUPANG_WING_ISSUANCE_FLOW_DISCOVERY" ]; then');
    const block = src.slice(from, src.indexOf('elif is_stage2_phase "$PHASE"; then', from));
    for (let i = 1; i <= WING_FLOW_CHECKPOINTS.length; i++) expect(block, `step ${i}`).toContain(`${i})`);
    expect(block).not.toContain(`${WING_FLOW_CHECKPOINTS.length + 1})`);
    expect(block).toContain("KEY-CREATION control");
    expect(block).toContain("no fifth checkpoint");
  });
});
