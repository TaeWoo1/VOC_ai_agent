/**
 * **Action Window synthetic E2E (R2).** Drives the FE↔Runtime integration through the loopback
 * transport with NO browser and NO Bridge server: a frame-level FE client on one end, the real
 * `ActionWindowSession` + pure engine + `SyntheticProbeDriver` on the other. This is the offline,
 * deterministic proof of the whole command/event/view loop plus the transport-level invariants
 * (stale/duplicate/pause/resume/cancel/reconnect/privacy). The real-browser variant is
 * `session-browser.test.ts` (RUN_INTEGRATION).
 */
import { describe, it, expect } from "vitest";
import {
  ACTION_WINDOW_PROTOCOL_VERSION,
  findProhibitedFields,
  isDuplicateEvent,
  isOutOfOrderEvent,
  validateEventEnvelope,
  validateRunView,
  type ActionWindowRunView,
  type CommandEnvelope,
  type CommandType,
  type EventEnvelope,
} from "../../../contracts/action-window/v1/index";
import {
  createLoopbackChannel,
  type AwClientTransport,
  type AwServerFrame,
} from "../../../contracts/action-window/v1/transport";
import { ActionWindowEngine } from "../../src/action-window/engine";
import { ActionWindowSession, SyntheticProbeDriver, type ProbeDriver } from "../../src/action-window/session";

const RUN_ID = "run_e2e";
const CHANNEL = "synthetic";
const RUN_COPY = "actionWindow.run.synthetic";

/**
 * A minimal frame-level FE client. Mirrors what the real `frontend` Bridge adapter does — build a
 * contract command envelope from the latest view, send it, and fold received events/views into local
 * state — but lives here so this test is authoritative at the wire and independent of the FE package.
 */
class FeClient {
  view: ActionWindowRunView | null = null;
  events: EventEnvelope[] = [];
  allServerFrames: AwServerFrame[] = [];
  commandResults: Array<{ commandId: string; accepted: boolean; reason?: string }> = [];
  private lastSequence = 0;
  private seenEventIds = new Set<string>();
  private cmdSeq = 0;
  private detachFn: (() => void) | null = null;

  constructor(private readonly transport: AwClientTransport) {}

  attach(): void {
    if (this.detachFn) return;
    this.detachFn = this.transport.subscribe((frame) => this.onServerFrame(frame));
  }
  detach(): void {
    this.detachFn?.();
    this.detachFn = null;
  }

  private onServerFrame(frame: AwServerFrame): void {
    this.allServerFrames.push(frame);
    switch (frame.kind) {
      case "aw_event":
        this.ingestEvent(frame.event);
        break;
      case "aw_view":
        this.adoptView(frame.view);
        break;
      case "aw_command_result":
        this.commandResults.push({ commandId: frame.commandId, accepted: frame.accepted, reason: frame.reason });
        break;
      case "aw_resync_result":
        if (frame.view) this.adoptView(frame.view);
        for (const e of frame.events) this.ingestEvent(e);
        break;
    }
  }

  private ingestEvent(e: EventEnvelope): void {
    if (isDuplicateEvent(e.eventId, this.seenEventIds)) return;
    if (isOutOfOrderEvent(e.sequence, this.lastSequence)) return;
    this.seenEventIds.add(e.eventId);
    this.lastSequence = e.sequence;
    this.events.push(e);
  }
  private adoptView(v: ActionWindowRunView): void {
    if (this.view === null || v.revision >= this.view.revision) this.view = v;
  }

  send(type: CommandType, payload?: CommandEnvelope["payload"]): void {
    this.sendRaw({
      protocolVersion: ACTION_WINDOW_PROTOCOL_VERSION,
      commandId: `${RUN_ID}-c${++this.cmdSeq}`,
      runId: RUN_ID,
      expectedRevision: this.view?.revision ?? 0,
      type,
      ...(payload ? { payload } : {}),
    });
  }
  sendRaw(command: CommandEnvelope): void {
    this.transport.send({ kind: "aw_command", command });
  }
  resync(): void {
    this.transport.send({ kind: "aw_resync", runId: RUN_ID, sinceSequence: this.lastSequence });
  }

  eventTypes(): string[] {
    return this.events.map((e) => e.type);
  }
}

function wire(driver: ProbeDriver): { fe: FeClient; session: ActionWindowSession } {
  const channel = createLoopbackChannel();
  const engine = new ActionWindowEngine({ runId: RUN_ID, channelCode: CHANNEL, runCopyKey: RUN_COPY });
  const session = new ActionWindowSession(engine, driver, channel.server);
  session.attach();
  const fe = new FeClient(channel.client);
  fe.attach();
  return { fe, session };
}

/** Every view/event the FE ever received must be contract-valid and carry no prohibited field. */
function assertSanitized(fe: FeClient): void {
  for (const frame of fe.allServerFrames) {
    expect(findProhibitedFields(frame)).toEqual([]);
    if (frame.kind === "aw_event") expect(validateEventEnvelope(frame.event)).toEqual({ ok: true });
    if (frame.kind === "aw_view") expect(validateRunView(frame.view)).toEqual({ ok: true });
    if (frame.kind === "aw_resync_result") {
      if (frame.view) expect(validateRunView(frame.view)).toEqual({ ok: true });
      for (const e of frame.events) expect(validateEventEnvelope(e)).toEqual({ ok: true });
    }
  }
}

describe("Action Window R2 synthetic E2E (FE ↔ loopback ↔ Runtime)", () => {
  it("runs the full loop: start → checkpoint → user click → recheck → verify → downstream → completed", async () => {
    const driver = new SyntheticProbeDriver();
    const { fe, session } = wire(driver);

    // 1) FE starts the run; Runtime drives to the human checkpoint and stops.
    fe.send("START_RUN", { channelCode: CHANNEL });
    await session.whenSettled();

    expect(fe.view?.status).toBe("WAITING_FOR_HUMAN");
    expect(fe.view?.executionMode).toBe("ACTION_WINDOW");
    expect(fe.view?.currentStep?.status).toBe("AWAITING_USER");
    expect(fe.view?.allowedCommands).toContain("REQUEST_STEP_RECHECK");
    expect(fe.eventTypes()).toEqual([
      "RUN_STARTED",
      "RUN_STATUS_CHANGED", // PREPARING
      "RUN_STATUS_CHANGED", // RUNNING
      "STEP_READY",
      "HUMAN_ACTION_REQUIRED",
      "TARGET_HIGHLIGHTED",
      "RUN_STATUS_CHANGED", // WAITING_FOR_HUMAN
    ]);
    // The highlighted target is an opaque 16-hex ref, never a selector.
    const highlight = fe.events.find((e) => e.type === "TARGET_HIGHLIGHTED");
    expect(highlight?.payload.targetRef).toMatch(/^[0-9a-f]{16}$/);

    // 2) The USER acts (the session never clicks). Observation ≠ completion.
    driver.completeUserAction(true);
    await session.whenSettled();
    expect(fe.eventTypes()).toContain("USER_ACTION_OBSERVED");
    expect(fe.view?.status).toBe("WAITING_FOR_HUMAN"); // still waiting — a click is only an observation

    // 3) FE requests recheck; Runtime verifies, runs downstream, completes.
    fe.send("REQUEST_STEP_RECHECK");
    await session.whenSettled();

    expect(fe.view?.status).toBe("COMPLETED");
    expect(fe.view?.executionMode).toBe("AUTOMATIC_OPERATION");
    expect(fe.view?.progress).toEqual({ completedSteps: 3, totalSteps: 3 });
    expect(fe.view?.blocker).toBeUndefined();
    expect(fe.view?.allowedCommands).toEqual([]);
    expect(fe.eventTypes().filter((t) => t === "STEP_COMPLETED")).toHaveLength(2);
    expect(fe.eventTypes()).toContain("RUN_COMPLETED");
    // The downstream chain ran and reported the artifact as an opaque 16-hex ref only.
    const detected = fe.events.find((e) => e.type === "DOWNLOAD_DETECTED");
    expect(detected?.payload.artifactRef).toMatch(/^[0-9a-f]{16}$/);

    // Ordering: strictly monotonic sequence, no gaps, no duplicates.
    const seqs = fe.events.map((e) => e.sequence);
    expect(seqs).toEqual(seqs.map((_, i) => i + 1));

    assertSanitized(fe);
  });

  it("never completes from observation alone (Runtime never clicks the target)", async () => {
    const driver = new SyntheticProbeDriver();
    const { fe, session } = wire(driver);
    fe.send("START_RUN", { channelCode: CHANNEL });
    await session.whenSettled();

    // No user action reported yet → must remain at the human checkpoint, never COMPLETED.
    expect(fe.eventTypes()).not.toContain("USER_ACTION_OBSERVED");
    expect(fe.eventTypes()).not.toContain("STEP_COMPLETED");
    expect(fe.view?.status).toBe("WAITING_FOR_HUMAN");
  });

  it("rejects a stale-revision command", async () => {
    const driver = new SyntheticProbeDriver();
    const { fe, session } = wire(driver);
    fe.send("START_RUN", { channelCode: CHANNEL });
    await session.whenSettled();

    const staleRevision = (fe.view?.revision ?? 0) - 1;
    fe.sendRaw({
      protocolVersion: ACTION_WINDOW_PROTOCOL_VERSION,
      commandId: "stale-1",
      runId: RUN_ID,
      expectedRevision: staleRevision,
      type: "SET_GUIDANCE_ENABLED",
      payload: { enabled: false },
    });
    await session.whenSettled();

    const result = fe.commandResults.find((r) => r.commandId === "stale-1");
    expect(result).toEqual({ commandId: "stale-1", accepted: false, reason: "STALE_REVISION" });
    expect(fe.view?.guidanceEnabled).toBe(true); // unchanged
  });

  it("treats a replayed commandId as an idempotent no-op", async () => {
    const driver = new SyntheticProbeDriver();
    const { fe, session } = wire(driver);
    fe.send("START_RUN", { channelCode: CHANNEL });
    await session.whenSettled();

    const cmd: CommandEnvelope = {
      protocolVersion: ACTION_WINDOW_PROTOCOL_VERSION,
      commandId: "dup-1",
      runId: RUN_ID,
      expectedRevision: fe.view?.revision ?? 0,
      type: "SET_GUIDANCE_ENABLED",
      payload: { enabled: false },
    };
    fe.sendRaw(cmd);
    await session.whenSettled();
    const revAfterFirst = fe.view?.revision;
    expect(fe.view?.guidanceEnabled).toBe(false);

    fe.sendRaw(cmd); // same commandId
    await session.whenSettled();
    const dupResults = fe.commandResults.filter((r) => r.commandId === "dup-1");
    expect(dupResults).toHaveLength(2);
    expect(dupResults.every((r) => r.accepted)).toBe(true); // duplicate is an accepted no-op
    expect(fe.view?.revision).toBe(revAfterFirst); // no second state mutation
  });

  it("pauses and resumes back to the human checkpoint", async () => {
    const driver = new SyntheticProbeDriver();
    const { fe, session } = wire(driver);
    fe.send("START_RUN", { channelCode: CHANNEL });
    await session.whenSettled();

    fe.send("PAUSE_RUN");
    await session.whenSettled();
    expect(fe.view?.status).toBe("PAUSED");
    expect(fe.view?.allowedCommands).toContain("RESUME_RUN");

    fe.send("RESUME_RUN");
    await session.whenSettled();
    expect(fe.view?.status).toBe("WAITING_FOR_HUMAN");

    // The loop still completes normally after resume.
    driver.completeUserAction(true);
    await session.whenSettled();
    fe.send("REQUEST_STEP_RECHECK");
    await session.whenSettled();
    expect(fe.view?.status).toBe("COMPLETED");
    assertSanitized(fe);
  });

  it("cancels and cleans up", async () => {
    const driver = new SyntheticProbeDriver();
    let cleanups = 0;
    driver.cleanup = () => {
      cleanups += 1;
      return Promise.resolve();
    };
    const { fe, session } = wire(driver);
    fe.send("START_RUN", { channelCode: CHANNEL });
    await session.whenSettled();

    fe.send("CANCEL_RUN");
    await session.whenSettled();
    expect(fe.view?.status).toBe("CANCELLED");
    expect(fe.view?.allowedCommands).toEqual([]);
    expect(cleanups).toBeGreaterThanOrEqual(1);
  });

  it("restores the latest Run View on reconnect (missed events replayed)", async () => {
    const driver = new SyntheticProbeDriver();
    const { fe, session } = wire(driver);
    fe.send("START_RUN", { channelCode: CHANNEL });
    await session.whenSettled();
    const seqBeforeDisconnect = fe.events[fe.events.length - 1]!.sequence;

    // Disconnect: the FE detaches from the transport. Frames sent while detached are dropped.
    fe.detach();
    driver.completeUserAction(true); // Runtime emits USER_ACTION_OBSERVED while FE is offline
    await session.whenSettled();
    expect(fe.eventTypes()).not.toContain("USER_ACTION_OBSERVED"); // missed while offline

    // Reconnect: re-subscribe and resync from the last sequence seen.
    fe.attach();
    fe.resync();
    await session.whenSettled();

    expect(fe.eventTypes()).toContain("USER_ACTION_OBSERVED"); // recovered
    expect(fe.view?.status).toBe("WAITING_FOR_HUMAN");
    expect(fe.events[fe.events.length - 1]!.sequence).toBeGreaterThan(seqBeforeDisconnect);
    assertSanitized(fe);
  });

  it("fails closed on an ambiguous target and surfaces only a blocker code", async () => {
    const driver = new SyntheticProbeDriver({ locate: { count: 2 } });
    const { fe, session } = wire(driver);
    fe.send("START_RUN", { channelCode: CHANNEL });
    await session.whenSettled();

    expect(fe.view?.status).toBe("FAILED");
    expect(fe.view?.blocker?.code).toBe("TARGET_AMBIGUOUS");
    expect(fe.eventTypes()).toContain("RUN_FAILED");
    expect(fe.eventTypes()).not.toContain("USER_ACTION_OBSERVED"); // never reached the human step
    assertSanitized(fe);
  });
});
