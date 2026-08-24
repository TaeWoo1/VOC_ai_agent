package com.sellerops.inquiry.draft.dto;

import java.util.UUID;

/**
 * One citation line under a generated draft.
 *
 * <p>The passage text is not repeated here: the seller is looking at a reply that already says the
 * thing, and a citation is a pointer to where it came from, not a second copy. {@code sourceId} lets
 * the screen link to the knowledge document so the claim can be checked against the seller's own
 * words in one click.
 */
public record DraftEvidenceView(String kind, String title, String locator, UUID sourceId, UUID chunkId) {
}
