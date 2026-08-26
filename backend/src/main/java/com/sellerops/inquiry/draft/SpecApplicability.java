package com.sellerops.inquiry.draft;

import java.util.List;
import java.util.Locale;

/**
 * Whether a retrieved specification may be stated as a fact about THIS customer's item.
 *
 * <p><b>Why this exists — the 2026-08-26 NAVER live case.</b> A customer asked
 * 「전선이 몇 가닥까지 들어가나요?」 and the draft answered 「일반 가전 전선 기준으로 3~4가닥이 여유 있게
 * 들어갑니다」. Nothing was invented: that sentence is a verbatim Q&amp;A pair from the seller's own
 * registered FAQ, and the model even preserved its qualifier. The retrieval was right, the citation
 * was right, and the answer was still wrong — because the listing sells several 규격 and the FAQ's
 * figure is written at product level, for none of them in particular.
 *
 * <p><b>So the defect is not grounding. It is applicability.</b> "근거가 검색됨" and "이 질문에 그대로
 * 적용할 수 있는 근거" are different claims, and before this class the drafter had no way to hold them
 * apart: a passage that came back was a passage that could be asserted. That is safe for a question
 * whose answer cannot vary by option (「벽지에 붙나요?」) and unsafe for one whose answer is exactly the
 * thing the options change.
 *
 * <p><b>What it does NOT do.</b> It does not decide the answer, does not rank evidence, does not
 * suppress a passage, and does not know which variant is correct. It reports one of three states so
 * the drafter can be told, in one line, whether a figure it finds may be closed with or has to be
 * opened back to the customer. Deciding more than that would need per-variant knowledge that no
 * channel gives us today — see {@link Applicability#VARIANT_UNRESOLVED}.
 *
 * <p><b>Deterministic and offline.</b> No model call, no clock. Keyword matching over Korean customer
 * text is blunt, and it is used here only to decide whether to add a caution — never to decide what
 * the answer is, and never to drop evidence. A false positive costs one hedged sentence; a false
 * negative leaves today's behaviour. That asymmetry is why the word list leans inclusive.
 */
public enum SpecApplicability {
    ;

    /**
     * The verdict for one question.
     */
    public enum Applicability {

        /**
         * The answer cannot move with the option chosen — 부착 방법, 반품 규정, 보관법. A passage that
         * answers it answers it for the whole listing, and the drafter is told nothing extra.
         */
        NOT_VARIANT_SENSITIVE,

        /**
         * The answer CAN differ by 규격·옵션, and this inquiry does not say which one.
         *
         * <p><b>This is the common case, and today it is the only one NAVER can produce.</b> An
         * inquiry row carries no option field on any channel, {@code product_variants} is populated
         * from Coupang's listing feed alone, and the seller's knowledge binds to a product, never to
         * a variant. So "확정할 수 없다" here is a statement about what we hold, not a guess about the
         * customer — and the honest reply asks which 규격 they are using.
         */
        VARIANT_UNRESOLVED,

        /**
         * The answer can differ by 규격·옵션 and the customer named one we know this product sells.
         *
         * <p>The drafter may then use evidence about it. It is still not licensed to invent one: the
         * caution the {@link #VARIANT_UNRESOLVED} line carries is replaced, not lifted.
         */
        VARIANT_NAMED;

        /**
         * The one line the drafter is shown — content-free by construction.
         *
         * <p>It states which of the three states holds and nothing else. In particular it never
         * echoes the option name back: the payload floor is the reason the model is told facts about
         * the question rather than more of the seller's catalogue.
         */
        public String messageKo() {
            return switch (this) {
                case NOT_VARIANT_SENSITIVE -> "(해당 없음)";
                case VARIANT_UNRESOLVED ->
                        "이 질문은 규격·옵션에 따라 답이 달라질 수 있으며, 어떤 규격인지 확정되지 않았습니다.";
                case VARIANT_NAMED ->
                        "이 질문은 규격·옵션에 따라 답이 달라질 수 있으며, 고객이 문의에서 규격을 밝혔습니다.";
            };
        }

        /**
         * The same line, escalated when a figure in the evidence was read out of a picture.
         *
         * <p><b>This is where {@link com.sellerops.product.library.KnowledgeAuthorship
         * #carriesExactFiguresUnaided()} is enforced.</b> That method states the one operational
         * consequence of the image lane and had no caller — an enum that declares a rule nobody
         * applies is a comment. Its own docblock names the treatment: an extracted figure "needs the
         * same treatment a variant-unresolved spec already gets", so it gets exactly that, through
         * the seam that already exists rather than a second one.
         *
         * <p>It does not suppress the passage. The seller's page is still their page, and hiding
         * their own content would be a different kind of lie. What changes is whether a number in it
         * may close a sentence or has to be confirmed.
         *
         * @param figuresUnaided false when at least one cited passage came from an image
         */
        public String messageKo(boolean figuresUnaided) {
            if (figuresUnaided) {
                return messageKo();
            }
            return "근거 중 일부는 상품 상세페이지 이미지에서 읽은 내용이라 수치가 확정된 사실이 "
                    + "아닙니다. 수치를 이 고객의 상품에 대한 확정된 사실로 단정하지 말고, 필요하면 "
                    + "규격을 되물으세요."
                    + (this == VARIANT_UNRESOLVED ? " 어떤 규격인지도 확정되지 않았습니다." : "");
        }
    }

    /**
     * Questions whose answer is a property of the ITEM, and so can differ between options.
     *
     * <p>Numbers, dimensions, capacities and fit. Deliberately not the same list as
     * {@link InquiryKnowledgeNeed}'s: that one asks "does this need product knowledge at all", which
     * 사용법 and 세척 also do while being the same for every option.
     */
    private static final String[] VARIANT_SENSITIVE_WORDS = {
        "몇 가닥", "가닥", "몇 개", "몇개", "몇 mm", "몇mm", "몇 cm", "몇cm", "몇 미터", "몇m",
        "사이즈", "규격", "치수", "크기", "길이", "폭", "너비", "두께", "지름", "직경", "용량",
        "색상", "컬러", "무게", "중량", "호환", "맞나요", "들어가나요", "들어갑니까", "가능한가요",
        "옵션", "모델", "종류",
    };

    /** Option names shorter than this match too much of any sentence to be evidence of anything. */
    private static final int MIN_OPTION_TOKEN = 2;

    /**
     * Classify one question against the options this product is known to sell.
     *
     * @param title       the inquiry title, as a person wrote it
     * @param body        the inquiry body, as a person wrote it
     * @param optionNames every {@code option_name} recorded for the bound product; empty when the
     *                    product has no variant rows, which is the normal state outside Coupang
     */
    public static Applicability of(String title, String body, List<String> optionNames) {
        String text = normalize((title == null ? "" : title) + " " + (body == null ? "" : body));
        if (!containsAny(text, VARIANT_SENSITIVE_WORDS)) {
            return Applicability.NOT_VARIANT_SENSITIVE;
        }
        return namesAKnownOption(text, optionNames)
                ? Applicability.VARIANT_NAMED : Applicability.VARIANT_UNRESOLVED;
    }

    /**
     * Did the customer name one of this product's options?
     *
     * <p>An option name arrives as a combination string ("길이: 1m / 색상: 화이트"), so the whole value
     * is almost never quoted. Every token of at least {@link #MIN_OPTION_TOKEN} characters has to
     * appear for the option to count as named — one shared word ("화이트") is a coincidence, the whole
     * set is a choice.
     */
    private static boolean namesAKnownOption(String normalizedText, List<String> optionNames) {
        if (optionNames == null) {
            return false;
        }
        for (String option : optionNames) {
            if (option == null || option.isBlank()) {
                continue;
            }
            String[] tokens = normalize(option).split("[\\s/,:·|()\\[\\]]+");
            boolean any = false;
            boolean all = true;
            for (String token : tokens) {
                if (token.length() < MIN_OPTION_TOKEN) {
                    continue;
                }
                any = true;
                if (!normalizedText.contains(token)) {
                    all = false;
                    break;
                }
            }
            if (any && all) {
                return true;
            }
        }
        return false;
    }

    private static String normalize(String text) {
        return text.toLowerCase(Locale.KOREAN);
    }

    private static boolean containsAny(String text, String[] words) {
        for (String word : words) {
            if (text.contains(word)) {
                return true;
            }
        }
        return false;
    }
}
