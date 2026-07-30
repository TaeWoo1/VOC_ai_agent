/**
 * Real-backend integration harness for the review-reply subgraph (gated). Runs ONLY when
 * `RUN_REAL_INTEGRATION=1` and a live backend is reachable at `SELLEROPS_BASE_URL` (default
 * http://127.0.0.1:8080). SKIPPED in the hermetic `npm test`.
 *
 * It drives the actual `HttpSpringClient` against the Spring backend + disposable DB:
 * verifies the fail-closed execution boundary, the reject/approve paths, double-resume
 * idempotency (one guided ref minted), and durable restart-resume (a second runtime + shared
 * FileReviewRunStore) — all binding the SAME draft version. No LLM, no external reply, no
 * channel API.
 *
 * <b>Scenario isolation.</b> Unlike inquiry work items, a review does NOT leave the reply-work
 * worklist when it is approved (approval freezes text; it is not a phase transition). So each
 * scenario is pinned to its OWN review via {@link focus}: it triages that one review
 * RESPONSE_NEEDED and every other collected review NO_ACTION, leaving exactly one row in the
 * worklist for the graph to select deterministically.
 *
 * Assertions are API-only (no DB reads): approval state via the prep view, guided-session mint
 * via the response, and idempotent replay. Precise DB-row counts are verified separately in the
 * live proof run.
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { ReviewAgentRuntime } from "../../src/reviewRuntime";
import { HttpSpringClient } from "../../src/spring/SpringClient";
import { login } from "../../src/spring/SpringSession";
import { FileReviewRunStore } from "../../src/checkpoint/ReviewRunStore";

const RUN = process.env["RUN_REAL_INTEGRATION"] === "1";
const BASE_URL = process.env["SELLEROPS_BASE_URL"] ?? "http://127.0.0.1:8080";
const EMAIL = process.env["SELLEROPS_EMAIL"] ?? "demo@sellerops.ai";
const PASSWORD = process.env["SELLEROPS_PASSWORD"] ?? "demo1234";
const SEED_FROM = process.env["SEED_FROM"] ?? "2000-01-01";
const SEED_TO = process.env["SEED_TO"] ?? "2100-01-01";

describe.skipIf(!RUN)("review reply — real backend integration", () => {
  let token: string;
  let client: HttpSpringClient;
  let accountId: string;
  const refs: string[] = [];

  async function authed(path: string, init?: RequestInit): Promise<Response> {
    return fetch(`${BASE_URL}${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init?.headers ?? {}) },
    });
  }

  /** The review refs available on an account (metadata-only drill-down; no triage). */
  async function discover(id: string): Promise<string[]> {
    const page = (await (
      await authed(`/api/seller-accounts/${id}/attention/items?type=NEW_REVIEW&from=${SEED_FROM}&to=${SEED_TO}&size=50`)
    ).json()) as { items?: Array<{ actionRef: string | null }> };
    return (page.items ?? []).map((i) => i.actionRef).filter((r): r is string => !!r);
  }

  /**
   * Pin the worklist to exactly one review. The committed-reply-work predicate keeps a review
   * in the to-do if it is RESPONSE_NEEDED OR has a draft/approval, so NO_ACTION alone would not
   * evict a review a prior scenario already prepared. So: triage the target RESPONSE_NEEDED
   * (which also re-enters it past any earlier dismissal) and DISMISS every other collected
   * review — dismissal removes it from the to-do regardless of its draft/approval. Result: the
   * graph sees exactly one review and its selection is deterministic, independent of seed order.
   */
  async function focus(target: string): Promise<void> {
    for (const ref of refs) {
      if (ref === target) {
        await authed(`/api/seller-accounts/${accountId}/attention/items/${encodeURIComponent(ref)}/triage`, {
          method: "POST",
          body: JSON.stringify({ disposition: "RESPONSE_NEEDED", commandId: `focus-t:${target}` }),
        });
      } else {
        await authed(`/api/seller-accounts/${accountId}/attention/items/${encodeURIComponent(ref)}/reply-work/dismiss`, {
          method: "POST",
          body: JSON.stringify({ commandId: `focus-d:${target}:${ref}` }),
        });
      }
    }
  }

  beforeAll(async () => {
    token = (await login(BASE_URL, EMAIL, PASSWORD)).token;
    client = new HttpSpringClient({ baseUrl: BASE_URL, token });
    const accounts = (await (await authed("/api/seller-accounts")).json()) as Array<{ id: string }>;
    expect(accounts.length).toBeGreaterThan(0);

    // Pick the first account whose channel serves review attention (has a VocItemSource and
    // reviews) — COUPANG/etc. have no source and drill nothing; the loop lands on the covered
    // account without hardcoding a channel code.
    for (const a of accounts) {
      const found = await discover(a.id);
      if (found.length >= 4) {
        accountId = a.id;
        refs.push(...found.slice(0, 4));
        break;
      }
    }
    if (refs.length < 4) throw new Error("need >=4 reviews on a review-covered account for the proof");
  }, 120_000);

  it("fail-closed: the backend reports no reply adapter registered", async () => {
    const cap = await client.getPublishCapability();
    expect(cap.executionEnabled).toBe(false);
    expect(cap.replyAdapterChannelCodes).toEqual([]);
  });

  it("approve path: draft saved once before the checkpoint, approval bound, guided session prepared, no send", async () => {
    await focus(refs[0]!);
    const runtime = new ReviewAgentRuntime({ client });
    const started = await runtime.start("rit-approve", { intent: "HANDLE_REVIEW_REPLIES", accountId });
    expect(started.status).toBe("AWAITING_APPROVAL");
    if (started.status !== "AWAITING_APPROVAL") return;
    expect(started.checkpoint.actionRef).toBe(refs[0]);
    expect(started.checkpoint.phase).toBe("DRAFT_SAVED");
    const version = started.checkpoint.draftVersion;

    const done = await runtime.resume("rit-approve", { approved: true, approvedBy: "demo" });
    expect(done.status).toBe("DONE");
    if (done.status !== "DONE") return;
    expect(done.outcome?.decision).toBe("APPROVED");
    expect(done.outcome?.guidedSessionPrepared).toBe(true);
    expect(done.outcome?.submissionRef).toMatch(/^[0-9a-f]{16}$/);
    expect(done.outcome?.externalSendAttempted).toBe(false);

    const prep = await client.getReviewReplyPrep(accountId, refs[0]!);
    expect(prep.approval?.state).toBe("APPROVED");
    expect(prep.approval?.approvedVersion).toBe(version);
    expect(prep.draft?.version).toBe(version); // no duplicate draft version
  });

  it("reject path: no approval, no guided ref, review stays RESPONSE_NEEDED", async () => {
    await focus(refs[1]!);
    const runtime = new ReviewAgentRuntime({ client });
    const started = await runtime.start("rit-reject", { intent: "HANDLE_REVIEW_REPLIES", accountId });
    if (started.status !== "AWAITING_APPROVAL") throw new Error("expected AWAITING_APPROVAL");
    expect(started.checkpoint.actionRef).toBe(refs[1]);

    const done = await runtime.resume("rit-reject", { approved: false, approvedBy: "demo" });
    expect(done.status).toBe("DONE");
    if (done.status !== "DONE") return;
    expect(done.outcome?.decision).toBe("REJECTED");

    const prep = await client.getReviewReplyPrep(accountId, refs[1]!);
    expect(prep.approval).toBeNull();
    expect(prep.triageDisposition).toBe("RESPONSE_NEEDED");
    expect(prep.capabilities.canApprove).toBe(true);
  });

  it("double-resume is idempotent: same submissionRef, one approval", async () => {
    await focus(refs[2]!);
    const runtime = new ReviewAgentRuntime({ client });
    const started = await runtime.start("rit-dbl", { intent: "HANDLE_REVIEW_REPLIES", accountId });
    if (started.status !== "AWAITING_APPROVAL") throw new Error("expected AWAITING_APPROVAL");

    const first = await runtime.resume("rit-dbl", { approved: true, approvedBy: "demo" });
    const second = await runtime.resume("rit-dbl", { approved: true, approvedBy: "demo" });
    if (first.status !== "DONE" || second.status !== "DONE") throw new Error("expected DONE");
    expect(second.outcome?.submissionRef).toBe(first.outcome?.submissionRef);
    expect(second.outcome?.approvedFingerprint).toBe(first.outcome?.approvedFingerprint);
  });

  it("durable restart-resume: a new runtime + shared FileReviewRunStore finishes, same draft version", async () => {
    await focus(refs[3]!);
    const store = new FileReviewRunStore(mkdtempSync(join(tmpdir(), "rit-runstore-")));
    const before = new ReviewAgentRuntime({ client, runStore: store });
    const started = await before.start("rit-restart", { intent: "HANDLE_REVIEW_REPLIES", accountId });
    if (started.status !== "AWAITING_APPROVAL") throw new Error("expected AWAITING_APPROVAL");
    expect(started.checkpoint.actionRef).toBe(refs[3]);
    const version = started.checkpoint.draftVersion;

    const after = new ReviewAgentRuntime({ client, runStore: store });
    const done = await after.resume("rit-restart", { approved: true, approvedBy: "demo" });
    expect(done.status).toBe("DONE");
    if (done.status !== "DONE") return;
    expect(done.outcome?.decision).toBe("APPROVED");
    expect(done.outcome?.draftVersion).toBe(version);

    const prep = await client.getReviewReplyPrep(accountId, refs[3]!);
    expect(prep.approval?.approvedVersion).toBe(version);
    expect(prep.draft?.version).toBe(version);
  });
});
