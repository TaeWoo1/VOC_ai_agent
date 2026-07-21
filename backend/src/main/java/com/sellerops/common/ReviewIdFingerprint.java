package com.sellerops.common;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.text.Normalizer;
import java.util.HexFormat;
import java.util.regex.Pattern;

/**
 * {@code review-id-fingerprint/v1} — the backend half of the shared <b>channel review id</b> fingerprint.
 *
 * <p>A deterministic one-way fingerprint of a channel-side review identifier (for NAVER SmartStore: the
 * {@code 리뷰글번호} export column, which lands untransformed in {@code reviews.external_id}). It exists so two
 * sources can be proven to hold the same review id <b>without the raw id ever being printed, logged, or sent
 * to a client</b>. Byte-identical to the collector's {@code review-id-fingerprint.ts} and its in-page port,
 * proven by {@code contracts/review-id-fingerprint/v1/golden-vectors.json}.
 *
 * <p>This is <b>not</b> {@link ReviewBodyFingerprint} ({@code review-body-fingerprint/v1}) and <b>not</b> the
 * reply-draft fingerprint ({@code review-reply-v1}); the domain-separation prefix makes a cross-contract
 * collision impossible.
 *
 * <p><b>Honest limitation.</b> A NAVER {@code 리뷰글번호} is a 10-digit number — an enumerable space. This is a
 * <b>leak-hygiene</b> device, not a privacy guarantee against someone who already holds the id space.
 *
 * <p>Pure: no clock, no I/O, never logs its input.
 */
public final class ReviewIdFingerprint {

    /** Same explicit Unicode White_Space class as {@link ReviewBodyFingerprint} — pinned, not {@code (?U)\s}. */
    private static final String WS =
            "\\t\\n\\x0B\\f\\r \\x85\\xA0\\u1680\\u2000-\\u200A\\u2028\\u2029\\u202F\\u205F\\u3000";
    private static final Pattern TRIM = Pattern.compile("^[" + WS + "]+|[" + WS + "]+$");
    private static final Pattern ANY_WHITESPACE = Pattern.compile("[" + WS + "]");
    private static final Pattern ZERO_WIDTH = Pattern.compile("[\\u200B\\u200C\\u200D\\uFEFF]");
    private static final Pattern CONTROL = Pattern.compile("[\\u0000-\\u001F\\u007F-\\u009F]");

    /** {@code reviews.external_id} is {@code varchar(120)}. */
    public static final int MAX_LENGTH = 120;

    private static final String DOMAIN = "review-id-fingerprint/v1\n";

    private ReviewIdFingerprint() {
    }

    /** NFC → drop zero-width marks → trim the ends. No case folding, no collapsing, no numeric coercion. */
    public static String canonicalize(String raw) {
        if (raw == null) {
            return "";
        }
        String s = Normalizer.normalize(raw, Normalizer.Form.NFC);
        s = ZERO_WIDTH.matcher(s).replaceAll("");
        return TRIM.matcher(s).replaceAll("");
    }

    /** Non-empty, within the column width, no embedded whitespace, no C0/C1 control. Fails closed. */
    public static boolean isWellFormed(String canonical) {
        return canonical != null
                && !canonical.isEmpty()
                && canonical.length() <= MAX_LENGTH
                && !ANY_WHITESPACE.matcher(canonical).find()
                && !CONTROL.matcher(canonical).find();
    }

    /** Lowercase 64-hex SHA-256 of {@code DOMAIN + canonical}, or {@code null} when the id is malformed. */
    public static String of(String raw) {
        String canonical = canonicalize(raw);
        if (!isWellFormed(canonical)) {
            return null;
        }
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            return HexFormat.of().formatHex(digest.digest((DOMAIN + canonical).getBytes(StandardCharsets.UTF_8)));
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException("SHA-256 unavailable", e);
        }
    }
}
