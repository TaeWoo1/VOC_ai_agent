package com.sellerops.review.triage.feedback;

/**
 * Which mechanism produced the tier a seller was looking at when they gave feedback on it.
 *
 * <p>Two values and no third. {@code RULES} is {@code ReviewTriageRules}; {@code AI} is the pilot's
 * additive {@code AI 확인 필요} mark. A correction that did not say which it corrected would be exactly
 * the uninterpretable row V41's design note warned about — and a seller who says "필요 없음" to a
 * rules 확인 필요 and one who says it to an AI mark are disagreeing with different things.
 */
public enum TriageShownSource {
    RULES,
    AI
}
