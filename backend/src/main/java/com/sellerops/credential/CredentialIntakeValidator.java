package com.sellerops.credential;

import com.sellerops.collect.dto.CredentialIntakeRequest;
import com.sellerops.common.ApiException;
import com.sellerops.credential.CredentialTemplates.CredentialField;
import com.sellerops.credential.CredentialTemplates.CredentialTemplate;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * Enforces a credential-intake payload against the channel's
 * {@link CredentialTemplates} contract before anything is stored. Pure (no DB, no
 * Spring) so the rules are unit-testable in isolation, like
 * {@code CredentialTemplatesTest}.
 *
 * <p>Returns the normalized payload the vault should store: server-derived
 * {@code connectorClass}/{@code authType} (the client's are advisory and only
 * guard-checked, never trusted as the stored value) and a trimmed secrets map
 * containing exactly the connector's expected field set.
 *
 * <p>Secret-safety: error messages name the field's Korean label, never a
 * submitted value, and never echo a client-supplied (unknown) key.
 */
public final class CredentialIntakeValidator {

    private CredentialIntakeValidator() {}

    /** The validated, normalized payload to hand to the vault. No client-trusted shape. */
    public record ValidatedCredential(
            String connectorClass, String authType, Map<String, String> secrets) {}

    public static ValidatedCredential validate(
            CredentialTemplate template, CredentialIntakeRequest request) {
        // authType / connectorClass are server-owned: the stored values always come
        // from the template. A client value that disagrees is an integration bug, not
        // free-form input — reject it rather than silently overriding.
        requireMatches(template.connectorClass(), request.connectorClass(), "커넥터 종류");
        requireMatches(template.authType(), request.authType(), "인증 방식");

        Map<String, String> submitted = request.secrets() == null ? Map.of() : request.secrets();

        // Unknown keys: anything outside the channel's field set. The key string is
        // client-supplied — never reflect it back in the error message.
        for (String key : submitted.keySet()) {
            if (template.fields().stream().noneMatch(f -> f.key().equals(key))) {
                throw ApiException.badRequest("연결 정보에 허용되지 않은 항목이 포함되어 있습니다.");
            }
        }

        // Build the stored payload field-by-field from the template so it is exactly
        // the connector's expected shape: required fields present and non-blank, any
        // supplied value trimmed (guards copy/paste whitespace in API keys).
        Map<String, String> normalized = new LinkedHashMap<>();
        for (CredentialField field : template.fields()) {
            String raw = submitted.get(field.key());
            boolean present = raw != null;
            String value = present ? raw.trim() : "";
            if (value.isEmpty()) {
                if (field.required()) {
                    throw ApiException.badRequest("필수 항목이 비어 있습니다: " + field.label());
                }
                if (present) {
                    // optional supplied blank — reject consistently with required.
                    throw ApiException.badRequest("항목 값이 비어 있습니다: " + field.label());
                }
                continue; // optional and absent — fine, omit it.
            }
            normalized.put(field.key(), value);
        }

        return new ValidatedCredential(template.connectorClass(), template.authType(), normalized);
    }

    private static void requireMatches(String expected, String actual, String label) {
        if (actual == null || !expected.equals(actual.trim())) {
            throw ApiException.badRequest("이 채널의 " + label + "과(와) 일치하지 않습니다.");
        }
    }
}
