package com.sellerops.knowledge.org.dto;

import com.sellerops.knowledge.org.OrgKnowledgeType;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

/** What the seller submits. Validation is here so an empty policy can never be indexed. */
public record OrgKnowledgeRequest(@NotNull OrgKnowledgeType knowledgeType,
                                  @NotBlank @Size(max = 200) String title,
                                  @NotBlank @Size(max = 40_000) String body,
                                  @Size(max = 1000) String sourceUrl) {
}
