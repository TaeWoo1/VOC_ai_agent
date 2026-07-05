package com.sellerops.credential;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.sellerops.collect.dto.CredentialTemplateView;
import com.sellerops.credential.CredentialTemplates.CredentialField;
import com.sellerops.credential.CredentialTemplates.CredentialTemplate;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.junit.jupiter.api.Test;

/**
 * Locks the credential-template registry to connector reality (anti-drift) and to
 * the metadata-only / secret-free contract.
 */
class CredentialTemplatesTest {

    private final ObjectMapper mapper = new ObjectMapper();

    private CredentialTemplate template(String code) {
        return CredentialTemplates.find(code).orElseThrow();
    }

    private List<String> keys(String code) {
        return template(code).fields().stream().map(CredentialField::key).toList();
    }

    private List<String> requiredKeys(String code) {
        return template(code).fields().stream()
                .filter(CredentialField::required)
                .map(CredentialField::key)
                .toList();
    }

    // --- Anti-drift: keys + required flags mirror each connector's fetch() shape.

    @Test
    void naverShapeMatchesConnector() {
        assertThat(keys("NAVER")).containsExactly("client_id", "client_secret");
        assertThat(requiredKeys("NAVER")).containsExactly("client_id", "client_secret");
        assertThat(template("NAVER").connectorClass()).isEqualTo("API");
    }

    @Test
    void coupangShapeMatchesConnector() {
        assertThat(keys("COUPANG")).containsExactly("access_key", "secret_key", "vendor_id");
        assertThat(requiredKeys("COUPANG")).containsExactly("access_key", "secret_key", "vendor_id");
    }

    @Test
    void cafe24ShapeMatchesConnector() {
        // Seller-connection values only — app client_id/client_secret are server config,
        // not per-seller credential material.
        assertThat(keys("CAFE24")).containsExactly("mall_id", "refresh_token");
        assertThat(requiredKeys("CAFE24")).containsExactly("mall_id", "refresh_token");
    }

    @Test
    void elevenstShapeMatchesConnector() {
        assertThat(keys("ELEVENST")).containsExactly("openapikey");
        assertThat(requiredKeys("ELEVENST")).containsExactly("openapikey");
    }

    @Test
    void gmarketShapeMatchesConnectorWithOptionalAuctionId() {
        assertThat(keys("GMARKET"))
                .containsExactly("master_id", "secret_key", "issuer", "gmarket_seller_id",
                        "auction_seller_id");
        // auction_seller_id is the only optional field (joins the ESM ssi claim).
        assertThat(requiredKeys("GMARKET"))
                .containsExactly("master_id", "secret_key", "issuer", "gmarket_seller_id");
    }

    @Test
    void ssgShapeMatchesConnector() {
        // base-url is config, not a credential — only auth_key is collected.
        assertThat(keys("SSG")).containsExactly("auth_key");
        assertThat(requiredKeys("SSG")).containsExactly("auth_key");
    }

    // --- secret flags: true secrets vs identifiers.

    @Test
    void secretFlagsMarkTrueSecretsOnly() {
        Set<String> expectedSecret = Set.of(
                "client_secret", "access_key", "secret_key", "refresh_token", "openapikey",
                "auth_key");
        for (String code : List.of("NAVER", "COUPANG", "CAFE24", "ELEVENST", "GMARKET", "SSG")) {
            for (CredentialField f : template(code).fields()) {
                assertThat(f.secret())
                        .as("%s.%s secret flag", code, f.key())
                        .isEqualTo(expectedSecret.contains(f.key()));
            }
        }
    }

    @Test
    void unknownAndFileUploadHaveNoTemplate() {
        assertThat(CredentialTemplates.find("FILE_UPLOAD")).isEmpty();
        assertThat(CredentialTemplates.find("LOTTEON")).isEmpty();
        assertThat(CredentialTemplates.find("NOPE")).isEmpty();
        assertThat(CredentialTemplates.find(null)).isEmpty();
    }

    // --- Metadata-only: the serialized view exposes no value/secret/encryptionKeyId.

    @Test
    @SuppressWarnings("unchecked")
    void serializedViewIsMetadataOnly() throws Exception {
        CredentialTemplateView view = CredentialTemplateView.from(template("NAVER"));
        Map<String, Object> json = mapper.readValue(mapper.writeValueAsString(view), Map.class);

        assertThat(json.keySet())
                .containsExactlyInAnyOrder("channelCode", "connectorClass", "authType", "fields",
                        "notes");
        List<Map<String, Object>> fields = (List<Map<String, Object>>) json.get("fields");
        assertThat(fields).isNotEmpty();
        for (Map<String, Object> field : fields) {
            assertThat(field.keySet())
                    .containsExactlyInAnyOrder("key", "label", "required", "secret", "helpText");
            assertThat(field).doesNotContainKeys("value", "encryptionKeyId", "iv", "ciphertext");
        }
    }

    // --- Product/wording safety: API-key / app-integration language only.

    @Test
    void copyAvoidsPasswordLoginAndScrapingLanguage() {
        List<String> banned =
                List.of("비밀번호", "자동 로그인", "로그인", "크롤링", "우회", "password", "login", "crawl");
        for (String code : List.of("NAVER", "COUPANG", "CAFE24", "ELEVENST", "GMARKET", "SSG")) {
            CredentialTemplate t = template(code);
            StringBuilder copy = new StringBuilder(t.notes());
            for (CredentialField f : t.fields()) {
                copy.append(' ').append(f.label()).append(' ').append(f.helpText());
            }
            String lower = copy.toString().toLowerCase();
            for (String token : banned) {
                assertThat(lower)
                        .as("%s copy must not contain '%s'", code, token)
                        .doesNotContain(token.toLowerCase());
            }
        }
    }
}
