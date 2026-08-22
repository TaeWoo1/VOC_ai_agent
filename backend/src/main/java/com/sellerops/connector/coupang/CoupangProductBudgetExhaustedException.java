package com.sellerops.connector.coupang;

/**
 * The catalogue walk stopped because it reached its marketplace-request ceiling.
 *
 * <p>An explicit termination, not a failure of the channel: everything already collected is kept and
 * the run ends PARTIAL naming this reason. It deliberately does <b>not</b> continue by itself —
 * whether a bigger catalogue is worth more requests is an operator's decision, and a crawl that
 * quietly resumes past its own bound is the thing the bound exists to prevent.
 */
public class CoupangProductBudgetExhaustedException extends RuntimeException {

    private final int spent;
    private final int budget;

    CoupangProductBudgetExhaustedException(int spent, int budget) {
        super("BUDGET_EXHAUSTED: 쿠팡 상품 수집이 이번 순회의 요청 한도(" + budget + "회)에 도달해 중단되었습니다"
                + " (사용 " + spent + "회). 자동으로 이어서 수집하지 않습니다.");
        this.spent = spent;
        this.budget = budget;
    }

    public int spent() {
        return spent;
    }

    public int budget() {
        return budget;
    }
}
