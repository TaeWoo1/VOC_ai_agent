/**
 * In-memory run store for the inquiry draft-preparation subgraph.
 *
 * This subgraph has no human-checkpoint interrupt, so there is no paused run to resume across a
 * restart — the HTTP service builds one of these PER REQUEST (it is never taken from the durable
 * run-store provider) because a terminal run needs nothing durable. It exists so the runtime can
 * record and re-read the SANITIZED, body-free {@link InquiryDraftMeta} within a run (ids, coarse
 * category, provenance, channel labels, status, the secret flag, the generation timestamp).
 *
 * The draft body (`replyDraft`) is content and is DELIBERATELY never stored here: the snapshot can
 * never re-surface a draft, which is the persistence half of the "draft is transient, never retained"
 * guarantee. Because there is no durable/file variant, a draft is never written to disk at all. The
 * generated draft is regenerated deterministically on demand, never read back from a store.
 */
import type { InquiryDraftMeta } from "../state/InquiryDraftState";

export interface InquiryDraftRunSnapshot {
  readonly threadId: string;
  readonly status: "DONE";
  readonly prepared: boolean;
  /** Sanitized metadata (body-free); null when the queue was empty and nothing was drafted. */
  readonly meta: InquiryDraftMeta | null;
  readonly trail: string[];
}

export interface InquiryDraftRunStore {
  save(snapshot: InquiryDraftRunSnapshot): Promise<void>;
  load(threadId: string): Promise<InquiryDraftRunSnapshot | null>;
  delete(threadId: string): Promise<void>;
}

/** Same-process store. The service builds one per request; a terminal run needs nothing durable. */
export class InMemoryInquiryDraftRunStore implements InquiryDraftRunStore {
  private readonly byThread = new Map<string, InquiryDraftRunSnapshot>();

  async save(snapshot: InquiryDraftRunSnapshot): Promise<void> {
    this.byThread.set(snapshot.threadId, snapshot);
  }
  async load(threadId: string): Promise<InquiryDraftRunSnapshot | null> {
    return this.byThread.get(threadId) ?? null;
  }
  async delete(threadId: string): Promise<void> {
    this.byThread.delete(threadId);
  }
}
