package com.sellerops.product.dto;

/**
 * How many analysed rows for this product carry one {@code item_analyses.recommended_action} value
 * (FAQ 후보 / 상세페이지 보완 후보 / …). A tally of a stored verdict, not a new one.
 */
public record RecommendedActionCountView(String recommendedAction, long count) {
}
