package com.sellerops.inquiry.esmimport;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.text.Normalizer;
import java.util.UUID;

/**
 * Deterministic identity for an ESM inquiry row, which has <b>no stable source id</b>.
 * The fingerprint (v1) is a SHA-256 over a fixed, labeled, newline-separated,
 * NFC-normalized field list — using the <b>canonical</b> received timestamp
 * ({@code yyyy-MM-dd HH:mm:ss} local KST, second precision, never reduced to day level)
 * rather than the lexical raw string, so the dot- and dash-separated exports of the same
 * local time collapse to one identity while two genuinely distinct inquiry times never
 * collide. It is marketplace- and seller-account-scoped, so identical text under different
 * accounts (or Gmarket vs Auction) stays distinct. The synthetic external id
 * {@code esm:{marketplace}:{sellerAccountId}:{fingerprint}} carries this into the
 * existing external-id dedup path. The exact original raw timestamp string is kept
 * separately in provenance, not here.
 */
public final class EsmInquiryFingerprint {

    public static final int VERSION = 1;

    private EsmInquiryFingerprint() {
    }

    /**
     * @param inquiryType         문의유형 (nullable → empty)
     * @param orderRef            주문번호 (nullable → empty)
     * @param productRef          상품번호 (nullable → empty)
     * @param receivedAtCanonical canonical 접수일시 ({@code yyyy-MM-dd HH:mm:ss}, KST local,
     *                            separator-independent — see {@link EsmInquiryTimestamp#canonical}),
     *                            NOT the lexical raw string
     * @param body                문의내용
     */
    public static String compute(EsmMarketplace marketplace, UUID sellerAccountId, String inquiryType,
                                 String orderRef, String productRef, String receivedAtCanonical, String body) {
        String payload = String.join("\n",
                "marketplace=" + marketplace.name(),
                "sellerAccountId=" + sellerAccountId,
                "inquiryType=" + nfc(orEmpty(inquiryType)),
                "orderRef=" + nfc(orEmpty(orderRef)),
                "productRef=" + nfc(orEmpty(productRef)),
                "receivedAt=" + nfc(orEmpty(receivedAtCanonical)),
                "title=",
                "body=" + normalizeBody(body));
        return sha256Hex(payload);
    }

    /** The synthetic external id that carries the fingerprint into external-id dedup. */
    public static String externalId(EsmMarketplace marketplace, UUID sellerAccountId, String fingerprint) {
        return "esm:" + marketplace.name() + ":" + sellerAccountId + ":" + fingerprint;
    }

    private static String normalizeBody(String body) {
        if (body == null) {
            return "";
        }
        // Collapse all whitespace runs to a single space and trim, then NFC.
        return nfc(body.strip().replaceAll("\\s+", " "));
    }

    private static String nfc(String s) {
        return Normalizer.normalize(s, Normalizer.Form.NFC);
    }

    private static String orEmpty(String s) {
        return s == null ? "" : s;
    }

    private static String sha256Hex(String s) {
        try {
            byte[] d = MessageDigest.getInstance("SHA-256").digest(s.getBytes(StandardCharsets.UTF_8));
            StringBuilder sb = new StringBuilder(d.length * 2);
            for (byte b : d) {
                sb.append(Character.forDigit((b >> 4) & 0xF, 16)).append(Character.forDigit(b & 0xF, 16));
            }
            return sb.toString();
        } catch (Exception e) {
            throw new IllegalStateException("SHA-256 unavailable", e);
        }
    }
}
