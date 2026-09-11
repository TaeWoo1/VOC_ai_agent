/**
 * The executor over the FAKE CLI. Two layers:
 *  - mapping: every no-result classification and every runtime code lands on the provider taxonomy with the
 *    right recoverability; off-shape results are faults, not successes;
 *  - the whole offline chain: the REAL program text (serialized runtime + JSON plan) is evaluated by the fake
 *    CLI against a described page, the fake "download" writes real fixture bytes to a temp path, and the REAL
 *    handoff takes custody — the M2 E2E shape with no Aside installed.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { AsideExportExecutor, failureOfNoResult, parseRuntimeResult } from "../../src/aside/aside-export-executor";
import { AsideSegmentExecution } from "../../src/aside/aside-execution-provider";
import type { AwIngestSource } from "../../src/action-window/ingest-handoff";
import { fixtureWorkflow, FIXTURE_EXPORT_NAME, FIXTURE_STORE_ID } from "../support/aside-fixture";
import { expectedRows, REVIEW_EXPORT_FIXTURE_PATH } from "../support/review-export-fixture";

const HERE = resolve(fileURLToPath(import.meta.url), "..");
const FAKE = resolve(HERE, "../support/fake-aside-cli.mjs");
const cli = { command: process.execPath, prefixArgs: [FAKE] };

const request = { runId: "run_0123456789ab", channelCode: "naver", accountSlot: "slot", required: { start: "2026-01-01", end: "2026-01-31" } };

let dir = "";
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "aside-exec-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  for (const k of Object.keys(process.env)) if (k.startsWith("FAKE_ASIDE_")) delete process.env[k];
});

const ENTRY = "http://127.0.0.1:9/fixture";

describe("executor — mapping", () => {
  it("no-result classifications map to provider codes with recoverability", () => {
    expect(failureOfNoResult("UNAVAILABLE")).toEqual({ code: "PROVIDER_UNAVAILABLE", stage: "EXECUTOR", recoverable: true });
    expect(failureOfNoResult("TIMEOUT")).toEqual({ code: "PROVIDER_TIMEOUT", stage: "EXECUTOR", recoverable: true });
    expect(failureOfNoResult("REFUSED")).toEqual({ code: "PROVIDER_REFUSED", stage: "EXECUTOR", recoverable: false });
    expect(failureOfNoResult("FAULT")).toEqual({ code: "RUNTIME_FAULT", stage: "EXECUTOR", recoverable: false });
  });
  it("off-shape runtime results are rejected — a success needs a path, MATCH, and a known evidence value", () => {
    expect(parseRuntimeResult({ ok: true })).toBeNull();
    expect(parseRuntimeResult({ ok: true, hostPath: "/p", identity: "MISMATCH", scopeEvidence: "MACHINE_MATCHED" })).toBeNull();
    expect(parseRuntimeResult({ ok: true, hostPath: "/p", identity: "MATCH", scopeEvidence: "SOMETHING" })).toBeNull();
    expect(parseRuntimeResult({ ok: false, code: "MADE_UP", stage: "EXPORT" })).toBeNull();
    expect(parseRuntimeResult({ ok: false, code: "TARGET_AMBIGUOUS", stage: "EXPORT", candidates: 2 })).toMatchObject({ ok: false, code: "TARGET_AMBIGUOUS", candidates: 2 });
    expect(parseRuntimeResult("nope")).toBeNull();
  });
  it("a malformed workflow is refused at construction", () => {
    expect(() => new AsideExportExecutor({ workflow: fixtureWorkflow("not a url"), expectedIdentity: () => "x", cli })).toThrow(/workflow invalid/);
  });

  it("daemon down → PROVIDER_UNAVAILABLE (recoverable)", async () => {
    process.env.FAKE_ASIDE_MODE = "down";
    const ex = new AsideExportExecutor({ workflow: fixtureWorkflow(ENTRY), expectedIdentity: () => FIXTURE_STORE_ID, cli });
    const r = await ex.execute(request);
    expect(r).toMatchObject({ ok: false, failure: { code: "PROVIDER_UNAVAILABLE", stage: "EXECUTOR", recoverable: true } });
    expect(r.observed.executorVersion).toBe("9.9.9-fake");
    expect(r.observed.llmCalls).toBe(0);
  });
  it("malformed response → RUNTIME_FAULT", async () => {
    process.env.FAKE_ASIDE_MODE = "malformed";
    const ex = new AsideExportExecutor({ workflow: fixtureWorkflow(ENTRY), expectedIdentity: () => FIXTURE_STORE_ID, cli });
    expect(await ex.execute(request)).toMatchObject({ ok: false, failure: { code: "RUNTIME_FAULT" } });
  });
  it("timeout → PROVIDER_TIMEOUT", async () => {
    process.env.FAKE_ASIDE_MODE = "hang";
    const ex = new AsideExportExecutor({ workflow: fixtureWorkflow(ENTRY), expectedIdentity: () => FIXTURE_STORE_ID, cli: { ...cli, timeoutMs: 300 } });
    expect(await ex.execute(request)).toMatchObject({ ok: false, failure: { code: "PROVIDER_TIMEOUT", recoverable: true } });
  });
  it("a runtime failure code passes through with its stage and identity observation", async () => {
    process.env.FAKE_ASIDE_MODE = "result";
    process.env.FAKE_ASIDE_RESULT = JSON.stringify({ ok: false, code: "STORE_MISMATCH", stage: "IDENTITY", elapsedMs: 5 });
    const ex = new AsideExportExecutor({ workflow: fixtureWorkflow(ENTRY), expectedIdentity: () => FIXTURE_STORE_ID, cli });
    const r = await ex.execute(request);
    expect(r).toMatchObject({ ok: false, failure: { code: "STORE_MISMATCH", stage: "IDENTITY", recoverable: false } });
    expect(r.observed.identity).toBe("MISMATCH");
  });
});

/** The page the fake CLI evaluates the real program against. */
function fixturePage(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    counts: { "#store-name": 1, "#start": 1, "#end": 1, "#apply": 1, "#applied:not(:empty)": 1, ".export": 1 },
    texts: { "#store-name": FIXTURE_STORE_ID },
    download: { path: join(dir, "aside-download.xlsx"), name: FIXTURE_EXPORT_NAME },
    ...overrides,
  });
}

describe("executor + provider — the whole offline chain over the real program text", () => {
  it("plan → program → (fake) browser → download on disk → custody → hash == fixture → ingest ACK → file deleted", async () => {
    process.env.FAKE_ASIDE_MODE = "program";
    process.env.FAKE_ASIDE_PAGE = fixturePage();
    process.env.FAKE_ASIDE_DOWNLOAD_BYTES_PATH = REVIEW_EXPORT_FIXTURE_PATH;
    process.env.FAKE_ASIDE_TRACE_OUT = join(dir, "trace.json");
    const ex = new AsideExportExecutor({ workflow: fixtureWorkflow(ENTRY), expectedIdentity: () => FIXTURE_STORE_ID, cli });
    const uploads: AwIngestSource[] = [];
    const provider = new AsideSegmentExecution({
      executor: ex,
      ingest: async (src) => {
        uploads.push(src);
        return { ok: true, processed: 6 };
      },
    });
    const run = provider.start(request, { transport: { send: () => {}, subscribe: () => () => {} }, importRef: "9f2a1c7b4e6d0835", startFrame: { kind: "aw_resync", runId: "r", sinceSequence: 0 } });
    const outcome = await run.settled();
    expect(outcome.ok, JSON.stringify(outcome)).toBe(true);
    if (!outcome.ok) throw new Error("unreachable");
    expect(outcome.observed.artifactSha256).toBe(expectedRows().fileSha256);
    expect(outcome.scopeEvidence).toBe("MACHINE_MATCHED");
    expect(outcome.processed).toBe(6);
    expect(existsSync(join(dir, "aside-download.xlsx"))).toBe(false);
    expect(uploads).toHaveLength(1);
    expect(uploads[0]!.bytes().length).toBe(outcome.observed.artifactBytes);
    const trace = JSON.parse(readFileSync(join(dir, "trace.json"), "utf8")) as { calls: string[]; opened: number; closed: number };
    expect(trace.calls).toEqual(["fill:#start", "fill:#end", "click:#apply", "click:.export"]);
    expect(trace).toMatchObject({ opened: 1, closed: 1 });
  });

  it("two export controls on the page → TARGET_AMBIGUOUS, no download, no ingest", async () => {
    process.env.FAKE_ASIDE_MODE = "program";
    process.env.FAKE_ASIDE_PAGE = fixturePage({ counts: { "#store-name": 1, "#start": 1, "#end": 1, "#apply": 1, "#applied:not(:empty)": 1, ".export": 2 } });
    process.env.FAKE_ASIDE_TRACE_OUT = join(dir, "trace.json");
    const ex = new AsideExportExecutor({ workflow: fixtureWorkflow(ENTRY), expectedIdentity: () => FIXTURE_STORE_ID, cli });
    const uploads: AwIngestSource[] = [];
    const provider = new AsideSegmentExecution({ executor: ex, ingest: async (src) => (uploads.push(src), { ok: true, processed: 0 }) });
    const outcome = await provider.start(request, { transport: { send: () => {}, subscribe: () => () => {} }, importRef: "9f2a1c7b4e6d0835", startFrame: { kind: "aw_resync", runId: "r", sinceSequence: 0 } }).settled();
    expect(outcome).toMatchObject({ ok: false, failure: { code: "TARGET_AMBIGUOUS", stage: "EXPORT" } });
    expect(uploads).toHaveLength(0);
    const trace = JSON.parse(readFileSync(join(dir, "trace.json"), "utf8")) as { calls: string[] };
    expect(trace.calls).not.toContain("click:.export");
    expect(existsSync(join(dir, "aside-download.xlsx"))).toBe(false);
  });

  it("a different store on the page → STORE_MISMATCH before any step", async () => {
    process.env.FAKE_ASIDE_MODE = "program";
    process.env.FAKE_ASIDE_PAGE = fixturePage({ texts: { "#store-name": "someone-elses-store" } });
    process.env.FAKE_ASIDE_TRACE_OUT = join(dir, "trace.json");
    const ex = new AsideExportExecutor({ workflow: fixtureWorkflow(ENTRY), expectedIdentity: () => FIXTURE_STORE_ID, cli });
    const r = await ex.execute(request);
    expect(r).toMatchObject({ ok: false, failure: { code: "STORE_MISMATCH", stage: "IDENTITY" } });
    expect(JSON.parse(readFileSync(join(dir, "trace.json"), "utf8")).calls).toEqual([]);
  });

  it("no expectation bound → STORE_UNRESOLVED (not a success)", async () => {
    process.env.FAKE_ASIDE_MODE = "program";
    process.env.FAKE_ASIDE_PAGE = fixturePage();
    const ex = new AsideExportExecutor({ workflow: fixtureWorkflow(ENTRY), expectedIdentity: () => null, cli });
    expect(await ex.execute(request)).toMatchObject({ ok: false, failure: { code: "STORE_UNRESOLVED" } });
  });
});
