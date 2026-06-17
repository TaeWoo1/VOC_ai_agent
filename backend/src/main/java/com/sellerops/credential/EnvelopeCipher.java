package com.sellerops.credential;

import java.nio.ByteBuffer;
import java.security.GeneralSecurityException;
import java.security.SecureRandom;
import javax.crypto.Cipher;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;

/**
 * AES-256-GCM envelope encryption with a self-contained binary envelope:
 *
 * <pre>[version:1][dekIv:12][wrappedDek:48][payloadIv:12][ciphertext:n]</pre>
 *
 * A fresh random 256-bit DEK encrypts the payload; the master key only wraps the
 * DEK. Both layers are GCM (128-bit tag), so any tampering — with the wrapped
 * key or the ciphertext — fails authentication on open. Every length is fixed
 * except the ciphertext, so the format needs no length prefixes.
 *
 * <p>Stateless and key-agnostic: the master key is passed per call (the vault
 * owns configuration). Swapping the local master key for a KMS-wrapped one later
 * changes only the caller, not the envelope format.
 */
final class EnvelopeCipher {

    static final byte VERSION = 1;
    private static final int IV_LENGTH = 12;
    private static final int DEK_LENGTH = 32;
    private static final int GCM_TAG_BITS = 128;
    private static final int WRAPPED_DEK_LENGTH = DEK_LENGTH + GCM_TAG_BITS / 8;
    private static final int HEADER_LENGTH = 1 + IV_LENGTH + WRAPPED_DEK_LENGTH + IV_LENGTH;
    private static final String TRANSFORMATION = "AES/GCM/NoPadding";

    private static final SecureRandom RANDOM = new SecureRandom();

    private EnvelopeCipher() {
    }

    /** Encrypt {@code plaintext} under a fresh DEK wrapped by {@code masterKey}. */
    static byte[] seal(byte[] masterKey, byte[] plaintext) {
        try {
            byte[] dek = new byte[DEK_LENGTH];
            RANDOM.nextBytes(dek);
            byte[] dekIv = randomIv();
            byte[] wrappedDek = gcm(Cipher.ENCRYPT_MODE, masterKey, dekIv, dek);
            byte[] payloadIv = randomIv();
            byte[] ciphertext = gcm(Cipher.ENCRYPT_MODE, dek, payloadIv, plaintext);

            return ByteBuffer.allocate(HEADER_LENGTH + ciphertext.length)
                    .put(VERSION)
                    .put(dekIv)
                    .put(wrappedDek)
                    .put(payloadIv)
                    .put(ciphertext)
                    .array();
        } catch (GeneralSecurityException e) {
            throw new IllegalStateException("자격 증명 암호화에 실패했습니다.", e);
        }
    }

    /** Decrypt an envelope produced by {@link #seal}; fails on any tampering. */
    static byte[] open(byte[] masterKey, byte[] envelope) {
        if (envelope == null || envelope.length <= HEADER_LENGTH) {
            throw new IllegalStateException("자격 증명 데이터 형식이 올바르지 않습니다.");
        }
        ByteBuffer buf = ByteBuffer.wrap(envelope);
        byte version = buf.get();
        if (version != VERSION) {
            throw new IllegalStateException("지원되지 않는 자격 증명 암호화 버전입니다: " + version);
        }
        byte[] dekIv = take(buf, IV_LENGTH);
        byte[] wrappedDek = take(buf, WRAPPED_DEK_LENGTH);
        byte[] payloadIv = take(buf, IV_LENGTH);
        byte[] ciphertext = take(buf, buf.remaining());
        try {
            byte[] dek = gcm(Cipher.DECRYPT_MODE, masterKey, dekIv, wrappedDek);
            return gcm(Cipher.DECRYPT_MODE, dek, payloadIv, ciphertext);
        } catch (GeneralSecurityException e) {
            throw new IllegalStateException("자격 증명 복호화에 실패했습니다.", e);
        }
    }

    /** The payload IV of an envelope — informational copy for the {@code iv} column. */
    static byte[] payloadIv(byte[] envelope) {
        byte[] iv = new byte[IV_LENGTH];
        ByteBuffer.wrap(envelope, 1 + IV_LENGTH + WRAPPED_DEK_LENGTH, IV_LENGTH).get(iv);
        return iv;
    }

    private static byte[] gcm(int mode, byte[] key, byte[] iv, byte[] data) throws GeneralSecurityException {
        Cipher cipher = Cipher.getInstance(TRANSFORMATION);
        cipher.init(mode, new SecretKeySpec(key, "AES"), new GCMParameterSpec(GCM_TAG_BITS, iv));
        return cipher.doFinal(data);
    }

    private static byte[] randomIv() {
        byte[] iv = new byte[IV_LENGTH];
        RANDOM.nextBytes(iv);
        return iv;
    }

    private static byte[] take(ByteBuffer buf, int length) {
        byte[] out = new byte[length];
        buf.get(out);
        return out;
    }
}
