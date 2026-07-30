/**
 * Contract tests for {@link AgentRunService} — the transport-agnostic brain of the HTTP surface.
 *
 * These run entirely offline against the three contract-faithful fakes plus a fake identity: they
 * prove routing, the sanitized run views (no customer 원문 in any response), the fail-closed
 * execution guard, intent/scope rejection, the issue no-checkpoint path, idempotent double-resume,
 * cross-instance (restart-equivalent) resume via a shared file store, and — critically —
 * TENANT ISOLATION: one org can never read/resume another org's run, and a token the backend
 * rejects (fake identity throws) fails closed.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AgentRunService } from "../../src/http/AgentRunService";
import type { SpringClientBundle, SpringClientFactory } from "../../src/http/AgentRunService";
import { RunStoreProvider } from "../../src/http/runStoreProvider";
import type { RuntimeConfig } from "../../src/http/config";
import { toHttpError } from "../../src/http/errors";
import { SpringApiError } from "../../src/spring/SpringClient";
import type { IdentitySpringClient } from "../../src/spring/IdentitySpringClient";
import { clearLogSink, getLogSink } from "../../src/log";
import { FakeSpringClient } from "../support/FakeSpringClient";
import { FakeReviewSpringClient } from "../support/FakeReviewSpringClient";
import { FakeIssueSpringClient } from "../support/FakeIssueSpringClient";
import { twoInquiries, PHONE_TOKEN, EMAIL_TOKEN } from "../support/fixtures";
import { twoReviews } from "../support/reviewFixtures";
import { fourIssues } from "../support/issueFixtures";

const ACCOUNT = "acct-1";
const ORG_A = "org-aaaa";
const ORG_B = "org-bbbb";

function config(kind: "file" | "memory", dir: string): RuntimeConfig {
  return {
    port: 0,
    backendBaseUrl: "http://unused",
    env: "development",
    runStoreKind: kind,
    runStoreDir: dir,
    corsAllowedOrigins: [],
  };
}

interface Fakes {
  inquiry: FakeSpringClient;
  review: FakeReviewSpringClient;
  issue: FakeIssueSpringClient;
}

function freshFakes(): Fakes {
  return {
    inquiry: new FakeSpringClient(twoInquiries()),
    review: new FakeReviewSpringClient(twoReviews()),
    issue: new FakeIssueSpringClient(fourIssues()),
  };
}

/** A fake identity that maps ANY token to a fixed org (the token content is irrelevant to fakes). */
function identityFor(orgId: string): IdentitySpringClient {
  return { whoami: async () => ({ userId: `u-${orgId}`, orgId }) };
}

function factoryFor(fakes: Fakes, orgId: string): SpringClientFactory {
  return (): SpringClientBundle => ({
    inquiry: fakes.inquiry,
    review: fakes.review,
    issue: fakes.issue,
    identity: identityFor(orgId),
  });
}

function serviceWith(fakes: Fakes, provider: RunStoreProvider, orgId = ORG_A): AgentRunService {
  return new AgentRunService({ storeProvider: provider, clientFactory: factoryFor(fakes, orgId), env: "test" });
}

describe("AgentRunService contract", () => {
  let fakes: Fakes;
  let provider: RunStoreProvider;
  let service: AgentRunService;

  beforeEach(() => {
    fakes = freshFakes();
    provider = new RunStoreProvider(config("memory", "./unused"));
    service = serviceWith(fakes, provider);
  });

  afterEach(() => clearLogSink());

  it("capabilities lists three intents, fail-closed send, store mode", () => {
    const cap = service.capabilities();
    expect(cap.intents.map((i) => i.domain).sort()).toEqual(["INQUIRY", "ISSUE", "REVIEW"]);
    expect(cap.externalSend).toBe("disabled");
    expect(cap.runStore.kind).toBe("memory");
    expect(cap.intents.find((i) => i.domain === "REVIEW")!.requiresAccountScope).toBe(true);
    expect(cap.intents.find((i) => i.domain === "ISSUE")!.hasCheckpoint).toBe(false);
  });

  it("inquiry: start parks at a checkpoint exposing only the templated reply — no customer 원문", async () => {
    const view = await service.start("tok", { goalText: "미답변 문의 처리해줘" });
    expect(view.domain).toBe("INQUIRY");
    expect(view.status).toBe("AWAITING_APPROVAL");
    expect(view.checkpoint?.kind).toBe("INQUIRY_REPLY_APPROVAL");
    const cp = view.checkpoint as { replyDraft?: string };
    expect(cp.replyDraft).toContain("안녕하세요");
    const serialized = JSON.stringify(view);
    for (const leak of [PHONE_TOKEN, EMAIL_TOKEN, "사이즈 문의", "환불 요청", "색상 옵션"]) {
      expect(serialized).not.toContain(leak);
    }
  });

  it("inquiry: resume approve records at the backend and never sends", async () => {
    const start = await service.start("tok", { intent: "HANDLE_UNANSWERED_INQUIRIES" });
    const done = await service.resume("tok", start.threadId, { approved: true, approvedBy: "SELLER:test" });
    expect(done.status).toBe("DONE");
    expect((done.outcome as { decision: string }).decision).toBe("APPROVED");
    expect((done.outcome as { externalSendAttempted: boolean }).externalSendAttempted).toBe(false);
    expect(fakes.inquiry.externalSendAttempts).toBe(0);
    const wid = (start.checkpoint as { workItemId: string }).workItemId;
    expect(fakes.inquiry.auditEvents(wid)).toContain("APPROVAL_GRANTED");
  });

  it("inquiry: resume reject records a rejection, no send", async () => {
    const start = await service.start("tok", { intent: "HANDLE_UNANSWERED_INQUIRIES" });
    const done = await service.resume("tok", start.threadId, { approved: false });
    expect(done.status).toBe("DONE");
    expect((done.outcome as { decision: string }).decision).toBe("REJECTED");
    expect(fakes.inquiry.externalSendAttempts).toBe(0);
  });

  it("review: checkpoint carries version+fingerprint, no body/reply text; approve mints once (idempotent)", async () => {
    const start = await service.start("tok", { intent: "HANDLE_REVIEW_REPLIES", accountId: ACCOUNT });
    expect(start.domain).toBe("REVIEW");
    expect(start.status).toBe("AWAITING_APPROVAL");
    const cp = start.checkpoint as unknown as Record<string, unknown>;
    expect(cp["kind"]).toBe("REVIEW_REPLY_APPROVAL");
    expect(cp["draftFingerprint"]).toBeTruthy();
    expect(Object.keys(cp)).not.toContain("body");
    expect(Object.keys(cp)).not.toContain("replyDraft");
    expect(JSON.stringify(start)).not.toContain(PHONE_TOKEN);
    expect(JSON.stringify(start)).not.toContain(EMAIL_TOKEN);

    const done = await service.resume("tok", start.threadId, { approved: true, approvedBy: "SELLER:test" });
    expect(done.status).toBe("DONE");
    expect((done.outcome as { guidedSessionPrepared: boolean }).guidedSessionPrepared).toBe(true);
    expect(fakes.review.mintCount).toBe(1);
    const again = await service.resume("tok", start.threadId, { approved: true, approvedBy: "SELLER:test" });
    expect(again.status).toBe("DONE");
    expect(fakes.review.mintCount).toBe(1);
    expect(fakes.review.externalSendAttempts).toBe(0);
  });

  it("issue: run returns a quote-free brief straight to DONE; resume is a 409 (no checkpoint)", async () => {
    const view = await service.start("tok", { goalText: "지금 먼저 확인할 운영 이슈는 뭐야", size: 3 });
    expect(view.domain).toBe("ISSUE");
    expect(view.status).toBe("DONE");
    expect(view.brief!.selectedCount).toBeGreaterThan(0);
    expect(JSON.stringify(view)).not.toContain("원문");

    await expect(service.resume("tok", view.threadId, { approved: true })).rejects.toMatchObject({
      status: 409,
      code: "NO_CHECKPOINT",
    });
  });

  it("rejects an unrecognized intent (400) and a review run with no account scope (400)", async () => {
    await expect(service.start("tok", { intent: "NONSENSE_INTENT" })).rejects.toMatchObject({
      status: 400,
      code: "UNRECOGNIZED_GOAL",
    });
    await expect(service.start("tok", { intent: "HANDLE_REVIEW_REPLIES" })).rejects.toMatchObject({
      status: 400,
      code: "MISSING_ACCOUNT_SCOPE",
    });
  });

  it("fails closed when the backend send path is enabled", async () => {
    const enabled: Fakes = {
      inquiry: new FakeSpringClient(twoInquiries(), { dispatchAdapterEnabled: true }),
      review: new FakeReviewSpringClient(twoReviews(), { dispatchAdapterEnabled: true }),
      issue: new FakeIssueSpringClient(fourIssues()),
    };
    const svc = serviceWith(enabled, new RunStoreProvider(config("memory", "./unused")));
    const err = await svc.start("tok", { intent: "HANDLE_UNANSWERED_INQUIRIES" }).catch((e) => e);
    expect(toHttpError(err)).toMatchObject({ status: 409, code: "EXECUTION_ENABLED" });
    expect(enabled.inquiry.externalSendAttempts).toBe(0);
  });

  it("GET returns a sanitized snapshot; unknown thread is a 404", async () => {
    await expect(service.get("tok", "does-not-exist")).rejects.toMatchObject({ status: 404, code: "UNKNOWN_THREAD" });
    const start = await service.start("tok", { intent: "HANDLE_UNANSWERED_INQUIRIES" });
    const got = await service.get("tok", start.threadId);
    expect(got.domain).toBe("INQUIRY");
    expect(got.status).toBe("AWAITING_APPROVAL");
    // GET reads the durable snapshot, which never persists draft content.
    expect((got.checkpoint as { replyDraft?: string }).replyDraft).toBeUndefined();
    expect(JSON.stringify(got)).not.toContain(PHONE_TOKEN);
  });

  it("a token the backend rejects (whoami throws) fails closed", async () => {
    const svc = new AgentRunService({
      storeProvider: provider,
      clientFactory: () => ({
        inquiry: fakes.inquiry,
        review: fakes.review,
        issue: fakes.issue,
        identity: { whoami: async () => { throw new SpringApiError(401, "HTTP_401", "unauthorized"); } },
      }),
      env: "test",
    });
    const err = await svc.start("bad", { intent: "HANDLE_UNANSWERED_INQUIRIES" }).catch((e) => e);
    expect(toHttpError(err).status).toBe(401);
  });

  it("TENANT ISOLATION: one org cannot read or resume another org's run", async () => {
    // Both services share ONE provider (one process) but resolve different orgs.
    const svcA = serviceWith(fakes, provider, ORG_A);
    const svcB = serviceWith(freshFakes(), provider, ORG_B);
    const start = await svcA.start("tokA", { intent: "HANDLE_UNANSWERED_INQUIRIES", threadId: "shared-id-1" });
    expect(start.status).toBe("AWAITING_APPROVAL");
    // Org A sees its own run; org B — using the SAME threadId — sees nothing (different scope).
    expect((await svcA.get("tokA", "shared-id-1")).status).toBe("AWAITING_APPROVAL");
    await expect(svcB.get("tokB", "shared-id-1")).rejects.toMatchObject({ status: 404 });
    await expect(svcB.resume("tokB", "shared-id-1", { approved: true })).rejects.toMatchObject({ status: 404 });
    // Org B starting the same threadId does not disturb org A's run.
    await svcB.start("tokB", { intent: "HANDLE_UNANSWERED_INQUIRIES", threadId: "shared-id-1" });
    expect((await svcA.get("tokA", "shared-id-1")).domain).toBe("INQUIRY");
  });

  it("resumes across a fresh service instance (restart-equivalent) via a shared file store", async () => {
    const dir = mkdtempSync(join(tmpdir(), "agentrt-restart-"));
    try {
      const svcA = serviceWith(fakes, new RunStoreProvider(config("file", dir)));
      const svcB = serviceWith(fakes, new RunStoreProvider(config("file", dir))); // fresh process, same dir

      const start = await svcA.start("tok", { intent: "HANDLE_UNANSWERED_INQUIRIES" });
      expect(start.status).toBe("AWAITING_APPROVAL");
      const done = await svcB.resume("tok", start.threadId, { approved: true, approvedBy: "SELLER:test" });
      expect(done.status).toBe("DONE");
      expect((done.outcome as { decision: string }).decision).toBe("APPROVED");
      expect(fakes.inquiry.externalSendAttempts).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("no customer 원문 or PII reaches the log sink across all three domains", async () => {
    getLogSink();
    try {
      const inq = await service.start("tok", { intent: "HANDLE_UNANSWERED_INQUIRIES" });
      await service.resume("tok", inq.threadId, { approved: true, approvedBy: "SELLER:test" });
      const rev = await service.start("tok", { intent: "HANDLE_REVIEW_REPLIES", accountId: ACCOUNT });
      await service.resume("tok", rev.threadId, { approved: true, approvedBy: "SELLER:test" });
      await service.start("tok", { intent: "HANDLE_OPERATIONS_ISSUES" });
      const dump = JSON.stringify(getLogSink());
      for (const leak of [PHONE_TOKEN, EMAIL_TOKEN, "사이즈 문의", "하자가 있어요", "원문"]) {
        expect(dump).not.toContain(leak);
      }
    } finally {
      clearLogSink();
    }
  });
});
