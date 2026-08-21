package com.sellerops.credential;

import java.time.Instant;

/**
 * What can be said about a stored credential <b>without decrypting it</b> — the answer to
 * "why is this connection failing?" that a seller-facing troubleshooting surface can show and an
 * operator can act on.
 *
 * <p>Every field is non-secret by construction. {@code sealedKeyFingerprint} and
 * {@code availableKeyFingerprint} are one-way HMACs of master keys under a fixed label: they say
 * whether two keys are the same key, and nothing else about either. Showing them side by side is
 * what turns "복호화 실패" into "이 자격 증명은 다른 키로 봉인되어 있습니다".
 *
 * @param status                  the operational verdict
 * @param keyId                   the key id stamped on the row (null on rows that named none)
 * @param activeKeyId             the key id this runtime writes new credentials under
 * @param sealedKeyFingerprint    fingerprint recorded when the row was sealed (null before V53)
 * @param availableKeyFingerprint fingerprint of the material this runtime holds for {@code keyId}
 * @param lastRotatedAt           when the stored secret was last written
 * @param tokenExpiresAt          the credential's own expiry, when known
 * @param remedy                  the specific next action, in seller/operator language
 */
public record CredentialDiagnosis(
        CredentialKeyStatus status,
        String keyId,
        String activeKeyId,
        String sealedKeyFingerprint,
        String availableKeyFingerprint,
        Instant lastRotatedAt,
        Instant tokenExpiresAt,
        String remedy) {

    public boolean openable() {
        return status == CredentialKeyStatus.OK;
    }
}
