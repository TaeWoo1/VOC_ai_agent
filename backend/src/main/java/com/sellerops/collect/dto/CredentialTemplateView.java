package com.sellerops.collect.dto;

import com.sellerops.credential.CredentialTemplates.CredentialField;
import com.sellerops.credential.CredentialTemplates.CredentialTemplate;
import java.util.List;

/**
 * Read-only API view of a channel's credential-field shape. Metadata only:
 * there is deliberately NO value field, so a secret, ciphertext, IV, or
 * encryptionKeyId can never be returned by construction.
 */
public record CredentialTemplateView(
        String channelCode,
        String connectorClass,
        String authType,
        List<CredentialFieldView> fields,
        String notes) {

    public static CredentialTemplateView from(CredentialTemplate t) {
        return new CredentialTemplateView(
                t.channelCode(),
                t.connectorClass(),
                t.authType(),
                t.fields().stream().map(CredentialFieldView::from).toList(),
                t.notes());
    }

    /** One required/optional field the connection form must collect. No value. */
    public record CredentialFieldView(
            String key, String label, boolean required, boolean secret, String helpText) {

        public static CredentialFieldView from(CredentialField f) {
            return new CredentialFieldView(f.key(), f.label(), f.required(), f.secret(), f.helpText());
        }
    }
}
