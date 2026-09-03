package com.sellerops.attention.reply;

import java.util.List;
import java.util.Optional;

/**
 * The review reply template taxonomy — <b>exactly the categories {@link RuleBasedReviewReplyProvider}
 * already had</b>, lifted out of that class so an organization can own the wording.
 *
 * <p><b>Nothing new is named here.</b> The seven members, their category strings, their keyword lists,
 * their detection order and their default bodies are the ones the provider shipped with, moved
 * character for character. A seventh category, a different keyword, or a reworded default would be a
 * product change; this file is a relocation, and {@code ReviewReplyTemplateDefaultsTest} pins the
 * bodies byte for byte so it stays one.
 *
 * <p><b>Order is behaviour, not presentation.</b> {@link #POSITIVE} is chosen by rating before any
 * keyword is read; the five keyword members are then tried in declaration order and the first hit
 * wins; {@link #GENERAL} is the fallback. The settings screen lists them in this same order for the
 * same reason — a seller reading the list top to bottom is reading how the choice is actually made.
 *
 * <p><b>That order was reversed for one commit and measured back</b> (2026-09-03). Putting keywords
 * first was meant to stop a ★4 complaint being answered as praise; run against this repository's real
 * NAVER corpus it moved <b>1,153</b> reviews, <b>1,098 of them ★5</b> — overwhelmingly 「배송 빨라요」
 * praise redirected into an apology, against 55 of the complaints it was for. The reason is structural
 * and is the thing to remember: <b>these keywords detect a TOPIC, not a polarity.</b> Until something
 * can tell 빨라요 from 늦어요, a topic word must not outrank a star, and the honest response to a ★4
 * complaint the words cannot see is a neutral default plus the seller's own edit — not a confident
 * apology to everyone who mentioned 배송.
 *
 * <p><b>This is a communication layer.</b> A template says how the seller sounds, never what is true:
 * no default promises a refund, an exchange, a discount, a delivery date, or a cause, and nothing in
 * this package retrieves a product fact or a policy to put into one. Grounded review drafting, when it
 * exists, composes WITH this — it does not arrive through it.
 */
public enum ReviewReplyTemplateKey {

    /**
     * Chosen by rating alone ({@code >= POSITIVE_MIN_RATING}), before any keyword is read.
     *
     * <p><b>It is not "the praise template", and the wording says so.</b> A keyword table detects a
     * TOPIC, never a polarity — 「배송 빨라요」 and 「배송 늦어요」 are the same word to it — so this
     * member is what a high-rated review gets when nothing else can be established about it. Its
     * default therefore thanks the customer and commits to nothing; asserting that they were delighted
     * is a claim this selector cannot support, and the seller's own wording is the place to be warmer.
     */
    POSITIVE("positive_reply", List.of(),
            "안녕하세요, 고객님. 저희 제품을 이용해 주셔서 감사합니다. "
                    + "남겨주신 후기 잘 읽었습니다."),

    QUALITY("quality_reply", List.of("불량", "하자", "깨짐", "파손", "터짐", "고장", "품질"),
            "안녕하세요, 고객님. 상품에 문제가 있어 불편을 드린 점 진심으로 사과드립니다. "
                    + "말씀해 주신 내용을 확인한 뒤 필요한 조치를 안내드리겠습니다. 알려주셔서 감사합니다."),

    DELIVERY("delivery_reply", List.of("배송", "택배", "발송", "도착", "출고", "지연"),
            "안녕하세요, 고객님. 상품을 받아보시기까지 불편을 드린 점 사과드립니다. "
                    + "배송 과정을 다시 살펴보고 개선하겠습니다. 소중한 의견 남겨주셔서 감사합니다."),

    PACKAGING("packaging_reply", List.of("포장", "박스", "완충"),
            "안녕하세요, 고객님. 포장 상태로 불편을 드려 죄송합니다. "
                    + "포장 방식을 다시 점검하겠습니다. 알려주셔서 감사합니다."),

    PRODUCT_INFO("product_info_reply", List.of("설명", "사양", "스펙", "사진", "상이", "다릅", "달라요"),
            "안녕하세요, 고객님. 상품 정보가 기대하신 것과 달라 실망을 드린 점 사과드립니다. "
                    + "상품 설명을 다시 점검해 더 정확히 안내하겠습니다. 의견 감사합니다."),

    PRICING("pricing_reply", List.of("가격", "비싸", "할인", "가성비"),
            "안녕하세요, 고객님. 가격에 대한 의견 감사합니다. "
                    + "더 나은 가치를 드릴 수 있도록 계속 고민하겠습니다."),

    /** No keyword matched and the rating is below the threshold (or absent). */
    GENERAL("general_reply", List.of(),
            "안녕하세요, 고객님. 소중한 후기를 남겨주셔서 감사합니다. "
                    + "남겨주신 의견을 잘 살펴보고 반영하겠습니다.");

    /** The keyword members, in the order the provider tries them. */
    public static final List<ReviewReplyTemplateKey> KEYWORD_ORDER =
            List.of(QUALITY, DELIVERY, PACKAGING, PRODUCT_INFO, PRICING);

    private final String category;
    private final List<String> keywords;
    private final String defaultBody;

    ReviewReplyTemplateKey(String category, List<String> keywords, String defaultBody) {
        this.category = category;
        this.keywords = keywords;
        this.defaultBody = defaultBody;
    }

    /**
     * The category string the suggestion has always reported. It is also the storage key and the
     * route's path variable — one name for one thing, rather than a second vocabulary to map.
     */
    public String category() {
        return category;
    }

    /** The words that select this template. Empty for the two chosen by rating / by fallback. */
    public List<String> keywords() {
        return keywords;
    }

    /** The wording reviewnary ships. An org with no override answers with exactly this. */
    public String defaultBody() {
        return defaultBody;
    }

    /** Parse a stored/route category. Unknown values are empty — never a guessed member. */
    public static Optional<ReviewReplyTemplateKey> of(String category) {
        if (category == null) {
            return Optional.empty();
        }
        String wanted = category.strip();
        for (ReviewReplyTemplateKey key : values()) {
            if (key.category.equals(wanted)) {
                return Optional.of(key);
            }
        }
        return Optional.empty();
    }
}
