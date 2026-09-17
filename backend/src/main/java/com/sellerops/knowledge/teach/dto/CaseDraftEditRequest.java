package com.sellerops.knowledge.teach.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

/**
 * The seller's rewrite of the prepared draft. {@code remember} is the explicit 「다음에도 참고」; it is honoured only when
 * the rewrite changes what the draft says, not its spacing.
 */
public record CaseDraftEditRequest(@NotBlank @Size(max = 4000) String body, boolean remember, String scope) {
}
