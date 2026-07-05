package com.sellerops.inquiry.publish;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.sellerops.connector.esm.EsmHttpClient;
import com.sellerops.connector.esm.EsmJwtSigner;
import com.sellerops.connector.esm.inquiry.EsmInquiriesClient;
import com.sellerops.connector.esm.inquiry.EsmInquiryItem;
import com.sellerops.connector.esm.inquiry.EsmInquiryParser;
import com.sellerops.credential.CredentialVault;
import com.sellerops.credential.DecryptedCredential;
import java.net.URI;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

/**
 * Send-time re-query of the exact inquiry for a work item: signs a per-SellerAccount
 * JWT, queries the inquiry window derived from the inquiry's stored {@code receivedAt}
 * day, parses the token-bearing items, and returns the {@link EsmInquiryMatch} for
 * the exact {@code messageNo} + SellerAccount seller identity. Only used behind the
 * live-execution flag; the token it may carry is handled strictly in memory by the
 * caller and never logged/persisted here.
 */
public class EsmInquiryReQuery {

    private final EsmHttpClient http;
    private final EsmJwtSigner signer;
    private final CredentialVault vault;
    private final String baseUrl;
    private final EsmInquiryParser parser = new EsmInquiryParser();
    private final ObjectMapper mapper = new ObjectMapper();

    public EsmInquiryReQuery(EsmHttpClient http, EsmJwtSigner signer, CredentialVault vault, String baseUrl) {
        this.http = http;
        this.signer = signer;
        this.vault = vault;
        this.baseUrl = baseUrl.endsWith("/") ? baseUrl.substring(0, baseUrl.length() - 1) : baseUrl;
    }

    public EsmInquiryMatch.Outcome findMatched(UUID orgId, UUID sellerAccountId, String messageNo,
                                               Instant receivedAt) {
        if (receivedAt == null) {
            return EsmInquiryMatch.Outcome.notFound();
        }
        DecryptedCredential credential = vault.open(orgId, sellerAccountId);
        Map<String, String> secrets = credential.secrets();
        String authorization = "Bearer " + signer.token(
                secrets.get("master_id"), secrets.get("secret_key"), secrets.get("issuer"),
                secrets.get("auction_seller_id"), secrets.get("gmarket_seller_id"));
        Set<String> expectedSellerIds = expectedSellerIds(secrets);

        LocalDate day = receivedAt.atZone(ZoneOffset.UTC).toLocalDate();
        List<EsmInquiryItem> items = parser.parseItems(request(day, authorization));
        return EsmInquiryMatch.selectExact(items, messageNo, expectedSellerIds);
    }

    private static Set<String> expectedSellerIds(Map<String, String> secrets) {
        Set<String> ids = new LinkedHashSet<>();
        for (String key : List.of("gmarket_seller_id", "auction_seller_id")) {
            String v = secrets.get(key);
            if (v != null && !v.isBlank()) {
                ids.add(v);
            }
        }
        return ids;
    }

    private String request(LocalDate day, String authorization) {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("fromDate", day.toString());
        body.put("toDate", day.toString());
        Map<String, String> headers = new LinkedHashMap<>();
        headers.put("Authorization", authorization);
        headers.put("Content-Type", "application/json");
        String json;
        try {
            json = mapper.writeValueAsString(body);
        } catch (Exception e) {
            throw new IllegalStateException("ESM 재조회 요청 본문을 생성할 수 없습니다.");
        }
        EsmHttpClient.Response response = http.postJson(
                URI.create(baseUrl + EsmInquiriesClient.INQUIRY_PATH), headers, json);
        if (response.statusCode() != 200) {
            throw new IllegalStateException("ESM 재조회 실패 (HTTP " + response.statusCode() + ").");
        }
        return response.body();
    }
}
