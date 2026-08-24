package com.sellerops.agent.quota;

/**
 * Whether one model call may proceed, and — when it may not — which ceiling stopped it.
 *
 * <p>The reason is separate from the refusal because the two sentences a seller needs are different:
 * "오늘 분석 횟수를 다 썼습니다" and "이 기능이 꺼져 있습니다" have different remedies, and a caller
 * that can only see {@code available=false} has to guess which one to print.
 */
public record QuotaDecision(boolean allowed, Reason reason, long used, int limit) {

    public enum Reason { DAILY_RUNS, DAILY_LLM_CALLS }

    static QuotaDecision pass() {
        return new QuotaDecision(true, null, 0, 0);
    }

    static QuotaDecision exhausted(Reason reason, long used, int limit) {
        return new QuotaDecision(false, reason, used, limit);
    }

    /** The seller-facing sentence. Short, and it says what still works. */
    public String messageKo() {
        return switch (reason) {
            case DAILY_RUNS -> "오늘 사용할 수 있는 AI 분석 횟수를 모두 썼습니다. 내일 다시 사용할 수 있고,"
                    + " 화면의 숫자와 목록은 그대로 이용할 수 있습니다.";
            case DAILY_LLM_CALLS -> "오늘 사용할 수 있는 AI 처리량을 모두 썼습니다. 내일 다시 사용할 수 있고,"
                    + " 화면의 숫자와 목록은 그대로 이용할 수 있습니다.";
        };
    }
}
