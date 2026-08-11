/**
 * **A step that names two controls must be able to point at both.**
 *
 * `confirm_purpose` asks the seller to check the purpose and then press 확인; `terms_consent` asks them to tick
 * two separate consents, and agreeing to one is not agreeing to the other. Until 2026-08-11 the overlay ringed
 * whichever tagged element `querySelector` returned first, so either step could only ever have pointed at half
 * of what its panel says.
 *
 * The promotion record is MOCKED throughout, so each case can state the shape it is about — all four promoted
 * (what shipped on 2026-08-11), one withdrawn, all withdrawn. The shipped state is asserted in exactly one
 * place, `guided-control-highlight-calibration.test.ts`, and a behavioural test that needed it changed could
 * only be made green by making that assertion false.
 *
 * The mount body is executed against a hand-built DOM double rather than asserted as source text: the defect
 * being fixed was behavioural (one ring where two were tagged), and a source assertion cannot see it.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { mountOverlay, unmountOverlay, refreshOverlay } from "../../../src/action-window/overlay";
import { buildFixedLabelLocateScript } from "../../../src/action-window/api-issuance-calibration/visual-recon-inpage";

/* ─────────────────────────────── a minimal DOM double ─────────────────────────────── */

class El {
  id = "";
  textContent = "";
  childElementCount = 0;
  readonly children: El[] = [];
  readonly attrs: Record<string, string> = {};
  readonly style: Record<string, string> = {};
  scrolled = false;
  removed = false;
  constructor(
    public tagName = "DIV",
    private rect = { left: 0, top: 0, width: 0, height: 0 },
    private readonly doc?: Doc,
  ) {}
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
    this.childElementCount = this.children.length;
  }
  remove(): void {
    this.removed = true;
    this.doc?.detach(this);
  }
  scrollIntoView(): void {
    this.scrolled = true;
  }
  getBoundingClientRect(): { left: number; top: number; width: number; height: number } {
    return this.rect;
  }
}

/** Supports exactly the selector shapes the overlay uses: comma-separated `#id` and `[attr]`. */
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
  /** Everything reachable by a query: page elements the test seeded plus everything the mount appended. */
  private nodes: El[] = [];
  seed(...els: El[]): void {
    this.nodes.push(...els);
  }
  detach(el: El): void {
    this.nodes = this.nodes.filter((n) => n !== el);
  }
  createElement(tag: string): El {
    const el = new El(tag.toUpperCase(), { left: 0, top: 0, width: 0, height: 0 }, this);
    // Appended to the document's queryable set as soon as it is created; `appendChild` on a real document is
    // what makes it findable, and the double's body append routes through here.
    return el;
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

interface Mounted {
  doc: Doc;
  win: Record<string, unknown>;
  listeners: { type: string; fn: () => void }[];
}

/** A fake page whose `evaluate(fn, opts)` runs the real mount body against the double. */
function fakePage(doc: Doc): { page: { evaluate: (fn: unknown, arg?: unknown) => Promise<unknown> }; env: Mounted } {
  const listeners: { type: string; fn: () => void }[] = [];
  const win: Record<string, unknown> = {
    addEventListener: (type: string, fn: () => void) => listeners.push({ type, fn }),
    removeEventListener: () => undefined,
  };
  // `document.body.appendChild` must make the node queryable, which the real DOM does implicitly.
  const realAppend = doc.body.appendChild.bind(doc.body);
  doc.body.appendChild = (c: El): void => {
    realAppend(c);
    doc.register(c);
  };
  const page = {
    evaluate: async (fn: unknown, arg?: unknown): Promise<unknown> => {
      const g = globalThis as unknown as Record<string, unknown>;
      const prevDoc = g["document"];
      const prevWin = g["window"];
      g["document"] = doc;
      g["window"] = win;
      try {
        return (fn as (a?: unknown) => unknown)(arg);
      } finally {
        g["document"] = prevDoc;
        g["window"] = prevWin;
      }
    },
  };
  return { page, env: { doc, win, listeners } };
}

const BASE = { stepNumber: 4, totalSteps: 7, copyKey: "actionWindow.coupangIssuance.step.terms_consent", guidanceEnabled: true };
const rings = (doc: Doc): El[] => doc.querySelectorAll("#__aw_overlay__,[data-aw-ring-secondary]");
const chip = (box: El): El | undefined => box.children.find((c) => c.hasAttribute("data-aw-badge"));

describe("the WING overlay rings EVERY tagged control", () => {
  function tagged(): { doc: Doc; a: El; b: El } {
    const doc = new Doc();
    const a = new El("LABEL", { left: 10, top: 20, width: 200, height: 24 }, doc);
    const b = new El("LABEL", { left: 10, top: 80, width: 240, height: 24 }, doc);
    a.setAttribute("data-aw-target", "");
    b.setAttribute("data-aw-target", "");
    doc.seed(a, b);
    return { doc, a, b };
  }

  it("**two tagged controls produce two rings** — not one", async () => {
    const { doc } = tagged();
    const { page } = fakePage(doc);
    await mountOverlay(page as never, BASE);
    expect(rings(doc)).toHaveLength(2);
  });

  it("each ring tracks its OWN control's rect, so the second is not drawn over the first", async () => {
    const { doc } = tagged();
    const { page } = fakePage(doc);
    await mountOverlay(page as never, BASE);
    const [primary, secondary] = rings(doc);
    // -6 / +12 is the overlay's own padding; what matters is that the two differ by the controls' own offsets.
    expect(primary!.style["top"]).toBe("14px");
    expect(secondary!.style["top"]).toBe("74px");
    expect(secondary!.style["width"]).toBe("252px");
  });

  it("the chip is on the PRIMARY and appears exactly once", async () => {
    // Two chips carrying the same step text, on two controls, is the crowding that made the first chip
    // unreadable in the first place — and a chip is a claim about which control the step is about.
    const { doc, b } = tagged();
    b.setAttribute("data-aw-primary", "");
    const { page } = fakePage(doc);
    await mountOverlay(page as never, { ...BASE, badgeLabel: "약관 2건 동의" });
    const withChip = rings(doc).filter((r) => chip(r) !== undefined);
    expect(withChip).toHaveLength(1);
    expect(chip(withChip[0]!)!.textContent).toBe("4/7 · 약관 2건 동의");
    // …and the primary is the element that was MARKED, not the one that happens to come first.
    expect(withChip[0]!.getAttribute("data-aw-ring-index")).toBe("1");
    expect(withChip[0]!.style["top"]).toBe("74px");
  });

  it("only the PRIMARY is scrolled into view — a second scroll would fight the first", async () => {
    const { doc, a, b } = tagged();
    b.setAttribute("data-aw-primary", "");
    const { page } = fakePage(doc);
    await mountOverlay(page as never, BASE);
    expect(b.scrolled).toBe(true);
    expect(a.scrolled).toBe(false);
  });

  it("**the page-dimming shroud is dropped once there is more than one ring**", async () => {
    // Two shrouds stack their darkness, so the second ring's own control ends up dimmed by the first — the
    // emphasis would land on neither. A single ring keeps exactly the dimming it has always had.
    const { doc } = tagged();
    const { page } = fakePage(doc);
    await mountOverlay(page as never, BASE);
    for (const r of rings(doc)) expect(r.style["cssText"]).not.toContain("9999px");

    const single = new Doc();
    const only = new El("BUTTON", { left: 0, top: 0, width: 10, height: 10 }, single);
    only.setAttribute("data-aw-target", "");
    single.seed(only);
    const { page: p2 } = fakePage(single);
    await mountOverlay(p2 as never, BASE);
    expect(rings(single)).toHaveLength(1);
    expect(rings(single)[0]!.style["cssText"]).toContain("box-shadow:0 0 0 9999px rgba(0,0,0,0.28)");
  });

  it("**a remount removes the previous step's secondary rings**", async () => {
    // The stale-anchor defect one layer out. Secondary rings are separate elements from `__aw_overlay__`, so
    // removing only the primary would leave last step's extra rings painted over this step's screen.
    const { doc, a, b } = tagged();
    const { page } = fakePage(doc);
    await mountOverlay(page as never, BASE);
    expect(rings(doc)).toHaveLength(2);
    b.removeAttribute("data-aw-target");
    a.setAttribute("data-aw-primary", "");
    await mountOverlay(page as never, BASE);
    expect(rings(doc)).toHaveLength(1);
    expect(doc.querySelectorAll("[data-aw-ring-secondary]")).toHaveLength(0);
  });

  it("unmount and the guidance toggle reach EVERY ring, not just the primary", async () => {
    const { doc } = tagged();
    const { page } = fakePage(doc);
    await mountOverlay(page as never, BASE);
    await unmountOverlay(page as never);
    expect(rings(doc)).toHaveLength(0);
  });

  it("refreshOverlay repositions every ring from its own control", async () => {
    const doc = new Doc();
    let topA = 20;
    const a = new El("LABEL", { left: 10, top: 20, width: 200, height: 24 }, doc);
    const b = new El("LABEL", { left: 10, top: 80, width: 240, height: 24 }, doc);
    // The rect the double returns is captured at construction, so move it by rebuilding the getter.
    a.getBoundingClientRect = () => ({ left: 10, top: topA, width: 200, height: 24 });
    a.setAttribute("data-aw-target", "");
    b.setAttribute("data-aw-target", "");
    doc.seed(a, b);
    const { page } = fakePage(doc);
    await mountOverlay(page as never, BASE);
    topA = 500;
    await refreshOverlay(page as never);
    expect(rings(doc)[0]!.style["top"]).toBe("494px");
    expect(rings(doc)[1]!.style["top"]).toBe("74px");
  });

  it("**docked mode ignores a stale tag at mount AND on every scroll**", async () => {
    // The guard existed at mount and was missing in the repositioner, which re-queries the tag set on every
    // scroll — a guard fixed in one place and left standing in its sibling.
    const doc = new Doc();
    const stale = new El("BUTTON", { left: 5, top: 300, width: 80, height: 30 }, doc);
    stale.setAttribute("data-aw-target", "");
    doc.seed(stale);
    const { page, env } = fakePage(doc);
    await mountOverlay(page as never, { ...BASE, dockedPanelOnly: true, residentPanel: true, label: "약관 2건" });
    const box = doc.getElementById("__aw_overlay__")!;
    expect(box.style["top"]).toBe("0px");
    expect(box.style["border"]).toBe("none");
    expect(doc.querySelectorAll("[data-aw-ring-secondary]")).toHaveLength(0);
    // Fire the scroll listener the mount installed: the docked box must not acquire the stale anchor's geometry.
    for (const l of env.listeners) l.fn();
    expect(box.style["top"]).toBe("0px");
    expect(stale.scrolled).toBe(false);
  });
});

/* ─────────────────────────── the locate script's tagging modes ─────────────────────────── */

describe("buildFixedLabelLocateScript — additive tagging for a multi-control step", () => {
  it("clears BOTH markers by default, so a prior step's primary cannot survive into this one", () => {
    const src = buildFixedLabelLocateScript({ candidateQuery: "button", exactText: "확인", tag: true });
    expect(src).toContain("removeAttribute('data-aw-target')");
    // The one the first version forgot: a leftover `data-aw-primary` would put this step's chip on last step's
    // control while the ring set was otherwise correct — the failure that is hardest to see, because everything
    // else about the presentation looks right.
    expect(src).toContain("removeAttribute('data-aw-primary')");
  });

  it("`keepPriorTags` skips the clear — and still tags exactly one element", () => {
    const src = buildFixedLabelLocateScript({ candidateQuery: "label", exactText: "OPEN API", tag: true, keepPriorTags: true });
    expect(src).not.toContain("removeAttribute('data-aw-target')");
    expect(src).toContain("tagEl.setAttribute('data-aw-target', '')");
    // Unchanged fail-closed core: only a UNIQUE VISIBLE match is ever tagged.
    expect(src).toContain("if (visible.length !== 1) { return { count: visible.length, hiddenCount: hiddenCount }; }");
  });

  it("`primary` marks the chip's control, and is absent unless asked for", () => {
    const withP = buildFixedLabelLocateScript({ candidateQuery: "button", exactText: "확인", tag: true, primary: true });
    const without = buildFixedLabelLocateScript({ candidateQuery: "button", exactText: "확인", tag: true });
    expect(withP).toContain("tagEl.setAttribute('data-aw-primary', '')");
    expect(without).not.toContain("data-aw-primary', '')");
  });

  it("neither option touches a NON-tagging locate — the read-only probe is unchanged", () => {
    // `probeTargetMatch` / `probeFixedLabelMatch` run this with `tag: false`, under READ_ONLY manifests. A
    // tagging branch reachable from those would be a page mutation no manifest describes.
    const src = buildFixedLabelLocateScript({ candidateQuery: "button", exactText: "확인", tag: false, keepPriorTags: true, primary: true });
    expect(src).not.toContain("setAttribute");
    expect(src).not.toContain("removeAttribute");
  });
});

/* ─────────────────────────── the driver, with a promotion simulated ─────────────────────────── */

/**
 * The promotion record, MOCKED so each case can state the shape it is about — including the one the shipped
 * record does not currently hold (a withdrawn calibration) and the one it does (all four promoted). Mocking
 * rather than editing the source, because the source state is itself an assertion
 * (`guided-control-highlight-calibration.test.ts` pins exactly what is ringed today), and a test that needed
 * the real record changed could only be made green by making that assertion false.
 */
const promo = vi.hoisted(() => ({
  table: {} as Record<string, { candidateId: string | null; promoted: boolean }>,
}));

const ALL_PROMOTED: Record<string, { candidateId: string | null; promoted: boolean }> = {
  confirm: { candidateId: "stage2.confirm.actionable", promoted: true },
  purpose_open_api: { candidateId: "stage2.purpose_open_api.label", promoted: true },
  consent_api: { candidateId: "stage3.terms.api_agree.label", promoted: true },
  consent_category: { candidateId: "stage3.terms.category_agree.label", promoted: true },
};

vi.mock("../../../src/action-window/coupang-wing-label-recon", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    wingGuidedHighlightPromotion: (t: string) => {
      const row = promo.table[t];
      if (!row) throw new Error(`no guided-highlight promotion entry for ${t}`);
      return { target: t, screen: "PURPOSE", blockedReason: row.promoted ? null : "TEST", ...row };
    },
  };
});

/** A fake page that answers the locate script with a unique match, and records every script it was sent. */
class LocatePage {
  readonly scripts: string[] = [];
  readonly mounts: Record<string, unknown>[] = [];
  constructor(private readonly counts: readonly number[] = []) {}
  private locates = 0;
  url(): string {
    return "https://wing.coupang.com/vendor/open-api";
  }
  on(): void {
    /* close handler */
  }
  async evaluate(script: unknown, arg?: unknown): Promise<unknown> {
    if (typeof script === "string") {
      this.scripts.push(script);
      if (script.includes("issuance-fixed-label")) {
        const n = this.counts[this.locates] ?? 1;
        this.locates += 1;
        return n === 1 ? { count: 1, hiddenCount: 0, tag: "LABEL", sig: `sig${this.locates}0000000000` } : { count: n, hiddenCount: 0 };
      }
      return true;
    }
    if (arg !== undefined) {
      this.mounts.push(arg as Record<string, unknown>);
      return undefined;
    }
    return true; // overlayMounted
  }
}

describe("the driver's promoted ring path", () => {
  beforeEach(() => {
    promo.table = { ...ALL_PROMOTED };
  });

  async function driver(page: LocatePage) {
    const { CoupangWingIssuanceDriver } = await import("../../../src/action-window/coupang-wing-issuance-driver");
    return new CoupangWingIssuanceDriver(page as never, { verifyPollMs: 0 });
  }

  it("a promoted step QUERIES the page instead of returning its text-guided signature", async () => {
    // The precedence that decides what the step IS. `confirm_purpose` sits in both tables — text-guided until
    // calibrated, ringed afterwards — so a promotion that lost this race would leave the ring unreachable.
    const page = new LocatePage();
    const res = await (await driver(page)).locateTarget("confirm_purpose");
    expect(res.count).toBe(1);
    expect(page.scripts.filter((s) => s.includes("issuance-fixed-label"))).toHaveLength(2);
    // NOT the synthetic guidance constant for this step.
    expect(res.sig).not.toBe("b48e2f05b48e2f05");
  });

  it("locate and highlight fold to the SAME signature — the engine's anti-drift check compares them", async () => {
    const locate = new LocatePage();
    const located = await (await driver(locate)).locateTarget("confirm_purpose");
    const hl = new LocatePage();
    const highlighted = await (await driver(hl)).highlightTarget("confirm_purpose");
    expect(highlighted.count).toBe(1);
    expect(highlighted.sig).toBe(located.sig);
  });

  it("highlighting clears the prior tags ONCE, then tags additively", async () => {
    // A per-call clear would leave only the LAST spec tagged, which is the single-ring assumption this path
    // exists to lift — and the step would silently go back to ringing one control.
    const page = new LocatePage();
    await (await driver(page)).highlightTarget("confirm_purpose");
    expect(page.scripts.filter((s) => s.includes("coupang-issuance-cleartag"))).toHaveLength(1);
    const tagging = page.scripts.filter((s) => s.includes("issuance-fixed-label-tag"));
    expect(tagging).toHaveLength(2);
    for (const t of tagging) expect(t).not.toContain("removeAttribute('data-aw-target')");
    // Exactly one of them claims the chip, and it is the FIRST — the plan's primary, not document order.
    expect(tagging.filter((t) => t.includes("data-aw-primary', '')"))).toHaveLength(1);
    expect(tagging[0]).toContain("data-aw-primary', '')");
  });

  it("a promoted step mounts ANCHORED, never docked", async () => {
    const page = new LocatePage();
    await (await driver(page)).highlightTarget("confirm_purpose");
    expect(page.mounts).toHaveLength(1);
    expect(page.mounts[0]!["dockedPanelOnly"]).toBeUndefined();
  });

  it("**one spec missing fails the WHOLE set** — a partial ring set is a screen we do not recognise", async () => {
    // Drawing the rings that happened to resolve would present a confident, incomplete picture of a page that
    // has just told us it is not the one the calibration was taken on. The failing count travels so the park
    // upstream says `target_not_found` about a real miss rather than a synthesised zero.
    const page = new LocatePage([1, 0]);
    const res = await (await driver(page)).locateTarget("confirm_purpose");
    expect(res.count).toBe(0);
    expect(res.sig).toBeUndefined();
  });

  it("**the terms step rings BOTH consents**, each resolved by id from its own promotion", async () => {
    // Two separate consents; agreeing to one is not agreeing to the other. One ring could only ever have
    // pointed at half of what the panel says.
    const page = new LocatePage();
    const res = await (await driver(page)).highlightTarget("terms_consent");
    expect(res.count).toBe(1);
    const tagging = page.scripts.filter((s) => s.includes("issuance-fixed-label-tag"));
    expect(tagging).toHaveLength(2);
    // Both sentences, verbatim — resolved from the recon candidates by id, never re-typed at the ring site.
    expect(tagging[0]).toContain("API 이용 약관에 동의합니다.");
    expect(tagging[1]).toContain("카테고리 자동 매칭 서비스 이용에 동의합니다.");
    // …and neither query names a checkbox INPUT: the boxes have no accessible association, so nothing here
    // claims to know where an individual box is. The rings sit on the sentences.
    for (const t of tagging) expect(t).not.toMatch(/querySelectorAll\("[^"]*input/);
  });

  it("an UNPROMOTED sibling neither suppresses nor drags along the promoted one", async () => {
    // Withdrawing one calibration must not take the other's ring down with it, and must not carry an
    // unpromoted control along. The promoted one leads, because a ring set with no primary would put the chip
    // wherever document order landed.
    promo.table = { ...ALL_PROMOTED, consent_api: { candidateId: null, promoted: false } };
    const page = new LocatePage();
    const res = await (await driver(page)).highlightTarget("terms_consent");
    expect(res.count).toBe(1);
    const tagging = page.scripts.filter((s) => s.includes("issuance-fixed-label-tag"));
    expect(tagging).toHaveLength(1);
    expect(tagging[0]).toContain("data-aw-primary', '')");
    expect(tagging[0]).toContain("카테고리 자동 매칭 서비스 이용에 동의합니다.");
  });

  it("**withdrawing a step's whole calibration falls back to TEXT-GUIDED, not to a parked run**", async () => {
    // The direction that has to stay safe. `confirm_purpose` and `terms_consent` are still in `TEXT_GUIDED_SIG`
    // even though promotion now wins the precedence, and this is why: if a reading is ever withdrawn the step
    // must present its docked panel again — the state it shipped in — rather than return `{count: 0}`, which
    // the engine reads as NONE and parks `target_not_found` permanently. That defect is exactly what the
    // 2026-08-10 redesign shipped, and withdrawal is the path back into it.
    promo.table = {
      confirm: { candidateId: null, promoted: false },
      purpose_open_api: { candidateId: null, promoted: false },
      consent_api: { candidateId: null, promoted: false },
      consent_category: { candidateId: null, promoted: false },
    };
    const page = new LocatePage();
    const d = await driver(page);
    for (const [target, sig] of [
      ["confirm_purpose", "b48e2f05b48e2f05"],
      ["terms_consent", "16d9c7ba16d9c7ba"],
    ] as const) {
      const located = await d.locateTarget(target);
      expect(located, target).toEqual({ count: 1, sig });
    }
    // …and the highlight mounts DOCKED, having cleared the prior step's tag first — no ring is drawn at a
    // control nothing is calibrated for.
    const hl = new LocatePage();
    const res = await (await driver(hl)).highlightTarget("terms_consent");
    expect(res).toEqual({ count: 1, sig: "16d9c7ba16d9c7ba" });
    expect(hl.scripts.filter((s) => s.includes("issuance-fixed-label-tag"))).toHaveLength(0);
    expect(hl.scripts.filter((s) => s.includes("coupang-issuance-cleartag"))).toHaveLength(1);
    expect(hl.mounts[0]!["dockedPanelOnly"]).toBe(true);
  });
});
