package com.sellerops.common;

/**
 * Korean particle agreement, for sentences the product composes from a name it did not choose.
 *
 * <p><b>This exists because the product has now got it wrong twice in front of a live read.</b>
 * "쿠팡는" (Cross-Channel v1) and "쿠팡가 매출의 60%" (this package) were both a Korean particle
 * concatenated to a channel name without looking at the name. A seller reads that as software that
 * does not speak their language, and the fix is four lines of Hangul arithmetic rather than a lookup
 * table per channel that would be wrong again the day a channel is added.
 *
 * <p>The rule: a Hangul syllable is {@code 0xAC00 + (초성×588) + (중성×28) + 종성}, so
 * {@code (code − 0xAC00) % 28 == 0} means the syllable has no final consonant. A name ending in
 * anything else — a digit, a Latin letter, a bracket — is left to the caller's default rather than
 * guessed at, because the honest answer for "Cafe24" depends on how the seller says the number.
 */
public final class Korean {

    private static final char HANGUL_FIRST = 0xAC00;
    private static final char HANGUL_LAST = 0xD7A3;
    private static final int JONGSEONG_COUNT = 28;

    private Korean() {
    }

    /** True when the last character is a Hangul syllable carrying a final consonant (받침). */
    public static boolean endsWithFinalConsonant(String word) {
        if (word == null || word.isEmpty()) {
            return false;
        }
        char last = word.charAt(word.length() - 1);
        if (last < HANGUL_FIRST || last > HANGUL_LAST) {
            // Not a Hangul syllable. No claim is made; the caller's default particle stands.
            return false;
        }
        return (last - HANGUL_FIRST) % JONGSEONG_COUNT != 0;
    }

    /** {@code 쿠팡} → {@code 쿠팡은}; {@code 카페24 자사몰} → {@code 카페24 자사몰은}. Topic particle. */
    public static String withTopic(String word) {
        // A particle with nothing in front of it is not a shorter sentence, it is a stray syllable.
        return isBlank(word) ? "" : word + (endsWithFinalConsonant(word) ? "은" : "는");
    }

    /** {@code 쿠팡} → {@code 쿠팡이}; {@code 스토어} → {@code 스토어가}. Subject particle. */
    public static String withSubject(String word) {
        return isBlank(word) ? "" : word + (endsWithFinalConsonant(word) ? "이" : "가");
    }

    private static boolean isBlank(String word) {
        return word == null || word.isBlank();
    }
}
