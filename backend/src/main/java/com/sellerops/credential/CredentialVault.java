package com.sellerops.credential;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.sellerops.common.ApiException;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.Base64;
import java.util.Map;
import java.util.UUID;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

/**
 * The sole reader/writer of {@code connector_credentials}. Write-only intake:
 * {@link #store} encrypts and persists, {@link #readMasked} returns metadata
 * only, and {@link #open} decrypts in memory strictly for run-time connector
 * use. No plaintext ever touches the database or the logs.
 *
 * <p>Envelope encryption via {@link EnvelopeCipher}: a per-credential DEK
 * encrypts the payload; the configured master key only wraps the DEK. The
 * master key is a <b>local throwaway</b> supplied by environment
 * ({@code SELLEROPS_VAULT_MASTER_KEY}, base64-encoded 32 bytes) — a KMS-backed
 * key is a later phase; swapping it changes configuration, not the stored
 * format. Without a configured key the vault fails closed: the app still boots
 * (the mock connector needs no credentials) but every operation touching secret
 * material ({@link #store}, {@link #open}) throws — {@link #readMasked} serves
 * metadata only and needs no key.
 *
 * <p>Slice 5 is service-layer only — the intake/read API endpoints are Slice 6,
 * and nothing calls {@link #open} yet (real connectors are Phase 3C).
 */
@Service
public class CredentialVault {

    static final int MASTER_KEY_LENGTH = 32;

    private static final TypeReference<Map<String, String>> SECRETS_TYPE = new TypeReference<>() {
    };

    private final ConnectorCredentialRepository credentials;
    private final ObjectMapper objectMapper;
    private final String masterKeyBase64;
    private final String keyId;

    public CredentialVault(ConnectorCredentialRepository credentials,
                           ObjectMapper objectMapper,
                           @Value("${sellerops.vault.master-key-base64:}") String masterKeyBase64,
                           @Value("${sellerops.vault.key-id:local-dev-1}") String keyId) {
        this.credentials = credentials;
        this.objectMapper = objectMapper;
        this.masterKeyBase64 = masterKeyBase64;
        this.keyId = keyId;
    }

    /**
     * Encrypt and upsert the credential for a seller account (one row per
     * account; storing again rotates in place and stamps {@code lastRotatedAt}).
     * Returns the masked view — the plaintext is never readable back through any
     * vault method except the run-time {@link #open}.
     */
    public CredentialMetadata store(UUID orgId, UUID sellerAccountId, String connectorClass,
                                    String authType, Map<String, String> secrets,
                                    String refreshToken, Instant tokenExpiresAt, UUID createdBy) {
        requireText(connectorClass, "커넥터 종류는 필수입니다.");
        requireText(authType, "인증 방식은 필수입니다.");
        if (secrets == null || secrets.isEmpty()) {
            throw ApiException.badRequest("자격 증명 값이 비어 있습니다.");
        }
        byte[] masterKey = masterKey();

        ConnectorCredential row = credentials.findByOrgIdAndSellerAccountId(orgId, sellerAccountId)
                .map(existing -> {
                    existing.setLastRotatedAt(Instant.now());
                    return existing;
                })
                .orElseGet(() -> {
                    if (credentials.existsBySellerAccountId(sellerAccountId)) {
                        // The account belongs to another org — same answer as absent.
                        throw ApiException.notFound("판매 계정을 찾을 수 없습니다.");
                    }
                    ConnectorCredential fresh = new ConnectorCredential();
                    fresh.setOrgId(orgId);
                    fresh.setSellerAccountId(sellerAccountId);
                    return fresh;
                });

        byte[] envelope = EnvelopeCipher.seal(masterKey, toJsonBytes(secrets));
        row.setConnectorClass(connectorClass);
        row.setAuthType(authType);
        row.setEncryptedPayload(envelope);
        row.setIv(EnvelopeCipher.payloadIv(envelope));
        row.setEncryptionKeyId(keyId);
        row.setTokenExpiresAt(tokenExpiresAt);
        row.setRefreshTokenEnc(refreshToken != null
                ? EnvelopeCipher.seal(masterKey, refreshToken.getBytes(StandardCharsets.UTF_8))
                : null);
        row.setCreatedBy(createdBy);
        return mask(credentials.save(row));
    }

    /**
     * Re-encrypt the secret payload of an existing credential in place,
     * preserving connector class, auth type, creator, and the separate
     * refresh-token slot. This is the connector-driven rotation path for
     * providers whose tokens rotate server-side on use (e.g. Cafe24's
     * single-use refresh token): once the provider has rotated, the old value
     * is dead, so the new one must be persisted immediately. Fails closed
     * exactly like {@link #open} — missing row (org-scoped) or missing master
     * key throws, and on any failure the stored payload is untouched.
     */
    public CredentialMetadata rotateSecrets(UUID orgId, UUID sellerAccountId,
                                            Map<String, String> secrets) {
        if (secrets == null || secrets.isEmpty()) {
            throw ApiException.badRequest("자격 증명 값이 비어 있습니다.");
        }
        ConnectorCredential row = load(orgId, sellerAccountId);
        byte[] masterKey = masterKey();
        byte[] envelope = EnvelopeCipher.seal(masterKey, toJsonBytes(secrets));
        row.setEncryptedPayload(envelope);
        row.setIv(EnvelopeCipher.payloadIv(envelope));
        row.setEncryptionKeyId(keyId);
        row.setLastRotatedAt(Instant.now());
        return mask(credentials.save(row));
    }

    /** Metadata only — what an API or UI may show about a stored credential. */
    public CredentialMetadata readMasked(UUID orgId, UUID sellerAccountId) {
        return mask(load(orgId, sellerAccountId));
    }

    /**
     * Decrypt for run-time connector use only. The result lives in memory for
     * the duration of a run — callers must not persist, log, or serialize it.
     */
    public DecryptedCredential open(UUID orgId, UUID sellerAccountId) {
        ConnectorCredential row = load(orgId, sellerAccountId);
        byte[] masterKey = masterKey();
        Map<String, String> secrets = fromJsonBytes(EnvelopeCipher.open(masterKey, row.getEncryptedPayload()));
        String refreshToken = row.getRefreshTokenEnc() != null
                ? new String(EnvelopeCipher.open(masterKey, row.getRefreshTokenEnc()), StandardCharsets.UTF_8)
                : null;
        return new DecryptedCredential(
                row.getConnectorClass(), row.getAuthType(), secrets, refreshToken, row.getTokenExpiresAt());
    }

    private ConnectorCredential load(UUID orgId, UUID sellerAccountId) {
        // Org scoping is enforced at the query boundary, not after materializing
        // the row — a cross-org id reads as absent, with no existence leak.
        return credentials.findByOrgIdAndSellerAccountId(orgId, sellerAccountId)
                .orElseThrow(() -> ApiException.notFound("저장된 자격 증명이 없습니다."));
    }

    private static CredentialMetadata mask(ConnectorCredential row) {
        return new CredentialMetadata(
                row.getSellerAccountId(),
                row.getConnectorClass(),
                row.getAuthType(),
                row.getEncryptionKeyId(),
                row.getTokenExpiresAt(),
                row.getLastRotatedAt(),
                row.getRefreshTokenEnc() != null);
    }

    /** Fail closed: vault operations are unavailable until a key is configured. */
    private byte[] masterKey() {
        if (masterKeyBase64 == null || masterKeyBase64.isBlank()) {
            throw new IllegalStateException(
                    "자격 증명 저장소 마스터 키가 설정되지 않았습니다 (SELLEROPS_VAULT_MASTER_KEY).");
        }
        byte[] key;
        try {
            key = Base64.getDecoder().decode(masterKeyBase64);
        } catch (IllegalArgumentException e) {
            throw new IllegalStateException("마스터 키가 올바른 base64 형식이 아닙니다.");
        }
        if (key.length != MASTER_KEY_LENGTH) {
            throw new IllegalStateException("마스터 키는 32바이트(AES-256)여야 합니다.");
        }
        return key;
    }

    private byte[] toJsonBytes(Map<String, String> secrets) {
        try {
            return objectMapper.writeValueAsBytes(secrets);
        } catch (Exception e) {
            // No payload detail in the message — it would contain secret material.
            throw new IllegalStateException("자격 증명 직렬화에 실패했습니다.");
        }
    }

    private Map<String, String> fromJsonBytes(byte[] json) {
        try {
            return objectMapper.readValue(json, SECRETS_TYPE);
        } catch (Exception e) {
            throw new IllegalStateException("자격 증명 역직렬화에 실패했습니다.");
        }
    }

    private static void requireText(String value, String message) {
        if (value == null || value.isBlank()) {
            throw ApiException.badRequest(message);
        }
    }
}
