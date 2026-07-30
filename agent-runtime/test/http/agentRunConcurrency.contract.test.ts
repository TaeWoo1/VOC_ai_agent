/**
 * Pilot-critical properties of {@link AgentRunService} on the production (Spring-backed) run store:
 * durable restart-resume across a fresh process, and EXACTLY-ONCE mutation under a truly concurrent
 * double resume — the case the local file store cannot make safe and the claim-before-mutate gate
 * exists for. The backend HTTP contract is emulated by {@link FakeAgentRunStateBackend} (atomic CAS),
 * so the real client + real stores + real service run offline.
 */
import { describe, expect, it } from "vitest";
import { AgentRunService } from "../../src/http/AgentRunService";
import type { SpringClientBundle, SpringClientFactory } from "../../src/http/AgentRunService";
import { RunStoreProvider } from "../../src/http/runStoreProvider";
import { HttpAgentRunStateClient } from "../../src/spring/AgentRunStateClient";
import { HttpError } from "../../src/http/errors";
import type { RuntimeConfig } from "../../src/http/config";
import type { IdentitySpringClient } from "../../src/spring/IdentitySpringClient";
import { FakeAgentRunStateBackend } from "../support/FakeAgentRunStateBackend";
import { FakeSpringClient } from "../support/FakeSpringClient";
import { FakeReviewSpringClient } from "../support/FakeReviewSpringClient";
import { FakeIssueSpringClient } from "../support/FakeIssueSpringClient";
import { twoInquiries } from "../support/fixtures";
import { twoReviews } from "../support/reviewFixtures";
import { fourIssues } from "../support/issueFixtures";

const ORG = "orgA";
const TOKEN = "tok";
const ACCOUNT = "acct-1";

function springConfig(env: RuntimeConfig["env"] = "development"): RuntimeConfig {
  return {
    port: 0,
    backendBaseUrl: "http://fake",
    env,
    runStoreKind: "spring",
    runStoreDir: "./unused",
    corsAllowedOrigins: [],
  };
}

interface Fakes {
  inquiry: FakeSpringClient;
  review: FakeReviewSpringClient;
  issue: FakeIssueSpringClient;
}

function identityFor(orgId: string): IdentitySpringClient {
  return { whoami: async () => ({ userId: `u-${orgId}`, orgId }) };
}

function factory(fakes: Fakes, orgId: string): SpringClientFactory {
  return (): SpringClientBundle => ({
    inquiry: fakes.inquiry,
    review: fakes.review,
    issue: fakes.issue,
    identity: identityFor(orgId),
  });
}

function providerOver(backend: FakeAgentRunStateBackend, env: RuntimeConfig["env"] = "development"): RunStoreProvider {
  return new RunStoreProvider(
    springConfig(env),
    (token) => new HttpAgentRunStateClient({ baseUrl: "http://fake", token, fetchImpl: backend.fetch }),
  );
}

describe("AgentRunService on the Spring store — pilot concurrency + durability", () => {
  it("production boot is allowed with the spring store and reports multi-instance safe", () => {
    const backend = new FakeAgentRunStateBackend({ [TOKEN]: ORG });
    const provider = providerOver(backend, "production");
    expect(provider.multiInstanceSafe).toBe(true);
    expect(provider.durable).toBe(true);
    const svc = new AgentRunService({ storeProvider: provider, clientFactory: factory(freshFakes(), ORG), env: "production" });
    expect(svc.capabilities().runStore.multiInstanceSafe).toBe(true);
  });

  it("resumes across a fresh service instance (restart) via the durable backend store", async () => {
    const backend = new FakeAgentRunStateBackend({ [TOKEN]: ORG });
    const fakes = freshFakes();
    const svcA = new AgentRunService({ storeProvider: providerOver(backend), clientFactory: factory(fakes, ORG), env: "development" });
    const svcB = new AgentRunService({ storeProvider: providerOver(backend), clientFactory: factory(fakes, ORG), env: "development" });

    const start = await svcA.start(TOKEN, { intent: "HANDLE_UNANSWERED_INQUIRIES" });
    expect(start.status).toBe("AWAITING_APPROVAL");
    const done = await svcB.resume(TOKEN, start.threadId, { approved: true, approvedBy: "SELLER:test" });
    expect(done.status).toBe("DONE");
    expect((done.outcome as { decision: string }).decision).toBe("APPROVED");
  });

  it("CONCURRENT double resume of a review mints EXACTLY ONCE; the loser fails closed", async () => {
    const backend = new FakeAgentRunStateBackend({ [TOKEN]: ORG });
    const fakes = freshFakes();
    const svc = new AgentRunService({ storeProvider: providerOver(backend), clientFactory: factory(fakes, ORG), env: "development" });

    const start = await svc.start(TOKEN, { intent: "HANDLE_REVIEW_REPLIES", accountId: ACCOUNT });
    expect(start.status).toBe("AWAITING_APPROVAL");
    expect(fakes.review.mintCount).toBe(0);

    const decision = { approved: true, approvedBy: "SELLER:test" };
    const [r1, r2] = await Promise.all([
      svc.resume(TOKEN, start.threadId, decision).catch((e) => e),
      svc.resume(TOKEN, start.threadId, decision).catch((e) => e),
    ]);

    // The non-idempotent guided-session mint ran exactly once, and there was zero external send.
    expect(fakes.review.mintCount).toBe(1);
    expect(fakes.review.externalSendAttempts).toBe(0);

    const results = [r1, r2];
    const done = results.filter((r) => !(r instanceof Error) && r.status === "DONE");
    const conflicts = results.filter((r) => r instanceof HttpError && r.status === 409 && r.code === "RESUME_IN_PROGRESS");
    // Exactly one caller committed; the other fails closed with a 409 (never a second mint).
    expect(done).toHaveLength(1);
    expect(conflicts).toHaveLength(1);
    expect((done[0] as { outcome: { guidedSessionPrepared: boolean } }).outcome.guidedSessionPrepared).toBe(true);
  });

  it("sequential double resume stays idempotent (replays DONE, no second mint)", async () => {
    const backend = new FakeAgentRunStateBackend({ [TOKEN]: ORG });
    const fakes = freshFakes();
    const svc = new AgentRunService({ storeProvider: providerOver(backend), clientFactory: factory(fakes, ORG), env: "development" });

    const start = await svc.start(TOKEN, { intent: "HANDLE_REVIEW_REPLIES", accountId: ACCOUNT });
    const first = await svc.resume(TOKEN, start.threadId, { approved: true, approvedBy: "SELLER:test" });
    const second = await svc.resume(TOKEN, start.threadId, { approved: true, approvedBy: "SELLER:test" });
    expect(first.status).toBe("DONE");
    expect(second.status).toBe("DONE");
    expect(fakes.review.mintCount).toBe(1);
  });
});

function freshFakes(): Fakes {
  return {
    inquiry: new FakeSpringClient(twoInquiries()),
    review: new FakeReviewSpringClient(twoReviews()),
    issue: new FakeIssueSpringClient(fourIssues()),
  };
}
