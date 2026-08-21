package com.sellerops.inquirysignal;

import java.util.Locale;
import java.util.regex.Pattern;

/**
 * Turn a stored inquiry body into the sentence a person actually wrote.
 *
 * <p><b>Found live 2026-08-21, and it was not a small effect.</b> On the demo org <b>3,201 of 3,220</b>
 * inquiry bodies are HTML, averaging 1,374 characters — they are Cafe24 board articles, stored exactly
 * as the mall returned them. Sending that to a classifier sends markup: the first bounded page produced
 * 5 usable labels out of 190 distinct texts, because the model was reading {@code <p style=...>} before
 * it reached anything a customer said. The pipeline "worked" the whole time.
 *
 * <p><b>This is normalization, not extraction.</b> It removes markup and collapses whitespace; it does
 * not summarise, translate, re-order, or decide what the inquiry is about. Nothing here can invent a
 * word the seller's mall did not store.
 *
 * <p><b>It also tightens the exposure.</b> The normalized text is what is hashed AND what is sent, so a
 * vendor receives the customer's sentence instead of the sentence plus a page of style attributes — and
 * two HTML renderings of the same question now share one cache row, which means one egress instead of
 * two.
 */
public final class InquiryText {

    /** Block-level tags become a space so two paragraphs do not fuse into one word. */
    private static final Pattern BLOCK_TAG = Pattern.compile(
            "(?i)</?(p|div|br|li|tr|td|h[1-6]|blockquote|section|article)\\b[^>]*>");
    private static final Pattern ANY_TAG = Pattern.compile("<[^>]{0,4000}>");
    /** Script/style CONTENT is not customer text at all and must not survive tag removal. */
    private static final Pattern SCRIPT_OR_STYLE = Pattern.compile(
            "(?is)<(script|style)\\b[^>]*>.*?</\\1>");
    private static final Pattern WHITESPACE = Pattern.compile("[\\s\\u00a0]+");

    private InquiryText() {
    }

    /**
     * Markup out, whitespace collapsed, entities decoded. Returns an empty string when nothing readable
     * is left — which a caller must treat as "not classifiable", never as a blank question.
     */
    public static String normalize(String raw) {
        if (raw == null || raw.isBlank()) {
            return "";
        }
        String text = SCRIPT_OR_STYLE.matcher(raw).replaceAll(" ");
        text = BLOCK_TAG.matcher(text).replaceAll(" ");
        text = ANY_TAG.matcher(text).replaceAll("");
        text = decodeEntities(text);
        return WHITESPACE.matcher(text).replaceAll(" ").strip();
    }

    /**
     * The handful of entities Korean mall content actually contains.
     *
     * <p>Deliberately not a full HTML entity table: an unknown entity is left as written rather than
     * guessed at, and the only cost of that is a stray {@code &something;} in a sentence a model reads —
     * whereas a wrong expansion would change what the customer said.
     */
    private static String decodeEntities(String text) {
        return text
                .replace("&nbsp;", " ")
                .replace("&amp;", "&")
                .replace("&lt;", "<")
                .replace("&gt;", ">")
                .replace("&quot;", "\"")
                .replace("&#39;", "'")
                .replace("&apos;", "'");
    }

    /**
     * Title and body joined for classification — the caller's whole input.
     *
     * <p>A period is inserted between them when the title has no sentence ending, so the subject reads
     * as its own clause rather than running into the first line of the body. Both halves are normalized:
     * a Cafe24 title is plain, but nothing guarantees that for every source.
     */
    public static String forClassification(String title, String body) {
        String t = normalize(title);
        String b = normalize(body);
        if (t.isEmpty()) {
            return b;
        }
        if (b.isEmpty()) {
            return t;
        }
        return t.endsWith(".") || t.endsWith("?") || t.endsWith("!") ? t + " " + b : t + ". " + b;
    }

    /** Lower-cased, whitespace-collapsed form used as the cache key input. */
    public static String forHashing(String normalized) {
        return normalized.toLowerCase(Locale.ROOT);
    }
}
