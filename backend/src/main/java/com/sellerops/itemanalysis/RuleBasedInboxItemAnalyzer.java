package com.sellerops.itemanalysis;

import java.util.List;
import org.springframework.stereotype.Component;

/**
 * Deterministic, keyword-based analyzer for inbox items. This is a rule-based
 * baseline — NOT AI, and not the protected Python review-ops detector. It exists
 * so the storage/API/flow foundation is verifiable end-to-end without any external
 * call. Every output is derived from the item's own fields; the {@code summary} is
 * a templated phrase that never echoes the raw body (PII-safe).
 *
 * <p>Provenance is honest: {@code analyzerKind=RULE_BASED}. A future AI adapter
 * implementing {@link InboxItemAnalyzer} would set its own kind/model/prompt.
 */
@Component
public class RuleBasedInboxItemAnalyzer implements InboxItemAnalyzer {

    static final String KIND = "RULE_BASED";
    static final String NAME = "rule-based";
    static final String VERSION = "rules-v1";

    static final String INQUIRY = "INQUIRY";
    static final String REVIEW = "REVIEW";

    static final String POSITIVE = "POSITIVE";
    static final String NEUTRAL = "NEUTRAL";
    static final String NEGATIVE = "NEGATIVE";

    static final String LOW = "LOW";
    static final String NORMAL = "NORMAL";
    static final String HIGH = "HIGH";

    // Categories in detection order: first keyword hit wins, else 기타.
    //
    // The NAMES come from ItemAnalysisCategories, not from literals here: a category this
    // analyzer can emit but a filter cannot name would be silently unreachable on every
    // surface that facets by category. The keyword lists stay local — they are this
    // analyzer's detection strategy, which a future AI adapter would not share.
    private record Category(String name, List<String> keywords) {
    }

    private static final List<Category> CATEGORIES = List.of(
            new Category(ItemAnalysisCategories.DELIVERY, List.of("배송", "택배", "발송", "도착", "출고")),
            new Category(ItemAnalysisCategories.EXCHANGE, List.of("교환", "반품", "환불")),
            new Category(ItemAnalysisCategories.PRODUCT_INFO, List.of("사양", "스펙", "호환", "성분", "크기", "mm")),
            new Category(ItemAnalysisCategories.INSTALLATION, List.of("설치", "시공", "부착")),
            new Category(ItemAnalysisCategories.PRICE, List.of("가격", "비싸", "할인", "가성비")),
            new Category(ItemAnalysisCategories.QUALITY, List.of("불량", "하자", "깨짐", "터짐", "품질")),
            new Category(ItemAnalysisCategories.COLOR, List.of("색상", "컬러", "색깔")),
            new Category(ItemAnalysisCategories.SIZE, List.of("사이즈", "길이", "폭")));

    private static final List<String> COMPLAINT_KEYWORDS =
            List.of("불량", "하자", "환불", "실망", "별로");

    @Override
    public Result analyze(SourceItem item) {
        String body = item.body() == null ? "" : item.body();
        boolean isReview = REVIEW.equals(item.sourceType());

        String category = category(body);
        String sentiment = sentiment(item, body, isReview);
        String urgency = urgency(item, category, sentiment, isReview);
        String action = recommendedAction(item, category, sentiment, isReview);
        String summary = summary(category, sentiment, isReview);

        return new Result(summary, category, sentiment, urgency, action, KIND, NAME, VERSION);
    }

    private String category(String body) {
        for (Category c : CATEGORIES) {
            for (String kw : c.keywords()) {
                if (body.contains(kw)) {
                    return c.name();
                }
            }
        }
        return ItemAnalysisCategories.FALLBACK;
    }

    private String sentiment(SourceItem item, String body, boolean isReview) {
        if (isReview) {
            if (item.negative() || (item.rating() != null && item.rating() <= 2)) {
                return NEGATIVE;
            }
            if (item.rating() != null && item.rating() >= 4) {
                return POSITIVE;
            }
            return NEUTRAL;
        }
        // Inquiry: questions are neutral unless they carry a complaint keyword.
        return containsAny(body, COMPLAINT_KEYWORDS) ? NEGATIVE : NEUTRAL;
    }

    private String urgency(SourceItem item, String category, String sentiment, boolean isReview) {
        if (isReview) {
            return NEGATIVE.equals(sentiment) ? HIGH : LOW;
        }
        boolean unanswered = "UNANSWERED".equals(item.status());
        if (!unanswered) {
            return LOW;
        }
        return (ItemAnalysisCategories.DELIVERY.equals(category)
                || ItemAnalysisCategories.EXCHANGE.equals(category)) ? HIGH : NORMAL;
    }

    private String recommendedAction(SourceItem item, String category, String sentiment,
                                     boolean isReview) {
        if (isReview) {
            if (NEGATIVE.equals(sentiment) && (ItemAnalysisCategories.QUALITY.equals(category)
                    || ItemAnalysisCategories.PRODUCT_INFO.equals(category))) {
                return "상세페이지 개선 후보";
            }
            return "확인 필요";
        }
        if ("UNANSWERED".equals(item.status())) {
            return "답변 필요";
        }
        // Answered product-info questions are repeat-FAQ candidates.
        return ItemAnalysisCategories.PRODUCT_INFO.equals(category) ? "FAQ 후보" : "확인 필요";
    }

    /**
     * PII-safe templated summary built only from rule outputs, e.g.
     * "배송 관련 부정 리뷰", "제품정보 관련 문의". Never contains the body.
     */
    private String summary(String category, String sentiment, boolean isReview) {
        String kind = isReview ? "리뷰" : "문의";
        String polarity = "";
        if (isReview) {
            if (NEGATIVE.equals(sentiment)) {
                polarity = "부정 ";
            } else if (POSITIVE.equals(sentiment)) {
                polarity = "긍정 ";
            }
        }
        return category + " 관련 " + polarity + kind;
    }

    private static boolean containsAny(String body, List<String> keywords) {
        for (String kw : keywords) {
            if (body.contains(kw)) {
                return true;
            }
        }
        return false;
    }
}
