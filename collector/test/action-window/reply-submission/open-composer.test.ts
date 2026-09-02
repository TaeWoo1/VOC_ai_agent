/**
 * Acceptance Closure §2/§3 — the runtime opens the composer itself, scoped to the verified review; the seller
 * keeps the final submit. Engine, session, and the ladder driver, offline.
 */
import { describe, expect, it } from "vitest";
import { ReplyEngine } from "../../../src/action-window/reply-submission/reply-engine";
import { ReplySubmitSession } from "../../../src/action-window/reply-submission/reply-session";
import { SyntheticReplySubmitDriver } from "../../../src/action-window/reply-submission/reply-driver";
import { NaverLadderReplyDriver } from "../../../src/action-window/reply-submission/naver-ladder-reply-driver";
import type { LadderReplyPage } from "../../../src/action-window/reply-submission/naver-ladder-reply-driver";
import { openComposer } from "../../../src/action-window/reply-submission/reply-composer-open";
import type { AwClientFrame, AwServerFrame, AwServerTransport } from "../../../../contracts/action-window/v2/transport";
import { validateEventEnvelope } from "../../../../contracts/action-window/v2/index";

const HINT = { rating: 2, recencyBucket: "TODAY" as const, bodyFingerprint: "b".repeat(64) };
const ROW_SIG = "b2c3d4e5f6071829";
const COMPOSER_SIG = "a1b2c3d4e5f60718";
const FP = "c".repeat(64);

function guided(opts: { agentOpensComposer?: boolean } = {}) {
  return new ReplyEngine({ runId: "run_open", channelCode: "naver", targetHint: HINT, composerFill: true, agentOpensComposer: opts.agentOpensComposer ?? true });
}

describe("reply engine — OPEN_COMPOSER: the runtime presses the non-submit open control", () => {
  it("row verified → OPEN_COMPOSER → opened ⇒ step 2 completes by the runtime and the composer chain continues", () => {
    const e = guided();
    e.command({ type: "START_RUN", expectedRevision: 0 });
    e.onSurfaceReady(true);
    e.onRowLocated({ count: 1, sig: ROW_SIG });
    expect(e.onRowHighlighted({ count: 1, sig: ROW_SIG })).toBe("OPEN_COMPOSER");
    expect(e.view().status).toBe("RUNNING");
    expect(e.view().currentStep?.stepNumber).toBe(2);
    expect(e.onComposerOpened({ opened: true })).toBe("LOCATE");
    expect(e.wasComposerOpenedByRuntime()).toBe(true);
    expect(e.events().some((ev) => ev.type === "STEP_COMPLETED")).toBe(true);
    expect(e.events().some((ev) => ev.type === "HUMAN_ACTION_REQUIRED")).toBe(false);
    e.onLocated({ count: 1, sig: COMPOSER_SIG });
    expect(e.onHighlighted()).toBe("FILL");
    expect(e.onComposerFilled({ filled: true })).toBe("OBSERVE");
    // The seller's submit is still the barrier: WAITING_FOR_HUMAN at step 3, and only observed.
    expect(e.view().status).toBe("WAITING_FOR_HUMAN");
    expect(e.view().currentStep?.stepNumber).toBe(3);
    for (const ev of e.events()) expect(validateEventEnvelope(ev).ok, ev.type).toBe(true);
  });

  it("an ambiguous or missing open control falls back to the seller's own row-open step — never a guess", () => {
    for (const reason of ["AMBIGUOUS", "NOT_FOUND", "NOT_SUPPORTED"] as const) {
      const e = guided();
      e.command({ type: "START_RUN", expectedRevision: 0 });
      e.onSurfaceReady(true);
      e.onRowLocated({ count: 1, sig: ROW_SIG });
      e.onRowHighlighted({ count: 1, sig: ROW_SIG });
      expect(e.onComposerOpened({ opened: false, reason })).toBe("OBSERVE_ROW");
      expect(e.view().status).toBe("WAITING_FOR_HUMAN");
      expect(e.view().currentStep?.stepNumber).toBe(2);
      expect(e.wasComposerOpenedByRuntime()).toBe(false);
      expect(e.onRowOpened()).toBe("LOCATE");
    }
  });

  it("without agentOpensComposer the barrier is unchanged (backward compatible)", () => {
    const e = guided({ agentOpensComposer: false });
    e.command({ type: "START_RUN", expectedRevision: 0 });
    e.onSurfaceReady(true);
    e.onRowLocated({ count: 1, sig: ROW_SIG });
    expect(e.onRowHighlighted({ count: 1, sig: ROW_SIG })).toBe("OBSERVE_ROW");
    expect(e.onComposerOpened({ opened: true })).toBe("NONE");
  });
});

function transport(): AwServerTransport & { frames: AwServerFrame[]; emit: (f: AwClientFrame) => void } {
  const listeners = new Set<(f: AwClientFrame) => void>();
  const frames: AwServerFrame[] = [];
  return {
    frames,
    send: (f) => { frames.push(f); },
    subscribe: (l) => { listeners.add(l); return () => listeners.delete(l); },
    emit: (f) => { for (const l of listeners) l(f); },
  };
}

describe("reply session — drives openComposer and never a submit", () => {
  it("presses open once, fills once, and rests at the seller's submit barrier", async () => {
    const driver = new SyntheticReplySubmitDriver({ open: { opened: true }, fill: { filled: true } });
    const engine = guided();
    const t = transport();
    const observed: string[] = [];
    const session = new ReplySubmitSession(engine, driver, t, { onExecutionObserved: (s) => observed.push(s) });
    session.attach();
    t.emit({ kind: "aw_command", command: { protocolVersion: 2, commandId: "cmd-start", runId: "run_open", expectedRevision: 0, type: "START_RUN", payload: { channelCode: "naver", intent: "REPLY_SUBMISSION", submissionRef: "a1b2c3d4e5f60718" } } } as never);
    await session.whenSettled();
    expect(driver.opens).toBe(1);
    expect(driver.fills).toBe(1);
    expect(engine.view().status).toBe("WAITING_FOR_HUMAN");
    expect(engine.view().currentStep?.stepNumber).toBe(3);
    expect(observed).toEqual(["COMPOSER_FILLED"]);
  });

  it("a driver that cannot open leaves the seller to open the row; nothing is pressed", async () => {
    const driver = new SyntheticReplySubmitDriver({ fill: { filled: true } });
    const engine = guided();
    const t = transport();
    const session = new ReplySubmitSession(engine, driver, t);
    session.attach();
    t.emit({ kind: "aw_command", command: { protocolVersion: 2, commandId: "cmd-start", runId: "run_open", expectedRevision: 0, type: "START_RUN", payload: { channelCode: "naver", intent: "REPLY_SUBMISSION", submissionRef: "a1b2c3d4e5f60718" } } } as never);
    await session.whenSettled();
    expect(driver.opens).toBe(0);
    expect(engine.view().currentStep?.stepNumber).toBe(2);
    expect(engine.view().status).toBe("WAITING_FOR_HUMAN");
  });
});

/** A scripted page: the ladder answers what it is told; evaluate strings are dispatched by a marker they contain. */
function ladderPage(script: {
  rows: Array<{ fps: string[]; rating: number | null }>;
  outline?: string;
  openTagged?: number;
  scopedComposers?: number;
}): LadderReplyPage & { clicks: number; filled: string[] } {
  const state = { clicks: 0, filled: [] as string[] };
  return {
    clicks: 0,
    filled: state.filled,
    url: () => "https://example.invalid/reviews",
    content: async () => "",
    evaluate: async <T,>(fn: string): Promise<T> => {
      if (fn.includes("scopeExpandedRows: scopeExpandedRows")) {
        return {
          rows: script.rows.map((r, i) => ({ rowIndex: i, idFingerprints: r.fps.map((f) => ({ source: "visible-text", fingerprint: f })), secondary: { rating: r.rating, recencyBucket: "TODAY" } })),
          pageStateFingerprints: [], rowCount: script.rows.length, rowsTruncated: false, tokensTruncated: false, scopeExpandedRows: 0,
        } as T;
      }
      if (fn.includes("return 'outlined';")) return (script.outline ?? "outlined") as T;
      if (fn.includes("candidates.push(el)")) return (script.openTagged ?? 1) as T;
      if (fn.includes("composerCandidateCount")) return { composerCandidateCount: script.scopedComposers ?? 1, structuralFingerprint: 7 } as T;
      if (fn.includes("data-page")) return true as T;
      return (script.scopedComposers ?? 1) as T;
    },
    waitForFunction: async () => undefined,
    locator: (selector: string) => ({
      count: async () => (selector === "[data-aw-reply-open-target]" ? (script.openTagged ?? 1) : selector === "[data-aw-reply-target]" ? (script.scopedComposers ?? 1) : 0),
      click: async () => { state.clicks += 1; },
      fill: async (v: string) => { state.filled.push(v); },
    }),
    get clicksCount() { return state.clicks; },
  } as unknown as LadderReplyPage & { clicks: number; filled: string[] };
}

describe("ladder reply driver — identity by the review-id fingerprint, composer scoped to that row", () => {
  it("locates exactly the row carrying the fingerprint, opens its control, fills its composer", async () => {
    const page = ladderPage({ rows: [{ fps: ["d".repeat(64)], rating: 5 }, { fps: [FP], rating: 2 }] });
    const d = new NaverLadderReplyDriver(page, { hint: HINT, asOfDate: "2026-08-28", reviewIdFingerprint: FP, draftBody: "감사합니다" });
    expect(await d.prepareSurface()).toBe(true);
    expect(await d.locateReviewRow()).toMatchObject({ count: 1 });
    expect(await d.highlightRow()).toMatchObject({ count: 1 });
    expect(d.reviewIdVerdict()).toEqual({ kind: "MATCHED", rowIndex: 1 });
    expect(await d.openComposer()).toEqual({ opened: true });
    expect(await d.locateComposer()).toMatchObject({ count: 1 });
    await d.highlight();
    expect(await d.fillComposer()).toEqual({ filled: true });
    expect(page.filled).toEqual(["감사합니다"]);
  });

  it("no fingerprint from the backend ⇒ no row is proven ⇒ nothing is opened or filled", async () => {
    const page = ladderPage({ rows: [{ fps: [FP], rating: 2 }] });
    const d = new NaverLadderReplyDriver(page, { hint: HINT, asOfDate: "2026-08-28", reviewIdFingerprint: null, draftBody: "x" });
    expect(await d.locateReviewRow()).toEqual({ count: 0 });
    expect(await d.openComposer()).toEqual({ opened: false, reason: "NOT_FOUND" });
    expect(await d.fillComposer()).toMatchObject({ filled: false });
    expect(page.filled).toEqual([]);
  });

  it("two rows carrying the fingerprint, or a rating that contradicts the hint, is ambiguity — nothing proceeds", async () => {
    const two = new NaverLadderReplyDriver(ladderPage({ rows: [{ fps: [FP], rating: 2 }, { fps: [FP], rating: 2 }] }), { hint: HINT, asOfDate: "2026-08-28", reviewIdFingerprint: FP, draftBody: "x" });
    expect(await two.locateReviewRow()).toEqual({ count: 2 });
    expect(two.reviewIdVerdict()).toEqual({ kind: "AMBIGUOUS", matchCount: 2 });
    const contradicted = new NaverLadderReplyDriver(ladderPage({ rows: [{ fps: [FP], rating: 5 }] }), { hint: HINT, asOfDate: "2026-08-28", reviewIdFingerprint: FP, draftBody: "x" });
    expect(await contradicted.locateReviewRow()).toEqual({ count: 0 });
  });

  it("a list that re-rendered between locate and highlight fails closed; an ambiguous open control asks the seller", async () => {
    const moved = new NaverLadderReplyDriver(ladderPage({ rows: [{ fps: [FP], rating: 2 }], outline: "row-changed" }), { hint: HINT, asOfDate: "2026-08-28", reviewIdFingerprint: FP, draftBody: "x" });
    await moved.locateReviewRow();
    expect(await moved.highlightRow()).toEqual({ count: 0 });
    expect(await moved.openComposer()).toEqual({ opened: false, reason: "NOT_FOUND" });
    const twoControls = new NaverLadderReplyDriver(ladderPage({ rows: [{ fps: [FP], rating: 2 }], openTagged: 2 }), { hint: HINT, asOfDate: "2026-08-28", reviewIdFingerprint: FP, draftBody: "x" });
    await twoControls.locateReviewRow(); await twoControls.highlightRow();
    expect(await twoControls.openComposer()).toEqual({ opened: false, reason: "AMBIGUOUS" });
  });

  it("two composers inside the row's scope is ambiguity for the fill", async () => {
    const d = new NaverLadderReplyDriver(ladderPage({ rows: [{ fps: [FP], rating: 2 }], scopedComposers: 2 }), { hint: HINT, asOfDate: "2026-08-28", reviewIdFingerprint: FP, draftBody: "x" });
    await d.locateReviewRow(); await d.highlightRow();
    expect(await d.locateComposer()).toMatchObject({ count: 2 });
    await d.highlight();
    expect(await d.fillComposer()).toEqual({ filled: false, reason: "AMBIGUOUS" });
  });
});

describe("composer open helper — exactly one tagged control or nothing", () => {
  it("clicks once on exactly one marker; zero or two markers press nothing", async () => {
    let clicks = 0;
    const pageWith = (n: number) => ({ locator: () => ({ count: async () => n, click: async () => { clicks += 1; } }) });
    expect(await openComposer(pageWith(1))).toEqual({ opened: true });
    expect(await openComposer(pageWith(0))).toEqual({ opened: false, reason: "NOT_FOUND" });
    expect(await openComposer(pageWith(2))).toEqual({ opened: false, reason: "AMBIGUOUS" });
    expect(clicks).toBe(1);
  });
});

/**
 * Post-login re-observation (2026-09-03). The dedicated window opens where NAVER puts it — a login screen
 * when the profile has no session — and the run used to end there, terminally, in the milliseconds before
 * the seller had typed anything. This is the wait that makes the login a step rather than an outcome.
 *
 * Read-only throughout: it polls the same signal `prepareSurface` reads and asks the carrier to re-open the
 * review list it had already navigated to. No click, no credential, no submit.
 */
describe("ladder reply driver — waiting out a login", () => {
  function loginPage(script: { readyAfterMs?: number; timesOut?: boolean }) {
    let waited = false;
    const page = {
      url: () => "https://example.invalid/login",
      content: async () => "",
      evaluate: async <T,>(fn: string): Promise<T> => {
        // The login signal: false until the wait has resolved, true afterwards.
        if (fn.includes("data-page")) return (waited as unknown) as T;
        return (0 as unknown) as T;
      },
      waitForFunction: async () => {
        if (script.timesOut) throw new Error("timeout");
        waited = true;
        return undefined;
      },
      locator: () => ({ count: async () => 0, click: async () => undefined, fill: async () => undefined }),
    } as unknown as LadderReplyPage;
    return page;
  }

  it("waits, asks the carrier to re-open the review surface, and then probes ready", async () => {
    let relanded = 0;
    const page = loginPage({});
    const d = new NaverLadderReplyDriver(page, {
      hint: HINT, asOfDate: "2026-08-28", reviewIdFingerprint: FP, draftBody: "감사합니다",
      onSurfaceRecovered: async () => { relanded += 1; },
    });
    expect(await d.prepareSurface()).toEqual({ ok: false, code: "LOGIN_REQUIRED" });
    expect(await d.waitForSurfaceReady()).toBe(true);
    expect(relanded).toBe(1);
    expect(await d.prepareSurface()).toBe(true);
  });

  it("a login that never arrives is a timeout, not a pretend-ready surface", async () => {
    let relanded = 0;
    const d = new NaverLadderReplyDriver(loginPage({ timesOut: true }), {
      hint: HINT, asOfDate: "2026-08-28", reviewIdFingerprint: FP, draftBody: "감사합니다",
      loginTimeoutMs: 5,
      onSurfaceRecovered: async () => { relanded += 1; },
    });
    expect(await d.waitForSurfaceReady()).toBe(false);
    // Nothing is re-opened on a timeout: the run is about to end and a navigation would be noise on the
    // seller's own window.
    expect(relanded).toBe(0);
  });
});
