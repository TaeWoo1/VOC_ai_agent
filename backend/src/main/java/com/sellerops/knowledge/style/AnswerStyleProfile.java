package com.sellerops.knowledge.style;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
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

    /**
     * {@code style/v3@8f1c0a2b4d6e} — what a draft's provenance records.
     *
     * <p><b>The counter alone was not an identity.</b> {@code version} is this org's own save
     * counter, so two companies at v3 stamped the same string while wording replies differently, and
     * an org that changed a setting and changed it back read as v5 against a v3 draft that was
     * written by the identical profile. A reader asking "which wording produced this" got an answer
     * that was only meaningful inside one org's history.
     *
     * <p>The digest fixes both: it is a function of the PROFILE, so equal wording stamps equal, and
     * different wording stamps different — across orgs and across time. The counter stays in front
     * of it because it is what the settings screen and the audit trail count in, and losing the
     * ordering would trade one missing fact for another.
     *
     * <p><b>No profile at all is {@code style/default}</b>, with no digest — an org that never set a
     * style and an org that saved the defaults are different facts, and only the second one has a
     * save to be reproduced. The defaults themselves are a shipped constant that needs no fingerprint
     * to be looked up.
     */
    public String identity() {
        return version <= 0 ? "style/default" : "style/v" + version + "@" + digest();
    }

    /**
     * A deterministic fingerprint of this wording. 12 hex characters of SHA-256.
     *
     * <p><b>It is a digest, not a snapshot.</b> The seller's greeting and the company's phrase lists
     * are one-way — nothing here stores their text a second time, which is the property that keeps a
     * reproducible audit from becoming a second copy of the customer's and the seller's words. What
     * it can answer is the question an audit actually asks: were these two drafts written under the
     * same style, and is that style still the one configured today.
     *
     * <p>The canonical form is field-labelled and separator-delimited rather than concatenated, so a
     * greeting ending where a closing begins cannot collide with the two swapped. Lists keep their
     * ORDER — the seller chose it, and the model is shown it in that order.
     */
    public String digest() {
        StringBuilder canonical = new StringBuilder();
        canonical.append("t=").append(tone.name()).append('\n')
                .append("l=").append(length.name()).append('\n')
                .append("e=").append(emoji.name()).append('\n')
                .append("g=").append(norm(greeting)).append('\n')
                .append("c=").append(norm(closing)).append('\n')
                .append("a=").append(norm(customerAddress)).append('\n')
                .append("r=").append(String.join("\u001f", requiredPhrases)).append('\n')
                .append("f=").append(String.join("\u001f", forbiddenPhrases)).append('\n')
                // The fallback is part of the identity even though it renders no prompt section: it
                // is the exact text a SELLER_APPROVED_FALLBACK draft was saved from, and a draft
                // whose source sentence has since changed must not read as reproducible.
                .append("u=").append(norm(unknownFallback));
        try {
            byte[] hash = MessageDigest.getInstance("SHA-256")
                    .digest(canonical.toString().getBytes(StandardCharsets.UTF_8));
            StringBuilder hex = new StringBuilder(12);
            for (int i = 0; i < 6; i++) {
                hex.append(String.format("%02x", hash[i]));
            }
            return hex.toString();
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException("SHA-256 unavailable", e);
        }
    }

    private static String norm(String value) {
        return value == null ? "" : value;
    }

    /** The seller's own approved sentence for "we do not know yet", or null. */
    public boolean hasUnknownFallback() {
        return unknownFallback != null && !unknownFallback.isBlank();
    }
}
