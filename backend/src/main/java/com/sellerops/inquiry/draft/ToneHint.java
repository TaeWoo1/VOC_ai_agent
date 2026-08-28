package com.sellerops.inquiry.draft;

import com.sellerops.knowledge.style.AnswerLength;
import com.sellerops.knowledge.style.AnswerStyleProfile;
import com.sellerops.knowledge.style.AnswerTone;

/**
 * A one-turn wording hint from the conversation — 「더 부드럽게」, 「더 정중하게」, 「짧게」.
 *
 * <p><b>It is a MANNER override, applied to the org's style profile and nowhere else.</b> The hint
 * touches exactly one field of the profile (tone or length) and leaves greeting, closing, phrases
 * and the approved fallback alone; everything downstream — the prompt's style section, the
 * forbidden-phrase check, the provenance stamp — reads the overridden profile the way it reads any
 * other, so the identity digest changes by itself and no second code path learns about tones.
 * Facts are untouched by construction: the hint never reaches the facts section of the user turn,
 * which {@code AnswerStyleDraftTest} asserts on the payload.
 *
 * <p>Not persisted. A hint is what the seller said about THIS draft; the org's setting is what they
 * said about every draft, and a one-turn remark must not quietly become policy.
 */
public enum ToneHint {

    /** 「더 부드럽게 / 덜 딱딱하게」 — the org's tone becomes {@link AnswerTone#FRIENDLY}. */
    SOFTER,
    /** 「더 정중하게」 — the org's tone becomes {@link AnswerTone#POLITE}. */
    MORE_FORMAL,
    /** 「짧게」 — the org's length becomes {@link AnswerLength#SHORT}. */
    SHORTER;

    /** The profile with this hint applied. Every other field is the org's own. */
    public AnswerStyleProfile applyTo(AnswerStyleProfile style) {
        AnswerStyleProfile base = style == null ? AnswerStyleProfile.defaults() : style;
        return switch (this) {
            case SOFTER -> withTone(base, AnswerTone.FRIENDLY);
            case MORE_FORMAL -> withTone(base, AnswerTone.POLITE);
            case SHORTER -> new AnswerStyleProfile(base.tone(), AnswerLength.SHORT, base.emoji(),
                    base.greeting(), base.closing(), base.customerAddress(), base.requiredPhrases(),
                    base.forbiddenPhrases(), base.unknownFallback(), base.version());
        };
    }

    private static AnswerStyleProfile withTone(AnswerStyleProfile base, AnswerTone tone) {
        return new AnswerStyleProfile(tone, base.length(), base.emoji(), base.greeting(), base.closing(),
                base.customerAddress(), base.requiredPhrases(), base.forbiddenPhrases(),
                base.unknownFallback(), base.version());
    }
}
