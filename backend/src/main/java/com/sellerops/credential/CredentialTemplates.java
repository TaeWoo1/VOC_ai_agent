package com.sellerops.credential;

import java.util.List;
import java.util.Map;
import java.util.Optional;

/**
 * Backend-owned source of truth for the credential FIELD SHAPE each channel
 * requires — what a connection-info form must collect, never any value.
 *
 * <p>The required keys live (and are validated) inside each connector's
 * {@code fetch()} method ({@code credential.secrets().get("...")}); there is no
 * central registry of the shape. This class is that registry: a static,
 * metadata-only map mirroring the connector reality so the frontend renders the
 * form from a backend contract instead of hardcoding per-channel fields. An
 * {@link CredentialTemplatesTest} anti-drift test locks each entry to its
 * connector's key set.
 *
 * <p>Metadata only. No field carries a value, ciphertext, IV, or encryptionKeyId.
 * {@code secret} marks fields the UI must mask (true secrets) versus identifiers
 * it may show. {@code authType} is backend-authored advisory metadata —
 * connectors store it opaquely at intake, so it is not read back from them here.
 */
public final class CredentialTemplates {

    private CredentialTemplates() {}

    /** One field a channel's connection info requires. Shape only — no value. */
    public record CredentialField(
            String key, String label, boolean required, boolean secret, String helpText) {}

    /** The full credential-field shape for one channel. Shape only — no values. */
    public record CredentialTemplate(
            String channelCode,
            String connectorClass,
            String authType,
            List<CredentialField> fields,
            String notes) {}

    private static final String API = "API";

    // Keys + required flags mirror each connector's fetch() shape check; see
    // connector/<x>/<X>ApiConnector.java. `secret` distinguishes true secrets
    // (mask) from identifiers (showable). Copy uses API-key / app-integration
    // language only — no 비밀번호 / 로그인 / 크롤링 / 우회, no secret examples.
    private static final Map<String, CredentialTemplate> BY_CODE = Map.of(
            "NAVER",
            new CredentialTemplate("NAVER", API, "API_KEY", List.of(
                    new CredentialField("client_id", "애플리케이션 ID", true, false,
                            "네이버 커머스 API 센터에서 발급한 애플리케이션 ID입니다."),
                    new CredentialField("client_secret", "애플리케이션 시크릿", true, true,
                            "애플리케이션 ID와 함께 발급되는 시크릿 키입니다.")),
                    "네이버 커머스 API 센터에서 발급한 애플리케이션 키로 연결합니다."),

            "COUPANG",
            new CredentialTemplate("COUPANG", API, "HMAC", List.of(
                    new CredentialField("access_key", "액세스 키", true, true,
                            "쿠팡 윙 OPEN API에서 발급한 액세스 키입니다."),
                    new CredentialField("secret_key", "시크릿 키", true, true,
                            "액세스 키와 함께 발급되는 시크릿 키입니다."),
                    new CredentialField("vendor_id", "판매자(벤더) ID", true, false,
                            "쿠팡 윙에서 확인할 수 있는 판매자 코드입니다.")),
                    "쿠팡 윙(판매자센터) OPEN API에서 발급한 API 인증 키로 연결합니다."),

            "CAFE24",
            // Seller-connection values only. The app client_id/client_secret are
            // server configuration (one registered app for every mall), never stored
            // per seller — the "Connect Cafe24" OAuth flow captures the refresh token.
            new CredentialTemplate("CAFE24", API, "OAUTH2", List.of(
                    new CredentialField("mall_id", "몰 ID", true, false,
                            "카페24 자사몰의 상점 아이디입니다."),
                    new CredentialField("refresh_token", "리프레시 토큰", true, true,
                            "앱 연동(OAuth) 과정에서 발급된 리프레시 토큰입니다.")),
                    "카페24 자사몰 관리자에서 앱 연동(OAuth)으로 연결합니다."),

            "ELEVENST",
            new CredentialTemplate("ELEVENST", API, "API_KEY", List.of(
                    new CredentialField("openapikey", "오픈 API 키", true, true,
                            "11번가 셀러오피스에서 발급한 오픈 API 키입니다.")),
                    "11번가 셀러오피스에서 발급한 오픈 API 키로 연결합니다."),

            "GMARKET",
            new CredentialTemplate("GMARKET", API, "JWT_HS256", List.of(
                    new CredentialField("master_id", "마스터 ID", true, false,
                            "ESM 판매자센터의 마스터 계정 ID입니다."),
                    new CredentialField("secret_key", "시크릿 키", true, true,
                            "ESM에서 발급한 API 시크릿 키입니다."),
                    new CredentialField("issuer", "발급 도메인(issuer)", true, false,
                            "API 키 발급 시 등록한 서비스 도메인입니다."),
                    new CredentialField("gmarket_seller_id", "G마켓 판매자 ID", true, false,
                            "G마켓 판매자 계정 ID입니다."),
                    new CredentialField("auction_seller_id", "옥션 판매자 ID", false, false,
                            "옥션도 함께 수집할 때만 입력합니다.")),
                    "ESM 판매자센터에서 발급한 API 인증 정보로 연결합니다. (G마켓·옥션 공통)"),

            "SSG",
            new CredentialTemplate("SSG", API, "API_KEY", List.of(
                    new CredentialField("auth_key", "업체 인증키", true, true,
                            "SSG 파트너에서 발급한 업체 인증키입니다.")),
                    "SSG 파트너에서 발급한 API 인증키로 연결합니다."));

    /** The credential-field shape for a channel code, or empty if none is defined. */
    public static Optional<CredentialTemplate> find(String channelCode) {
        if (channelCode == null) {
            return Optional.empty();
        }
        return Optional.ofNullable(BY_CODE.get(channelCode));
    }
}
