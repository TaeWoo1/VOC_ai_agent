package com.sellerops.knowledge.memory.dto;

import com.sellerops.knowledge.memory.AnswerMemoryStrength;
import java.time.Instant;
import java.util.UUID;

/**
 * One remembered answer offered as grounding.
 *
 * <p>{@code strength} and {@code strengthLabel} travel with it because a past answer is not a fact —
 * it is a record of what this company said before, and how firmly. A seller reading it must be able
 * to tell "채널에 등록된 답변" from "전송이 확인된 답변" without opening anything.
 */
public record AnswerMemoryPassage(UUID memoryId, String topicSignature, String topicCategory,
                                  String answerTitle, String answerBody, double score,
                                  AnswerMemoryStrength strength, String strengthLabel,
                                  UUID productId, String channelCode, String authorName,
                                  int version, Instant updatedAt) {
}
