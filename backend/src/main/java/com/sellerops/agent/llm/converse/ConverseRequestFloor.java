package com.sellerops.agent.llm.converse;

import java.util.List;

/**
 * The shape a conversation request must have to be allowed out — this capability's payload floor,
 * enforced at runtime rather than only asserted in a test.
 *
 * <p><b>Why a shape floor and not a structural one.</b> Like the judge's digest, the fact sheet is
 * ASSEMBLED by a caller that holds a whole turn's state, so "there is no way for a fifth value to
 * appear" is not available. Two different floors therefore apply to the two different sections:
 *
 * <ul>
 *   <li><b>Facts and turns are prose</b> — ours and the seller's — so what is checkable is SIZE. A
 *       fact sheet is bounded by the number of channels and domains this deployment has; a thread
 *       excerpt is bounded by the number of turns we choose to send. Anything larger is a caller that
 *       has started pasting something in.</li>
 *   <li><b>The context envelope is closed tokens</b> — {@code focus=REVIEW}, {@code readiness=NO_CHANNEL}
 *       — and is held to the judge digest's rule: {@code key=value} with no whitespace inside a value.
 *       That is the line where an id, a product name or a customer sentence would appear if the
 *       envelope ever grew one, and it is refused here.</li>
 * </ul>
 *
 * <p><b>Refusing is safe.</b> The caller falls back to the deterministic composer, which reaches no
 * vendor at all — so an over-strict floor costs the older answer, and a loose one costs a customer's
 * words in a vendor's log.
 */
public final class ConverseRequestFloor {

    static final int MAX_QUESTION = 2000;
    static final int MAX_FACTS = 80;
    static final int MAX_FACT_LENGTH = 400;
    static final int MAX_CONTEXT = 20;
    static final int MAX_CONTEXT_LENGTH = 200;
    static final int MAX_TURNS = 8;
    static final int MAX_TURN_LENGTH = 2000;

    private ConverseRequestFloor() {
    }

    public static boolean isSafe(String question, List<String> facts, List<String> context,
                                 List<String> recentTurns) {
        if (question == null || question.isBlank() || question.length() > MAX_QUESTION) {
            return false;
        }
        if (facts == null || facts.isEmpty() || facts.size() > MAX_FACTS) {
            return false;
        }
        for (String fact : facts) {
            if (fact == null || fact.isBlank() || fact.length() > MAX_FACT_LENGTH) {
                return false;
            }
        }
        if (context == null || context.size() > MAX_CONTEXT) {
            return false;
        }
        for (String line : context) {
            if (line == null || line.isBlank() || line.length() > MAX_CONTEXT_LENGTH
                    || !isClosedTokenLine(line)) {
                return false;
            }
        }
        if (recentTurns == null || recentTurns.size() > MAX_TURNS) {
            return false;
        }
        for (String turn : recentTurns) {
            if (turn == null || turn.length() > MAX_TURN_LENGTH) {
                return false;
            }
        }
        return true;
    }

    /**
     * One envelope line: whitespace-separated {@code key=value} pairs whose values carry no whitespace.
     *
     * <p>Same rule as {@code EvidenceDigestFloor}, and deliberately a second copy rather than a shared
     * helper: the judge's floor is that capability's contract and a change made for this one must not
     * silently move it. The rule is four lines; the coupling would be permanent.
     */
    private static boolean isClosedTokenLine(String line) {
        for (String token : line.trim().split("\\s+")) {
            int eq = token.indexOf('=');
            if (eq <= 0) {
                return false;
            }
            if (!isAsciiIdentifier(token.substring(0, eq))) {
                return false;
            }
            for (char c : token.substring(eq + 1).toCharArray()) {
                boolean ok = Character.isLetterOrDigit(c)
                        || c == '-' || c == '_' || c == ':' || c == '.' || c == '/' || c == '|'
                        || c == '+' || c == ',' || c == '%';
                if (!ok) {
                    return false;
                }
            }
        }
        return true;
    }

    private static boolean isAsciiIdentifier(String token) {
        if (token.isEmpty()) {
            return false;
        }
        return token.chars().allMatch(c ->
                (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9')
                        || c == '_' || c == '-');
    }
}
