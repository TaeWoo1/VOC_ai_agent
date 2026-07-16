package com.sellerops.attention;

import com.sellerops.common.ApiException;
import java.util.UUID;

/**
 * The attention surface's addressing vocabulary: a source-qualified reference to one
 * drill-down row, formatted {@code "<source>:<uuid>"} (e.g. {@code review:6f1c…}).
 *
 * <p><b>An address, never an authorization token.</b> Holding a ref grants nothing and
 * proves nothing. It names a row; it does not assert the holder may see or act on it.
 * Every consumer re-authorizes from the authenticated principal on every use — the org
 * comes from the JWT and never from the ref, and the account/channel scope is re-derived
 * server-side (see {@code ReviewTriageService}). This matters because the id inside a ref
 * is the raw {@code reviews.id} UUID: unguessable in practice, but unguessability is not
 * authorization, and treating it as one is how an opaque-looking string quietly becomes a
 * bearer capability.
 *
 * <p><b>Why source-qualified.</b> The drill-down is a union over two heterogeneous stores
 * — {@code reviews} (via {@code IngestedReviewVocItemSource}) and
 * {@code cafe24_community_articles} (via {@code Cafe24VocItemSource}) — whose ids are
 * independent UUID spaces. A bare UUID would be ambiguous across them the moment a second
 * store becomes addressable, and the ambiguity would be silent: an id from one store would
 * simply miss in the other and read as "not found" rather than "wrong kind". The prefix
 * makes the store explicit at the boundary, so an unsupported source is rejected as such
 * instead of being mistaken for a deleted row.
 *
 * <p>Today only {@code review} is mintable and parseable — the Cafe24 store has no triage
 * anchor, so its rows carry a null ref (see {@code Cafe24VocItemSource}). The format is the
 * stable part of the contract; the set of sources is expected to grow.
 *
 * <p><b>Client-opaque.</b> Clients must round-trip the string and never parse it. The
 * {@code source:uuid} shape is a server-side implementation detail that this class owns,
 * and the {@code reviews.id} inside it is not a field the DTO exposes on its own —
 * {@link com.sellerops.attention.dto.OperatorVocItem} deliberately carries no bare id.
 */
public final class VocItemRef {

    /** The one source that can be addressed today: the ingested-review store. */
    public static final String REVIEW_SOURCE = "review";

    private static final char SEPARATOR = ':';

    private VocItemRef() {
    }

    /** The stable ref for one ingested review row. */
    public static String forReview(UUID reviewId) {
        return REVIEW_SOURCE + SEPARATOR + reviewId;
    }

    /**
     * A client-supplied ref → the review id it addresses.
     *
     * <p>Both failure modes are 400, deliberately distinguished by message rather than
     * status: neither says anything about whether a row exists. Existence is decided later,
     * after authorization, so a malformed ref cannot be used to probe for rows.
     *
     * <p><b>This is a validator, not the exact inverse of {@link #forReview}</b>, and the
     * gap is worth stating rather than assuming away: {@link UUID#fromString} is lenient
     * about group widths, so {@code review:1-1-1-1-1} parses (to
     * {@code 00000001-0001-0001-0001-000000000001}) even though this class would never mint
     * an abbreviated form. Accepted refs are therefore a superset of mintable ones, and two
     * spellings can alias to one id.
     *
     * <p>That is harmless, and deliberately left alone rather than tightened: the parsed id
     * is authorization-neutral — it is looked up org-scoped and an id nothing minted simply
     * resolves to nothing, giving the same 404 as any other unaddressable ref. Idempotency
     * keys off {@code commandId}, never the ref, so an alias cannot double-apply anything.
     * Canonical-form strictness would buy a tidier error, not a safety property.
     *
     * @throws ApiException 400 when the ref is absent, unseparated, or has a tail
     *                      {@link UUID#fromString} rejects; or when it is well-formed but
     *                      names a source that carries no triage anchor (e.g. a Cafe24
     *                      community article).
     */
    public static UUID parseReviewId(String raw) {
        if (raw == null || raw.isBlank()) {
            throw ApiException.badRequest("항목 참조(actionRef)가 필요합니다.");
        }
        String ref = raw.strip();
        int separator = ref.indexOf(SEPARATOR);
        // A leading separator (no source) and a trailing one (no id) are both malformed;
        // requiring a non-empty side on each is what keeps ":x" and "review:" out.
        if (separator <= 0 || separator == ref.length() - 1) {
            throw ApiException.badRequest("항목 참조 형식이 올바르지 않습니다.");
        }
        String source = ref.substring(0, separator);
        if (!REVIEW_SOURCE.equals(source)) {
            // Well-formed, but this store has no triage anchor — an honest "not supported",
            // not a "not found" that would imply the row might exist elsewhere.
            throw ApiException.badRequest("이 항목 유형은 아직 처리 상태를 기록할 수 없습니다.");
        }
        try {
            return UUID.fromString(ref.substring(separator + 1));
        } catch (IllegalArgumentException e) {
            throw ApiException.badRequest("항목 참조 형식이 올바르지 않습니다.");
        }
    }
}
