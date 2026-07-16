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
  driveOneRun,
  LiveRunOperatorClient,
  PRODUCTION_REFUSAL,
  CONFIRM_PROMPT,
} from "../../src/cli/run-action-window-live-naver";
import { APPROVAL_FLAG, approvalRequiredMessage } from "../../src/cli/live-run-approval";
import { loadConfig } from "../../src/config";
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
    // A driver that fails the surface precondition → the run lands terminal at START.
    const driver = new FakeProbeDriver({ ok: false, blockerCode: "SESSION_EXPIRED" });
    const opened = createPersistentRunSession(
      { dir, transport: channel.server, driver },
      { runId: "run_def456def456", channelCode: NAVER_CHANNEL_CODE, runCopyKey: NAVER_RUN_COPY_KEY },
    );
    opened.session.attach();
    const client = new LiveRunOperatorClient(channel.client, "run_def456def456");

    const view = await driveOneRun(opened.session, client);

    expect(view?.status).toBe("FAILED");
    expect(view?.blocker?.code).toBe("SESSION_EXPIRED");
    const detected = client.serverFrames.filter((f) => f.kind === "aw_event" && f.event.type === "DOWNLOAD_DETECTED");
    expect(detected).toHaveLength(0);
  });
});

describe("CONFIRM_PROMPT — the prose a seated human reads mid-run (D-025)", () => {
  // This prompt was unexported and unasserted until D-025, and it rotted: through Run 5 it still
  // instructed the operator to confirm the dialog and quoted a single ~60 s budget that `40d7c53`
  // had already made false. These lock the invariants that rotted, so the next drift fails here
  // rather than in front of a seated human holding a single-use approval.

  it("states the period/scope step as the operator's own, unenforced by the Runtime", () => {
    // Under D-025 period/scope is a guidance-only §4 human precondition — the gate answers
    // exportability, never scope. This line is the ONLY thing carrying that obligation, and Run 5's
    // operator skipped it with nothing noticing. It must be prominent, not buried in a sub-bullet.
    expect(CONFIRM_PROMPT).toMatch(/SELECT THE REVIEW PERIOD \/ SCOPE YOURSELF/);
    expect(CONFIRM_PROMPT).toMatch(/nothing enforces it/i);
    expect(CONFIRM_PROMPT).toMatch(/never sets, requires, or checks it/i);
  });

  it("describes TWO windows and never restates a timing in prose", () => {
    // The two-window budget is live-confirmed (§8-18: the download deadline starts at the human's
    // action, not at the highlight). Both numbers are interpolated from the constants above, so a
    // timer change can never leave the operator reading a stale one.
    expect(CONFIRM_PROMPT).toMatch(/TWO windows, not one/);
    expect(CONFIRM_PROMPT).toMatch(/10 MINUTES from the highlight/);
    expect(CONFIRM_PROMPT).toMatch(/60 SECONDS from YOUR action/);
    // The exact stale sentence this replaced must never come back.
    expect(/From the moment the highlight appears you have about 60 SECONDS/.test(CONFIRM_PROMPT)).toBe(false);
  });

  it("defers the confirm decision to the run's approved scope instead of hardcoding it", () => {
    // The prompt is shared across run scopes: Run 5 was act-but-never-confirm, the export pilot is
    // act + confirm + ingest. Telling every operator to confirm is wrong for the former — it is
    // what the stale text did, and it contradicted the very run it was printed for.
    expect(CONFIRM_PROMPT).toMatch(/defined by THIS RUN'S\n?APPROVED SCOPE/);
    expect(/manually confirm the expected NAVER confirmation dialog/.test(CONFIRM_PROMPT)).toBe(false);
  });

  it("warns that a validated download is ingested unconditionally", () => {
    // There is no no-ingest mode: the engine runs VALIDATE→INGEST with no gate, so not acting is
    // the operator's only lever on an observe-only scope. The human must know that before acting.
    expect(CONFIRM_PROMPT).toMatch(/there is no no-ingest mode/i);
    expect(CONFIRM_PROMPT).toMatch(/letting window 2 lapse is the lever/i);
  });

  it("still tells the operator the Runtime never acts for them, and fails closed", () => {
    expect(CONFIRM_PROMPT).toMatch(/it never acts for you/i);
    expect(CONFIRM_PROMPT).toMatch(/fails closed/i);
    expect(CONFIRM_PROMPT).toMatch(/this run's approval is spent/i);
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
