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
import { StaleRunVersionError } from "../spring/AgentRunStateClient";
import { sanitize } from "../aop/AopCheckpointStore";
import type { AopCheckpoint, AopCheckpointStore, ClaimResult as AopClaimResult } from "../aop/AopCheckpointStore";

/** The domain stamp for an AOP execution cursor. Its own, so it carries the STRICT forbidden set. */
export const AOP_DOMAIN = "PROCEDURE";

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

/**
 * The AOP execution cursor, backend-owned — Agent Runtime Production Closure v1 §1.
 *
 * The file store proves a restart on one machine; it cannot answer a container replacement (the disk
 * goes with the container) or a second replica (neither sees the other's cursor, and its `.claim` lock
 * file is not a lock across processes). This adapter puts the cursor on the row that already has an
 * org-scoped identity, a version and a REAL claim — the same three properties the inquiry run store
 * relies on, reached through the same client so the per-request version cache is shared.
 *
 * <b>What is stored is still only the cursor.</b> {@code sanitize()} runs before the write, and the
 * backend rejects a forbidden key independently: a `PROCEDURE` row carries the STRICT set, so unlike a
 * transcript it may not hold `text`, `message` or `content` at all.
 *
 * <b>Status is the lock state.</b> A stopped cursor rests in `WAITING_HUMAN`, which the backend's
 * `claimForResume` claims exactly the way it claims `AWAITING_APPROVAL`; a finished procedure deletes
 * its row rather than parking it, because a cursor that outlives its run is what a later resume would
 * mistake for work still to do.
 */
export class SpringAopCheckpointStore implements AopCheckpointStore {
  constructor(private readonly client: AgentRunStateClient) {}

  /**
   * Write the cursor.
   *
   * The version this write is guarded by comes from the load or claim that preceded it in the same
   * request — the runtime always does one. When there is none (a fresh client writing a thread that
   * already has a row), or when the row moved underneath us, the guarded write is refused; the repair
   * is to re-read and write again, because unlike a transcript a cursor has nothing to merge: the
   * caller holding the claim is the only one entitled to say where the procedure now stands. ONE
   * retry — a second loss is contention, and a write loop is worse than a failed turn.
   */
  async save(checkpoint: AopCheckpoint): Promise<void> {
    try {
      await this.put(checkpoint);
    } catch (err) {
      if (!(err instanceof StaleRunVersionError)) throw err;
      await this.client.get(checkpoint.threadId);
      await this.put(checkpoint);
    }
  }

  private async put(checkpoint: AopCheckpoint): Promise<void> {
    await this.client.put({
      threadId: checkpoint.threadId, domain: AOP_DOMAIN, status: "WAITING_HUMAN",
      snapshot: sanitize(checkpoint),
    });
  }

  async load(threadId: string): Promise<AopCheckpoint | null> {
    const record = await this.client.get(threadId);
    if (!record || record.domain !== AOP_DOMAIN) return null;
    return record.snapshot as AopCheckpoint;
  }

  async delete(threadId: string): Promise<void> {
    await this.client.delete(threadId);
  }

  async claim(threadId: string): Promise<AopClaimResult> {
    return { outcome: await this.client.claim(threadId) };
  }
}
