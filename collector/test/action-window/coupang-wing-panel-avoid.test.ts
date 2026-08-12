/**
 * **The keep-clear marks the guidance panel steers around — `data-aw-avoid`.**
 *
 * The panel is docked, and it is the one part of this guidance that takes clicks. A panel parked on a control
 * the seller has to use is manual progress being blocked, which is a safety fence rather than a cosmetic
 * concern — and it happened: on 2026-08-12 the panel sat on WING's `확인` while step ⑥ ringed the option above
 * it. The placement could not see it, because `확인` carried no tag until the next step.
 *
 * Two things are pinned here: what the generated script marks (the REAL script, run against a fake DOM, like
 * every other in-page instrument in this suite), and that it stays value-free while doing it.
 */
import { describe, expect, it } from "vitest";
import { buildFixedLabelAvoidTagScript } from "../../src/action-window/api-issuance-calibration/visual-recon-inpage";

interface ElInit {
  tag: string;
  text?: string;
  children?: El[];
  attrs?: Record<string, string>;
  display?: string;
  rects?: number;
}

class El {
  readonly tagName: string;
  readonly children: El[] = [];
  private readonly ownText: string;
  private readonly attrs: Map<string, string>;
  private readonly display: string;
  private readonly rects: number;

  constructor(init: ElInit) {
    this.tagName = init.tag.toUpperCase();
    this.ownText = init.text ?? "";
    this.attrs = new Map(Object.entries(init.attrs ?? {}));
    this.display = init.display ?? "block";
    this.rects = init.rects ?? 1;
    this.children.push(...(init.children ?? []));
  }

  get textContent(): string {
    return this.ownText + this.children.map((c) => c.textContent).join("");
  }
  get childElementCount(): number {
    return this.children.length;
  }
  getAttribute(n: string): string | null {
    return this.attrs.has(n) ? this.attrs.get(n)! : null;
  }
  hasAttribute(n: string): boolean {
    return this.attrs.has(n);
  }
  setAttribute(n: string, v: string): void {
    this.attrs.set(n, v);
  }
  removeAttribute(n: string): void {
    this.attrs.delete(n);
  }
  computedStyle(): { display: string; visibility: string } {
    return { display: this.display, visibility: "visible" };
  }
  getClientRects(): unknown[] {
    return new Array(this.rects).fill({});
  }
  getBoundingClientRect(): { width: number; height: number } {
    return { width: 100, height: 20 };
  }
  descendants(): El[] {
    return this.children.flatMap((c) => [c, ...c.descendants()]);
  }
}

/** Tag lists and the one attribute selector this script issues. */
function matchAll(pool: readonly El[], sel: string): El[] {
  const wanted = sel.split(",").map((s) => s.trim());
  return pool.filter((e) =>
    wanted.some((w) => (w.startsWith("[") ? e.hasAttribute(w.slice(1, -1)) : e.tagName === w.toUpperCase())),
  );
}

function runAvoid(specs: readonly { candidateQuery: string; exactText: string }[], root: El): { all: El[]; result: unknown } {
  const all = [root, ...root.descendants()];
  const document = { querySelectorAll: (sel: string): El[] => matchAll(all, sel) };
  const window = { getComputedStyle: (el: El) => el.computedStyle() };
  const result = new Function("document", "window", `return (${buildFixedLabelAvoidTagScript({ specs })});`)(document, window);
  return { all, result };
}

const marked = (all: readonly El[]): string[] => all.filter((e) => e.hasAttribute("data-aw-avoid")).map((e) => e.textContent);

const LABEL_QUERY = "label,legend,th,dt";
const VENDOR_SPECS = [
  { candidateQuery: LABEL_QUERY, exactText: "업체명" },
  { candidateQuery: LABEL_QUERY, exactText: "URL" },
  { candidateQuery: "button,a", exactText: "확인" },
];

/** The vendor screen as it was measured: `DT` labels, and a `확인` that is the only painting one on the page. */
function vendorScreen(opts: { hiddenConfirm?: boolean; twoConfirms?: boolean } = {}): El {
  return new El({
    tag: "div",
    children: [
      new El({ tag: "dt", text: "업체명" }),
      new El({ tag: "dt", text: "URL" }),
      new El({ tag: "dt", text: "IP 주소" }),
      new El({ tag: "button", text: "취소" }),
      new El({ tag: "button", text: "확인", ...(opts.hiddenConfirm ? { display: "none" } : {}) }),
      ...(opts.twoConfirms ? [new El({ tag: "button", text: "확인" })] : []),
    ],
  });
}

describe("the keep-clear marks", () => {
  it("marks each declared control that resolves to exactly one painting element", () => {
    const { all, result } = runAvoid(VENDOR_SPECS, vendorScreen());
    expect(result).toEqual({ marked: 3 });
    expect(marked(all).sort()).toEqual(["URL", "업체명", "확인"].sort());
  });

  it("**a spec that does not resolve simply contributes nothing** — unlike a ring, this is best-effort", () => {
    // A ring is a claim about where a control is, so half a claim is a wrong one and the ring plan is
    // all-or-nothing. A keep-clear mark makes no claim: it is a hint about where NOT to dock a panel. Failing
    // the mount over one would trade a real step for a hint.
    const { all, result } = runAvoid(VENDOR_SPECS, vendorScreen({ twoConfirms: true }));
    expect(result).toEqual({ marked: 2 });
    expect(marked(all)).not.toContain("확인");
  });

  it("a control that does not paint is not a box to steer around", () => {
    const { all } = runAvoid(VENDOR_SPECS, vendorScreen({ hiddenConfirm: true }));
    expect(marked(all)).not.toContain("확인");
  });

  it("**every previous mark is cleared first**, so an empty spec list is how a step says 'nothing'", () => {
    // A stale mark from the previous step pushes the panel away from a control nobody is being sent to — the
    // same class of defect as the stale ring anchor this walk has already had to fix twice.
    const screen = vendorScreen();
    const { all } = runAvoid(VENDOR_SPECS, screen);
    expect(marked(all).length).toBe(3);
    const again = runAvoid([], screen);
    expect(again.result).toEqual({ marked: 0 });
    expect(marked(again.all)).toEqual([]);
  });

  it("returns a COUNT and nothing else — no text, no signature, no value", () => {
    const { result } = runAvoid(VENDOR_SPECS, vendorScreen());
    expect(Object.keys(result as object)).toEqual(["marked"]);
    expect(JSON.stringify(result)).not.toContain("업체명");
  });

  it("its script reads no field value and presses nothing", () => {
    const src = buildFixedLabelAvoidTagScript({ specs: VENDOR_SPECS });
    for (const token of [".click(", ".value", ".focus(", "dispatchEvent", "innerHTML"]) {
      expect(src, token).not.toContain(token);
    }
  });
});
