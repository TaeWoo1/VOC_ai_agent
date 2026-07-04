/**
 * **Injected inquiry proposal provider** (seam only — no implementation).
 *
 * The seller-side drafting seam: given the seller-visible inquiry context, it returns a draft descriptor the
 * coordinator turns into an {@link AgentProposal}. There is deliberately NO implementation here — no LLM, no
 * network call. Production wires a real drafter behind this interface; tests inject a fake. The provider only
 * DRAFTS; it never approves, never executes, and never sees more than the permitted seller context.
 */

import type { CommerceChannel } from "../connection/sync-state";
import type { InquiryCategoryMeta } from "./observation";

/**
 * The seller-visible inquiry context handed to the provider. This is the SELLER's own operational view
 * (raw inquiry text + order reference are fine — the seller owns them). It carries no manufacturer-only
 * data, no hashed signal fields, and no internal work-item ids — only what is permitted to draft a reply.
 */
export interface SellerInquiryContext {
  sellerId: string;
  channel: CommerceChannel;
  productId: string;
  orderRef: string | null;
  inquiryText: string;
  /** Optional raw inquiry title — seller-visible, for the seller's own drafting. */
  title?: string;
  category: InquiryCategoryMeta;
  responseDeadlineAt: number | null;
}

/** A drafted-reply descriptor — coarse only; the raw reply body is out of this slice. */
export interface InquiryProposalDraft {
  /** Coarse category of the drafted reply (e.g. "stock_availability_reply"). */
  summaryCategory: string;
}

/**
 * The injected provider. `propose` may reject/throw (provider unavailable) — the coordinator then leaves the
 * work item OPEN and retryable. It returns only a coarse {@link InquiryProposalDraft}.
 */
export interface InquiryProposalProvider {
  propose(context: SellerInquiryContext): Promise<InquiryProposalDraft>;
}
