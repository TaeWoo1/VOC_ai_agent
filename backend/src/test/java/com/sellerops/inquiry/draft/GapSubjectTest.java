package com.sellerops.inquiry.draft;

import static org.assertj.core.api.Assertions.assertThat;

import com.sellerops.inquiry.goal.CustomerGoal;
import com.sellerops.inquiry.goal.CustomerGoalSet;
import com.sellerops.inquiry.goal.Referent;
import com.sellerops.inquiry.goal.RequestBasis;
import com.sellerops.inquiry.goal.RequestedOutcome;
import com.sellerops.knowledge.KnowledgeTopic;
import java.util.List;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * <b>What the seller is asked to write down, and what may never be quoted as it.</b>
 *
 * <p>Live, 2026-09-23 (Full MVP E2E stage 2): a Cafe24 post titled 「문의 드립니다」 asked about exchange
 * deadlines in its body, and the knowledge gap named its missing subject <b>「드립니다」</b> — the
 * customer's manners, quoted back to the seller as the topic of their own question.
 */
class GapSubjectTest {

    private static final SpecApplicability.Verdict NO_SPEC_WORD =
            new SpecApplicability.Verdict(SpecApplicability.Applicability.NOT_VARIANT_SENSITIVE, null, null, false);

    private static CustomerGoalSet goals(String... requests) {
        List<CustomerGoal> out = new java.util.ArrayList<>();
        for (int i = 0; i < requests.length; i++) {
            out.add(new CustomerGoal("g" + (i + 1), requests[i], RequestedOutcome.ANSWER, Referent.ORGANIZATION,
                    RequestBasis.STATED, List.of(), requests[i]));
        }
        return new CustomerGoalSet(out, List.of());
    }

    @Test
    @DisplayName("the subject comes from what the customer ASKED, not from a courtesy title")
    void groundedInTheRequest() {
        String subject = GapSubject.of(NO_SPEC_WORD, "문의 드립니다",
                "<meta charset=\"utf-8\">상품을 받은 뒤 교환이나 반품은 언제까지 가능한가요? 개봉하지 않은 상품 기준도 함께 알려주세요.",
                null, KnowledgeTopic.EXCHANGE_RETURN,
                goals("교환이나 반품은 언제까지 가능한가요?", "개봉하지 않은 상품 기준도 함께 알려주세요."));

        assertThat(subject)
                .as("the goals are about 교환 · 반품; 드립니다 is in the post and in neither goal")
                .isEqualTo("교환");
    }

    @Test
    @DisplayName("with nothing having read the message, a predicate still cannot be the subject")
    void aPredicateIsNeverASubject() {
        String subject = GapSubject.of(NO_SPEC_WORD, "문의 드립니다",
                "해외 배송도 가능한가요? 관부가세는 누가 부담하나요?", null, KnowledgeTopic.SHIPPING, null);

        assertThat(subject).isEqualTo("해외");
    }

    @Test
    @DisplayName("the 규격 classifier's own word still wins — it is already the customer's noun")
    void theSpecWordWins() {
        SpecApplicability.Verdict named = new SpecApplicability.Verdict(
                SpecApplicability.Applicability.VARIANT_UNRESOLVED, null, "가닥", true);

        assertThat(GapSubject.of(named, "문의 드립니다", "전선이 몇 가닥까지 들어가나요?", null,
                KnowledgeTopic.EXCHANGE_RETURN, goals("전선이 몇 가닥까지 들어가나요?"))).isEqualTo("가닥");
    }

    @Test
    @DisplayName("a question that names nothing askable falls back to the topic, never to a verb")
    void nothingAskable() {
        assertThat(GapSubject.of(NO_SPEC_WORD, "문의 드립니다", "답변 부탁드립니다.", null,
                KnowledgeTopic.EXCHANGE_RETURN, goals("답변 부탁드립니다.")))
                .isEqualTo(KnowledgeTopic.EXCHANGE_RETURN.labelKo());
    }
}
