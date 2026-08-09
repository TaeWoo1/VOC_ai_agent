/**
 * **The STAGE-2 READ_ONLY recon: scope, precondition, shape census, and the sanitization boundary.**
 *
 * What makes this surface different from every earlier WING recon is not the agent's capability — it is still
 * read-only, still counts only — but the SCREEN. The operator reaches it by pressing a real marketplace control,
 * and the final, key-creating `확인` is reachable from it. So the properties worth testing are the ones that
 * keep a run on that screen from doing, measuring, or claiming more than the manifest said.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  WING_STAGE2_RECON_CANDIDATES,
  WING_STAGE2_RECON_TARGETS,
  interpretWingStage2Recon,
  isWingStage2ReconTarget,
  resolveWingStage2ReconScope,
  wingStage2Precondition,
  wingStage2ReconProbes,
  UnknownWingReconTargetError,
} from "../../../src/action-window/coupang-wing-label-recon";
import {
  EXTRACT_WING_CHOICE_CONTROL_SHAPES,
  WING_CONTROL_INPUT_TYPES,
  WING_CONTROL_ROLES,
  WING_CONTROL_TAGS,
  WING_PROBE_TARGET_NAMES,
  observeFrom,
  sanitizeChoiceControlCensus,
  type WingStructuralCensus,
  type WingObservation,
} from "../../../src/cli/coupang-wing-classifier";
import {
  resolveWingStage2Scope,
  runWingSelectorRecord,
  stage2RefusalMessage,
  type WingSelectorRecordDeps,
} from "../../../src/cli/probe-wing-issuance-selectors";

const HERE = dirname(fileURLToPath(import.meta.url));

const BASE: WingStructuralCensus = {
  passwordFieldPresent: false,
  submitAffordancePresent: false,
  dialogLikePresent: false,
  choiceControlCount: 0,
  actionControlCount: 3,
  formCount: 2,
  editableTextInputCount: 6,
  readonlyFieldCount: 0,
  listLikeContainerCount: 5,
  markerScanTruncated: false,
  openApiMarkerPresent: true,
  credentialAnchorPresent: true,
};
const obs = (over: Partial<WingStructuralCensus> = {}) => observeFrom("wing_host", { ...BASE, ...over });

/* ────────────────────────────── scope ────────────────────────────── */

describe("Stage-2 recon scope — its own namespace, fail-closed", () => {
  it("defaults to the full Stage-2 set and narrows within it", () => {
    expect(resolveWingStage2ReconScope(undefined)).toEqual({ ok: true, targets: [...WING_STAGE2_RECON_TARGETS] });
    expect(resolveWingStage2ReconScope("  ")).toEqual({ ok: true, targets: [...WING_STAGE2_RECON_TARGETS] });
    expect(resolveWingStage2ReconScope("confirm,purpose")).toEqual({ ok: true, targets: ["purpose", "confirm"] });
  });

  it("refuses an unknown token, and reports a COUNT rather than echoing it", () => {
    const r = resolveWingStage2ReconScope("purpose,<script>alert(1)</script>");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toContain("1 unrecognized");
      expect(r.reason).not.toContain("script");
      expect(r.reason).not.toContain("alert");
    }
  });

  it("does NOT accept canonical PROBE target names it does not own", () => {
    // `issue`, `credentials` and `delete` are shipped-locator targets with no Stage-2 candidate set. Accepting
    // them would sweep nothing while the manifest said otherwise.
    for (const t of ["issue", "credentials", "delete"]) {
      expect(isWingStage2ReconTarget(t)).toBe(false);
      expect(resolveWingStage2ReconScope(t).ok).toBe(false);
    }
  });

  it("keeps the two namespaces separate — Stage-2-only names are never canonical probe targets", () => {
    // If these ever became probe targets, an ordinary selector probe could be pointed at them, which is a wider
    // blast radius than this unit asked for.
    for (const t of ["purpose", "vendor_url", "confirm"]) {
      expect(WING_PROBE_TARGET_NAMES as readonly string[]).not.toContain(t);
    }
  });

  it("canonicalises order, so the manifest and the sweep describe the same set the same way", () => {
    const r = resolveWingStage2ReconScope("confirm,call_ip,purpose");
    expect(r.ok && r.targets).toEqual(["purpose", "call_ip", "confirm"]);
  });
});

/* ────────────────────────────── the precondition ────────────────────────────── */

describe("the Stage-2 precondition — refuse to measure Stage-2 labels on a non-Stage-2 screen", () => {
  it("passes only when a choice control is actually visible", () => {
    expect(wingStage2Precondition(obs({ choiceControlCount: 2 }))).toBe("OK");
    expect(wingStage2Precondition(obs({ choiceControlCount: 40 }))).toBe("OK");
  });

  it("refuses the INITIAL surface — the exact reading the reveal run recorded before the press", () => {
    // `choiceControlCountBucket: none` is what the live baseline reported. Sweeping six Stage-2 hypotheses here
    // would return six confident ABSENT verdicts for a screen nobody was looking at.
    expect(wingStage2Precondition(obs({ choiceControlCount: 0 }))).toBe("NO_VISIBLE_CHOICE_CONTROL");
  });

  it("refuses a non-open-API surface and an absent observation", () => {
    expect(wingStage2Precondition(null)).toBe("NOT_OBSERVED");
    const login = observeFrom("wing_host", { ...BASE, passwordFieldPresent: true, choiceControlCount: 2 });
    expect(wingStage2Precondition(login)).toBe("NOT_OPEN_API_SURFACE");
  });

  it("treats an UNMEASURED choice-control signal as unobserved, not as an empty Stage-2", () => {
    // `undefined` is not a measured zero — the distinction this whole workstream keeps relearning. A census that
    // never emitted the field cannot satisfy the precondition, and must not fail it for the wrong reason either.
    const { choiceControlCount: _c, ...noChoice } = BASE;
    expect(wingStage2Precondition(observeFrom("wing_host", noChoice))).toBe("NOT_OBSERVED");
  });
});

/* ────────────────────────────── the sweep ────────────────────────────── */

describe("the Stage-2 sweep folds like the initial-surface one", () => {
  it("probes every candidate of every requested target, and nothing else", () => {
    const specs = wingStage2ReconProbes(["purpose", "confirm"]);
    const ids = specs.map((s) => s.targetId);
    expect(ids).toEqual(["stage2.purpose.operator_reported", "stage2.confirm.confirm"]);
    // Every string sent to the page is one WE wrote — a candidate's own frozen fields.
    for (const s of specs) {
      const all = Object.values(WING_STAGE2_RECON_CANDIDATES).flat();
      const c = all.find((x) => x.id === s.targetId)!;
      expect(s.exactText).toBe(c.exactText);
      expect(s.candidateQuery).toBe(c.candidateQuery);
    }
  });

  it("every Stage-2 candidateQuery is a plain structural tag list", () => {
    // Neither in-page script distinguishes "querySelectorAll threw" from "nothing matched" — both report 0 — so
    // validity is proven HERE over constants, exactly as the initial-surface sets already are. Comma-separated
    // bare element names only: no attribute pin, no pseudo-class, nothing that could read a value.
    const ALLOWED = /^[a-z0-9]+(,[a-z0-9]+)*$/;
    for (const c of Object.values(WING_STAGE2_RECON_CANDIDATES).flat()) {
      expect(ALLOWED.test(c.candidateQuery), `${c.id} = ${JSON.stringify(c.candidateQuery)}`).toBe(true);
    }
    for (const bad of ["label,", ",label", "label,,span", "input[value]", "[data-x='a']", "label:has(> b)", ""]) {
      expect(ALLOWED.test(bad), bad).toBe(false);
    }
  });

  it("a MISSING row is NOT_MEASURED, never a measured absence", () => {
    const [one] = interpretWingStage2Recon(["confirm"], []);
    expect(one!.candidates[0]!.verdict).toBe("NOT_MEASURED");
    expect(one!.candidates[0]!.matchCount).toBeNull();
    expect(one!.resolvedUnambiguously).toBe(false);
  });

  it("a unique match resolves and carries its sig; two uniques do NOT resolve", () => {
    const [r] = interpretWingStage2Recon(["self_dev"], [
      { targetId: "stage2.self_dev.direct", matchCount: 1, sig: "abcdef0123456789" },
      { targetId: "stage2.self_dev.baseline", matchCount: 0 },
    ]);
    expect(r!.resolvedUnambiguously).toBe(true);
    expect(r!.candidates.find((c) => c.id === "stage2.self_dev.direct")!.sig16).toBe("abcdef0123456789");

    const [amb] = interpretWingStage2Recon(["self_dev"], [
      { targetId: "stage2.self_dev.direct", matchCount: 1, sig: "aaaaaaaaaaaaaaaa" },
      { targetId: "stage2.self_dev.baseline", matchCount: 1, sig: "bbbbbbbbbbbbbbbb" },
    ]);
    expect(amb!.resolvedUnambiguously).toBe(false);
    expect(amb!.uniqueCandidateIds).toHaveLength(2);
  });

  it("THROWS on a target it does not own, rather than silently sweeping fewer", () => {
    // Matching the initial-surface screener. A silent filter would mean the sweep measured less than the
    // manifest described, with nothing anywhere saying so.
    for (const bad of ["issue", "delete", "", "__proto__"]) {
      expect(() => wingStage2ReconProbes([bad as never]), bad).toThrow(UnknownWingReconTargetError);
      expect(() => interpretWingStage2Recon([bad as never], []), bad).toThrow(UnknownWingReconTargetError);
    }
    // …and the error message stays value-free: the offending token may be operator-supplied.
    try {
      wingStage2ReconProbes(["<script>" as never]);
    } catch (e) {
      expect((e as Error).message).toBe("UNKNOWN_RECON_TARGET");
    }
  });

  it("de-duplicates a repeated target — the same page work twice yields no new information", () => {
    expect(wingStage2ReconProbes(["confirm", "confirm"])).toHaveLength(1);
  });
});

/* ────────────────────────────── the shape census ────────────────────────────── */

/** A DOM double good enough for the real generated script — the same approach the census tests already use. */
class FakeEl {
  constructor(
    public tagName: string,
    private attrs: Record<string, string> = {},
    public visible = true,
    public disabled = false,
    public type = "",
  ) {}
  childElementCount = 1;
  getAttribute(n: string): string | null {
    return Object.prototype.hasOwnProperty.call(this.attrs, n) ? this.attrs[n]! : null;
  }
  getClientRects(): { length: number }[] {
    return this.visible ? [{ length: 1 }] : [];
  }
  getBoundingClientRect(): { width: number; height: number } {
    return this.visible ? { width: 10, height: 10 } : { width: 0, height: 0 };
  }
}

function runShapeScript(nodes: FakeEl[], groups: FakeEl[] = []): unknown {
  const doc = {
    querySelectorAll(sel: string): FakeEl[] {
      if (sel.includes("fieldset")) return groups;
      if (sel.includes("radio")) return nodes;
      return [];
    },
  };
  const win = { getComputedStyle: () => ({ display: "block", visibility: "visible" }) };
  return new Function("document", "window", `return (${EXTRACT_WING_CHOICE_CONTROL_SHAPES});`)(doc, win);
}

describe("the choice-control shape census — categories and integers, nothing else", () => {
  it("buckets by (tag, inputType, role) and counts, over the REAL shipped script", () => {
    const out = runShapeScript([
      new FakeEl("INPUT", {}, true, false, "radio"),
      new FakeEl("INPUT", {}, true, false, "radio"),
      new FakeEl("DIV", { role: "option" }),
    ]) as { visibleChoiceControlCount: number; shapes: { tag: string; inputType: string; role: string; count: number }[] };
    expect(out.visibleChoiceControlCount).toBe(3);
    expect(out.shapes[0]).toEqual({ tag: "INPUT", inputType: "radio", role: "none", count: 2 });
    expect(out.shapes[1]).toEqual({ tag: "DIV", inputType: "none", role: "option", count: 1 });
  });

  it("separates NOT-PAINTING and DISABLED controls from visible ones", () => {
    // "0 visible" and "0 present" are different findings — indistinguishable readings are what broke the
    // `issue` locator's first calibration.
    const out = runShapeScript([
      new FakeEl("INPUT", {}, false, false, "radio"),
      new FakeEl("INPUT", { "aria-disabled": "true" }, true, false, "radio"),
      new FakeEl("INPUT", {}, true, true, "checkbox"),
    ]) as { visibleChoiceControlCount: number; hiddenChoiceControlCount: number };
    expect(out.visibleChoiceControlCount).toBe(0);
    expect(out.hiddenChoiceControlCount).toBe(3);
  });

  it("maps anything off-vocabulary to the catch-all — the page never picks our strings", () => {
    const out = runShapeScript([
      new FakeEl("CUSTOM-CARD", { role: "사용목적-자체개발" }),
      new FakeEl("INPUT", {}, true, false, "color"),
    ]) as { shapes: { tag: string; inputType: string; role: string }[] };
    const json = JSON.stringify(out);
    expect(json).not.toContain("CUSTOM-CARD");
    expect(json).not.toContain("사용목적");
    expect(json).not.toContain("color");
    for (const s of out.shapes) {
      expect(WING_CONTROL_TAGS as readonly string[]).toContain(s.tag);
      expect(WING_CONTROL_INPUT_TYPES as readonly string[]).toContain(s.inputType);
      expect(WING_CONTROL_ROLES as readonly string[]).toContain(s.role);
    }
  });

  it("counts painting group containers", () => {
    const out = runShapeScript([], [new FakeEl("FIELDSET"), new FakeEl("DIV", { role: "radiogroup" }, false)]) as {
      groupContainerCount: number;
    };
    expect(out.groupContainerCount).toBe(1);
  });

  it("the script reads no text, no value, and no identifying attribute", () => {
    // A source guard, because the sanitization argument is about what the script CAN return, not what one
    // fixture happened to produce.
    for (const forbidden of ["textContent", "innerText", "innerHTML", "outerHTML", ".value", "placeholder", "getAttribute('id')", "className", "aria-label", "dataset"]) {
      expect(EXTRACT_WING_CHOICE_CONTROL_SHAPES, `${forbidden} must not appear in the shape census`).not.toContain(forbidden);
    }
    // …and it never reports `checked`, which would leak whether the operator selected something.
    expect(EXTRACT_WING_CHOICE_CONTROL_SHAPES).not.toContain("checked");
  });

  it("the script is a STRING, not a function — esbuild's __name shim would break it in-page", () => {
    expect(typeof EXTRACT_WING_CHOICE_CONTROL_SHAPES).toBe("string");
    expect(EXTRACT_WING_CHOICE_CONTROL_SHAPES.startsWith("(function ()")).toBe(true);
  });

  it("host-side sanitization re-validates the vocabulary even if the script returns junk", () => {
    const dirty = sanitizeChoiceControlCensus({
      visibleChoiceControlCount: -5,
      hiddenChoiceControlCount: 2.7,
      shapes: [{ tag: "<img src=x>", inputType: "업체명", role: { evil: true }, count: "3" }],
      groupContainerCount: null,
      scanTruncated: "yes",
    });
    expect(dirty.visibleChoiceControlCount).toBe(0);
    expect(dirty.hiddenChoiceControlCount).toBe(2);
    expect(dirty.shapes[0]).toEqual({ tag: "OTHER", inputType: "other", role: "other", count: 0 });
    expect(dirty.groupContainerCount).toBe(0);
    // A non-boolean must not become a truthy claim of truncation.
    expect(dirty.scanTruncated).toBe(false);
    expect(JSON.stringify(dirty)).not.toContain("img");
    expect(JSON.stringify(dirty)).not.toContain("업체명");
  });

  it("bounds the number of shape buckets it will carry", () => {
    const many = Array.from({ length: 200 }, () => ({ tag: "INPUT", inputType: "radio", role: "none", count: 1 }));
    expect(sanitizeChoiceControlCensus({ shapes: many }).shapes.length).toBeLessThanOrEqual(64);
  });
});

/* ────────────────────────────── promotion stays impossible ────────────────────────────── */

describe("a Stage-2 reading changes no shipped selector", () => {
  it("the recon module still contains no promotion path", () => {
    // Comment lines stripped first — the module DISCUSSES the shipped labels at length, and prose mentioning a
    // symbol has produced false failures in this repo before (`collector/CLAUDE.md` §5).
    const src = readFileSync(resolve(HERE, "../../../src/action-window/coupang-wing-label-recon.ts"), "utf8")
      .split("\n")
      .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
      .join("\n");
    expect(src).not.toContain("WING_HIGHLIGHT_LABELS");
    expect(src).not.toContain("WING_DELETION_LABELS");
  });

  it("the operator-reported Stage-2 sentence is still a candidate, not a census marker", () => {
    const purpose = WING_STAGE2_RECON_CANDIDATES.purpose;
    expect(purpose.some((c) => c.exactText === "이제 키의 사용 목적을 골라주세요.")).toBe(true);
    expect(EXTRACT_WING_CHOICE_CONTROL_SHAPES).not.toContain("사용 목적");
  });

  it("every Stage-2 candidate object is deeply frozen", () => {
    // `readonly` is erased at runtime; without freezing, a candidate's `exactText` can be reassigned and that
    // string goes straight into the page.
    for (const set of Object.values(WING_STAGE2_RECON_CANDIDATES)) {
      expect(Object.isFrozen(set)).toBe(true);
      for (const c of set) {
        expect(Object.isFrozen(c)).toBe(true);
        expect(() => {
          (c as { exactText: string }).exactText = "mutated";
        }).toThrow();
      }
    }
  });
});

/* ────────────────────────────── the gate and the orchestration ────────────────────────────── */

describe("the Stage-2 phase gate — a Stage-2 manifest can never run something else", () => {
  const P = "SELLEROPS_APPROVAL_PHASE";
  const A = "SELLEROPS_WING_APPROVED_PHASE";
  const S2 = "COUPANG_WING_STAGE2_RECON";

  it("arms only when BOTH phase variables name the Stage-2 phase", () => {
    const r = resolveWingStage2Scope({ [P]: S2, [A]: S2 });
    expect(r).toEqual({ requested: true, ok: true, targets: [...WING_STAGE2_RECON_TARGETS] });
  });

  it("is inert when neither names it — an ordinary probe run is unaffected", () => {
    expect(resolveWingStage2Scope({})).toEqual({ requested: false });
    expect(resolveWingStage2Scope({ [P]: "COUPANG_WING_SELECTOR_PROBE", [A]: "COUPANG_WING_SELECTOR_PROBE" })).toEqual({
      requested: false,
    });
  });

  it("REFUSES a one-sided phase in BOTH directions", () => {
    // The direction that matters most: an approved Stage-2 manifest whose phase did not reach the run would
    // otherwise fall through to a baseline probe — measuring the three shipped labels on the Stage-2 screen,
    // printing a record, and exiting 0 on a grant nobody gave for that.
    const missingRun = resolveWingStage2Scope({ [A]: S2 });
    expect(missingRun).toMatchObject({ requested: true, ok: false, refusal: "PHASE_APPROVAL_MISMATCH" });
    const missingApproved = resolveWingStage2Scope({ [P]: S2 });
    expect(missingApproved).toMatchObject({ requested: true, ok: false, refusal: "PHASE_APPROVAL_MISMATCH" });
  });

  it("ignores inherited (non-own) properties and non-string values", () => {
    const inherited = Object.create({ [P]: S2, [A]: S2 }) as Record<string, string | undefined>;
    expect(resolveWingStage2Scope(inherited)).toEqual({ requested: false });
    expect(resolveWingStage2Scope({ [P]: S2, [A]: 1 as unknown as string })).toMatchObject({ ok: false });
  });

  it("matches the phase EXACTLY — no trimming, matching the shell allowlist that authorizes it", () => {
    expect(resolveWingStage2Scope({ [P]: ` ${S2} `, [A]: ` ${S2} ` })).toEqual({ requested: false });
    expect(resolveWingStage2Scope({ [P]: S2.toLowerCase(), [A]: S2.toLowerCase() })).toEqual({ requested: false });
  });

  it("refuses an unknown Stage-2 scope token without echoing it", () => {
    const r = resolveWingStage2Scope({ [P]: S2, [A]: S2, SELLEROPS_WING_STAGE2_TARGETS: "purpose,rm -rf /" });
    expect(r).toMatchObject({ requested: true, ok: false, refusal: "STAGE2_TARGET_UNKNOWN" });
    if (r.requested && !r.ok) expect(r.reason).not.toContain("rm -rf");
  });

  it("the refusal message carries the enum and the token-free reason only", () => {
    const msg = stage2RefusalMessage("PHASE_APPROVAL_MISMATCH", "a token-free reason");
    expect(msg).toContain("PHASE_APPROVAL_MISMATCH");
    expect(msg).toContain("No browser launched.");
  });
});

describe("runWingSelectorRecord — the Stage-2 sweep in the orchestrator", () => {
  function deps(over: Partial<WingSelectorRecordDeps> & { observation?: WingObservation } = {}) {
    const probed: { candidateQuery: string; exactText: string }[] = [];
    const baseline: string[] = [];
    let censusCalls = 0;
    const d: WingSelectorRecordDeps = {
      waitForReady: async () => "ready",
      observeSurface: async () => over.observation ?? obs({ choiceControlCount: 2 }),
      probeTarget: async (t) => {
        baseline.push(t);
        return { matchCount: 0, canHighlight: false };
      },
      probeCandidate: async (spec) => {
        probed.push(spec);
        return { matchCount: 1, canHighlight: true, sig: "0123456789abcdef" };
      },
      choiceControlCensus: async () => {
        censusCalls += 1;
        return sanitizeChoiceControlCensus({ visibleChoiceControlCount: 2, shapes: [], groupContainerCount: 1 });
      },
      ...over,
    };
    return { d, probed, baseline, censusCalls: () => censusCalls };
  }

  it("sweeps the Stage-2 candidates and takes the shape census", async () => {
    const { d, probed, censusCalls } = deps();
    const r = await runWingSelectorRecord(d, [], { stage2: ["purpose", "confirm"] });
    expect(r.stage2?.precondition).toBe("OK");
    expect(probed).toHaveLength(2);
    expect(censusCalls()).toBe(1);
    expect(r.stage2?.candidatesMeasured).toBe(2);
    expect(r.stage2?.choiceControls?.visibleChoiceControlCount).toBe(2);
  });

  it("a FAILED precondition runs NO candidate probe and NO census", async () => {
    // The property the precondition exists for: not "reports a warning", but "does not measure". Six confident
    // ABSENT verdicts for a screen nobody was looking at is worse evidence than none.
    const { d, probed, censusCalls } = deps({ observation: obs({ choiceControlCount: 0 }) });
    const r = await runWingSelectorRecord(d, [], { stage2: [...WING_STAGE2_RECON_TARGETS] });
    expect(r.stage2?.precondition).toBe("NO_VISIBLE_CHOICE_CONTROL");
    expect(r.stage2?.targets).toEqual([]);
    expect(probed).toEqual([]);
    expect(censusCalls()).toBe(0);
  });

  it("a Stage-2 run probes NO shipped baseline target", async () => {
    const { d, baseline } = deps();
    await runWingSelectorRecord(d, [], { stage2: ["purpose"] });
    expect(baseline).toEqual([]);
  });

  it("an ABORT records no Stage-2 sweep at all — null, not an empty one", async () => {
    const { d } = deps({ waitForReady: async () => "abort" });
    const r = await runWingSelectorRecord(d, [], { stage2: ["purpose"] });
    expect(r.stage2).toBeNull();
    expect(r.aborted).toBe(true);
  });

  it("an ordinary run carries no Stage-2 sweep", async () => {
    const { d } = deps();
    expect((await runWingSelectorRecord(d, [], {})).stage2).toBeNull();
  });

  it("a candidate whose probe THREW is NOT_MEASURED, and the fault is recorded separately", async () => {
    const { d } = deps({
      probeCandidate: async () => {
        throw new Error("Execution context was destroyed");
      },
    });
    const r = await runWingSelectorRecord(d, [], { stage2: ["confirm"] });
    expect(r.stage2?.candidatesNotMeasured).toBe(1);
    expect(r.stage2?.candidatesMeasured).toBe(0);
    expect(r.stage2?.faults[0]?.fault).toBe("CONTEXT_DESTROYED");
  });

  it("a census that THREW is null with a fault — never a fabricated zero-control reading", async () => {
    const { d } = deps({
      choiceControlCensus: async () => {
        throw new Error("Target closed");
      },
    });
    const r = await runWingSelectorRecord(d, [], { stage2: ["confirm"] });
    expect(r.stage2?.choiceControls).toBeNull();
    expect(r.stage2?.choiceControlFault).toBe("TARGET_CLOSED");
    // …and the candidate sweep still completed: one failed read does not lose the rest of the record.
    expect(r.stage2?.candidatesMeasured).toBe(1);
  });

  it("a missing census seam leaves the reading null rather than throwing", async () => {
    const { d } = deps();
    const { choiceControlCensus: _drop, ...withoutCensus } = d;
    const r = await runWingSelectorRecord(withoutCensus, [], { stage2: ["confirm"] });
    expect(r.stage2?.choiceControls).toBeNull();
    expect(r.stage2?.choiceControlFault).toBeNull();
  });
});
