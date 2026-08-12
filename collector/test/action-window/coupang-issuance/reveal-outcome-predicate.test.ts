/**
 * The reveal run's expected-outcome predicate — the instrument that returned `SURFACE_UNCHANGED` on 2026-08-09
 * while the operator was looking at a persistent Stage-2 surface.
 *
 * The defect was not a mis-tuned threshold. `submitAffordancePresent` reads `button[type='submit'],
 * input[type='submit']` and WING's component library emits `<button type="button">`, so the criterion could not
 * fire on the markup it targeted. The proof is in the run's own baseline, reproduced verbatim below: the *before*
 * census of a page that visibly contained the `API Key 발급 받기` button reported `submitAffordancePresent: false`.
 *
 * So the cases here are mostly about NON-VACUITY rather than correctness. A predicate that cannot be satisfied
 * passes every test that only ever asks "did it stay false?", which is exactly how this shipped.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  classifyRevealOutcome,
  stage2DisjunctsWithHeadroom,
  stage2SurfaceRevealed,
} from "../../../src/action-window/coupang-wing-reveal-driver";
import {
  EXTRACT_WING_CENSUS,
  countBucket,
  observeFrom,
  toWingSignals,
  wideCountBucket,
  type WingObservation,
  type WingSignals,
  type WingStructuralCensus,
} from "../../../src/cli/coupang-wing-classifier";

/* ────────────────────────────── the recorded live baseline ────────────────────────────── */

/**
 * The sanitized `before` signals from the 2026-08-09 reveal run (`wt-6a34bd527b2b`, `0297d307`), verbatim.
 *
 * This is a MEASUREMENT, and the three transition signals are absent from it because they did not exist when it
 * was taken. That absence is retained deliberately — `undefined` is not `false`, and pretending otherwise would
 * invent a baseline nobody read.
 */
const RECORDED_INITIAL_SIGNALS: WingSignals = {
  urlCategory: "wing_host",
  passwordFieldPresent: false,
  submitAffordancePresent: false,
  formCountBucket: "few",
  editableTextInputCountBucket: "many",
  readonlyFieldCountBucket: "none",
  listLikeContainerCountBucket: "many",
  openApiMarkerPresent: false,
  credentialAnchorPresent: true,
  markerScanTruncated: false,
};

/**
 * The recorded baseline PLUS assumed values for the three new signals. The assumption is that the initial
 * surface has no dialog and no choice controls, and a modest number of action controls — plausible, and
 * **UNMEASURED**. Named `ASSUMED` so no reader mistakes it for the row above.
 */
const ASSUMED_NEW_SIGNALS = {
  dialogLikePresent: false,
  choiceControlCountBucket: "none",
  actionControlCountBucket: "some",
} as const;

const SYNTHETIC_INITIAL: WingObservation = {
  urlCategory: "wing_host",
  pageCategory: "open_api_issuance",
  signals: { ...RECORDED_INITIAL_SIGNALS, ...ASSUMED_NEW_SIGNALS },
  blockers: [],
};

function after(over: Partial<WingSignals>, pageCategory: WingObservation["pageCategory"] = "open_api_issuance"): WingObservation {
  return { ...SYNTHETIC_INITIAL, pageCategory, signals: { ...SYNTHETIC_INITIAL.signals, ...over } };
}

/** The three plausible Stage-2 shapes. Which one WING actually renders is UNMEASURED — hence a disjunction. */
const STAGE2_SHAPES = {
  "a modal/dialog opened": { dialogLikePresent: true },
  "inline radio/checkbox selection appeared": { choiceControlCountBucket: "few" as const },
  "clickable option cards appeared (no dialog, no radios)": { actionControlCountBucket: "many" as const },
};

/* ────────────────────────────── the regression this closes ────────────────────────────── */

describe("the 2026-08-09 failure, reproduced from the run's own baseline", () => {
  it("the OLD predicate could not fire on ANY Stage-2 shape built from `type=button` controls", () => {
    // This is the whole finding in one assertion. The old rule was `submitAffordancePresent` false→true; every
    // shape below leaves it false because WING's buttons are `type="button"`. Not "strict" — unsatisfiable.
    const oldPredicate = (b: WingObservation, a: WingObservation): boolean =>
      !b.signals.submitAffordancePresent && a.signals.submitAffordancePresent === true;
    for (const [name, delta] of Object.entries(STAGE2_SHAPES)) {
      expect(oldPredicate(SYNTHETIC_INITIAL, after(delta)), name).toBe(false);
      expect(stage2SurfaceRevealed(SYNTHETIC_INITIAL, after(delta)), name).toBe(true);
    }
  });

  it("the recorded baseline reported NO submit affordance on a page that visibly had the 발급 button", () => {
    // Not an assumption: this is the value the live run recorded, on the surface where the operator saw and
    // pressed the highlighted control. It is what makes the sentence above a measurement rather than a theory.
    expect(RECORDED_INITIAL_SIGNALS.submitAffordancePresent).toBe(false);
  });

  it("the hand-copied baseline AGREES with the frozen evidence constant — two copies cannot drift", async () => {
    // Review's point: `RECORDED_INITIAL_SIGNALS` is described as the run's before-signals "verbatim", but it is a
    // literal typed into a test. The repo already froze the same surface's buckets from the earlier capture, so
    // the two are cross-checked rather than believed. They are independent captures of the same no-key surface;
    // if they ever disagree, one of them is wrong and this fails instead of quietly diverging.
    const { WING_REAL_EVIDENCE_NO_KEY_2026_08_08: frozen } = await import("../../../src/cli/coupang-wing-classifier");
    expect(frozen.buckets.submitAffordancePresent).toBe(RECORDED_INITIAL_SIGNALS.submitAffordancePresent);
    expect(frozen.buckets.formCountBucket).toBe(RECORDED_INITIAL_SIGNALS.formCountBucket);
    expect(frozen.buckets.editableTextInputCountBucket).toBe(RECORDED_INITIAL_SIGNALS.editableTextInputCountBucket);
    expect(frozen.buckets.readonlyFieldCountBucket).toBe(RECORDED_INITIAL_SIGNALS.readonlyFieldCountBucket);
    expect(frozen.buckets.listLikeContainerCountBucket).toBe(RECORDED_INITIAL_SIGNALS.listLikeContainerCountBucket);
    expect(frozen.credentialAnchorPresent).toBe(RECORDED_INITIAL_SIGNALS.credentialAnchorPresent);
    expect(frozen.openApiMarkerPresent).toBe(RECORDED_INITIAL_SIGNALS.openApiMarkerPresent);
    // …and the frozen record carries none of the three new signals either, for the same reason.
    expect("dialogLikePresent" in frozen.buckets).toBe(false);
  });

  it("the saturated buckets could not have reported the transition either", () => {
    // `countBucket` caps at `many` above 3, and two signals were ALREADY there before the press. Even a Stage-2
    // that added fifty inputs could not move them. A detector built only from these is arithmetic, not tuning.
    expect(RECORDED_INITIAL_SIGNALS.editableTextInputCountBucket).toBe("many");
    expect(RECORDED_INITIAL_SIGNALS.listLikeContainerCountBucket).toBe("many");
    expect(countBucket(4)).toBe("many");
    expect(countBucket(4000)).toBe("many");
    // The wide ladder is the fix: a page can be busy and still have room to register an increase.
    expect(wideCountBucket(4)).toBe("some");
    expect(wideCountBucket(9)).toBe("many");
    expect(wideCountBucket(21)).toBe("very_many");
  });
});

/* ────────────────────────────── non-vacuity ────────────────────────────── */

describe("the new predicate is SATISFIABLE, and false when nothing happened", () => {
  it("is false on an unchanged surface — the baseline does not satisfy itself", () => {
    expect(stage2SurfaceRevealed(SYNTHETIC_INITIAL, SYNTHETIC_INITIAL)).toBe(false);
    expect(classifyRevealOutcome(SYNTHETIC_INITIAL, SYNTHETIC_INITIAL)).toBe("SURFACE_UNCHANGED");
  });

  it("fires on every plausible Stage-2 shape", () => {
    for (const [name, delta] of Object.entries(STAGE2_SHAPES)) {
      expect(classifyRevealOutcome(SYNTHETIC_INITIAL, after(delta)), name).toBe("CONFIGURATION_SURFACE_SUSPECTED");
    }
  });

  it("EVERY disjunct is individually decisive — none is dead code", () => {
    // The guard against a predicate that looks like a disjunction but is carried by one term. Each delta changes
    // exactly ONE signal, so if a term were unreachable (as the old one was), its case fails here.
    const disjuncts: Array<[string, Partial<WingSignals>]> = [
      ["dialogLikePresent false→true", { dialogLikePresent: true }],
      ["choiceControlCountBucket none→few", { choiceControlCountBucket: "few" }],
      ["actionControlCountBucket some→many", { actionControlCountBucket: "many" }],
      ["submitAffordancePresent false→true", { submitAffordancePresent: true }],
    ];
    for (const [name, delta] of disjuncts) {
      expect(stage2SurfaceRevealed(SYNTHETIC_INITIAL, after(delta)), name).toBe(true);
    }
  });

  it("every disjunct has headroom from the ASSUMED baseline — a fixture check, not a live one", () => {
    // Honest about its own reach, after review: `SYNTHETIC_INITIAL` carries ASSUMED values for the three new
    // signals, so this constrains the fixture, not WING. The live question — does the real surface leave any
    // disjunct room to move? — is answered by `stage2DisjunctsWithHeadroom` at run time, above. In particular
    // `actionControlCountBucket` may well be `very_many` on the real WING shell, which would put it at the
    // ceiling; that is UNMEASURED and the next live run reports it.
    const s = SYNTHETIC_INITIAL.signals;
    expect(s.dialogLikePresent, "already true ⇒ can never rise").toBe(false);
    expect(s.choiceControlCountBucket, "already `many` ⇒ saturated").not.toBe("many");
    expect(s.actionControlCountBucket, "already `very_many` ⇒ saturated").not.toBe("very_many");
    expect(s.submitAffordancePresent).toBe(false);
  });

  it("REPORTS its own blindness — a baseline at every ceiling leaves no detectable disjunct", () => {
    // The guard the two failed live runs needed. Unlike the fixture-scoped headroom case below, this runs on
    // whatever baseline the RUN actually observed, so it answers "could this run have seen anything?" before the
    // operator is asked to act. An empty list means the instrument is blind, whatever the outcome says.
    expect(stage2DisjunctsWithHeadroom(SYNTHETIC_INITIAL).sort()).toEqual(
      ["actionControlCountBucket", "choiceControlCountBucket", "dialogLikePresent", "submitAffordancePresent"].sort(),
    );
    const blind = after({
      dialogLikePresent: true,
      choiceControlCountBucket: "many",
      actionControlCountBucket: "very_many",
      submitAffordancePresent: true,
    });
    expect(stage2DisjunctsWithHeadroom(blind)).toEqual([]);
    // The 2026-08-09 baseline, which had only the one signal that could never rise on WING markup.
    const recorded: WingObservation = { ...SYNTHETIC_INITIAL, signals: RECORDED_INITIAL_SIGNALS };
    expect(stage2DisjunctsWithHeadroom(recorded)).toEqual(["submitAffordancePresent"]);
  });

  it("a ceilinged disjunct really cannot fire — headroom and satisfiability agree", () => {
    // Ties the report to the predicate: if a disjunct is absent from the headroom list, no `after` can make it
    // fire. Otherwise the report would be decoration.
    const atCeiling = after({ actionControlCountBucket: "very_many" });
    expect(stage2DisjunctsWithHeadroom(atCeiling)).not.toContain("actionControlCountBucket");
    for (const b of ["none", "few", "some", "many", "very_many"] as const) {
      expect(stage2SurfaceRevealed(atCeiling, after({ actionControlCountBucket: b })), b).toBe(false);
    }
  });

  it("does NOT fire on a DECREASE, or on an unrelated signal moving", () => {
    // Direction matters: a modal closing is not a modal opening, and a form count changing is not Stage-2.
    const busy = after({ dialogLikePresent: true, choiceControlCountBucket: "many", actionControlCountBucket: "many" });
    expect(stage2SurfaceRevealed(busy, SYNTHETIC_INITIAL)).toBe(false);
    expect(classifyRevealOutcome(SYNTHETIC_INITIAL, after({ formCountBucket: "many" }))).toBe("SURFACE_CHANGED_UNRECOGNIZED");
  });

  it("treats an UNMEASURED baseline as no evidence — a transition needs BOTH ends", () => {
    // A census predating the new signals carries `undefined`. The mutation battery caught the first cut of this:
    // ranks compared with `undefined` sorted below `none` made `undefined → none` read as an increase, i.e. a
    // reveal reported because the INSTRUMENT changed. That is the same false positive the repair exists to
    // remove, so every new disjunct abstains unless both ends were measured.
    const oldStyle: WingObservation = { ...SYNTHETIC_INITIAL, signals: RECORDED_INITIAL_SIGNALS };
    expect(stage2SurfaceRevealed(oldStyle, oldStyle)).toBe(false);
    expect(stage2SurfaceRevealed(SYNTHETIC_INITIAL, oldStyle)).toBe(false);
    // The exact mutation case: no baseline, then a measured EMPTY reading. Nothing happened on the page.
    expect(stage2SurfaceRevealed(oldStyle, after({ choiceControlCountBucket: "none" }))).toBe(false);
    expect(stage2SurfaceRevealed(oldStyle, after({ actionControlCountBucket: "none" }))).toBe(false);
    // …and a NON-empty reading against an absent baseline is still not a measured transition.
    expect(stage2SurfaceRevealed(oldStyle, after({ choiceControlCountBucket: "many" }))).toBe(false);
    expect(stage2SurfaceRevealed(oldStyle, after({ actionControlCountBucket: "very_many" }))).toBe(false);
    expect(stage2SurfaceRevealed(oldStyle, after({ dialogLikePresent: true }))).toBe(false);
    // The one disjunct that CAN fire against that baseline is the one it actually measured.
    expect(stage2SurfaceRevealed(oldStyle, after({ submitAffordancePresent: true }))).toBe(true);
  });
});

/* ────────────────────────────── fail-closed, unchanged ────────────────────────────── */

describe("the fail-closed ordering survives the repair", () => {
  it("an unverified overlay clear is never interpreted, however strong the delta looks", () => {
    const maximal = after({ dialogLikePresent: true, choiceControlCountBucket: "many", actionControlCountBucket: "very_many" });
    expect(classifyRevealOutcome(SYNTHETIC_INITIAL, maximal, false)).toBe("OVERLAY_NOT_CLEARED");
    // …and it WOULD have been the expected outcome had the clear been verified. That is the point: the ordering
    // is what stops a maximal-looking delta from being interpreted, not the delta being unconvincing.
    expect(classifyRevealOutcome(SYNTHETIC_INITIAL, maximal, true)).toBe("CONFIGURATION_SURFACE_SUSPECTED");
  });

  it("this walk injects NOTHING the new signals can count — and must never start", () => {
    // Corrected after review. An earlier version of this test asserted `document.createElement("button")` appears
    // somewhere in overlay.ts (true, in a branch this driver never takes) and then counted a hand-written fixture
    // node. It could not fail. The real invariant is about THIS call site.
    const drvSrc = readFileSync(
      resolve(dirname(fileURLToPath(import.meta.url)), "../../../src/action-window/coupang-wing-reveal-driver.ts"),
      "utf8",
    );
    const overlaySrc = readFileSync(
      resolve(dirname(fileURLToPath(import.meta.url)), "../../../src/action-window/overlay.ts"),
      "utf8",
    );
    // overlay.ts creates EVERY button it has under a gate that requires `advance` — there are two now (the
    // panel's `자세히` disclosure and the advance button itself), and the invariant is about all of them, not
    // about whichever one happens to come first in the file.
    const buttonSites: number[] = [];
    for (let at = overlaySrc.indexOf('document.createElement("button")'); at > -1; ) {
      buttonSites.push(at);
      at = overlaySrc.indexOf('document.createElement("button")', at + 1);
    }
    expect(buttonSites.length).toBeGreaterThan(0);
    // `detailShown` is the disclosure's gate; it is DEFINED as requiring an advance button, so a panel without
    // one stays exactly as non-interactive as it was.
    expect(overlaySrc).toContain("const detailShown = o.detail != null && o.advance != null;");
    for (const at of buttonSites) {
      expect(overlaySrc.slice(0, at)).toMatch(/if \((o\.advance|detailShown)\)\s*\{[^}]*$/);
    }
    // … and this driver never passes one. Adding `advance` here would put a clickable SellerOps control in front
    // of a seller mid-action on a live marketplace page, AND make actionControlCount count our own DOM.
    const mountArgs = drvSrc.slice(drvSrc.indexOf("mountOverlayFn ?? mountOverlay)(page, {"));
    const optionsBlock = mountArgs.slice(0, mountArgs.indexOf("});"));
    // The PROPERTY, not the word — the block's own comment explains why there is no advance button.
    expect(optionsBlock).not.toMatch(/^\s*advance\s*:/m);
    expect(optionsBlock).toContain("copyKey:"); // the slice really is the options object
    // The elements it DOES inject match none of the three new selector sets.
    const ours = runCensus([
      new FakeNode({ tag: "div", attrs: { "aria-hidden": "true" } }),
      new FakeNode({ tag: "div", attrs: { id: "__aw_advance_panel__", role: "note" } }),
      new FakeNode({ tag: "div", text: "강조 표시된 '발급' 버튼을 직접 눌러 주세요." }),
    ]);
    expect(ours.actionControlCount).toBe(0);
    expect(ours.choiceControlCount).toBe(0);
    expect(ours.dialogLikePresent).toBe(false);
  });

  it("a credential surface STOPS, and can never be reported as the expected outcome", () => {
    expect(classifyRevealOutcome(SYNTHETIC_INITIAL, after({ dialogLikePresent: true }, "credential_shown"))).toBe(
      "CREDENTIAL_SURFACE_APPEARED",
    );
  });

  it("leaving the open-API surface STOPS", () => {
    for (const cat of ["login", "wing_home", "unknown"] as const) {
      expect(classifyRevealOutcome(SYNTHETIC_INITIAL, after({ dialogLikePresent: true }, cat)), cat).toBe(
        "OFF_OPEN_API_SURFACE",
      );
    }
  });

  it("a missing observation is NOT_OBSERVED, not a verdict", () => {
    expect(classifyRevealOutcome(null, SYNTHETIC_INITIAL)).toBe("NOT_OBSERVED");
    expect(classifyRevealOutcome(SYNTHETIC_INITIAL, null)).toBe("NOT_OBSERVED");
  });
});

/* ────────────────────────────── the shipped in-page script ────────────────────────────── */

/**
 * Executes the REAL `EXTRACT_WING_CENSUS` string against a fake DOM. A Chromium fixture would be higher fidelity
 * and SKIPPED in CI (`collector-ci.yml` sets `RUN_INTEGRATION: ''`) — and "a check that never ran" is the failure
 * mode this whole unit exists to close, so the trade goes the other way.
 */
interface FakeNodeInit {
  tag: string;
  attrs?: Record<string, string>;
  text?: string;
  children?: number;
  paints?: boolean;
  disabled?: boolean;
  /** Overrides the computed display so the `contents` branch of `paints()` is reachable. */
  display?: string;
}

class FakeNode {
  readonly tagName: string;
  readonly textContent: string;
  readonly childElementCount: number;
  readonly disabled: boolean;
  readonly readOnly = false;
  readonly type: string;
  private readonly attrs: Record<string, string>;
  private readonly visible: boolean;
  private readonly displayOverride: string | undefined;

  constructor(init: FakeNodeInit) {
    this.tagName = init.tag.toUpperCase();
    this.attrs = init.attrs ?? {};
    this.textContent = init.text ?? "";
    this.childElementCount = init.children ?? 0;
    this.visible = init.paints !== false;
    this.disabled = init.disabled === true;
    this.type = this.attrs.type ?? "";
    this.displayOverride = init.display;
  }
  getAttribute(n: string): string | null {
    return n in this.attrs ? this.attrs[n]! : null;
  }
  getClientRects(): unknown[] {
    if (this.displayOverride === "contents") return []; // like a real `display:contents` box
    return this.visible ? [{}] : [];
  }
  getBoundingClientRect(): { width: number; height: number } {
    return this.visible ? { width: 80, height: 20 } : { width: 0, height: 0 };
  }
  style(): { display: string; visibility: string } {
    if (this.displayOverride !== undefined) return { display: this.displayOverride, visibility: "visible" };
    return { display: this.visible ? "block" : "none", visibility: "visible" };
  }
  matches(sel: string): boolean {
    // Supports exactly the forms the census uses: `tag`, `[attr]`, `[attr='v']`, `tag[attr='v']`.
    const m = /^([a-zA-Z0-9]*)(?:\[([a-zA-Z-]+)(?:=['"]([^'"]*)['"])?\])?$/.exec(sel.trim());
    if (!m) return false;
    const [, tag, attr, val] = m;
    if (tag && this.tagName !== tag.toUpperCase()) return false;
    if (attr) {
      const have = this.getAttribute(attr);
      if (have === null) return false;
      if (val !== undefined && have !== val) return false;
    }
    return true;
  }
}

function runCensus(nodes: FakeNode[]): WingStructuralCensus {
  const document = {
    querySelectorAll(sel: string): FakeNode[] {
      const parts = sel.split(",").map((p) => p.trim()).filter(Boolean);
      return nodes.filter((n) => parts.some((p) => n.matches(p)));
    },
    querySelector(sel: string): FakeNode | null {
      return this.querySelectorAll(sel)[0] ?? null;
    },
  };
  const window = { getComputedStyle: (el: FakeNode) => el.style() };
  return new Function("document", "window", `return (${EXTRACT_WING_CENSUS});`)(document, window) as WingStructuralCensus;
}

/** The WING control we actually highlighted: a real, working button that is NOT `type=submit`. */
const WING_BUTTON = new FakeNode({ tag: "button", attrs: { type: "button" }, text: "API Key 발급 받기" });

describe("the shipped census script, run for real against a fake DOM", () => {
  it("reproduces the defect: WING's own button counts as NO submit affordance", () => {
    const c = runCensus([WING_BUTTON]);
    expect(c.submitAffordancePresent).toBe(false); // …the field is honest; the old PREDICATE was not
    expect(c.actionControlCount).toBe(1); // …and the new signal does see it
  });

  it("counts only PAINTING, enabled controls", () => {
    const c = runCensus([
      WING_BUTTON,
      new FakeNode({ tag: "button", attrs: { type: "button" }, paints: false }),
      new FakeNode({ tag: "button", attrs: { type: "button" }, disabled: true }),
      new FakeNode({ tag: "div", attrs: { role: "button", "aria-disabled": "true" } }),
      new FakeNode({ tag: "div", attrs: { role: "button" } }),
    ]);
    expect(c.actionControlCount).toBe(2); // the real button + the enabled role=button
  });

  it("detects a dialog only when it PAINTS", () => {
    expect(runCensus([WING_BUTTON]).dialogLikePresent).toBe(false);
    expect(runCensus([WING_BUTTON, new FakeNode({ tag: "div", attrs: { role: "dialog" } })]).dialogLikePresent).toBe(true);
    expect(
      runCensus([WING_BUTTON, new FakeNode({ tag: "div", attrs: { role: "dialog" }, paints: false })]).dialogLikePresent,
    ).toBe(false);
    expect(runCensus([new FakeNode({ tag: "div", attrs: { "aria-modal": "true" } })]).dialogLikePresent).toBe(true);
  });

  it("exercises the paints() branches the other cases miss: dialog[open] and display:contents", () => {
    // Review found both unexercised, which weakens "executed for real" — a branch nobody runs is the shape of
    // this whole workstream's recurring bug.
    expect(runCensus([new FakeNode({ tag: "dialog", attrs: { open: "" } })]).dialogLikePresent).toBe(true);
    expect(runCensus([new FakeNode({ tag: "dialog" })]).dialogLikePresent).toBe(false); // no `open` ⇒ no match
    // display:contents paints through its children, and only if it HAS children.
    expect(runCensus([new FakeNode({ tag: "div", attrs: { role: "button" }, display: "contents", children: 2 })]).actionControlCount).toBe(1);
    expect(runCensus([new FakeNode({ tag: "div", attrs: { role: "button" }, display: "contents", children: 0 })]).actionControlCount).toBe(0);
  });

  it("counts choice controls across input types and ARIA roles", () => {
    const c = runCensus([
      new FakeNode({ tag: "input", attrs: { type: "radio" } }),
      new FakeNode({ tag: "input", attrs: { type: "checkbox" } }),
      new FakeNode({ tag: "div", attrs: { role: "radio" } }),
      new FakeNode({ tag: "li", attrs: { role: "option" } }),
      new FakeNode({ tag: "input", attrs: { type: "radio" }, paints: false }),
    ]);
    expect(c.choiceControlCount).toBe(4);
  });

  it("leaves the pre-existing counts UNFILTERED — recorded baselines keep their meaning", () => {
    // The visibility filter is deliberately scoped to the three new signals. Retro-filtering the old counts
    // would silently change what every recorded capture meant, including the one this unit reasons from.
    const hidden = new FakeNode({ tag: "input", attrs: { type: "text" }, paints: false });
    expect(runCensus([hidden]).editableTextInputCount).toBe(1);
  });

  it("flows through to bucketed signals, and an absent census field stays absent", () => {
    const c = runCensus([WING_BUTTON, new FakeNode({ tag: "div", attrs: { role: "radio" } })]);
    const s = toWingSignals("wing_host", c);
    expect(s.actionControlCountBucket).toBe("few");
    expect(s.choiceControlCountBucket).toBe("few");
    expect(s.dialogLikePresent).toBe(false);
    // A census from before the repair carries none of the three; they must not be defaulted into existence.
    const legacy = toWingSignals("wing_host", {
      passwordFieldPresent: false,
      submitAffordancePresent: false,
      formCount: 1,
      editableTextInputCount: 9,
      readonlyFieldCount: 0,
      listLikeContainerCount: 9,
    });
    expect("dialogLikePresent" in legacy).toBe(false);
    expect("choiceControlCountBucket" in legacy).toBe(false);
    expect("actionControlCountBucket" in legacy).toBe(false);
  });

  it("emits no page text, value, URL or selector — counts and booleans only", () => {
    const c = runCensus([WING_BUTTON, new FakeNode({ tag: "input", attrs: { type: "text" }, text: "secret-ish" })]);
    const wire = JSON.stringify(c);
    for (const leak of ["API Key", "발급", "secret-ish", "button", "role=", "http"]) {
      expect(wire, leak).not.toContain(leak);
    }
    for (const v of Object.values(c)) expect(["boolean", "number"]).toContain(typeof v);
  });

  it("an end-to-end observation of the two surfaces classifies as the expected outcome", () => {
    // The full path the live run takes: census → signals → observation → predicate. The 발급 surface, then the
    // same surface with a purpose-selection dialog on top of it.
    // The credential anchor is what puts BOTH surfaces in `open_api_issuance` — and it reads `true` on the real
    // no-key page too, which is exactly why it is no issued/not-issued discriminator. Reproduced so the fixture
    // classifies the way the live surface did.
    const base = [
      WING_BUTTON,
      new FakeNode({ tag: "form" }),
      new FakeNode({ tag: "th", text: "Access Key" }),
    ];
    const before = observeFrom("wing_host", runCensus(base));
    const stage2 = observeFrom(
      "wing_host",
      runCensus([
        ...base,
        new FakeNode({ tag: "div", attrs: { role: "dialog" }, children: 3 }),
        new FakeNode({ tag: "input", attrs: { type: "radio" } }),
        new FakeNode({ tag: "input", attrs: { type: "radio" } }),
        new FakeNode({ tag: "button", attrs: { type: "button" }, text: "확인" }),
      ]),
    );
    expect(classifyRevealOutcome(before, before)).toBe("SURFACE_UNCHANGED");
    expect(classifyRevealOutcome(before, stage2)).toBe("CONFIGURATION_SURFACE_SUSPECTED");
  });
});

/* ────────────────────────────── provenance ────────────────────────────── */

describe("what is recorded about Stage-2, and what is only reported", () => {
  it("keeps the operator's transcription as a CANDIDATE, never as a census marker", async () => {
    const recon = await import("../../../src/action-window/coupang-wing-label-recon");
    const purpose = recon.WING_STAGE2_RECON_CANDIDATES.purpose;
    expect(purpose.some((c) => c.exactText === "이제 키의 사용 목적을 골라주세요.")).toBe(true);
    // It must NOT have become something the runtime matches on: that would promote one operator transcription,
    // possibly wrong in whitespace or punctuation, into a machine-checked marker.
    expect(EXTRACT_WING_CENSUS).not.toContain("사용 목적");
  });

  it("records the v3 live event as ONE measured transition, on ONE capture", async () => {
    const { WING_STAGE2_LIVE_EVENT: e } = await import("../../../src/action-window/coupang-wing-label-recon");
    expect(e.gitSha).toBe("3699df9e");
    expect(e.runId).toBe("wt-dc2b46e93881");
    expect(e.appearance).toBe("OPERATOR_VISIBLE_TRANSITION_MACHINE_MEASURED");
    expect(e.persistent).toBe(true);
    expect(e.apparatusOutcome).toBe("CONFIGURATION_SURFACE_SUSPECTED");
    // Exactly ONE signal moved, and it is named. "the apparatus detected Stage-2" is true and much weaker than
    // it sounds; the record must carry which single bucket, one step, so nobody later reads it as a rich reading.
    expect(e.apparatusChangedSignalCount).toBe(1);
    expect(e.measuredTransition).toBe("choiceControlCountBucket:none->few");
    expect(e.captureCount).toBe(1);
    expect(e.signatureStability).toBe("SINGLE_CAPTURE_NOT_ESTABLISHED");
    // Nothing here weakens the standing non-claims.
    expect(e.structuralMarkerMeasured).toBe(false);
    expect(e.purposeWordingMeasured).toBe(false);
    expect(e.keyCreationRuledOut).toBe(false);
    expect(e.issuedStateReason).toBe("NO_DISCRIMINATING_SIGNAL");
    expect(e.operatorSelectedPurpose).toBe(false);
    expect(e.operatorPressedConfirm).toBe(false);
  });

  it("keeps the run whose apparatus FAILED on the record rather than overwriting it", async () => {
    const { WING_STAGE2_LIVE_EVENT: e } = await import("../../../src/action-window/coupang-wing-label-recon");
    // The v2 run is the reason the v3 census exists. Replacing it with a success would erase the only evidence
    // that this surface once returned SURFACE_UNCHANGED to a real Stage-2 — the same reasoning that keeps the
    // `issue` calibration refutation as `supersedes`.
    expect(e.supersedes.runId).toBe("wt-6a34bd527b2b");
    expect(e.supersedes.apparatusOutcome).toBe("SURFACE_UNCHANGED");
    expect(e.supersedes.apparatusChangedSignalCount).toBe(0);
    expect(e.supersedes.cause).toBe("PREDICATE_UNSATISFIABLE_ON_WING_MARKUP");
    // Pinned by VALUE, not merely as "different from v3". `not.toBe(e.gitSha)` left the superseded sha free to
    // become anything at all — review changed it to `deadbeef` with the suite green. Same for both dates.
    expect(e.supersedes.gitSha).toBe("0297d307");
    expect(e.supersedes.observedOn).toBe("2026-08-09");
    expect(e.observedOn).toBe("2026-08-09");
    // …and the two are DIFFERENT runs. A record superseding itself records nothing.
    expect(e.supersedes.runId).not.toBe(e.runId);
    expect(e.supersedes.gitSha).not.toBe(e.gitSha);
  });

  it("records the signals that did NOT move, so the reading is not read as richer than it was", async () => {
    const { WING_STAGE2_LIVE_EVENT: e } = await import("../../../src/action-window/coupang-wing-label-recon");
    expect(e.measuredUnchanged).toContain("dialogLikePresent:false");
    expect(e.measuredUnchanged).toContain("actionControlCountBucket:many");
    expect(e.measuredUnchanged).toContain("submitAffordancePresent:false");
    expect(e.measuredUnchanged).toContain("pageCategory:open_api_issuance");
    // The transition must not also appear among the non-transitions.
    // By PREFIX, not by exact string. `not.toContain("choiceControlCountBucket:none->few")` was satisfied by
    // adding `"choiceControlCountBucket:none"` to the list — the record would then say the same signal both
    // moved and did not move, with the suite green. Review demonstrated it.
    expect((e.measuredUnchanged as readonly string[]).some((u) => u.startsWith("choiceControlCountBucket:"))).toBe(false);
    // The moved signal is named exactly once, and the count agrees with the lists rather than restating a literal.
    const movedName = e.measuredTransition.split(":")[0]!;
    const unchangedNames = (e.measuredUnchanged as readonly string[]).map((u) => u.split(":")[0]!);
    expect(unchangedNames).not.toContain(movedName);
    expect(new Set(unchangedNames).size).toBe(unchangedNames.length);
    expect(e.apparatusChangedSignalCount).toBe(1);
  });

  it("the dialog finding is scoped to the MARKUP CONTRACT, not to visual modality", async () => {
    const { WING_STAGE2_LIVE_EVENT: e } = await import("../../../src/action-window/coupang-wing-label-recon");
    expect(e.dialogLikePresent).toBe(false);
    // It is the SAME reading as the one in `measuredUnchanged`, not a second, differently-named measurement.
    expect(e.measuredUnchanged).toContain(`dialogLikePresent:${e.dialogLikePresent}`);

    // The field's OWN doc comment, extracted precisely — the previous version sliced 1200 characters preceding
    // the field and asserted a substring appeared somewhere in that neighbourhood. Review showed two mutations
    // surviving it: one inverting the caveat into the exact over-claim ("that worry is obsolete: Stage-2 is a
    // plain inline section, NOT a modal"), and one deleting the caveat while parking the pinned sentence in an
    // adjacent comment still inside the window.
    const src = readFileSync(
      resolve(dirname(fileURLToPath(import.meta.url)), "../../../src/action-window/coupang-wing-label-recon.ts"),
      "utf8",
    );
    const decl = "readonly dialogLikePresent: false;";
    const before = src.slice(0, src.indexOf(decl));
    const doc = before.slice(before.lastIndexOf("/**"));
    expect(doc).toContain("NOT a measurement that the surface is visually non-modal");
    // …and the doc must not ALSO assert the appearance claim. An inverted caveat keeps the pinned sentence and
    // adds the conclusion it warns against, so presence alone can never be the whole guard.
    expect(doc).not.toMatch(/is (a plain inline section|not a modal|therefore not a modal)/i);
    expect(doc).not.toMatch(/\bobsolete\b/i);
  });

  it("the dialog-contract selectors are ANCHORED to the shipped census, not transcribed", async () => {
    // The record used to restate `dialog[open], [role=dialog], [role=alertdialog], [aria-modal=true]` by hand.
    // Deleting one of them from the census left the suite green while the record kept asserting a live
    // measurement that no longer happened. The selectors now live in one place and this pins the link.
    for (const sel of ["dialog[open]", "role='dialog'", "role='alertdialog'", "aria-modal='true'"]) {
      expect(EXTRACT_WING_CENSUS, `${sel} must remain in the census the record's dialog finding came from`).toContain(sel);
    }
    const src = readFileSync(
      resolve(dirname(fileURLToPath(import.meta.url)), "../../../src/action-window/coupang-wing-label-recon.ts"),
      "utf8",
    );
    // …and the record must NOT carry its own copy of them to drift from.
    expect(src).not.toContain("aria-modal");
  });

  it("a refuted disjunct must at minimum have held still on the one measured transition", async () => {
    // A NECESSARY condition, not a sufficient one, and the name says so. "did not move on one capture" is also
    // true of a perfectly capable detector whose shape simply was not present — `dialogLikePresent` is exactly
    // that case, and it is not refuted. So this cannot establish blindness; it can only catch a refutation that
    // the one piece of live evidence flatly contradicts.
    //
    // The claim "the refuted set cannot grow on a hunch" belongs to `coupang-wing-reveal-walk.test.ts`, which
    // asserts eligibility behaviour directly. Review caught this test being credited with that property: adding
    // `dialogLikePresent` to the refuted list passes HERE and fails THERE.
    const { WING_EMPIRICALLY_REFUTED_DISJUNCTS } = await import("../../../src/action-window/coupang-wing-reveal-driver");
    const { WING_STAGE2_LIVE_EVENT: e } = await import("../../../src/action-window/coupang-wing-label-recon");
    expect(WING_EMPIRICALLY_REFUTED_DISJUNCTS.length).toBeGreaterThan(0);
    for (const d of WING_EMPIRICALLY_REFUTED_DISJUNCTS) {
      expect(
        (e.measuredUnchanged as readonly string[]).some((u) => u.startsWith(`${d}:`)),
        `${d} is listed as empirically refuted but did not appear in the live record's unchanged signals`,
      ).toBe(true);
    }
    // …and the disjunct that DID fire must never be listed as refuted.
    const moved = e.measuredTransition.split(":")[0]!;
    expect(WING_EMPIRICALLY_REFUTED_DISJUNCTS as readonly string[]).not.toContain(moved);
  });

  it("the driver's refutation cites the run that corroborated it", async () => {
    // Provenance, not prose: the comment must name the specific live run, so a later reader can check it against
    // `WING_STAGE2_LIVE_EVENT` instead of taking "corroborated" on trust.
    const { WING_STAGE2_LIVE_EVENT: e } = await import("../../../src/action-window/coupang-wing-label-recon");
    const src = readFileSync(
      resolve(dirname(fileURLToPath(import.meta.url)), "../../../src/action-window/coupang-wing-reveal-driver.ts"),
      "utf8",
    );
    const block = src.slice(
      src.indexOf("Disjuncts that have structural headroom"),
      src.indexOf("export const WING_EMPIRICALLY_REFUTED_DISJUNCTS"),
    );
    expect(block).toContain(e.runId);
    expect(block).toContain(e.gitSha);
    expect(block).toMatch(/\*\*CORROBORATED/);
    // `toContain("CORROBORATED")` passed on the NEGATION — "**NOT CORROBORATED by Reveal Live v3**" contains it,
    // ids and all, while asserting the opposite of the refutation it sits above. Review demonstrated it.
    expect(block).not.toMatch(/NOT\s+CORROBORATED/i);
    expect(block).not.toMatch(/\bcontradicted\b/i);
  });

  it("a Stage-2 CONTROL COUNT is not a Stage-2 label — the recon is still required", async () => {
    const recon = await import("../../../src/action-window/coupang-wing-label-recon");
    const e = recon.WING_STAGE2_LIVE_EVENT;
    // The whole risk of landing this evidence: "we detected Stage-2" quietly becoming "we know Stage-2".
    expect(e.structuralMarkerMeasured).toBe(false);
    expect(e.purposeWordingMeasured).toBe(false);
    expect(e.reportedTextRecordedAs).toBe("WING_STAGE2_RECON_CANDIDATES.purpose");
    // …and the candidates are still inert, unchanged by a successful reveal.
    expect(recon.WING_RECON_APPROVED_SCOPE).not.toContain("purpose");
    expect([...recon.WING_RECON_TARGETS]).not.toContain("purpose");
    expect(EXTRACT_WING_CENSUS).not.toContain("사용 목적");
  });

  it("still has NO Stage-2 recon target wired to a runner", async () => {
    // The hypothesis set stays inert until a READ-ONLY recon measures it. Adding `purpose` must not change that.
    const recon = await import("../../../src/action-window/coupang-wing-label-recon");
    expect(recon.WING_RECON_APPROVED_SCOPE).not.toContain("purpose");
    expect([...recon.WING_RECON_TARGETS]).not.toContain("purpose");
  });
});
