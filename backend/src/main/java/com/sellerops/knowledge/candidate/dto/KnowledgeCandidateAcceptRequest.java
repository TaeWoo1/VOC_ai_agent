package com.sellerops.knowledge.candidate.dto;

import com.sellerops.knowledge.org.OrgKnowledgeType;
import com.sellerops.product.library.KnowledgeSourceType;

/**
 * What the seller confirmed, when they changed it.
 *
 * <p>Every field is optional and every absence means "as proposed". The seller may edit the sentence
 * before accepting it — which is why {@code content} is here at all: a candidate is a draft of a
 * standard, and the standard is whatever the person writing it says.
 */
public record KnowledgeCandidateAcceptRequest(String title, String content,
                                              KnowledgeSourceType sourceType, OrgKnowledgeType orgType) {
}
