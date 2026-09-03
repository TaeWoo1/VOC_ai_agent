import { describe, expect, it } from "vitest";
import { GuidedFillReplyDriver } from "../../../src/action-window/reply-submission/guided-fill-reply-driver";
import type { ReplySubmitProbeDriver } from "../../../src/action-window/reply-submission/reply-driver";

/** An inner driver whose locate results are scripted; nothing here touches a page. */
function inner(rows: number, composers: number): ReplySubmitProbeDriver {
  return {
    prepareSurface: async () => ({ ok: true } as never),
    locateReviewRow: async () => ({ count: rows, sig: "row" }),
    highlightRow: async () => ({ count: rows, sig: "row" }),
    armRowObserve: async () => undefined,
    waitForRowOpen: async () => true,
    locateComposer: async () => ({ count: composers, sig: "composer" }),
    highlight: async () => undefined,
    armObserve: async () => undefined,
    waitForSubmit: async () => false,
    cleanup: async () => undefined,
  };
}

function page() {
  const filled: string[] = [];
  return {
    filled,
    locator: (selector: string) => ({
      count: async () => (selector === "[data-aw-reply-target]" ? 1 : 0),
      fill: async (value: string) => { filled.push(value); },
    }),
  };
}

describe("guided-fill reply driver — fill only on an exact, single target; never a submit", () => {
  it("fills the tagged composer when exactly one row and one composer matched", async () => {
    const p = page();
    const d = new GuidedFillReplyDriver({
      draftBody: "안녕하세요, 확인해 드리겠습니다.", open: async () => ({ inner: inner(1, 1), page: p }),
      reviewIdVerdict: () => ({ kind: "MATCHED", rowIndex: 0 }),
    });
    await d.prepareSurface(); await d.locateReviewRow(); await d.locateComposer();
    expect(await d.fillComposer()).toEqual({ filled: true });
    expect(p.filled).toEqual(["안녕하세요, 확인해 드리겠습니다."]);
  });

  it("refuses when the row match is ambiguous (two rows) — nothing is written", async () => {
    const p = page();
    const d = new GuidedFillReplyDriver({ draftBody: "x", open: async () => ({ inner: inner(2, 1), page: p }) });
    await d.prepareSurface(); await d.locateReviewRow(); await d.locateComposer();
    expect(await d.fillComposer()).toEqual({ filled: false, reason: "AMBIGUOUS" });
    expect(p.filled).toEqual([]);
  });

  it("refuses when two composers are open, and when there is no draft", async () => {
    const p = page();
    const two = new GuidedFillReplyDriver({ draftBody: "x", open: async () => ({ inner: inner(1, 2), page: p }) });
    await two.prepareSurface(); await two.locateReviewRow(); await two.locateComposer();
    expect(await two.fillComposer()).toEqual({ filled: false, reason: "AMBIGUOUS" });
    const none = new GuidedFillReplyDriver({ draftBody: null, open: async () => ({ inner: inner(1, 1), page: p }) });
    await none.prepareSurface(); await none.locateReviewRow(); await none.locateComposer();
    expect(await none.fillComposer()).toEqual({ filled: false, reason: "NOT_FILLABLE" });
    expect(p.filled).toEqual([]);
  });

  it("fills when the inner driver's own verdict names a row far down the list, not row 0", async () => {
    // The live failure (2026-09-03). The wrapper compared the inner driver's REAL matched row index against a
    // hardcoded 0, so a target nine screens down read as AMBIGUOUS: the run opened the correct review's
    // composer and then refused to type into it. The inner verdict is the same scan that produced the hint
    // match, in the same index space — it is not a second opinion to check against a placeholder.
    const p = page();
    const innerFar = { ...inner(1, 1), reviewIdVerdict: () => ({ kind: "MATCHED" as const, rowIndex: 28 }) };
    const d = new GuidedFillReplyDriver({ draftBody: "감사합니다", open: async () => ({ inner: innerFar, page: p }) });
    await d.prepareSurface(); await d.locateReviewRow(); await d.locateComposer();
    expect(await d.fillComposer()).toEqual({ filled: true });
    expect(p.filled).toEqual(["감사합니다"]);
  });

  it("refuses when the backend's review-id fingerprint contradicts the matched row", async () => {
    const p = page();
    const d = new GuidedFillReplyDriver({
      draftBody: "x", open: async () => ({ inner: inner(1, 1), page: p }), reviewIdVerdict: () => ({ kind: "MATCHED", rowIndex: 3 }),
    });
    await d.prepareSurface(); await d.locateReviewRow(); await d.locateComposer();
    expect(await d.fillComposer()).toEqual({ filled: false, reason: "AMBIGUOUS" });
    expect(p.filled).toEqual([]);
  });

  it("never fills on a hint-only match — no review-id verdict means nothing is typed (Acceptance Closure §3)", async () => {
    const p = page();
    const d = new GuidedFillReplyDriver({ draftBody: "x", open: async () => ({ inner: inner(1, 1), page: p }) });
    await d.prepareSurface(); await d.locateReviewRow(); await d.locateComposer();
    expect(await d.fillComposer()).toEqual({ filled: false, reason: "NOT_FILLABLE" });
    expect(p.filled).toEqual([]);
  });

  it("takes the review-id verdict from an inner driver that can answer it, and passes openComposer through", async () => {
    const p = page();
    let opens = 0;
    const aware = Object.assign(inner(1, 1), {
      reviewIdVerdict: () => ({ kind: "MATCHED", rowIndex: 0 } as const),
      openComposer: async () => { opens += 1; return { opened: true } as const; },
    });
    const d = new GuidedFillReplyDriver({ draftBody: "x", open: async () => ({ inner: aware, page: p }) });
    await d.prepareSurface(); await d.locateReviewRow();
    expect(await d.openComposer()).toEqual({ opened: true });
    expect(opens).toBe(1);
    await d.locateComposer();
    expect(await d.fillComposer()).toEqual({ filled: true });
    const cannot = new GuidedFillReplyDriver({ draftBody: "x", open: async () => ({ inner: inner(1, 1), page: page() }) });
    await cannot.prepareSurface();
    expect(await cannot.openComposer()).toEqual({ opened: false, reason: "NOT_SUPPORTED" });
  });

  it("「창 앞으로」 raises only a surface the run ALREADY opened — it can never make one appear", async () => {
    let raises = 0;
    let opens = 0;
    const d = new GuidedFillReplyDriver({
      draftBody: "x",
      open: async () => { opens += 1; return { inner: inner(1, 1), page: page() }; },
      raiseSurface: async () => { raises += 1; return true; },
    });
    // Nothing is open yet: refuse, and do NOT open one to have something to raise.
    expect(await d.focusSurface()).toBe(false);
    expect(opens).toBe(0);
    expect(raises).toBe(0);

    await d.prepareSurface();
    expect(await d.focusSurface()).toBe(true);
    expect(raises).toBe(1);
    // The run is where it was: raising a window is not a step.
    expect(opens).toBe(1);
  });

  it("a carrier that supplies no raise says so rather than pretending", async () => {
    const d = new GuidedFillReplyDriver({ draftBody: "x", open: async () => ({ inner: inner(1, 1), page: page() }) });
    await d.prepareSurface();
    expect(await d.focusSurface()).toBe(false);
  });

  it("opens the surface lazily — an idle carrier holds no browser", async () => {
    let opened = 0;
    const d = new GuidedFillReplyDriver({ draftBody: "x", open: async () => { opened += 1; return { inner: inner(1, 1), page: page() }; } });
    expect(d.isOpen()).toBe(false);
    expect(await d.fillComposer()).toEqual({ filled: false, reason: "NOT_FILLABLE" });
    expect(opened).toBe(0);
  });
});
