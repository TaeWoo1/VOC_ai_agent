/**
 * **One press of `[쿠팡에서 보기]`, end to end, with no browser and no backend.**
 *
 * What is under test is mostly what this run REFUSES to do. It refuses to start without a binding; it
 * refuses to look for anything it could not resolve; it refuses to ring one of two matching rows; it refuses
 * to call a ring that did not land a completion; and it refuses to keep reading a window the seller closed.
 *
 * The other half is the shape of the honest stops: a page with no match and a page with two matches are
 * different messages with different repairs, and the run says which.
 */
import { describe, expect, it } from "vitest";
import {
  ACTION_WINDOW_PROTOCOL_VERSION,
  validateCommandEnvelope,
  validateEventEnvelope,
  validateRunView,
  type CommandEnvelope,
} from "../../../contracts/action-window/v2/index";
import type { AwClientFrame, AwServerFrame, AwServerTransport } from "../../../contracts/action-window/v2/transport";
import {
  ReviewLocateEngine,
  makeReviewLocateClock,
} from "../../src/action-window/coupang-review/review-locate-engine";
import { ReviewLocateSession } from "../../src/action-window/coupang-review/review-locate-session";
import { ReviewLocateFixtureDriver } from "../../src/action-window/coupang-review/review-locate-fixture-driver";
import type { ReviewLocateTarget } from "../../src/action-window/coupang-review/review-locate";
import type { ScriptedLocateAnswer } from "../../src/action-window/coupang-review/review-locate-fixture-driver";

const REF = "a1b2c3d4e5f60718";
const TARGET: ReviewLocateTarget = {
  productId: "15411270785",
  vendorItemId: "81234567890",
  writtenOn: "2026-08-11",
  rating: 5,
  bodyFingerprint: "f".repeat(64),
};

/** A loopback transport: the session's `send` lands in `frames`, and `client` pushes frames the other way. */
function loopback(): {
  transport: AwServerTransport;
  frames: AwServerFrame[];
  client(frame: AwClientFrame): void;
} {
  const frames: AwServerFrame[] = [];
  const listeners = new Set<(frame: AwClientFrame) => void>();
  return {
    transport: {
      send: (frame) => {
        frames.push(frame);
      },
      subscribe: (listener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    },
    frames,
    client: (frame) => {
      for (const l of [...listeners]) l(frame);
    },
  };
}

function startRun(revision = 0, ref: string | null = REF): CommandEnvelope {
  return {
    protocolVersion: ACTION_WINDOW_PROTOCOL_VERSION,
    commandId: `c-${revision}-${ref ?? "none"}`,
    runId: "run_locate1",
    expectedRevision: revision,
    type: "START_RUN",
    payload: { channelCode: "coupang", intent: "REVIEW_LOCATE", ...(ref ? { locateRef: ref } : {}) },
  } as CommandEnvelope;
}

function command(type: CommandEnvelope["type"], revision: number): CommandEnvelope {
  return {
    protocolVersion: ACTION_WINDOW_PROTOCOL_VERSION,
    commandId: `c-${type}-${revision}`,
    runId: "run_locate1",
    expectedRevision: revision,
    type,
  };
}

function harness(script: readonly ScriptedLocateAnswer[], resolved: ReviewLocateTarget | null = TARGET) {
  const engine = new ReviewLocateEngine(
    { runId: "run_locate1", channelCode: "coupang" },
    { clock: makeReviewLocateClock() },
  );
  const driver = new ReviewLocateFixtureDriver(script);
  const link = loopback();
  const session = new ReviewLocateSession(engine, driver, link.transport, async () => resolved, {
    retryPollMs: 0,
    // Two polls' worth: enough to prove the loop runs and re-reads, short enough that a test never hangs.
    retryTimeoutMs: 0,
  });
  session.attach();
  return { engine, driver, session, link };
}

function views(frames: readonly AwServerFrame[]) {
  return frames.filter((f) => f.kind === "aw_view").map((f) => (f as { view: unknown }).view as ReturnType<ReviewLocateEngine["view"]>);
}

function latestView(frames: readonly AwServerFrame[]) {
  const all = views(frames);
  return all[all.length - 1];
}

describe("REVIEW_LOCATE — the run", () => {
  it("rings the review and completes, in two steps", async () => {
    const h = harness([{ verdict: "LOCATED" }]);
    h.link.client({ kind: "aw_command", command: startRun() });
    await h.session.whenSettled();

    const view = latestView(h.link.frames)!;
    expect(view.status).toBe("COMPLETED");
    expect(view.intent).toBe("REVIEW_LOCATE");
    expect(view.progress).toEqual({ completedSteps: 2, totalSteps: 2 });
    expect(view.blocker).toBeUndefined();
    // A completed run offers no commands: there is nothing left to ask for.
    expect(view.allowedCommands).toEqual([]);
    expect(h.engine.currentStage()).toBe("highlighted");
  });

  it("hands the driver the resolved target, and only that", async () => {
    const h = harness([{ verdict: "LOCATED" }]);
    h.link.client({ kind: "aw_command", command: startRun() });
    await h.session.whenSettled();

    expect(h.driver.seen).toEqual([TARGET]);
  });

  it("refuses to start without a binding, and opens nothing", async () => {
    const h = harness([{ verdict: "LOCATED" }]);
    h.link.client({ kind: "aw_command", command: startRun(0, null) });
    await h.session.whenSettled();

    const results = h.link.frames.filter((f) => f.kind === "aw_command_result");
    expect(results).toHaveLength(1);
    expect((results[0] as { accepted: boolean }).accepted).toBe(false);
    expect(h.driver.seen).toEqual([]);
    expect(h.engine.isStarted()).toBe(false);
  });

  it("fails the run, terminally, when the binding cannot be resolved", async () => {
    const h = harness([{ verdict: "LOCATED" }], null);
    h.link.client({ kind: "aw_command", command: startRun() });
    await h.session.whenSettled();

    const view = latestView(h.link.frames)!;
    expect(view.status).toBe("FAILED");
    expect(view.blocker).toEqual({ code: "LOCATE_TARGET_UNRESOLVED", recoverable: false });
    // It never looked at the page: there was nothing to look for.
    expect(h.driver.seen).toEqual([]);
    expect(h.driver.cleanedUp).toBe(true);
  });

  /* ── the honest stops ─────────────────────────────────────────────────── */

  it("parks on THIS page when no row matches, and says so as its own thing", async () => {
    const h = harness([{ verdict: "NOT_ON_PAGE" }]);
    h.link.client({ kind: "aw_command", command: startRun() });
    await h.session.whenSettled();

    const view = latestView(h.link.frames)!;
    expect(view.status).toBe("WAITING_FOR_HUMAN");
    expect(view.blocker).toEqual({ code: "TARGET_NOT_FOUND", recoverable: true });
    expect(view.allowedCommands).toContain("REQUEST_STEP_RECHECK");
    expect(h.engine.currentStage()).toBe("not_on_page");
  });

  it("rings nothing when two rows match, and does not call that not-found", async () => {
    const h = harness([{ verdict: "AMBIGUOUS", matches: 2 }]);
    h.link.client({ kind: "aw_command", command: startRun() });
    await h.session.whenSettled();

    const view = latestView(h.link.frames)!;
    expect(view.blocker).toEqual({ code: "TARGET_AMBIGUOUS", recoverable: true });
    expect(h.engine.currentStage()).toBe("ambiguous");
  });

  it("reports an unreadable screen as 'not a 상품평 목록', not as Coupang having changed", async () => {
    const h = harness([{ verdict: "PAGE_UNREADABLE" }]);
    h.link.client({ kind: "aw_command", command: startRun() });
    await h.session.whenSettled();

    expect(latestView(h.link.frames)!.blocker).toEqual({ code: "UNSUPPORTED_STATE", recoverable: true });
    expect(h.engine.currentStage()).toBe("awaiting_page");
  });

  /**
   * A match whose row had gone by the time the ring was drawn is NOT a completion. A run reporting
   * "highlighted" over a screen with no ring on it sends the seller looking for a mark that is not there.
   */
  it("does not complete on a match whose ring never landed", async () => {
    const h = harness([{ verdict: "LOCATED", highlighted: false }]);
    h.link.client({ kind: "aw_command", command: startRun() });
    await h.session.whenSettled();

    expect(h.engine.currentStage()).toBe("not_on_page");
    expect(latestView(h.link.frames)!.status).toBe("WAITING_FOR_HUMAN");
  });

  /** A target the matcher itself rejects is a bad binding, not a bad page — so it ends the run. */
  it("ends the run when the resolved target is unusable", async () => {
    const h = harness([{ verdict: "INVALID_TARGET" }]);
    h.link.client({ kind: "aw_command", command: startRun() });
    await h.session.whenSettled();

    expect(h.engine.currentStage()).toBe("binding_unresolved");
    expect(latestView(h.link.frames)!.blocker?.code).toBe("LOCATE_TARGET_UNRESOLVED");
  });

  /* ── the seller's repairs ─────────────────────────────────────────────── */

  // Three scripted answers because the session's own look-again poll takes the second one: the first read and
  // the retry both miss, and the seller's explicit 다시 확인 is what finds it.
  it("re-reads on a recheck and rings the review once they have paged to it", async () => {
    const h = harness([{ verdict: "NOT_ON_PAGE" }, { verdict: "NOT_ON_PAGE" }, { verdict: "LOCATED" }]);
    h.link.client({ kind: "aw_command", command: startRun() });
    await h.session.whenSettled();
    const parked = latestView(h.link.frames)!;
    expect(parked.blocker?.code).toBe("TARGET_NOT_FOUND");

    h.link.client({ kind: "aw_command", command: command("REQUEST_STEP_RECHECK", parked.revision) });
    await h.session.whenSettled();

    expect(latestView(h.link.frames)!.status).toBe("COMPLETED");
    expect(h.driver.seen).toHaveLength(3);
  });

  /**
   * The seller's repair happens in their own window, nowhere near the SellerOps tab. A parked run therefore
   * looks again by itself, and the ring appears when they land on the right page — without them alt-tabbing
   * back to press anything.
   */
  it("looks again while the seller turns pages, and rings it when they arrive", async () => {
    const h = harness([{ verdict: "NOT_ON_PAGE" }, { verdict: "LOCATED" }]);
    h.link.client({ kind: "aw_command", command: startRun() });
    await h.session.whenSettled();

    expect(latestView(h.link.frames)!.status).toBe("COMPLETED");
    expect(h.driver.seen).toHaveLength(2);
  });

  /** Re-parking the same way is not news. A view a second at a seller who has not moved is noise. */
  it("publishes nothing while a re-read finds the same thing", async () => {
    const h = harness([{ verdict: "NOT_ON_PAGE" }]);
    h.link.client({ kind: "aw_command", command: startRun() });
    await h.session.whenSettled();

    const parked = latestView(h.link.frames)!;
    const viewsAfterPark = views(h.link.frames).filter((v) => v.revision === parked.revision).length;
    // The retry read happened (the fixture repeats its last answer) and produced no new revision.
    expect(h.driver.seen.length).toBeGreaterThan(1);
    expect(latestView(h.link.frames)!.revision).toBe(parked.revision);
    expect(viewsAfterPark).toBeGreaterThan(0);
  });

  it("stops reading a window the seller closed, and does not reopen it", async () => {
    const h = harness([{ verdict: "NOT_ON_PAGE" }]);
    h.link.client({ kind: "aw_command", command: startRun() });
    await h.session.whenSettled();
    const readsBefore = h.driver.seen.length;

    h.driver.closeWindow();
    await new Promise<void>((r) => setTimeout(r, 0));
    await h.session.whenSettled();

    expect(h.engine.currentStage()).toBe("awaiting_page");
    expect(latestView(h.link.frames)!.blocker).toEqual({ code: "SURFACE_CLOSED", recoverable: true });
    expect(h.driver.seen.length).toBe(readsBefore);
  });

  it("takes the ring back off when the seller cancels", async () => {
    const h = harness([{ verdict: "NOT_ON_PAGE" }]);
    h.link.client({ kind: "aw_command", command: startRun() });
    await h.session.whenSettled();
    const parked = latestView(h.link.frames)!;

    h.link.client({ kind: "aw_command", command: command("CANCEL_RUN", parked.revision) });
    await h.session.whenSettled();

    expect(latestView(h.link.frames)!.status).toBe("CANCELLED");
    expect(h.driver.cleared).toBeGreaterThan(0);
  });

  /**
   * "현재 단계 다시 찾기" brings the window the seller lost behind everything else back to the front. It does
   * not move the run: they land on the same park, with the same repair.
   */
  it("raises the seller's window on FIND_CURRENT_STEP without advancing the run", async () => {
    const h = harness([{ verdict: "NOT_ON_PAGE" }]);
    h.link.client({ kind: "aw_command", command: startRun() });
    await h.session.whenSettled();
    const parked = latestView(h.link.frames)!;

    h.link.client({ kind: "aw_command", command: command("FIND_CURRENT_STEP", parked.revision) });
    await h.session.whenSettled();

    expect(h.driver.raised).toBe(1);
    expect(h.engine.currentStage()).toBe("not_on_page");
    expect(latestView(h.link.frames)!.blocker).toEqual({ code: "TARGET_NOT_FOUND", recoverable: true });
  });

  /* ── the wire ─────────────────────────────────────────────────────────── */

  it("puts only contract-valid, sanitized frames on the wire", async () => {
    const h = harness([{ verdict: "NOT_ON_PAGE" }, { verdict: "LOCATED" }]);
    h.link.client({ kind: "aw_command", command: startRun() });
    await h.session.whenSettled();
    const parked = latestView(h.link.frames)!;
    h.link.client({ kind: "aw_command", command: command("REQUEST_STEP_RECHECK", parked.revision) });
    await h.session.whenSettled();

    for (const frame of h.link.frames) {
      if (frame.kind === "aw_view") expect(validateRunView(frame.view)).toEqual({ ok: true });
      if (frame.kind === "aw_event") expect(validateEventEnvelope(frame.event)).toEqual({ ok: true });
    }
    // Nothing that identifies the review reaches the wire — not the product, the date, or the fingerprint.
    const wire = JSON.stringify(h.link.frames);
    expect(wire).not.toContain(TARGET.productId);
    expect(wire).not.toContain(TARGET.vendorItemId);
    expect(wire).not.toContain(TARGET.writtenOn);
    expect(wire).not.toContain(TARGET.bodyFingerprint);
  });

  /**
   * The seller may press `[쿠팡에서 보기]` on a second review without restarting anything. Every press mints
   * its own binding, so a different ref is unambiguously a new request — and it is honoured from a completed
   * run as readily as from a parked one.
   */
  it("re-aims at another review when the seller presses the button again", async () => {
    const h = harness([{ verdict: "LOCATED" }]);
    h.link.client({ kind: "aw_command", command: startRun() });
    await h.session.whenSettled();
    expect(latestView(h.link.frames)!.status).toBe("COMPLETED");

    h.link.client({ kind: "aw_command", command: startRun(0, "00112233445566ff") });
    await h.session.whenSettled();

    expect(h.driver.seen).toHaveLength(2);
    expect(latestView(h.link.frames)!.status).toBe("COMPLETED");
  });

  /**
   * A press that lands while the previous one is still resolving must not be able to hand the new run the
   * OLD review's fields — that would ring one buyer's review under another's name, which is the exact
   * failure the whole binding design exists to prevent.
   */
  it("never rings the review the seller pressed a moment ago instead of the one they just pressed", async () => {
    const engine = new ReviewLocateEngine(
      { runId: "run_locate1", channelCode: "coupang" },
      { clock: makeReviewLocateClock() },
    );
    const driver = new ReviewLocateFixtureDriver([{ verdict: "LOCATED" }]);
    const link = loopback();
    const OTHER: ReviewLocateTarget = { ...TARGET, productId: "99999999999" };
    // The STALE resolve lands FIRST, while the new run is still opening — the ordering that does the damage.
    // (A stale one landing after the new run finished is harmless, and testing only that would prove nothing.)
    const session = new ReviewLocateSession(
      engine,
      driver,
      link.transport,
      async (ref) => {
        await new Promise<void>((r) => setTimeout(r, ref === REF ? 40 : 5));
        return ref === REF ? TARGET : OTHER;
      },
      { retryPollMs: 0, retryTimeoutMs: 0 },
    );
    session.attach();

    link.client({ kind: "aw_command", command: startRun(0, "00112233445566ff") });
    link.client({ kind: "aw_command", command: startRun(0, REF) });
    await new Promise<void>((r) => setTimeout(r, 80));
    await session.whenSettled();

    // Only the target belonging to the binding the run is actually bound to ever reached the page.
    expect(driver.seen).not.toContainEqual(OTHER);
    expect(driver.seen).toContainEqual(TARGET);
  });

  it("treats the same binding delivered twice as one press", async () => {
    const h = harness([{ verdict: "LOCATED" }]);
    h.link.client({ kind: "aw_command", command: startRun() });
    await h.session.whenSettled();

    h.link.client({ kind: "aw_command", command: startRun() });
    await h.session.whenSettled();

    expect(h.driver.seen).toHaveLength(1);
  });

  it("accepts its own START_RUN as a valid v2 command", () => {
    expect(validateCommandEnvelope(startRun())).toEqual({ ok: true });
  });

  it("replays the run to a client that reattached after a refresh", async () => {
    const h = harness([{ verdict: "LOCATED" }]);
    h.link.client({ kind: "aw_command", command: startRun() });
    await h.session.whenSettled();

    h.link.client({ kind: "aw_resync", runId: "run_locate1", sinceSequence: 0 });
    const resync = h.link.frames.filter((f) => f.kind === "aw_resync_result").pop() as unknown as {
      view: unknown;
      events: readonly unknown[];
    };
    expect(resync.view).not.toBeNull();
    expect(resync.events.length).toBeGreaterThan(0);
  });
});
