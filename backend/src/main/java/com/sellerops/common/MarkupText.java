package com.sellerops.common;

import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Turn a stored body that happens to carry markup into the text a person wrote.
 *
 * <p><b>Why this exists.</b> The first browser render of 문의 showed the Cafe24 backlog as
 * {@code <br /> [ Original Message ] <p>...}, {@code &nbsp;}, and one row whose entire preview was
 * {@code <table border="1" style='width: 1240px; border-width: 0px 1p…}. The board API returns the
 * post exactly as the customer's mail client or the shop's editor wrote it, and the product was
 * cutting the first 60 characters of that — which on an HTML body is 60 characters of attributes.
 * The seller could not read their own queue.
 *
 * <p><b>Display boundary only.</b> The stored body is never rewritten: it is the record of what the
 * customer sent, and a lossy normalisation is not a thing to persist. This runs on the way OUT — the
 * feed snippet, the inquiry detail the seller reads, and the draft payload the model reads. The model
 * matters as much as the screen: a question wrapped in {@code <table>} attributes is a question the
 * model answers badly.
 *
 * <p><b>Not a sanitizer, and not a renderer.</b> It produces plain text that is then escaped by
 * whatever renders it (React escapes by construction; nothing here is ever set as HTML). Entity
 * decoding runs AFTER tag removal, so a body containing {@code &lt;script&gt;} becomes the literal
 * text {@code <script>} — visible characters, never an element.
 */
public final class MarkupText {

    /**
     * How much of a body is examined. A board post can run to tens of thousands of characters and
     * every caller here wants either a 60-character preview or a bounded read; scanning the whole
     * thing with three regex passes is what made reading 500 rows cost seconds before
     * ({@code InboxService.MASK_WINDOW} carries the same lesson). 4000 is far past any preview and
     * past the readable part of a real inquiry.
     */
    public static final int SCAN_LIMIT = 4000;

    /** Block-ish tags whose end means a line ended — everything else is dropped without a trace. */
    private static final Pattern LINE_BREAKING =
            Pattern.compile("(?i)<\\s*br\\s*/?\\s*>|<\\s*/\\s*(p|div|tr|li|h[1-6]|blockquote|table)\\s*>");

    /** Any remaining tag, including an unterminated one at the scan boundary. */
    private static final Pattern TAG = Pattern.compile("<[^>]*>|<[^>]*$");

    /** The named entities a Korean commerce board actually emits. Unknown names are left alone. */
    private static final Map<String, String> NAMED = Map.of(
            "nbsp", " ", "amp", "&", "lt", "<", "gt", ">",
            "quot", "\"", "apos", "'", "#39", "'", "#34", "\"");

    private static final Pattern ENTITY = Pattern.compile("&(#x?[0-9a-fA-F]{1,6}|[a-zA-Z]{2,8});");

    /** Runs of whitespace — including the newlines the block tags just produced. */
    private static final Pattern SPACES = Pattern.compile("[ \\t\\x0B\\f\\r]+");
    private static final Pattern BLANK_LINES = Pattern.compile("\\n{3,}");

    private MarkupText() {
    }

    /**
     * The plain text of {@code body}, or {@code ""} for null. Line structure survives (block tags
     * become newlines); every other tag disappears; entities become their characters.
     */
    public static String toPlainText(String body) {
        if (body == null || body.isEmpty()) {
            return "";
        }
        String scanned = body.length() > SCAN_LIMIT ? body.substring(0, SCAN_LIMIT) : body;
        String broken = LINE_BREAKING.matcher(scanned).replaceAll("\n");
        String stripped = TAG.matcher(broken).replaceAll(" ");
        String decoded = decodeEntities(stripped);
        String spaced = SPACES.matcher(decoded).replaceAll(" ");
        // Trim each line so " \n " does not leave a line of one space.
        StringBuilder out = new StringBuilder(spaced.length());
        for (String line : spaced.split("\n", -1)) {
            out.append(line.strip()).append('\n');
        }
        return BLANK_LINES.matcher(out.toString()).replaceAll("\n\n").strip();
    }

    /**
     * The single line version — every newline becomes a space. What a list row wants, since a
     * preview that keeps line structure just wastes its 60 characters on emptiness.
     */
    public static String toSingleLine(String body) {
        return toPlainText(body).replace('\n', ' ').replaceAll(" {2,}", " ").strip();
    }

    private static String decodeEntities(String text) {
        if (text.indexOf('&') < 0) {
            return text;
        }
        Matcher m = ENTITY.matcher(text);
        StringBuilder sb = new StringBuilder(text.length());
        while (m.find()) {
            m.appendReplacement(sb, Matcher.quoteReplacement(replacementFor(m.group(1), m.group())));
        }
        m.appendTail(sb);
        return sb.toString();
    }

    private static String replacementFor(String name, String whole) {
        String named = NAMED.get(name.toLowerCase(java.util.Locale.ROOT));
        if (named != null) {
            return named;
        }
        if (name.charAt(0) != '#') {
            return whole; // an entity we did not audit — leave it exactly as written
        }
        try {
            boolean hex = name.charAt(1) == 'x' || name.charAt(1) == 'X';
            int code = Integer.parseInt(name.substring(hex ? 2 : 1), hex ? 16 : 10);
            // Refuse controls (except tab/newline) and anything outside the BMP-safe range.
            if (code < 0x20 && code != 0x09 && code != 0x0A) {
                return " ";
            }
            return code > 0x10FFFF ? whole : new String(Character.toChars(code));
        } catch (RuntimeException e) {
            return whole;
        }
    }
}
