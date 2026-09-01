/**
 * **The guided panel SHELL — one presentation for every guided connect walk.**
 *
 * Coupang WING and NAVER's API centre are two different marketplace journeys, and they stayed two different
 * panels for as long as only one of them had a panel at all: the WING walk grew a resident panel with an
 * advance button, and the NAVER walk kept a chip over a ring and put its "다음" in the SellerOps tab. A seller
 * connecting both channels met two products.
 *
 * What this pins is the SHELL, not the journeys:
 *
 *  1. **the header** — whose guidance this is (channel) and where in it the seller is (n/total), on EVERY panel
 *     the shell draws, including a docked one where the chip that used to carry the counter is hidden;
 *  2. **one primary** — the advance button, unchanged;
 *  3. **one quiet alternative** — the secondary link, with its OWN latch, so a press on the way out can never
 *     be read as a press on the way forward;
 *  4. **backwards compatibility** — a caller that passes no `channelName` and no `secondary` renders exactly
 *     the panel it rendered before.
 *
 * Behavioural, against the shared DOM double: the real `mountOverlay` page function runs, and the assertions
 * read the elements it actually created.
 */
import { describe, expect, it } from "vitest";
import {
  mountOverlay,
  unmountOverlay,
  readOverlayAdvancePressed,
  readOverlaySecondaryPressed,
  resetOverlaySecondary,
} from "../../src/action-window/overlay";
import { Doc, fakePage, rect, tagged, BASE, PANEL } from "./overlay-dom-double";

/** Every node under the panel — the primary lives in the instruction ROW, the secondary directly under it. */
function within(root: { children: { hasAttribute(n: string): boolean }[] }): { hasAttribute(n: string): boolean }[] {
  const kids = root.children;
  return kids.flatMap((k) => [k, ...within(k as never)]);
}

/**
 * Press one of the panel's buttons through the listener the mount registered.
 *
 * `trusted` is the whole point of the parameter: a person's press carries the user agent's own `isTrusted`, a
 * script's does not, and the panel honours only the first.
 */
function press(doc: Doc, attr: string, env: { run: (fn: () => void) => void }, trusted = true): void {
  const panel = doc.getElementById("__aw_advance_panel__")!;
  const btn =
    (within(panel) as never as { hasAttribute(n: string): boolean; listeners: { type: string; fn: (ev: { isTrusted: boolean }) => void }[] }[])
      .find((c) => c.hasAttribute(attr)) ?? null;
  if (!btn) throw new Error(`no ${attr} button on the panel`);
  env.run(() => btn.listeners.filter((l) => l.type === "click").forEach((l) => l.fn({ isTrusted: trusted })));
}

describe("the panel header — channel and step, on every panel", () => {
  it("carries `reviewnary · <channel>` and `n/total`", async () => {
    const doc = new Doc();
    tagged(doc, rect(100, 300, 120, 40));
    const { page } = fakePage(doc);

    await mountOverlay(page as never, { ...PANEL, channelName: "쿠팡 윙" });

    const panel = doc.getElementById("__aw_advance_panel__")!;
    const header = panel.children.find((c) => c.hasAttribute("data-aw-panel-header"))!;
    expect(header.children.map((c) => c.textContent)).toEqual(["reviewnary · 쿠팡 윙", "7/9"]);
  });

  it("**a DOCKED panel still says which step it is** — the chip that used to carry it is hidden there", async () => {
    // The whole reason the counter moved into the panel. A docked step (a text-guided control, a park notice,
    // an outcome) sets `dockedPanelOnly`, which hides the badge — so before this the seller's panel at exactly
    // the moments they are most likely to be lost showed no position in the walk at all.
    const doc = new Doc();
    const { page } = fakePage(doc);

    await mountOverlay(page as never, {
      ...PANEL,
      dockedPanelOnly: true,
      stepNumber: 8,
      totalSteps: 8,
      channelName: "쿠팡 윙",
    });

    const panel = doc.getElementById("__aw_advance_panel__")!;
    const badge = doc.getElementById("__aw_overlay__")!.children.find((c) => c.hasAttribute("data-aw-badge"))!;
    expect(badge.style["display"]).toBe("none");
    expect(panel.children.find((c) => c.hasAttribute("data-aw-panel-header"))!.children[1]!.textContent).toBe("8/8");
  });

  it("renders NO header when the caller names no channel — an unadopted caller is untouched", async () => {
    const doc = new Doc();
    tagged(doc, rect(0, 0, 10, 10));
    const { page } = fakePage(doc);

    await mountOverlay(page as never, PANEL);

    const panel = doc.getElementById("__aw_advance_panel__")!;
    expect(panel.children.some((c) => c.hasAttribute("data-aw-panel-header"))).toBe(false);
  });
});

describe("the secondary — one quiet way out, in its own latch namespace", () => {
  it("a press on the SECONDARY does not satisfy the advance poll, and vice versa", async () => {
    // THE property. Both affordances sit on one panel; if either could satisfy the other's poll, a seller
    // asking for the typing form would advance the walk instead — or worse, the reverse.
    const doc = new Doc();
    tagged(doc, rect(0, 0, 10, 10));
    const { page, env } = fakePage(doc);
    await mountOverlay(page as never, {
      ...PANEL,
      channelName: "쿠팡 윙",
      secondary: { buttonLabel: "직접 입력할게요", token: "alt-tok" },
    });

    press(doc, "data-aw-secondary", env);

    expect(await readOverlaySecondaryPressed(page as never, "alt-tok")).toBe(true);
    expect(await readOverlayAdvancePressed(page as never, "tok")).toBe(false);
  });

  it("the advance press leaves the secondary latch untouched", async () => {
    const doc = new Doc();
    tagged(doc, rect(0, 0, 10, 10));
    const { page, env } = fakePage(doc);
    await mountOverlay(page as never, {
      ...PANEL,
      secondary: { buttonLabel: "직접 입력할게요", token: "alt-tok" },
    });

    press(doc, "data-aw-advance", env);

    expect(await readOverlayAdvancePressed(page as never, "tok")).toBe(true);
    expect(await readOverlaySecondaryPressed(page as never, "alt-tok")).toBe(false);
  });

  it("a re-mount RE-ARMS the secondary: a press left over from the previous step reads back false", async () => {
    const doc = new Doc();
    tagged(doc, rect(0, 0, 10, 10));
    const { page, env } = fakePage(doc);
    await mountOverlay(page as never, { ...PANEL, secondary: { buttonLabel: "직접 입력할게요", token: "step-8" } });
    press(doc, "data-aw-secondary", env);
    expect(await readOverlaySecondaryPressed(page as never, "step-8")).toBe(true);

    await mountOverlay(page as never, { ...PANEL, secondary: { buttonLabel: "직접 입력할게요", token: "outcome" } });

    expect(await readOverlaySecondaryPressed(page as never, "step-8")).toBe(false);
    expect(await readOverlaySecondaryPressed(page as never, "outcome")).toBe(false);
  });

  it("`resetOverlaySecondary` re-arms without a re-mount, and `unmountOverlay` clears it", async () => {
    const doc = new Doc();
    tagged(doc, rect(0, 0, 10, 10));
    const { page, env } = fakePage(doc);
    await mountOverlay(page as never, { ...PANEL, secondary: { buttonLabel: "직접 입력할게요", token: "a" } });
    press(doc, "data-aw-secondary", env);

    await resetOverlaySecondary(page as never, "b");
    expect(await readOverlaySecondaryPressed(page as never, "a")).toBe(false);
    press(doc, "data-aw-secondary", env);
    expect(await readOverlaySecondaryPressed(page as never, "b")).toBe(true);

    await unmountOverlay(page as never);
    expect(await readOverlaySecondaryPressed(page as never, "b")).toBe(false);
  });

  it("**a panel with ONLY a secondary still takes clicks** — otherwise its one control is unpressable", async () => {
    // `pointer-events` is set from "does this panel have a button", and the secondary is one. A copy-only panel
    // must stay inert (it can sit on a marketplace control); a panel offering a way out must not.
    const doc = new Doc();
    const { page } = fakePage(doc);

    await mountOverlay(page as never, {
      ...BASE,
      dockedPanelOnly: true,
      residentPanel: true,
      label: "저장하지 못했어요.",
      secondary: { buttonLabel: "직접 입력할게요", token: "alt" },
    });

    expect(doc.getElementById("__aw_advance_panel__")!.style["pointer-events"]).toBe("auto");
  });

  it("a copy-only panel is still inert — no advance, no secondary, no pointer events", async () => {
    const doc = new Doc();
    const { page } = fakePage(doc);

    await mountOverlay(page as never, { ...BASE, dockedPanelOnly: true, residentPanel: true, label: "확인 중이에요." });

    const panel = doc.getElementById("__aw_advance_panel__")!;
    expect(panel.style["pointer-events"]).toBe("none");
    expect(panel.children.some((c) => c.hasAttribute("data-aw-secondary"))).toBe(false);
  });
});

describe("a press is a PERSON pressing — the floor under the consent", () => {
  it("**a synthetic click records nothing** — `el.click()` and a dispatched event both read untrusted", async () => {
    // On the credential step this press IS the consent to read three values off the screen and store them, so
    // the naive scripted press is the one the panel must not honour.
    const doc = new Doc();
    tagged(doc, rect(0, 0, 10, 10));
    const { page, env } = fakePage(doc);
    await mountOverlay(page as never, {
      ...PANEL,
      secondary: { buttonLabel: "직접 입력할게요", token: "alt-tok" },
    });

    press(doc, "data-aw-advance", env, false);
    press(doc, "data-aw-secondary", env, false);

    expect(await readOverlayAdvancePressed(page as never, "tok")).toBe(false);
    expect(await readOverlaySecondaryPressed(page as never, "alt-tok")).toBe(false);
  });

  it("…and the seller's own press still goes through", async () => {
    const doc = new Doc();
    tagged(doc, rect(0, 0, 10, 10));
    const { page, env } = fakePage(doc);
    await mountOverlay(page as never, PANEL);

    press(doc, "data-aw-advance", env);

    expect(await readOverlayAdvancePressed(page as never, "tok")).toBe(true);
  });
});
