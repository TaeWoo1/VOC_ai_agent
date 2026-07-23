package com.sellerops.itemanalysis;

import java.util.List;
import java.util.Set;

/**
 * The canonical category vocabulary stored in {@code item_analyses.category}.
 *
 * <p>This is a SCHEMA-level vocabulary, not one analyzer's private detail:
 * {@code V5__item_analysis.sql} already documents exactly this set as the column's comment
 * ({@code 배송/교환/제품정보/설치/가격/품질/색상/사이즈/기타}). It lives here so the analyzer that
 * WRITES a category and the surfaces that FILTER on one read the same list — a category the
 * analyzer can emit but a facet cannot name would be permanently unreachable, and the failure
 * would be silent (an operator would simply never see those rows under any filter).
 * {@link RuleBasedInboxItemAnalyzer} derives its own detection list from these constants, and
 * {@code ItemAnalysisCategoriesTest} pins that every category it can produce is listed here.
 *
 * <p><b>{@link #FALLBACK} (기타) is a real, stored category</b> — the analyzer's verdict when no
 * keyword matched. It is NOT the same as {@link #UNCLASSIFIED}, which is the absence of an
 * {@code item_analyses} row entirely. One says "we looked and it fits nothing"; the other says
 * "we never looked" — an analysis that failed, a row that predates analysis, or a duplicate
 * re-import that only refreshed reply state ({@code FileUploadConnector.triggerAnalysis} runs on
 * newly-inserted ids only, and swallows failures by design). Collapsing the two would report a
 * gap in coverage as a finding about the reviews themselves.
 */
public final class ItemAnalysisCategories {

    public static final String DELIVERY = "배송";
    public static final String EXCHANGE = "교환";
    public static final String PRODUCT_INFO = "제품정보";
    public static final String INSTALLATION = "설치";
    public static final String PRICE = "가격";
    public static final String QUALITY = "품질";
    public static final String COLOR = "색상";
    public static final String SIZE = "사이즈";

    /** The analyzer's verdict when no category keyword matched. A stored value. */
    public static final String FALLBACK = "기타";

    /**
     * Reserved filter sentinel for "no analysis row exists" — deliberately ASCII and lowercase,
     * so it can never collide with a stored category (all of which are Korean).
     *
     * <p>It is a filter value only and is NEVER stored in {@code item_analyses.category}.
     */
    public static final String UNCLASSIFIED = "unclassified";

    /**
     * Every storable category, in the analyzer's own detection order with {@link #FALLBACK} last.
     * The order is load-bearing for the analyzer (first keyword hit wins), so the ordered list is
     * the declaration and {@link #SUPPORTED} is derived from it — never the other way round.
     */
    public static final List<String> ORDERED = List.of(
            DELIVERY, EXCHANGE, PRODUCT_INFO, INSTALLATION, PRICE, QUALITY, COLOR, SIZE, FALLBACK);

    /** Membership view of {@link #ORDERED}. Unordered by construction — use ORDERED to display. */
    public static final Set<String> SUPPORTED = Set.copyOf(ORDERED);

    private ItemAnalysisCategories() {
    }

    /** True for a value that can appear in {@code item_analyses.category}. */
    public static boolean isSupported(String category) {
        return category != null && SUPPORTED.contains(category);
    }

    /** True for the reserved "no analysis row" filter sentinel. */
    public static boolean isUnclassified(String category) {
        return UNCLASSIFIED.equals(category);
    }
}
