package com.sellerops.inquiry.decision;

import java.util.UUID;

/**
 * A past answer the seller wrote, offered to the judge as a POSSIBLE PREFILL for a need nothing current covers.
 * Never evidence: a verdict that cites a precedent id as evidence is rejected by the engine.
 *
 * @param id       {@code P1}, {@code P2}, … — positional
 * @param memoryId the answer-memory row (never sent)
 * @param text     the seller's answer, bounded
 */
public record PrecedentCandidate(String id, UUID memoryId, String text) {
}
