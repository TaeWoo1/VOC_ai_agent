package com.sellerops.knowledge.teach.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

/** The seller's answer to a case's knowledge gap. {@code scope} is {@code PRODUCT} or {@code ORG}. */
public record CaseTeachRequest(@NotBlank @Size(max = 4000) String content, String scope) {
}
