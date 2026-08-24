package com.sellerops.inquiry.draft.dto;

import java.util.UUID;

/**
 * One citation line under a generated draft.
 *
 * <p>The passage text is not repeated here: the seller is looking at a reply that already says the
 * thing, and a citation is a pointer to where it came from, not a second copy. {@code sourceId} lets
 * the screen link to the knowledge document so the claim can be checked against the seller's own
 * words in one click.
 *
 * <p>{@code scopeLabel} is the seller-facing group this citation belongs to — 상품 정보 / 운영 정책 /
 * 과거 답변. It is here rather than derived on the screen from {@code kind} because {@code kind} is a
 * storage vocabulary that may gain a value the frontend has no label for, and an unlabelled citation
 * is worse than a plainly named one.
 */
public record DraftEvidenceView(String kind, String scopeLabel, String title, String locator,
                                UUID sourceId, UUID chunkId) {
}
