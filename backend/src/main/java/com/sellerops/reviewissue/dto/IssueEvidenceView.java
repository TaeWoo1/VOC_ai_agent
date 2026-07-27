package com.sellerops.reviewissue.dto;

import java.time.LocalDate;
import java.util.UUID;

/**
 * One piece of evidence behind an issue — the 근거 리뷰 an operator opens to check the judgement.
 *
 * <p>{@code quote} is the opinion unit re-derived at read time and passed through
 * {@code VocPreviewSanitizer.sanitize}, which is the same masking every other list row uses. It is
 * <b>null when suppressed</b>, and a null must render as nothing rather than as an empty quote:
 * the sanitizer suppresses when too little real text survives redaction, and showing an empty
 * bubble would imply the customer said nothing.
 *
 * <p>Nothing here is stored — the evidence table holds no text. That is deliberate: a stored quote
 * would be a second copy of customer content whose masking depends on remembering to apply it.
 */
public record IssueEvidenceView(UUID reviewId, int unitOrdinal, LocalDate occurredOn,
                                UUID productId, String productName, Integer rating, String quote) {
}
