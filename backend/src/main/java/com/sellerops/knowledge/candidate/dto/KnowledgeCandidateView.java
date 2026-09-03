package com.sellerops.knowledge.candidate.dto;

import java.time.Instant;
import java.util.UUID;

/**
 * One thing waiting for the seller's confirmation, as they read it on 확인 필요.
 *
 * <p>{@code evidenceCount} is the fact that makes a repeated-answer candidate worth a glance —
 * 「과거 답변 18건에서 반복」 — and it is a COUNT of the seller's own answers, never a confidence score.
 * {@code origin} says which of the two producers noticed it, because 「예전에 자주 쓰신 문장」 and
 * 「초안이 답하지 못한 것」 call for different reading.
 *
 * @param sourceId the knowledge source an accepted candidate became; null while OPEN
 */
public record KnowledgeCandidateView(UUID id, String scope, UUID productId, String productName,
                                     String subject, String content, String origin, int evidenceCount,
                                     String state, UUID sourceId, Instant createdAt) {
}
