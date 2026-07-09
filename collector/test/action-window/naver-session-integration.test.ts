/**
 * **NAVER pilot adapter — session E2E over the fixture driver (R4, D-021, fixture-only).** Runs the
 * real `ActionWindowSession` + engine with `channelCode: "naver"` and the `NaverFixtureProbeDriver`
 * through the loopback transport. Offline and hermetic: no browser, no Bridge server, no backend,
 * no live NAVER contact anywhere.
 *
 * Proves per fixture mode: the happy loop completes; every hostile shape fails closed with the
 * expected already-reserved code BEFORE the human checkpoint (or via drift after it); an observed
 * action without the verified transition never completes; the SYNTHETIC downstream never runs
 * unless verification succeeded; Operation Run persistence/restore carries `channelCode: "naver"`;
 * and the privacy boundary holds — every wire frame and persisted record is contract-sanitized and
 * free of the fixture's planted canaries, its page wording, and any platform token.
 */
import { afterEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import {
  ACTION_WINDOW_PROTOCOL_VERSION,
  findProhibitedFields,
  validateEventEnvelope,
  validateRunView,
  type ActionWindowRunView,
  type BlockerCode,
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
import { ActionWindowSession } from "../../src/action-window/session";
import {
  NAVER_CHANNEL_CODE,
  NAVER_RUN_COPY_KEY,
  NaverFixtureProbeDriver,
  type NaverFixtureDriverOptions,
} from "../../src/action-window/naver-driver";
import { NAVER_FIXTURE_CANARIES, type NaverFixtureMode } from "../../src/action-window/naver-fixture";
import type { QuarantineIo } from "../../src/action-window/quarantine";
import type { AwIngestUploadFn } from "../../src/action-window/ingest-handoff";
import { loadOperationRun } from "../../src/action-window/run-store";
import { openOrResumeRunSession, type OpenedRunSession } from "../../src/action-window/run-lifecycle";

const RUN_ID = "run_naver_fx";

/** Nothing NAVER-real and nothing fixture-raw may ever cross the wire or reach the store. */
const FORBIDDEN_NEEDLES = [
  ...NAVER_FIXTURE_CANARIES,
  "smartstore",
  "스마트스토어",
  "naver.com",
  "sell.naver",
  "네이버",
  "storefarm",
  "엑셀",
  "다운로드",
  "내려받기",
  "합성",
  "fx-export",
  "리뷰 관리",
  "<button",
  "password",
  // downstream slice: no quarantine naming, artifact extension, OOXML marker, or fs path fragment
  "aw-quarantine",
  ".xlsx",
  ".html",
  "[content_types]",
  "downloads/",
  tmpdir(),
];

function expectNoNeedle(value: unknown, label: string): void {
  const lower = JSON.stringify(value).toLowerCase();
  for (const needle of FORBIDDEN_NEEDLES) {
    expect(lower.includes(needle.toLowerCase()), `${label} leaked "${needle}"`).toBe(false);
  }
}

/** Minimal frame-level FE client (same shape as the synthetic R2 E2E suite). */
class FeClient {
  view: ActionWindowRunView | null = null;
  events: EventEnvelope[] = [];
  allServerFrames: AwServerFrame[] = [];
  private cmdSeq = 0;

  constructor(
    private readonly transport: AwClientTransport,
    private readonly runId: string,
    /** Restored runs bump the revision before any frame reaches the FE (R3 suite pattern). */
    private readonly revisionOf?: () => number,
  ) {
    transport.subscribe((frame) => {
      this.allServerFrames.push(frame);
      if (frame.kind === "aw_event") this.events.push(frame.event);
      if (frame.kind === "aw_view") this.view = frame.view;
    });
  }

  send(type: CommandType, payload?: CommandEnvelope["payload"]): void {
    this.transport.send({
      kind: "aw_command",
      command: {
        protocolVersion: ACTION_WINDOW_PROTOCOL_VERSION,
        // Random suffix: the idempotency ledger persists across simulated restarts (R3), so a
        // counter alone would collide with the previous process's commandIds.
        commandId: `${this.runId}-c${++this.cmdSeq}-${randomUUID().slice(0, 8)}`,
        runId: this.runId,
        expectedRevision: this.revisionOf?.() ?? this.view?.revision ?? 0,
        type,
        ...(payload ? { payload } : {}),
      },
    });
  }

  eventTypes(): string[] {
    return this.events.map((e) => e.type);
  }
}

function wire(
  mode: NaverFixtureMode,
  driverOpts: NaverFixtureDriverOptions = {},
): { fe: FeClient; session: ActionWindowSession; driver: NaverFixtureProbeDriver } {
  const channel = createLoopbackChannel();
  const engine = new ActionWindowEngine({ runId: RUN_ID, channelCode: NAVER_CHANNEL_CODE, runCopyKey: NAVER_RUN_COPY_KEY });
  const driver = new NaverFixtureProbeDriver(mode, driverOpts);
  const session = new ActionWindowSession(engine, driver, channel.server);
  session.attach();
  const fe = new FeClient(channel.client, RUN_ID);
  return { fe, session, driver };
}

/** Every frame the FE ever received must be contract-valid, prohibited-field-free, needle-free. */
function assertSanitized(fe: FeClient, label: string): void {
  for (const frame of fe.allServerFrames) {
    expect(findProhibitedFields(frame)).toEqual([]);
    if (frame.kind === "aw_event") expect(validateEventEnvelope(frame.event)).toEqual({ ok: true });
    if (frame.kind === "aw_view") expect(validateRunView(frame.view)).toEqual({ ok: true });
  }
  expectNoNeedle(fe.allServerFrames, label);
}

async function startRun(mode: NaverFixtureMode, driverOpts: NaverFixtureDriverOptions = {}) {
  const wired = wire(mode, driverOpts);
  wired.fe.send("START_RUN", { channelCode: NAVER_CHANNEL_CODE });
  await wired.session.whenSettled();
  return wired;
}

describe("NAVER fixture session E2E — happy path", () => {
  it("runs the full loop to COMPLETED with channelCode naver", async () => {
    const { fe, session, driver } = await startRun("normal");

    expect(fe.view?.channelCode).toBe(NAVER_CHANNEL_CODE);
    expect(fe.view?.status).toBe("WAITING_FOR_HUMAN");
    expect(fe.view?.currentStep?.status).toBe("AWAITING_USER");
    const highlight = fe.events.find((e) => e.type === "TARGET_HIGHLIGHTED");
    expect(highlight?.payload.targetRef).toMatch(/^[0-9a-f]{16}$/);

    // The USER acts (test-reported); observation alone never completes.
    driver.completeUserAction(true);
    await session.whenSettled();
    expect(fe.view?.status).toBe("WAITING_FOR_HUMAN");
    expect(driver.downstreamCalls).toEqual({ detect: 0, validate: 0, ingest: 0 });

    fe.send("REQUEST_STEP_RECHECK");
    await session.whenSettled();
    expect(fe.view?.status).toBe("COMPLETED");
    expect(fe.view?.progress).toEqual({ completedSteps: 3, totalSteps: 3 });
    expect(driver.downstreamCalls).toEqual({ detect: 1, validate: 1, ingest: 1 });
    const detected = fe.events.find((e) => e.type === "DOWNLOAD_DETECTED");
    expect(detected?.payload.artifactRef).toMatch(/^[0-9a-f]{16}$/);
    // Gapless ordered audit.
    const seqs = fe.events.map((e) => e.sequence);
    expect(seqs).toEqual(seqs.map((_, i) => i + 1));

    assertSanitized(fe, "happy-path");
  });
});

describe("NAVER fixture session E2E — fail-closed hostile shapes", () => {
  const failsBeforeCheckpoint: ReadonlyArray<[NaverFixtureMode, BlockerCode]> = [
    ["reconnect-required", "SESSION_EXPIRED"],
    ["login-required", "LOGIN_REQUIRED"],
    ["empty-target", "UNSUPPORTED_STATE"],
    ["ambiguous-readiness", "UNSUPPORTED_STATE"],
    ["no-target", "TARGET_NOT_FOUND"],
    ["multi-target", "TARGET_AMBIGUOUS"],
    ["async-affordance", "TARGET_NOT_FOUND"],
  ];

  it.each(failsBeforeCheckpoint)("%s fails closed with %s before the human checkpoint", async (mode, code) => {
    const { fe, driver } = await startRun(mode);
    expect(fe.view?.status).toBe("FAILED");
    expect(fe.view?.blocker?.code).toBe(code);
    // The human checkpoint was never reached and the downstream never ran.
    expect(fe.eventTypes()).not.toContain("HUMAN_ACTION_REQUIRED");
    expect(fe.eventTypes()).not.toContain("USER_ACTION_OBSERVED");
    expect(fe.eventTypes()).not.toContain("DOWNLOAD_DETECTED");
    expect(fe.eventTypes()).not.toContain("RUN_COMPLETED");
    expect(driver.downstreamCalls).toEqual({ detect: 0, validate: 0, ingest: 0 });
    assertSanitized(fe, mode);
  });

  it("drift: a post-action target change fails closed with UI_DRIFT (downstream never runs)", async () => {
    const { fe, session, driver } = await startRun("drift");
    driver.completeUserAction(true);
    await session.whenSettled();
    fe.send("REQUEST_STEP_RECHECK");
    await session.whenSettled();

    expect(fe.view?.status).toBe("FAILED");
    expect(fe.view?.blocker?.code).toBe("UI_DRIFT");
    expect(fe.eventTypes()).not.toContain("DOWNLOAD_DETECTED");
    expect(fe.eventTypes()).not.toContain("RUN_COMPLETED");
    expect(driver.downstreamCalls).toEqual({ detect: 0, validate: 0, ingest: 0 });
    assertSanitized(fe, "drift");
  });

  it("unchanged: no verified transition → back to the checkpoint, never completed, no downstream", async () => {
    const { fe, session, driver } = await startRun("unchanged");
    driver.completeUserAction(true);
    await session.whenSettled();
    fe.send("REQUEST_STEP_RECHECK");
    await session.whenSettled();

    expect(fe.view?.status).toBe("WAITING_FOR_HUMAN"); // honest non-completion, not a failure
    expect(fe.eventTypes()).not.toContain("STEP_COMPLETED");
    expect(fe.eventTypes()).not.toContain("DOWNLOAD_DETECTED");
    expect(fe.eventTypes()).not.toContain("RUN_COMPLETED");
    expect(driver.downstreamCalls).toEqual({ detect: 0, validate: 0, ingest: 0 });
    assertSanitized(fe, "unchanged");
  });
});

describe("NAVER fixture session E2E — REAL downstream (detect + quarantine validate)", () => {
  const dirs: string[] = [];
  afterEach(() => {
    while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
  });
  function tmpQuarantine(): string {
    const dir = mkdtempSync(join(tmpdir(), `aw-naver-q-${randomUUID()}-`));
    dirs.push(dir);
    return dir;
  }
  function realOpts(shape: "xlsx-valid" | "wrong-extension" | "bad-magic" | "none", dir: string, io?: QuarantineIo): NaverFixtureDriverOptions {
    return { downloadShape: shape, downstream: { real: { quarantineDir: dir, ...(io ? { io } : {}) } } };
  }

  it("happy path: real detect → quarantine validate → COMPLETED; dir empty; wire clean", async () => {
    const dir = tmpQuarantine();
    const { fe, session, driver } = await startRun("normal", realOpts("xlsx-valid", dir));
    driver.completeUserAction(true);
    await session.whenSettled();
    expect(driver.downstreamCalls).toEqual({ detect: 0, validate: 0, ingest: 0 }); // observation ≠ completion

    fe.send("REQUEST_STEP_RECHECK");
    await session.whenSettled();
    expect(fe.view?.status).toBe("COMPLETED");
    expect(driver.downstreamCalls).toEqual({ detect: 1, validate: 1, ingest: 1 });
    expect(driver.lastQuarantine()).toEqual({ saved: true, extensionOk: true, magicOk: true, deleted: true, valid: true });

    const detected = fe.events.find((e) => e.type === "DOWNLOAD_DETECTED");
    expect(detected?.payload.artifactRef).toMatch(/^[0-9a-f]{16}$/);
    expect(readdirSync(dir)).toEqual([]); // nothing lingers in quarantine
    assertSanitized(fe, "real-happy");
    expectNoNeedle(fe.allServerFrames, "real-happy-dir-fragment");
    expect(JSON.stringify(fe.allServerFrames).includes(dir)).toBe(false);
  });

  it("no download after the verified action → FAILED DOWNLOAD_TIMEOUT (validate/ingest never run)", async () => {
    const dir = tmpQuarantine();
    const { fe, session, driver } = await startRun("normal", realOpts("none", dir));
    driver.completeUserAction(true);
    await session.whenSettled();
    fe.send("REQUEST_STEP_RECHECK");
    await session.whenSettled();

    expect(fe.view?.status).toBe("FAILED");
    expect(fe.view?.blocker?.code).toBe("DOWNLOAD_TIMEOUT");
    expect(fe.eventTypes()).not.toContain("DOWNLOAD_DETECTED");
    expect(driver.downstreamCalls).toEqual({ detect: 1, validate: 0, ingest: 0 });
    expect(readdirSync(dir)).toEqual([]);
    assertSanitized(fe, "real-none");
  });

  it.each([["wrong-extension"], ["bad-magic"]] as const)(
    "%s artifact → FAILED ARTIFACT_INVALID after DOWNLOAD_DETECTED; ingest never runs; dir empty",
    async (shape) => {
      const dir = tmpQuarantine();
      const { fe, session, driver } = await startRun("normal", realOpts(shape, dir));
      driver.completeUserAction(true);
      await session.whenSettled();
      fe.send("REQUEST_STEP_RECHECK");
      await session.whenSettled();

      expect(fe.view?.status).toBe("FAILED");
      expect(fe.view?.blocker?.code).toBe("ARTIFACT_INVALID");
      expect(fe.eventTypes()).toContain("DOWNLOAD_DETECTED"); // detection succeeded, validation failed
      expect(fe.eventTypes()).not.toContain("RUN_COMPLETED");
      expect(driver.downstreamCalls).toEqual({ detect: 1, validate: 1, ingest: 0 });
      expect(driver.lastQuarantine()?.valid).toBe(false);
      expect(driver.lastQuarantine()?.deleted).toBe(true); // hostile artifact still cleaned up
      expect(readdirSync(dir)).toEqual([]);
      assertSanitized(fe, `real-${shape}`);
    },
  );

  it("cleanup failure fails closed: a valid artifact whose quarantine delete fails → ARTIFACT_INVALID", async () => {
    const dir = tmpQuarantine();
    const lockedIo: QuarantineIo = {
      ensureDir: (d) => mkdirSync(d, { recursive: true }),
      writeFile: (p, b) => writeFileSync(p, b),
      readHead: (p, n) => readFileSync(p).subarray(0, n),
      removeFile: () => {
        throw new Error("simulated locked quarantine file");
      },
      listDir: () => [],
    };
    const { fe, session, driver } = await startRun("normal", realOpts("xlsx-valid", dir, lockedIo));
    driver.completeUserAction(true);
    await session.whenSettled();
    fe.send("REQUEST_STEP_RECHECK");
    await session.whenSettled();

    expect(fe.view?.status).toBe("FAILED");
    expect(fe.view?.blocker?.code).toBe("ARTIFACT_INVALID"); // deleted:false ⇒ valid:false (posture lock)
    expect(driver.lastQuarantine()).toEqual({ saved: true, extensionOk: true, magicOk: true, deleted: false, valid: false });
    assertSanitized(fe, "real-cleanup-failure");
  });
});

describe("NAVER fixture session E2E — REAL ingest handoff (injected upload)", () => {
  const dirs: string[] = [];
  afterEach(() => {
    while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
  });
  function tmpQuarantine(): string {
    const dir = mkdtempSync(join(tmpdir(), `aw-naver-ingest-${randomUUID()}-`));
    dirs.push(dir);
    return dir;
  }
  function ingestOpts(dir: string, upload: AwIngestUploadFn): NaverFixtureDriverOptions {
    return { downloadShape: "xlsx-valid", downstream: { real: { quarantineDir: dir, ingest: { upload } } } };
  }
  async function toCompletionAttempt(
    fe: FeClient,
    session: ActionWindowSession,
    driver: NaverFixtureProbeDriver,
  ): Promise<void> {
    driver.completeUserAction(true);
    await session.whenSettled();
    fe.send("REQUEST_STEP_RECHECK");
    await session.whenSettled();
  }

  it("hands the validated artifact to the injected upload and COMPLETES", async () => {
    const dir = tmpQuarantine();
    const seen: string[] = [];
    const upload: AwIngestUploadFn = (src) => {
      seen.push(src.artifactRef);
      return Promise.resolve({ ok: true, processed: 3 });
    };
    const { fe, session, driver } = await startRun("normal", ingestOpts(dir, upload));
    await toCompletionAttempt(fe, session, driver);

    expect(fe.view?.status).toBe("COMPLETED");
    expect(fe.view?.progress).toEqual({ completedSteps: 3, totalSteps: 3 });
    expect(driver.downstreamCalls).toEqual({ detect: 1, validate: 1, ingest: 1 });
    // The upload was invoked with exactly the opaque ref the FE saw as DOWNLOAD_DETECTED.
    const detected = fe.events.find((e) => e.type === "DOWNLOAD_DETECTED");
    expect(detected?.payload.artifactRef).toMatch(/^[0-9a-f]{16}$/);
    expect(seen).toEqual([detected?.payload.artifactRef]);
    expect(readdirSync(dir)).toEqual([]);
    assertSanitized(fe, "real-ingest-happy");
  });

  it("a non-ok ingest outcome FAILS the run closed with the generic UNSUPPORTED_STATE", async () => {
    const dir = tmpQuarantine();
    const upload: AwIngestUploadFn = () => Promise.resolve({ ok: false, processed: 0 });
    const { fe, session, driver } = await startRun("normal", ingestOpts(dir, upload));
    await toCompletionAttempt(fe, session, driver);

    expect(fe.view?.status).toBe("FAILED");
    expect(fe.view?.blocker?.code).toBe("UNSUPPORTED_STATE"); // no ingest-specific code (deferred)
    expect(fe.eventTypes()).toContain("DOWNLOAD_DETECTED"); // detect + validate succeeded; ingest failed
    expect(fe.eventTypes()).not.toContain("RUN_COMPLETED");
    expect(driver.downstreamCalls).toEqual({ detect: 1, validate: 1, ingest: 1 });
    expect(readdirSync(dir)).toEqual([]);
    assertSanitized(fe, "real-ingest-fail");
  });
});

describe("NAVER fixture session — Operation Run persistence & resume (channelCode naver)", () => {
  const dirs: string[] = [];
  afterEach(() => {
    while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
  });
  function tmpDir(): string {
    const dir = mkdtempSync(join(tmpdir(), `aw-naver-${randomUUID()}-`));
    dirs.push(dir);
    return dir;
  }

  function boot(
    dir: string,
    driverOpts: NaverFixtureDriverOptions = {},
    mode: NaverFixtureMode = "normal",
  ): { opened: OpenedRunSession; fe: FeClient; driver: NaverFixtureProbeDriver } {
    const channel = createLoopbackChannel();
    const driver = new NaverFixtureProbeDriver(mode, driverOpts);
    const opened = openOrResumeRunSession(
      { dir, transport: channel.server, driver },
      { runId: RUN_ID, channelCode: NAVER_CHANNEL_CODE, runCopyKey: NAVER_RUN_COPY_KEY },
    );
    opened.session.attach();
    return { opened, fe: new FeClient(channel.client, RUN_ID, () => opened.engine.view().revision), driver };
  }

  it("persists channelCode naver, survives a restart, and completes after RESUME_RUN", async () => {
    const dir = tmpDir();
    const before = boot(dir);
    before.fe.send("START_RUN", { channelCode: NAVER_CHANNEL_CODE });
    await before.opened.session.whenSettled();
    expect(before.opened.engine.view().status).toBe("WAITING_FOR_HUMAN");

    const persisted = loadOperationRun(dir, RUN_ID)!;
    expect(persisted.channelCode).toBe(NAVER_CHANNEL_CODE);
    expect(persisted.resumeState).toBe("RESUME_AT_CHECKPOINT");
    expect(findProhibitedFields(persisted)).toEqual([]);
    expectNoNeedle(persisted, "persisted-checkpoint-record");

    // Process "dies"; a fresh process restores and parks at the PAUSED barrier.
    const after = boot(dir);
    expect(after.opened.origin).toBe("RESUMED");
    expect(after.opened.engine.view().status).toBe("PAUSED");
    expect(after.opened.engine.view().channelCode).toBe(NAVER_CHANNEL_CODE);

    // Explicit RESUME_RUN re-drives the read-only chain over the restored NAVER driver: the
    // deterministic content-derived signature re-locates the SAME target after the restart.
    after.fe.send("RESUME_RUN");
    await after.opened.session.whenSettled();
    expect(after.opened.engine.view().status).toBe("WAITING_FOR_HUMAN");

    after.driver.completeUserAction(true);
    await after.opened.session.whenSettled();
    after.fe.send("REQUEST_STEP_RECHECK");
    await after.opened.session.whenSettled();
    expect(after.opened.engine.view().status).toBe("COMPLETED");

    const final = loadOperationRun(dir, RUN_ID)!;
    expect(final.channelCode).toBe(NAVER_CHANNEL_CODE);
    expect(final.resumeState).toBe("TERMINAL");
    expect(findProhibitedFields(final)).toEqual([]);
    expectNoNeedle(final, "persisted-final-record");
    assertSanitized(after.fe, "resumed-run");
  });

  it("a restart at the checkpoint resumes and completes through the REAL downstream", async () => {
    const dir = tmpDir();
    const quarantineDir = tmpDir();
    const real: NaverFixtureDriverOptions = { downloadShape: "xlsx-valid", downstream: { real: { quarantineDir } } };

    const before = boot(dir, real);
    before.fe.send("START_RUN", { channelCode: NAVER_CHANNEL_CODE });
    await before.opened.session.whenSettled();
    expect(before.opened.engine.view().status).toBe("WAITING_FOR_HUMAN");

    // Process "dies" at the checkpoint; the fresh process restores, resumes, and the USER acts —
    // the fixture produces a fresh artifact, so the real detect → quarantine chain runs post-restart.
    const after = boot(dir, real);
    expect(after.opened.origin).toBe("RESUMED");
    after.fe.send("RESUME_RUN");
    await after.opened.session.whenSettled();
    expect(after.opened.engine.view().status).toBe("WAITING_FOR_HUMAN");

    after.driver.completeUserAction(true);
    await after.opened.session.whenSettled();
    after.fe.send("REQUEST_STEP_RECHECK");
    await after.opened.session.whenSettled();
    expect(after.opened.engine.view().status).toBe("COMPLETED");
    expect(after.driver.downstreamCalls).toEqual({ detect: 1, validate: 1, ingest: 1 });
    expect(after.driver.lastQuarantine()?.valid).toBe(true);
    expect(readdirSync(quarantineDir)).toEqual([]);

    const final = loadOperationRun(dir, RUN_ID)!;
    expect(final.resumeState).toBe("TERMINAL");
    expect(findProhibitedFields(final)).toEqual([]);
    expectNoNeedle(final, "persisted-real-downstream-record");
    expect(JSON.stringify(final).includes(quarantineDir)).toBe(false);
    assertSanitized(after.fe, "resumed-real-downstream");
  });

  it("a restart resumes and completes THROUGH the real ingest handoff (injected upload)", async () => {
    const dir = tmpDir();
    const quarantineDir = tmpDir();
    const refs: string[] = [];
    const upload: AwIngestUploadFn = (src) => {
      refs.push(src.artifactRef);
      return Promise.resolve({ ok: true, processed: 2 });
    };
    const real: NaverFixtureDriverOptions = {
      downloadShape: "xlsx-valid",
      downstream: { real: { quarantineDir, ingest: { upload } } },
    };

    const before = boot(dir, real);
    before.fe.send("START_RUN", { channelCode: NAVER_CHANNEL_CODE });
    await before.opened.session.whenSettled();
    expect(before.opened.engine.view().status).toBe("WAITING_FOR_HUMAN");

    // Process "dies" at the checkpoint; the fresh process restores and resumes; the USER acts and the
    // fresh artifact runs the full detect → validate → INGEST chain over the restored driver.
    const after = boot(dir, real);
    expect(after.opened.origin).toBe("RESUMED");
    after.fe.send("RESUME_RUN");
    await after.opened.session.whenSettled();
    after.driver.completeUserAction(true);
    await after.opened.session.whenSettled();
    after.fe.send("REQUEST_STEP_RECHECK");
    await after.opened.session.whenSettled();

    expect(after.opened.engine.view().status).toBe("COMPLETED");
    expect(after.driver.downstreamCalls).toEqual({ detect: 1, validate: 1, ingest: 1 });
    expect(refs.length).toBe(1); // the injected upload fired exactly once, post-restart
    expect(readdirSync(quarantineDir)).toEqual([]);

    const final = loadOperationRun(dir, RUN_ID)!;
    expect(final.resumeState).toBe("TERMINAL");
    expect(findProhibitedFields(final)).toEqual([]);
    expectNoNeedle(final, "persisted-real-ingest-record");
    // The ingest processed-count never survives into persistence.
    expect(JSON.stringify(final)).not.toContain("processed");
    assertSanitized(after.fe, "resumed-real-ingest");
  });

  it("an ARTIFACT_INVALID failure resumes THROUGH the human checkpoint; a fixed artifact completes", async () => {
    const dir = tmpDir();
    const quarantineDir = tmpDir();

    // First life: the user's action produces an xlsx-NAMED but non-OOXML artifact → fail closed.
    const broken = boot(dir, { downloadShape: "bad-magic", downstream: { real: { quarantineDir } } });
    broken.fe.send("START_RUN", { channelCode: NAVER_CHANNEL_CODE });
    await broken.opened.session.whenSettled();
    broken.driver.completeUserAction(true);
    await broken.opened.session.whenSettled();
    broken.fe.send("REQUEST_STEP_RECHECK");
    await broken.opened.session.whenSettled();
    expect(broken.opened.engine.view().status).toBe("FAILED");
    expect(broken.opened.engine.view().blocker?.code).toBe("ARTIFACT_INVALID");

    const persisted = loadOperationRun(dir, RUN_ID)!;
    expect(persisted.latestView.blocker?.code).toBe("ARTIFACT_INVALID");
    expect(findProhibitedFields(persisted)).toEqual([]);
    expectNoNeedle(persisted, "persisted-artifact-invalid-record");

    // Second life: resume re-enters THROUGH the checkpoint (the export must happen again); this
    // time the user's action produces a valid artifact and the run completes.
    const fixed = boot(dir, { downloadShape: "xlsx-valid", downstream: { real: { quarantineDir } } });
    expect(fixed.opened.origin).toBe("RESUMED");
    fixed.fe.send("RESUME_RUN");
    await fixed.opened.session.whenSettled();
    expect(fixed.opened.engine.view().status).toBe("WAITING_FOR_HUMAN");

    fixed.driver.completeUserAction(true);
    await fixed.opened.session.whenSettled();
    fixed.fe.send("REQUEST_STEP_RECHECK");
    await fixed.opened.session.whenSettled();
    expect(fixed.opened.engine.view().status).toBe("COMPLETED");
    expect(readdirSync(quarantineDir)).toEqual([]);
    assertSanitized(fixed.fe, "resumed-after-artifact-invalid");
  });

  it("a run failed on a reconnect-shaped surface persists only the semantic blocker code", async () => {
    const dir = tmpDir();
    const channel = createLoopbackChannel();
    const driver = new NaverFixtureProbeDriver("reconnect-required");
    const opened = openOrResumeRunSession(
      { dir, transport: channel.server, driver },
      { runId: RUN_ID, channelCode: NAVER_CHANNEL_CODE, runCopyKey: NAVER_RUN_COPY_KEY },
    );
    opened.session.attach();
    const fe = new FeClient(channel.client, RUN_ID);
    fe.send("START_RUN", { channelCode: NAVER_CHANNEL_CODE });
    await opened.session.whenSettled();

    expect(opened.engine.view().status).toBe("FAILED");
    const persisted = loadOperationRun(dir, RUN_ID)!;
    expect(persisted.latestView.blocker?.code).toBe("SESSION_EXPIRED");
    expect(findProhibitedFields(persisted)).toEqual([]);
    expectNoNeedle(persisted, "persisted-failed-record");
  });
});
