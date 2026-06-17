package com.sellerops.connector.ssg;

import com.sellerops.credential.CredentialVault;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * Wires the SSG.COM connector strictly behind the feature flag. With
 * {@code sellerops.connector.ssg.enabled=false} (the default) none of these
 * beans exist: the registry sees only the mock connector for SSG and runtime
 * behavior is byte-identical to before.
 *
 * <p>Unlike the other Phase 3D connectors there is <b>no default base-url</b>:
 * the SSG production API host is not publicly printed in the official docs
 * (every endpoint example is a relative path — re-verified 2026-06-13), so a
 * default would be a guess. Flag-on without an explicit
 * {@code sellerops.connector.ssg.base-url} fails startup closed, and the
 * value must be https — the static vendor key travels in the
 * {@code Authorization} header and must never cross plaintext.
 */
@Configuration
@ConditionalOnProperty(name = "sellerops.connector.ssg.enabled", havingValue = "true")
public class SsgConnectorConfiguration {

    @Bean
    SsgHttpClient ssgHttpClient(@Value("${sellerops.connector.ssg.base-url:}") String baseUrl) {
        if (baseUrl == null || baseUrl.isBlank()) {
            throw new IllegalStateException(
                    "SSG 커넥터가 활성화되었지만 base-url이 없습니다. SSG 운영 API 호스트는 공식 문서에"
                            + " 공개되어 있지 않아 기본값을 제공하지 않습니다 — 인증키 발급 시 확인한 호스트를"
                            + " sellerops.connector.ssg.base-url로 명시해야 시작할 수 있습니다.");
        }
        if (!baseUrl.startsWith("https://")) {
            throw new IllegalStateException(
                    "SSG base-url은 https여야 합니다 — 업체 인증키가 Authorization 헤더로 전송되므로"
                            + " 평문 HTTP는 허용되지 않습니다.");
        }
        return new JdkSsgHttpClient();
    }

    @Bean
    SsgApiConnector ssgApiConnector(SsgHttpClient http, CredentialVault vault) {
        return new SsgApiConnector(http, vault);
    }
}
