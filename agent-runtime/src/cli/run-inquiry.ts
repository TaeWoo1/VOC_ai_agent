/**
 * CLI to drive the inquiry graph against a REAL backend — used to prove cross-process
 * restart-resume: run `start` in one process (it parks at the checkpoint, writes the
 * durable snapshot, and exits — as if killed), then run `resume` in a SEPARATE process
 * (fresh in-memory checkpointer) which reconstructs from the durable store and finishes.
 *
 * Output is sanitized: it prints ids/phase/category/decision only — never the draft
 * title/body/comments, and never a token. Env:
 *   SELLEROPS_BASE_URL   (default http://127.0.0.1:8080)
 *   SELLEROPS_EMAIL      (default demo@sellerops.ai)
 *   SELLEROPS_PASSWORD   (default demo1234)
 *   AGENT_RUNSTORE_DIR   (default ./.runstore)
 *
 * Usage:
 *   tsx src/cli/run-inquiry.ts seed
 *   tsx src/cli/run-inquiry.ts start  --thread <id>
 *   tsx src/cli/run-inquiry.ts resume --thread <id> --decision approve|reject
 */
import { InquiryAgentRuntime } from "../runtime";
import { HttpSpringClient } from "../spring/SpringClient";
import { login } from "../spring/SpringSession";
import { FileRunStore } from "../checkpoint/RunStore";

const BASE_URL = process.env["SELLEROPS_BASE_URL"] ?? "http://127.0.0.1:8080";
const EMAIL = process.env["SELLEROPS_EMAIL"] ?? "demo@sellerops.ai";
const PASSWORD = process.env["SELLEROPS_PASSWORD"] ?? "demo1234";
const RUNSTORE_DIR = process.env["AGENT_RUNSTORE_DIR"] ?? "./.runstore";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function makeRuntime(): Promise<InquiryAgentRuntime> {
  const { token } = await login(BASE_URL, EMAIL, PASSWORD);
  const client = new HttpSpringClient({ baseUrl: BASE_URL, token });
  return new InquiryAgentRuntime({ client, runStore: new FileRunStore(RUNSTORE_DIR) });
}

async function authedFetch(path: string, init?: RequestInit): Promise<Response> {
  const { token } = await login(BASE_URL, EMAIL, PASSWORD);
  return fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
}

/** Seed OPEN inquiry work items via the offline MockApiConnector (no channel, no external call). */
async function seed(): Promise<void> {
  const accountsRes = await authedFetch("/api/seller-accounts");
  const accounts = (await accountsRes.json()) as Array<{ id: string }>;
  if (accounts.length === 0) throw new Error("no seller accounts seeded");
  const accountId = accounts[0]!.id;
  const syncRes = await authedFetch(`/api/seller-accounts/${accountId}/sync`, {
    method: "POST",
    body: JSON.stringify({ dataType: "INQUIRY" }),
  });
  const openRes = await authedFetch("/api/inquiries?phase=OPEN&size=100");
  const open = (await openRes.json()) as { totalElements: number };
  console.log(JSON.stringify({ action: "seed", syncStatus: syncRes.status, openTotal: open.totalElements }));
}

async function main(): Promise<void> {
  const cmd = process.argv[2];
  if (cmd === "seed") {
    await seed();
    return;
  }
  const thread = arg("thread");
  if (!thread) throw new Error("--thread is required");

  const runtime = await makeRuntime();

  if (cmd === "start") {
    const res = await runtime.start(thread, { intent: "HANDLE_UNANSWERED_INQUIRIES" });
    if (res.status === "AWAITING_APPROVAL") {
      // Sanitized only — no candidate content.
      console.log(
        JSON.stringify({
          action: "start",
          status: res.status,
          workItemId: res.checkpoint.workItemId,
          phase: res.checkpoint.phase,
          priorityBucket: res.checkpoint.priorityBucket,
          category: res.checkpoint.category,
          trail: res.trail,
        }),
      );
    } else {
      console.log(JSON.stringify({ action: "start", status: res.status, outcome: res.outcome }));
    }
    return;
  }

  if (cmd === "resume") {
    const decision = arg("decision");
    if (decision !== "approve" && decision !== "reject") throw new Error("--decision approve|reject");
    const res = await runtime.resume(thread, { approved: decision === "approve", approvedBy: "cli-operator" });
    console.log(
      JSON.stringify({
        action: "resume",
        status: res.status,
        outcome: res.status === "DONE" ? res.outcome : undefined,
        trail: res.trail,
      }),
    );
    return;
  }

  throw new Error(`unknown command: ${cmd ?? "(none)"} — use seed|start|resume`);
}

main().catch((err) => {
  // Sanitized error: name + message only (SpringApiError carries no body).
  console.error(JSON.stringify({ error: err?.name ?? "Error", message: String(err?.message ?? err) }));
  process.exit(1);
});
