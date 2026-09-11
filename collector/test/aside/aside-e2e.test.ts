/**
 * **Opt-in integration E2E against the REAL Aside browser on this machine — `ASIDE_E2E=1`.**
 *
 * No marketplace, no NAVER. The Aside browser opens a loopback fixture page (`test/support/aside-fixture.ts`),
 * the real serialized runtime asserts identity, fills the range, clicks exactly one export control, the browser
 * downloads the golden workbook onto the host filesystem, and the real Runner handoff takes custody: hash ==
 * fixture, a simulated ingest ACKs, the file is deleted.
 *
 * Skipped without the flag (CI has no Aside). With the flag but no running Aside the first case reports
 * `PROVIDER_UNAVAILABLE` — which is itself one of the behaviours under test, so it is asserted rather than
 * skipped when `ASIDE_E2E_EXPECT_DOWN=1`.
 *
 * Artifacts: a successful run deletes its own download. A failed download (the stall case) may leave a partial
 * file under the browser's download directory with the fixture's name; the case removes it when it can find it.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { existsSync, readdirSync, rmSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { AsideExportExecutor } from "../../src/aside/aside-export-executor";
import { AsideSegmentExecution } from "../../src/aside/aside-execution-provider";
import { runAsideRepl } from "../../src/aside/aside-cli";
import type { AwIngestSource } from "../../src/action-window/ingest-handoff";
import { fixtureWorkflow, FIXTURE_EXPORT_NAME, FIXTURE_STORE_ID, startAsideFixtureServer, type FixtureServer } from "../support/aside-fixture";
import { expectedRows } from "../support/review-export-fixture";

const ENABLED = process.env.ASIDE_E2E === "1";
const EXPECT_DOWN = process.env.ASIDE_E2E_EXPECT_DOWN === "1";
const cli = { command: process.env.ASIDE_CLI ?? "aside", ...(process.env.ASIDE_ACCOUNT ? { account: process.env.ASIDE_ACCOUNT } : {}) };
const request = { runId: "run_e2e000000001", channelCode: "naver", accountSlot: "", required: { start: "2026-01-01", end: "2026-01-31" } };
const ctx = { transport: { send: () => {}, subscribe: () => () => {} }, importRef: "9f2a1c7b4e6d0835", startFrame: { kind: "aw_resync" as const, runId: "r", sinceSequence: 0 } };

/** Best-effort: remove a leftover fixture-named download (a stalled case may leave a partial). */
function sweepFixtureDownloads(): void {
  const dl = join(homedir(), "Downloads");
  if (!existsSync(dl)) return;
  for (const name of readdirSync(dl)) {
    if (name.startsWith(FIXTURE_EXPORT_NAME.replace(/\.xlsx$/, ""))) rmSync(join(dl, name), { force: true });
  }
}

describe.skipIf(!ENABLED)("Aside E2E — real browser, local fixture, host handoff", () => {
  let server: FixtureServer;
  beforeAll(async () => {
    server = await startAsideFixtureServer();
  });
  afterAll(async () => {
    await server.close();
    sweepFixtureDownloads();
  });

  it("the CLI answers the result protocol (or is down, when expected)", async () => {
    const run = await runAsideRepl('console.log("ASIDE_RESULT " + JSON.stringify({ probe: 1 }))', { ...cli, timeoutMs: 30_000 });
    if (EXPECT_DOWN) {
      expect(run).toMatchObject({ kind: "NO_RESULT", reason: "UNAVAILABLE" });
      return;
    }
    expect(run).toMatchObject({ kind: "RESULT", result: { probe: 1 } });
  }, 60_000);

  it.skipIf(EXPECT_DOWN)("happy path: identity MATCH → fill → apply → exactly-one export → real download → custody → hash == fixture → ACK → deleted", async () => {
    const executor = new AsideExportExecutor({ workflow: fixtureWorkflow(`${server.baseUrl}/`), expectedIdentity: () => FIXTURE_STORE_ID, cli });
    const uploads: AwIngestSource[] = [];
    const provider = new AsideSegmentExecution({ executor, ingest: async (src) => (uploads.push(src), { ok: true, processed: 11 }) });
    const outcome = await provider.start(request, ctx).settled();
    expect(outcome.ok, JSON.stringify(outcome)).toBe(true);
    if (!outcome.ok) throw new Error("unreachable");
    expect(outcome.observed.artifactSha256).toBe(expectedRows().fileSha256);
    expect(outcome.scopeEvidence).toBe("MACHINE_MATCHED");
    expect(outcome.processed).toBe(11);
    expect(outcome.observed.llmCalls).toBe(0);
    expect(outcome.observed.executorVersion).toMatch(/^\d/);
    expect(server.exportsServed()).toBe(1);
    expect(uploads).toHaveLength(1);
    expect(uploads[0]!.bytes().length).toBe(outcome.observed.artifactBytes);
    // Nothing fixture-named is left in the browser's download directory.
    const leftovers = existsSync(join(homedir(), "Downloads")) ? readdirSync(join(homedir(), "Downloads")).filter((n) => n.startsWith("fixture-review-export")) : [];
    expect(leftovers).toEqual([]);
  }, 120_000);

  it.skipIf(EXPECT_DOWN)("two export controls → TARGET_AMBIGUOUS, no download served", async () => {
    const before = server.exportsServed();
    const executor = new AsideExportExecutor({ workflow: fixtureWorkflow(`${server.baseUrl}/?dup=1`), expectedIdentity: () => FIXTURE_STORE_ID, cli });
    const r = await executor.execute(request);
    expect(r).toMatchObject({ ok: false, failure: { code: "TARGET_AMBIGUOUS", stage: "EXPORT" } });
    expect(server.exportsServed()).toBe(before);
  }, 120_000);

  it.skipIf(EXPECT_DOWN)("no export control → TARGET_NOT_FOUND", async () => {
    const executor = new AsideExportExecutor({ workflow: fixtureWorkflow(`${server.baseUrl}/?noexport=1`), expectedIdentity: () => FIXTURE_STORE_ID, cli });
    expect(await executor.execute(request)).toMatchObject({ ok: false, failure: { code: "TARGET_NOT_FOUND", stage: "EXPORT" } });
  }, 120_000);

  it.skipIf(EXPECT_DOWN)("a login form on the page → AUTH_REQUIRED, nothing else touched", async () => {
    const before = server.exportsServed();
    const executor = new AsideExportExecutor({ workflow: fixtureWorkflow(`${server.baseUrl}/?auth=1`), expectedIdentity: () => FIXTURE_STORE_ID, cli });
    expect(await executor.execute(request)).toMatchObject({ ok: false, failure: { code: "AUTH_REQUIRED", stage: "AUTH", recoverable: true } });
    expect(server.exportsServed()).toBe(before);
  }, 120_000);

  it.skipIf(EXPECT_DOWN)("a different store → STORE_MISMATCH, no download served", async () => {
    const before = server.exportsServed();
    const executor = new AsideExportExecutor({ workflow: fixtureWorkflow(`${server.baseUrl}/?store=other-store`), expectedIdentity: () => FIXTURE_STORE_ID, cli });
    const r = await executor.execute(request);
    expect(r).toMatchObject({ ok: false, failure: { code: "STORE_MISMATCH", stage: "IDENTITY" } });
    expect(r.observed.identity).toBe("MISMATCH");
    expect(server.exportsServed()).toBe(before);
  }, 120_000);

  it.skipIf(EXPECT_DOWN)("a download that never completes → DOWNLOAD_TIMEOUT, no custody, no ingest", async () => {
    const executor = new AsideExportExecutor({ workflow: fixtureWorkflow(`${server.baseUrl}/?stall=1`, { downloadTimeoutMs: 8_000 }), expectedIdentity: () => FIXTURE_STORE_ID, cli });
    const uploads: AwIngestSource[] = [];
    const provider = new AsideSegmentExecution({ executor, ingest: async (src) => (uploads.push(src), { ok: true, processed: 0 }) });
    const outcome = await provider.start(request, ctx).settled();
    expect(outcome).toMatchObject({ ok: false, failure: { code: "DOWNLOAD_TIMEOUT", stage: "DOWNLOAD" } });
    expect(uploads).toHaveLength(0);
    sweepFixtureDownloads();
  }, 120_000);

  it.skipIf(EXPECT_DOWN)("a scope read-back that disagrees with the required window → SCOPE_MISMATCH before export", async () => {
    // The fixture fills the required dates itself, so force a disagreement by asking the read-back to check
    // a window the FILL steps did not write.
    const before = server.exportsServed();
    const w = fixtureWorkflow(`${server.baseUrl}/`);
    const executor = new AsideExportExecutor({
      workflow: { ...w, steps: w.steps.map((s) => (s.kind === "FILL" ? { ...s, value: "2025-12-31" } : s)) },
      expectedIdentity: () => FIXTURE_STORE_ID,
      cli,
    });
    expect(await executor.execute(request)).toMatchObject({ ok: false, failure: { code: "SCOPE_MISMATCH", stage: "SCOPE" } });
    expect(server.exportsServed()).toBe(before);
    void statSync;
  }, 120_000);
});
