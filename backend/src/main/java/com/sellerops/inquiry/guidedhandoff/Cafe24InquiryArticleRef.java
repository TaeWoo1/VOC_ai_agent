package com.sellerops.inquiry.guidedhandoff;

import java.util.Optional;

/**
 * Parses a Cafe24 board inquiry's canonical {@code externalId} — the mall-native dedup
 * key minted by {@code Cafe24InquiryArticleMapper.externalId}, of the shape
 * {@code cafe24:b<board>:a<article>} (e.g. {@code cafe24:b6:a3670}) — back into its
 * board number and article number, so the Guided Handoff can state a privacy-safe target
 * without ever touching the inquiry title/body.
 *
 * <p>Fail-closed: anything that is not exactly this shape (a non-Cafe24 external id, a
 * legacy/file-upload row with no external id, or a malformed value) yields
 * {@link Optional#empty()} — never a guessed board/article.
 */
public record Cafe24InquiryArticleRef(int boardNo, long articleNo) {

    private static final String PREFIX = "cafe24:";

    public static Optional<Cafe24InquiryArticleRef> parse(String externalId) {
        if (externalId == null || !externalId.startsWith(PREFIX)) {
            return Optional.empty();
        }
        String[] parts = externalId.split(":");
        if (parts.length != 3 || parts[1].length() < 2 || parts[2].length() < 2
                || parts[1].charAt(0) != 'b' || parts[2].charAt(0) != 'a') {
            return Optional.empty();
        }
        try {
            int boardNo = Integer.parseInt(parts[1].substring(1));
            long articleNo = Long.parseLong(parts[2].substring(1));
            return Optional.of(new Cafe24InquiryArticleRef(boardNo, articleNo));
        } catch (NumberFormatException notNumeric) {
            return Optional.empty();
        }
    }
}
