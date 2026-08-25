package com.sellerops.connector.cafe24.onboarding;

import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;

/**
 * What SellerOps is allowed to ask a Cafe24 seller to consent to — two scope sets, and a rule that
 * keeps them from becoming one.
 *
 * <p><b>Why this is a class and not a string.</b> The connection used to be read-only by
 * construction: {@code Cafe24OnboardingService} threw at startup if its configured scope string
 * contained {@code write}, and that guard was correct for the product contract it protected. It is
 * also the wrong shape for a product that can now, with the seller's explicit agreement, post an
 * answer: under it, the only way to obtain {@code mall.write_community} is to widen the scope every
 * connection asks for — which is exactly the silent escalation the guard existed to prevent, and
 * which would make a read-only seller's next reconnect quietly request write.
 *
 * <p>So the contract is split instead of loosened:
 *
 * <ul>
 *   <li><b>{@code READ} — the connection.</b> Still refuses any write scope, still at startup, still
 *       for every seller. Connecting Cafe24 asks for reading and nothing else.</li>
 *   <li><b>{@code ANSWER_EXECUTION} — an option a seller turns on.</b> The read scopes plus exactly
 *       {@code mall.write_community}. Reached only from a separate, seller-initiated reconsent; never
 *       from {@code start}, never as a default, never as a retry of a failed read connection.</li>
 * </ul>
 *
 * <p>The answer-execution set is validated to be the read set plus that one scope and nothing else,
 * so a deployment cannot use it as a door for an unrelated permission. A blank configuration means
 * the option does not exist — {@link #answerExecutionAvailable()} is false and the reconsent endpoint
 * refuses — which is a working product, not a broken one.
 */
public final class Cafe24ScopeContract {

    /** The one scope that lets an app post to a mall's boards. */
    public static final String WRITE_COMMUNITY = "mall.write_community";

    private final List<String> read;
    private final List<String> answerExecution;

    /**
     * @param readScopes            comma-separated; must be non-blank and contain no write scope
     * @param answerExecutionScopes comma-separated; blank ⇒ the option is unavailable. Otherwise it
     *                              must be exactly the read scopes plus {@link #WRITE_COMMUNITY}.
     */
    public Cafe24ScopeContract(String readScopes, String answerExecutionScopes) {
        this.read = split(readScopes);
        if (read.isEmpty()) {
            throw new IllegalStateException("카페24 OAuth 스코프가 비어 있습니다.");
        }
        if (read.stream().anyMatch(s -> s.contains("write"))) {
            throw new IllegalStateException(
                    "카페24 연결 스코프는 읽기 전용이어야 합니다 (write 스코프 금지).");
        }
        List<String> answer = split(answerExecutionScopes);
        if (!answer.isEmpty()) {
            Set<String> expected = new LinkedHashSet<>(read);
            expected.add(WRITE_COMMUNITY);
            if (!expected.equals(new LinkedHashSet<>(answer))) {
                throw new IllegalStateException(
                        "카페24 답변 실행 스코프는 연결 스코프 + " + WRITE_COMMUNITY + " 여야 합니다.");
            }
        }
        this.answerExecution = answer;
    }

    /** The scope string every Cafe24 connection asks for. Read-only, always. */
    public String readScopes() {
        return String.join(",", read);
    }

    /** Whether a deployment has configured the answer-execution option at all. */
    public boolean answerExecutionAvailable() {
        return !answerExecution.isEmpty();
    }

    /**
     * The scope string the seller-initiated answer-execution reconsent asks for.
     *
     * @throws IllegalStateException when the option is not configured — an unavailable option is
     *                               never silently downgraded to the read set, because a consent
     *                               screen that asked for less than it said would be worse than none
     */
    public String answerExecutionScopes() {
        if (!answerExecutionAvailable()) {
            throw new IllegalStateException("카페24 답변 실행 스코프가 설정되지 않았습니다.");
        }
        return String.join(",", answerExecution);
    }

    /** Whether a recorded grant actually carries the community-write permission. */
    public static boolean grantsWrite(List<String> grantedScopes) {
        return grantedScopes != null && grantedScopes.stream()
                .anyMatch(s -> s != null && s.strip().equalsIgnoreCase(WRITE_COMMUNITY));
    }

    private static List<String> split(String raw) {
        if (raw == null || raw.isBlank()) {
            return List.of();
        }
        return java.util.Arrays.stream(raw.split(","))
                .map(s -> s.strip().toLowerCase(Locale.ROOT))
                .filter(s -> !s.isEmpty())
                .distinct()
                .toList();
    }
}
