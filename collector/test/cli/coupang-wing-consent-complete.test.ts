import { describe, expect, it } from "vitest";
import { buildWingConsentCompleteScript } from "../../src/cli/coupang-wing-classifier";

const API = "API 이용 약관에 동의합니다.";
const CATEGORY = "카테고리 자동 매칭 서비스 이용에 동의합니다.";

/**
 * A fake DOM just rich enough to run the REAL generated script — the same technique the other in-page scripts
 * are tested with, so what is asserted is the shipped string and not a re-implementation of it.
 */
interface FakeEl {
  tag: string;
  text: string;
  checked?: boolean;
  paints: boolean;
  parent: FakeEl | null;
  boxes: FakeEl[];
}

function el(over: Partial<FakeEl> = {}): FakeEl {
  return { tag: "div", text: "", paints: true, parent: null, boxes: [], ...over };
}

/** One consent block: a wrapper holding exactly one sentence and (usually) exactly one visible checkbox. */
function block(sentence: string, opts: { checked?: boolean; boxes?: number; visible?: boolean } = {}) {
  const n = opts.boxes ?? 1;
  const wrapper = el({ text: sentence });
  const boxes: FakeEl[] = [];
  for (let i = 0; i < n; i++) {
    const box = el({
      tag: "input",
      checked: opts.checked ?? false,
      paints: opts.visible ?? true,
      parent: wrapper,
    });
    boxes.push(box);
  }
  wrapper.boxes = boxes;
  return { wrapper, boxes };
}

function run(script: string, blocks: { wrapper: FakeEl; boxes: FakeEl[] }[]): unknown {
  const allBoxes = blocks.flatMap((b) => b.boxes);
  const document = {
    querySelectorAll: (sel: string) => (sel.includes("checkbox") ? allBoxes : []),
  };
  const window = {
    getComputedStyle: (e: FakeEl) => ({
      display: e.paints ? "block" : "none",
      visibility: e.paints ? "visible" : "hidden",
    }),
  };
  // Give every node the DOM surface the script actually touches.
  for (const b of blocks) {
    for (const node of [b.wrapper, ...b.boxes]) {
      const anyNode = node as unknown as Record<string, unknown>;
      anyNode.parentElement = node.parent;
      anyNode.textContent = node.text;
      anyNode.getClientRects = () => (node.paints ? [{}] : []);
      anyNode.getBoundingClientRect = () => (node.paints ? { width: 10, height: 10 } : { width: 0, height: 0 });
      anyNode.querySelectorAll = (sel: string) => (sel.includes("checkbox") ? (node === b.wrapper ? b.boxes : []) : []);
    }
  }
  return new Function("document", "window", `return (${script});`)(document, window);
}

const script = () => buildWingConsentCompleteScript([API, CATEGORY]);

describe("buildWingConsentCompleteScript", () => {
  it("is true only when EVERY consent's own box is ticked", () => {
    expect(run(script(), [block(API, { checked: true }), block(CATEGORY, { checked: true })])).toBe(true);
  });

  it("is false while either consent is still untouched — one tick is not consent to both", () => {
    expect(run(script(), [block(API, { checked: true }), block(CATEGORY, { checked: false })])).toBe(false);
    expect(run(script(), [block(API, { checked: false }), block(CATEGORY, { checked: true })])).toBe(false);
    expect(run(script(), [block(API, { checked: false }), block(CATEGORY, { checked: false })])).toBe(false);
  });

  it("returns a BARE BOOLEAN — the per-box states never cross the boundary", () => {
    // This is the privacy property, not a style preference: a caller that could see WHICH box was ticked could
    // record a partial consent decision. The conjunction is computed in the page so that is unrepresentable.
    const out = run(script(), [block(API, { checked: true }), block(CATEGORY, { checked: false })]);
    expect(typeof out).toBe("boolean");
    expect(JSON.stringify(out)).toBe("false");
  });

  it("fails closed when a consent does not resolve to exactly one visible box", () => {
    // Two boxes in one block — the measured 1:1 pairing does not hold, so completion is NOT proven.
    expect(run(script(), [block(API, { checked: true, boxes: 2 }), block(CATEGORY, { checked: true })])).toBe(false);
    // A hidden box is not one the seller could have ticked.
    expect(run(script(), [block(API, { checked: true, visible: false }), block(CATEGORY, { checked: true })])).toBe(false);
  });

  it("fails closed when a consent sentence is absent altogether", () => {
    expect(run(script(), [block(API, { checked: true })])).toBe(false);
    expect(run(script(), [])).toBe(false);
  });

  it("fails closed on an empty consent list rather than reporting vacuous completion", () => {
    expect(run(buildWingConsentCompleteScript([]), [block(API, { checked: true })])).toBe(false);
  });

  it("ticking a box that belongs to a DIFFERENT consent does not complete the other", () => {
    // Both boxes ticked but both blocks carry the same sentence: neither consent resolves uniquely.
    expect(run(script(), [block(API, { checked: true }), block(API, { checked: true })])).toBe(false);
  });

  it("emits no field value, no text and no selector — the script's whole output is one boolean", () => {
    const src = script();
    for (const forbidden of [".value", "innerHTML", "outerHTML", "location", "href", "click(", "dispatchEvent"]) {
      expect(src, `consent script must not reference ${forbidden}`).not.toContain(forbidden);
    }
    // It reads `checked` — that is the deliberate change — and nothing else about the input.
    expect(src).toContain(".checked === true");
  });
});
