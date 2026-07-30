/**
 * Spring-backed durable stores — the production run store. Each is a thin, domain-stamping adapter
 * over one shared {@link HttpAgentRunStateClient} (shared so the per-request version cache is common to
 * all three). The runtime keeps talking to the same typed store interfaces
 * ({@link RunStore}/{@link ReviewRunStore}/{@link IssueRunStore}); only the implementation moved from a
 * local file to the backend, which makes the store durable, org-isolated, and safe behind more than one
 * replica.
 *
 * A `load` returns null when the stored row belongs to a DIFFERENT domain, so probing the three stores
 * to resolve which subgraph owns a thread still works against the single backend table.
 */
import type { ClaimResult, RunSnapshot, RunStore } from "../checkpoint/RunStore";
import type { ReviewRunSnapshot, ReviewRunStore } from "../checkpoint/ReviewRunStore";
import type { IssueRunSnapshot, IssueRunStore } from "../checkpoint/IssueRunStore";
import type { AgentRunStateClient, ClaimOutcome } from "../spring/AgentRunStateClient";

function toClaimResult(outcome: ClaimOutcome): ClaimResult {
  return { outcome };
}

export class SpringRunStore implements RunStore {
  constructor(private readonly client: AgentRunStateClient) {}

  async save(snapshot: RunSnapshot): Promise<void> {
    await this.client.put({ threadId: snapshot.threadId, domain: "INQUIRY", status: snapshot.status, snapshot });
  }
  async load(threadId: string): Promise<RunSnapshot | null> {
    const record = await this.client.get(threadId);
    if (!record || record.domain !== "INQUIRY") return null;
    return record.snapshot as RunSnapshot;
  }
  async delete(threadId: string): Promise<void> {
    await this.client.delete(threadId);
  }
  async claim(threadId: string): Promise<ClaimResult> {
    return toClaimResult(await this.client.claim(threadId));
  }
}

export class SpringReviewRunStore implements ReviewRunStore {
  constructor(private readonly client: AgentRunStateClient) {}

  async save(snapshot: ReviewRunSnapshot): Promise<void> {
    await this.client.put({ threadId: snapshot.threadId, domain: "REVIEW", status: snapshot.status, snapshot });
  }
  async load(threadId: string): Promise<ReviewRunSnapshot | null> {
    const record = await this.client.get(threadId);
    if (!record || record.domain !== "REVIEW") return null;
    return record.snapshot as ReviewRunSnapshot;
  }
  async delete(threadId: string): Promise<void> {
    await this.client.delete(threadId);
  }
  async claim(threadId: string): Promise<ClaimResult> {
    return toClaimResult(await this.client.claim(threadId));
  }
}

export class SpringIssueRunStore implements IssueRunStore {
  constructor(private readonly client: AgentRunStateClient) {}

  async save(snapshot: IssueRunSnapshot): Promise<void> {
    await this.client.put({ threadId: snapshot.threadId, domain: "ISSUE", status: snapshot.status, snapshot });
  }
  async load(threadId: string): Promise<IssueRunSnapshot | null> {
    const record = await this.client.get(threadId);
    if (!record || record.domain !== "ISSUE") return null;
    return record.snapshot as IssueRunSnapshot;
  }
  async delete(threadId: string): Promise<void> {
    await this.client.delete(threadId);
  }
}
