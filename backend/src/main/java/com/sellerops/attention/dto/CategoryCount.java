package com.sellerops.attention.dto;

/**
 * How many rows in the drill-down's window carry one stored analysis category.
 *
 * <p>Derived metadata only: {@code category} is one of the nine fixed labels in
 * {@code ItemAnalysisCategories} and never echoes customer text (the analyzer builds it from
 * keyword hits, not excerpts — see {@code RuleBasedInboxItemAnalyzer}'s PII note).
 *
 * <p>Counts are always over the window UNFILTERED by category, so they stay stable while an
 * operator switches facets. The bucket for rows with no analysis row at all is NOT one of these —
 * it is carried separately on {@link OperatorVocItemPage}, because "we looked and it fits nothing"
 * (기타) and "we never looked" are different statements.
 */
public record CategoryCount(String category, long count) {
}
