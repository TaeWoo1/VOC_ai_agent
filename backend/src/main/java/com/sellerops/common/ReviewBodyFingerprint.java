package com.sellerops.common;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.text.Normalizer;
import java.util.HexFormat;
import java.util.regex.Pattern;

/**
 * {@code review-body-fingerprint/v1} — the backend half of the shared review-body fingerprint.
 *
 * <p>A deterministic, one-way fingerprint of a review body, byte-identical to the collector's
 * {@code review-body-fingerprint.ts}, proven by the shared
 * {@code contracts/review-fingerprint/v1/golden-vectors.json}. It is <b>not</b> the display redactor
 * ({@link VocPreviewSanitizer}) and <b>not</b> the reply-draft fingerprint
 * ({@link com.sellerops.attention.reply.ReviewReplyFingerprint}, {@code review-reply-v1}, which hashes the
 * operator's reply). This contract <b>owns its own regexes</b> — it does not reuse {@link PiiMasker} — so the
 * fingerprint can never drift when display redaction changes. Pure: no clock, no I/O, never logs its input.
 * See {@code contracts/review-fingerprint/v1/SPEC.md}.
 */
public final class ReviewBodyFingerprint {

    // Explicit Unicode White_Space class — pinned literally rather than (?U)\s, because Java (?U)\s (which
    // includes U+0085) and JS \s (which includes U+FEFF) disagree and would silently diverge the two sides.
    // U+FEFF and zero-width U+200B are deliberately excluded, matching (?U)\s.
    private static final Pattern WHITESPACE =
            Pattern.compile("[\\t\\n\\x0B\\f\\r \\x85\\xA0\\u1680\\u2000-\\u200A\\u2028\\u2029\\u202F\\u205F\\u3000]+");
    // Spec-owned volatile-span patterns (order-sensitive — see SPEC.md). After the collapse step the only
    // whitespace is a single ASCII space, so [^ ]+ and the [-. ]? separators are cross-language trivial.
    private static final Pattern URL = Pattern.compile("(?i)(?:https?://|www\\.)[^ ]+");
    private static final Pattern EMAIL = Pattern.compile("[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}");
    private static final Pattern MOBILE = Pattern.compile("01[016789][-. ]?\\d{3,4}[-. ]?\\d{4}");
    private static final Pattern LANDLINE = Pattern.compile("0\\d{1,2}[-. ]?\\d{3,4}[-. ]?\\d{4}");
    private static final Pattern LONG_NUMBER = Pattern.compile("(?<!\\d)\\d{7,}(?!\\d)");

    private static final String T_LINK = "[링크]";
    private static final String T_EMAIL = "[이메일]";
    private static final String T_PHONE = "[전화번호]";
    private static final String T_NUMBER = "[번호]";

    private ReviewBodyFingerprint() {
    }

    /** Steps 1–5 of the spec: NFC → CRLF→\n → collapse → trim → tokenize volatile spans. Null/blank safe. */
    public static String normalizeForFingerprint(String raw) {
        if (raw == null) {
            return "";
        }
        String s = Normalizer.normalize(raw, Normalizer.Form.NFC);
        s = s.replace("\r\n", "\n").replace("\r", "\n");
        s = WHITESPACE.matcher(s).replaceAll(" ");
        if (s.startsWith(" ")) {
            s = s.substring(1);
        }
        if (s.endsWith(" ")) {
            s = s.substring(0, s.length() - 1);
        }
        s = URL.matcher(s).replaceAll(T_LINK);
        s = EMAIL.matcher(s).replaceAll(T_EMAIL);
        s = MOBILE.matcher(s).replaceAll(T_PHONE);
        s = LANDLINE.matcher(s).replaceAll(T_PHONE);
        s = LONG_NUMBER.matcher(s).replaceAll(T_NUMBER);
        return s;
    }

    /** Step 6: SHA-256 of the UTF-8 normalized form → lowercase hex (64). A one-way fingerprint, never the text. */
    public static String of(String raw) {
        try {
            MessageDigest md = MessageDigest.getInstance("SHA-256");
            byte[] hash = md.digest(normalizeForFingerprint(raw).getBytes(StandardCharsets.UTF_8));
            return HexFormat.of().formatHex(hash);
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException("SHA-256 unavailable", e);
        }
    }
}
