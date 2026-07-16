/**
 * Hermetic tests for the GATED live NAVER Action Window entrypoint (`src/cli/run-action-window-live-naver.ts`).
 * NO browser, NO live NAVER, NO network — importing the module launches nothing (`main()` is guarded by
 * the `import.meta.url` check). Covers: the pure refusal gate (approval flag + production hard-gate), the
 * downstream-deps assembly, the `driveOneRun` operator-command orchestration over an in-process loopback
 * with a FAKE ProbeDriver (the real live driver needs a `Page` and is proven in the browser suite), and
 * the module source guard (right imports, no legacy capture / upload client, no target click / no
 * simulated user action, `main()` invoked only when run directly).
 */
import { describe, it, expect, afterEach } from "vitest";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  liveRunRefusal,
  buildLiveRunDeps,
  declinedIngestGuard,
  driveOneRun,
  LiveRunOperatorClient,
  PRODUCTION_REFUSAL,
  CLASSIFY_ONLY_EXIT_CODE,
  confirmPrompt,
} from "../../src/cli/run-action-window-live-naver";
import {
  APPROVAL_FLAG,
  CLASSIFY_ONLY_FLAGS,
  NO_INGEST_FLAG,
  approvalRequiredMessage,
  classifyOnlyMisuseMessage,
} from "../../src/cli/live-run-approval";
import { loadConfig } from "../../src/config";
import { getLogSink, clearLogSink } from "../../src/log";
import { defaultQuarantineDirFor } from "../../src/action-window/quarantine";
import { defaultOperationRunDirFor } from "../../src/action-window/run-store";
import { NAVER_CHANNEL_CODE, NAVER_RUN_COPY_KEY } from "../../src/action-window/naver-surface";
import { createLoopbackChannel } from "../../../contracts/action-window/v1/transport";
import { createPersistentRunSession } from "../../src/action-window/run-lifecycle";
import { loadOperationRun } from "../../src/action-window/run-store";
import type { ProbeDriver } from "../../src/action-window/session";
import type { SurfaceProbeResult } from "../../src/action-window/engine";

const HEX16 = /^[0-9a-f]{16}$/;
const SIG = "a1b2c3d4e5f60718";
const REF = "0f1e2d3c4b5a6978";

describe("run-action-window-live-naver — refusal gate (pure)", () => {
  it("no approval flag → refused with the approval message (exit 3)", () => {
    expect(liveRunRefusal([], {})).toEqual({ reason: approvalRequiredMessage(), exitCode: 3 });
  });

  it("approved + non-production → permitted (null)", () => {
    expect(liveRunRefusal([APPROVAL_FLAG], {})).toBeNull();
  });

  it("approved but NODE_ENV=production → refused (exit 4), never launches", () => {
    expect(liveRunRefusal([APPROVAL_FLAG], { NODE_ENV: "production" })).toEqual({
      reason: PRODUCTION_REFUSAL,
      exitCode: 4,
    });
  });

  it(`approved + ${NO_INGEST_FLAG} → permitted (it is a policy, not a gate)`, () => {
    expect(liveRunRefusal([APPROVAL_FLAG, NO_INGEST_FLAG], {})).toBeNull();
  });
});

/**
 * The classify-only flags were parsed, unit-tested, documented — and this CLI never imported them, so
 * `--no-upload --i-understand-this-opens-live-naver` performed a full live run INCLUDING a real
 * upload. They are now refused rather than ignored: the Action Window has no classify step, and
 * redefining a no-click flag into a click-and-capture one would move the footgun, not remove it.
 */
describe("run-action-window-live-naver — classify-only flags are refused, never ignored", () => {
  // Looped over the exported array, not hardcoded: a future third alias is refused automatically
  // instead of silently reopening the exact hole this closes.
  for (const flag of CLASSIFY_ONLY_FLAGS) {
    it(`approved + ${flag} → refused (exit ${CLASSIFY_ONLY_EXIT_CODE}), never launches`, () => {
      expect(liveRunRefusal([APPROVAL_FLAG, flag], {})).toEqual({
        reason: classifyOnlyMisuseMessage(),
        exitCode: CLASSIFY_ONLY_EXIT_CODE,
      });
    });
  }

  it("the approval gate still dominates: a classify-only flag without approval → exit 3", () => {
    expect(liveRunRefusal([...CLASSIFY_ONLY_FLAGS], {})).toEqual({
      reason: approvalRequiredMessage(),
      exitCode: 3,
    });
  });

  it("the refusal points at --no-ingest without promising a no-click run", () => {
    const msg = classifyOnlyMisuseMessage();
    expect(msg).toContain(NO_INGEST_FLAG);
    // The whole point: someone reaching for --classify-only expects "nothing happens". Correct that.
    expect(msg).toMatch(/still opens a live NAVER session/i);
    expect(msg).toMatch(/real export action/i);
    expect(msg).toMatch(/real file still lands in quarantine/i);
    // …and name the lever that IS non-mutating by construction.
    expect(msg).toMatch(/do not act/i);
  });
});

describe("run-action-window-live-naver — downstream deps assembly (pure, no browser)", () => {
  it("derives the gitignored dirs + the NAVER run config, and an injected ingest fn", () => {
    const cfg = loadConfig({}); // defaults only — no env, no creds beyond dev demo
    const root = "/tmp/collector-root-unused";
    const deps = buildLiveRunDeps(cfg, root);

    expect(deps.quarantineDir).toBe(defaultQuarantineDirFor(root));
    expect(deps.persistDir).toBe(defaultOperationRunDirFor(root));
    expect(deps.runConfig.channelCode).toBe(NAVER_CHANNEL_CODE);
    expect(deps.runConfig.runCopyKey).toBe(NAVER_RUN_COPY_KEY);
    expect(deps.runConfig.runId).toMatch(/^run_[0-9a-f]{12}$/);
    expect(typeof deps.ingest).toBe("function");
    expect(deps.observeTimeoutMs).toBeGreaterThan(0);
    expect(deps.downloadTimeoutMs).toBeGreaterThan(0);
  });

  it("defaults to ingesting — the flag is opt-IN, so live behaviour is unchanged without it", () => {
    expect(buildLiveRunDeps(loadConfig({}), "/tmp/collector-root-unused").declineIngest).toBe(false);
  });

  it("under --no-ingest the real uploader is never CONSTRUCTED — the guard cannot upload", async () => {
    const deps = buildLiveRunDeps(loadConfig({}), "/tmp/collector-root-unused", { declineIngest: true });
    expect(deps.declineIngest).toBe(true);
    // Barrier 2. The session declines before reaching this seam; if it ever did reach it, it must be
    // loud rather than quietly upload. Reaching this is a programming error, not a run outcome.
    await expect(async () =>
      deps.ingest({ bytes: () => new Uint8Array([1, 2, 3]), artifactRef: REF }),
    ).rejects.toThrow(/must decline before this seam/i);
  });

  it("declinedIngestGuard closes over no credentials and reaches no backend", () => {
    // A guard built with no config at all still behaves identically — it has nothing to upload with.
    expect(() => declinedIngestGuard()({ bytes: () => new Uint8Array(), artifactRef: REF })).toThrow();
  });
});

/**
 * A hermetic ProbeDriver whose `waitForUserAction` resolves immediately (stands in for the seller
 * having performed the real action) — so `driveOneRun`'s command orchestration can be tested without a
 * browser. It records call order to prove the full loop ran. It exposes NO `simulateUserAction`; the
 * driver decides when the action is observed, exactly like the real live driver.
 */
class FakeProbeDriver implements ProbeDriver {
  readonly calls: string[] = [];
  constructor(private readonly surface: boolean | SurfaceProbeResult = true) {}
  async prepareSurface(): Promise<boolean | SurfaceProbeResult> {
    this.calls.push("prepare");
    return this.surface;
  }
  async locate(): Promise<{ count: number; sig?: string }> {
    this.calls.push("locate");
    return { count: 1, sig: SIG };
  }
  async highlight(): Promise<void> {
    this.calls.push("highlight");
  }
  async armObserve(): Promise<void> {
    this.calls.push("armObserve");
  }
  async waitForUserAction(): Promise<boolean> {
    this.calls.push("observe");
    return true;
  }
  async verify(): Promise<{ verified: boolean; drift: boolean }> {
    this.calls.push("verify");
    return { verified: true, drift: false };
  }
  async detectDownload(): Promise<{ detected: boolean; artifactRef?: string }> {
    this.calls.push("detect");
    return { detected: true, artifactRef: REF };
  }
  async validateArtifact(): Promise<{ valid: boolean }> {
    this.calls.push("validate");
    return { valid: true };
  }
  async ingest(): Promise<{ ok: boolean; processed: number }> {
    this.calls.push("ingest");
    return { ok: true, processed: 1 };
  }
  async cleanup(): Promise<void> {
    this.calls.push("cleanup");
  }
}

/**
 * A driver whose `waitForUserAction` resolves only when the test says so — the REAL live timing, in
 * which the seller acts SECONDS after the barrier is reached. `FakeProbeDriver` resolves immediately,
 * i.e. while the run is still parked, and that timing is precisely what hid the observation defect:
 * every existing test reported the action at a moment the live path can never reproduce.
 */
class DeferredActionProbeDriver extends FakeProbeDriver {
  private resolveAction: ((observed: boolean) => void) | null = null;
  override async waitForUserAction(): Promise<boolean> {
    this.calls.push("observe");
    return new Promise<boolean>((resolve) => {
      this.resolveAction = resolve;
    });
  }
  /** The seller acts, late. Mirrors a real observation; the Runtime still never simulates the click. */
  completeUserAction(observed = true): void {
    this.resolveAction?.(observed);
    this.resolveAction = null;
  }
}

const eventTypes = (client: LiveRunOperatorClient): string[] =>
  client.serverFrames.flatMap((f) => (f.kind === "aw_event" ? [f.event.type] : []));

describe("run-action-window-live-naver — the human barrier is real (regression: observation was never recorded live)", () => {
  const dirs: string[] = [];
  afterEach(() => {
    while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
  });

  const openRun = (driver: ProbeDriver, runId: string) => {
    const dir = mkdtempSync(join(tmpdir(), "aw-live-cli-"));
    dirs.push(dir);
    const channel = createLoopbackChannel();
    const opened = createPersistentRunSession(
      { dir, transport: channel.server, driver },
      { runId, channelCode: NAVER_CHANNEL_CODE, runCopyKey: NAVER_RUN_COPY_KEY },
    );
    opened.session.attach();
    return { opened, client: new LiveRunOperatorClient(channel.client, runId), dir, runId };
  };

  it("an action performed AFTER the barrier is still observed and recorded", async () => {
    const driver = new DeferredActionProbeDriver();
    const { opened, client, dir, runId } = openRun(driver, "run_late01late01");

    const run = driveOneRun(opened.session, client, { observeTimeoutMs: 5_000 });
    // The seller acts late — long after the run parked. Before this fix, driveOneRun had already
    // rechecked (~1 s live) and the stage had left WAIT_FOR_USER_ACTION, so this was dropped.
    setTimeout(() => driver.completeUserAction(), 20);
    const view = await run;

    expect(view?.status).toBe("COMPLETED");
    expect(eventTypes(client)).toContain("USER_ACTION_OBSERVED");
    expect(loadOperationRun(dir, runId)!.humanCheckpoint).toMatchObject({ reached: true, observed: true });
  });

  it("observe-timeout still completes on the armed download — observation never gates completion", async () => {
    // The seller's action is NEVER reported (e.g. the in-page listener was lost to an SPA re-render),
    // but the download fired. Verification is the completion authority; observation is an audit record.
    const driver = new DeferredActionProbeDriver();
    const { opened, client, dir, runId } = openRun(driver, "run_noobs1noobs1");

    const view = await driveOneRun(opened.session, client, { observeTimeoutMs: 20 });

    expect(view?.status).toBe("COMPLETED");
    expect(eventTypes(client)).not.toContain("USER_ACTION_OBSERVED");
    expect(loadOperationRun(dir, runId)!.humanCheckpoint).toMatchObject({ reached: true, observed: false });
  });
});

describe("run-action-window-live-naver — driveOneRun orchestration (loopback, fake driver, no browser)", () => {
  const dirs: string[] = [];
  afterEach(() => {
    while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
  });

  it("START_RUN → observed action → REQUEST_STEP_RECHECK drives the full loop to COMPLETED", async () => {
    const dir = mkdtempSync(join(tmpdir(), "aw-live-cli-"));
    dirs.push(dir);
    const channel = createLoopbackChannel();
    const driver = new FakeProbeDriver();
    const opened = createPersistentRunSession(
      { dir, transport: channel.server, driver },
      { runId: "run_abc123abc123", channelCode: NAVER_CHANNEL_CODE, runCopyKey: NAVER_RUN_COPY_KEY },
    );
    opened.session.attach();
    const client = new LiveRunOperatorClient(channel.client, "run_abc123abc123");

    const view = await driveOneRun(opened.session, client);

    expect(view?.status).toBe("COMPLETED");
    expect(view?.channelCode).toBe(NAVER_CHANNEL_CODE);
    expect(view?.progress).toEqual({ completedSteps: 3, totalSteps: 3 });
    // The full ordered chain ran; downstream fired exactly once each; the Runtime never simulated the action.
    expect(driver.calls).toEqual([
      "prepare",
      "locate",
      "highlight",
      "armObserve",
      "observe",
      "verify",
      "detect",
      "validate",
      "ingest",
      "cleanup",
    ]);
    const detected = client.serverFrames.filter((f) => f.kind === "aw_event" && f.event.type === "DOWNLOAD_DETECTED");
    expect(detected).toHaveLength(1);
  });

  it("a fail-closed START never issues REQUEST_STEP_RECHECK (no downstream)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "aw-live-cli-"));
    dirs.push(dir);
    const channel = createLoopbackChannel();
    // A surface we cannot recognise is not something the seller can fix → the run lands terminal at START.
    const driver = new FakeProbeDriver({ ok: false, blockerCode: "UNSUPPORTED_STATE" });
    const opened = createPersistentRunSession(
      { dir, transport: channel.server, driver },
      { runId: "run_def456def456", channelCode: NAVER_CHANNEL_CODE, runCopyKey: NAVER_RUN_COPY_KEY },
    );
    opened.session.attach();
    const client = new LiveRunOperatorClient(channel.client, "run_def456def456");

    const view = await driveOneRun(opened.session, client);

    expect(view?.status).toBe("FAILED");
    expect(view?.blocker?.code).toBe("UNSUPPORTED_STATE");
    const detected = client.serverFrames.filter((f) => f.kind === "aw_event" && f.event.type === "DOWNLOAD_DETECTED");
    expect(detected).toHaveLength(0);
  });

  /**
   * A recovery park is ALSO WAITING_FOR_HUMAN, but it is not the export barrier — nothing was located,
   * highlighted, or armed, so USER_ACTION_OBSERVED can never fire. If `driveOneRun` treated it as the
   * barrier it would burn the full 10-minute observe window on the one failure mode that used to fail
   * fast, and log an `aw.live.barrier` reading for a barrier the run never reached — corrupting the exact
   * audit line the barrier fix made truthful. These two tests are that regression proof.
   */
  it("a parked run is NOT mistaken for the export barrier — returns at once, logs no barrier reading", async () => {
    clearLogSink();
    const dir = mkdtempSync(join(tmpdir(), "aw-live-cli-"));
    dirs.push(dir);
    const channel = createLoopbackChannel();
    const driver = new FakeProbeDriver({ ok: false, blockerCode: "SESSION_EXPIRED" });
    const opened = createPersistentRunSession(
      { dir, transport: channel.server, driver },
      { runId: "run_def456def456", channelCode: NAVER_CHANNEL_CODE, runCopyKey: NAVER_RUN_COPY_KEY },
    );
    opened.session.attach();
    const client = new LiveRunOperatorClient(channel.client, "run_def456def456");

    // A 30s observe window: if the park were treated as the barrier this would block on it. The test
    // completing at all is half the assertion.
    const view = await driveOneRun(opened.session, client, { observeTimeoutMs: 30_000 });

    expect(view?.status).toBe("WAITING_FOR_HUMAN");
    expect(view?.blocker).toEqual({ code: "SESSION_EXPIRED", recoverable: true });
    // No barrier was reached, so no barrier reading may be claimed.
    expect(getLogSink().map((l) => l.event)).not.toContain("aw.live.barrier");
    const recheck = client.serverFrames.filter((f) => f.kind === "aw_command_result");
    expect(recheck.some((f) => f.kind === "aw_command_result" && f.accepted === false)).toBe(false);
  });

  it("the real export barrier still logs its barrier reading — the discriminator did not disable the default path", async () => {
    clearLogSink();
    const dir = mkdtempSync(join(tmpdir(), "aw-live-cli-"));
    dirs.push(dir);
    const channel = createLoopbackChannel();
    const driver = new FakeProbeDriver();
    const opened = createPersistentRunSession(
      { dir, transport: channel.server, driver },
      { runId: "run_abc123abc123", channelCode: NAVER_CHANNEL_CODE, runCopyKey: NAVER_RUN_COPY_KEY },
    );
    opened.session.attach();
    const client = new LiveRunOperatorClient(channel.client, "run_abc123abc123");

    await driveOneRun(opened.session, client, { observeTimeoutMs: 50 });

    expect(getLogSink().map((l) => l.event)).toContain("aw.live.barrier");
  });
});

/**
 * `--no-ingest` (D-027): the run detects and validates a real artifact, then declines the handoff.
 * The contract has no terminal for "validated but not ingested" — COMPLETED is reachable only via a
 * real successful ingest, and every reserved blocker code would be a lie — so the run lands CANCELLED
 * with the downstream step SKIPPED, which is what actually happened.
 */
describe("run-action-window-live-naver — --no-ingest declines the handoff (D-027)", () => {
  const dirs: string[] = [];
  afterEach(() => {
    while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
  });

  const openRun = (driver: ProbeDriver, runId: string, declineIngest: boolean) => {
    const dir = mkdtempSync(join(tmpdir(), "aw-live-cli-"));
    dirs.push(dir);
    const channel = createLoopbackChannel();
    const opened = createPersistentRunSession(
      { dir, transport: channel.server, driver, declineIngest },
      { runId, channelCode: NAVER_CHANNEL_CODE, runCopyKey: NAVER_RUN_COPY_KEY },
    );
    opened.session.attach();
    return { opened, client: new LiveRunOperatorClient(channel.client, runId), dir, runId };
  };

  it("DEFAULT-OFF: without the policy the full loop still ingests and COMPLETES", async () => {
    // The proof that A1 changes no live behaviour by default.
    const driver = new FakeProbeDriver();
    const { opened, client } = openRun(driver, "run_deflt1deflt1", false);

    const view = await driveOneRun(opened.session, client);

    expect(view?.status).toBe("COMPLETED");
    expect(driver.calls).toContain("ingest");
    expect(view?.progress).toEqual({ completedSteps: 3, totalSteps: 3 });
  });

  it("validate completes, ingest is NEVER called, and the run lands CANCELLED at 2 of 3", async () => {
    const driver = new FakeProbeDriver();
    const { opened, client } = openRun(driver, "run_noing1noing1", true);

    const view = await driveOneRun(opened.session, client);

    // The whole point of A1: the seam is not entered at all.
    expect(driver.calls).not.toContain("ingest");
    // …but everything BEFORE it did run — this is not a refusal to start.
    expect(driver.calls).toEqual(["prepare", "locate", "highlight", "armObserve", "observe", "verify", "detect", "validate", "cleanup"]);
    expect(view?.status).toBe("CANCELLED");
    expect(view?.progress).toEqual({ completedSteps: 2, totalSteps: 3 });
    expect(view?.currentStep?.status).toBe("SKIPPED");
    // Nothing is broken, so nothing is blocked. A blocker here would be a lie.
    expect(view?.blocker).toBeUndefined();
    expect(view?.allowedCommands).toEqual([]);
  });

  it("fabricates neither success nor failure", async () => {
    const driver = new FakeProbeDriver();
    const { opened, client } = openRun(driver, "run_nofab1nofab1", true);

    await driveOneRun(opened.session, client);

    const types = eventTypes(client);
    expect(types).toContain("DOWNLOAD_DETECTED"); // a real artifact WAS detected and validated
    expect(types).not.toContain("RUN_COMPLETED"); // …and no synthetic completion was invented
    expect(types).not.toContain("RUN_FAILED");
    expect(types).not.toContain("RUN_BLOCKED");
    expect(types).toContain("RUN_STATUS_CHANGED");
  });

  it("still drives CLEANUP exactly once — leak-safety does not depend on ingest running", async () => {
    const driver = new FakeProbeDriver();
    const { opened, client } = openRun(driver, "run_clean1clean1", true);

    await driveOneRun(opened.session, client);

    expect(driver.calls.filter((c) => c === "cleanup")).toHaveLength(1);
    expect(driver.calls[driver.calls.length - 1]).toBe("cleanup");
  });

  it("the persisted record shows a run stopped AFTER validate — a reader can tell what happened", async () => {
    // CANCELLED flattens policy-decline and operator-cancel on the wire. The record does not: a
    // barrier cancel would show completedSteps 1 and no DOWNLOAD_DETECTED.
    const driver = new FakeProbeDriver();
    const { opened, client, dir, runId } = openRun(driver, "run_recrd1recrd1", true);

    await driveOneRun(opened.session, client);

    const rec = loadOperationRun(dir, runId)!;
    expect(rec.resumeState).toBe("TERMINAL"); // never resumable into the ingest it just declined
    expect(rec.humanCheckpoint).toMatchObject({ reached: true, observed: true });
    expect(rec.engine.events.map((e) => e.type)).toContain("DOWNLOAD_DETECTED");
    expect(rec.engine.events.map((e) => e.type)).not.toContain("RUN_COMPLETED");
  });
});

describe("confirmPrompt — the prose a seated human reads mid-run (D-025, D-027)", () => {
  // This prompt was unexported and unasserted until D-025, and it rotted: through Run 5 it still
  // instructed the operator to confirm the dialog and quoted a single ~60 s budget that `40d7c53`
  // had already made false. These lock the invariants that rotted, so the next drift fails here
  // rather than in front of a seated human holding a single-use approval.
  //
  // It is now a FUNCTION of the run's ingest policy (D-027): it used to assert "there is no
  // no-ingest mode", which `--no-ingest` made false. What the human is told about the fate of their
  // data is derived from what THIS run will do — the same rule the timings already follow.
  const DEFAULT_PROMPT = confirmPrompt(false);
  const NO_INGEST_PROMPT = confirmPrompt(true);

  it("states the period/scope step as the operator's own, unenforced by the Runtime", () => {
    // Under D-025 period/scope is a guidance-only §4 human precondition — the gate answers
    // exportability, never scope. This line is the ONLY thing carrying that obligation, and Run 5's
    // operator skipped it with nothing noticing. It must be prominent, not buried in a sub-bullet.
    expect(DEFAULT_PROMPT).toMatch(/SELECT THE REVIEW PERIOD \/ SCOPE YOURSELF/);
    expect(DEFAULT_PROMPT).toMatch(/nothing enforces it/i);
    expect(DEFAULT_PROMPT).toMatch(/never sets, requires, or checks it/i);
  });

  it("describes TWO windows and never restates a timing in prose", () => {
    // The two-window budget is live-confirmed (§8-18: the download deadline starts at the human's
    // action, not at the highlight). Both numbers are interpolated from the constants above, so a
    // timer change can never leave the operator reading a stale one.
    expect(DEFAULT_PROMPT).toMatch(/TWO windows, not one/);
    expect(DEFAULT_PROMPT).toMatch(/10 MINUTES from the highlight/);
    expect(DEFAULT_PROMPT).toMatch(/60 SECONDS from YOUR action/);
    // The exact stale sentence this replaced must never come back.
    expect(/From the moment the highlight appears you have about 60 SECONDS/.test(DEFAULT_PROMPT)).toBe(false);
  });

  it("defers the confirm decision to the run's approved scope instead of hardcoding it", () => {
    // The prompt is shared across run scopes: Run 5 was act-but-never-confirm, the export pilot is
    // act + confirm + ingest. Telling every operator to confirm is wrong for the former — it is
    // what the stale text did, and it contradicted the very run it was printed for.
    expect(DEFAULT_PROMPT).toMatch(/defined by THIS RUN'S\n?APPROVED SCOPE/);
    expect(/manually confirm the expected NAVER confirmation dialog/.test(DEFAULT_PROMPT)).toBe(false);
  });

  it("by default, warns that a validated download is ingested — and never claims that is the ONLY mode", () => {
    // The default path is unchanged: VALIDATE→INGEST, real and irreversible. The human must know
    // that before acting. But the old absolute ("there is no no-ingest mode") is now false, and a
    // prompt that lies to a seated human about the fate of their data is the worst place to be stale.
    expect(DEFAULT_PROMPT).toMatch(/is INGESTED into SellerOps/i);
    expect(DEFAULT_PROMPT).toMatch(/real and irreversible/i);
    expect(DEFAULT_PROMPT).not.toMatch(/there is no no-ingest mode/i);
  });

  it("under --no-ingest, promises no write — and refuses to let that read as no-click", () => {
    expect(NO_INGEST_PROMPT).toMatch(/THIS RUN IS --no-ingest/);
    expect(NO_INGEST_PROMPT).toMatch(/DISCARDED/);
    expect(NO_INGEST_PROMPT).toMatch(/nothing is written to SellerOps/i);
    // The correction that matters: --no-ingest is strictly MORE mutating than not acting.
    expect(NO_INGEST_PROMPT).toMatch(/NOT a no-click run/i);
    expect(NO_INGEST_PROMPT).toMatch(/your action is real/i);
    expect(NO_INGEST_PROMPT).toMatch(/real file lands/i);
    // It must never claim the ingest it is declining.
    expect(NO_INGEST_PROMPT).not.toMatch(/is INGESTED into SellerOps/i);
  });

  it("names the by-construction lever in BOTH modes — not acting is what is truly non-mutating", () => {
    for (const prompt of [DEFAULT_PROMPT, NO_INGEST_PROMPT]) {
      expect(prompt).toMatch(/non-mutating BY CONSTRUCTION, do not act/i);
      expect(prompt).toMatch(/let window 2\n?lapse/i);
    }
  });

  it("still tells the operator the Runtime never acts for them, and fails closed — in BOTH modes", () => {
    for (const prompt of [DEFAULT_PROMPT, NO_INGEST_PROMPT]) {
      expect(prompt).toMatch(/it never acts for you/i);
      expect(prompt).toMatch(/fails closed/i);
      expect(prompt).toMatch(/this run's approval is spent/i);
    }
  });
});

describe("run-action-window-live-naver — module source guard", () => {
  const srcPath = resolve(dirname(fileURLToPath(import.meta.url)), "../../src/cli/run-action-window-live-naver.ts");
  const raw = readFileSync(srcPath, "utf8");
  const stripComments = (code: string): string =>
    code
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .split("\n")
      .filter((line) => !/^\s*(\/\/|\*)/.test(line))
      .join("\n");
  const code = stripComments(raw);
  const importStatements = code.match(/import[\s\S]*?from\s*["'][^"']+["']/g) ?? [];

  it("is gated and wires the live driver + engine seams", () => {
    expect(importStatements.some((s) => /\.\/live-run-approval/.test(s))).toBe(true);
    expect(importStatements.some((s) => /naver-live-driver/.test(s))).toBe(true);
    expect(importStatements.some((s) => /run-lifecycle/.test(s))).toBe(true);
    expect(/createLoopbackChannel/.test(code)).toBe(true);
    expect(/hasLiveRunApproval/.test(code)).toBe(true);
  });

  it("never clicks the target and never simulates a user action", () => {
    expect(/\.click\s*\(/.test(code)).toBe(false);
    expect(/simulateUserAction/.test(code)).toBe(false);
    expect(/dispatchEvent\s*\(/.test(code)).toBe(false);
    expect(/\.tap\s*\(/.test(code)).toBe(false);
  });

  it("CONSUMES every argv flag it recognises — none may be silently discarded again", () => {
    // The A1 footgun in structural form: `isClassifyOnly` existed, was exported, was unit-tested, and
    // this module simply never imported it — so `--no-upload` was discarded and the run uploaded
    // anyway. A green unit test on a predicate proves nothing about the caller. This is the lock.
    expect(/isClassifyOnly/.test(code)).toBe(true);
    expect(/hasNoIngest/.test(code)).toBe(true);
    // Both must be reachable from the pure gate / deps builder, not merely imported and unused.
    expect(/classifyOnlyMisuseMessage/.test(code)).toBe(true);
    expect(/declineIngest/.test(code)).toBe(true);
  });

  it("imports no legacy capture path and no upload client", () => {
    const banned = [
      /review-export/,
      /runExport/,
      /buildTriggerSelectors/,
      /capture-export-same-session/,
      /review-download-save/,
      /review-upload-diagnostic/,
      /live-export-target-probe/,
      /\.\.\/upload/,
    ];
    for (const statement of importStatements) {
      for (const re of banned) {
        expect(re.test(statement), `banned import :: ${re} :: ${statement.replace(/\s+/g, " ")}`).toBe(false);
      }
    }
  });

  it("invokes main() only when run directly (import launches nothing)", () => {
    expect(/import\.meta\.url\s*===\s*pathToFileURL/.test(code)).toBe(true);
  });

  /**
   * The evidence surface a live run emits. `main()` needs a real browser, so the emission itself is
   * asserted structurally here; the diagnostic's enums-only SHAPE is proven in `naver-driver.test.ts`.
   * Without the readiness line every readiness HALT is indistinguishable on the wire (all flatten to
   * UNSUPPORTED_STATE), which is what left the period/scope step unobservable.
   */
  it("emits the barrier + readiness evidence a live run is judged on", () => {
    expect(/log\("aw\.live\.barrier",\s*\{\s*observed\s*\}\)/.test(code)).toBe(true);
    expect(/log\("aw\.live\.readiness"/.test(code)).toBe(true);
    expect(/prepareDiagnostic\(\)/.test(code)).toBe(true);
  });
});
