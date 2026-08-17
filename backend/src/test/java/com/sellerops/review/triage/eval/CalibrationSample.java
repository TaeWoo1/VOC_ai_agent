package com.sellerops.review.triage.eval;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.List;
import java.util.Map;

/**
 * The sampling design of {@code contracts/review-eval/naver/v2/RUBRIC.md} §4, in Java.
 *
 * <p><b>Why this exists twice.</b> {@code tools/review-triage-calibration/} DREW the sample in
 * JavaScript; this harness WEIGHTS it in Java. If the two disagreed about which stratum a review
 * belongs to, every population number would be wrong by a factor nobody could see — the harness
 * would divide by an inclusion probability the row was never drawn under. {@code
 * CalibrationSampleTest} pins the two together on committed vectors.
 *
 * <p>Test-source only. Nothing here is reachable from a running service.
 */
public final class CalibrationSample {

    /** The draw of RUBRIC v2 §4.2. {@code Integer.MAX_VALUE} means "take the whole stratum". */
    public static final Map<String, Integer> ALLOCATION = Map.of(
            "LOW_S", Integer.MAX_VALUE,
            "LOW_M", Integer.MAX_VALUE,
            "LOW_L", Integer.MAX_VALUE,
            "MID_S", Integer.MAX_VALUE,
            "MID_M", Integer.MAX_VALUE,
            "MID_L", Integer.MAX_VALUE,
            "HIGH_S", 30,
            "HIGH_M", 40,
            "HIGH_L", 45);

    /** Declaration order, for a stable report. */
    public static final List<String> STRATA =
            List.of("LOW_S", "LOW_M", "LOW_L", "MID_S", "MID_M", "MID_L", "HIGH_S", "HIGH_M", "HIGH_L");

    private CalibrationSample() {
    }

    /**
     * Rating band × body length, the two properties a candidate rule's TEXT signal does not read.
     *
     * <p>Length is counted in <b>code points</b> — the unit Postgres {@code length()} and JS
     * {@code [...body].length} both use — so a body containing an emoji lands in the same stratum in
     * all three places. Returns {@code null} for an unrated review: those are outside the frame.
     */
    public static String stratumOf(Integer rating, String body) {
        if (rating == null) {
            return null;
        }
        String band = rating <= 2 ? "LOW" : rating == 3 ? "MID" : "HIGH";
        String text = body == null ? "" : body;
        int codePoints = text.codePointCount(0, text.length());
        String size = codePoints >= 40 ? "L" : codePoints >= 20 ? "M" : "S";
        return band + "_" + size;
    }

    /** RUBRIC v2 §4.3 — the within-stratum draw order. Lowercase 64-hex, compared as a string. */
    public static String sampleOrderKey(String fingerprint) {
        return hex(digest("review-eval-sample/v2\n" + fingerprint));
    }

    /**
     * RUBRIC v2 §6.1 — {@code DEV} or {@code HOLDOUT}, fixed before labeling and stored nowhere.
     *
     * <p>The first byte is read as UNSIGNED. Java's {@code byte} is signed, so {@code b % 2} on a
     * negative value yields {@code -1} and would sort every high byte into {@code HOLDOUT}; masking
     * is what keeps this the same 50/50 partition the JavaScript side computed.
     */
    public static String splitOf(String fingerprint) {
        return (digest("review-eval-split/v2\n" + fingerprint)[0] & 0xff) % 2 == 0 ? "DEV" : "HOLDOUT";
    }

    private static byte[] digest(String input) {
        try {
            return MessageDigest.getInstance("SHA-256").digest(input.getBytes(StandardCharsets.UTF_8));
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException("SHA-256 is required", e);
        }
    }

    private static String hex(byte[] bytes) {
        StringBuilder out = new StringBuilder(bytes.length * 2);
        for (byte b : bytes) {
            out.append(Character.forDigit((b >> 4) & 0xf, 16)).append(Character.forDigit(b & 0xf, 16));
        }
        return out.toString();
    }
}
