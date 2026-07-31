/**
 * The draft-preparation result shapes.
 *
 * A draft-preparation run reads one inquiry and produces a rule-based answer draft for a human to
 * review, then STOPS — it writes nothing to the backend and sends nothing. Two shapes carry its
 * result:
 *
 *  - {@link InquiryDraftMeta} is the SANITIZED scalar metadata about a prepared draft — everything
 *    a durable snapshot or a log line may hold: ids, coarse category, provenance, channel labels,
 *    the inquiry status, the secret flag, and the generation timestamp. It deliberately contains NO
 *    draft body and NO customer text.
 *
 *  - {@link InquiryDraftPreparation} is the full live result the runtime returns to the caller: the
 *    metadata PLUS `replyDraft` (the generated answer text). `replyDraft` is content — it lives only
 *    in this in-memory result and is NEVER placed in the run snapshot or a log line. A reloaded run
 *    can therefore never re-surface the draft body; the human regenerates it if needed.
 */
import type { DraftProvenance } from "../provider/DraftModelSeam";

/** Sanitized, body-free metadata about a prepared draft. Safe to persist and to log. */
export interface InquiryDraftMeta {
  readonly workItemId: string;
  readonly inquiryId: string;
  /** Work-item phase at draft time — always OPEN for a draftable inquiry (unchanged by this run). */
  readonly phase: string;
  readonly priorityBucket: string;
  /** Coarse rule category (delivery/exchange/stock/product/general) — closed vocabulary, no content. */
  readonly category: string;
  readonly provenance: DraftProvenance;
  readonly channelId: string;
  readonly channelCode: string | null;
  readonly channelNameKo: string | null;
  /** Canonical inquiry status: UNANSWERED / ANSWERED. */
  readonly inquiryStatus: string;
  /** Raw source reply token (Cafe24 N/P/C etc.), or null. A coarse status token, not content. */
  readonly informStatus: string | null;
  /** true = Cafe24 비밀글 (fail-closed); false = positively public; null = unclassified. */
  readonly isSecret: boolean | null;
  /** ISO-8601 instant the draft was generated. */
  readonly generatedAt: string;
}

/**
 * The full preparation the runtime returns. When `prepared` is false the OPEN queue was empty and
 * there was nothing to draft (`meta`/`replyDraft` null, `note` explains). `replyDraft` is the
 * generated answer text — content — present ONLY here, never in the snapshot or a log.
 */
export interface InquiryDraftPreparation {
  readonly prepared: boolean;
  readonly meta: InquiryDraftMeta | null;
  readonly replyDraft: string | null;
  readonly note?: string;
}
