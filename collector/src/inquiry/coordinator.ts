/**
 * **Inquiry intake coordinator** (pure, offline application layer).
 *
 * Runs the first FDE vertical slice end-to-end and STOPS at seller-approval-pending:
 *
 *   InquiryObservation → CommerceSignal → WorkItem (OPEN) → AgentProposal (PROPOSED)
 *
 * It opens exactly one seller work item per source identity, asks the injected {@link InquiryProposalProvider}
 * to draft a Seller-channel inquiry reply, and attaches it as a proposal. It NEVER approves, never creates an
 * `ActionIntent`, never executes — a `POST_INQUIRY_REPLY` is a seller-channel write, so the conservative
 * policy leaves it `PROPOSED`, awaiting explicit Seller approval.
 *
 * **Idempotency & isolation** come from the deterministic source-identity ids plus a dedup index that is
 * fully SERIALIZABLE ({@link snapshot} / {@link InquiryIntakeCoordinator.fromSnapshot}) — idempotency does
 * not depend on a live in-memory `Map`: re-ingesting the same observation returns the existing slice without
 * re-opening or re-drafting; a different connection is an isolated work item; reusing a source identity with
 * different content is a `SOURCE_CONFLICT`. **Provider failure is safe and retryable**: the work item is left
 * OPEN and a later ingestion reuses the SAME work item, calls the provider again, and settles at `PROPOSED`.
 *
 * No NAVER/ESM collection, channel write, connector call, durable persistence, HTTP, LLM, manufacturer
 * action, or automatic approval. No wall-clock read — audit time is the caller-supplied `atMs`.
 */

import { proposeAction } from "../work/work-item";
import { DEFAULT_APPROVAL_POLICY } from "../work/approval-policy";
import type { AgentProposal, CommerceSignal, Party, WorkItemAggregate } from "../work/types";
import type { InquiryObservation } from "./observation";
import { deriveSourceIds, observationFingerprint, openInquiryWorkItem, sellerContextFromSignal, toInquirySignal, type InquirySourceIds } from "./intake";
import type { InquiryProposalProvider } from "./proposal-provider";

/** The materialized state of one inquiry as it moves through the slice — fully serializable. */
export interface InquirySlice {
  ids: InquirySourceIds;
  signal: CommerceSignal;
  aggregate: WorkItemAggregate;
  /** Non-null once a proposal is attached (phase `PROPOSED`); null while the work item is still `OPEN`. */
  proposal: AgentProposal | null;
}

/** The serializable dedup state: source key → (content fingerprint, slice). Survives a JSON round-trip. */
export interface InquiryCoordinatorState {
  entries: ReadonlyArray<{ sourceKey: string; fingerprint: string; slice: InquirySlice }>;
}

/**
 * The outcome of ingesting one observation:
 *  - `ok` with `idempotent:false` → a fresh intake settled at `PROPOSED`;
 *  - `ok` with `idempotent:true`  → an identical re-ingestion returned the existing slice (no re-draft);
 *  - `PROPOSAL_UNAVAILABLE` → the provider failed; the work item is left OPEN and the slice is retryable;
 *  - `SOURCE_CONFLICT` → the source identity was already used for a DIFFERENT observation.
 */
export type InquiryIngestOutcome =
  | { ok: true; slice: InquirySlice; idempotent: boolean }
  | { ok: false; reason: "SOURCE_CONFLICT" }
  | { ok: false; reason: "PROPOSAL_UNAVAILABLE"; slice: InquirySlice };

interface Entry {
  fingerprint: string;
  slice: InquirySlice;
}

const sellerParty = (partyId: string): Party => ({ role: "SELLER", partyId });

export class InquiryIntakeCoordinator {
  /** Dedup index: source key → (fingerprint, slice). Populated from a snapshot on rehydration. */
  private readonly bySource: Map<string, Entry>;

  constructor(private readonly provider: InquiryProposalProvider, state?: InquiryCoordinatorState) {
    this.bySource = new Map((state?.entries ?? []).map((e) => [e.sourceKey, { fingerprint: e.fingerprint, slice: e.slice }]));
  }

  /** Rehydrate a coordinator from a previously captured {@link InquiryCoordinatorState} (e.g. after JSON). */
  static fromSnapshot(state: InquiryCoordinatorState, provider: InquiryProposalProvider): InquiryIntakeCoordinator {
    return new InquiryIntakeCoordinator(provider, state);
  }

  /** Capture the dedup state as a plain, JSON-serializable object. */
  snapshot(): InquiryCoordinatorState {
    return { entries: [...this.bySource.entries()].map(([sourceKey, e]) => ({ sourceKey, fingerprint: e.fingerprint, slice: e.slice })) };
  }

  /** Ingest one observation, driving it to `PROPOSED` (or leaving it OPEN + retryable on provider failure). */
  async ingest(obs: InquiryObservation, atMs: number): Promise<InquiryIngestOutcome> {
    const ids = deriveSourceIds(obs);
    const fingerprint = observationFingerprint(obs);

    const existing = this.bySource.get(ids.sourceKey);
    if (existing !== undefined) {
      if (existing.fingerprint !== fingerprint) return { ok: false, reason: "SOURCE_CONFLICT" };
      // Same observation: already proposed → idempotent no-op; still OPEN (prior provider failure) → retry
      // the SAME work item — never reopen or duplicate it.
      if (existing.slice.proposal !== null) return { ok: true, slice: existing.slice, idempotent: true };
      return this.draftProposal(existing, ids, atMs);
    }

    // New source identity → open exactly one seller work item.
    const signal = toInquirySignal(obs, ids);
    const opened = openInquiryWorkItem(signal, ids, obs.sellerId, atMs);
    if (!opened.ok) return { ok: false, reason: "SOURCE_CONFLICT" }; // ownership mismatch — should not occur
    const entry: Entry = { fingerprint, slice: { ids, signal, aggregate: opened.aggregate, proposal: null } };
    this.bySource.set(ids.sourceKey, entry);
    return this.draftProposal(entry, ids, atMs);
  }

  /**
   * Build the provider context from the SELLER PROJECTION of the stored signal (not the observation), draft,
   * then attach the proposal. Any provider failure leaves the work item OPEN → retryable on re-ingestion.
   */
  private async draftProposal(entry: Entry, ids: InquirySourceIds, atMs: number): Promise<InquiryIngestOutcome> {
    const context = sellerContextFromSignal(entry.slice.signal);
    if (context === null) return { ok: false, reason: "PROPOSAL_UNAVAILABLE", slice: entry.slice };

    let draft;
    try {
      draft = await this.provider.propose(context);
    } catch {
      return { ok: false, reason: "PROPOSAL_UNAVAILABLE", slice: entry.slice }; // work item stays OPEN → retryable
    }

    const outcome = proposeAction(
      entry.slice.aggregate,
      { commandId: ids.proposeCommandId, proposalId: ids.proposalId, actor: sellerParty(entry.slice.signal.sellerId), actionKind: "POST_INQUIRY_REPLY", summaryCategory: draft.summaryCategory, atMs },
      DEFAULT_APPROVAL_POLICY,
    );
    if (!outcome.ok) return { ok: false, reason: "PROPOSAL_UNAVAILABLE", slice: entry.slice };

    entry.slice = { ...entry.slice, aggregate: outcome.aggregate, proposal: outcome.aggregate.proposal };
    this.bySource.set(ids.sourceKey, entry);
    return { ok: true, slice: entry.slice, idempotent: false };
  }
}
