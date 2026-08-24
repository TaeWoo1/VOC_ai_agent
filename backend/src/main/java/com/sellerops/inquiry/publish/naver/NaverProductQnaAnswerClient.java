package com.sellerops.inquiry.publish.naver;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.net.URI;

/**
 * 상품 문의 답변 등록 — {@code PUT /external/v1/contents/qnas/&#123;questionId&#125;}.
 *
 * <p><b>Written from the vendored official contract</b>
 * ({@code docs/vendor/naver-commerce-api/put-v1-contents-qnas-questionId.md}, retrieved 2026-08-24),
 * not from the path alone. The body is exactly one required field, {@code commentContent}; the target
 * is {@code questionId}, an int64 path parameter; errors are the plain HTTP families
 * (400/401/403/404/500) with no per-case NAVER code.
 *
 * <p><b>The one thing this endpoint does that its sibling does not: it OVERWRITES.</b> The vendor
 * document is explicit — "동일 questionId에 다시 호출하면 등록이 아닌 수정으로 동작" — so a second call
 * silently replaces whatever answer is there, including one a person wrote in the NAVER console ten
 * minutes ago. There is no {@code ERR-NC-101010} here to catch it, which means the protection has to
 * be ours: the publish core proves the target is still unanswered immediately before the send
 * ({@code PreSendCheck#ALREADY_ANSWERED}), and a transport ambiguity verifies instead of retrying.
 * On this endpoint a blind retry is not a duplicate answer — it is a deletion.
 */
public class NaverProductQnaAnswerClient {

    static final String ANSWER_PATH_FMT = "/external/v1/contents/qnas/%s";

    private final NaverAnswerHttpClient http;
    private final String baseUrl;
    private final String liveApprovalId;
    private final ObjectMapper mapper = new ObjectMapper();

    public NaverProductQnaAnswerClient(NaverAnswerHttpClient http, String baseUrl,
                                       String liveApprovalId) {
        this.http = http;
        this.baseUrl = baseUrl == null ? "" : baseUrl.trim();
        this.liveApprovalId = liveApprovalId == null ? "" : liveApprovalId.trim();
    }

    /**
     * Register (or, per the contract, replace) the answer to one 상품 문의.
     *
     * @throws NaverAnswerTransportAmbiguity when the request left and no response came back
     * @throws NaverAnswerLiveApprovalRequired when a real host is addressed with no armed approval
     */
    public NaverAnswerOutcome postAnswer(String bearerToken, String questionId, String content) {
        if (baseUrl.isEmpty()) {
            // A blank base URL is a deployment fact, not a NAVER refusal, and it never sends.
            return NaverAnswerOutcome.retryable("NO_BASE_URL");
        }
        NaverAnswerLiveGuard.ensureLiveWriteAllowed(baseUrl, liveApprovalId);

        ObjectNode body = mapper.createObjectNode();
        body.put("commentContent", content);
        NaverAnswerHttpClient.Response response =
                http.putJson(URI.create(baseUrl + String.format(ANSWER_PATH_FMT, questionId)),
                        bearerToken, body.toString());

        int status = response.statusCode();
        if (status >= 200 && status < 300) {
            // The response carries no separate answer handle, so the question's own id is the only
            // honest reference. Inventing one would put a fabricated value in the audit trail.
            return NaverAnswerOutcome.accepted(questionId);
        }
        return switch (status) {
            // 400 (본문 비었음/금칙어), 403 (다른 판매자의 문의), 404 (삭제된 문의) — all of these are
            // refusals the same request would earn again.
            case 400, 403, 404 -> NaverAnswerOutcome.rejected(String.valueOf(status));
            // 401 is an expired token, which the next mint fixes; 429/5xx are transient.
            case 401, 429 -> NaverAnswerOutcome.retryable(String.valueOf(status));
            default -> status >= 500
                    ? NaverAnswerOutcome.retryable(String.valueOf(status))
                    : NaverAnswerOutcome.rejected(String.valueOf(status));
        };
    }
}
