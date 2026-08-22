package com.sellerops.connector.coupang;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.databind.ObjectMapper;

/**
 * The opaque {@code cursorValue} of the Coupang PRODUCT stream: where the catalogue walk resumed
 * from, and <b>how many marketplace requests this walk has already spent</b>.
 *
 * <p><b>Why the spend lives in the cursor.</b> A catalogue crawl is a multi-page loop driven by the
 * executor, and the client that makes the requests is a singleton shared by every org — so it has
 * nowhere of its own to remember "this walk has already cost 202 requests". The cursor is the one
 * piece of per-walk state that already survives page to page, and it is Coupang-shaped
 * ({@link CoupangOrdersCursor}, {@link CoupangInquiryCursor}) rather than a general collection
 * facility. Putting the counter anywhere more central would be building the generic sync-budget
 * framework this deliberately is not.
 *
 * <p><b>The spend resets when the walk finishes.</b> A completed crawl returns a null next cursor, so
 * the following run starts at zero — the ceiling bounds one walk of the catalogue, not the account
 * forever.
 *
 * <p><b>What it does not count.</b> A page that ends in HTTP 429 is retried whole, and the connector
 * hands the executor the cursor it started that page with; the requests that page did make are
 * therefore not carried forward. The bound stays honest in the direction that matters (it can only
 * under-charge a page that produced nothing), and the client's own log line reports the actual
 * request count for the run.
 *
 * <p>A bare token string is accepted so a cursor written before this record existed still resumes.
 */
@JsonIgnoreProperties(ignoreUnknown = true)
record CoupangProductCursor(String nextToken, int spent) {

    private static final ObjectMapper MAPPER = new ObjectMapper();

    static CoupangProductCursor initial() {
        return new CoupangProductCursor(null, 0);
    }

    /** Parse a stored cursor. Blank → a fresh walk; a bare token → that token with nothing spent. */
    static CoupangProductCursor parse(String cursorValue) {
        if (cursorValue == null || cursorValue.isBlank()) {
            return initial();
        }
        String text = cursorValue.strip();
        if (!text.startsWith("{")) {
            return new CoupangProductCursor(text, 0);
        }
        try {
            CoupangProductCursor parsed = MAPPER.readValue(text, CoupangProductCursor.class);
            return parsed == null ? initial() : parsed;
        } catch (Exception malformed) {
            // A cursor we cannot read is not a licence to re-walk with a clean budget: restart the
            // walk, but keep the ceiling closed by treating the spend as unknown-and-therefore-full.
            return new CoupangProductCursor(null, Integer.MAX_VALUE);
        }
    }

    /** Serialize for storage, or null when the walk is complete (which resets the budget). */
    static String serialize(String nextToken, int spent) {
        if (nextToken == null || nextToken.isBlank()) {
            return null;
        }
        try {
            return MAPPER.writeValueAsString(new CoupangProductCursor(nextToken, spent));
        } catch (Exception e) {
            throw new IllegalStateException("쿠팡 상품 커서를 저장할 수 없습니다.");
        }
    }
}
