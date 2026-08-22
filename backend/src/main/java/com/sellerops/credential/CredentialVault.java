package com.sellerops.credential;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.sellerops.common.ApiException;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.Map;
import java.util.UUID;
import org.springframework.beans.factory.annotation.Autowired;
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

    private static final TypeReference<Map<String, String>> SECRETS_TYPE = new TypeReference<>() {
    };

    private final ConnectorCredentialRepository credentials;
    private final ObjectMapper objectMapper;
    private final VaultKeyRing keyRing;

    @Autowired
    public CredentialVault(ConnectorCredentialRepository credentials,
                           ObjectMapper objectMapper,
                           VaultKeyRing keyRing) {
        this.credentials = credentials;
        this.objectMapper = objectMapper;
        this.keyRing = keyRing;
    }

    /**
     * Single-key construction — a vault that can open only what it writes.
     *
     * <p>Kept for callers that legitimately have one key and no rotation history to carry: tests, and
     * any tool that seals and opens within one process. Production wiring uses the key-ring
     * constructor above, because a deployment that has ever changed its key needs to open rows sealed
     * under the old one.
     */
    public CredentialVault(ConnectorCredentialRepository credentials,
                           ObjectMapper objectMapper,
                           String masterKeyBase64,
                           String keyId) {
        this(credentials, objectMapper, new VaultKeyRing(masterKeyBase64, keyId, ""));
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
        row.setEncryptionKeyId(keyRing.activeKeyId());
        row.setEncryptionKeyFingerprint(EnvelopeCipher.fingerprint(masterKey));
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
        row.setEncryptionKeyId(keyRing.activeKeyId());
        row.setEncryptionKeyFingerprint(EnvelopeCipher.fingerprint(masterKey));
        row.setLastRotatedAt(Instant.now());
        return mask(credentials.save(row));
    }

    /**
     * Set (or clear) ONLY the credential's expiry date on an existing row — a metadata update that touches no
     * secret material: the encrypted payload, IV, key id, and refresh-token slot are left exactly as they are,
     * and no master key is needed. This is the operator-confirmation path for the credential's expiry (the
     * WING-read or operator-entered exact date) when it was unknown at connection time — never an estimate.
     * Passing {@code null} clears it back to unknown. Fails closed on a missing/foreign row (org-scoped 404).
     */
    public CredentialMetadata setTokenExpiresAt(UUID orgId, UUID sellerAccountId, Instant tokenExpiresAt) {
        ConnectorCredential row = load(orgId, sellerAccountId);
        row.setTokenExpiresAt(tokenExpiresAt);
        return mask(credentials.save(row));
    }

    /**
     * Record which scopes the provider reported granting — metadata only, touching no secret material
     * and needing no master key.
     *
     * <p>Separate from {@link #store} deliberately. Scopes arrive with every token, including every
     * runtime refresh, long after the credential was first written; folding them into the write path
     * would mean a refresh had to re-seal a payload it has no reason to touch. Passing null or an
     * empty list leaves the recorded set ALONE rather than clearing it — a provider that returned no
     * scope list told us nothing, and overwriting a known set with silence would manufacture a
     * regression out of a quiet response.
     */
    public CredentialMetadata recordGrantedScopes(UUID orgId, UUID sellerAccountId,
                                                  java.util.List<String> scopes) {
        ConnectorCredential row = load(orgId, sellerAccountId);
        if (scopes != null && !scopes.isEmpty()) {
            row.setGrantedScopes(String.join(",", scopes));
            return mask(credentials.save(row));
        }
        return mask(row);
    }

    /** Metadata only — what an API or UI may show about a stored credential. */
    public CredentialMetadata readMasked(UUID orgId, UUID sellerAccountId) {
        return mask(load(orgId, sellerAccountId));
    }

    /**
     * Whether a credential is on file for this account. Org-scoped at the query
     * boundary (a cross-org id reads as absent) and needs no master key — it
     * touches no secret material. Lets callers branch on "no credential" without
     * the {@link #load} 404.
     */
    public boolean hasCredential(UUID orgId, UUID sellerAccountId) {
        return credentials.findByOrgIdAndSellerAccountId(orgId, sellerAccountId).isPresent();
    }

    /**
     * Decrypt for run-time connector use only. The result lives in memory for
     * the duration of a run — callers must not persist, log, or serialize it.
     */
    public DecryptedCredential open(UUID orgId, UUID sellerAccountId) {
        ConnectorCredential row = load(orgId, sellerAccountId);
        byte[] masterKey = openingKey(row);
        Map<String, String> secrets;
        String refreshToken;
        try {
            secrets = fromJsonBytes(EnvelopeCipher.open(masterKey, row.getEncryptedPayload()));
            refreshToken = row.getRefreshTokenEnc() != null
                    ? new String(EnvelopeCipher.open(masterKey, row.getRefreshTokenEnc()), StandardCharsets.UTF_8)
                    : null;
        } catch (IllegalStateException e) {
            // The key material we hold for this row's id is the right key by fingerprint (openingKey
            // proved that), so a failure here is about the stored bytes, not the key. Saying so is
            // the difference between "re-enter the credential" and a fruitless key hunt.
            throw new CredentialUnavailableException(CredentialKeyStatus.INVALID_CREDENTIAL,
                    row.getEncryptionKeyId(),
                    "저장된 자격 증명을 복호화할 수 없습니다 (키는 일치하지만 저장된 값이 손상되었습니다). 자격 증명을 다시 입력해 주세요.");
        }
        return new DecryptedCredential(
                row.getConnectorClass(), row.getAuthType(), secrets, refreshToken, row.getTokenExpiresAt());
    }

    /**
     * What can be said about a stored credential without decrypting it — the operational answer to
     * "why is this connection failing?".
     *
     * <p>Deliberately cheap and side-effect free: it resolves key material and compares fingerprints,
     * and only attempts a decryption for rows too old to carry one. A troubleshooting surface, a
     * connection page, or an operator can call it freely without touching secret material.
     */
    public CredentialDiagnosis diagnose(UUID orgId, UUID sellerAccountId) {
        ConnectorCredential row = credentials.findByOrgIdAndSellerAccountId(orgId, sellerAccountId)
                .orElse(null);
        if (row == null) {
            return diagnosis(CredentialKeyStatus.NO_CREDENTIAL, null, null, null, null, null,
                    "이 계정에 저장된 자격 증명이 없습니다. 채널 연결을 먼저 완료해 주세요.");
        }
        String rowKeyId = row.getEncryptionKeyId();
        String sealed = row.getEncryptionKeyFingerprint();
        if (keyRing.isEmpty()) {
            return diagnosis(CredentialKeyStatus.NO_KEY_CONFIGURED, rowKeyId, sealed, null,
                    row.getLastRotatedAt(), row.getTokenExpiresAt(),
                    "이 서버에 자격 증명 마스터 키가 설정되어 있지 않습니다 (SELLEROPS_VAULT_MASTER_KEY). "
                            + "서버 설정 문제이며, 셀러가 다시 연결할 필요는 없습니다.");
        }
        byte[] available = keyRing.keyFor(rowKeyId).orElse(null);
        if (available == null) {
            return diagnosis(CredentialKeyStatus.KEY_NOT_AVAILABLE, rowKeyId, sealed, null,
                    row.getLastRotatedAt(), row.getTokenExpiresAt(),
                    "이 자격 증명은 키 '" + rowKeyId + "' 로 봉인되어 있으나 현재 서버에는 그 키가 없습니다. "
                            + "해당 키를 sellerops.vault.key-ring 에 등록하면 그대로 복구됩니다. "
                            + "설정 문제이며, 셀러가 다시 연결할 필요는 없습니다.");
        }
        String availableFp = EnvelopeCipher.fingerprint(available);
        if (sealed != null && !sealed.equals(availableFp)) {
            return diagnosis(CredentialKeyStatus.KEY_MISMATCH, rowKeyId, sealed, availableFp,
                    row.getLastRotatedAt(), row.getTokenExpiresAt(),
                    "이 자격 증명은 키 '" + rowKeyId + "' 라는 이름으로 저장되어 있지만, 현재 그 이름의 키는 "
                            + "봉인에 쓰인 키가 아닙니다 (지문 " + sealed + " ≠ " + availableFp + "). "
                            + "원래 키를 찾아 key-ring 에 등록하거나, 셀러가 채널을 다시 연결해야 합니다.");
        }
        if (sealed == null) {
            // Pre-V53 row: the only way to tell a wrong key from a damaged payload is to try.
            try {
                EnvelopeCipher.open(available, row.getEncryptedPayload());
            } catch (IllegalStateException e) {
                return diagnosis(CredentialKeyStatus.KEY_UNVERIFIABLE, rowKeyId, null, availableFp,
                        row.getLastRotatedAt(), row.getTokenExpiresAt(),
                        // Seller-facing: this is the one server-side-looking status that a seller CAN
                        // resolve, because re-entering reseals the row under the active key. So it must
                        // say the action, not the mechanism — a sentence about master keys and key rings
                        // reads as "not my problem" to the only person who can fix it. The operator
                        // detail is still on the record: keyId, the available fingerprint, and the run's
                        // own error message all name the key.
                        "저장된 연결 정보를 열지 못했습니다. 채널 연결에서 연결 정보를 다시 입력하면 해결됩니다.");
            }
        }
        return diagnosis(CredentialKeyStatus.OK, rowKeyId, sealed, availableFp,
                row.getLastRotatedAt(), row.getTokenExpiresAt(), null, scopesOf(row));
    }

    /** Recorded scopes as a list; null (never observed) stays null rather than becoming empty. */
    private static java.util.List<String> scopesOf(ConnectorCredential row) {
        String raw = row.getGrantedScopes();
        return raw == null || raw.isBlank() ? null : java.util.List.of(raw.split(","));
    }

    private CredentialDiagnosis diagnosis(CredentialKeyStatus status, String rowKeyId, String sealedFp,
                                          String availableFp, Instant lastRotatedAt,
                                          Instant tokenExpiresAt, String remedy) {
        return diagnosis(status, rowKeyId, sealedFp, availableFp, lastRotatedAt, tokenExpiresAt,
                remedy, null);
    }

    private CredentialDiagnosis diagnosis(CredentialKeyStatus status, String rowKeyId, String sealedFp,
                                          String availableFp, Instant lastRotatedAt,
                                          Instant tokenExpiresAt, String remedy,
                                          java.util.List<String> grantedScopes) {
        return new CredentialDiagnosis(status, rowKeyId, keyRing.activeKeyId(), sealedFp, availableFp,
                lastRotatedAt, tokenExpiresAt, remedy, grantedScopes);
    }

    /**
     * The master key that can open {@code row}, or a classified failure saying why none can.
     *
     * <p>Resolution is by the row's own key id, not by whatever this runtime happens to write with.
     * That is the correction: the column was written from the first release and consulted by nothing,
     * so a key change turned every stored credential into an unopenable blob whose error message
     * blamed the credential.
     */
    private byte[] openingKey(ConnectorCredential row) {
        if (keyRing.isEmpty()) {
            throw new CredentialUnavailableException(CredentialKeyStatus.NO_KEY_CONFIGURED,
                    row.getEncryptionKeyId(),
                    "자격 증명 저장소 마스터 키가 설정되지 않았습니다 (SELLEROPS_VAULT_MASTER_KEY).");
        }
        String rowKeyId = row.getEncryptionKeyId();
        byte[] key = keyRing.keyFor(rowKeyId).orElseThrow(() ->
                new CredentialUnavailableException(CredentialKeyStatus.KEY_NOT_AVAILABLE, rowKeyId,
                        "자격 증명이 키 '" + rowKeyId + "' 로 봉인되어 있으나 이 서버에 해당 키가 없습니다. "
                                + "사용 가능한 키: " + keyRing.knownKeyIds()));
        String sealed = row.getEncryptionKeyFingerprint();
        if (sealed != null) {
            String availableFp = EnvelopeCipher.fingerprint(key);
            if (!sealed.equals(availableFp)) {
                throw new CredentialUnavailableException(CredentialKeyStatus.KEY_MISMATCH, rowKeyId,
                        "키 '" + rowKeyId + "' 의 현재 값은 이 자격 증명을 봉인한 키가 아닙니다 "
                                + "(지문 " + sealed + " ≠ " + availableFp + ").");
            }
            return key;
        }
        // Pre-V53 row carrying no fingerprint: try, and if it fails say honestly that the cause
        // cannot be narrowed rather than blaming the stored value.
        try {
            EnvelopeCipher.open(key, row.getEncryptedPayload());
            return key;
        } catch (IllegalStateException e) {
            throw new CredentialUnavailableException(CredentialKeyStatus.KEY_UNVERIFIABLE, rowKeyId,
                    "자격 증명을 열 수 없습니다. 이 자격 증명은 키 지문 기록 이전에 저장되어 키 불일치와 값 손상을 "
                            + "구분할 수 없습니다 (키 id '" + rowKeyId + "').");
        }
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

    /**
     * The active key, used for writes only. Fail closed: vault writes are unavailable until a key is
     * configured. Reads resolve through {@link #openingKey} instead — a credential must be opened
     * with the key that sealed it, which is not necessarily the one being written with today.
     */
    private byte[] masterKey() {
        return keyRing.activeKey().orElseThrow(() -> new CredentialUnavailableException(
                CredentialKeyStatus.NO_KEY_CONFIGURED, keyRing.activeKeyId(),
                "자격 증명 저장소 마스터 키가 설정되지 않았습니다 (SELLEROPS_VAULT_MASTER_KEY)."));
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
