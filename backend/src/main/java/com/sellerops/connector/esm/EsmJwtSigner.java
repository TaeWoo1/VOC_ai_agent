package com.sellerops.connector.esm;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.nio.charset.StandardCharsets;
import java.security.InvalidKeyException;
import java.security.NoSuchAlgorithmException;
import java.time.Clock;
import java.util.Base64;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;

/**
 * The official ESM Trading API (G마켓/옥션) JWT, exactly as the Gmarket-operated
 * guide documents it (etapi.gmarket.com API 가이드, re-verified 2026-06-12):
 *
 * <ul>
 *   <li>Header: {@code {"alg":"HS256","typ":"JWT","kid":"{ESM+ Master ID}"}}.</li>
 *   <li>Payload: {@code iss} = token issuer (the service domain registered at
 *       key issuance), {@code sub} = {@code "sell"} (fixed for the Sell API),
 *       {@code aud} = {@code "sa.esmplus.com"} (fixed), {@code iat} = issued
 *       timestamp (officially "필수 정보 아님" — optional; emitted here as RFC 7519
 *       NumericDate epoch seconds, the unit to re-confirm at live smoke),
 *       {@code ssi} = {@code "A:{auction seller id},G:{gmarket seller id}"}
 *       with only the present sites included.</li>
 *   <li>Signature: {@code HS256(base64UrlEncode(header) + "." +
 *       base64UrlEncode(payload), secret key)} — the issued key; segments are
 *       base64url without padding; sent as {@code Authorization: Bearer}.</li>
 * </ul>
 *
 * <p>Deterministic for fixed inputs and a fixed {@link Clock}. No secret
 * material — the issued key or any signed token — ever appears in exception
 * messages or logs; there is no logger in this class by design.
 */
public final class EsmJwtSigner {

    static final String SUBJECT_SELL = "sell";
    static final String AUDIENCE = "sa.esmplus.com";

    private static final Base64.Encoder BASE64_URL = Base64.getUrlEncoder().withoutPadding();

    private final Clock clock;
    private final ObjectMapper mapper = new ObjectMapper();

    public EsmJwtSigner(Clock clock) {
        this.clock = clock;
    }

    /**
     * A signed Sell-API JWT for the given credential. Seller ids are optional
     * per site, but at least one must be present — the {@code ssi} claim is
     * what scopes the token to a marketplace seller.
     */
    public String token(String masterId, String secretKey, String issuer,
                        String auctionSellerId, String gmarketSellerId) {
        // Fail closed at the signer boundary too: a blank kid/iss would yield a
        // structurally valid but semantically dead token, not an obvious error.
        if (!hasText(masterId) || !hasText(secretKey) || !hasText(issuer)) {
            throw new IllegalStateException(
                    "ESM 전자서명 입력값(master_id, secret_key, issuer)이 비어 있습니다.");
        }
        String ssi = ssiClaim(auctionSellerId, gmarketSellerId);

        ObjectNode header = mapper.createObjectNode();
        header.put("alg", "HS256");
        header.put("typ", "JWT");
        header.put("kid", masterId);

        ObjectNode payload = mapper.createObjectNode();
        payload.put("iss", issuer);
        payload.put("sub", SUBJECT_SELL);
        payload.put("aud", AUDIENCE);
        payload.put("iat", clock.instant().getEpochSecond());
        payload.put("ssi", ssi);

        String signingInput = encode(header) + "." + encode(payload);
        return signingInput + "." + sign(secretKey, signingInput);
    }

    /** The official site-prefixed seller-id claim: {@code A:...,G:...}. */
    static String ssiClaim(String auctionSellerId, String gmarketSellerId) {
        StringBuilder ssi = new StringBuilder();
        if (hasText(auctionSellerId)) {
            ssi.append("A:").append(auctionSellerId);
        }
        if (hasText(gmarketSellerId)) {
            if (ssi.length() > 0) {
                ssi.append(',');
            }
            ssi.append("G:").append(gmarketSellerId);
        }
        if (ssi.length() == 0) {
            throw new IllegalStateException("ESM 판매자 ID가 없습니다 (옥션/지마켓 중 최소 1개 필요).");
        }
        return ssi.toString();
    }

    private String encode(ObjectNode node) {
        try {
            return BASE64_URL.encodeToString(mapper.writeValueAsBytes(node));
        } catch (Exception e) {
            // The node carries credential-derived values — no detail in the message.
            throw new IllegalStateException("ESM 인증 토큰 직렬화에 실패했습니다.");
        }
    }

    private static String sign(String secretKey, String signingInput) {
        try {
            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(new SecretKeySpec(secretKey.getBytes(StandardCharsets.UTF_8), "HmacSHA256"));
            return BASE64_URL.encodeToString(mac.doFinal(signingInput.getBytes(StandardCharsets.UTF_8)));
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException("HmacSHA256을 사용할 수 없는 환경입니다.");
        } catch (InvalidKeyException | IllegalArgumentException e) {
            // The JCE message could carry key context — replace it wholesale.
            throw new IllegalStateException("ESM secret_key로 전자서명을 생성할 수 없습니다.");
        }
    }

    private static boolean hasText(String value) {
        return value != null && !value.isBlank();
    }
}
