package com.sellerops.credential;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.sellerops.collect.dto.CredentialIntakeRequest;
import com.sellerops.common.ApiException;
import com.sellerops.credential.CredentialIntakeValidator.ValidatedCredential;
import com.sellerops.credential.CredentialTemplates.CredentialField;
import com.sellerops.credential.CredentialTemplates.CredentialTemplate;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

/**
 * Pure validation rules — no DB, no Spring. Locks the credential-intake contract:
 * required/unknown/blank field handling, server-derived authType/connectorClass,
 * trimming, and the secret-safety of error messages.
 */
class CredentialIntakeValidatorTest {

    private static CredentialTemplate template(String code) {
        return CredentialTemplates.find(code).orElseThrow();
    }

    private static CredentialIntakeRequest req(
            String connectorClass, String authType, Map<String, String> secrets) {
        return new CredentialIntakeRequest(connectorClass, authType, secrets, null, null);
    }

    /** Every required field filled with a recognizable, distinct value. */
    private static Map<String, String> filledRequired(CredentialTemplate t) {
        Map<String, String> m = new LinkedHashMap<>();
        t.fields().stream()
                .filter(CredentialField::required)
                .forEach(f -> m.put(f.key(), "value-" + f.key()));
        return m;
    }

    @Test
    void acceptsAValidPayloadForEveryChannel() {
        for (String code : List.of("NAVER", "COUPANG", "CAFE24", "ELEVENST", "GMARKET", "SSG")) {
            CredentialTemplate t = template(code);
            long requiredCount = t.fields().stream().filter(CredentialField::required).count();

            ValidatedCredential v =
                    CredentialIntakeValidator.validate(t, req(t.connectorClass(), t.authType(), filledRequired(t)));

            assertThat(v.connectorClass()).as("%s connectorClass", code).isEqualTo(t.connectorClass());
            assertThat(v.authType()).as("%s authType", code).isEqualTo(t.authType());
            assertThat(v.secrets()).as("%s required keys", code).hasSize((int) requiredCount);
        }
    }

    @Test
    void rejectsMissingRequiredField() {
        CredentialTemplate t = template("COUPANG");
        Map<String, String> secrets = filledRequired(t);
        secrets.remove("secret_key");

        assertThatThrownBy(() -> CredentialIntakeValidator.validate(t, req("API", "HMAC", secrets)))
                .isInstanceOf(ApiException.class)
                .hasMessageContaining("필수 항목");
    }

    @Test
    void rejectsBlankRequiredField() {
        CredentialTemplate t = template("COUPANG");
        Map<String, String> secrets = filledRequired(t);
        secrets.put("vendor_id", "   ");

        assertThatThrownBy(() -> CredentialIntakeValidator.validate(t, req("API", "HMAC", secrets)))
                .isInstanceOf(ApiException.class)
                .hasMessageContaining("비어 있습니다");
    }

    @Test
    void rejectsUnknownKeyWithoutEchoingIt() {
        CredentialTemplate t = template("COUPANG");
        Map<String, String> secrets = filledRequired(t);
        secrets.put("unexpected_field", "whatever");

        assertThatThrownBy(() -> CredentialIntakeValidator.validate(t, req("API", "HMAC", secrets)))
                .isInstanceOf(ApiException.class)
                .satisfies(e -> assertThat(e.getMessage()).doesNotContain("unexpected_field"));
    }

    @Test
    void gmarketOptionalAuctionSellerIdMayBeAbsentPresentOrRejectedWhenBlank() {
        CredentialTemplate t = template("GMARKET");

        // Absent → OK, 4 required keys stored.
        ValidatedCredential absent =
                CredentialIntakeValidator.validate(t, req("API", "JWT_HS256", filledRequired(t)));
        assertThat(absent.secrets()).hasSize(4).doesNotContainKey("auction_seller_id");

        // Present non-blank → OK, 5 keys stored.
        Map<String, String> withOptional = filledRequired(t);
        withOptional.put("auction_seller_id", "A-1");
        ValidatedCredential present =
                CredentialIntakeValidator.validate(t, req("API", "JWT_HS256", withOptional));
        assertThat(present.secrets()).hasSize(5).containsEntry("auction_seller_id", "A-1");

        // Present but blank → rejected, same rule as required.
        Map<String, String> blankOptional = filledRequired(t);
        blankOptional.put("auction_seller_id", "  ");
        assertThatThrownBy(() -> CredentialIntakeValidator.validate(t, req("API", "JWT_HS256", blankOptional)))
                .isInstanceOf(ApiException.class)
                .hasMessageContaining("비어 있습니다");
    }

    @Test
    void rejectsAuthTypeAndConnectorClassMismatch() {
        CredentialTemplate t = template("NAVER"); // authType API_KEY, connectorClass API

        assertThatThrownBy(() -> CredentialIntakeValidator.validate(t, req("API", "HMAC", filledRequired(t))))
                .isInstanceOf(ApiException.class)
                .hasMessageContaining("인증 방식");
        assertThatThrownBy(() -> CredentialIntakeValidator.validate(t, req("WRONG", "API_KEY", filledRequired(t))))
                .isInstanceOf(ApiException.class)
                .hasMessageContaining("커넥터 종류");
    }

    @Test
    void trimsStoredValues() {
        CredentialTemplate t = template("SSG");
        Map<String, String> secrets = Map.of("auth_key", "  KEY-123\n");

        ValidatedCredential v = CredentialIntakeValidator.validate(t, req("API", "API_KEY", secrets));

        assertThat(v.secrets()).containsEntry("auth_key", "KEY-123");
    }

    @Test
    void errorMessageNeverContainsASecretValue() {
        CredentialTemplate t = template("COUPANG");
        // A valid secret value is present while another field is blank → the thrown
        // message must name the label only, never leak the secret material.
        Map<String, String> secrets = new LinkedHashMap<>();
        secrets.put("access_key", "TOP-SECRET-123");
        secrets.put("secret_key", "   ");
        secrets.put("vendor_id", "V-1");

        assertThatThrownBy(() -> CredentialIntakeValidator.validate(t, req("API", "HMAC", secrets)))
                .isInstanceOf(ApiException.class)
                .satisfies(e -> assertThat(e.getMessage()).doesNotContain("TOP-SECRET-123"));
    }
}
