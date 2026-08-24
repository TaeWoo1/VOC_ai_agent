package com.sellerops.inquiry.publish.naver;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.net.URI;

/**
 * 고객 문의 답변 등록 — {@code POST /external/v1/pay-merchant/inquiries/&#123;inquiryNo&#125;/answer}.
 *
 * <p><b>Written from the vendored official contract</b>
 * ({@code docs/vendor/naver-commerce-api/post-v1-pay-merchant-inquiries-inquiryNo-answer.md},
 * retrieved 2026-08-24). The body's required field is {@code answerComment} — NOT the
 * {@code commentContent} its 상품 문의 sibling takes — and the optional {@code answerTemplateId} is
 * deliberately never sent: SellerOps writes the answer it showed the seller, and a template id would
 * make NAVER substitute text nobody approved.
 *
 * <p><b>This endpoint refuses a second answer, and its sibling does not.</b> A duplicate call returns
 * {@code ERR-NC-101010} inside a 400, which is why the two subtypes cannot share an adapter, an
 * approval, or a retry policy. That refusal is treated as
 * {@link NaverAnswerOutcome.Kind#ALREADY_ANSWERED} rather than as a failure: the customer has an
 * answer, and telling the seller their reply failed would be false.
 *
 * <p>The other 400 codes are separated because they mean different things to a person:
 * {@code ERR-NC-101007} (답변 권한 없음) and {@code ERR-NC-101008} (판매자 번호 유효하지 않음) are
 * connection problems the seller can act on, while {@code ERR-NC-101004/101005} say the inquiry is
 * gone or invalid.
 */
public class NaverCustomerInquiryAnswerClient {

    static final String ANSWER_PATH_FMT = "/external/v1/pay-merchant/inquiries/%s/answer";

    /** 해당 문의에 이미 답변이 존재하는 경우 — the vendor's own code, verbatim. */
    static final String ALREADY_ANSWERED_CODE = "ERR-NC-101010";

    private final NaverAnswerHttpClient http;
    private final String baseUrl;
    private final String liveApprovalId;
    private final ObjectMapper mapper = new ObjectMapper();

    public NaverCustomerInquiryAnswerClient(NaverAnswerHttpClient http, String baseUrl,
                                            String liveApprovalId) {
        this.http = http;
        this.baseUrl = baseUrl == null ? "" : baseUrl.trim();
        this.liveApprovalId = liveApprovalId == null ? "" : liveApprovalId.trim();
    }

    /**
     * Register a NEW answer to one 고객 문의.
     *
     * <p>Registration only. The contract has a separate {@code PUT .../answer/{answerContentId}} for
     * revising an answer that already exists, and it is not implemented here: v1's use case is
     * answering an UNANSWERED inquiry, and an update surface nobody asked for would be one more way
     * to overwrite a person's words.
     */
    public NaverAnswerOutcome postAnswer(String bearerToken, String inquiryNo, String content) {
        if (baseUrl.isEmpty()) {
            return NaverAnswerOutcome.retryable("NO_BASE_URL");
        }
        NaverAnswerLiveGuard.ensureLiveWriteAllowed(baseUrl, liveApprovalId);

        ObjectNode body = mapper.createObjectNode();
        body.put("answerComment", content);
        NaverAnswerHttpClient.Response response =
                http.postJson(URI.create(baseUrl + String.format(ANSWER_PATH_FMT, inquiryNo)),
                        bearerToken, body.toString());

        int status = response.statusCode();
        String code = errorCode(response.body());
        if (status >= 200 && status < 300) {
            return NaverAnswerOutcome.accepted(inquiryNo);
        }
        if (ALREADY_ANSWERED_CODE.equals(code)) {
            return NaverAnswerOutcome.alreadyAnswered(code);
        }
        return switch (status) {
            case 400, 403, 404 -> NaverAnswerOutcome.rejected(code == null ? String.valueOf(status) : code);
            case 401, 429 -> NaverAnswerOutcome.retryable(code == null ? String.valueOf(status) : code);
            default -> status >= 500
                    ? NaverAnswerOutcome.retryable(code == null ? String.valueOf(status) : code)
                    : NaverAnswerOutcome.rejected(code == null ? String.valueOf(status) : code);
        };
    }

    /**
     * NAVER's own {@code code} out of the envelope, or null when the body is not one.
     *
     * <p>Only the code is read. The envelope also carries {@code message} and {@code traceId}, which
     * are provider free text and never cross back into the product.
     */
    static String errorCode(String body) {
        if (body == null || body.isBlank()) {
            return null;
        }
        try {
            JsonNode root = new ObjectMapper().readTree(body);
            JsonNode code = root.path("code");
            return code.isTextual() ? code.asText() : null;
        } catch (Exception notJson) {
            return null;
        }
    }
}
