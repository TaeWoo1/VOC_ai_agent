/**
 * The same-session COMPOSER abort driver over TWO retained element handles. Proves: it reuses the row driver
 * for the row half; its row-open barrier runs the injected `acquireComposer` and lifts only on a connected
 * composer handle (fails closed on null / detached); while the composer is connected it locates a single
 * composer with a stable sig and outlines it read-only; once it detaches it reports zero. No persisted
 * mapping, no page signature — only in-memory handles.
 */
import { describe, it, expect } from "vitest";
import {
  HandleReplyComposerDriver,
} from "../../../src/action-window/reply-submission/handle-reply-composer-driver";
import type { AbortRowHandle } from "../../../src/action-window/reply-submission/handle-reply-row-driver";
import { composerSigFor } from "../../../src/action-window/reply-submission/reply-surface";

const ROW_SIG = composerSigFor(["row", "same-session-calibrated"]);
const COMPOSER_SIG = composerSigFor(["composer", "same-session-calibrated"]);

/** Fake element handle: runs the in-element callback against a small fake element; tracks annotation. */
function fakeHandle(connected: boolean, spy?: { highlighted?: boolean; cleaned?: boolean }): AbortRowHandle {
  const el = {
    isConnected: connected,
    tagName: "DIV",
    style: {} as Record<string, string>,
    getAttribute: (k: string) => (k === "contenteditable" ? "true" : null),
    setAttribute: () => {
      if (spy) spy.highlighted = true;
    },
    removeAttribute: () => {
      if (spy) spy.cleaned = true;
    },
    parentElement: null,
    scrollIntoView: () => undefined,
  };
  return { evaluate: <R>(fn: (e: unknown) => R): Promise<R> => Promise.resolve(fn(el)) };
}

const never = () => new Promise<boolean>(() => {}); // waitSubmit that never resolves (operator aborts instead)

describe("HandleReplyComposerDriver — row half delegates to the shipped row driver", () => {
  it("locates + highlights the retained ROW (count 1, stable row sig) while the row is connected", async () => {
    const d = new HandleReplyComposerDriver(fakeHandle(true), () => Promise.resolve(null), never);
    expect(await d.prepareSurface()).toBe(true);
    expect(await d.locateReviewRow()).toEqual({ count: 1, sig: ROW_SIG });
    expect(await d.highlightRow()).toEqual({ count: 1, sig: ROW_SIG });
  });

  it("fails the surface closed once the retained row detaches", async () => {
    const d = new HandleReplyComposerDriver(fakeHandle(false), () => Promise.resolve(null), never);
    expect(await d.prepareSurface()).toEqual({ ok: false, code: "UNSUPPORTED_STATE" });
    expect(await d.locateReviewRow()).toEqual({ count: 0 });
  });
});

describe("HandleReplyComposerDriver — composer half over the second retained element", () => {
  it("waitForRowOpen lifts (true) when acquireComposer yields a connected composer, then locates it (sig)", async () => {
    const composer = fakeHandle(true);
    const d = new HandleReplyComposerDriver(fakeHandle(true), () => Promise.resolve(composer), never);
    // Before acquisition, no composer is known → fail closed.
    expect(await d.locateComposer()).toEqual({ count: 0 });
    expect(await d.waitForRowOpen()).toBe(true);
    expect(await d.locateComposer()).toEqual({ count: 1, sig: COMPOSER_SIG });
  });

  it("waitForRowOpen stays closed (false) when acquireComposer yields null (no entry / no pick)", async () => {
    const d = new HandleReplyComposerDriver(fakeHandle(true), () => Promise.resolve(null), never);
    expect(await d.waitForRowOpen()).toBe(false);
    expect(await d.locateComposer()).toEqual({ count: 0 });
  });

  it("waitForRowOpen stays closed (false) when the acquired composer is already detached", async () => {
    const detached = fakeHandle(false);
    const d = new HandleReplyComposerDriver(fakeHandle(true), () => Promise.resolve(detached), never);
    expect(await d.waitForRowOpen()).toBe(false);
    expect(await d.locateComposer()).toEqual({ count: 0 });
  });

  it("highlight outlines the retained composer read-only (marker set); cleanup clears it", async () => {
    const spy: { highlighted?: boolean; cleaned?: boolean } = {};
    const composer = fakeHandle(true, spy);
    const d = new HandleReplyComposerDriver(fakeHandle(true), () => Promise.resolve(composer), never);
    await d.waitForRowOpen();
    await d.highlight();
    expect(spy.highlighted).toBe(true);
    await d.cleanup();
    expect(spy.cleaned).toBe(true);
  });

  it("resolves the composer from the operator's clicked child (contenteditable ancestor, not the child)", async () => {
    interface N {
      tagName: string;
      isConnected: boolean;
      style: Record<string, string>;
      parentElement: N | null;
      hl: boolean;
      attrs: Record<string, string>;
      getAttribute: (k: string) => string | null;
      setAttribute: (k: string, v: string) => void;
      removeAttribute: (k: string) => void;
      scrollIntoView: () => void;
    }
    const mk = (tag: string, attrs: Record<string, string>, parent: N | null): N => {
      const n: N = {
        tagName: tag,
        isConnected: true,
        style: {},
        parentElement: parent,
        hl: false,
        attrs,
        getAttribute: (k) => (k in n.attrs ? (n.attrs[k] ?? null) : null),
        setAttribute: (k) => {
          if (k === "data-aw-composer-highlight") n.hl = true;
        },
        removeAttribute: () => {
          n.hl = false;
        },
        scrollIntoView: () => undefined,
      };
      return n;
    };
    const composer = mk("DIV", { contenteditable: "true" }, null); // the real composer
    const child = mk("SPAN", {}, composer); // the operator's exact clicked fragment inside it
    const handle: AbortRowHandle = { evaluate: <R>(fn: (e: unknown) => R) => Promise.resolve(fn(child)) };

    const d = new HandleReplyComposerDriver(fakeHandle(true), () => Promise.resolve(handle), never);
    await d.waitForRowOpen();
    await d.highlight();
    expect(composer.hl).toBe(true); // the composer container is highlighted
    expect(child.hl).toBe(false); // NOT the clicked child fragment
  });

  it("waitForSubmit delegates to the injected wait (the operator aborts; it never self-submits)", async () => {
    const d = new HandleReplyComposerDriver(fakeHandle(true), () => Promise.resolve(fakeHandle(true)), () =>
      Promise.resolve(false),
    );
    expect(await d.waitForSubmit()).toBe(false);
  });
});
