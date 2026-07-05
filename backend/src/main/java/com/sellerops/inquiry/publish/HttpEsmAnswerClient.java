package com.sellerops.inquiry.publish;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.sellerops.connector.esm.EsmHttpClient;
import com.sellerops.connector.esm.EsmJwtSigner;
import com.sellerops.credential.CredentialVault;
import com.sellerops.credential.DecryptedCredential;
import java.net.URI;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;

/**
 * Real transport for the official ESM answer POST ({@link EsmAnswerResponseParser#QNA_PATH}).
 * It signs a per-SellerAccount JWT from the vault credential, posts exactly {@code
 * {messageNo, token, answerStatus, title, comments}}, and maps the response via
 * {@link EsmAnswerResponseParser}. A transport exception (timeout / connection
 * failure) is an ambiguous {@link Outcome.Kind#DELIVERY_UNKNOWN} — never a silent
 * success or a resend.
 *
 * <p><b>NOT a default bean.</b> Live posting is off by default; wiring this in is the
 * final, credential-gated live step (see {@link DisabledPublishTransport}). The
 * token and any provider error text are never logged or persisted.
 */
public class HttpEsmAnswerClient implements EsmAnswerClient {

    private final EsmHttpClient http;
    private final EsmJwtSigner signer;
    private final CredentialVault vault;
    private final String baseUrl;
    private final ObjectMapper mapper = new ObjectMapper();

    public HttpEsmAnswerClient(EsmHttpClient http, EsmJwtSigner signer, CredentialVault vault, String baseUrl) {
        this.http = http;
        this.signer = signer;
        this.vault = vault;
        this.baseUrl = baseUrl.endsWith("/") ? baseUrl.substring(0, baseUrl.length() - 1) : baseUrl;
    }

    @Override
    public Outcome post(AnswerCommand command) {
        String authorization = "Bearer " + signJwt(command.orgId(), command.sellerAccountId());
        String body = requestBody(command);
        EsmHttpClient.Response response;
        try {
            response = http.postJson(URI.create(baseUrl + EsmAnswerResponseParser.QNA_PATH),
                    headers(authorization), body);
        } catch (RuntimeException transportFailure) {
            // Ambiguous — the answer may or may not have landed. Verify, never resend.
            return Outcome.deliveryUnknown();
        }
        return EsmAnswerResponseParser.parse(response.body());
    }

    private String signJwt(UUID orgId, UUID sellerAccountId) {
        DecryptedCredential credential = vault.open(orgId, sellerAccountId);
        Map<String, String> s = credential.secrets();
        return signer.token(s.get("master_id"), s.get("secret_key"), s.get("issuer"),
                s.get("auction_seller_id"), s.get("gmarket_seller_id"));
    }

    private String requestBody(AnswerCommand command) {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("messageNo", command.messageNo());
        body.put("token", command.token());
        body.put("answerStatus", command.answerStatus());
        body.put("title", command.title());
        body.put("comments", command.comments());
        try {
            return mapper.writeValueAsString(body);
        } catch (Exception e) {
            // Never echo the token/content — generic message only.
            throw new IllegalStateException("ESM 답변 요청 본문을 생성할 수 없습니다.");
        }
    }

    private static Map<String, String> headers(String authorization) {
        Map<String, String> headers = new LinkedHashMap<>();
        headers.put("Authorization", authorization);
        headers.put("Content-Type", "application/json");
        return headers;
    }
}
