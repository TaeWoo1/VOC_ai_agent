package com.sellerops.review.triage.llm;

import java.util.Optional;

/**
 * The one thing a seller might do about a review, from a closed list.
 *
 * <p><b>Closed rather than free text, and that is a privacy decision, not a style one.</b> A model
 * asked to write a sentence about a review writes customer content into a stored field, and every
 * guarantee in {@code contracts/review-eval/naver/v2/RUBRIC.md} §5 rests on there being nowhere for
 * prose to land. The same reasoning already closed {@code reasonCode} and {@code tags}.
 *
 * <p><b>Provenance</b>, because RUBRIC §6.3 requires a shipped term be traceable rather than
 * invented for this corpus: {@link #REPLY_TO_BUYER} and {@link #IMPROVE_LISTING} are
 * {@code RuleBasedInboxItemAnalyzer}'s own "답변 필요" and "상세페이지 개선 후보";
 * {@link #CHECK_DELIVERY}, {@link #INVESTIGATE_PRODUCT} and {@link #OFFER_REMEDY} restate §3.1's
 * {@code DELIVERY_PROBLEM}, {@code DEFECT_OR_DAMAGE} and {@code EXPLICIT_REQUEST};
 * {@link #MONITOR_REPEAT} is §2's own definition of {@code WATCH}.
 *
 * <p>⚠ It is nonetheless <b>new product language and a product-owner decision</b>
 * ({@code docs/slices/llm-triage-classifier-v1.md} §4.1). It gates nothing: the primary
 * {@code NEEDS_ATTENTION} / {@code NO_ACTION} measurement never reads it, and it is reported
 * descriptively.
 */
public enum TriageSuggestedAction {

    REPLY_TO_BUYER("답변 필요"),
    INVESTIGATE_PRODUCT("실제 상품·출고 확인"),
    CHECK_DELIVERY("배송 프로세스 확인"),
    OFFER_REMEDY("교환·환불·재발송 검토"),
    IMPROVE_LISTING("상세페이지·옵션 정보 보강"),
    MONITOR_REPEAT("반복 여부 모니터링"),
    NONE("지금 할 일 없음");

    private final String korean;

    TriageSuggestedAction(String korean) {
        this.korean = korean;
    }

    /** The operator-facing phrase. Never derived from a review, so it carries no customer content. */
    public String korean() {
        return korean;
    }

    /**
     * Parse a model's answer, refusing anything not on the list.
     *
     * <p>Returns empty rather than throwing, and never falls back to {@link #NONE}: a repaired
     * response is one the harness would be measuring the repair of, and RUBRIC §8.5 makes an
     * unparseable answer a visible failure instead.
     */
    public static Optional<TriageSuggestedAction> parse(String raw) {
        if (raw == null) {
            return Optional.empty();
        }
        for (TriageSuggestedAction action : values()) {
            if (action.name().equals(raw.strip())) {
                return Optional.of(action);
            }
        }
        return Optional.empty();
    }
}
