/**
 * CLI to drive the issue-memory graph against a REAL backend. Used to prove: a deterministic,
 * checkpoint-free operations brief; the same brief after a process restart; and zero backend
 * mutation (the subgraph only reads).
 *
 * Output is sanitized: issue/product ids, severity, lifecycle state, trend kinds, and counts —
 * plus the closed-vocabulary issue labels (title/aspect/problem). Never a review body, a masked
 * quote, or an operator note (the reads that carry those are never called). Env:
 *   SELLEROPS_BASE_URL        (default http://127.0.0.1:8080)
 *   SELLEROPS_EMAIL           (default demo@sellerops.ai)
 *   SELLEROPS_PASSWORD        (default demo1234)
 *   AGENT_ISSUE_RUNSTORE_DIR  (default ./.runstore-issue)
 *   ISSUE_REFERENCE_DATE      (YYYY-MM-DD; pins the run so restart-equality is clock-independent)
 *   ISSUE_SIZE                (how many issues the brief covers; default 3)
 *
 * Usage:
 *   tsx src/cli/run-issue.ts extract                 # build issues from existing reviews (+ lifecycle pass)
 *   tsx src/cli/run-issue.ts run    --thread <id>    # run once, persist the brief, print a sanitized summary
 *   tsx src/cli/run-issue.ts verify --thread <id>    # fresh runtime re-run; report whether the brief is identical
 */
import { IssueAgentRuntime } from "../issueRuntime";
import type { IssueRunResult } from "../issueRuntime";
import { HttpSpringClient } from "../spring/SpringClient";
import { login } from "../spring/SpringSession";
import { FileIssueRunStore } from "../checkpoint/IssueRunStore";
import type { IssueBriefEntry } from "../state/IssueAgentState";

const BASE_URL = process.env["SELLEROPS_BASE_URL"] ?? "http://127.0.0.1:8080";
const EMAIL = process.env["SELLEROPS_EMAIL"] ?? "demo@sellerops.ai";
const PASSWORD = process.env["SELLEROPS_PASSWORD"] ?? "demo1234";
const RUNSTORE_DIR = process.env["AGENT_ISSUE_RUNSTORE_DIR"] ?? "./.runstore-issue";
const REFERENCE_DATE = process.env["ISSUE_REFERENCE_DATE"]; // optional; pin for restart-equality
const SIZE = Number(process.env["ISSUE_SIZE"] ?? "3");

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function token(): Promise<string> {
  return (await login(BASE_URL, EMAIL, PASSWORD)).token;
}

async function makeRuntime(): Promise<IssueAgentRuntime> {
  const client = new HttpSpringClient({ baseUrl: BASE_URL, token: await token() });
  return new IssueAgentRuntime({ client, runStore: new FileIssueRunStore(RUNSTORE_DIR) });
}

async function authedFetch(path: string, init?: RequestInit): Promise<Response> {
  return fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${await token()}`, "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
}

/** Sanitized brief summary — safe to print (ids, labels, enums, counts; never review text). */
function summarize(res: IssueRunResult) {
  return {
    referenceDate: res.brief.referenceDate,
    totalActiveIssues: res.brief.totalActiveIssues,
    selectedCount: res.brief.selectedCount,
    note: res.brief.note,
    entries: res.brief.entries.map((e: IssueBriefEntry) => ({
      issueId: e.issueId,
      rank: e.rank,
      priorityBucket: e.priorityBucket,
      title: e.title,
      severity: e.severity,
      lifecycleState: e.lifecycleState,
      trendKinds: e.trend.kinds,
      highSurge: e.trend.highSurge,
      surgeWindowCount: e.trend.surgeWindowCount,
      evidenceCount: e.evidenceCount,
      dominantProductId: e.dominantProductId,
      byProducts: e.evidenceSummary.byProduct.length,
      ratingDistribution: e.evidenceSummary.ratingDistribution,
    })),
    trail: res.trail,
  };
}

function goalRequest() {
  return {
    intent: "HANDLE_OPERATIONS_ISSUES",
    size: Number.isFinite(SIZE) ? SIZE : 3,
    ...(REFERENCE_DATE ? { referenceDate: REFERENCE_DATE } : {}),
  };
}

async function main(): Promise<void> {
  const cmd = process.argv[2];

  if (cmd === "extract") {
    // Build/refresh the issue memory from whatever reviews the org already has, then run the two
    // automatic lifecycle transitions so change judgements fire. Both are idempotent.
    const ref = REFERENCE_DATE ? `?referenceDate=${encodeURIComponent(REFERENCE_DATE)}` : "";
    const ext = await authedFetch(`/api/review-issues/extract?limit=500&page=0`, { method: "POST" });
    const pass = await authedFetch(`/api/review-issues/lifecycle-pass${ref}`, { method: "POST" });
    console.log(JSON.stringify({ action: "extract", extractStatus: ext.status, lifecycleStatus: pass.status }));
    return;
  }

  const thread = arg("thread");
  if (!thread) throw new Error("--thread is required");
  const runtime = await makeRuntime();

  if (cmd === "run") {
    const res = await runtime.run(thread, goalRequest());
    console.log(JSON.stringify({ action: "run", ...summarize(res) }));
    return;
  }

  if (cmd === "verify") {
    // Fresh runtime sharing the durable store: re-run and compare to the persisted brief.
    const prior = await runtime.runStore.load(thread);
    if (!prior) throw new Error(`no persisted brief for thread ${thread}; run it first`);
    const fresh = await makeRuntime();
    const res = await fresh.run(thread, goalRequest());
    const identical = JSON.stringify(res.brief) === JSON.stringify(prior.brief);
    console.log(JSON.stringify({ action: "verify", identical, ...summarize(res) }));
    if (!identical) process.exit(2);
    return;
  }

  throw new Error(`unknown command: ${cmd ?? "(none)"} — use extract|run|verify`);
}

main().catch((err) => {
  console.error(JSON.stringify({ error: err?.name ?? "Error", message: String(err?.message ?? err) }));
  process.exit(1);
});
