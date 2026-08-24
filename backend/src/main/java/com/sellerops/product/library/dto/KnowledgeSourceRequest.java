package com.sellerops.product.library.dto;

import com.sellerops.product.library.KnowledgeSourceType;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

/** What the seller submits. Validation is here so an empty document can never be indexed. */
public record KnowledgeSourceRequest(@NotNull KnowledgeSourceType sourceType,
                                     @NotBlank @Size(max = 200) String title,
                                     @NotBlank @Size(max = 40_000) String body,
                                     @Size(max = 1000) String sourceUrl) {
}
