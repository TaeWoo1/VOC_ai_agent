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
  WING_STAGE2_RECON_EVIDENCE,
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
  stage2RecordFor,
  type WingSelectorRecordDeps,
} from "../../../src/cli/probe-wing-issuance-selectors";
import { CoupangWingIssuanceDriver } from "../../../src/action-window/coupang-wing-issuance-driver";

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
    expect(ids).toEqual([
      "stage2.purpose.operator_reported",
      "stage2.purpose.operator_verbatim",
      "stage2.confirm.confirm",
      // Added 2026-08-11: the same 확인 label under an actionable-only query, the shape a ring would have to
      // point with. Swept beside the broad baseline rather than replacing it — see the candidate's rationale.
      "stage2.confirm.actionable",
    ]);
    // Every string sent to the page is one WE wrote — a candidate's own frozen fields.
    for (const s of specs) {
      const all = Object.values(WING_STAGE2_RECON_CANDIDATES).flat();
      const c = all.find((x) => x.id === s.targetId)!;
      expect(s.exactText).toBe(c.exactText);
      expect(s.candidateQuery).toBe(c.candidateQuery);
    }
  });

  it("the VERBATIM purpose heading differs from the 08-09 report by exactly 이제 and a period", () => {
    // Found by this unit's own battery: restoring the trailing period to the verbatim entry survived every
    // test. Its wording was pinned nowhere, and its entire justification is the DIFFERENCE from the report it
    // corrects — the report measured ABSENT_EVERYWHERE, and "a leading 이제 and a trailing period" is the
    // hypothesis for why. A verbatim entry drifting toward the string it exists to differ from erases that.
    const of = (id: string): string => Object.values(WING_STAGE2_RECON_CANDIDATES).flat().find((c) => c.id === id)!.exactText;
    const verbatim = of("stage2.purpose.operator_verbatim");
    expect(of("stage2.purpose.operator_reported")).toBe(`이제 ${verbatim}.`);
    // …and the verbatim one carries neither affix itself, which the equation alone does not forbid.
    expect(verbatim.startsWith("이제")).toBe(false);
    expect(verbatim.endsWith(".")).toBe(false);
    // Same two silent-mismatch modes the transcribed option labels are pinned against.
    expect(verbatim.normalize("NFC")).toBe(verbatim);
    expect(verbatim).not.toMatch(/[\u00a0\u1680\u2000-\u200b\u202f\u205f\u3000]/);
    expect(verbatim.trim()).toBe(verbatim);
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
    // Compared against the single-target sweep rather than a typed-in length: what this asserts is that a
    // repeated TARGET adds no page work, and a hardcoded `1` also asserted that `confirm` has one candidate —
    // an unrelated fact that broke the moment a second query shape was added for the same label.
    expect(wingStage2ReconProbes(["confirm", "confirm"])).toEqual(wingStage2ReconProbes(["confirm"]));
  });
});

/* ────────────────────────────── the shape census ────────────────────────────── */

/**
 * A DOM double for the REAL generated script.
 *
 * Two properties matter and the first version had neither, which review demonstrated with surviving mutations.
 * `css` carries a computed style, so the `display:none` / `visibility:hidden` branch of the script's `paints()`
 * is load-bearing (a stub that always returned a visible style meant deleting that branch changed nothing).
 * And the document below matches on the EXACT selector the script asks for, so widening the query to something
 * like `"input, [role]"` fails instead of silently returning the same fixture.
 */
class FakeEl {
  constructor(
    public tagName: string,
    private attrs: Record<string, string> = {},
    public visible = true,
    public disabled = false,
    public type = "",
    public css: { display?: string; visibility?: string } = {},
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

/** The selectors the shape census is contracted to ask for, verbatim. */
const CHOICE_SELECTOR = "input[type='radio'], input[type='checkbox'], [role='radio'], [role='option']";
const GROUP_SELECTOR = "fieldset, [role='radiogroup'], [role='listbox']";

function runShapeScript(nodes: FakeEl[], groups: FakeEl[] = []): unknown {
  const asked: string[] = [];
  const doc = {
    querySelectorAll(sel: string): FakeEl[] {
      asked.push(sel);
      // EXACT match. A widened or narrowed query gets an empty list, so the mutation shows up as a wrong count
      // rather than as the fixture being handed back regardless of what was asked.
      if (sel === GROUP_SELECTOR) return groups;
      if (sel === CHOICE_SELECTOR) return nodes;
      return [];
    },
  };
  const win = {
    getComputedStyle: (el: FakeEl) => ({ display: el.css.display ?? "block", visibility: el.css.visibility ?? "visible" }),
  };
  const out = new Function("document", "window", `return (${EXTRACT_WING_CHOICE_CONTROL_SHAPES});`)(doc, win);
  return { out, asked };
}

/** Most cases only want the reading. */
function shapes(nodes: FakeEl[], groups: FakeEl[] = []): Record<string, unknown> {
  return (runShapeScript(nodes, groups) as { out: Record<string, unknown> }).out;
}

describe("the choice-control shape census — categories and integers, nothing else", () => {
  it("buckets by (tag, inputType, role) and counts, over the REAL shipped script", () => {
    const out = shapes([
      new FakeEl("INPUT", {}, true, false, "radio"),
      new FakeEl("INPUT", {}, true, false, "radio"),
      new FakeEl("DIV", { role: "option" }),
    ]) as unknown as { visibleChoiceControlCount: number; shapes: { tag: string; inputType: string; role: string; count: number }[] };
    expect(out.visibleChoiceControlCount).toBe(3);
    expect(out.shapes[0]).toEqual({ tag: "INPUT", inputType: "radio", role: "none", count: 2 });
    expect(out.shapes[1]).toEqual({ tag: "DIV", inputType: "none", role: "option", count: 1 });
  });

  it("separates NOT-PAINTING and DISABLED controls from visible ones", () => {
    // "0 visible" and "0 present" are different findings — indistinguishable readings are what broke the
    // `issue` locator's first calibration.
    const out = shapes([
      new FakeEl("INPUT", {}, false, false, "radio"),
      new FakeEl("INPUT", { "aria-disabled": "true" }, true, false, "radio"),
      new FakeEl("INPUT", {}, true, true, "checkbox"),
    ]) as unknown as { visibleChoiceControlCount: number; hiddenChoiceControlCount: number };
    expect(out.visibleChoiceControlCount).toBe(0);
    expect(out.hiddenChoiceControlCount).toBe(3);
  });

  it("maps anything off-vocabulary to the catch-all — the page never picks our strings", () => {
    const out = shapes([
      new FakeEl("CUSTOM-CARD", { role: "사용목적-자체개발" }),
      new FakeEl("INPUT", {}, true, false, "color"),
    ]) as unknown as { shapes: { tag: string; inputType: string; role: string }[] };
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
    const out = shapes([], [new FakeEl("FIELDSET"), new FakeEl("DIV", { role: "radiogroup" }, false)]) as unknown as {
      groupContainerCount: number;
    };
    expect(out.groupContainerCount).toBe(1);
  });

  it("queries EXACTLY the contracted selectors — a widened query is not a detail", () => {
    // The fixture used to dispatch on `sel.includes("radio")`, so widening the query to `"input, [role]"` (which
    // would sweep unrelated controls into a Stage-2 reading) returned the same nodes and every test stayed
    // green. Review demonstrated it. The selector strings are now part of the contract.
    const { asked } = runShapeScript([new FakeEl("INPUT", {}, true, false, "radio")]) as { asked: string[] };
    expect(asked).toContain(CHOICE_SELECTOR);
    expect(asked).toContain(GROUP_SELECTOR);
    expect(asked).toHaveLength(2);
  });

  it("honours COMPUTED STYLE — display:none and visibility:hidden do not paint", () => {
    // The old fixture always returned a visible computed style, so deleting that whole branch from the script's
    // `paints()` changed nothing anywhere. These two nodes have rects, so ONLY the computed-style branch can
    // exclude them.
    const out = shapes([
      new FakeEl("INPUT", {}, true, false, "radio", { display: "none" }),
      new FakeEl("INPUT", {}, true, false, "radio", { visibility: "hidden" }),
      new FakeEl("INPUT", {}, true, false, "radio"),
    ]) as unknown as { visibleChoiceControlCount: number; hiddenChoiceControlCount: number };
    expect(out.visibleChoiceControlCount).toBe(1);
    expect(out.hiddenChoiceControlCount).toBe(2);
  });

  it("reports scanTruncated when the in-page cap is hit — absence stops being evidence", () => {
    // The script caps its loop at 4000 elements. Past the cap, "this label/shape is not present" means "not in
    // the part we looked at", and a reading that did not say so would be read as a complete census. Untested
    // until the mutation battery hardcoded the flag to false and nothing failed.
    const many = Array.from({ length: 4001 }, () => new FakeEl("INPUT", {}, true, false, "radio"));
    const out = shapes(many) as unknown as { visibleChoiceControlCount: number; scanTruncated: boolean };
    expect(out.scanTruncated).toBe(true);
    expect(out.visibleChoiceControlCount).toBe(4000);
    // …and a scan that fits is NOT reported as truncated.
    const few = shapes([new FakeEl("INPUT", {}, true, false, "radio")]) as unknown as { scanTruncated: boolean };
    expect(few.scanTruncated).toBe(false);
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
    // A well-formed object with junk FIELDS is still a reading — the field coercions are the point of this
    // function and are unchanged by the null-reading fix below.
    expect(dirty).not.toBeNull();
    expect(dirty!.visibleChoiceControlCount).toBe(0);
    expect(dirty!.hiddenChoiceControlCount).toBe(2);
    expect(dirty!.shapes[0]).toEqual({ tag: "OTHER", inputType: "other", role: "other", count: 0 });
    expect(dirty!.groupContainerCount).toBe(0);
    // A non-boolean must not become a truthy claim of truncation.
    expect(dirty!.scanTruncated).toBe(false);
    expect(JSON.stringify(dirty)).not.toContain("img");
    expect(JSON.stringify(dirty)).not.toContain("업체명");
  });

  it("an UNUSABLE reading is null — never a complete census reporting zero choice controls", () => {
    // The defect this workstream keeps re-committing, on the LAST of the three Stage-2 sanitizers to still have
    // it. `null`, `undefined`, a string and an array are all "the evaluation returned something that is not a
    // reading". Coerced, each became `visibleChoiceControlCount: 0` — indistinguishable, in the record, from a
    // measured Stage-2 with no radios on it. The recon record's central Stage-2 claim rides on that number.
    for (const unusable of [null, undefined, "", "{}", 0, 2, true, [], [{ tag: "INPUT" }]]) {
      expect(sanitizeChoiceControlCensus(unusable)).toBeNull();
    }
    // ...and the empty OBJECT is still a reading, because that is what an empty page legitimately returns.
    expect(sanitizeChoiceControlCensus({})).not.toBeNull();
    expect(sanitizeChoiceControlCensus({})!.visibleChoiceControlCount).toBe(0);
  });

  it("bounds the number of shape buckets, and SAYS SO when it drops any", () => {
    // A silent cap makes a partial reading look complete. `scanTruncated` covers element-scan truncation only,
    // so bucket loss needs its own flag.
    const many = Array.from({ length: 200 }, () => ({ tag: "INPUT", inputType: "radio", role: "none", count: 1 }));
    const capped = sanitizeChoiceControlCensus({ shapes: many })!;
    expect(capped.shapes.length).toBeLessThanOrEqual(64);
    expect(capped.bucketsTruncated).toBe(true);
    expect(sanitizeChoiceControlCensus({ shapes: [{ tag: "INPUT", inputType: "radio", role: "none", count: 1 }] })!.bucketsTruncated).toBe(false);
  });
});

/* ────────────────────────────── promotion stays impossible ────────────────────────────── */

describe("a Stage-2 reading changes no shipped selector", () => {
  it("the recon module exports NOTHING that could ship a Stage-2 label as a locator", async () => {
    // The source-text form of this test was the weaker shape, and review proved it: appending an
    // `adoptStage2Candidate()` that writes a new `WING_STAGE2_SHIPPED_LABELS` map survived it, because the
    // module still contained neither of the two forbidden strings. `coupang-wing-label-recon.test.ts` already
    // carried the namespace-scanning form and its own comment records that source text was rejected in review
    // for exactly this reason. This is that form, widened to the shapes a Stage-2 promotion would take.
    const mod = (await import("../../../src/action-window/coupang-wing-label-recon")) as Record<string, unknown>;
    const offending = Object.keys(mod).filter(
      (k) => /promote|adopt|apply|ship|write|update|mutate|install|set[A-Z]/i.test(k) || /_(SHIPPED|HIGHLIGHT|DELETION)_LABELS$/.test(k),
    );
    expect(offending, `these exports could turn a measurement into a shipped locator: ${offending.join(", ")}`).toEqual([]);
    // Every export is a constant, a type guard, a resolver, or a pure fold — nothing that takes a candidate and
    // writes it anywhere. Functions are allowed; functions that WRITE are what the name test above forbids.
    for (const [k, v] of Object.entries(mod)) {
      if (typeof v !== "function") continue;
      expect(/^(is|resolve|interpret|wing|screen)/i.test(k) || k.endsWith("Error"), `unexpected exported function ${k}`).toBe(true);
    }
    // …and the shipped locator maps are still not imported here at all (comments stripped: the module discusses
    // them at length, and prose mentioning a symbol has produced false failures in this repo before).
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
    // The resolved PHASE is part of the result: two Stage-2 phases now share this gate, and a caller that could
    // not tell which one was armed would have to re-read the env var the gate exists to interpret.
    expect(r).toEqual({ requested: true, ok: true, phase: S2, targets: [...WING_STAGE2_RECON_TARGETS] });
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
    // 2 purpose candidates (the 08-09 report and the 08-10 verbatim transcription) + 2 confirm (the broad
    // baseline and the 2026-08-11 actionable-only narrowing).
    expect(probed).toHaveLength(4);
    expect(censusCalls()).toBe(1);
    expect(r.stage2?.candidatesMeasured).toBe(4);
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
    expect(r.stage2?.candidatesNotMeasured).toBe(2);
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
    expect(r.stage2?.candidatesMeasured).toBe(2);
  });

  it("a census that returned NOTHING USABLE is a fault too — not a silent absence", async () => {
    // The gap the test above left open, and the reason it could sit there reading "never a fabricated zero"
    // while the fabrication happened one layer down. A THROW produced `TARGET_CLOSED`; a page that returned a
    // non-reading produced a complete census of zero controls with `choiceControlFault: null`. Now the two
    // unusable outcomes are distinguishable from a measurement, and only from each other.
    const { d } = deps({ choiceControlCensus: async () => null });
    const r = await runWingSelectorRecord(d, [], { stage2: ["confirm"] });
    expect(r.stage2?.choiceControls).toBeNull();
    expect(r.stage2?.choiceControlFault).toBe("UNUSABLE_READING");
    expect(r.stage2?.candidatesMeasured).toBe(2);
  });

  it("a missing census seam leaves the reading null rather than throwing", async () => {
    const { d } = deps();
    const { choiceControlCensus: _drop, ...withoutCensus } = d;
    const r = await runWingSelectorRecord(withoutCensus, [], { stage2: ["confirm"] });
    expect(r.stage2?.choiceControls).toBeNull();
    expect(r.stage2?.choiceControlFault).toBeNull();
  });
});

/* ────────────────────────────── the driver method, and the emitted record ────────────────────────────── */

describe("CoupangWingIssuanceDriver.choiceControlCensus", () => {
  /** A page double whose `evaluate` returns whatever the test wants — including junk the script would not. */
  function pageReturning(value: unknown): { evaluate: (s: string) => Promise<unknown>; url: () => string; on: () => void; evaluated: string[] } {
    const evaluated: string[] = [];
    return {
      evaluate: async (script: string) => {
        evaluated.push(script);
        return value;
      },
      url: () => "https://wing.coupang.com/",
      // The driver registers a close listener; without this the promise rejects out of band and vitest reports
      // an unhandled error while the assertions still pass — a green run hiding a broken double.
      on: () => undefined,
      evaluated,
    };
  }

  it("RE-SANITIZES host-side — the claim that the vocabulary is guaranteed by our code, tested", () => {
    // The mutation review found surviving: drop `sanitizeChoiceControlCensus(...)` from the driver method and
    // return the raw evaluate value. Nothing called this method from a test, so the commit's central
    // sanitization claim was unguarded. If the in-page mapping is ever bypassed or edited wrong, THIS is what
    // stops page-authored strings entering the record.
    const page = pageReturning({
      visibleChoiceControlCount: 3,
      hiddenChoiceControlCount: 0,
      shapes: [{ tag: "CUSTOM-CARD", inputType: "업체명", role: "사용목적", count: 3 }],
      groupContainerCount: 1,
      scanTruncated: false,
    });
    const driver = new CoupangWingIssuanceDriver(page as never);
    return driver.choiceControlCensus().then((census) => {
      expect(census).not.toBeNull();
      expect(census!.shapes[0]).toEqual({ tag: "OTHER", inputType: "other", role: "other", count: 3 });
      const json = JSON.stringify(census);
      expect(json).not.toContain("CUSTOM-CARD");
      expect(json).not.toContain("업체명");
      expect(json).not.toContain("사용목적");
    });
  });

  it("evaluates the audited constant script and nothing else", async () => {
    const page = pageReturning({});
    await new CoupangWingIssuanceDriver(page as never).choiceControlCensus();
    expect(page.evaluated).toEqual([EXTRACT_WING_CHOICE_CONTROL_SHAPES]);
  });

  it("hands back NULL, not a zeroed census, when the page returns nothing usable", async () => {
    // This test previously asserted the opposite — `visibleChoiceControlCount: 0` — under the name "returns a
    // safe reading". A fabricated zero is not safe: it is the seam's only Stage-2 output, and the recon record
    // reads its headline "N visible choice controls" straight off it.
    const census = await new CoupangWingIssuanceDriver(pageReturning(null) as never).choiceControlCensus();
    expect(census).toBeNull();
  });
});

describe("the emitted Stage-2 record", () => {
  const sweep = {
    phase: "COUPANG_WING_STAGE2_RECON" as const,
    calibration: false,
    precondition: "OK" as const,
    targets: [
      {
        target: "purpose" as const,
        candidates: [
          {
            id: "stage2.purpose.operator_reported",
            label: "이제 키의 사용 목적을 골라주세요.",
            matchCount: 1,
            verdict: "UNIQUE" as const,
            sig16: "0123456789abcdef",
            hiddenMatchCount: null,
            // MEASURED, or null. Carried on the row since 2026-08-11: the locate script has always returned it
            // and the sweep dropped it, so a promotion built on this record could only ever have cited an
            // EXPECTED tag — the substitution that put `role: "button"` on the refuted 발급 record.
            observedTag: null,
            containment: null,
            presence: "NOT_MEASURED" as const,
          },
        ],
        uniqueCandidateIds: ["stage2.purpose.operator_reported"],
        resolvedUnambiguously: true,
      },
    ],
    faults: [],
    containmentFaults: [],
    candidatesMeasured: 1,
    candidatesNotMeasured: 0,
    choiceControls: sanitizeChoiceControlCensus({ visibleChoiceControlCount: 2, shapes: [], groupContainerCount: 1 }),
    choiceControlFault: null,
    association: null,
    associationFault: null,
    consentBlocks: null,
    consentBlockFault: null,
    calibrationBlind: null,
    purposeOptionCandidateIds: [],
  };

  it("carries the precondition, the verdicts, and the shape census", () => {
    // The defect this closes: the sweep was computed and thrown away. A granted live run swept six candidate
    // sets, took the census, folded every verdict — and printed a record containing none of it. No test covered
    // the emitted record, which is why the suite was green.
    const rec = stage2RecordFor(sweep)!;
    expect(rec.precondition).toBe("OK");
    expect(rec.candidatesMeasured).toBe(1);
    expect(rec.targets[0]!.resolvedUnambiguously).toBe(true);
    expect(rec.targets[0]!.candidates[0]!.sig16).toBe("0123456789abcdef");
    expect(rec.choiceControls?.visibleChoiceControlCount).toBe(2);
  });

  it("carries the precondition even when it FAILED — the counts are meaningless without it", () => {
    const blocked = stage2RecordFor({ ...sweep, precondition: "NO_VISIBLE_CHOICE_CONTROL", targets: [], candidatesMeasured: 0, choiceControls: null })!;
    expect(blocked.precondition).toBe("NO_VISIBLE_CHOICE_CONTROL");
    // Zero targets next to a failed precondition means "no sweep ran", never "Stage-2 is empty".
    expect(blocked.targets).toEqual([]);
    expect(blocked.choiceControls).toBeNull();
  });

  it("states NO expected role for a Stage-2 target rather than inventing one", () => {
    // `role: "button"` asserted from an expectation table, for an element nobody measured, is this workstream's
    // founding defect. Stage-2 targets have no shipped locator, so the record says exactly that.
    const rec = stage2RecordFor(sweep)!;
    expect(rec.targets[0]!.candidates[0]!.expectedRole).toBe("NOT_APPLICABLE_NO_SHIPPED_LOCATOR");
    expect(rec.targets[0]!.candidates[0]!.canHighlight).toBe(true);
    // …and canHighlight is derived from the VERDICT, so NOT_MEASURED never claims highlightability.
    const unmeasured = stage2RecordFor({
      ...sweep,
      targets: [{ ...sweep.targets[0]!, candidates: [{ ...sweep.targets[0]!.candidates[0]!, verdict: "NOT_MEASURED" as const, matchCount: null, sig16: null }], uniqueCandidateIds: [], resolvedUnambiguously: false }],
    })!;
    expect(unmeasured.targets[0]!.candidates[0]!.canHighlight).toBe(false);
  });

  it("is null on a non-Stage-2 run", () => {
    expect(stage2RecordFor(null)).toBeNull();
  });

  it("main() EMITS it — the record is on the wire, not just computable", () => {
    // Pinned at the call site because the defect was precisely that a correct, exported, tested sanitizer was
    // never wired into the printed record.
    const code = readFileSync(resolve(HERE, "../../../src/cli/probe-wing-issuance-selectors.ts"), "utf8");
    expect(code).toContain("stage2: stage2RecordFor(result.stage2),");
    expect(code).toContain("stage2Precondition: result.stage2?.precondition");
  });

  it("the emitted record carries no page-authored text", () => {
    const json = JSON.stringify(stage2RecordFor(sweep));
    for (const forbidden of ["http", "://", "querySelector", "<", "textContent"]) {
      expect(json).not.toContain(forbidden);
    }
  });
});

/* ────────────────────────────── the landed Stage-2 recon evidence ────────────────────────────── */

describe("WING_STAGE2_RECON_EVIDENCE — measured, operator-reported, and inferred kept apart", () => {
  it("records the structural measurement verbatim", () => {
    const e = WING_STAGE2_RECON_EVIDENCE;
    expect(e.gitSha).toBe("277220f7");
    expect(e.runId).toBe("wt-2b984a46c298");
    expect(e.recordId).toBe("wingrec_0f296204926c");
    expect(e.precondition).toBe("OK");
    expect(e.visibleChoiceControlCount).toBe(2);
    expect(e.hiddenChoiceControlCount).toBe(10);
    expect(e.visibleShapes).toEqual([{ tag: "INPUT", inputType: "radio", role: "none", count: 2 }]);
    expect(e.groupContainerCount).toBe(0);
    // Named "verbatim" and omitting four measured values is the shape this repo keeps catching. Both truncation
    // flags carry a doc claim, the date is provenance, and the signature is the evidence itself — all four
    // survived mutation until they were asserted.
    expect(e.observedOn).toBe("2026-08-09");
    expect(e.scanTruncated).toBe(false);
    expect(e.bucketsTruncated).toBe(false);
    expect(e.confirmLocated.sig16).toBe("c1b87128024cdec8");
  });

  it("the shape it recorded is one the closed vocabulary can express", () => {
    // A record whose categories are not in the census's own allow-lists would describe a reading the instrument
    // cannot produce — i.e. a hand-typed value wearing a measurement's clothes.
    for (const s of WING_STAGE2_RECON_EVIDENCE.visibleShapes) {
      expect(WING_CONTROL_TAGS as readonly string[]).toContain(s.tag);
      expect(WING_CONTROL_INPUT_TYPES as readonly string[]).toContain(s.inputType);
      expect(WING_CONTROL_ROLES as readonly string[]).toContain(s.role);
    }
    // …and the visible count agrees with the shape counts. Two numbers that can disagree usually do.
    const summed = WING_STAGE2_RECON_EVIDENCE.visibleShapes.reduce((n, s) => n + s.count, 0);
    expect(summed).toBe(WING_STAGE2_RECON_EVIDENCE.visibleChoiceControlCount);
  });

  it("absences are MEASURED zeros, and the counts prove it", () => {
    const e = WING_STAGE2_RECON_EVIDENCE;
    // 7 absent + 1 unique = 8 measured, none unmeasured, no faults. Without that arithmetic an "ABSENT" cannot
    // be distinguished from a probe that never ran — the distinction the recon's NOT_MEASURED verdict exists for.
    expect(e.absentCandidateIds).toHaveLength(7);
    expect(e.candidatesMeasured).toBe(8);
    expect(e.candidatesNotMeasured).toBe(0);
    expect(e.probeFaults).toBe(0);
    expect(e.absentCandidateIds.length + 1).toBe(e.candidatesMeasured);
    // DISTINCT. Length 7 alone is satisfied by a duplicate — and a record listing one id twice would claim a
    // candidate was measured absent while it was never in the list, with `candidatesNotMeasured: 0` still
    // asserting nothing went unmeasured. That is exactly the measured/unmeasured conflation NOT_MEASURED exists
    // to prevent.
    expect(new Set(e.absentCandidateIds).size).toBe(7);
    // …and 8 is tied to the IDS, not typed in. This guard previously read `candidatesMeasured ===
    // WING_STAGE2_RECON_CANDIDATES.length`, and it fired the moment a ninth candidate was added — correctly,
    // because the record then claimed coverage of a set it had not covered. But that equality can only be kept
    // true by editing it, and a record of a past run cannot own a property of the current set. So the record now
    // NAMES what it measured, and the count is checked against that.
    expect(e.measuredCandidateIds).toHaveLength(e.candidatesMeasured);
    expect(new Set(e.measuredCandidateIds).size).toBe(e.candidatesMeasured);
    for (const id of e.absentCandidateIds) expect(e.measuredCandidateIds).toContain(id);
    // The one measured id that is NOT an absence is the one that resolved.
    expect(e.measuredCandidateIds.filter((id) => !(e.absentCandidateIds as readonly string[]).includes(id))).toEqual(["stage2.confirm.confirm"]);
    // Every id is still a real candidate, so renaming or deleting one breaks the record instead of orphaning it.
    const all = Object.values(WING_STAGE2_RECON_CANDIDATES).flat().map((c) => c.id);
    for (const id of e.measuredCandidateIds) expect(all).toContain(id);
    // What the old equality was really protecting: a candidate added AFTER this run must not be silently swept
    // under its coverage. Any addition has to be acknowledged here, by name, with the reason it postdates it.
    expect(all.filter((id) => !(e.measuredCandidateIds as readonly string[]).includes(id))).toEqual([
      // Added 2026-08-10 from the operator's verbatim transcription; this run predates it and never probed it.
      "stage2.purpose.operator_verbatim",
      // Added 2026-08-11 for the guided-control highlight calibration: the SAME 확인 label, narrowed to
      // actionable elements. This run measured only the broad `button,a,span,div` shape, and the whole point of
      // the narrowing is that a count taken under the broad one does not transfer to it.
      "stage2.confirm.actionable",
      // The TERMS screen, discovered 2026-08-10 by pressing 확인 — a screen this run had no idea existed.
      "stage3.terms.heading",
      "stage3.terms.api_agree",
      // Per-tag narrowings of the two consent sentences, added 2026-08-11. Same strings, one tag family each.
      "stage3.terms.api_agree.label",
      "stage3.terms.api_agree.p",
      "stage3.terms.api_agree.span",
      "stage3.terms.api_agree.div",
      "stage3.terms.category_agree",
      "stage3.terms.category_agree.label",
      "stage3.terms.category_agree.p",
      "stage3.terms.category_agree.span",
      "stage3.terms.category_agree.div",
      "stage3.terms.cancel",
      "stage3.terms.issue_final",
      // The purpose screen's `OPEN API` option as a LOCATE target, added 2026-08-11. Its accessible NAME was
      // measured on a later run than this one, and a name is not a location — see the candidate set's comment.
      "stage2.purpose_open_api.label",
      "stage2.purpose_open_api.broad",
      "stage2.purpose_open_api.input",
    ]);
  });

  it("every absent id is a REAL candidate id from the frozen sets", () => {
    // An id that matches no candidate would record an absence for something never probed.
    const known = new Set(Object.values(WING_STAGE2_RECON_CANDIDATES).flat().map((c) => c.id));
    for (const id of WING_STAGE2_RECON_EVIDENCE.absentCandidateIds) expect(known).toContain(id);
    expect(known.has("stage2.confirm.confirm")).toBe(true);
    // …and the one that RESOLVED is not also listed as absent.
    expect(WING_STAGE2_RECON_EVIDENCE.absentCandidateIds as readonly string[]).not.toContain("stage2.confirm.confirm");
  });

  it("확인 is LOCATED, and explicitly not promoted to the key-issuing control", () => {
    // The whole risk of this landing. `확인` matched once; what it DOES is unmeasured, because nothing pressed
    // it and this phase has no tooling that could. Recording "final issuance button" from a match count would
    // be the `role: "button"` mistake again — a role asserted from an expectation, not a reading.
    const c = WING_STAGE2_RECON_EVIDENCE.confirmLocated;
    expect(c.matchCount).toBe(1);
    expect(c.verdict).toBe("UNIQUE");
    expect(c.signatureRole).toBe("EVIDENCE_ONLY");
    expect(c.pressed).toBe(false);
    expect(c.effectMeasured).toBe(false);
    expect(c.isFinalIssuanceControl).toBe("OPERATOR_FLOW_DESCRIPTION_ONLY_NOT_MEASURED");
  });

  it("the two radios' MEANING is unmeasured — a count is not a semantics", () => {
    expect(WING_STAGE2_RECON_EVIDENCE.purposeOptionSemanticsMeasured).toBe(false);
  });

  it("the record's FIELD SET is exactly the declared one — no field may be added to it", () => {
    // This replaces a four-string denylist whose comment claimed "nothing in the record may name a purpose
    // option". `업체연동` (unspaced) and `자체 개발` (spaced) both walked straight through it, as did the
    // operator-transcribed page sentence — and so did an extra `finalIssuanceControlSig16` re-labelling the
    // signature the record is careful not to promote. A denylist cannot express "nothing"; an exact key set can.
    const e = WING_STAGE2_RECON_EVIDENCE as unknown as Record<string, unknown>;
    expect(Object.keys(e).sort()).toEqual([
      "absenceBounds", "absenceExplanation", "absentCandidateIds", "bucketsTruncated", "candidatesMeasured",
      "candidatesNotMeasured", "captureCount", "confirmLocated", "gitSha",
      "groupContainerCount", "hiddenChoiceControlCount", "issuedStateReason", "keyCreationRuledOut",
      "measuredCandidateIds",
      "observedOn", "operatorPressedConfirm", "operatorSelectedPurpose", "precedingRefusal", "precondition",
      "probeFaults", "purposeOptionSemanticsMeasured", "recordId", "runId", "scanTruncated",
      "signatureStability", "surfaceVisibility", "visibleChoiceControlCount", "visibleShapes",
    ].sort());
    expect(Object.keys(WING_STAGE2_RECON_EVIDENCE.confirmLocated).sort()).toEqual(
      ["effectMeasured", "isFinalIssuanceControl", "matchCount", "pressed", "sig16", "signatureRole", "verdict"],
    );
    expect(Object.keys(WING_STAGE2_RECON_EVIDENCE.absenceBounds).sort()).toEqual(
      ["candidateScanTruncationReported", "countsPaintingMatchesOnly", "hiddenMatchCountCarried"],
    );
    expect(Object.keys(WING_STAGE2_RECON_EVIDENCE.absenceExplanation).sort()).toEqual(["hypothesis", "provenance", "tested"]);
    expect(Object.keys(WING_STAGE2_RECON_EVIDENCE.precedingRefusal).sort()).toEqual(
      ["candidatesMeasured", "cause", "precondition", "recordId"],
    );
    expect(Object.keys(WING_STAGE2_RECON_EVIDENCE.visibleShapes[0]).sort()).toEqual(["count", "inputType", "role", "tag"]);
  });

  it("carries NO page wording anywhere — asserted over the whole record, not a sample", () => {
    // Every Hangul run in the serialized record, against an allowlist of the one we put there deliberately.
    // A purpose option name, a heading, or the transcribed sentence appearing anywhere fails this, whatever
    // its spacing — which is what the sampled denylist could not do.
    const json = JSON.stringify(WING_STAGE2_RECON_EVIDENCE);
    const runs = json.match(/[\uAC00-\uD7A3]+/g) ?? [];
    expect(new Set(runs)).toEqual(new Set(["발급"]));
    // …and that one occurrence is only inside the refusal's cause enum, describing operator sequencing.
    expect(WING_STAGE2_RECON_EVIDENCE.precedingRefusal.cause).toContain("발급");
    const withoutCause = JSON.stringify({ ...WING_STAGE2_RECON_EVIDENCE, precedingRefusal: null });
    expect(withoutCause.match(/[\uAC00-\uD7A3]+/g)).toBeNull();
  });

  it("the absence EXPLANATION is marked inferred and untested", () => {
    const x = WING_STAGE2_RECON_EVIDENCE.absenceExplanation;
    expect(x.provenance).toBe("INFERRED");
    expect(x.tested).toBe(false);
    // The hypothesis itself, by value: unpinned, it could be rewritten into a conclusion
    // ("MEASURED_LABELS_ARE_ABSENT_FROM_STAGE2") while the two flags above still read cautious.
    expect(x.hypothesis).toBe("WHOLE_TEXT_EXACT_MATCH_VS_NESTED_OR_PARTIAL_TEXT");
  });

  it("states what an ABSENT verdict does NOT bound", () => {
    // Two real limits the first version of this record left unstated: the locate script counts PAINTING matches
    // only and its hiddenCount is discarded by the sweep, and it caps its scan at 4000 with no truncation flag.
    // The shape census's own truncation flags bound a DIFFERENT script and cannot be read as covering these.
    const b = WING_STAGE2_RECON_EVIDENCE.absenceBounds;
    expect(b.countsPaintingMatchesOnly).toBe(true);
    expect(b.hiddenMatchCountCarried).toBe(false);
    expect(b.candidateScanTruncationReported).toBe(false);
  });

  it("keeps the standing non-claims and the one-capture caveat", () => {
    const e = WING_STAGE2_RECON_EVIDENCE;
    expect(e.captureCount).toBe(1);
    expect(e.signatureStability).toBe("SINGLE_CAPTURE_NOT_ESTABLISHED");
    expect(e.keyCreationRuledOut).toBe(false);
    expect(e.issuedStateReason).toBe("NO_DISCRIMINATING_SIGNAL");
    expect(e.operatorSelectedPurpose).toBe(false);
    expect(e.operatorPressedConfirm).toBe(false);
    expect(e.surfaceVisibility).toBe("OPERATOR_REPORTED");
  });

  it("keeps the REFUSED attempt on the record", () => {
    // It is the only evidence the precondition fires on a real surface — and without it, eight fabricated
    // ABSENT verdicts would be indistinguishable in the record from the seven real ones measured here.
    const r = WING_STAGE2_RECON_EVIDENCE.precedingRefusal;
    expect(r.precondition).toBe("NO_VISIBLE_CHOICE_CONTROL");
    expect(r.candidatesMeasured).toBe(0);
    // By VALUE. `not.toBe(<the other id>)` left this free to become anything at all — `wingrec_deadbeef0000`
    // passed. The sibling record's test carries a comment saying review caught precisely this shape once
    // already; reintroducing it here was a regression of a fixed bug, not a new gap.
    expect(r.recordId).toBe("wingrec_d799c7b60ec5");
    expect(r.recordId).not.toBe(WING_STAGE2_RECON_EVIDENCE.recordId);
    // The CAUSE is the point of keeping the refusal: it was operator sequencing, not the agent acting.
    expect(r.cause).toBe("OPERATOR_SIGNALLED_READY_BEFORE_PRESSING_발급");
  });

  it("landing the evidence promoted NO selector and changed NO ordering", () => {
    // The shipped Stage-2 target order is a product-facing sequence; a measurement is not a licence to reorder
    // it, and `확인` resolving is not a licence to ship it as a locator.
    // The six purpose-flow targets, in order, at the FRONT. Later units append terms-screen targets; what must
    // never happen is a reorder, because the sequence is product-facing and a measurement is not a licence.
    expect([...WING_STAGE2_RECON_TARGETS].slice(0, 6)).toEqual(["purpose", "self_dev", "vendor_info", "vendor_url", "call_ip", "confirm"]);
    const known = Object.values(WING_STAGE2_RECON_CANDIDATES).flat();
    expect(known.find((c) => c.id === "stage2.confirm.confirm")!.exactText).toBe("확인");
  });

  it("is deeply frozen — a measurement must not be editable in place", () => {
    const e = WING_STAGE2_RECON_EVIDENCE as unknown as Record<string, unknown>;
    expect(Object.isFrozen(e)).toBe(true);
    for (const k of ["visibleShapes", "confirmLocated", "absentCandidateIds", "absenceExplanation", "precedingRefusal"]) {
      expect(Object.isFrozen(e[k]), k).toBe(true);
    }
    expect(Object.isFrozen(WING_STAGE2_RECON_EVIDENCE.visibleShapes[0])).toBe(true);
  });
});
