/**
 * **`REVIEW_ACQUISITION` — the run, end to end without WING (LOCAL_PROVEN).**
 *
 * What these prove is not "it reads pages" — the reader and the walk rule have their own suites. It is the
 * Action Window shape around them: the seller lifts the per-page barrier every time, the runtime never turns
 * a page, the handoff happens ONCE at the end, a walk the seller ends early is stored and not rounded up to
 * coverage, and nothing a customer wrote ever reaches an event, a view, or the target-client's log.
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
import { AW_CARRIER_KINDS, parseAwCarrierKind } from "../../../contracts/action-window/aw-carrier-kind";
import { ReviewAcquisitionEngine, makeReviewAcquisitionClock } from "../../src/action-window/coupang-review/review-acquisition-engine";
import { ReviewAcquisitionRunSession } from "../../src/action-window/coupang-review/review-acquisition-run-session";
import {
  ReviewAcquisitionFixtureDriver,
  type ScriptedPage,
} from "../../src/action-window/coupang-review/review-acquisition-fixture-driver";
import { fetchReviewAcquisitionTarget, parseAcquisitionTarget } from "../../src/action-window/coupang-review/review-acquisition-target-client";
import type { ReviewHandoffRequest, ReviewHandoffResponse } from "../../src/action-window/coupang-review/review-handoff-client";
import { ReviewAcquisitionEndpoint } from "../../src/bridge/review-acquisition-endpoint";
import { WebSocket } from "ws";

const REF = "5e11e70ac0de0001";
const SLOT = "0123456789abcdef01234567";
const CANARY = "합성 리뷰 — 절대 wire에 나가면 안 되는 문장";

function loopback(): { transport: AwServerTransport; frames: AwServerFrame[]; client(frame: AwClientFrame): void } {
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
    commandId: `c-start-${revision}-${ref ?? "none"}`,
    runId: "run_acq1",
    expectedRevision: revision,
    type: "START_RUN",
    payload: { channelCode: "coupang", intent: "REVIEW_ACQUISITION", ...(ref ? { acquisitionRef: ref } : {}) },
  } as CommandEnvelope;
}

function command(type: CommandEnvelope["type"], revision: number): CommandEnvelope {
  return { protocolVersion: ACTION_WINDOW_PROTOCOL_VERSION, commandId: `c-${type}-${revision}`, runId: "run_acq1", expectedRevision: revision, type };
}

interface Harness {
  engine: ReviewAcquisitionEngine;
  driver: ReviewAcquisitionFixtureDriver;
  session: ReviewAcquisitionRunSession;
  link: ReturnType<typeof loopback>;
  handoffs: ReviewHandoffRequest[];
  /** Every run that stored nothing and said so, in order. Empty is the normal case. */
  failures: { accountSlot: string; channelCode: string; failureCode: string }[];
}

function harness(
  script: readonly ScriptedPage[],
  opts: {
    resolved?: { accountSlot: string; channelCode: string } | null;
    handoff?: (r: ReviewHandoffRequest) => Promise<ReviewHandoffResponse>;
    /** The ASIDE provider's fact: it opens the 상품평 route itself. Absent = LOCAL_HELPER, byte-identical. */
    opensTargetPageItself?: boolean;
  } = {},
): Harness {
  const engine = new ReviewAcquisitionEngine(
    {
      runId: "run_acq1",
      channelCode: "coupang",
      ...(opts.opensTargetPageItself === undefined ? {} : { opensTargetPageItself: opts.opensTargetPageItself }),
    },
    { clock: makeReviewAcquisitionClock() },
  );
  const driver = new ReviewAcquisitionFixtureDriver(script);
  const link = loopback();
  const handoffs: ReviewHandoffRequest[] = [];
  const failures: { accountSlot: string; channelCode: string; failureCode: string }[] = [];
  const resolved = opts.resolved === undefined ? { accountSlot: SLOT, channelCode: "COUPANG" } : opts.resolved;
  const session = new ReviewAcquisitionRunSession(engine, driver, link.transport, {
    resolveTarget: async () => resolved,
    reportFailure: async (r) => {
      failures.push(r);
      return true;
    },
    handoff:
      opts.handoff ??
      (async (r) => {
        handoffs.push(r);
        return { ok: true, received: r.reviews.length, stored: r.reviews.length, skipped: 0, failed: 0, unlinked: 0, reason: null };
      }),
  });
  session.attach();
  return { engine, driver, session, link, handoffs, failures };
}

function latestView(frames: readonly AwServerFrame[]) {
  const all = frames.filter((f) => f.kind === "aw_view").map((f) => (f as { view: ReturnType<ReviewAcquisitionEngine["view"]> }).view);
  return all[all.length - 1]!;
}

function eventTypes(frames: readonly AwServerFrame[]): string[] {
  return frames.filter((f) => f.kind === "aw_event").map((f) => (f as { event: { type: string } }).event.type);
}

async function pressRead(h: Harness): Promise<void> {
  h.link.client({ kind: "aw_command", command: command("REQUEST_STEP_RECHECK", h.engine.view().revision) });
  await h.session.whenSettled();
}

describe("REVIEW_ACQUISITION — the run", () => {
  it("walks three pages the seller turns, hands off once at the pager's end, and completes with coverage", async () => {
    const h = harness([
      { bodies: [`${CANARY} 1`, `${CANARY} 2`], page: 1, last: 3 },
      { bodies: [`${CANARY} 3`], page: 2, last: 3 },
      { bodies: [`${CANARY} 4`], page: 3, last: 3 },
    ]);
    h.link.client({ kind: "aw_command", command: startRun() });
    await h.session.whenSettled();
    // Parked at the barrier: the seller brings the list up. Nothing was read at activation.
    expect(h.driver.reads).toBe(0);
    let view = latestView(h.link.frames);
    expect(view.status).toBe("WAITING_FOR_HUMAN");
    expect(view.currentStep?.stepId).toBe("aw.user_target_action");
    expect(view.allowedCommands).toEqual(["REQUEST_STEP_RECHECK", "SWITCH_TO_MANUAL", "CANCEL_RUN", "FIND_CURRENT_STEP"]);

    await pressRead(h);
    view = latestView(h.link.frames);
    expect(view.status).toBe("WAITING_FOR_HUMAN"); // page 1 read; more pages — back to the seller
    expect(view.runCopyParams).toEqual({ pagesRead: 1, collected: 2, stored: 0, coverageComplete: false });
    expect(h.handoffs).toHaveLength(0); // NOT page by page

    await pressRead(h);
    await pressRead(h);
    view = latestView(h.link.frames);
    expect(view.status).toBe("COMPLETED");
    expect(view.runCopyParams).toEqual({ pagesRead: 3, collected: 4, stored: 4, coverageComplete: true });
    expect(view.progress).toEqual({ completedSteps: 3, totalSteps: 3 });
    expect(view.blocker).toBeUndefined();
    expect(h.handoffs).toHaveLength(1);
    expect(h.handoffs[0]!.accountSlot).toBe(SLOT);
    expect(h.handoffs[0]!.complete).toBe(true);
    expect(h.handoffs[0]!.reviews).toHaveLength(4);
    expect(h.driver.reads).toBe(3); // one read per seller press, never more
    expect(h.driver.cleanedUp).toBe(true);
    expect(eventTypes(h.link.frames).filter((t) => t === "USER_ACTION_OBSERVED")).toHaveLength(3);
    expect(eventTypes(h.link.frames)).toContain("RUN_COMPLETED");
  });

  it("「여기까지만」 hands over what was read and does NOT claim coverage", async () => {
    const h = harness([{ bodies: [CANARY], page: 1, last: 5 }, { bodies: ["x"], page: 2, last: 5 }]);
    h.link.client({ kind: "aw_command", command: startRun() });
    await h.session.whenSettled();
    await pressRead(h);
    h.link.client({ kind: "aw_command", command: command("SWITCH_TO_MANUAL", h.engine.view().revision) });
    await h.session.whenSettled();
    const view = latestView(h.link.frames);
    expect(view.status).toBe("COMPLETED");
    expect(view.runCopyParams).toEqual({ pagesRead: 1, collected: 1, stored: 1, coverageComplete: false });
    expect(h.handoffs).toHaveLength(1);
    expect(h.handoffs[0]!.complete).toBe(false);
    expect(h.handoffs[0]!.stopReason).toBe("OPERATOR_FINISHED");
  });

  it("a page that is not a 상품평 list parks recoverably and ends nothing", async () => {
    const h = harness([{ unreadable: true }, { bodies: [CANARY], page: 1, last: 1 }]);
    h.link.client({ kind: "aw_command", command: startRun() });
    await h.session.whenSettled();
    await pressRead(h);
    let view = latestView(h.link.frames);
    expect(view.status).toBe("WAITING_FOR_HUMAN");
    expect(view.blocker).toEqual({ code: "UNSUPPORTED_STATE", recoverable: true });
    expect(view.runCopyParams).toMatchObject({ pagesRead: 0, collected: 0 });
    await pressRead(h);
    view = latestView(h.link.frames);
    expect(view.status).toBe("COMPLETED");
    expect(view.runCopyParams).toEqual({ pagesRead: 1, collected: 1, stored: 1, coverageComplete: true });
  });

  /**
   * The gap M5 named: a press that failed before storing said so in the window and then the window closed,
   * and the seller's collection history could not tell it from a press that never happened.
   */
  it("a press the seller gave up on is written down — once, with the word they were shown", async () => {
    const h = harness([{ unreadable: true }, { unreadable: true }]);
    h.link.client({ kind: "aw_command", command: startRun() });
    await h.session.whenSettled();

    // Two refusals of the same screen are one fact about one press, and nothing is written while the window
    // is still open — the seller can still repair it.
    await pressRead(h);
    await pressRead(h);
    expect(h.failures).toEqual([]);

    // They close the window instead. NOW the press has an ending, and it is the one they were shown.
    await h.session.settleRun();
    expect(h.failures).toEqual([{ accountSlot: SLOT, channelCode: "COUPANG", failureCode: "UNSUPPORTED_STATE" }]);
    await h.session.settleRun();
    expect(h.failures).toHaveLength(1);
  });

  /**
   * The reason the row is written at the END of the press rather than the moment a page refuses: a seller who
   * is told the list is not up, brings it up, and presses again has not had a failed sync.
   */
  it("a refusal the seller repaired is not a failed sync", async () => {
    const h = harness([{ unreadable: true }, { bodies: [CANARY], page: 1, last: 1 }]);
    h.link.client({ kind: "aw_command", command: startRun() });
    await h.session.whenSettled();
    await pressRead(h);
    await pressRead(h);
    expect(latestView(h.link.frames).status).toBe("COMPLETED");
    expect(h.handoffs).toHaveLength(1);
    await h.session.settleRun();
    expect(h.failures).toEqual([]);
  });

  it("a walk the seller cancelled writes nothing — a decision is not a fault", async () => {
    const h = harness([{ unreadable: true }]);
    h.link.client({ kind: "aw_command", command: startRun() });
    await h.session.whenSettled();
    await pressRead(h);
    h.link.client({ kind: "aw_command", command: command("CANCEL_RUN", h.engine.view().revision) });
    await h.session.whenSettled();
    expect(latestView(h.link.frames).status).toBe("CANCELLED");
    expect(h.failures).toEqual([]);
  });

  it("a refused handoff is written down too — nothing was stored and the row has to say so", async () => {
    const h = harness([{ bodies: [CANARY], page: 1, last: 1 }], {
      handoff: async (r) => ({ ok: false, received: r.reviews.length, stored: 0, skipped: 0, failed: 0, unlinked: 0, reason: "HTTP_500" }),
    });
    h.link.client({ kind: "aw_command", command: startRun() });
    await h.session.whenSettled();
    await pressRead(h);

    expect(latestView(h.link.frames).status).toBe("FAILED");
    // The engine reaches this ending itself, so the row is written without waiting for the window to close.
    expect(h.failures).toEqual([{ accountSlot: SLOT, channelCode: "COUPANG", failureCode: "HANDOFF_REJECTED" }]);
    // The failure word travels; the reviews do not.
    expect(JSON.stringify(h.failures)).not.toContain(CANARY);
  });

  /**
   * The one failure this cannot record, and not for want of trying: the account slot IS what failed to
   * resolve, so there is no seller account whose history the row could belong to. Filing it against a guess
   * would be worse than the gap.
   */
  it("an unresolved binding writes nothing — there is no account to write it against", async () => {
    const h = harness([{ bodies: [CANARY], page: 1, last: 1 }], { resolved: null });
    h.link.client({ kind: "aw_command", command: startRun() });
    await h.session.whenSettled();
    expect(latestView(h.link.frames).status).toBe("FAILED");
    expect(h.failures).toEqual([]);
  });

  it("a pager it cannot read ends the walk as the CLI does — stored, coverage unclaimed", async () => {
    const h = harness([{ bodies: [CANARY], page: 1, last: 3 }, { bodies: ["y"], pagerUnresolved: true }]);
    h.link.client({ kind: "aw_command", command: startRun() });
    await h.session.whenSettled();
    await pressRead(h);
    await pressRead(h);
    const view = latestView(h.link.frames);
    expect(view.status).toBe("COMPLETED");
    expect(view.runCopyParams).toEqual({ pagesRead: 1, collected: 1, stored: 1, coverageComplete: false });
    expect(h.session.lastWalkCounts()?.stopReason).toBe("PAGER_UNRESOLVED");
  });

  it("pages read with nothing to store complete without a handoff (an empty batch is not a failure)", async () => {
    const h = harness([{ bodies: [], page: 1, last: 1 }]);
    h.link.client({ kind: "aw_command", command: startRun() });
    await h.session.whenSettled();
    await pressRead(h);
    const view = latestView(h.link.frames);
    expect(view.status).toBe("COMPLETED");
    expect(view.runCopyParams).toEqual({ pagesRead: 1, collected: 0, stored: 0, coverageComplete: true });
    expect(h.handoffs).toHaveLength(0);
  });

  it("a refused handoff fails the run as HANDOFF_REJECTED — nothing stored, nothing re-read", async () => {
    const h = harness([{ bodies: [CANARY], page: 1, last: 1 }], {
      handoff: async () => ({ ok: false, received: 1, stored: 0, skipped: 0, failed: 0, unlinked: 0, reason: "HTTP_500" }),
    });
    h.link.client({ kind: "aw_command", command: startRun() });
    await h.session.whenSettled();
    await pressRead(h);
    const view = latestView(h.link.frames);
    expect(view.status).toBe("FAILED");
    expect(view.blocker).toEqual({ code: "HANDOFF_REJECTED", recoverable: false });
    expect(view.runCopyParams).toEqual({ pagesRead: 1, collected: 1, stored: 0, coverageComplete: true });
    expect(h.driver.reads).toBe(1);
  });

  it("an unresolvable binding ends the run before any page is read", async () => {
    const h = harness([{ bodies: [CANARY] }], { resolved: null });
    h.link.client({ kind: "aw_command", command: startRun() });
    await h.session.whenSettled();
    const view = latestView(h.link.frames);
    expect(view.status).toBe("FAILED");
    expect(view.blocker).toEqual({ code: "ACQUISITION_TARGET_UNRESOLVED", recoverable: false });
    expect(h.driver.reads).toBe(0);
  });

  it("a binding minted for another channel is refused as unresolved, never handed off under COUPANG", async () => {
    const h = harness([{ bodies: [CANARY] }], { resolved: { accountSlot: SLOT, channelCode: "NAVER" } });
    h.link.client({ kind: "aw_command", command: startRun() });
    await h.session.whenSettled();
    expect(latestView(h.link.frames).blocker?.code).toBe("ACQUISITION_TARGET_UNRESOLVED");
    expect(h.handoffs).toHaveLength(0);
  });

  it("cancel stores nothing; a START_RUN without a ref is refused; a second ref mid-walk is refused", async () => {
    const h = harness([{ bodies: [CANARY], page: 1, last: 2 }]);
    h.link.client({ kind: "aw_command", command: startRun(0, null) });
    const refused = h.link.frames.find((f) => f.kind === "aw_command_result") as { accepted: boolean; reason?: string };
    expect(refused.accepted).toBe(false);
    h.link.client({ kind: "aw_command", command: startRun() });
    await h.session.whenSettled();
    await pressRead(h);
    expect(h.engine.command({ type: "START_RUN", expectedRevision: 0, payload: { acquisitionRef: "ffffffffffffffff" } })).toEqual({ ok: false, reason: "INVALID_FOR_STATE" });
    h.link.client({ kind: "aw_command", command: command("CANCEL_RUN", h.engine.view().revision) });
    await h.session.whenSettled();
    expect(latestView(h.link.frames).status).toBe("CANCELLED");
    expect(h.handoffs).toHaveLength(0);
    // Settled: a NEW binding re-arms the same run identity for the seller's next read.
    expect(h.engine.command({ type: "START_RUN", expectedRevision: 0, payload: { acquisitionRef: "ffffffffffffffff" } })).toMatchObject({ ok: true, effect: "RESOLVE" });
    expect(h.engine.counts()).toEqual({ pagesRead: 0, collected: 0, stored: 0, coverageComplete: false });
  });

  it("the seller closing the window parks the run on SURFACE_CLOSED", async () => {
    const h = harness([{ bodies: [CANARY], page: 1, last: 2 }]);
    h.link.client({ kind: "aw_command", command: startRun() });
    await h.session.whenSettled();
    h.driver.closeWindow();
    await new Promise<void>((r) => setTimeout(r, 0));
    expect(latestView(h.link.frames).blocker).toEqual({ code: "SURFACE_CLOSED", recoverable: true });
  });

  it("every frame on the wire is contract-valid and carries no review text", async () => {
    const h = harness([{ bodies: [CANARY], page: 1, last: 1 }]);
    h.link.client({ kind: "aw_command", command: startRun() });
    await h.session.whenSettled();
    await pressRead(h);
    for (const f of h.link.frames) {
      if (f.kind === "aw_view") expect(validateRunView(f.view)).toEqual({ ok: true });
      if (f.kind === "aw_event") expect(validateEventEnvelope(f.event)).toEqual({ ok: true });
    }
    expect(validateCommandEnvelope(startRun())).toEqual({ ok: true });
    const wire = JSON.stringify(h.link.frames) + JSON.stringify(h.engine.events()) + JSON.stringify(h.engine.view());
    expect(wire).not.toContain(CANARY);
    expect(wire).not.toContain(SLOT);
  });
});

describe("REVIEW_ACQUISITION — the engine cannot act on the marketplace", () => {
  it("its effect vocabulary has no page turn, click, type, or navigate", async () => {
    const { readFileSync } = await import("node:fs");
    const { fileURLToPath } = await import("node:url");
    const { dirname, resolve } = await import("node:path");
    const here = dirname(fileURLToPath(import.meta.url));
    const dir = resolve(here, "../../src/action-window/coupang-review");
    const strip = (s: string) =>
      s.replace(/\/\*[\s\S]*?\*\//g, "").split("\n").filter((l) => !l.trim().startsWith("//") && !l.trim().startsWith("*")).join("\n");
    for (const file of ["review-acquisition-engine.ts", "review-acquisition-run-session.ts", "review-acquisition-driver.ts"]) {
      const code = strip(readFileSync(resolve(dir, file), "utf8"));
      for (const token of [".click(", ".type(", ".fill(", ".press(", ".goto(", "nextPage", "keyboard", "dispatchEvent", ".submit("]) {
        expect(code, `${file} contains ${token}`).not.toContain(token);
      }
    }
    const engine = strip(readFileSync(resolve(dir, "review-acquisition-engine.ts"), "utf8"));
    expect(engine).toContain('"RESOLVE" | "READ" | "HANDOFF" | "CLEANUP" | "NONE"');
  });
});

describe("REVIEW_ACQUISITION — spending the binding", () => {
  it("parses only a well-formed target; anything off-shape is a refusal, never a partial", () => {
    expect(parseAcquisitionTarget({ accountSlot: SLOT, channelCode: "COUPANG" })).toEqual({ accountSlot: SLOT, channelCode: "COUPANG" });
    expect(parseAcquisitionTarget({ accountSlot: "short", channelCode: "COUPANG" })).toBeNull();
    expect(parseAcquisitionTarget({ accountSlot: SLOT })).toBeNull();
    expect(parseAcquisitionTarget({ accountSlot: SLOT, channelCode: "coupang" })).toBeNull();
    expect(parseAcquisitionTarget(null)).toBeNull();
  });

  it("posts the ref in the BODY to the spend endpoint and refuses on transport, status, or shape", async () => {
    const calls: { url: string; body: string }[] = [];
    const ok: typeof fetch = async (url, init) => {
      calls.push({ url: String(url), body: String(init?.body) });
      return new Response(JSON.stringify({ accountSlot: SLOT, channelCode: "COUPANG" }), { status: 200 });
    };
    expect(await fetchReviewAcquisitionTarget("http://127.0.0.1:8080", "t", REF, ok)).toEqual({ accountSlot: SLOT, channelCode: "COUPANG" });
    expect(calls[0]!.url).toBe("http://127.0.0.1:8080/api/agent/review-acquisition-targets");
    expect(calls[0]!.body).toBe(JSON.stringify({ acquisitionRef: REF }));
    expect(await fetchReviewAcquisitionTarget("http://127.0.0.1:8080", "t", "not-a-ref", ok)).toBeNull();
    expect(await fetchReviewAcquisitionTarget("http://127.0.0.1:8080", "t", REF, async () => new Response("spent", { status: 410 }))).toBeNull();
    expect(await fetchReviewAcquisitionTarget("http://127.0.0.1:8080", "t", REF, async () => new Response("<html>", { status: 200 }))).toBeNull();
    expect(await fetchReviewAcquisitionTarget("http://127.0.0.1:8080", "t", REF, async () => { throw new Error("ECONNREFUSED"); })).toBeNull();
  });
});

describe("the acquire carrier, as a thing a frontend can attach to", () => {
  it("is a carrier kind of its own, and announces `acquire`", () => {
    expect(AW_CARRIER_KINDS).toContain("acquire");
    expect(parseAwCarrierKind("acquire")).toBe("acquire");
    const endpoint = new ReviewAcquisitionEndpoint({ runId: "run_a1", channelCode: "coupang" });
    const sent: string[] = [];
    const ws = { readyState: WebSocket.OPEN, send: (t: string) => sent.push(t) } as unknown as WebSocket;
    endpoint.onClientConnected(ws);
    const announcement = JSON.parse(sent[0]!) as Record<string, unknown>;
    expect(announcement).toMatchObject({ type: "aw_session", carrier: "acquire", runId: "run_a1", channelCode: "coupang" });
    const seen: unknown[] = [];
    endpoint.transport.subscribe((frame) => seen.push(frame));
    endpoint.onClientPayload(ws, "{not json");
    expect(seen).toEqual([]);
  });
});

/**
 * **The provider that opens the page itself (ASIDE).**
 *
 * The barrier below is not removed — it is not RAISED, and only where it was gating nothing. Everything that
 * stops a run still stops it, and the run still cannot start without the seller's own single-use binding.
 */
describe("REVIEW_ACQUISITION — a provider that opens the 상품평 page itself", () => {
  it("reads and hands off on the seller's ONE press, with no second confirmation", async () => {
    const h = harness([{ bodies: [`${CANARY} 1`, `${CANARY} 2`], page: 1, last: 1 }], { opensTargetPageItself: true });
    h.link.client({ kind: "aw_command", command: startRun() });
    await h.session.whenSettled();
    expect(h.driver.reads).toBe(1);
    expect(h.handoffs).toHaveLength(1);
    expect(latestView(h.link.frames).status).toBe("COMPLETED");
    // No barrier was ever raised, so nothing asked the seller for a second press.
    expect(eventTypes(h.link.frames)).not.toContain("HUMAN_ACTION_REQUIRED");
  });

  it("the other provider is untouched: it still rests until the seller says a page is up", async () => {
    const h = harness([{ bodies: [`${CANARY} 1`], page: 1, last: 1 }]);
    h.link.client({ kind: "aw_command", command: startRun() });
    await h.session.whenSettled();
    expect(h.driver.reads).toBe(0);
    expect(latestView(h.link.frames).status).toBe("WAITING_FOR_HUMAN");
  });

  it("still cannot start without the seller's own single-use binding", async () => {
    const h = harness([{ bodies: [`${CANARY} 1`], page: 1, last: 1 }], { opensTargetPageItself: true });
    // Nothing sent: nothing read.
    await h.session.whenSettled();
    expect(h.driver.reads).toBe(0);
    // A start with no acquisitionRef is refused, and still reads nothing.
    h.link.client({ kind: "aw_command", command: startRun(0, null) });
    await h.session.whenSettled();
    expect(h.driver.reads).toBe(0);
    expect(h.handoffs).toHaveLength(0);
  });

  it("an unreadable page still parks fail-closed, and the seller's press is what re-reads it", async () => {
    const h = harness(
      [{ unreadable: true }, { bodies: [`${CANARY} 1`], page: 1, last: 1 }],
      { opensTargetPageItself: true },
    );
    h.link.client({ kind: "aw_command", command: startRun() });
    await h.session.whenSettled();
    expect(h.driver.reads).toBe(1);
    const parked = latestView(h.link.frames);
    expect(parked.status).toBe("WAITING_FOR_HUMAN");
    expect(parked.blocker?.code).toBeDefined();
    expect(h.handoffs).toHaveLength(0);
    await pressRead(h);
    expect(latestView(h.link.frames).status).toBe("COMPLETED");
    expect(h.handoffs).toHaveLength(1);
  });

  it("never turns a page: a walk with another page available parks instead of reading on", async () => {
    const h = harness(
      [
        { bodies: [`${CANARY} 1`], page: 1, last: 3 },
        { bodies: [`${CANARY} 2`], page: 2, last: 3 },
      ],
      { opensTargetPageItself: true },
    );
    h.link.client({ kind: "aw_command", command: startRun() });
    await h.session.whenSettled();
    // One page read automatically; the SECOND is a page turn, and that is the seller's.
    expect(h.driver.reads).toBe(1);
    expect(latestView(h.link.frames).status).toBe("WAITING_FOR_HUMAN");
    expect(h.handoffs).toHaveLength(0);
  });

  it("a binding that resolves to nothing fails before anything is read", async () => {
    const h = harness([{ bodies: [`${CANARY} 1`], page: 1, last: 1 }], {
      opensTargetPageItself: true,
      resolved: null,
    });
    h.link.client({ kind: "aw_command", command: startRun() });
    await h.session.whenSettled();
    expect(h.driver.reads).toBe(0);
    expect(latestView(h.link.frames).status).toBe("FAILED");
  });
});
