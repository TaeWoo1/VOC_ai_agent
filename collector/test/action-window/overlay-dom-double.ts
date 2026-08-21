/**
 * **The overlay's DOM double** — a fake document with a real layout, shared by every test that drives the
 * REAL `mountOverlay` page function.
 *
 * No jsdom: jsdom has no layout, so the panel-placement logic (which reads `getBoundingClientRect` on every
 * ring and every keep-clear mark) would compare zeroes and pass for the wrong reason.
 *
 * It moved out of `overlay-layout-tracking.test.ts` when a SECOND suite needed it — the guided panel shell the
 * Coupang and NAVER walks now share. A second copy of a double is how two suites end up being checked against
 * two different ideas of what a page can do.
 */
/* ─────────────────────────────── a DOM double with a layout ─────────────────────────────── */

interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
  right: number;
  bottom: number;
}

const rect = (left: number, top: number, width: number, height: number): Rect => ({
  left,
  top,
  width,
  height,
  right: left + width,
  bottom: top + height,
});

class El {
  id = "";
  textContent = "";
  readonly children: El[] = [];
  readonly attrs: Record<string, string> = {};
  style: Record<string, string> = {};
  /** How many style property WRITES this element has taken — the self-feeding-loop assertion reads it. */
  styleWrites = 0;
  removed = false;
  rect: Rect;
  constructor(
    public tagName = "DIV",
    r: Rect = rect(0, 0, 0, 0),
    private readonly doc?: Doc,
  ) {
    this.rect = r;
    const own: Record<string, string> = {};
    this.style = new Proxy(own, {
      set: (t, k: string, v: string) => {
        if (t[k] !== v) this.styleWrites++;
        t[k] = v;
        // `cssText` in a real DOM POPULATES the individual properties, and code that reads one back after
        // setting the other depends on it — the panel's disclosure decides whether it is open by reading
        // `style.display`, which the mount set through `cssText`. A double that stores the string and nothing
        // else makes that read answer `undefined`, which is a bug the double invented.
        if (k === "cssText") {
          for (const decl of String(v).split(";")) {
            const at = decl.indexOf(":");
            if (at < 0) continue;
            const prop = decl.slice(0, at).trim();
            if (prop) t[prop] = decl.slice(at + 1).trim();
          }
        }
        return true;
      },
    });
  }
  setAttribute(n: string, v: string): void {
    this.attrs[n] = v;
  }
  getAttribute(n: string): string | null {
    return this.attrs[n] ?? null;
  }
  hasAttribute(n: string): boolean {
    return n in this.attrs;
  }
  removeAttribute(n: string): void {
    delete this.attrs[n];
  }
  appendChild(c: El): void {
    this.children.push(c);
    // Registered with the document, not just parented — the panel's own children (the disclosure toggle and the
    // detail block) are looked up by id, and a double where an appended node is unreachable by `getElementById`
    // models a DOM nobody has.
    this.doc?.register(c);
  }
  remove(): void {
    this.removed = true;
    this.doc?.detach(this);
  }
  scrollIntoView(): void {
    /* read-only reveal; irrelevant here */
  }
  /**
   * Recorded, never auto-fired: a test presses deliberately, and it must say WHAT KIND of press it is — the
   * panel's buttons honour only `isTrusted` events, so a double that delivered no event (or an untrusted one)
   * would model a page where nothing is pressable at all.
   */
  readonly listeners: { type: string; fn: (ev: { isTrusted: boolean }) => void }[] = [];
  addEventListener(type: string, fn: (ev: { isTrusted: boolean }) => void): void {
    this.listeners.push({ type, fn });
  }
  getBoundingClientRect(): Rect {
    return this.rect;
  }
}

function matches(el: El, selector: string): boolean {
  return selector.split(",").some((raw) => {
    const s = raw.trim();
    if (s.startsWith("#")) return el.id === s.slice(1);
    if (s.startsWith("[") && s.endsWith("]")) return el.hasAttribute(s.slice(1, -1));
    return false;
  });
}

class Doc {
  readonly body = new El("BODY");
  readonly documentElement = new El("HTML");
  private nodes: El[] = [];
  seed(...els: El[]): void {
    this.nodes.push(...els);
  }
  detach(el: El): void {
    this.nodes = this.nodes.filter((n) => n !== el);
  }
  createElement(tag: string): El {
    return new El(tag.toUpperCase(), rect(0, 0, 0, 0), this);
  }
  register(el: El): void {
    if (!this.nodes.includes(el)) this.nodes.push(el);
  }
  querySelectorAll(sel: string): El[] {
    return this.nodes.filter((n) => !n.removed && matches(n, sel));
  }
  getElementById(id: string): El | null {
    return this.nodes.find((n) => !n.removed && n.id === id) ?? null;
  }
}

interface Env {
  doc: Doc;
  win: Record<string, unknown>;
  listeners: { type: string; fn: () => void }[];
  /** Deliver a layout-change notification the way the page would: through the observers the mount installed. */
  mutate: () => void;
  /** Run a callback with the double installed as `document`/`window` — e.g. a captured rAF frame. */
  run: (fn: () => void) => void;
  resizeObserved: El[];
  intervals: { fn: () => void; ms: number }[];
  disconnects: string[];
  clearedIntervals: number[];
}

function fakePage(doc: Doc, innerHeight = 800): { page: { evaluate: (fn: unknown, arg?: unknown) => Promise<unknown> }; env: Env } {
  const listeners: { type: string; fn: () => void }[] = [];
  const mutationCbs: (() => void)[] = [];
  const resizeCbs: (() => void)[] = [];
  const resizeObserved: El[] = [];
  const intervals: { fn: () => void; ms: number }[] = [];
  const disconnects: string[] = [];
  const clearedIntervals: number[] = [];
  // rAF is executed SYNCHRONOUSLY here. The coalescing it exists for is asserted separately (by counting style
  // writes); running it inline keeps every other case reading as "the page moved, then the ring moved".
  const win: Record<string, unknown> = {
    innerHeight,
    // The placement now chooses horizontally as well as vertically, so the double needs a width to choose in.
    innerWidth: 1200,
    addEventListener: (type: string, fn: () => void) => listeners.push({ type, fn }),
    removeEventListener: () => undefined,
    requestAnimationFrame: (fn: () => void) => {
      fn();
      return 7;
    },
    cancelAnimationFrame: () => undefined,
    setInterval: (fn: () => void, ms: number) => {
      intervals.push({ fn, ms });
      return intervals.length;
    },
    clearInterval: (h: number) => clearedIntervals.push(h),
  };
  class FakeMutationObserver {
    constructor(private readonly cb: () => void) {}
    observe(): void {
      mutationCbs.push(this.cb);
    }
    disconnect(): void {
      disconnects.push("mutation");
    }
  }
  class FakeResizeObserver {
    constructor(private readonly cb: () => void) {}
    observe(el: El): void {
      resizeObserved.push(el);
      if (!resizeCbs.includes(this.cb)) resizeCbs.push(this.cb);
    }
    disconnect(): void {
      disconnects.push("resize");
    }
  }
  win["MutationObserver"] = FakeMutationObserver;
  win["ResizeObserver"] = FakeResizeObserver;
  const realAppend = doc.body.appendChild.bind(doc.body);
  doc.body.appendChild = (c: El): void => {
    realAppend(c);
    doc.register(c);
  };
  const withGlobals = <T,>(run: () => T): T => {
    const g = globalThis as unknown as Record<string, unknown>;
    const prev = { doc: g["document"], win: g["window"], mo: g["MutationObserver"], ro: g["ResizeObserver"] };
    g["document"] = doc;
    g["window"] = win;
    g["MutationObserver"] = FakeMutationObserver;
    g["ResizeObserver"] = FakeResizeObserver;
    try {
      return run();
    } finally {
      g["document"] = prev.doc;
      g["window"] = prev.win;
      g["MutationObserver"] = prev.mo;
      g["ResizeObserver"] = prev.ro;
    }
  };
  const page = {
    evaluate: async (fn: unknown, arg?: unknown): Promise<unknown> => withGlobals(() => (fn as (a?: unknown) => unknown)(arg)),
  };
  const mutate = (): void => {
    withGlobals(() => {
      for (const cb of mutationCbs) cb();
    });
  };
  const run = (fn: () => void): void => {
    withGlobals(fn);
  };
  return { page, env: { doc, win, listeners, mutate, run, resizeObserved, intervals, disconnects, clearedIntervals } };
}

const BASE = {
  stepNumber: 7,
  totalSteps: 9,
  copyKey: "actionWindow.coupangIssuance.step.vendor_confirm",
  guidanceEnabled: true,
};
const PANEL = { ...BASE, residentPanel: true, label: "'확인'을 직접 누르세요", advance: { buttonLabel: "확인을 눌렀어요 · 다음", token: "tok" } };

function tagged(doc: Doc, r: Rect): El {
  const el = new El("BUTTON", r, doc);
  el.setAttribute("data-aw-target", "");
  doc.seed(el);
  return el;
}

/** A control the step declares it must KEEP CLEAR of — no ring on it, and the panel still steps around it. */
function avoided(doc: Doc, r: Rect): El {
  const el = new El("BUTTON", r, doc);
  el.setAttribute("data-aw-avoid", "");
  doc.seed(el);
  return el;
}

/** Give the mounted panel a real box, since the double's created elements start at zero size. */
function sizePanel(doc: Doc, r: Rect): El {
  const panel = doc.getElementById("__aw_advance_panel__")!;
  panel.rect = r;
  return panel;
}

export { El, Doc, rect, fakePage, tagged, avoided, sizePanel, BASE, PANEL };
export type { Rect, Env };
