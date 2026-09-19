package com.sellerops.inquiry.draft;

import static org.assertj.core.api.Assertions.assertThat;

import com.sellerops.inquiry.draft.InquiryClaimGuard.Kind;
import com.sellerops.inquiry.draft.InquiryClaimGuard.Violation;
import java.util.List;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;

/**
 * Inquiry Claim Guard v1 — a reply may promise, request or state a figure only when the evidence does.
 *
 * <p>The first two cases are the real ones. On 2026-09-19 the Past Answer Prefill proofs drafted the same question twice
 * over the same seller knowledge: {@code apr-7c3e91d4} wrote a clean reply, and {@code apr-3d8b27e5} ended with a
 * request for a photo and a follow-up promise nobody made. The drafts are verbatim model output; the evidence is the
 * product knowledge the seller saved in those proofs. The other passage the drafter saw — the seller's past channel
 * answer — is seller data and is not copied here; it mentions no photo and no follow-up, so it changes neither verdict.
 */
public class InquiryClaimGuardTest {

    public static final String QUESTION = "기존 원터치 디스펜서 제품의 투명한 부분과 아래쪽 보라색 부분은 어떻게 분리하나요?";
    public static final String KNOWLEDGE = "투명한 부분과 아래쪽 보라색 부분은 파이프 부분에서 뚜껑 부분을 분리하듯 똑같이 분리하시면 됩니다.\n"
            + "크기가 완전 딱 맞도록 제작이 되어 끼우는데 어려움이 있을 수 있으니 이 점 주의해주세요.";

    /** apr-3d8b27e5, draft v1 — GROUNDED, and two invented clauses at the end. */
    public static final String INVENTED = "안녕하세요 고객님. 문의 주신 기존 원터치 디스펜서의 투명한 부분과 아래쪽 보라색 부분은 파이프 "
            + "부분에서 뚜껑을 분리하듯 동일하게 분리하시면 됩니다. 크기가 딱 맞도록 제작되어 끼우거나 분리 시 다소 어려울 수 "
            + "있으니 이 점 유의해 주세요. 추가로 필요하시면 사용 중 사진을 보내주시면 확인 후 안내드리겠습니다.";

    /** apr-7c3e91d4, draft v1 — the same question and knowledge, and nothing invented. */
    public static final String CLEAN = "안녕하세요. 문의주신 기존 원터치 디스펜서의 투명한 부분과 아래쪽 보라색 부분은 파이프 부분에서 "
            + "뚜껑을 분리하듯 동일한 방식으로 분리하시면 됩니다. 제품이 딱 맞게 제작되어 끼우거나 분리할 때 다소 뻑뻑할 수 "
            + "있으니 힘 조절에 유의해 천천히 진행해 주세요. 추가로 궁금한 점이 있으시면 언제든지 말씀해 주세요. 감사합니다.";

    private static List<Violation> check(String body, List<String> evidence, List<String> voice) {
        return InquiryClaimGuard.unsupportedClaims(body, evidence, voice, QUESTION);
    }

    @Nested
    @DisplayName("the reproduced case")
    class Reproduced {

        @Test
        @DisplayName("a photo request and a follow-up promise the knowledge never made are refused")
        void theInventedClausesAreFound() {
            assertThat(check(INVENTED, List.of(KNOWLEDGE), List.of()))
                    .extracting(Violation::kind)
                    .containsExactlyInAnyOrder(Kind.SELLER_PROMISE, Kind.CUSTOMER_ACTION);
        }

        @Test
        @DisplayName("the clean draft of the same question, over the same knowledge, passes")
        void theCleanDraftPasses() {
            assertThat(check(CLEAN, List.of(KNOWLEDGE), List.of())).isEmpty();
        }
    }

    @Nested
    @DisplayName("what may authorize a claim")
    class Authorization {

        @Test
        @DisplayName("evidence that itself asks for a photo and promises a follow-up authorizes both")
        void evidenceAuthorizes() {
            String policy = "파손 문의는 사진을 보내주시면 확인 후 안내드립니다.";
            assertThat(check(INVENTED, List.of(KNOWLEDGE, policy), List.of())).isEmpty();
        }

        @Test
        @DisplayName("a seller who writes that they collect a photo has authorized asking for one — that material only")
        void receivingAuthorizesTheSameMaterial() {
            List<String> guidance = List.of("교환 요청은 먼저 사진을 받아 확인한 뒤 안내합니다.");
            assertThat(check("사진을 먼저 보내 주시면 확인 후 안내드리겠습니다.", guidance, List.of())).isEmpty();
            assertThat(check("주문번호를 보내 주세요.", guidance, List.of()))
                    .extracting(Violation::kind).containsExactly(Kind.CUSTOMER_ACTION);
        }

        @Test
        @DisplayName("the seller's own approved deferral authorizes a follow-up, and nothing else")
        void theSellersFallbackAuthorizesItsOwnPromise() {
            String body = "확인 후 안내드리겠습니다. 사진을 보내주시면 됩니다.";
            assertThat(check(body, List.of(), List.of("담당자가 확인 후 안내드리겠습니다.")))
                    .extracting(Violation::kind).containsExactly(Kind.CUSTOMER_ACTION);
        }

        @Test
        @DisplayName("a remedy is authorized by the evidence alone — the review list, reused")
        void remediesNeedEvidence() {
            assertThat(check("교환해 드리겠습니다.", List.of(KNOWLEDGE), List.of("교환 가능합니다")))
                    .extracting(Violation::kind).containsExactly(Kind.REMEDY);
            assertThat(check("수령 후 7일 이내 교환 가능합니다.", List.of("상품 수령 후 7일 이내에 교환 신청을 하실 수 있습니다."),
                    List.of())).isEmpty();
        }
    }

    @Nested
    @DisplayName("figures")
    class Figures {

        @Test
        @DisplayName("a delivery window the evidence does not state is refused")
        void anInventedWindow() {
            assertThat(check("주문 후 1~2일 내 출고됩니다.", List.of(KNOWLEDGE), List.of()))
                    .extracting(Violation::matched).containsExactly("1", "2");
        }

        @Test
        @DisplayName("a number the customer wrote may be repeated back to them")
        void theCustomersOwnNumber() {
            assertThat(InquiryClaimGuard.unsupportedClaims("10mm 전선 두 줄이라면 3호부터 들어갑니다.",
                    List.of("지름 10mm 전선 두 가닥을 나란히 넣으려면 3호부터 가능합니다."), List.of(),
                    "10mm 전선 두 줄 넣으려면 몇 호예요?")).isEmpty();
        }

        @Test
        @DisplayName("a list marker is not a figure")
        void aListMarker() {
            assertThat(check("1. 파이프 부분을 잡아 주세요. 2. 뚜껑처럼 돌려 빼 주세요.", List.of(KNOWLEDGE), List.of()))
                    .isEmpty();
        }
    }

    @Test
    @DisplayName("a clarifying question names no material to send and is not a request")
    void aClarifyingQuestionPasses() {
        assertThat(check("어떤 규격을 쓰실지 알려주시면 그에 맞춰 말씀드리겠습니다.", List.of(KNOWLEDGE), List.of())).isEmpty();
    }
}
