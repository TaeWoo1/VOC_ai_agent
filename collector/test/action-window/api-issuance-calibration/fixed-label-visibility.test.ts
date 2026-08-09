/**
 * The fixed-label locator's VISIBILITY filter — the guard that closes the 2026-08-09 live failure.
 *
 * On the real WING no-key surface the shipped `issue` spec (`button,a,span,div` / exact text `발급`) reported a
 * unique match and a successful highlight, while the operator saw no highlight anywhere. Two separate mistakes:
 * the real control reads `API Key 발급 받기`, which exact-text `발급` cannot match; and the thing it DID match was
 * a node that does not paint, which the locator had no way to reject.
 *
 * These cases execute the REAL generated script — the same string the driver evaluates in the page — against a
 * fake DOM, so they run in CI. The equivalent Chromium test would be higher fidelity and skipped
 * (`collector-ci.yml` sets `RUN_INTEGRATION: ''`), which for a regression guard is the wrong trade: this bug's
 * whole nature was a check that reported success without ever having been exercised.
 */
import { describe, expect, it } from "vitest";
import { buildFixedLabelLocateScript } from "../../../src/action-window/api-issuance-calibration/visual-recon-inpage";
import { WING_HIGHLIGHT_LABELS } from "../../../src/action-window/coupang-wing-issuance-driver";

/** The spec that shipped until 2026-08-09, kept verbatim so the regression case is the real one. */
const REFUTED_SPEC = { candidateQuery: "button,a,span,div", exactText: "발급" };

interface FakeElInit {
  tag: string;
  text: string;
  /** Absent ⇒ painting. `display:none` / `visibility:hidden` / zero rects each mean it does not paint. */
  display?: string;
  visibility?: string;
  rects?: number;
  width?: number;
  height?: number;
  children?: number;
}

class FakeEl {
  readonly tagName: string;
  readonly textContent: string;
  readonly childElementCount: number;
  private readonly style: { display: string; visibility: string };
  private readonly rects: number;
  private readonly box: { width: number; height: number };
  private readonly attrs = new Map<string, string>();

  constructor(init: FakeElInit) {
    this.tagName = init.tag.toUpperCase();
    this.textContent = init.text;
    this.childElementCount = init.children ?? 0;
    this.style = { display: init.display ?? "block", visibility: init.visibility ?? "visible" };
    this.rects = init.rects ?? 1;
    this.box = { width: init.width ?? 100, height: init.height ?? 20 };
  }

  computedStyle(): { display: string; visibility: string } {
    return this.style;
  }
  getClientRects(): unknown[] {
    return new Array(this.rects).fill({});
  }
  getBoundingClientRect(): { width: number; height: number } {
    return this.box;
  }
  getAttribute(n: string): string | null {
    return this.attrs.has(n) ? this.attrs.get(n)! : null;
  }
  setAttribute(n: string, v: string): void {
    this.attrs.set(n, v);
  }
  removeAttribute(n: string): void {
    this.attrs.delete(n);
  }
  closest(): FakeEl | null {
    return null;
  }
  get tagged(): boolean {
    return this.attrs.has("data-aw-target");
  }
}

interface LocateOut {
  count: number;
  hiddenCount?: number;
  tag?: string;
  sig?: string;
}

/** Run the REAL generated script over a fake document. No jsdom: jsdom has no layout, so everything would read as hidden. */
function runScript(script: string, els: FakeEl[]): LocateOut {
  const document = {
    querySelectorAll(sel: string): FakeEl[] {
      if (sel === "*") return els;
      if (sel === "[data-aw-target]") return els.filter((e) => e.tagged);
      const wanted = sel.split(",").map((s) => s.trim().toUpperCase());
      return els.filter((e) => wanted.includes(e.tagName));
    },
  };
  const window = { getComputedStyle: (el: FakeEl) => el.computedStyle() };
  return new Function("document", "window", `return (${script});`)(document, window) as LocateOut;
}

function locate(spec: { candidateQuery: string; exactText: string }, els: FakeEl[], tag = false): LocateOut {
  return runScript(buildFixedLabelLocateScript({ ...spec, tag }), els);
}

/** The live no-key surface, as far as this bug is concerned: the real control, plus a non-painting `발급` node. */
function wingSurface(decoy: Partial<FakeElInit> = {}): { els: FakeEl[]; button: FakeEl; decoyEl: FakeEl } {
  const button = new FakeEl({ tag: "button", text: "API Key 발급 받기" });
  const decoyEl = new FakeEl({ tag: "div", text: "발급", display: "none", rects: 0, ...decoy });
  return { els: [decoyEl, button], button, decoyEl };
}

describe("the refuted 발급 spec, against the surface that refuted it", () => {
  it("matches the decoy and NOT the real button — the two are different elements", () => {
    // With the decoy made visible, the old spec resolves — to a DIV. This is the whole defect in one assertion:
    // `count: 1` was always true, and always about the wrong element.
    const { els } = wingSurface({ display: "block", rects: 1 });
    const res = locate(REFUTED_SPEC, els);
    expect(res.count).toBe(1);
    expect(res.tag).toBe("DIV");
    expect(res.tag).not.toBe("BUTTON");
  });

  it("cannot match the real control at all — its label is not `발급`", () => {
    // Only the real button on the page. Exact text compares the WHOLE normalized text, so this is a miss, and no
    // amount of visibility filtering would have made the old spec correct.
    const button = new FakeEl({ tag: "button", text: "API Key 발급 받기" });
    expect(locate(REFUTED_SPEC, [button]).count).toBe(0);
  });

  it("now returns count 0 with hiddenCount 1 — the decoy is rejected, and says so", () => {
    // The live shape. Before the filter this was `count: 1` and a highlight nobody could see.
    const { els } = wingSurface();
    expect(locate(REFUTED_SPEC, els)).toMatchObject({ count: 0, hiddenCount: 1 });
  });

  it("does not tag the decoy when it cannot be highlighted", () => {
    const { els, decoyEl } = wingSurface();
    locate(REFUTED_SPEC, els, true);
    expect(decoyEl.tagged).toBe(false);
  });
});

describe("the corrected shipped spec", () => {
  it("resolves uniquely to the real button, with a MEASURED tag", () => {
    const { els } = wingSurface();
    const res = locate(WING_HIGHLIGHT_LABELS.issue, els);
    expect(res.count).toBe(1);
    expect(res.tag).toBe("BUTTON");
    expect(res.hiddenCount).toBe(0);
    expect(res.sig).toMatch(/^[0-9a-f]{16}$/);
  });

  it("tags the real button, and only it", () => {
    const { els, button, decoyEl } = wingSurface();
    locate(WING_HIGHLIGHT_LABELS.issue, els, true);
    expect(button.tagged).toBe(true);
    expect(decoyEl.tagged).toBe(false);
  });

  it("is unaffected by the decoy — hiddenCount counts only ITS OWN rejected matches", () => {
    // The decoy's text is `발급`, which the corrected spec never matches, so it is not a hidden match of this spec.
    const { els } = wingSurface();
    expect(locate(WING_HIGHLIGHT_LABELS.issue, els).hiddenCount).toBe(0);
  });

  it("fails closed on a genuine ambiguity — two VISIBLE buttons with the same label", () => {
    const a = new FakeEl({ tag: "button", text: "API Key 발급 받기" });
    const b = new FakeEl({ tag: "button", text: "API Key 발급 받기" });
    expect(locate(WING_HIGHLIGHT_LABELS.issue, [a, b])).toMatchObject({ count: 2, hiddenCount: 0 });
  });

  it("ignores a hidden duplicate rather than being blocked by it", () => {
    // A duplicate nobody can see must not make the visible control unhighlightable — but it is still reported.
    const real = new FakeEl({ tag: "button", text: "API Key 발급 받기" });
    const ghost = new FakeEl({ tag: "button", text: "API Key 발급 받기", display: "none", rects: 0 });
    expect(locate(WING_HIGHLIGHT_LABELS.issue, [real, ghost])).toMatchObject({ count: 1, hiddenCount: 1, tag: "BUTTON" });
  });
});

describe("what counts as painting", () => {
  const cases: { name: string; init: Partial<FakeElInit>; paints: boolean }[] = [
    { name: "display:none", init: { display: "none", rects: 0 }, paints: false },
    { name: "visibility:hidden (inherited from a hidden ancestor too)", init: { visibility: "hidden" }, paints: false },
    { name: "zero client rects (unrendered / detached)", init: { rects: 0 }, paints: false },
    { name: "zero-area box", init: { width: 0, height: 0 }, paints: false },
    { name: "display:contents with children (paints through them)", init: { display: "contents", rects: 0, children: 2 }, paints: true },
    { name: "display:contents with NO children (paints nothing)", init: { display: "contents", rects: 0, children: 0 }, paints: false },
    { name: "an ordinary rendered control", init: {}, paints: true },
  ];

  for (const { name, init, paints } of cases) {
    it(`${paints ? "accepts" : "rejects"} ${name}`, () => {
      const el = new FakeEl({ tag: "button", text: "API Key 발급 받기", ...init });
      const res = locate(WING_HIGHLIGHT_LABELS.issue, [el]);
      expect(res.count).toBe(paints ? 1 : 0);
      expect(res.hiddenCount).toBe(paints ? 0 : 1);
    });
  }
});
