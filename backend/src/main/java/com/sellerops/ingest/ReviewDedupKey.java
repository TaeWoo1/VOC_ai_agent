package com.sellerops.ingest;

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

    /** The dedup-key formula version for a channel code. GMARKET → v2; everything else (incl. null) → v1. */
    public static int versionFor(String channelCode) {
        return EsmApiConnector.CHANNEL_CODE.equals(channelCode) ? V2 : V1;
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
