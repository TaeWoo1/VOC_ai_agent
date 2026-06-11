package com.sellerops.ingest;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.text.Normalizer;
import java.util.Arrays;
import java.util.stream.Collectors;

/** Stable content fingerprint for dedup when a source carries no external id. */
public final class ContentHash {

    private ContentHash() {
    }

    /** sha256 hex of the normalized, "|"-joined parts (NFC + lowercase + collapsed whitespace). */
    public static String of(String... parts) {
        String joined = Arrays.stream(parts)
                .map(ContentHash::normalize)
                .collect(Collectors.joining("|"));
        try {
            MessageDigest md = MessageDigest.getInstance("SHA-256");
            byte[] digest = md.digest(joined.getBytes(StandardCharsets.UTF_8));
            StringBuilder sb = new StringBuilder(digest.length * 2);
            for (byte b : digest) {
                sb.append(Character.forDigit((b >> 4) & 0xF, 16));
                sb.append(Character.forDigit(b & 0xF, 16));
            }
            return sb.toString();
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException("SHA-256 unavailable", e);
        }
    }

    private static String normalize(String s) {
        if (s == null) {
            return "";
        }
        String n = Normalizer.normalize(s, Normalizer.Form.NFC);
        return n.strip().toLowerCase().replaceAll("\\s+", " ");
    }
}
