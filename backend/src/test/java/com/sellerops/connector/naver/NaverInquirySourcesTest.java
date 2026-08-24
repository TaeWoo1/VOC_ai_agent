package com.sellerops.connector.naver;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.sellerops.ingest.canonical.CanonicalInquiry;
import com.sellerops.inquiry.InquirySourceSubtype;
import java.time.Instant;
import java.util.List;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;

/**
 * NAVER publishes TWO inquiry resources, and this pins what each one actually says.
 *
 * <p>Every assertion here is traceable to the vendored official contract
 * ({@code docs/vendor/naver-commerce-api/get-v1-contents-qnas.md} ·
 * {@code get-v1-pay-user-inquiries.md}) rather than to a sibling endpoint's shape. Where the contract
 * is silent — a secrecy flag, a raw status token, an answer timestamp on 상품 문의 — the test asserts
 * that the connector says nothing, because inventing the field is the failure mode this whole package
 * exists to avoid.
 */
class NaverInquirySourcesTest {

    private static final String BASE_URL = "https://fake.naver.test";
    private static final String TOKEN = "tok-1";

    private final FakeNaverHttpClient http = new FakeNaverHttpClient();
    private final NaverProductQnaClient qna = new NaverProductQnaClient(http, BASE_URL);
    private final NaverCustomerInquiriesClient customer = new NaverCustomerInquiriesClient(http, BASE_URL);

    private static NaverInquiryCursor.Lane qnaLane() {
        return NaverInquiryCursor.Lane.starting("2026-08-10T00:00:00.000+09:00",
                "2026-08-24T00:00:00.000+09:00");
    }

    private static NaverInquiryCursor.Lane customerLane() {
        return NaverInquiryCursor.Lane.starting("2026-08-10", "2026-08-24");
    }

    @Nested
    @DisplayName("상품 문의 — GET /v1/contents/qnas")
    class ProductQna {

        @Test
        @DisplayName("the request is the documented one: required date range, 1-based page, size 100")
        void theRequestMatchesTheOfficialParameterContract() {
            http.enqueue(FakeNaverHttpClient.ok("{\"contents\":[],\"last\":true}"));

            qna.fetchPage(TOKEN, qnaLane());

            String uri = http.sent.get(0).uri().toString();
            assertThat(http.sent.get(0).method()).isEqualTo("GET");
            assertThat(uri).contains("/external/v1/contents/qnas");
            assertThat(uri).contains("fromDate=2026-08-10T00%3A00%3A00.000%2B09%3A00");
            assertThat(uri).contains("toDate=2026-08-24T00%3A00%3A00.000%2B09%3A00");
            assertThat(uri).contains("page=1");
            // 페이지당 최대 100건 — the resource's own ceiling, not a number chosen here.
            assertThat(uri).contains("size=100");
        }

        @Test
        @DisplayName("an answered question keeps the answer the seller already published")
        void ananAnsweredQuestionCarriesItsAnswer() {
            http.enqueue(FakeNaverHttpClient.ok("{\"last\":true,\"contents\":[{"
                    + "\"questionId\":9001,\"createDate\":\"2026-08-20T10:00:00.000+09:00\","
                    + "\"question\":\"몰딩 길이가 어떻게 되나요?\",\"answer\":\"1.5m입니다.\","
                    + "\"answered\":true,\"productId\":6473457700,"
                    + "\"productName\":\"선바로 일체형 전선몰딩\",\"maskedWriterId\":\"ab**\"}]}"));

            CanonicalInquiry row = qna.fetchPage(TOKEN, qnaLane()).rows().get(0);

            assertThat(row.status()).isEqualTo("ANSWERED");
            assertThat(row.answerBody()).isEqualTo("1.5m입니다.");
            assertThat(row.body()).isEqualTo("몰딩 길이가 어떻게 되나요?");
            assertThat(row.receivedAt()).isEqualTo(Instant.parse("2026-08-20T01:00:00Z"));
            assertThat(row.sourceSubtype()).isEqualTo(InquirySourceSubtype.NAVER_PRODUCT_QNA);
        }

        @Test
        @DisplayName("an unanswered question stores no answer, even when the field carries text")
        void anUnansweredQuestionStoresNoAnswer() {
            http.enqueue(FakeNaverHttpClient.ok("{\"last\":true,\"contents\":[{"
                    + "\"questionId\":9002,\"createDate\":\"2026-08-20T10:00:00.000+09:00\","
                    + "\"question\":\"재고 있나요?\",\"answer\":\"\",\"answered\":false}]}"));

            CanonicalInquiry row = qna.fetchPage(TOKEN, qnaLane()).rows().get(0);

            assertThat(row.status()).isEqualTo("UNANSWERED");
            assertThat(row.answerBody()).isNull();
            assertThat(row.answeredAt()).isNull();
        }

        @Test
        @DisplayName("the product is a REF, never a name — the name field is not mapped at all")
        void theProductArrivesAsAnIdentifierAndTheNameIsDropped() {
            http.enqueue(FakeNaverHttpClient.ok("{\"last\":true,\"contents\":[{"
                    + "\"questionId\":9003,\"createDate\":\"2026-08-20T10:00:00.000+09:00\","
                    + "\"question\":\"문의\",\"answered\":false,\"productId\":6473457700,"
                    + "\"productName\":\"선바로 일체형 전선몰딩\"}]}"));

            CanonicalInquiry row = qna.fetchPage(TOKEN, qnaLane()).rows().get(0);

            assertThat(row.productRef()).isNotNull();
            assertThat(row.productRef().externalProductId()).isEqualTo("6473457700");
            // The name is what a resolve-or-create would have keyed on. It must not be here at all:
            // the canonical Demo Org contains products that share a name.
            assertThat(row.productName()).isNull();
            assertThat(row.sku()).isNull();
        }

        @Test
        @DisplayName("what the resource does not publish, the connector does not claim")
        void absentFieldsStayAbsent() {
            http.enqueue(FakeNaverHttpClient.ok("{\"last\":true,\"contents\":[{"
                    + "\"questionId\":9004,\"createDate\":\"2026-08-20T10:00:00.000+09:00\","
                    + "\"question\":\"문의\",\"answered\":true,\"answer\":\"답변\","
                    + "\"maskedWriterId\":\"ab**\"}]}"));

            CanonicalInquiry row = qna.fetchPage(TOKEN, qnaLane()).rows().get(0);

            // No secrecy field on this resource — null means "not classified", which is the truth.
            assertThat(row.isSecret()).isNull();
            // The resource states a boolean, not a 미처리/처리완료 token. No token is invented.
            assertThat(row.informStatus()).isNull();
            // 상품 문의 publishes no subject and no answer timestamp.
            assertThat(row.title()).isNull();
            assertThat(row.answeredAt()).isNull();
            // The masked writer id is a writer identifier and is not read on any channel.
            assertThat(row.author()).isNull();
        }

        @Test
        @DisplayName("the sweep ends where the resource says it does, not where a page looks short")
        void terminationComesFromTheResourcesOwnStatement() {
            // A FULL page that the resource says is the last one: `last` wins over the size heuristic.
            http.enqueue(FakeNaverHttpClient.ok("{\"last\":true,\"totalPages\":1,\"contents\":[{"
                    + "\"questionId\":1,\"createDate\":\"2026-08-20T10:00:00.000+09:00\","
                    + "\"question\":\"q\",\"answered\":false}]}"));
            assertThat(qna.fetchPage(TOKEN, qnaLane()).last()).isTrue();

            // A SHORT page the resource says is not the last one: the heuristic does not end it early.
            http.enqueue(FakeNaverHttpClient.ok("{\"last\":false,\"totalPages\":4,\"contents\":[{"
                    + "\"questionId\":2,\"createDate\":\"2026-08-20T10:00:00.000+09:00\","
                    + "\"question\":\"q\",\"answered\":false}]}"));
            assertThat(qna.fetchPage(TOKEN, qnaLane()).last()).isFalse();
        }

        @Test
        @DisplayName("403 is a seller permission item, never a retry and never a workaround")
        void aForbiddenResponseIsAPermissionItem() {
            http.enqueue(new NaverHttpClient.Response(403, "{\"code\":\"FORBIDDEN\"}", java.util.Map.of()));

            assertThatThrownBy(() -> qna.fetchPage(TOKEN, qnaLane()))
                    .isInstanceOf(NaverProductPermissionException.class)
                    .hasMessageContaining("문의 API 권한");
        }

        @Test
        @DisplayName("429 surfaces as the rate-limit signal, so the cursor is not advanced")
        void throttlingIsSignalledNotSwallowed() {
            http.enqueue(FakeNaverHttpClient.rateLimited429());

            assertThatThrownBy(() -> qna.fetchPage(TOKEN, qnaLane()))
                    .isInstanceOf(NaverRateLimitedException.class);
        }

        @Test
        @DisplayName("a body that cannot be parsed does not reach the log or the message")
        void anUnparseableBodyIsNotEchoed() {
            http.enqueue(FakeNaverHttpClient.ok("{\"contents\": not-json"));

            assertThatThrownBy(() -> qna.fetchPage(TOKEN, qnaLane()))
                    .isInstanceOf(IllegalStateException.class)
                    .hasMessage("네이버 상품 문의 응답을 해석할 수 없습니다.");
        }
    }

    @Nested
    @DisplayName("고객 문의 — GET /v1/pay-user/inquiries")
    class CustomerInquiries {

        @Test
        @DisplayName("the request is the documented one: yyyy-MM-dd range, 1-based page, size 200")
        void theRequestMatchesTheOfficialParameterContract() {
            http.enqueue(FakeNaverHttpClient.ok("{\"content\":[],\"last\":true}"));

            customer.fetchPage(TOKEN, customerLane());

            String uri = http.sent.get(0).uri().toString();
            assertThat(uri).contains("/external/v1/pay-user/inquiries");
            // Dates, not date-times: this resource's contract is yyyy-MM-dd and 상품 문의's is not.
            assertThat(uri).contains("startSearchDate=2026-08-10");
            assertThat(uri).contains("endSearchDate=2026-08-24");
            assertThat(uri).contains("page=1");
            // 페이지당 10~200건 — the resource's own ceiling.
            assertThat(uri).contains("size=200");
        }

        @Test
        @DisplayName("the buyer's name and id are returned by NAVER and are read by nothing")
        void buyerIdentityIsNeverProjected() {
            http.enqueue(FakeNaverHttpClient.ok("{\"last\":true,\"content\":[{"
                    + "\"inquiryNo\":7001,\"title\":\"배송 문의\",\"inquiryContent\":\"언제 오나요?\","
                    + "\"inquiryRegistrationDateTime\":\"2026-08-21T09:30:00.000+09:00\","
                    + "\"answered\":false,\"category\":\"배송\",\"orderId\":\"2026082112345\","
                    + "\"productOrderIdList\":\"2026082112345678\",\"productName\":\"종이컵보관함\","
                    + "\"customerId\":\"buyer-77\",\"customerName\":\"홍길동\"}]}"));

            CanonicalInquiry row = customer.fetchPage(TOKEN, customerLane()).rows().get(0);

            // customerName is a REQUIRED field on this resource — the first real buyer name any
            // connector here has been offered. It appears in no field of the canonical row.
            assertThat(row.toString()).doesNotContain("홍길동").doesNotContain("buyer-77");
            assertThat(row.author()).isNull();
            // The ORDER identifiers do have a home as of 2026-08-25, and it is one field with one
            // reader. A single named product order is the exact per-line identity to bind on.
            assertThat(row.orderRef().productOrderId()).isEqualTo("2026082112345678");
            assertThat(row.orderRef().preferredRef()).isEqualTo("2026082112345678");
        }

        @Test
        @DisplayName("an answered inquiry keeps the seller's answer and the platform's own timestamp")
        void anAnsweredInquiryCarriesAnswerAndTime() {
            http.enqueue(FakeNaverHttpClient.ok("{\"last\":true,\"content\":[{"
                    + "\"inquiryNo\":7002,\"title\":\"교환\",\"inquiryContent\":\"교환 되나요?\","
                    + "\"inquiryRegistrationDateTime\":\"2026-08-21T09:30:00.000+09:00\","
                    + "\"answered\":true,\"answerContent\":\"가능합니다.\",\"answerContentId\":55,"
                    + "\"answerRegistrationDateTime\":\"2026-08-22T11:00:00.000+09:00\"}]}"));

            CanonicalInquiry row = customer.fetchPage(TOKEN, customerLane()).rows().get(0);

            assertThat(row.status()).isEqualTo("ANSWERED");
            assertThat(row.answerBody()).isEqualTo("가능합니다.");
            assertThat(row.answeredAt()).isEqualTo(Instant.parse("2026-08-22T02:00:00Z"));
            assertThat(row.title()).isEqualTo("교환");
            assertThat(row.sourceSubtype()).isEqualTo(InquirySourceSubtype.NAVER_CUSTOMER_INQUIRY);
        }

        @Test
        @DisplayName("category is the KIND of inquiry and is never written where a status is read")
        void theCategoryIsNotAStatusToken() {
            http.enqueue(FakeNaverHttpClient.ok("{\"last\":true,\"content\":[{"
                    + "\"inquiryNo\":7003,\"title\":\"t\",\"inquiryContent\":\"c\","
                    + "\"inquiryRegistrationDateTime\":\"2026-08-21T09:30:00.000+09:00\","
                    + "\"answered\":false,\"category\":\"반품\"}]}"));

            CanonicalInquiry row = customer.fetchPage(TOKEN, customerLane()).rows().get(0);

            assertThat(row.informStatus()).isNull();
            assertThat(row.status()).isEqualTo("UNANSWERED");
        }

        @Test
        @DisplayName("a row without a product number is unattributed, not attributed by its name")
        void aMissingProductNumberMeansNoAttribution() {
            http.enqueue(FakeNaverHttpClient.ok("{\"last\":true,\"content\":[{"
                    + "\"inquiryNo\":7004,\"title\":\"t\",\"inquiryContent\":\"c\","
                    + "\"inquiryRegistrationDateTime\":\"2026-08-21T09:30:00.000+09:00\","
                    + "\"answered\":false,\"productName\":\"종이컵보관함\"}]}"));

            CanonicalInquiry row = customer.fetchPage(TOKEN, customerLane()).rows().get(0);

            // productNo is OPTIONAL on this resource, so this row genuinely exists. The ref is present
            // (this source attributes by identifier) and carries none — which resolves to nothing.
            assertThat(row.productRef()).isNotNull();
            assertThat(row.productRef().hasIdentifier()).isFalse();
            assertThat(row.productName()).isNull();
        }
    }

    @Test
    @DisplayName("the two sources cannot collide: the same number is a different inquiry in each")
    void theIdentifierSpacesAreNamespacedApart() {
        http.enqueue(FakeNaverHttpClient.ok("{\"last\":true,\"contents\":[{"
                + "\"questionId\":12345,\"createDate\":\"2026-08-20T10:00:00.000+09:00\","
                + "\"question\":\"q\",\"answered\":false}]}"));
        http.enqueue(FakeNaverHttpClient.ok("{\"last\":true,\"content\":[{"
                + "\"inquiryNo\":12345,\"title\":\"t\",\"inquiryContent\":\"c\","
                + "\"inquiryRegistrationDateTime\":\"2026-08-21T09:30:00.000+09:00\","
                + "\"answered\":false}]}"));

        List<CanonicalInquiry> both = List.of(
                qna.fetchPage(TOKEN, qnaLane()).rows().get(0),
                customer.fetchPage(TOKEN, customerLane()).rows().get(0));

        assertThat(both.get(0).externalId()).isNotEqualTo(both.get(1).externalId());
        assertThat(both.get(0).sourceSubtype()).isNotEqualTo(both.get(1).sourceSubtype());
    }
}
