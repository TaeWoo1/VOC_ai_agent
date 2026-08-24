package com.sellerops.knowledge.org.dto;

import com.sellerops.knowledge.org.OrgKnowledgeType;
import java.time.Instant;
import java.util.UUID;

/**
 * One passage of the seller's operating rules, offered as grounding.
 *
 * <p>{@code version} travels with it because a policy is a thing that changes: a citation that says
 * only "배송 안내" cannot be checked a month later against the text that was actually shown.
 */
public record OrgKnowledgePassage(UUID sourceId, UUID chunkId, OrgKnowledgeType knowledgeType,
                                  String title, String content, int ordinal, double score,
                                  String authorName, String sourceUrl, int version, Instant updatedAt) {
}
