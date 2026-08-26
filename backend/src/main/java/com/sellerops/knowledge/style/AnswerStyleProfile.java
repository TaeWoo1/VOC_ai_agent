package com.sellerops.knowledge.style;

import java.util.List;

/**
 * <b>How this company words a reply</b> — the immutable value the draft composition reads.
 *
 * <p>Separate from the entity on purpose. The entity is a row that may or may not exist; this is the
 * answer to "what style applies here", which always exists. An org that never opened the settings
 * screen gets {@link #defaults()}, which is exactly the wording SellerOps produced before this
 * package — so absence changes nothing, and a company that likes today's replies has nothing to do.
 *
 * <p><b>It cannot carry a fact.</b> Every field here is about MANNER: which tone, how long, what to
 * say hello with. The one field that looks like content — {@link #unknownFallback()} — is a sentence
 * that deliberately asserts nothing, and the required-phrase list refuses anything that asserts
 * something ({@link StylePhrases#assertsFact}). That is the contract this whole package rests on:
 * <b>Knowledge is what is true, Style is how it is said, and style never wins.</b>
 *
 * @param version identity of this wording, stamped into a draft's provenance; 0 for the defaults
 */
public record AnswerStyleProfile(AnswerTone tone, AnswerLength length, EmojiPolicy emoji,
                                 String greeting, String closing, String customerAddress,
                                 List<String> requiredPhrases, List<String> forbiddenPhrases,
                                 String unknownFallback, int version) {

    private static final AnswerStyleProfile DEFAULTS = new AnswerStyleProfile(
            AnswerTone.POLITE, AnswerLength.NORMAL, EmojiPolicy.NONE,
            null, null, null, List.of(), List.of(), null, 0);

    public AnswerStyleProfile {
        tone = tone == null ? AnswerTone.POLITE : tone;
        length = length == null ? AnswerLength.NORMAL : length;
        emoji = emoji == null ? EmojiPolicy.NONE : emoji;
        requiredPhrases = requiredPhrases == null ? List.of() : List.copyOf(requiredPhrases);
        forbiddenPhrases = forbiddenPhrases == null ? List.of() : List.copyOf(forbiddenPhrases);
    }

    /**
     * The style of an org that has never set one.
     *
     * <p>Neutral and 정중 — not "no style". There is no such thing as an unstyled sentence, and
     * pretending otherwise would mean the shipped default is whatever the model felt like that day.
     */
    public static AnswerStyleProfile defaults() {
        return DEFAULTS;
    }

    /**
     * Is this the wording SellerOps already produced?
     *
     * <p>Checked on the CONTENT rather than on the row's existence, so a company that opens the
     * settings screen, saves it unchanged, and expects nothing to move gets exactly that. The
     * version still advances — the audit records that someone saved — but no style section is added
     * to a prompt that would read identically without it.
     */
    public boolean isDefault() {
        return tone == AnswerTone.POLITE && length == AnswerLength.NORMAL && emoji == EmojiPolicy.NONE
                && blank(greeting) && blank(closing) && blank(customerAddress)
                && requiredPhrases.isEmpty() && forbiddenPhrases.isEmpty();
    }

    private static boolean blank(String value) {
        return value == null || value.isBlank();
    }

    /** {@code style/v3} — what a draft's provenance records, so wording is reproducible later. */
    public String identity() {
        return version <= 0 ? "style/default" : "style/v" + version;
    }

    /** The seller's own approved sentence for "we do not know yet", or null. */
    public boolean hasUnknownFallback() {
        return unknownFallback != null && !unknownFallback.isBlank();
    }
}
