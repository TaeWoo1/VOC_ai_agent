/**
 * Durable run store for the review subgraph — the sanitized checkpoint that survives a
 * process restart, sibling to the inquiry {@link RunStore}.
 *
 * As with inquiry, LangGraph's in-memory checkpointer resumes a run WITHIN a process; this
 * separate store keeps only what is needed to resume ACROSS a restart, and nothing that
 * could carry PII, a token, a credential, or review content. Here the payload is genuinely
 * minimal: the draft is already persisted in the backend, so restart-resume needs only the
 * review ref, the exact draft version + fingerprint, the account scope, the orchestration
 * phase, and the sanitized outcome. Domain data is never replicated.
 *
 * `sellerAccountId` is the operator's own account id (a scoping id, not review content or
 * PII); it is required because the review-reply endpoints are account-scoped and the
 * restart process has no goal to read it from.
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { ReviewReplyPhase } from "./ReviewCheckpointContract";
import type { ReviewRunOutcome } from "../state/ReviewAgentState";

export type ReviewRunStatus = "AWAITING_APPROVAL" | "DONE";

/**
 * The ONLY fields persisted. No review body, no reply text, no token, no credential.
 * `draftFingerprint` and any fingerprint inside `outcome` are one-way hashes, not content;
 * `submissionRef` (inside `outcome`) is an opaque token, never reversible to a review id.
 */
export interface ReviewRunSnapshot {
  readonly threadId: string;
  readonly status: ReviewRunStatus;
  readonly sellerAccountId: string;
  readonly reviewRef: string;
  readonly draftVersion: number;
  readonly draftFingerprint: string;
  readonly phase: ReviewReplyPhase;
  readonly priorityBucket: string;
  readonly trail: string[];
  readonly outcome?: ReviewRunOutcome | null;
}

export interface ReviewRunStore {
  save(snapshot: ReviewRunSnapshot): Promise<void>;
  load(threadId: string): Promise<ReviewRunSnapshot | null>;
  delete(threadId: string): Promise<void>;
}

/** Same-process store. Lost on restart — use a durable impl to prove restart-resume. */
export class InMemoryReviewRunStore implements ReviewRunStore {
  private readonly byThread = new Map<string, ReviewRunSnapshot>();

  async save(snapshot: ReviewRunSnapshot): Promise<void> {
    this.byThread.set(snapshot.threadId, snapshot);
  }
  async load(threadId: string): Promise<ReviewRunSnapshot | null> {
    return this.byThread.get(threadId) ?? null;
  }
  async delete(threadId: string): Promise<void> {
    this.byThread.delete(threadId);
  }
}

/**
 * File-backed durable store: one JSON file per thread under a directory. Survives a process
 * restart, which is what makes the restart-resume proof real. Production would swap a
 * transactional store; this is the simplest durable, dependency-free impl.
 */
export class FileReviewRunStore implements ReviewRunStore {
  constructor(private readonly dir: string) {
    mkdirSync(dir, { recursive: true });
  }

  private path(threadId: string): string {
    const safe = threadId.replace(/[^a-zA-Z0-9._-]/g, "_");
    return join(this.dir, `${safe}.json`);
  }

  async save(snapshot: ReviewRunSnapshot): Promise<void> {
    writeFileSync(this.path(snapshot.threadId), JSON.stringify(snapshot, null, 2), "utf8");
  }
  async load(threadId: string): Promise<ReviewRunSnapshot | null> {
    const p = this.path(threadId);
    if (!existsSync(p)) return null;
    return JSON.parse(readFileSync(p, "utf8")) as ReviewRunSnapshot;
  }
  async delete(threadId: string): Promise<void> {
    const p = this.path(threadId);
    if (existsSync(p)) rmSync(p);
  }
}
