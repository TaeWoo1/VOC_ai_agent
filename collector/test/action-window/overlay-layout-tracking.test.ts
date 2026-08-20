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

import { Doc, El, fakePage, rect, tagged, avoided, sizePanel, BASE, PANEL } from "./overlay-dom-double";


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

/**
 * Viewport 1200×800, panel 400×100 ⇒ the six candidate placements are
 * x ∈ {400 (centre), 776 (right), 24 (left)} × y ∈ {676 (bottom), 24 (top)}, in that preference order.
 */
describe("the guidance panel never covers the control it is pointing at", () => {
  it("**it moves to the top when the control sits under the bottom dock**", async () => {
    // Live-observed twice: the panel telling the seller to press 확인, sitting on 확인. It takes clicks when it
    // carries a button, so this is manual progress being blocked, not a cosmetic overlap.
    const doc = new Doc();
    tagged(doc, rect(380, 700, 100, 40));
    const { page, env } = fakePage(doc, 800);
    await mountOverlay(page as never, PANEL);
    const panel = sizePanel(doc, rect(400, 676, 400, 100));
    env.mutate();
    expect(panel.style["top"]).toBe("24px");
    expect(panel.style["left"]).toBe("400px");
    // The mount's bottom-centred CSS has to be cleared, or the two placements compose.
    expect(panel.style["bottom"]).toBe("auto");
    expect(panel.style["transform"]).toBe("none");
  });

  it("it stays at the bottom when nothing is under it", async () => {
    const doc = new Doc();
    tagged(doc, rect(380, 300, 100, 40));
    const { page, env } = fakePage(doc, 800);
    await mountOverlay(page as never, PANEL);
    const panel = sizePanel(doc, rect(400, 676, 400, 100));
    env.mutate();
    expect(panel.style["top"]).toBe("676px");
    expect(panel.style["left"]).toBe("400px");
  });

  it("a control BESIDE the panel is not treated as under it", async () => {
    // Horizontal extent comes from the panel's own rect. A narrow panel and a control in the opposite margin
    // overlap on the vertical band and nowhere else; moving for that would move the panel for no reason.
    const doc = new Doc();
    tagged(doc, rect(1000, 700, 100, 40));
    const { page, env } = fakePage(doc, 800);
    await mountOverlay(page as never, PANEL);
    const panel = sizePanel(doc, rect(400, 676, 400, 100));
    env.mutate();
    expect(panel.style["top"]).toBe("676px");
    expect(panel.style["left"]).toBe("400px");
  });

  it("**both centre docks covered ⇒ it takes a corner** — it never settles onto a control", async () => {
    // The previous version chose between bottom-centre and top-centre and, when both were covered, KEPT the
    // bottom one: it deliberately parked on the control it was describing. A viewport has corners.
    const doc = new Doc();
    tagged(doc, rect(380, 700, 100, 40));
    tagged(doc, rect(380, 30, 100, 40));
    const { page, env } = fakePage(doc, 800);
    await mountOverlay(page as never, PANEL);
    const panel = sizePanel(doc, rect(400, 676, 400, 100));
    env.mutate();
    expect(panel.style["left"]).toBe("776px");
    expect(panel.style["top"]).toBe("676px");
  });

  it("when NOTHING is clear it takes the least-covering placement, and does not oscillate", async () => {
    // A control across the whole width at both ends: every candidate overlaps something. The choice is then the
    // smallest overlap, and — because the decision reads only the targets and the panel's own size, never where
    // the panel currently is — repeating it writes nothing.
    const doc = new Doc();
    tagged(doc, rect(0, 690, 1200, 110)); // covers the whole bottom band
    tagged(doc, rect(0, 24, 1200, 40)); // covers less of the top band
    const { page, env } = fakePage(doc, 800);
    await mountOverlay(page as never, PANEL);
    const panel = sizePanel(doc, rect(400, 676, 400, 100));
    env.mutate();
    expect(panel.style["top"]).toBe("24px");
    const writes = panel.styleWrites;
    env.mutate();
    env.mutate();
    expect(panel.style["top"]).toBe("24px");
    expect(panel.styleWrites).toBe(writes);
  });

  it("the decision is re-made when the layout moves the control INTO the panel", async () => {
    const doc = new Doc();
    const target = tagged(doc, rect(380, 300, 100, 40));
    const { page, env } = fakePage(doc, 800);
    await mountOverlay(page as never, PANEL);
    const panel = sizePanel(doc, rect(400, 676, 400, 100));
    env.mutate();
    expect(panel.style["top"]).toBe("676px");
    target.rect = rect(380, 700, 100, 40);
    env.mutate();
    expect(panel.style["top"]).toBe("24px");
  });

  it("**a control BELOW THE FOLD still reserves the bottom band** — it is where that control arrives", async () => {
    // The defect this closes: an off-viewport target overlaps nothing, so the panel used to park exactly where
    // that control lands the moment the seller scrolls to it. Projected onto the edge it will arrive from, the
    // band stays reserved from the start.
    const doc = new Doc();
    tagged(doc, rect(380, 2400, 100, 40)); // far below a 800px viewport
    const { page, env } = fakePage(doc, 800);
    await mountOverlay(page as never, PANEL);
    const panel = sizePanel(doc, rect(400, 676, 400, 100));
    env.mutate();
    expect(panel.style["top"]).toBe("24px");
  });

  it("a control scrolled off ABOVE reserves the top band, not the bottom", async () => {
    const doc = new Doc();
    tagged(doc, rect(380, -300, 100, 40));
    const { page, env } = fakePage(doc, 800);
    await mountOverlay(page as never, PANEL);
    const panel = sizePanel(doc, rect(400, 676, 400, 100));
    env.mutate();
    expect(panel.style["top"]).toBe("676px");
  });

  it("**it also steps off the control the seller must use NEXT** — the one nothing rings yet", async () => {
    // The 2026-08-12 report, in one case: step ⑥ ringed the input-method option and the panel sat on WING's own
    // `확인` below it. Nothing here could see that — `확인` carried no tag until the NEXT step. A step may now
    // declare controls to keep clear of, and they enter the same geometry.
    const doc = new Doc();
    tagged(doc, rect(1000, 400, 100, 40)); // the ring, clear of every candidate placement
    avoided(doc, rect(380, 700, 100, 40)); // the 확인 the seller reaches next
    const { page, env } = fakePage(doc, 800);
    await mountOverlay(page as never, PANEL);
    const panel = sizePanel(doc, rect(400, 676, 400, 100));
    env.mutate();
    expect(panel.style["top"]).toBe("24px");
    expect(panel.style["left"]).toBe("400px");
  });

  it("**the RING outranks a keep-clear box** — the panel never hides the control it is about", async () => {
    // Ranking the two sets together with a weight would let enough avoided area outvote the ring, which is a
    // step that hides the thing it points at. Here the ring overlap is small (4 000px²) and every alternative
    // carries a large avoided overlap (≥40 000px²), so a summed score would keep the panel on the ring. It
    // moves off it instead: least ring first, least next-control only as the tie-break.
    const doc = new Doc();
    tagged(doc, rect(380, 700, 100, 40)); // under the bottom dock
    avoided(doc, rect(0, 0, 1200, 200)); // the whole top band
    avoided(doc, rect(700, 600, 500, 200)); // and the bottom-right corner
    const { page, env } = fakePage(doc, 800);
    await mountOverlay(page as never, PANEL);
    const panel = sizePanel(doc, rect(400, 676, 400, 100));
    env.mutate();
    expect(panel.style["top"]).toBe("24px");
  });

  it("a keep-clear box below the fold reserves its band too — same projection as a ring", async () => {
    const doc = new Doc();
    tagged(doc, rect(1000, 400, 100, 40));
    avoided(doc, rect(380, 2400, 100, 40));
    const { page, env } = fakePage(doc, 800);
    await mountOverlay(page as never, PANEL);
    const panel = sizePanel(doc, rect(400, 676, 400, 100));
    env.mutate();
    expect(panel.style["top"]).toBe("24px");
  });

  it("a step that declares none behaves exactly as it did before", async () => {
    const doc = new Doc();
    tagged(doc, rect(380, 300, 100, 40));
    const { page, env } = fakePage(doc, 800);
    await mountOverlay(page as never, PANEL);
    const panel = sizePanel(doc, rect(400, 676, 400, 100));
    env.mutate();
    expect(panel.style["top"]).toBe("676px");
    expect(panel.style["left"]).toBe("400px");
  });

  it("an oversized panel is clamped into the viewport rather than pushed off the top", async () => {
    const doc = new Doc();
    tagged(doc, rect(380, 400, 100, 40));
    const { page, env } = fakePage(doc, 800);
    await mountOverlay(page as never, PANEL);
    const panel = sizePanel(doc, rect(0, 0, 1400, 900)); // taller AND wider than the viewport
    env.mutate();
    expect(panel.style["top"]).toBe("24px");
    expect(panel.style["left"]).toBe("24px");
  });
});

/* ─────────────────── 3. the panel shows a BRIEF, with the complete copy one press away ─────────────────── */

/**
 * The panel had grown to five sentences across four lines, docked on top of a marketplace dialog, at the moment
 * the seller's attention belongs on the dialog. It now leads with one line and keeps the rest behind a `자세히`
 * disclosure — except where the copy carries a safety claim, which opens by itself.
 */
describe("the guidance panel's disclosure", () => {
  const DETAIL = "SellerOps는 이 버튼을 절대 누르지 않고, 입력란에 아무것도 쓰지 않습니다.";
  const WITH_DETAIL = { ...PANEL, detail: DETAIL };

  const detailOf = (doc: Doc): El | null => doc.getElementById("__aw_panel_detail__");
  const toggleOf = (doc: Doc): El | null => doc.getElementById("__aw_panel_detail_toggle__");

  it("starts CLOSED, and the complete copy is present in the DOM rather than dropped", async () => {
    const doc = new Doc();
    tagged(doc, rect(380, 300, 100, 40));
    const { page } = fakePage(doc, 800);
    await mountOverlay(page as never, WITH_DETAIL);
    expect(detailOf(doc)?.textContent).toBe(DETAIL);
    expect(detailOf(doc)?.style["display"]).toBe("none");
    expect(toggleOf(doc)?.textContent).toBe("자세히");
  });

  it("**opens by itself when the step carries a safety claim** — a warning is never behind a press", async () => {
    const doc = new Doc();
    tagged(doc, rect(380, 300, 100, 40));
    const { page } = fakePage(doc, 800);
    await mountOverlay(page as never, { ...WITH_DETAIL, detailExpanded: true });
    expect(detailOf(doc)?.style["display"]).toBe("block");
    expect(toggleOf(doc)?.textContent).toBe("간단히");
  });

  it("the seller's press opens it AND re-places the panel in the same gesture", async () => {
    // A panel that grows downward onto the control it describes is the defect the placement logic exists to
    // prevent; waiting for the next observer tick to notice would show the seller exactly that, briefly.
    const doc = new Doc();
    tagged(doc, rect(380, 700, 100, 40));
    const { page, env } = fakePage(doc, 800);
    await mountOverlay(page as never, WITH_DETAIL);
    sizePanel(doc, rect(400, 676, 400, 100));
    const toggle = toggleOf(doc)!;
    const press = toggle.listeners.find((l) => l.type === "click")!.fn;
    env.run(press);
    expect(detailOf(doc)?.style["display"]).toBe("block");
    expect(toggle.textContent).toBe("간단히");
    // …and the placement ran: the control under the bottom dock pushed the panel to the top.
    expect(doc.getElementById("__aw_advance_panel__")!.style["top"]).toBe("24px");
  });

  it("a COPY-ONLY panel gets no disclosure — it stays pointer-events:none with nothing to press", async () => {
    // The reach step's panel has no advance button, so it takes no pointer events precisely so it can never
    // block a control. A disclosure button would be the one clickable thing on it.
    const doc = new Doc();
    tagged(doc, rect(380, 300, 100, 40));
    const { page } = fakePage(doc, 800);
    const { advance: _dropped, ...copyOnly } = WITH_DETAIL;
    await mountOverlay(page as never, copyOnly);
    expect(detailOf(doc)).toBeNull();
    expect(toggleOf(doc)).toBeNull();
  });

  it("a panel with no detail at all is exactly what it always was", async () => {
    const doc = new Doc();
    tagged(doc, rect(380, 300, 100, 40));
    const { page } = fakePage(doc, 800);
    await mountOverlay(page as never, PANEL);
    expect(detailOf(doc)).toBeNull();
    expect(toggleOf(doc)).toBeNull();
  });
});

/* ───────────── 4. an advance takes the OLD ring down and re-anchors on the next control ───────────── */

/**
 * Live-observed 2026-08-12: the walk sat at step ⑥ with the ring still on `자체개발(직접입력)`. The operator
 * asked the right question — if the ring is not going to move to the input fields, the old one should at least
 * be gone. It should, and this is what "gone" has to mean: the previous step's ring is REMOVED, not left
 * beside the new one, and the new ring is on the next control by the time the panel says so.
 */
describe("a step advance re-anchors the ring", () => {
  const STEP7 = {
    ...BASE,
    stepNumber: 7,
    residentPanel: true,
    label: "⚠ 이 화면의 '확인'에서 실제 API 키가 발급됩니다",
    advance: { buttonLabel: "확인을 눌렀어요 · 다음", token: "tok7" },
  };

  it("**the old ring is removed and the new one sits on the next control**", async () => {
    const doc = new Doc();
    const option = tagged(doc, rect(380, 300, 160, 30)); // 자체개발(직접입력)
    const { page, env } = fakePage(doc, 800);
    await mountOverlay(page as never, PANEL);
    env.mutate();
    expect(doc.getElementById("__aw_overlay__")!.style["top"]).toBe("294px");

    // The advance: the ring-plan script clears every prior `data-aw-target` before tagging the new control, so
    // the next mount finds exactly one anchor. This models that, then mounts step ⑦.
    option.removeAttribute("data-aw-target");
    const confirm = tagged(doc, rect(1200, 690, 130, 44)); // the vendor screen's 확인
    await mountOverlay(page as never, STEP7);
    env.mutate();

    // ONE ring, on 확인 — not two, and not the option's coordinates with step ⑦'s text beside them.
    const rings = doc.querySelectorAll("#__aw_overlay__,[data-aw-ring-secondary]");
    expect(rings).toHaveLength(1);
    expect(rings[0]!.style["top"]).toBe("684px");
    expect(rings[0]!.style["left"]).toBe("1194px");
    expect(confirm.hasAttribute("data-aw-target")).toBe(true);
    expect(option.hasAttribute("data-aw-target")).toBe(false);
  });

  it("the panel that arrives with it is the NEW step's, and its latch is re-armed", async () => {
    const doc = new Doc();
    const option = tagged(doc, rect(380, 300, 160, 30));
    const { page, env } = fakePage(doc, 800);
    await mountOverlay(page as never, PANEL);
    env.run(() => {
      (globalThis as unknown as { window: Record<string, unknown> }).window["__aw_advance_pressed__"] = "tok";
    });
    option.removeAttribute("data-aw-target");
    tagged(doc, rect(1200, 690, 130, 44));
    await mountOverlay(page as never, STEP7);
    // A press recorded against step ⑥ must not satisfy step ⑦: the mount re-arms the token and drops the latch.
    expect(env.win["__aw_advance_token__"]).toBe("tok7");
    expect(env.win["__aw_advance_pressed__"]).toBeUndefined();
    const panels = doc.querySelectorAll("#__aw_advance_panel__");
    expect(panels).toHaveLength(1);
    expect(panels[0]!.children[0]!.children[0]!.textContent).toContain("실제 API 키가 발급됩니다");
  });
});
