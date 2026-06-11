package com.sellerops.credential;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;
import java.util.Arrays;
import org.junit.jupiter.api.Test;

/** Slice 5: envelope format round-trip and fail-closed behavior on any tampering. */
class EnvelopeCipherTest {

    private final byte[] masterKey = randomKey();
    private final byte[] plaintext = "{\"accessKey\":\"AK-123\",\"secretKey\":\"SK-456\"}"
            .getBytes(StandardCharsets.UTF_8);

    private static byte[] randomKey() {
        byte[] key = new byte[32];
        new SecureRandom().nextBytes(key);
        return key;
    }

    @Test
    void sealOpenRoundTrip() {
        byte[] envelope = EnvelopeCipher.seal(masterKey, plaintext);
        assertThat(EnvelopeCipher.open(masterKey, envelope)).isEqualTo(plaintext);
    }

    @Test
    void everySealUsesAFreshDekAndIv() {
        byte[] first = EnvelopeCipher.seal(masterKey, plaintext);
        byte[] second = EnvelopeCipher.seal(masterKey, plaintext);
        assertThat(first).isNotEqualTo(second); // random DEK + IVs → no two envelopes match
        assertThat(EnvelopeCipher.payloadIv(first)).isNotEqualTo(EnvelopeCipher.payloadIv(second));
        // The plaintext never appears in the envelope.
        assertThat(indexOf(first, plaintext)).isEqualTo(-1);
    }

    @Test
    void tamperedCiphertextFailsToOpen() {
        byte[] envelope = EnvelopeCipher.seal(masterKey, plaintext);
        envelope[envelope.length - 1] ^= 0x01; // flip one ciphertext bit
        assertThatThrownBy(() -> EnvelopeCipher.open(masterKey, envelope))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("복호화");
    }

    @Test
    void tamperedWrappedKeyFailsToOpen() {
        byte[] envelope = EnvelopeCipher.seal(masterKey, plaintext);
        envelope[20] ^= 0x01; // inside the wrapped DEK region
        assertThatThrownBy(() -> EnvelopeCipher.open(masterKey, envelope))
                .isInstanceOf(IllegalStateException.class);
    }

    @Test
    void wrongMasterKeyFailsToOpen() {
        byte[] envelope = EnvelopeCipher.seal(masterKey, plaintext);
        assertThatThrownBy(() -> EnvelopeCipher.open(randomKey(), envelope))
                .isInstanceOf(IllegalStateException.class);
    }

    @Test
    void truncatedOrNullEnvelopeFailsCleanly() {
        byte[] envelope = EnvelopeCipher.seal(masterKey, plaintext);
        byte[] truncated = Arrays.copyOf(envelope, 40);
        assertThatThrownBy(() -> EnvelopeCipher.open(masterKey, truncated))
                .isInstanceOf(IllegalStateException.class);
        assertThatThrownBy(() -> EnvelopeCipher.open(masterKey, null))
                .isInstanceOf(IllegalStateException.class);
    }

    @Test
    void unsupportedVersionIsRejected() {
        byte[] envelope = EnvelopeCipher.seal(masterKey, plaintext);
        envelope[0] = 9;
        assertThatThrownBy(() -> EnvelopeCipher.open(masterKey, envelope))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("버전");
    }

    private static int indexOf(byte[] haystack, byte[] needle) {
        outer:
        for (int i = 0; i <= haystack.length - needle.length; i++) {
            for (int j = 0; j < needle.length; j++) {
                if (haystack[i + j] != needle[j]) {
                    continue outer;
                }
            }
            return i;
        }
        return -1;
    }
}
