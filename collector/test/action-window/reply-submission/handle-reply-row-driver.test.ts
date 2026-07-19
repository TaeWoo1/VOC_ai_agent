/**
 * The same-session abort-rehearsal driver over a retained element handle. Proves: while the element is connected
 * it locates a single row and highlights it read-only; once it detaches (DOM re-render) it fails closed (count 0),
 * so the run can never proceed against a stale target. No persisted mapping, no page signature.
 */
import { describe, it, expect } from "vitest";
import { HandleReplyRowDriver, type AbortRowHandle } from "../../../src/action-window/reply-submission/handle-reply-row-driver";
import { composerSigFor } from "../../../src/action-window/reply-submission/reply-surface";

const SIG = composerSigFor(["row", "same-session-calibrated"]);
const waitOpen = () => Promise.resolve(false);

/** Fake element handle: runs the in-element callback against a small fake element; tracks annotation. */
function fakeHandle(connected: boolean, spy?: { highlighted?: boolean; cleaned?: boolean }): AbortRowHandle {
  const el = {
    isConnected: connected,
    style: {} as Record<string, string>,
    setAttribute: () => { if (spy) spy.highlighted = true; },
    removeAttribute: () => { if (spy) spy.cleaned = true; },
    scrollIntoView: () => undefined,
  };
  return { evaluate: <R>(fn: (e: unknown) => R): Promise<R> => Promise.resolve(fn(el)) };
}

describe("HandleReplyRowDriver — retained-element (same-session) row seam", () => {
  it("locates the retained row (count 1, stable sig) while the element is connected", async () => {
    const d = new HandleReplyRowDriver(fakeHandle(true), waitOpen);
    expect(await d.locateReviewRow()).toEqual({ count: 1, sig: SIG });
    expect(await d.prepareSurface()).toBe(true);
  });

  it("highlights the retained element read-only and returns the same sig (anti-drift stable)", async () => {
    const spy: { highlighted?: boolean } = {};
    const d = new HandleReplyRowDriver(fakeHandle(true, spy), waitOpen);
    expect(await d.highlightRow()).toEqual({ count: 1, sig: SIG });
    expect(spy.highlighted).toBe(true);
  });

  it("fails closed (count 0) once the element has detached / re-rendered", async () => {
    const d = new HandleReplyRowDriver(fakeHandle(false), waitOpen);
    expect(await d.locateReviewRow()).toEqual({ count: 0 });
    expect(await d.highlightRow()).toEqual({ count: 0 });
    expect(await d.prepareSurface()).toEqual({ ok: false, code: "UNSUPPORTED_STATE" });
  });

  it("highlightRow resolves the review ROW from the clicked anchor (not the anchor fragment)", async () => {
    const long = "x".repeat(200);
    interface N {
      tagName: string; textContent: string; parentElement: N | null; children: N[];
      style: Record<string, string>; isConnected: boolean; hl: boolean;
      setAttribute: (k: string, v: string) => void; removeAttribute: (k: string) => void; scrollIntoView: () => void;
    }
    const mk = (tag: string, text: string, parent: N | null): N => {
      const n: N = {
        tagName: tag, textContent: text, parentElement: parent, children: [], style: {}, isConnected: true, hl: false,
        setAttribute: (k) => { if (k === "data-aw-abort-highlight") n.hl = true; },
        removeAttribute: () => { n.hl = false; }, scrollIntoView: () => undefined,
      };
      if (parent) parent.children.push(n);
      return n;
    };
    const P = mk("MAIN", "", null);
    const rowA = mk("DIV", long, P);
    const rowB = mk("DIV", long, P); // the review row that contains the anchor
    const anchor = mk("SPAN", "hi", rowB); // the operator's exact clicked element
    const handle: AbortRowHandle = { evaluate: <R>(fn: (e: unknown) => R) => Promise.resolve(fn(anchor)) };

    const d = new HandleReplyRowDriver(handle, waitOpen);
    expect(await d.highlightRow()).toEqual({ count: 1, sig: SIG });
    expect(rowB.hl).toBe(true); // the whole review ROW is highlighted
    expect(anchor.hl).toBe(false); // NOT the clicked fragment
    expect(rowA.hl).toBe(false); // NOT a sibling review
  });

  it("cleanup removes the read-only annotation (best-effort)", async () => {
    const spy: { cleaned?: boolean } = {};
    const d = new HandleReplyRowDriver(fakeHandle(true, spy), waitOpen);
    await d.cleanup();
    expect(spy.cleaned).toBe(true);
  });
});
