package com.sellerops.connector.coupang;

import java.nio.charset.StandardCharsets;
import java.security.InvalidKeyException;
import java.security.NoSuchAlgorithmException;
import java.time.Clock;
import java.time.format.DateTimeFormatter;
import java.time.ZoneOffset;
import java.util.HexFormat;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;

/**
 * The official Coupang WING Open API request signature ("CEA"), exactly as the
 * Coupang-operated portal documents it (developers.coupangcorp.com, "Creating
 * HMAC Signature", re-verified 2026-06-12):
 *
 * <ul>
 *   <li>Message: {@code signedDate + method + path + query}, concatenated with
 *       no separators; the {@code ?} between path and query is NOT part of the
 *       message ({@code query} is appended directly, empty when absent).</li>
 *   <li>Signed date: {@code yyMMddTHHmmssZ} in GMT (e.g. {@code 190805T044045Z}
 *       — the portal's own example).</li>
 *   <li>Algorithm: HMAC-SHA256 over the secret key; signature encoded as
 *       <b>lowercase hex</b> (the official Python sample's {@code hexdigest()}).</li>
 *   <li>Header: {@code Authorization: CEA algorithm=HmacSHA256,
 *       access-key={accessKey}, signed-date={signedDate}, signature={signature}}.</li>
 * </ul>
 *
 * <p>Deterministic for fixed inputs; the only time source is the injected
 * {@link Clock}. No secret material — secret key or signature — ever appears in
 * exception messages or logs; there is no logger in this class by design.
 *
 * <p>Every live call also requires {@code X-Requested-By: {vendorId}} and
 * {@code X-MARKET: KR} headers (official test guide) — header assembly beyond
 * {@code Authorization} belongs to the order-collection slice, not the signer.
 */
public final class CoupangSigner {

    static final String ALGORITHM = "HmacSHA256";
    private static final DateTimeFormatter SIGNED_DATE_FORMAT =
            DateTimeFormatter.ofPattern("yyMMdd'T'HHmmss'Z'").withZone(ZoneOffset.UTC);

    private final Clock clock;

    public CoupangSigner(Clock clock) {
        this.clock = clock;
    }

    /** The current signed-date, GMT {@code yyMMddTHHmmssZ}. */
    public String signedDate() {
        return SIGNED_DATE_FORMAT.format(clock.instant());
    }

    /** Full {@code Authorization} header value stamped with the clock's now. */
    public String authorization(String accessKey, String secretKey,
                                String method, String path, String query) {
        return authorization(accessKey, secretKey, signedDate(), method, path, query);
    }

    /** Header assembly with an explicit signed-date (deterministic tests). */
    static String authorization(String accessKey, String secretKey, String signedDate,
                                String method, String path, String query) {
        return "CEA algorithm=" + ALGORITHM
                + ", access-key=" + accessKey
                + ", signed-date=" + signedDate
                + ", signature=" + signature(secretKey, signedDate, method, path, query);
    }

    /** Lowercase-hex HMAC-SHA256 over the officially specified message. */
    static String signature(String secretKey, String signedDate,
                            String method, String path, String query) {
        String message = signedDate + method + path + (query == null ? "" : query);
        try {
            Mac mac = Mac.getInstance(ALGORITHM);
            mac.init(new SecretKeySpec(secretKey.getBytes(StandardCharsets.UTF_8), ALGORITHM));
            return HexFormat.of().formatHex(mac.doFinal(message.getBytes(StandardCharsets.UTF_8)));
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException("HmacSHA256을 사용할 수 없는 환경입니다.");
        } catch (InvalidKeyException | IllegalArgumentException e) {
            // The JCE message could carry key context — replace it wholesale.
            throw new IllegalStateException("쿠팡 secret_key로 전자서명을 생성할 수 없습니다.");
        }
    }
}
