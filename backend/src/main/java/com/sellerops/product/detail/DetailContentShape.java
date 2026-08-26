package com.sellerops.product.detail;

import java.util.Locale;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * <b>What a listing's 상세페이지 actually is</b> — measured, not assumed.
 *
 * <p>The question this answers decides whether SellerOps needs to look at pictures at all. On
 * 2026-08-26 a NAVER draft answered 「전선이 몇 가닥까지 들어가나요?」 from a product-level FAQ because
 * the real answer was on the detail page, and the working assumption was "the detail page is images".
 * That assumption is cheap to hold and expensive to build on: an OCR pipeline built for a page that
 * turned out to carry its specs as text is a large amount of machinery answering a question nobody
 * had. So the shape is classified deterministically from the markup, and the decision about images
 * follows the measurement rather than preceding it.
 *
 * <p><b>It is a parse, never a judgement about quality.</b> "Meaningful" here means "there are enough
 * characters of prose that a retriever could match on them" — {@link #MEANINGFUL_TEXT_CHARS} — not
 * that the text is good or that it answers anything. Deciding whether a page is USEFUL is retrieval's
 * job and it does it per question; this classifier only decides which acquisition path can exist.
 */
public final class DetailContentShape {

    /**
     * Below this many characters of extracted prose, a page is not carrying its information as text.
     *
     * <p>Chosen against what a 상세페이지 normally contains rather than as a round number: a page with
     * only a shop notice, a delivery line and an image wall lands well under it, while a page with any
     * real spec paragraph clears it comfortably. It is a floor for "is text the acquisition path",
     * not a threshold for "is this good enough to quote".
     */
    public static final int MEANINGFUL_TEXT_CHARS = 200;

    /** Above this many images, a page is image-led even when it also carries prose. */
    public static final int IMAGE_LED_COUNT = 3;

    private static final Pattern IMG_TAG = Pattern.compile("(?is)<\\s*img\\b[^>]*>");
    private static final Pattern TAG = Pattern.compile("(?s)<[^>]*>");
    private static final Pattern ENTITY_NBSP = Pattern.compile("(?i)&nbsp;|&#160;");

    private DetailContentShape() {
    }

    /** The four answers, plus the one that means there is nothing to classify. */
    public enum Shape {
        /** No markup at all — the seller's words, as text. */
        MEANINGFUL_TEXT,
        /** Markup, and enough prose inside it to retrieve on. */
        HTML_WITH_MEANINGFUL_TEXT,
        /** Images, and not enough prose to answer anything. **This is the only case that needs §4.** */
        IMAGE_REFERENCES_ONLY,
        /** Both: images carrying part of it, prose carrying another part. */
        MIXED,
        /** The channel returned nothing. Never confused with "the seller wrote nothing useful". */
        EMPTY;

        public String labelKo() {
            return switch (this) {
                case MEANINGFUL_TEXT -> "텍스트";
                case HTML_WITH_MEANINGFUL_TEXT -> "HTML 안의 텍스트";
                case IMAGE_REFERENCES_ONLY -> "이미지만";
                case MIXED -> "이미지와 텍스트";
                case EMPTY -> "내용 없음";
            };
        }
    }

    /**
     * The measurement. Carries the counts as well as the verdict, because a verdict with no numbers
     * behind it is not something a later reader can re-check or disagree with.
     *
     * @param textChars characters of prose left after markup and entities are removed
     * @param imageCount {@code <img>} tags found
     * @param hasMarkup whether the input contained any tag at all
     */
    public record Measurement(Shape shape, int textChars, int imageCount, boolean hasMarkup) {

        /** Is text alone an acquisition path for this page? */
        public boolean textIsEnough() {
            return shape == Shape.MEANINGFUL_TEXT || shape == Shape.HTML_WITH_MEANINGFUL_TEXT;
        }

        /**
         * Would answering from this page require reading its pictures?
         *
         * <p>True for {@link Shape#IMAGE_REFERENCES_ONLY} only. {@link Shape#MIXED} is deliberately
         * false: a mixed page has a text path, and the honest order is to take the text first and
         * find out what is still missing, rather than to build image understanding for a page whose
         * prose has never been searched.
         */
        public boolean needsImageUnderstanding() {
            return shape == Shape.IMAGE_REFERENCES_ONLY;
        }
    }

    /** Classify one {@code detailContent}. Null and blank are {@link Shape#EMPTY}, never an error. */
    public static Measurement classify(String detailContent) {
        if (detailContent == null || detailContent.isBlank()) {
            return new Measurement(Shape.EMPTY, 0, 0, false);
        }
        int images = count(IMG_TAG, detailContent);
        boolean hasMarkup = TAG.matcher(detailContent).find();
        String text = plainText(detailContent);
        int chars = text.length();

        if (chars == 0 && images == 0) {
            return new Measurement(Shape.EMPTY, 0, 0, hasMarkup);
        }
        if (images == 0) {
            // No pictures: the page is text, and the only remaining question is whether it is markup.
            return new Measurement(hasMarkup ? Shape.HTML_WITH_MEANINGFUL_TEXT : Shape.MEANINGFUL_TEXT,
                    chars, 0, hasMarkup);
        }
        if (chars < MEANINGFUL_TEXT_CHARS) {
            return new Measurement(Shape.IMAGE_REFERENCES_ONLY, chars, images, hasMarkup);
        }
        // Prose AND pictures. An image-led page is MIXED even with plenty of text, because the text
        // being sufficient is exactly what has not been established yet.
        return new Measurement(images >= IMAGE_LED_COUNT ? Shape.MIXED
                : Shape.HTML_WITH_MEANINGFUL_TEXT, chars, images, hasMarkup);
    }

    /**
     * Markup out, words in.
     *
     * <p>Tags are REMOVED, never interpreted — the same rule the display layer uses
     * ({@code lib/plainText.ts}). A stripper that tried to understand the markup would be a second,
     * divergent renderer, and the one thing this must not do is disagree with what the seller sees.
     */
    public static String plainText(String html) {
        if (html == null) {
            return "";
        }
        String withoutTags = TAG.matcher(html).replaceAll(" ");
        String withoutNbsp = ENTITY_NBSP.matcher(withoutTags).replaceAll(" ");
        return com.sellerops.common.MarkupText.toPlainText(withoutNbsp).strip();
    }

    private static int count(Pattern pattern, String text) {
        Matcher m = pattern.matcher(text);
        int n = 0;
        while (m.find()) {
            n++;
        }
        return n;
    }

    /** Sanitized one-line summary for a log or an evidence row. Counts and an enum — never the page. */
    public static String describe(Measurement m) {
        return String.format(Locale.ROOT, "shape=%s text_chars=%d images=%d markup=%s",
                m.shape(), m.textChars(), m.imageCount(), m.hasMarkup());
    }
}
