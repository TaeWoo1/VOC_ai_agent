package com.sellerops.customermemory.dto;

import java.time.LocalDate;
import java.util.UUID;

/**
 * One precedent: a past inquiry or review that looks like the one being worked on now.
 *
 * <p><b>What is here and what deliberately is not.</b> The customer's own words are NOT here — no
 * inquiry body, no review body, no masked quote. What IS here, for an INQUIRY hit that has one, is
 * {@code answer}: the reply SellerOps itself drafted and an operator approved. That is
 * operator-authored text, not customer text, which is exactly why it may travel — it is the same
 * class of content {@code /agent} already shows as a reply draft. It is masked on the way out anyway
 * ({@code PiiMasker}), because an operator can type a phone number into a reply and this text is
 * about to become context for a model.
 *
 * @param kind INQUIRY | REVIEW
 * @param sourceId the row this precedent points at, so a surface can deep-link to the authorized
 *     detail screen where the original text is read
 * @param topic {@code item_analyses.category} — closed vocabulary
 * @param signatureKey {@code aspect:problem} — closed vocabulary; null when nothing matched
 * @param answer the approved past reply, masked; null when this precedent has none
 * @param retrieverKind provenance of the retrieval that produced this hit (never hardcoded)
 */
public record CustomerMemoryHitView(String kind, UUID sourceId, UUID productId, String productName,
                                    String channelCode, String topic, String signatureKey,
                                    String severity, LocalDate occurredOn, boolean answered,
                                    String answer, String retrieverKind, String retrieverVersion) {
}
