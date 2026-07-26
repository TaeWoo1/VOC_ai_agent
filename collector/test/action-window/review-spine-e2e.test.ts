/**
 * **Review Acquisition Spine — the local end-to-end proof (GATED).**
 *
 * The hermetic spine tests prove each half against the committed golden artifact; the backend's
 * `ReviewAcquisitionSpineTest` proves the same bytes ingest to attention signals inside one JVM.
 * Neither drives a *running system*. This suite does: a synthetic Action Window run, in a real
 * Chromium, over the fixture page serving the REAL committed bytes, through the real quarantine and
 * the real ingest handoff, into a real backend over HTTP — and then reads the attention API and
 * asserts it matches the contract's `expectedAttention`.
 *
 * **No frontend code is imported.** This port asserts the API payload; the FE asserts its selector
 * and render over the same `expectedAttention` declaration in its own suite. Three ports, one
 * declaration, no cross-stack imports.
 *
 * Synthetic and offline-of-the-marketplace: no marketplace, no credentials, no real seller data. The
 * only click is the TEST-ONLY simulated one (or a real human click under `AW_HEADED=1`) — no
 * production Action Window code clicks anything.
 *
 *   RUN_INTEGRATION=1 SPINE_E2E_BASE_URL=http://localhost:18080 \
 *     npx vitest run test/action-window/review-spine-e2e.test.ts
 *
 * ⚠ Point `SPINE_E2E_BASE_URL` at a **disposable** backend. The run signs up a fresh org and writes
 * reviews; it must never be aimed at anything whose data matters.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { chromium, type Browser, type Page } from "playwright";

import {
  ACTION_WINDOW_PROTOCOL_VERSION,
  findProhibitedFields,
  validateEventEnvelope,
  validateRunView,
  type ActionWindowRunView,
  type CommandEnvelope,
  type CommandType,
  type EventEnvelope,
} from "../../../contracts/action-window/v1/index";
import { createLoopbackChannel, type AwClientTransport, type AwServerFrame } from "../../../contracts/action-window/v1/transport";
import { ActionWindowEngine } from "../../src/action-window/engine";
import { ActionWindowSession } from "../../src/action-window/session";
import { BrowserProbeDriver } from "../../src/action-window/browser-driver";
import { buildBackendIngestUpload } from "../../src/action-window/ingest-handoff";
import {
  expectedRows,
  reviewExportBase64,
  reviewExportBytes,
  reviewExportEmptyBase64,
} from "../support/review-export-fixture";
import { attentionSummary, channelIdFor, registerFileChannel, signup } from "../support/backend-e2e-client";

const BASE_URL = process.env.SPINE_E2E_BASE_URL ?? "";
const RUN = process.env.RUN_INTEGRATION === "1" && BASE_URL.length > 0;
const HEADED = process.env.AW_HEADED === "1";
const EXPECTED = expectedRows();

/** TEST-ONLY user simulation — the Runtime never clicks. */
const clickTarget = (page: Page) => page.click("[data-aw-target]");

class FeClient {
  view: ActionWindowRunView | null = null;
  events: EventEnvelope[] = [];
  frames: AwServerFrame[] = [];
  private cmdSeq = 0;
  constructor(
    private readonly transport: AwClientTransport,
    private readonly runId: string,
  ) {
    transport.subscribe((f) => {
      this.frames.push(f);
      if (f.kind === "aw_event") this.events.push(f.event);
      if (f.kind === "aw_view" && (this.view === null || f.view.revision >= this.view.revision)) this.view = f.view;
    });
  }
  send(type: CommandType, payload?: CommandEnvelope["payload"]): void {
    this.transport.send({
      kind: "aw_command",
      command: {
        protocolVersion: ACTION_WINDOW_PROTOCOL_VERSION,
        commandId: `${this.runId}-c${++this.cmdSeq}`,
        runId: this.runId,
        expectedRevision: this.view?.revision ?? 0,
        type,
        ...(payload ? { payload } : {}),
      },
    });
  }
  types(): string[] {
    return this.events.map((e) => e.type);
  }
}

async function waitFor(predicate: () => boolean, timeoutMs: number): Promise<boolean> {
  for (let waited = 0; waited < timeoutMs; waited += 150) {
    if (predicate()) return true;
    await new Promise((r) => setTimeout(r, 150));
  }
  return predicate();
}

interface RunOutcome {
  view: ActionWindowRunView | null;
  frames: AwServerFrame[];
  events: string[];
  quarantineLeftovers: string[];
}

describe.skipIf(!RUN)("Review Acquisition Spine — synthetic Action Window → real backend → attention", () => {
  let browser: Browser;
  let token: string;
  let accountId: string;
  const dirs: string[] = [];

  beforeAll(async () => {
    browser = await chromium.launch({ headless: !HEADED });
    // A fresh org per run: the proof never depends on, or disturbs, whatever else is in the target
    // database, and the org has exactly one seller account on the channel (the ambiguity guard).
    const creds = await signup(
      BASE_URL,
      `spine-e2e-${randomUUID()}@example.invalid`,
      "spine-e2e-pw-0000",
      `spine-e2e-${randomUUID().slice(0, 8)}`,
    );
    token = creds.token;
    const channelId = await channelIdFor(BASE_URL, token, "NAVER");
    accountId = await registerFileChannel(BASE_URL, token, channelId, "spine-e2e");
    // The ingest handoff logs in for itself, exactly as the live path does.
    ingest = buildBackendIngestUpload({ baseUrl: BASE_URL, email: creds.email, password: creds.password });
  }, 120_000);

  afterAll(async () => {
    await browser?.close();
    while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
  });

  let ingest: ReturnType<typeof buildBackendIngestUpload>;

  /** Drive one full synthetic Action Window run whose artifact is `base64`. */
  async function driveRun(base64: string): Promise<RunOutcome> {
    const runId = `run_spine_${randomUUID().slice(0, 8)}`;
    const quarantineDir = mkdtempSync(join(tmpdir(), "aw-spine-e2e-"));
    dirs.push(quarantineDir);
    const page = await browser.newPage();
    try {
      const channel = createLoopbackChannel();
      const engine = new ActionWindowEngine({ runId, channelCode: "naver", runCopyKey: "actionWindow.run.naver" });
      const driver = new BrowserProbeDriver(page, {
        mode: "naver-review-export-xlsx",
        reviewExportBase64: base64,
        ...(HEADED ? {} : { simulateUserAction: clickTarget }),
        observeTimeoutMs: HEADED ? 240_000 : 15_000,
        downstream: { realDetection: { timeoutMs: 15_000 }, quarantine: { dir: quarantineDir }, ingestFn: ingest },
      });
      const session = new ActionWindowSession(engine, driver, channel.server);
      session.attach();
      const fe = new FeClient(channel.client, runId);

      fe.send("START_RUN", { channelCode: "naver" });
      await session.whenSettled();
      expect(fe.view?.status).toBe("WAITING_FOR_HUMAN");

      expect(await waitFor(() => fe.types().includes("USER_ACTION_OBSERVED"), HEADED ? 240_000 : 20_000)).toBe(true);
      fe.send("REQUEST_STEP_RECHECK");
      expect(await waitFor(() => fe.view?.status === "COMPLETED" || fe.view?.status === "FAILED", 60_000)).toBe(true);

      return {
        view: fe.view,
        frames: fe.frames,
        events: fe.types(),
        quarantineLeftovers: readdirSync(quarantineDir),
      };
    } finally {
      await page.close();
    }
  }

  it("a real export reaches the backend and becomes the attention signals the contract declares", async () => {
    const run = await driveRun(reviewExportBase64());

    // The run itself.
    expect(run.view?.status).toBe("COMPLETED");
    expect(run.view?.progress).toEqual({ completedSteps: 3, totalSteps: 3 });
    expect(run.events).toContain("DOWNLOAD_DETECTED");
    expect(run.quarantineLeftovers).toEqual([]); // delete-after-validate held

    // Nothing but sanitized frames crossed the wire.
    for (const f of run.frames) {
      expect(findProhibitedFields(f)).toEqual([]);
      if (f.kind === "aw_event") expect(validateEventEnvelope(f.event)).toEqual({ ok: true });
      if (f.kind === "aw_view") expect(validateRunView(f.view)).toEqual({ ok: true });
    }

    // What the operator can now see, read back over the REAL API.
    const summary = await attentionSummary(BASE_URL, token, accountId, EXPECTED.window);
    expect(
      summary.items.map((s) => ({ type: s.type, severity: s.severity, count: s.count, sourceType: s.sourceType })),
    ).toEqual(EXPECTED.expectedAttention.signals);
  }, 300_000);

  it("re-handing the same artifact is idempotent and moves nothing", async () => {
    const before = await attentionSummary(BASE_URL, token, accountId, EXPECTED.window);

    const outcome = await ingest({ bytes: () => reviewExportBytes(), artifactRef: "00ff00ff00ff00ff", scopeEvidence: "MACHINE_MATCHED" });

    expect(outcome).toEqual({ ok: true, processed: 0 }); // all-duplicate → idempotent success
    expect(await attentionSummary(BASE_URL, token, accountId, EXPECTED.window)).toEqual(before);
  }, 120_000);

  it("an empty export completes honestly — no failure, and no invented activity", async () => {
    // The legitimate quiet-range export. It must not fail the run (that would tell a seller their
    // correct export was broken) and must not move the operator's numbers.
    const before = await attentionSummary(BASE_URL, token, accountId, EXPECTED.window);

    const run = await driveRun(reviewExportEmptyBase64());

    expect(run.view?.status).toBe("COMPLETED");
    expect(run.view?.blocker).toBeUndefined();
    expect(await attentionSummary(BASE_URL, token, accountId, EXPECTED.window)).toEqual(before);
  }, 300_000);

  it("a sniff-passing non-workbook fails as ARTIFACT_INVALID and never reaches the backend", async () => {
    // The parse gate, proven against the running system: the artifact satisfies the D-021 sniff, so
    // before the gate it would have been uploaded and rejected downstream as "저장 중 문제".
    const before = await attentionSummary(BASE_URL, token, accountId, EXPECTED.window);
    const shaped = Buffer.from([
      ...[0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x00, 0x00, 0x08, 0x00],
      ...new TextEncoder().encode("[Content_Types].xml (sellerops synthetic fixture)"),
    ]).toString("base64");

    const run = await driveRun(shaped);

    expect(run.view?.status).toBe("FAILED");
    expect(run.view?.blocker?.code).toBe("ARTIFACT_INVALID");
    expect(await attentionSummary(BASE_URL, token, accountId, EXPECTED.window)).toEqual(before);
  }, 300_000);
});
