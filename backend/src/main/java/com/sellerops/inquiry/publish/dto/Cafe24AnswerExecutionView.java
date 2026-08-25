package com.sellerops.inquiry.publish.dto;

/**
 * Whether this org can send a Cafe24 answer today, and if not, which of the two reasons applies.
 *
 * <p>The two are different things a screen has to say differently. {@code available=false} means the
 * deployment has not configured the answer-execution option at all — nothing the seller can do.
 * {@code granted=false} means the option exists and this seller has not agreed to it — a reconsent
 * they can start, and the sentence beside [답변 보내기] should say so rather than showing a send button
 * that would refuse.
 *
 * <p>Carries no account id, no scope string and no mall id: a boolean pair is the whole answer.
 */
public record Cafe24AnswerExecutionView(boolean available, boolean granted) {
}
