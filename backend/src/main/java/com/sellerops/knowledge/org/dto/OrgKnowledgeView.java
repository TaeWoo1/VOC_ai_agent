package com.sellerops.knowledge.org.dto;

import com.sellerops.knowledge.org.OrgKnowledgeType;
import java.time.Instant;
import java.util.UUID;

/** One operating rule as the settings screen shows it. Carries its seller-facing label, not the enum. */
public record OrgKnowledgeView(UUID id, OrgKnowledgeType knowledgeType, String typeLabel, String title,
                               String body, String sourceUrl, String authorName, int version,
                               int passageCount, Instant createdAt, Instant updatedAt) {
}
