package com.sellerops.credential;

import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Optional;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/**
 * The master keys this runtime can open credentials with, addressed by key id.
 *
 * <p>One active key writes; any number of keys read. That asymmetry is the whole point. Before it,
 * the vault held exactly one key and {@code encryption_key_id} was written but never consulted, so
 * changing the key silently orphaned every stored credential and the only symptom was a GCM failure
 * indistinguishable from a corrupt payload. Rotation was therefore not a supported operation — it
 * was an outage with a misleading error message.
 *
 * <p>Configuration:
 * <ul>
 *   <li>{@code sellerops.vault.key-id} — the active key id; new and rotated credentials are stamped
 *       with it.</li>
 *   <li>{@code sellerops.vault.master-key-base64} — material for the active key id. Unchanged from
 *       before, so every existing deployment keeps working with no config edit.</li>
 *   <li>{@code sellerops.vault.key-ring} — optional retired keys, as
 *       {@code id:base64,id:base64}. Read-only: present so credentials sealed under a previous key
 *       stay openable across a rotation instead of needing every seller to reconnect.</li>
 * </ul>
 *
 * <p>A single flat env var rather than a bound map because these are set from shell scripts and
 * Keychain reads; relaxed binding of a Spring map from environment variables mangles ids containing
 * hyphens, and every key id in this system has one.
 */
@Component
public class VaultKeyRing {

    static final int MASTER_KEY_LENGTH = 32;

    private final String activeKeyId;
    /** id -> material. Insertion-ordered so the active key is first when iterated. */
    private final Map<String, byte[]> keys = new LinkedHashMap<>();

    public VaultKeyRing(@Value("${sellerops.vault.master-key-base64:}") String masterKeyBase64,
                        @Value("${sellerops.vault.key-id:local-dev-1}") String activeKeyId,
                        @Value("${sellerops.vault.key-ring:}") String keyRing) {
        this.activeKeyId = activeKeyId;
        if (masterKeyBase64 != null && !masterKeyBase64.isBlank()) {
            keys.put(activeKeyId, decodeKey(masterKeyBase64, "sellerops.vault.master-key-base64"));
        }
        for (String entry : split(keyRing)) {
            int sep = entry.indexOf(':');
            if (sep <= 0 || sep == entry.length() - 1) {
                // Fail at boot, not at the first sync: a malformed ring is a config typo, and
                // discovering it when a credential fails to open is exactly the delay this class exists
                // to remove. The message names no material — only the shape that was expected.
                throw new IllegalStateException(
                        "sellerops.vault.key-ring 항목은 'keyId:base64' 형식이어야 합니다.");
            }
            String id = entry.substring(0, sep).trim();
            // The active key wins: master-key-base64 is the authoritative source for the id it names,
            // so a stale ring entry for the same id can never shadow it.
            keys.putIfAbsent(id, decodeKey(entry.substring(sep + 1).trim(), "sellerops.vault.key-ring"));
        }
    }

    /** The key id new credentials are sealed under. */
    public String activeKeyId() {
        return activeKeyId;
    }

    /** Whether any key material at all is configured. */
    public boolean isEmpty() {
        return keys.isEmpty();
    }

    /**
     * Material for {@code keyId}, or for the active key when the row named none — rows written
     * before key ids were stamped are treated as belonging to the active key, which is what they
     * were.
     */
    public Optional<byte[]> keyFor(String keyId) {
        return Optional.ofNullable(keys.get(keyId == null ? activeKeyId : keyId));
    }

    /** Material for the active key — what {@link CredentialVault#store} seals with. */
    public Optional<byte[]> activeKey() {
        return Optional.ofNullable(keys.get(activeKeyId));
    }

    /** The non-secret fingerprint of the material held for {@code keyId}, when any is. */
    public Optional<String> fingerprintFor(String keyId) {
        return keyFor(keyId).map(EnvelopeCipher::fingerprint);
    }

    /** The key ids this runtime can open with — for diagnostics. Never the material. */
    public java.util.Set<String> knownKeyIds() {
        return java.util.Collections.unmodifiableSet(keys.keySet());
    }

    private static String[] split(String raw) {
        if (raw == null || raw.isBlank()) {
            return new String[0];
        }
        return raw.split(",");
    }

    private static byte[] decodeKey(String base64, String source) {
        byte[] key;
        try {
            key = Base64.getDecoder().decode(base64.trim());
        } catch (IllegalArgumentException e) {
            throw new IllegalStateException(source + " 의 마스터 키가 올바른 base64 형식이 아닙니다.");
        }
        if (key.length != MASTER_KEY_LENGTH) {
            throw new IllegalStateException(source + " 의 마스터 키는 32바이트(AES-256)여야 합니다.");
        }
        return key;
    }
}
