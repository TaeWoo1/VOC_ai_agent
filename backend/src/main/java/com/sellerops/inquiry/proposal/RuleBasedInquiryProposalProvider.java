package com.sellerops.inquiry.proposal;

import java.util.List;
import org.springframework.stereotype.Component;

/**
 * Deterministic, keyword-based inquiry proposal drafter — the rule baseline, NOT AI
 * and NOT coupled to the item-analysis subsystem (it shares no code or storage with
 * it). It maps the seller-visible inquiry text to a <b>coarse reply category</b>
 * (e.g. {@code delivery_status_reply}); it never produces or stores a reply body,
 * and its output derives only from the inquiry's own title/details.
 *
 * <p>Provenance is honest: {@code providerKind=RULE_BASED}. A future AI adapter
 * implementing {@link InquiryProposalProvider} would report its own kind/name/version.
 */
@Component
public class RuleBasedInquiryProposalProvider implements InquiryProposalProvider {

    static final String KIND = "RULE_BASED";
    static final String NAME = "rule-proposer";
    static final String VERSION = "rules-v1";

    static final String DEFAULT_CATEGORY = "general_reply";

    /** Coarse reply category in detection order: first keyword hit wins, else the default. */
    private record Rule(String summaryCategory, List<String> keywords) {
    }

    private static final List<Rule> RULES = List.of(
            new Rule("delivery_status_reply", List.of("배송", "택배", "발송", "도착", "출고")),
            new Rule("exchange_return_reply", List.of("교환", "반품", "환불")),
            new Rule("product_info_reply", List.of("사양", "스펙", "호환", "성분", "크기", "mm")),
            new Rule("installation_guidance_reply", List.of("설치", "시공", "부착")),
            new Rule("pricing_reply", List.of("가격", "비싸", "할인", "가성비")),
            new Rule("quality_issue_reply", List.of("불량", "하자", "깨짐", "터짐", "품질")),
            new Rule("stock_availability_reply", List.of("재고", "입고", "품절")));

    @Override
    public Draft propose(SellerInquiryContext context) {
        String haystack = (nullToEmpty(context.title()) + " " + nullToEmpty(context.details())).strip();
        String category = categorize(haystack);
        return new Draft(category, KIND, NAME, VERSION);
    }

    private static String categorize(String text) {
        for (Rule rule : RULES) {
            for (String keyword : rule.keywords()) {
                if (text.contains(keyword)) {
                    return rule.summaryCategory();
                }
            }
        }
        return DEFAULT_CATEGORY;
    }

    private static String nullToEmpty(String value) {
        return value == null ? "" : value;
    }
}
