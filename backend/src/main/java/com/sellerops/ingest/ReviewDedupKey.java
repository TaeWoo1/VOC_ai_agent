package com.sellerops.ingest;

import com.sellerops.connector.coupang.CoupangApiConnector;
import com.sellerops.connector.esm.EsmApiConnector;
import java.util.UUID;

/**
 * REVIEW content-hash key policy, versioned per channel so the formula can evolve
 * without invalidating existing hashes.
 *
 * <ul>
 *   <li><b>v1</b> (default, every non-GMARKET channel): {@code SHA-256(channel|product|date|body)} —
 *       the original formula, kept byte-for-byte.</li>
 *   <li><b>v2</b> (ESM+ / GMARKET channel): additionally folds in {@code rating}, so two reviews with
 *       the same product/date/body but a different rating are distinct identities (v1 would false-merge
 *       them). ESM+ REVIEW exports carry no stable review-id, so they always dedup by this hash.</li>
 * </ul>
 *
 * <p>Pure and stateless — it only composes the shared {@link ContentHash} primitive; it never touches
 * the DB. {@link IngestionService} resolves the channel code once per batch and delegates here.
 */
public final class ReviewDedupKey {

    public static final int V1 = 1;
    public static final int V2 = 2;
    /**
     * <b>v3</b> — a TEXTLESS review (the buyer rated and wrote nothing), keyed additionally on the purchased
     * option: {@code SHA-256(channel|product|date||rating|optionId)}.
     *
     * <p>It exists because of what the first live Coupang backfill found: 86% of that seller's 상품평 were
     * rating-only, and Coupang renders a fixed placeholder sentence where the body would be. Under v2 every
     * one of them hashes on the same empty body, so two rating-only reviews of one PRODUCT on one day at one
     * rating collapse into a single row — and the rating distribution, which is the only signal such a review
     * carries, silently understates.
     *
     * <p>Folding the option id is what the screen actually supports: the live reading found 옵션ID present on
     * every row. It does not close the gap, and is not pretended to — two textless reviews of the same OPTION
     * on the same day at the same rating still merge. That residue is a recorded v1 limitation
     * ({@code docs/coupang_review_acquisition_v1.md}); closing it would need a per-review identifier the
     * screen does not publish, and a row position or a buyer's name is not one.
     *
     * <p>It applies PER ROW, not per channel — which is what {@code reviews.dedup_key_version} was always for.
     * A review WITH text on the same channel keeps v2, so nothing about text reviews changes.
     */
    public static final int V3 = 3;

    private ReviewDedupKey() {
    }

    /**
     * The dedup-key formula version for a channel code. GMARKET and COUPANG → v2; everything else
     * (incl. null) → v1.
     *
     * <p><b>Coupang is v2 for the same reason ESM+ is, arrived at the other way round.</b> ESM+ exports carry
     * no review id; the Coupang WING 상품평 screen was measured and carries no per-review-unique value at all —
     * two of the operator's own ten reviews were identical in every number the page prints
     * ({@code docs/coupang_review_policy_gate_v1.md} §9.2). So Coupang reviews always dedup by content hash,
     * and rating has to be in it: short bodies repeat ("좋아요"), and v1 would fold a 5-star and a 1-star
     * review of one product on one day into a single row — the false merge that looks exactly like dedup
     * working.
     *
     * <p>The purchased option (옵션ID) is NOT folded in for a review WITH TEXT. The body already separates
     * those, and a key that included the option would change identity if a cell ever rendered without it —
     * turning a re-read of the same review into a new one. A textless review has no body to separate it,
     * which is exactly why {@link #V3} exists and why it applies only there.
     */
    public static int versionFor(String channelCode) {
        return EsmApiConnector.CHANNEL_CODE.equals(channelCode)
                || CoupangApiConnector.CHANNEL_CODE.equals(channelCode) ? V2 : V1;
    }

    /**
     * The version for ONE row: v3 when the row is textless AND carries an option id to key on, else the
     * channel's own version. A textless row with no option id falls back rather than inventing one.
     */
    public static int versionForRow(String channelCode, boolean textless, String optionId) {
        int channelVersion = versionFor(channelCode);
        boolean optionAvailable = optionId != null && !optionId.isBlank();
        return textless && optionAvailable && channelVersion >= V2 ? V3 : channelVersion;
    }

    /**
     * The content hash for the given version. v2 appends the rating (null-safe — a null rating hashes as
     * the empty part, per {@link ContentHash}); v1 is the exact original four-part formula.
     */
    public static String contentHash(int version, UUID channelId, UUID productId, String datePart,
            String body, Integer rating) {
        return contentHash(version, channelId, productId, datePart, body, rating, null);
    }

    /**
     * The content hash for the given version, with the purchased option available to v3. v3 folds the option
     * id in AFTER the rating; v2 and v1 ignore it entirely, so an existing hash cannot change by passing one.
     */
    public static String contentHash(int version, UUID channelId, UUID productId, String datePart,
            String body, Integer rating, String optionId) {
        if (version >= V3) {
            return ContentHash.of(channelId.toString(), productId.toString(), datePart, body,
                    rating == null ? null : rating.toString(), optionId);
        }
        if (version >= V2) {
            return ContentHash.of(channelId.toString(), productId.toString(), datePart, body,
                    rating == null ? null : rating.toString());
        }
        return ContentHash.of(channelId.toString(), productId.toString(), datePart, body);
    }
}
