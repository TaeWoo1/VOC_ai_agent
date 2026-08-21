package com.sellerops.agent.llm.inquirysignal;

import com.sellerops.itemanalysis.ItemAnalysisCategories;
import com.sellerops.reviewissue.InquiryAskKind;
import java.util.List;

/**
 * The prompt behind the inquiry-signature capability — classify one customer question into two closed
 * vocabularies.
 *
 * <p><b>This is the heaviest payload floor of the four LLM capabilities, and it is stated plainly:</b>
 * what leaves is ONE customer's own inquiry text. That is the same class of exposure the reply-draft
 * capability already makes ({@code AgentDraftPrompt}), one inquiry at a time, and it gets its own flag
 * for the reason that one does — a deployment must be able to run either without the other.
 *
 * <p><b>What comes BACK is two labels and nothing else.</b> The model is instructed to emit only a
 * topic from {@link ItemAnalysisCategories} and an ask kind from {@link InquiryAskKind}; anything else
 * is refused by the parser and stored as a miss. So no model-authored prose ever enters storage, which
 * is what lets {@code customer_memory_entries} keep its "no customer text, ever" property while gaining
 * a semantic signature.
 *
 * <p><b>Both vocabularies are interpolated from the code that owns them</b>, never restated here — the
 * rule {@code AgentDraftPrompt} follows for its categories. A prompt that lists its options by hand
 * drifts from the enum that validates them, and the first symptom is a whole corpus classified as
 * "off-vocabulary".
 */
public final class InquirySignalPrompt {

    /** Bump on every wording change. Stamped into the provenance a cached row records. */
    public static final String PROMPT_VERSION = "inquiry-signal-prompt/v1";

    private InquirySignalPrompt() {
    }

    public static String system() {
        List<String> topics = ItemAnalysisCategories.ORDERED.stream()
                .filter(c -> !ItemAnalysisCategories.FALLBACK.equals(c))
                .toList();
        return """
               당신은 한국 이커머스 판매자의 고객 문의를 분류합니다. 문의 한 건을 읽고 두 가지만 고릅니다.

               1) topic — 무엇에 대한 문의인가. 다음 중 하나만: %s
               2) ask — 고객이 무엇을 하려는가. 다음 중 하나만: %s

               규칙:
               - 목록 밖의 값을 만들어내지 마세요. 목록 밖 값은 거부됩니다.
               - 애매하면 억지로 고르지 말고 topic 과 ask 를 빈 문자열로 두세요. 틀린 분류는 분류 없음보다 나쁩니다.
               - 고객의 문장을 인용하거나 요약하지 마세요. 두 개의 라벨 외에는 아무것도 출력하지 마세요.
               - 개인정보(이름·연락처·주소·주문번호)를 출력에 절대 담지 마세요.

               반드시 아래 형태의 JSON 객체 하나만 출력하세요. 다른 텍스트, 설명, 코드펜스는 금지입니다.
               {"topic":"<위 목록 중 하나 또는 빈 문자열>","ask":"<위 목록 중 하나 또는 빈 문자열>"}
               """
                .formatted(String.join(", ", topics), String.join(", ", InquiryAskKind.labels()));
    }

    /**
     * The user turn — <b>the payload floor</b>.
     *
     * <p>Exactly one thing leaves: the inquiry text the caller passed. No org id, no product, no
     * customer identity, no id of any kind, and no other inquiry.
     * {@code InquirySignalPayloadFloorTest} asserts this on the serialized request bytes, because a
     * check on what this method meant to send would keep passing after someone added the product name
     * "for context".
     */
    public static String user(String inquiryText) {
        return "문의:\n" + (inquiryText == null ? "" : inquiryText);
    }
}
