/**
 * Hermetic tests for the GATED live NAVER Action Window entrypoint (`instruments/live-runs/run-action-window-live-naver.ts`).
 * NO browser, NO live NAVER, NO network — importing the module launches nothing (`main()` is guarded by
 * the `import.meta.url` check). Covers: the pure refusal gate (approval flag + production hard-gate), the
 * downstream-deps assembly, the `driveOneRun` operator-command orchestration over an in-process loopback
 * with a FAKE ProbeDriver (the real live driver needs a `Page` and is proven in the browser suite), and
 * the module source guard (right imports, no legacy capture / upload client, no target click / no
 * simulated user action, `main()` invoked only when run directly).
 */
import { describe, it, expect, afterEach } from "vitest";
import { readFileSync, mkdtempSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  liveRunRefusal,
  buildLiveRunDeps,
  declinedIngestGuard,
  driveOneRun,
  awaitFreshSentinel,
  recoveryPrompt,
  LiveRunOperatorClient,
  PRODUCTION_REFUSAL,
  CLASSIFY_ONLY_EXIT_CODE,
  confirmPrompt,
  type SentinelWait,
} from "../../instruments/live-runs/run-action-window-live-naver";
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
import type { RecoverableSurfaceBlockerCode, SurfaceProbeResult } from "../../src/action-window/engine";
import type { CommandEnvelope, CommandType } from "../../../contracts/action-window/v1/index";

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
      deps.ingest({ bytes: () => new Uint8Array([1, 2, 3]), artifactRef: REF, scopeEvidence: "MACHINE_MATCHED" }),
    ).rejects.toThrow(/must decline before this seam/i);
  });

  it("declinedIngestGuard closes over no credentials and reaches no backend", () => {
    // A guard built with no config at all still behaves identically — it has nothing to upload with.
    expect(() => declinedIngestGuard()({ bytes: () => new Uint8Array(), artifactRef: REF, scopeEvidence: "MACHINE_MATCHED" })).toThrow();
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

describe("confirmPrompt — session-recovery scope branches the FIRST prompt (§8-23 resolution)", () => {
  // Run 6 (§8-23) proved the initial prompt was the EXPORT-PILOT prose — "log in, reach the export
  // surface, then signal" — the exact opposite of the session-recovery scope, whose premise is
  // signalling WHILE LOGGED OUT so the run parks and recovers. `--session-recovery` swaps ONLY the
  // head; the ingest body and tail (proven above) stay shared. These lock that the branch is real and
  // that the export-pilot imperative can never reappear in the recovery head.
  const RECOVERY_PROMPT = confirmPrompt(false, true);
  const DEFAULT_PROMPT = confirmPrompt(false);

  it("tells the operator to signal WHILE LOGGED OUT and to expect a LOGIN_REQUIRED park", () => {
    expect(RECOVERY_PROMPT).toMatch(/SESSION-RECOVERY run/i);
    expect(RECOVERY_PROMPT).toMatch(/WHILE STILL LOGGED OUT/);
    expect(RECOVERY_PROMPT).toMatch(/PARKS on LOGIN_REQUIRED/);
    expect(RECOVERY_PROMPT).toMatch(/paused, not failed/i);
    expect(RECOVERY_PROMPT).toMatch(/signal readiness AGAIN/i);
  });

  it("NEVER carries the export-pilot 'log in first, reach the export surface' imperative", () => {
    // The exact prose §8-23 named. The recovery head says "RETURN to the review-management export
    // surface" (a post-login step), never the pilot's "1) Complete … 2) Reach …" pre-signal command.
    expect(RECOVERY_PROMPT).not.toMatch(/Reach the review-management export surface/);
    expect(RECOVERY_PROMPT).not.toMatch(/1\) Complete the NAVER-ID login/);
    // Guard the default (export-pilot) direction stays byte-for-byte what it was — no accidental drift
    // from adding the branch: the pilot imperative must still be present when the flag is absent.
    expect(DEFAULT_PROMPT).toMatch(/1\) Complete the NAVER-ID login/);
    expect(DEFAULT_PROMPT).toMatch(/2\) Reach the review-management export surface/);
    expect(DEFAULT_PROMPT).not.toMatch(/SESSION-RECOVERY run/i);
  });

  it("still threads the ingest policy under session recovery — body and tail are shared, not forked", () => {
    expect(confirmPrompt(false, true)).toMatch(/is INGESTED into SellerOps/i);
    const noIngestRecovery = confirmPrompt(true, true);
    expect(noIngestRecovery).toMatch(/THIS RUN IS --no-ingest/);
    expect(noIngestRecovery).not.toMatch(/is INGESTED into SellerOps/i);
    // The by-construction lever and fail-closed tail survive the branch.
    expect(RECOVERY_PROMPT).toMatch(/non-mutating BY CONSTRUCTION, do not act/i);
    expect(RECOVERY_PROMPT).toMatch(/fails closed/i);
  });
});

/**
 * A3 — the CLI operator recovery loop (D-029).
 *
 * A2-B made login/session blockers recoverable; the CLI could not exercise it, because `main()`'s finally
 * closes the browser the instant `driveOneRun` returns. These tests are the ONLY proof the loop works —
 * it has never run against NAVER, and the gate is injected precisely so it never has to.
 */
class RecoveringProbeDriver extends FakeProbeDriver {
  prepareCalls = 0;
  /** Flipped by the test's gate to stand in for "the seller logged in on their own screen". */
  loggedIn = false;
  /** When set, the Nth prepare (1-based) THROWS — a seller who navigated mid-probe. */
  throwOnPrepare = 0;
  constructor(
    private readonly blockerCode: "LOGIN_REQUIRED" | "SESSION_EXPIRED" = "LOGIN_REQUIRED",
    private readonly recovered: SurfaceProbeResult = { ok: true },
  ) {
    super();
  }
  override async prepareSurface(): Promise<SurfaceProbeResult> {
    this.prepareCalls += 1;
    this.calls.push("prepare");
    if (this.prepareCalls === this.throwOnPrepare) throw new Error("page read failed");
    return this.loggedIn ? this.recovered : { ok: false, blockerCode: this.blockerCode };
  }
}

/** Stands in for the engine refusing the recheck: nothing drives, and the refusal is recorded. */
class RejectingOperatorClient extends LiveRunOperatorClient {
  override send(type: CommandType, payload?: CommandEnvelope["payload"]): void {
    if (type === "REQUEST_STEP_RECHECK") {
      this.lastRejection = "INVALID_FOR_STATE";
      return;
    }
    super.send(type, payload);
  }
}

/** A gate that always signals ready, having "waited" `waitedMs` of the shared budget. */
const readyGate = (waitedMs = 0, onCall?: (attempt: number) => void) => {
  const calls: number[] = [];
  const gate = async (_code: RecoverableSurfaceBlockerCode, attempt: number): Promise<SentinelWait> => {
    calls.push(attempt);
    onCall?.(attempt);
    return { ready: true, waitedMs };
  };
  return { gate, calls };
};

describe("run-action-window-live-naver — awaitFreshSentinel (A3): a stale 'ready' is not a signal", () => {
  const dirs: string[] = [];
  afterEach(() => {
    while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
  });
  const sentinel = (): string => {
    const dir = mkdtempSync(join(tmpdir(), "aw-sentinel-"));
    dirs.push(dir);
    return join(dir, "probe-same-session.ready");
  };

  it("REFUSES to count the pre-run sentinel as a recovery signal — the trap this function exists to close", async () => {
    // `main()` clears the sentinel at startup and in its finally, never in between, so the file the seller
    // created BEFORE the run is still on disk when a park happens. A bare `waitForSentinel` returns true on
    // its first existsSync: the recheck fires milliseconds after the park against the same logged-out page,
    // re-parks, and drains the loop — logging an exhaustion indistinguishable from a seller who walked away.
    // Delete the `removeSentinel` line in `awaitFreshSentinel` and this returns `true` in under a
    // millisecond. This assertion is the whole guard.
    const path = sentinel();
    writeFileSync(path, "");

    const wait = await awaitFreshSentinel(path, 30, 1);

    expect(wait.ready).toBe(false);
    expect(existsSync(path), "the stale sentinel must be cleared, not merely ignored").toBe(false);
  });

  it("still sees a FRESH signal created after the clear — the removal did not break the handshake", async () => {
    const path = sentinel();
    writeFileSync(path, ""); // stale
    setTimeout(() => writeFileSync(path, ""), 5); // the seller signals, for real this time

    const wait = await awaitFreshSentinel(path, 500, 1);

    expect(wait.ready).toBe(true);
  });

  it("reports a poll-derived wait, never a wall-clock read — the budget is spent against this number", async () => {
    const path = sentinel();

    const wait = await awaitFreshSentinel(path, 20, 5);

    expect(wait.ready).toBe(false);
    expect(wait.waitedMs).toBe(20); // ceil(20/5) checks × 5ms — deterministic, no clock
  });
});

describe("run-action-window-live-naver — the recovery loop (A3, D-029)", () => {
  const dirs: string[] = [];
  afterEach(() => {
    while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
  });

  const openRun = (driver: ProbeDriver, runId: string, Client = LiveRunOperatorClient) => {
    const dir = mkdtempSync(join(tmpdir(), "aw-live-cli-"));
    dirs.push(dir);
    const channel = createLoopbackChannel();
    const opened = createPersistentRunSession(
      { dir, transport: channel.server, driver },
      { runId, channelCode: NAVER_CHANNEL_CODE, runCopyKey: NAVER_RUN_COPY_KEY },
    );
    opened.session.attach();
    return { session: opened.session, client: new Client(channel.client, runId) };
  };
  const outcomes = (): unknown[] =>
    getLogSink().filter((l) => l.event === "aw.live.recovery").map((l) => l.meta.outcome);

  it("without a gate a park still returns at once — A3 is opt-in and cannot fire on a caller that has no operator", async () => {
    clearLogSink();
    const driver = new RecoveringProbeDriver("SESSION_EXPIRED");
    const { session, client } = openRun(driver, "run_a30000000001");

    // A 30s ceiling that is never reached: if the loop ran without a gate, this would block on it.
    const view = await driveOneRun(session, client, { observeTimeoutMs: 30_000 });

    expect(view?.status).toBe("WAITING_FOR_HUMAN");
    expect(driver.prepareCalls).toBe(1);
    expect(getLogSink().map((l) => l.event)).not.toContain("aw.live.recovery");
  });

  it("park → the seller logs in → recheck RE-PROBES for real → the run drives on to the barrier", async () => {
    clearLogSink();
    const driver = new RecoveringProbeDriver();
    const { session, client } = openRun(driver, "run_a30000000002");
    const probes: number[] = [];
    // The gate flips the session exactly as a seller logging in on their own screen would.
    const { gate, calls } = readyGate(0, () => {
      driver.loggedIn = true;
    });

    const view = await driveOneRun(session, client, {
      observeTimeoutMs: 50,
      awaitRecovery: gate,
      onRecoveryProbe: (attempt) => probes.push(attempt),
    });

    expect(calls).toEqual([1]);
    expect(driver.prepareCalls, "a recheck that did not re-probe would be the whole bug").toBe(2);
    expect(view?.blocker, "a successful probe is the only thing that clears the blocker").toBeUndefined();
    expect(outcomes()).toEqual(["recovered"]);
    expect(probes).toEqual([1]);
    // The recovery path must not disable the default path.
    expect(getLogSink().map((l) => l.event)).toContain("aw.live.barrier");
  });

  it("the seller never signals → no recheck is sent, the run stays parked, and no barrier is claimed", async () => {
    clearLogSink();
    const driver = new RecoveringProbeDriver();
    const { session, client } = openRun(driver, "run_a30000000003");

    const view = await driveOneRun(session, client, {
      observeTimeoutMs: 30_000, // never reached — a parked run is not the barrier
      awaitRecovery: async () => ({ ready: false, waitedMs: 10 }),
    });

    expect(driver.prepareCalls).toBe(1);
    expect(view?.blocker).toEqual({ code: "LOGIN_REQUIRED", recoverable: true });
    expect(outcomes()).toEqual(["sentinel-timeout"]);
    expect(getLogSink().map((l) => l.event)).not.toContain("aw.live.barrier");
  });

  it("the bound is TIME, not tries: the budget stops the loop with attempts still on the clock", async () => {
    clearLogSink();
    const driver = new RecoveringProbeDriver(); // never recovers
    const { session, client } = openRun(driver, "run_a30000000004");
    const { gate, calls } = readyGate(20);

    await driveOneRun(session, client, {
      observeTimeoutMs: 50,
      awaitRecovery: gate,
      recoveryBudgetMs: 30,
      maxRecoveryAttempts: 10, // deliberately generous — the CAP must not be what stops this
    });

    expect(calls).toEqual([1, 2]); // 30ms budget, 20ms per wait → the third attempt has none left
    expect(outcomes()).toEqual(["still-blocked", "still-blocked", "budget-exhausted"]);
  });

  it("the attempt cap is a spin backstop with its own outcome — if it EVER fires, the trap reopened", async () => {
    clearLogSink();
    const driver = new RecoveringProbeDriver();
    const { session, client } = openRun(driver, "run_a30000000005");
    const { gate, calls } = readyGate(0); // costs no budget — only the cap can stop this

    await driveOneRun(session, client, {
      observeTimeoutMs: 50,
      awaitRecovery: gate,
      maxRecoveryAttempts: 2,
    });

    expect(calls).toEqual([1, 2]);
    expect(driver.prepareCalls).toBe(3); // the initial probe + one per attempt
    expect(outcomes()).toEqual(["still-blocked", "still-blocked", "attempts-exhausted"]);
  });

  it("⚠ a THROWN probe is never reported as 'recovered', and its stale diagnostic is never recorded", async () => {
    clearLogSink();
    const driver = new RecoveringProbeDriver();
    driver.throwOnPrepare = 2; // the seller navigated while we were reading the page
    const { session, client } = openRun(driver, "run_a30000000006");
    const probes: number[] = [];
    const { gate } = readyGate(0, () => {
      driver.loggedIn = true;
    });

    const view = await driveOneRun(session, client, {
      observeTimeoutMs: 50,
      awaitRecovery: gate,
      onRecoveryProbe: (attempt) => probes.push(attempt),
    });

    // session.ts catches into fatalCleanup and never publishes, so the last view is reprobeSession's.
    expect(view?.status).toBe("PREPARING");
    expect(outcomes()).toEqual(["driver-error"]);
    // `lastDiagnostic` is assigned AFTER the page read, so a throw leaves the PREVIOUS probe's value in
    // place. Recording it here would report the pre-login readiness as post-login evidence.
    expect(probes, "a stale diagnostic must never be logged as this attempt's evidence").toEqual([]);
  });

  it("a REJECTED recheck breaks the loop instead of re-prompting the operator for the whole budget", async () => {
    clearLogSink();
    const driver = new RecoveringProbeDriver();
    const { session, client } = openRun(driver, "run_a30000000007", RejectingOperatorClient);
    const { gate, calls } = readyGate(0);

    await driveOneRun(session, client, { observeTimeoutMs: 50, awaitRecovery: gate });

    expect(calls, "a refused command drives nothing — asking again would waste the seller's time").toEqual([1]);
    expect(outcomes()).toEqual(["rejected"]);
  });

  it("UNSUPPORTED_STATE after a login is LEGIBLE — D-028's falsifier landing FALSE must say so in the log", async () => {
    clearLogSink();
    // The seller logs in but lands off the export surface: readiness HALTs. This is D-028's dominant case.
    const driver = new RecoveringProbeDriver("LOGIN_REQUIRED", { ok: false, blockerCode: "UNSUPPORTED_STATE" });
    const { session, client } = openRun(driver, "run_a30000000008");
    const { gate, calls } = readyGate(0, () => {
      driver.loggedIn = true;
    });

    const view = await driveOneRun(session, client, { observeTimeoutMs: 50, awaitRecovery: gate });

    expect(view?.status, "UNSUPPORTED_STATE stays terminal — recovery never softens it").toBe("FAILED");
    expect(calls, "a terminal run is not re-prompted").toEqual([1]);
    const line = getLogSink().find((l) => l.event === "aw.live.recovery");
    expect(line?.meta.outcome).toBe("failed");
    // Without this, "failed" cannot be told from a run whose control was merely unlocatable.
    expect(line?.meta.blockerCode).toBe("UNSUPPORTED_STATE");
  });

  it("a FAILED run carrying a blocker is not mistaken for a park — the gate is never called", async () => {
    clearLogSink();
    const driver = new FakeProbeDriver({ ok: false, blockerCode: "UNSUPPORTED_STATE" });
    const { session, client } = openRun(driver, "run_a30000000009");
    const { gate, calls } = readyGate(0);

    const view = await driveOneRun(session, client, { observeTimeoutMs: 50, awaitRecovery: gate });

    expect(view?.status).toBe("FAILED");
    expect(calls).toEqual([]);
  });
});

describe("recoveryPrompt — the prose a parked seller reads (A3, D-029)", () => {
  // D-028 ratified "return to the review-export surface" as a guidance-only precondition and then nothing
  // implemented it. This prompt IS that implementation, so these locks are not cosmetic: they are the only
  // thing keeping a ratified decision from silently rotting out of the product again.
  const PROMPT = recoveryPrompt("LOGIN_REQUIRED", 1, 10 * 60_000, false);
  const NO_INGEST = recoveryPrompt("SESSION_EXPIRED", 2, 5 * 60_000, true);

  it("names the blocker and says the run is paused, not failed", () => {
    expect(PROMPT).toMatch(/LOGIN_REQUIRED/);
    expect(NO_INGEST).toMatch(/SESSION_EXPIRED/);
    expect(PROMPT).toMatch(/PAUSED — NOT FAILED/);
  });

  it("carries D-028's guidance-only precondition AND its consequence — the Runtime does not navigate", () => {
    expect(PROMPT).toMatch(/RETURN TO THE REVIEW-MANAGEMENT EXPORT PAGE/);
    expect(PROMPT).toMatch(/does NOT navigate/);
    expect(PROMPT).toMatch(/the run ENDS/);
    expect(PROMPT).toMatch(/UNSUPPORTED_STATE/);
    expect(PROMPT).toMatch(/Nothing enforces\n?\s*this step but you/);
  });

  it("tells the seller to signal AGAIN, because the previous signal was deliberately cleared", () => {
    expect(PROMPT).toMatch(/sentinel file shown below AGAIN/);
    expect(PROMPT).toMatch(/leftover signal cannot be mistaken for this one/);
  });

  it("reports the remaining BUDGET and never restates a timing in prose", () => {
    // The bound is time, so the prompt says minutes — not "attempt 2 of 3". A try costs nothing at the seat.
    expect(PROMPT).toMatch(/about 10 MINUTE\(S\) of recovery time left/);
    expect(NO_INGEST).toMatch(/about 5 MINUTE\(S\) of recovery time left/);
    // Both interpolated from the constants, exactly as confirmPrompt's are.
    expect(PROMPT).toMatch(/10 MINUTES from the highlight/);
    expect(PROMPT).toMatch(/60 SECONDS from YOUR action/);
  });

  it("re-states THIS RUN'S ingest consequence — a park can insert a 10-minute detour before the seller acts", () => {
    // The seller read confirmPrompt's irreversibility warning before logging in. By the time they act on
    // the highlight it may be ten minutes and a login flow ago. Derived from the run's policy, never restated.
    expect(PROMPT).toMatch(/is INGESTED into SellerOps/i);
    expect(PROMPT).toMatch(/real and irreversible/i);
    expect(NO_INGEST).toMatch(/DISCARDED/);
    expect(NO_INGEST).not.toMatch(/is INGESTED into SellerOps/i);
  });

  it("leaks nothing — no URL, no path, no selector, no page content", () => {
    for (const p of [PROMPT, NO_INGEST]) {
      expect(p).not.toMatch(/https?:\/\//);
      expect(p).not.toMatch(/\.ready\b/);
      expect(p).not.toMatch(/\[data-|querySelector|#\w+\s*>/);
    }
  });
});

describe("run-action-window-live-naver — module source guard", () => {
  const srcPath = resolve(dirname(fileURLToPath(import.meta.url)), "../../instruments/live-runs/run-action-window-live-naver.ts");
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
    expect(importStatements.some((s) => /\.\.\/\.\.\/src\/cli\/live-run-approval/.test(s))).toBe(true);
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
      /\.\.\/\.\.\/src\/upload/,
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

  /**
   * The §8-19 footgun, a THIRD time. `isClassifyOnly` was exported, unit-tested, and simply never imported
   * by its caller, so `--no-upload` was discarded and the run uploaded anyway. A3's recovery gate has the
   * identical shape: `awaitRecovery` is optional, `main()` is unreachable from tests, and the entire loop
   * could be green while the live CLI still tears the browser down the instant a park happens — the exact
   * gap A3 exists to close. A green unit test on an opt-in seam proves nothing about the caller.
   */
  it("main() WIRES the recovery gate — an opt-in loop the caller never passes is --no-upload all over again", () => {
    // ⚠ These patterns must match main()'s CALL SITE, never a declaration. The first draft of this test
    // asserted `/awaitRecovery:/`, which the `recoverLoop` type signature satisfies — so renaming main()'s
    // wiring left the guard green and the live CLI dead. A vacuous guard against the footgun IS the footgun.
    expect(/driveOneRun\(assembled\.session, assembled\.client, \{/.test(code)).toBe(true);
    expect(/awaitRecovery: async \(/.test(code)).toBe(true);
    expect(/onRecoveryProbe: \(attempt\) =>/.test(code)).toBe(true);
    // The prompt must be PRINTED and the sentinel must be waited on — a gate that does neither is a stub.
    expect(/console\.error\(recoveryPrompt\(/.test(code)).toBe(true);
    expect(/await awaitFreshSentinel\(/.test(code)).toBe(true);
  });

  it("emits the recovery evidence surface", () => {
    expect(/log\("aw\.live\.recovery"/.test(code)).toBe(true);
  });
});
