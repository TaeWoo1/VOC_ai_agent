/**
 * The composer-abort ENTRY-TRANSITION observer — the read-only seam that lets the runtime detect the operator's
 * OWN entry into the composer without ever clicking or navigating. Covers all three observed NAVER paths (the
 * body-link → new tab, the body-link → same-tab navigation, and the checkbox+toolbar → inline composer) plus
 * the fail-closed timeout and the about:blank guard. Deterministic: a fake context/pages, a 1ms poll interval.
 */
import { describe, it, expect } from "vitest";
import type { BrowserContext } from "playwright";
import { waitForEntryTransition } from "../../src/cli/run-composer-abort-rehearsal-live-naver";

const LIST = "https://sell.example/reviews";
const DETAIL = "https://sell.example/reviews/detail/123";

/** A fake page exposing only what the observer reads: url() and evaluate() (the composer census). */
function fakePage(url: string | (() => string), census: number | number[]): unknown {
  let call = 0;
  return {
    url: () => (typeof url === "function" ? url() : url),
    evaluate: (_s: string) =>
      Promise.resolve(Array.isArray(census) ? census[Math.min(call++, census.length - 1)] : census),
  };
}
/** A fake context whose pages() returns a fixed (or per-call) list. */
function fakeCtx(pagesFor: () => unknown[]): BrowserContext {
  return { pages: () => pagesFor() } as unknown as BrowserContext;
}

describe("waitForEntryTransition — observes the operator's own entry, never drives it", () => {
  it("NAV_NEW_TAB: a new page appears over the baseline (body-link opened in a new tab)", async () => {
    const ctx = fakeCtx(() => [fakePage(LIST, 0), fakePage(DETAIL, 1)]); // 2 pages > baseline 1
    expect(await waitForEntryTransition(ctx, LIST, 1, 0, 5, 1)).toBe("NAV_NEW_TAB");
  });

  it("NAV_SAME_TAB: the active tab navigated away from the list URL (body-link same-tab nav)", async () => {
    const ctx = fakeCtx(() => [fakePage(DETAIL, 0)]); // same page count, URL changed
    expect(await waitForEntryTransition(ctx, LIST, 1, 0, 5, 1)).toBe("NAV_SAME_TAB");
  });

  it("INLINE_COMPOSER: a generic composer candidate appears over the baseline (checkbox+toolbar)", async () => {
    const ctx = fakeCtx(() => [fakePage(LIST, 2)]); // still on the list, census rose 0 -> 2
    expect(await waitForEntryTransition(ctx, LIST, 1, 0, 5, 1)).toBe("INLINE_COMPOSER");
  });

  it("detects INLINE_COMPOSER on a later poll (census rises only after the first tick)", async () => {
    const page = fakePage(LIST, [0, 0, 1]); // ONE persistent page whose census rises to 1 on the 3rd read
    const ctx = fakeCtx(() => [page]);
    expect(await waitForEntryTransition(ctx, LIST, 1, 0, 50, 1)).toBe("INLINE_COMPOSER");
  });

  it("fails closed (null) when no transition happens within the window", async () => {
    const ctx = fakeCtx(() => [fakePage(LIST, 0)]); // never navigates, census never rises
    expect(await waitForEntryTransition(ctx, LIST, 1, 0, 3, 1)).toBeNull();
  });

  it("does NOT treat about:blank as a same-tab navigation", async () => {
    const ctx = fakeCtx(() => [fakePage("about:blank", 0)]);
    expect(await waitForEntryTransition(ctx, LIST, 1, 0, 3, 1)).toBeNull();
  });

  it("tolerates url() throwing mid-navigation and still resolves the inline transition via census", async () => {
    const throwingUrl = () => {
      throw new Error("navigating");
    };
    const ctx = fakeCtx(() => [fakePage(throwingUrl, 3)]);
    expect(await waitForEntryTransition(ctx, LIST, 1, 0, 5, 1)).toBe("INLINE_COMPOSER");
  });
});
