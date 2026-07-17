package com.sellerops.common;

/**
 * Outcome of {@link VocPreviewSanitizer#redactFullBody(String)} — the whole of one VOC body
 * with its sensitive spans tokenized, for a surface where the operator must READ the text
 * rather than recognise it.
 *
 * <p>Deliberately not {@link SafePreviewResult}, though the two are neighbours. That record's
 * {@code SUPPRESSED} means "too little real text survived to be worth showing", which is the
 * right call for a 60-character snippet in a list and the wrong one here: an operator writing
 * a reply needs the complaint even when most of it redacted away, and silently showing them
 * nothing would leave them answering a review they cannot see. The two paths differ in what
 * they do when a body is mostly sensitive, so they do not share a return type that would
 * imply otherwise.
 *
 * <p>{@code text} is null only when the source was null or blank — the one case where there
 * is genuinely nothing to show.
 *
 * <p>{@code redacted} says whether any span was replaced. It exists so the surface can tell
 * the operator that something was hidden: they are about to send this text to a customer, and
 * a {@code [번호]} they cannot explain is worth a sentence of UI rather than a mystery.
 */
public record RedactedBody(String text, boolean redacted) {

    static RedactedBody empty() {
        return new RedactedBody(null, false);
    }
}
