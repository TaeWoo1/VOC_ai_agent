package com.sellerops.review.channel.dto;

import java.time.Instant;

/**
 * The pilot's additive mark on one review — {@code AI 확인 필요} — and what produced it.
 *
 * <p><b>Present only where the pilot ADDED something.</b> A review the rating-only rule already
 * calls 확인 필요 carries no mark, because there is nothing to add and a mark there would let the
 * seller credit a model for the rule's work. So this is never "the AI agrees"; it is always "the AI
 * raised this one, and the rule alone would not have".
 *
 * <p>Displayed as what it is — a candidate's suggestion — never merged into the rules tier
 * (RUBRIC v2 §13.7 item 3). {@code classifierVersion} is on the wire so the surface can say which
 * frozen candidate spoke, and so a correction the seller makes can be read against it later.
 *
 * <p>No prompt, no raw answer, no confidence figure — the candidate produces none that is calibrated,
 * and a number the surface invented would be a health claim.
 */
public record AiTriageMarkView(
        String classifierVersion,
        /** The §3.1 reason the candidate gave, or null. Descriptive; it did not decide the tier. */
        String reasonCode,
        Instant predictedAt) {
}
