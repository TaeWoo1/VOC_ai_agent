/**
 * **The overlay has to survive the page MOVING under it — without a scroll and without a resize.**
 *
 * Two live-observed defects on the Coupang guided walk (2026-08-12), both in the repositioner:
 *
 *  1. The rings were bound to `scroll` and `resize` only. The vendor-method step's entire content IS a layout
 *     change — selecting 자체개발(직접입력) reveals the URL and IP rows and turns 업체명 from a dropdown into a
 *     text input — so the rings stayed at their mount coordinates and pointed at whatever had moved into that
 *     space. A ring is a claim about where to press; a stale one is worse than none.
 *  2. The guidance panel is docked bottom-centre, which is where a marketplace dialog puts its primary buttons.
 *     The panel carrying "press 확인 yourself" sat on top of 확인 — and unlike the ring it is not
 *     `pointer-events:none` when it has a button, so it can BLOCK the seller's own manual progress. That is the
 *     safety fence ("manual progress always remains available"), not a cosmetic complaint.
 *
 * Behavioural throughout, against a DOM double: both defects are behavioural, and a source assertion could not
 * have seen either. The double returns FULL rects (`right`/`bottom` as well as `left`/`top`) because the
 * occlusion test reads them — the previous double omitted them, which is its own small lesson about doubles.
 */
import { describe, expect, it } from "vitest";
import { mountOverlay, unmountOverlay } from "../../src/action-window/overlay";

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
  }
  remove(): void {
    this.removed = true;
    this.doc?.detach(this);
  }
  scrollIntoView(): void {
    /* read-only reveal; irrelevant here */
  }
  addEventListener(): void {
    /* the panel's advance button binds a click listener; nothing here presses it */
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

/** Give the mounted panel a real box, since the double's created elements start at zero size. */
function sizePanel(doc: Doc, r: Rect): El {
  const panel = doc.getElementById("__aw_advance_panel__")!;
  panel.rect = r;
  return panel;
}

/* ─────────────────────────────── 1. the ring follows a LAYOUT change ─────────────────────────────── */

describe("the ring tracks a layout change — not only a scroll and a resize", () => {
  it("**a DOM mutation that moves the control moves the ring**", async () => {
    // THE defect. The vendor step reveals two rows above the control it is ringing, so the control moves down
    // by their height with no scroll and no resize anywhere. Every fence in this area was on the ring's
    // CONTENTS; nothing watched whether it was still in the right place.
    const doc = new Doc();
    const target = tagged(doc, rect(100, 300, 120, 40));
    const { page, env } = fakePage(doc);
    await mountOverlay(page as never, BASE);
    const ring = doc.getElementById("__aw_overlay__")!;
    expect(ring.style["top"]).toBe("294px");

    target.rect = rect(100, 520, 120, 40); // the two revealed rows pushed it down
    env.mutate();

    expect(ring.style["top"]).toBe("514px");
    expect(ring.style["left"]).toBe("94px");
  });

  it("the tracker observes the document AND every ringed control, and a size change repositions too", async () => {
    const doc = new Doc();
    const target = tagged(doc, rect(10, 100, 200, 30));
    const { page, env } = fakePage(doc);
    await mountOverlay(page as never, BASE);
    // The control itself is observed, not just the document: a control that grows in place (a dropdown becoming
    // a text input) changes no document dimension.
    expect(env.resizeObserved).toContain(target);
    expect(env.resizeObserved).toContain(doc.documentElement);
    expect(env.resizeObserved).toContain(doc.body);
  });

  it("a timed backstop exists for movement that mutates nothing (a CSS transition)", async () => {
    const doc = new Doc();
    tagged(doc, rect(10, 100, 200, 30));
    const { page, env } = fakePage(doc);
    await mountOverlay(page as never, BASE);
    expect(env.intervals).toHaveLength(1);
    expect(env.intervals[0]!.ms).toBeLessThanOrEqual(1000);
  });

  it("**a reposition that changes nothing WRITES nothing** — otherwise the tracker feeds its own observer", async () => {
    // Assigning the same value still emits an attribute MutationRecord, so an unconditional write plus a
    // MutationObserver is a permanent rAF loop on every marketplace page the walk opens.
    const doc = new Doc();
    tagged(doc, rect(10, 100, 200, 30));
    const { page, env } = fakePage(doc);
    await mountOverlay(page as never, BASE);
    const ring = doc.getElementById("__aw_overlay__")!;
    const before = ring.styleWrites;
    env.mutate();
    env.mutate();
    expect(ring.styleWrites).toBe(before);
  });

  it("**a burst of layout changes costs ONE frame**, and the latch does not wedge after it", async () => {
    // WING mutates constantly (analytics, hydration), so an un-coalesced observer would reposition dozens of
    // times per frame. The subtle half is the latch: storing the rAF HANDLE as the pending flag looks
    // equivalent and wedges permanently under a host that runs the callback synchronously — which is exactly
    // how this file's own double behaves, and how the bug was found.
    const doc = new Doc();
    const target = tagged(doc, rect(10, 100, 200, 30));
    const { page, env } = fakePage(doc);
    const frames: (() => void)[] = [];
    env.win["requestAnimationFrame"] = (fn: () => void): number => {
      frames.push(fn);
      return frames.length;
    };
    await mountOverlay(page as never, BASE);
    env.mutate();
    env.mutate();
    env.mutate();
    expect(frames).toHaveLength(1); // three bursts, one frame

    env.run(() => frames[0]!());
    target.rect = rect(10, 400, 200, 30);
    env.mutate();
    expect(frames).toHaveLength(2); // …and the next burst is not swallowed
    env.run(() => frames[1]!());
    expect(doc.getElementById("__aw_overlay__")!.style["top"]).toBe("394px");
  });

  it("teardown disconnects both observers and clears the backstop", async () => {
    const doc = new Doc();
    tagged(doc, rect(10, 100, 200, 30));
    const { page, env } = fakePage(doc);
    await mountOverlay(page as never, BASE);
    await unmountOverlay(page as never);
    expect(env.disconnects).toContain("mutation");
    expect(env.disconnects).toContain("resize");
    expect(env.clearedIntervals).toHaveLength(1);
  });

  it("a re-mount tears the previous tracker down before installing its own", async () => {
    const doc = new Doc();
    tagged(doc, rect(10, 100, 200, 30));
    const { page, env } = fakePage(doc);
    await mountOverlay(page as never, BASE);
    await mountOverlay(page as never, BASE);
    // Observers accumulating across steps is how a long walk ends up repositioning N times per frame.
    expect(env.disconnects).toContain("mutation");
    expect(env.disconnects).toContain("resize");
  });
});

/* ─────────────────────────── 2. the panel stays OFF the control it describes ─────────────────────────── */

describe("the guidance panel never covers the control it is pointing at", () => {
  it("**it moves to the top when the control sits under the bottom dock**", async () => {
    // Live-observed twice: the panel telling the seller to press 확인, sitting on 확인. It takes clicks when it
    // carries a button, so this is manual progress being blocked, not a cosmetic overlap.
    const doc = new Doc();
    tagged(doc, rect(200, 700, 100, 40));
    const { page, env } = fakePage(doc, 800);
    await mountOverlay(page as never, PANEL);
    const panel = sizePanel(doc, rect(100, 676, 400, 100));
    env.mutate();
    expect(panel.style["top"]).toBe("24px");
    expect(panel.style["bottom"]).toBe("auto");
  });

  it("it stays at the bottom when nothing is under it", async () => {
    const doc = new Doc();
    tagged(doc, rect(200, 300, 100, 40));
    const { page, env } = fakePage(doc, 800);
    await mountOverlay(page as never, PANEL);
    const panel = sizePanel(doc, rect(100, 676, 400, 100));
    env.mutate();
    expect(panel.style["bottom"]).toBe("24px");
    expect(panel.style["top"]).toBe("auto");
  });

  it("a control BESIDE the panel is not treated as under it", async () => {
    // Horizontal extent comes from the panel's own rect. A narrow panel and a control in the opposite margin
    // overlap on the vertical band and nowhere else; flipping for that would move the panel for no reason.
    const doc = new Doc();
    tagged(doc, rect(900, 700, 100, 40));
    const { page, env } = fakePage(doc, 800);
    await mountOverlay(page as never, PANEL);
    const panel = sizePanel(doc, rect(100, 676, 400, 100));
    env.mutate();
    expect(panel.style["bottom"]).toBe("24px");
  });

  it("**both ends covered ⇒ it stays put** — a panel that flips every frame is its own defect", async () => {
    const doc = new Doc();
    tagged(doc, rect(200, 700, 100, 40));
    tagged(doc, rect(200, 30, 100, 40));
    const { page, env } = fakePage(doc, 800);
    await mountOverlay(page as never, PANEL);
    const panel = sizePanel(doc, rect(100, 676, 400, 100));
    env.mutate();
    expect(panel.style["bottom"]).toBe("24px");
    const writes = panel.styleWrites;
    env.mutate();
    env.mutate();
    // Decided from the two PROSPECTIVE positions, never from where the panel currently is — so repeating the
    // decision cannot change it.
    expect(panel.style["bottom"]).toBe("24px");
    expect(panel.styleWrites).toBe(writes);
  });

  it("the decision is re-made when the layout moves the control INTO the panel", async () => {
    const doc = new Doc();
    const target = tagged(doc, rect(200, 300, 100, 40));
    const { page, env } = fakePage(doc, 800);
    await mountOverlay(page as never, PANEL);
    const panel = sizePanel(doc, rect(100, 676, 400, 100));
    env.mutate();
    expect(panel.style["bottom"]).toBe("24px");
    target.rect = rect(200, 700, 100, 40);
    env.mutate();
    expect(panel.style["top"]).toBe("24px");
    expect(panel.style["bottom"]).toBe("auto");
  });
});
