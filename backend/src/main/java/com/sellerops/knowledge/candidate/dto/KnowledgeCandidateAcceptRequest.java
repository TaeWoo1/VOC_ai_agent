package com.sellerops.knowledge.candidate.dto;

import com.sellerops.knowledge.org.OrgKnowledgeType;
import com.sellerops.product.library.KnowledgeSourceType;
import java.util.UUID;

/**
 * What the seller confirmed, when they changed it.
 *
 * <p>Every field is optional and every absence means "as proposed". The seller may edit the sentence
 * before accepting it — which is why {@code content} is here at all: a candidate is a draft of a
 * standard, and the standard is whatever the person writing it says.
 *
 * <p>{@code variantId} exists so the ONE write that closes a candidate can also carry the 규격 the
 * seller chose (Knowledge Gap Continuity v1). Without it the inquiry and review quick-adds could not
 * route through this endpoint without dropping that choice, and a control whose value is silently
 * discarded is worse than an absent one. Null means 전체 상품 공통 — the same thing it means in the
 * knowledge library — and it is meaningful only for a PRODUCT-scoped candidate.
 */
public record KnowledgeCandidateAcceptRequest(String title, String content,
                                              KnowledgeSourceType sourceType, OrgKnowledgeType orgType,
                                              UUID variantId) {
}
