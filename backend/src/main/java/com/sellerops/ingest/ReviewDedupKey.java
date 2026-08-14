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
     * <p>The purchased option (옵션ID) is deliberately NOT folded in. The column prints it on some rows and
     * not others, so a key that included it would change identity when a cell rendered differently, and a
     * re-read of the same review would import as a new one. The residual case — two options of one product,
     * same day, same rating, same body text — merges, and is recorded as a known limitation rather than
     * traded for an unstable key.
     */
    public static int versionFor(String channelCode) {
        return EsmApiConnector.CHANNEL_CODE.equals(channelCode)
                || CoupangApiConnector.CHANNEL_CODE.equals(channelCode) ? V2 : V1;
    }

    /**
     * The content hash for the given version. v2 appends the rating (null-safe — a null rating hashes as
     * the empty part, per {@link ContentHash}); v1 is the exact original four-part formula.
     */
    public static String contentHash(int version, UUID channelId, UUID productId, String datePart,
            String body, Integer rating) {
        if (version >= V2) {
            return ContentHash.of(channelId.toString(), productId.toString(), datePart, body,
                    rating == null ? null : rating.toString());
        }
        return ContentHash.of(channelId.toString(), productId.toString(), datePart, body);
    }
}
