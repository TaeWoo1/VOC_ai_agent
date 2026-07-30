import { afterEach, describe, expect, it } from "vitest";
import { IssueAgentRuntime } from "../../src/issueRuntime";
import { FileIssueRunStore } from "../../src/checkpoint/IssueRunStore";
import { mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FakeIssueSpringClient } from "../support/FakeIssueSpringClient";
import { fourIssues } from "../support/issueFixtures";
import { getLogSink, clearLogSink } from "../../src/log";

const REF = "2026-07-25";
const LEAK = "고객이 남긴 원문 본문 — 절대 유출 금지";

describe("issue-memory sanitization", () => {
  afterEach(() => clearLogSink());

  it("the search-node projection drops an unexpected customer-text field from the backend row", async () => {
    // The fake sneaks a `redactedBody` onto each search row; the runtime must never carry it.
    const client = new FakeIssueSpringClient(fourIssues(), { leakInSearch: true });
    const runtime = new IssueAgentRuntime({ client });
    const res = await runtime.run("s1", { intent: "HANDLE_OPERATIONS_ISSUES", referenceDate: REF, size: 3 });

    const briefJson = JSON.stringify(res.brief);
    expect(briefJson).not.toContain(LEAK);
    expect(briefJson).not.toContain("redactedBody");
  });

  it("the composed brief and durable snapshot carry only allowlisted, quote-free fields", async () => {
    const dir = mkdtempSync(join(tmpdir(), "issue-sanit-"));
    const runtime = new IssueAgentRuntime({
      client: new FakeIssueSpringClient(fourIssues(), { leakInSearch: true }),
      runStore: new FileIssueRunStore(dir),
    });
    await runtime.run("s2", { intent: "HANDLE_OPERATIONS_ISSUES", referenceDate: REF, size: 3 });

    const file = readdirSync(dir).find((f) => f.startsWith("s2"));
    expect(file).toBeDefined();
    const snapshot = readFileSync(join(dir, file!), "utf8");

    // No customer text, no free-text note key, no quote/body key anywhere in the persisted brief.
    expect(snapshot).not.toContain(LEAK);
    for (const forbidden of ["redactedBody", "\"body\"", "\"quote\"", "\"note\"", "safePreview"]) {
      expect(snapshot).not.toContain(forbidden);
    }
  });

  it("every emitted log record is metadata-only (no content values, no content keys)", async () => {
    const sink = getLogSink();
    const runtime = new IssueAgentRuntime({ client: new FakeIssueSpringClient(fourIssues(), { leakInSearch: true }) });
    await runtime.run("s3", { intent: "HANDLE_OPERATIONS_ISSUES", referenceDate: REF, size: 3 });

    expect(sink.length).toBeGreaterThan(0);
    for (const rec of sink) {
      const asText = JSON.stringify(rec);
      expect(asText).not.toContain(LEAK);
      for (const key of Object.keys(rec.meta)) {
        expect(key).not.toMatch(/body|quote|note|title|content|author|snippet|text/i);
      }
      // Values are scalars or type tags only.
      for (const v of Object.values(rec.meta)) {
        expect(["string", "number", "boolean"].includes(typeof v) || String(v).startsWith("<")).toBe(true);
      }
    }
  });
});
