package com.sellerops.product;

import java.util.Locale;

/**
 * The {@code fact_key} namespaces, and the handful of keys SellerOps names itself.
 *
 * <p>A key is {@code <namespace>:<name>}. The namespace is closed (four values); the name is the
 * channel's own attribute label, kept verbatim. Two products described by two channels therefore
 * produce keys a reader can align on without a translation table that would have to be maintained per
 * channel and would silently drop anything it did not know.
 */
public final class FactKeys {

    /** Structured specification a source stated as a named attribute — 길이, 두께, 용량. */
    public static final String SPEC = "spec";
    /** A channel attribute that is not a spec — 원산지, 인증, 배송비 유형. */
    public static final String ATTR = "attr";
    /** Seller-authored description text. */
    public static final String DESC = "desc";
    /** Classification: brand, manufacturer, category. */
    public static final String TAXONOMY = "taxonomy";

    public static final String DESC_SUMMARY = DESC + ":summary";
    public static final String TAXONOMY_BRAND = TAXONOMY + ":brand";
    public static final String TAXONOMY_MANUFACTURER = TAXONOMY + ":manufacturer";
    public static final String TAXONOMY_CATEGORY = TAXONOMY + ":category";

    private FactKeys() {
    }

    /** {@code spec:길이}. Blank names are rejected: a fact with no key is not addressable. */
    public static String of(String namespace, String name) {
        if (namespace == null || namespace.isBlank() || name == null || name.isBlank()) {
            throw new IllegalArgumentException("fact_key는 namespace와 name이 모두 필요합니다.");
        }
        String trimmed = name.strip();
        // Channel labels arrive with the odd colon ("규격: 길이"); the separator must stay unambiguous.
        return namespace.toLowerCase(Locale.ROOT) + ":" + trimmed.replace(':', ' ').strip();
    }

    public static String namespaceOf(String factKey) {
        int at = factKey == null ? -1 : factKey.indexOf(':');
        return at <= 0 ? "" : factKey.substring(0, at);
    }
}
