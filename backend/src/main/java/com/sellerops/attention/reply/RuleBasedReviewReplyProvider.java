package com.sellerops.attention.reply;

import java.util.List;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Component;

/**
 * Deterministic, keyword-and-rating review reply suggester — the rule baseline, NOT AI and
 * not coupled to the item-analysis subsystem (it shares no code or storage with it). Its
 * output derives only from the review's redacted body and its own star rating.
 *
 * <p>Provenance is honest: {@code providerKind=RULE_BASED}. A future AI adapter implementing
 * {@link ReviewReplyProposalProvider} would report its own kind/name/version and would be
 * selected by the same flag this bean is gated on.
 *
 * <p><b>Rating decides first, keywords second — and the tradeoff is real, so it is stated
 * rather than buried.</b> A 5★ review saying "배송 빨라요" contains a delivery keyword; running
 * keywords first would answer praise with an apology for late delivery, which is worse than
 * useless in a public reply. So a rating of {@value #POSITIVE_MIN_RATING} or above takes the
 * positive template regardless of what words appear. The cost: a 4★ review that praises the
 * product but mentions one late delivery also gets the positive template, and the operator has
 * to add the apology themselves. That is the right side to err on — a suggestion that is
 * merely incomplete is edited in seconds, while one that apologises to a happy customer has to
 * be noticed first, and the operator might not notice.
 *
 * <p>An unrated review (null rating — the source carried none) takes the keyword path: with no
 * rating there is no evidence of praise, and the keywords are the only signal there is.
 *
 * <p><b>The templates commit to nothing.</b> They acknowledge, apologise where an apology is
 * owed, and say the seller will look into it. None of them promises a refund, an exchange, a
 * discount, or a delivery date — a rule engine cannot know whether the seller intends any of
 * those, and a promise the seller has not agreed to is the one output here that could do real
 * damage once it is public. None of them blames the customer. The operator supplies every
 * specific.
 */
@Component
@ConditionalOnProperty(name = "sellerops.reply.review.provider", havingValue = "rule_based",
        matchIfMissing = true)
public class RuleBasedReviewReplyProvider implements ReviewReplyProposalProvider {

    static final String KIND = "RULE_BASED";
    static final String NAME = "review-reply-template";
    static final String VERSION = "templates-v1";

    /** At or above this rating a review reads as praise; below it, the keywords decide. */
    static final int POSITIVE_MIN_RATING = 4;

    static final String POSITIVE_CATEGORY = "positive_reply";
    static final String DEFAULT_CATEGORY = "general_reply";

    /** A coarse reply category, its keywords, and the template it suggests. */
    private record Rule(String category, List<String> keywords, String body) {
    }

    private static final String POSITIVE_BODY =
            "안녕하세요, 고객님. 좋은 후기를 남겨주셔서 진심으로 감사합니다. "
                    + "앞으로도 만족하실 수 있도록 노력하겠습니다.";

    private static final String DEFAULT_BODY =
            "안녕하세요, 고객님. 소중한 후기를 남겨주셔서 감사합니다. "
                    + "남겨주신 의견을 잘 살펴보고 반영하겠습니다.";

    /** Detection order: first keyword hit wins, else {@link #DEFAULT_CATEGORY}. */
    private static final List<Rule> RULES = List.of(
            new Rule("quality_reply",
                    List.of("불량", "하자", "깨짐", "파손", "터짐", "고장", "품질"),
                    "안녕하세요, 고객님. 상품에 문제가 있어 불편을 드린 점 진심으로 사과드립니다. "
                            + "말씀해 주신 내용을 확인한 뒤 필요한 조치를 안내드리겠습니다. 알려주셔서 감사합니다."),
            new Rule("delivery_reply",
                    List.of("배송", "택배", "발송", "도착", "출고", "지연"),
                    "안녕하세요, 고객님. 상품을 받아보시기까지 불편을 드린 점 사과드립니다. "
                            + "배송 과정을 다시 살펴보고 개선하겠습니다. 소중한 의견 남겨주셔서 감사합니다."),
            new Rule("packaging_reply",
                    List.of("포장", "박스", "완충"),
                    "안녕하세요, 고객님. 포장 상태로 불편을 드려 죄송합니다. "
                            + "포장 방식을 다시 점검하겠습니다. 알려주셔서 감사합니다."),
            new Rule("product_info_reply",
                    List.of("설명", "사양", "스펙", "사진", "상이", "다릅", "달라요"),
                    "안녕하세요, 고객님. 상품 정보가 기대하신 것과 달라 실망을 드린 점 사과드립니다. "
                            + "상품 설명을 다시 점검해 더 정확히 안내하겠습니다. 의견 감사합니다."),
            new Rule("pricing_reply",
                    List.of("가격", "비싸", "할인", "가성비"),
                    "안녕하세요, 고객님. 가격에 대한 의견 감사합니다. "
                            + "더 나은 가치를 드릴 수 있도록 계속 고민하겠습니다."));

    @Override
    public Suggestion suggest(ReviewReplyContext context) {
        Integer rating = context.rating();
        if (rating != null && rating >= POSITIVE_MIN_RATING) {
            return suggestion(POSITIVE_BODY, POSITIVE_CATEGORY);
        }
        String haystack = context.redactedBody() == null ? "" : context.redactedBody();
        for (Rule rule : RULES) {
            for (String keyword : rule.keywords()) {
                if (haystack.contains(keyword)) {
                    return suggestion(rule.body(), rule.category());
                }
            }
        }
        return suggestion(DEFAULT_BODY, DEFAULT_CATEGORY);
    }

    private static Suggestion suggestion(String body, String category) {
        return new Suggestion(body, category, KIND, NAME, VERSION);
    }
}
