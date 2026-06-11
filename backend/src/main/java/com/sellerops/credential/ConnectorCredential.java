package com.sellerops.credential;

import com.sellerops.common.BaseEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.UUID;
import lombok.Getter;
import lombok.Setter;

/**
 * Envelope-encrypted connector credentials, one row per seller account.
 *
 * <p><b>No plaintext is ever stored.</b> Only the encrypted payload, its IV, and
 * the wrapping-key id are persisted; encryption/decryption and write-only intake
 * live in a later slice's CredentialVault. This slice only defines the table and
 * the entity/repo — there is no logic that reads or writes secret material yet.
 */
@Getter
@Setter
@Entity
@Table(name = "connector_credentials")
public class ConnectorCredential extends BaseEntity {

    @Column(name = "org_id", nullable = false)
    private UUID orgId;

    @Column(name = "seller_account_id", nullable = false, unique = true)
    private UUID sellerAccountId;

    @Column(name = "connector_class", nullable = false)
    private String connectorClass;

    /** HMAC / OAUTH2 / API_KEY / PASSWORD. */
    @Column(name = "auth_type", nullable = false)
    private String authType;

    /** Encrypted secret blob — never plaintext. */
    @Column(name = "encrypted_payload")
    private byte[] encryptedPayload;

    @Column(name = "encryption_key_id")
    private String encryptionKeyId;

    @Column(name = "iv")
    private byte[] iv;

    @Column(name = "token_expires_at")
    private Instant tokenExpiresAt;

    /** Encrypted refresh token (OAuth2) — never plaintext. */
    @Column(name = "refresh_token_enc")
    private byte[] refreshTokenEnc;

    @Column(name = "last_rotated_at")
    private Instant lastRotatedAt;

    @Column(name = "created_by")
    private UUID createdBy;
}
