package com.sellerops.agent.llm.operator;

/**
 * The shape an evidence digest must have to be allowed out — the judge capability's payload floor,
 * enforced at runtime rather than only asserted in a test.
 *
 * <p><b>Why this exists and the other two capabilities have nothing like it.</b> The draft capability
 * sends two named fields off one entity; the plan capability sends one sentence and a static list.
 * Both floors are structural: there is no way for a third value to appear. The judge's input is
 * different in kind — it is ASSEMBLED, line by line, by a caller that has an entire run's state in
 * hand. A structural floor is not available, so a shape floor takes its place.
 *
 * <p><b>The shape.</b> Every line must be {@code key=value} pairs separated by spaces, where a value
 * carries no whitespace. That admits {@code e1 kind=REVIEW_ISSUE severity=HIGH count=12
 * coverage=COVERED observedOn=2026-08-14} and rejects anything with a sentence in it — a Korean
 * particle, a comma-space, a quoted phrase, a masked quote. It is deliberately cruder than a
 * PII detector: a detector answers "does this contain personal data", which is unknowable, and this
 * answers "is this metadata", which is checkable.
 *
 * <p><b>Rejecting is safe.</b> The caller falls back to the deterministic rule judge, which reaches no
 * vendor at all. So the failure mode of an over-strict floor is a quieter Operator, and the failure
 * mode of a loose one is a customer's words in a vendor's logs.
 */
public final class EvidenceDigestFloor {

    /** A digest longer than this is refused outright: nothing legitimate is this big. */
    static final int MAX_LENGTH = 8000;

    /** Lines beyond this are refused: a run's evidence is bounded, so a long digest is a bug. */
    static final int MAX_LINES = 60;

    private EvidenceDigestFloor() {
    }

    /** True when every line of the digest is whitespace-separated {@code key=value} metadata. */
    public static boolean isSafe(String digest) {
        if (digest == null || digest.isBlank()) {
            // An empty digest is safe to send: it says "no evidence", which is a true and useful input.
            return true;
        }
        if (digest.length() > MAX_LENGTH) {
            return false;
        }
        String[] lines = digest.split("\n", -1);
        if (lines.length > MAX_LINES) {
            return false;
        }
        for (String line : lines) {
            String trimmed = line.trim();
            if (trimmed.isEmpty()) {
                continue;
            }
            for (String token : trimmed.split("\\s+")) {
                if (!isMetadataToken(token)) {
                    return false;
                }
            }
        }
        return true;
    }

    /**
     * One token is metadata when it is a bare ASCII identifier ({@code e1}) or a {@code key=value} pair.
     *
     * <p><b>The bare-token rule is the load-bearing one, and it is the one this test caught.</b> A value
     * may contain Hangul, because {@code topic} really is 배송/교환/… — so a single-word value is
     * indistinguishable from a single Korean word and must be allowed. What that lets through is one
     * word, never a sentence: a sentence has spaces, and every word after the first arrives as a BARE
     * token. Restricting bare tokens to ASCII identifiers therefore rejects the sentence at its second
     * word, while {@code e1} and {@code REVIEW_ISSUE} still pass.
     *
     * <p>The key charset is ASCII for the same reason: a Hangul "key" is a word from a sentence that
     * happened to be followed by an {@code =}.
     */
    private static boolean isMetadataToken(String token) {
        int eq = token.indexOf('=');
        if (eq < 0) {
            return isAsciiIdentifier(token);
        }
        String key = token.substring(0, eq);
        String value = token.substring(eq + 1);
        return isAsciiIdentifier(key) && value.chars().allMatch(EvidenceDigestFloor::isValueChar);
    }

    /** ASCII letters, digits, underscore and hyphen — what an id or a field name is made of. */
    private static boolean isAsciiIdentifier(String token) {
        if (token.isEmpty()) {
            return false;
        }
        return token.chars().allMatch(c ->
                (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9')
                        || c == '_' || c == '-');
    }

    private static boolean isValueChar(int c) {
        return Character.isLetterOrDigit(c)
                || c == '-' || c == '_' || c == ':' || c == '.' || c == '/' || c == '|'
                || c == '+' || c == ',' || c == '%';
    }
}
