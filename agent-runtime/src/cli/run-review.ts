/**
 * CLI to drive the review-reply graph against a REAL backend — used to prove cross-process
 * restart-resume: run `start` in one process (it parks at the checkpoint, writes the durable
 * snapshot, and exits — as if killed), then run `resume` in a SEPARATE process (fresh
 * in-memory checkpointer) which reconstructs from the durable store and finishes.
 *
 * Output is sanitized: ids/phase/category/decision/opaque-ref only — never the review body,
 * the draft/reply text, or a token. Env:
 *   SELLEROPS_BASE_URL       (default http://127.0.0.1:8080)
 *   SELLEROPS_EMAIL          (default demo@sellerops.ai)
 *   SELLEROPS_PASSWORD       (default demo1234)
 *   AGENT_REVIEW_RUNSTORE_DIR(default ./.runstore-review)
 *   SEED_FROM / SEED_TO      (KST dates for the seed drill-down window; default a wide span)
 *
 * Usage:
 *   tsx src/cli/run-review.ts seed   --account <uuid> [--limit 3]
 *   tsx src/cli/run-review.ts start  --thread <id> --account <uuid>
 *   tsx src/cli/run-review.ts resume --thread <id> --decision approve|reject
 */
import { ReviewAgentRuntime } from "../reviewRuntime";
import { HttpSpringClient } from "../spring/SpringClient";
import { login } from "../spring/SpringSession";
import { FileReviewRunStore } from "../checkpoint/ReviewRunStore";

const BASE_URL = process.env["SELLEROPS_BASE_URL"] ?? "http://127.0.0.1:8080";
const EMAIL = process.env["SELLEROPS_EMAIL"] ?? "demo@sellerops.ai";
const PASSWORD = process.env["SELLEROPS_PASSWORD"] ?? "demo1234";
const RUNSTORE_DIR = process.env["AGENT_REVIEW_RUNSTORE_DIR"] ?? "./.runstore-review";
const SEED_FROM = process.env["SEED_FROM"] ?? "2000-01-01";
const SEED_TO = process.env["SEED_TO"] ?? "2100-01-01";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function makeRuntime(): Promise<ReviewAgentRuntime> {
  const { token } = await login(BASE_URL, EMAIL, PASSWORD);
  const client = new HttpSpringClient({ baseUrl: BASE_URL, token });
  return new ReviewAgentRuntime({ client, runStore: new FileReviewRunStore(RUNSTORE_DIR) });
}

async function authedFetch(path: string, init?: RequestInit): Promise<Response> {
  const { token } = await login(BASE_URL, EMAIL, PASSWORD);
  return fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
}

async function resolveAccount(): Promise<string> {
  const explicit = arg("account");
  if (explicit) return explicit;
  const accounts = (await (await authedFetch("/api/seller-accounts")).json()) as Array<{ id: string }>;
  if (accounts.length === 0) throw new Error("no seller accounts seeded");
  return accounts[0]!.id;
}

/**
 * Seed RESPONSE_NEEDED reviews: sync reviews via the offline mock connector, discover their
 * refs via the metadata-only attention drill-down, and triage the first N as 대응 필요.
 * No channel/external call; no review content printed.
 */
async function seed(): Promise<void> {
  const accountId = await resolveAccount();
  const limit = Number(arg("limit") ?? "3");
  const syncRes = await authedFetch(`/api/seller-accounts/${accountId}/sync`, {
    method: "POST",
    body: JSON.stringify({ dataType: "REVIEW" }),
  });
  const itemsRes = await authedFetch(
    `/api/seller-accounts/${accountId}/attention/items?type=NEW_REVIEW&from=${SEED_FROM}&to=${SEED_TO}&size=50`,
  );
  const page = (await itemsRes.json()) as { items?: Array<{ actionRef: string | null }> };
  const refs = (page.items ?? []).map((i) => i.actionRef).filter((r): r is string => !!r).slice(0, limit);
  let triaged = 0;
  for (const ref of refs) {
    const res = await authedFetch(
      `/api/seller-accounts/${accountId}/attention/items/${encodeURIComponent(ref)}/triage`,
      { method: "POST", body: JSON.stringify({ disposition: "RESPONSE_NEEDED", commandId: `seed-triage:${ref}` }) },
    );
    if (res.ok) triaged += 1;
  }
  console.log(JSON.stringify({ action: "seed", syncStatus: syncRes.status, discovered: refs.length, triaged }));
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
    const accountId = await resolveAccount();
    const res = await runtime.start(thread, { intent: "HANDLE_REVIEW_REPLIES", accountId });
    if (res.status === "AWAITING_APPROVAL") {
      console.log(
        JSON.stringify({
          action: "start",
          status: res.status,
          actionRef: res.checkpoint.actionRef,
          draftVersion: res.checkpoint.draftVersion,
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
  console.error(JSON.stringify({ error: err?.name ?? "Error", message: String(err?.message ?? err) }));
  process.exit(1);
});
