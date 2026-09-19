package com.sellerops.inquiry.decision;

import java.util.UUID;

/**
 * <b>What one piece of evidence is ABOUT</b> — the entity instance it is attributed to (Inquiry Decision v2.2).
 *
 * <p>Provenance, not meaning: the collector knows where a candidate came from — this listing's facts, this company's rules,
 * this inquiry's stored order — and records it here. Nothing reads the text. {@code id} is null when the kind has no
 * instance (a company rule) or when the instance is not known (unattributed).
 */
public record EvidenceScope(Kind kind, String id) {

    public enum Kind {
        /** One listing: its facts, options, add-ons, its product notes. */
        PRODUCT,
        /** One customer order. */
        ORDER,
        /** The company as a whole: rules and policies. No instance. */
        ORG
    }

    public static EvidenceScope product(UUID productId) {
        return new EvidenceScope(Kind.PRODUCT, productId == null ? null : productId.toString());
    }

    public static EvidenceScope order(String orderKey) {
        return new EvidenceScope(Kind.ORDER, orderKey);
    }

    public static final EvidenceScope ORG = new EvidenceScope(Kind.ORG, null);

    /** The order an inquiry is about, as one stable id: the channel and the channel's own order reference. */
    public static String orderKey(PrecedentReuse.OrderKey key) {
        return key == null ? null : key.channelId() + "|" + key.orderRef();
    }

    /** The Case's instances: the listing and the order it is about, when known. */
    public record CaseScope(UUID productId, String orderKey) {
        public static final CaseScope NONE = new CaseScope(null, null);

        public String idOf(Kind kind) {
            return switch (kind) {
                case PRODUCT -> productId == null ? null : productId.toString();
                case ORDER -> orderKey;
                case ORG -> null;
            };
        }
    }
}
