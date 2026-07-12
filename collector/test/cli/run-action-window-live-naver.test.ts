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
} from "../../src/cli/run-action-window-live-naver";
import { APPROVAL_FLAG, approvalRequiredMessage } from "../../src/cli/live-run-approval";
import { loadConfig } from "../../src/config";
import { defaultQuarantineDirFor } from "../../src/action-window/quarantine";
import { defaultOperationRunDirFor } from "../../src/action-window/run-store";
import { NAVER_CHANNEL_CODE, NAVER_RUN_COPY_KEY } from "../../src/action-window/naver-surface";
import { createLoopbackChannel } from "../../../contracts/action-window/v1/transport";
import { createPersistentRunSession } from "../../src/action-window/run-lifecycle";
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
});
