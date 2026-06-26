package com.sellerops.common;

import com.sellerops.common.SafePreviewResult.PreviewStatus;
import java.text.Normalizer;
import java.util.List;
import java.util.regex.Pattern;

/**
 * Deterministic, read-time redactor that turns raw VOC text (a review/inquiry
 * title or body) into a short operator preview — or nothing. Channel-generic and
 * fail-closed: it takes plain text only (no channel logic) and, when in doubt,
 * suppresses rather than emit risky content.
 *
 * <p>Conservative by design and <b>not</b> a guarantee of perfect PII removal. It
 * reuses {@link PiiMasker} for phone/email and adds URLs, resident-registration /
 * card / bank-like numbers, long numeric IDs, messenger handles, token/secret-like
 * blobs, file paths, and a narrow Korean-address heuristic. Each match becomes a
 * fixed {@code [...]} token; if the surviving non-token text is too short, the whole
 * preview is suppressed. Pure: no DB, no clock, no logging of the input.
 */
public final class VocPreviewSanitizer {

    /** Max preview length before an ellipsis is appended (matches the inbox snippet). */
    static final int MAX_LEN = 60;
    /** Below this many visible (non-token) characters, the preview is suppressed. */
    static final int MIN_VISIBLE = 4;
    private static final String ELLIPSIS = "…";

    private static final String T_LINK = "[링크]";
    private static final String T_RRN = "[민감정보]";
    private static final String T_NUMBER = "[번호]";
    private static final String T_CONTACT = "[연락처]";
    private static final String T_SECRET = "[보안정보]";
    private static final String T_PATH = "[경로]";
    private static final String T_ADDRESS = "[주소]";

    /** Every fixed token (incl. PiiMasker's), used to measure surviving visible text. */
    private static final List<String> TOKENS = List.of(
            T_LINK, "[이메일]", "[전화번호]", T_RRN, T_NUMBER, T_CONTACT, T_SECRET, T_PATH, T_ADDRESS);

    private static final Pattern WS = Pattern.compile("\\s+");
    // Scheme/www URLs and Kakao open-chat links (run before generic patterns).
    private static final Pattern URL = Pattern.compile("(?i)(?:https?://|www\\.)\\S+");
    // Resident registration number (6-7), dashed.
    private static final Pattern RRN = Pattern.compile("\\d{6}-\\d{7}");
    // Card: four groups of four digits.
    private static final Pattern CARD = Pattern.compile("\\d{4}[-\\s]\\d{4}[-\\s]\\d{4}[-\\s]\\d{4}");
    // Bank-account-like: dash-separated digit groups (after phone/card are gone).
    private static final Pattern ACCOUNT = Pattern.compile("\\d{2,6}-\\d{2,6}-\\d{2,7}(?:-\\d{1,7})?");
    // Messenger / social handles: a keyword (longest-first) plus an optional ASCII
    // handle that follows it (so "카카오톡 shopcs2026" is caught, but a Korean particle
    // like "으로" after it is not).
    private static final Pattern MESSENGER = Pattern.compile(
            "(?i)(?:카카오톡|카카오|카톡|오픈채팅|오픈\\s*채팅|open\\.?kakao|kakao)"
                    + "(?:\\s*(?:id|아이디|톡)?[:：]?\\s*[A-Za-z0-9._-]{3,})?");
    private static final Pattern HANDLE = Pattern.compile("@[A-Za-z0-9_]{3,}");
    // Windows / unix file paths and known download filenames.
    private static final Pattern WIN_PATH = Pattern.compile("[A-Za-z]:\\\\\\S+");
    private static final Pattern UNIX_PATH = Pattern.compile("/[\\w.-]+(?:/[\\w.-]+)+");
    private static final Pattern FILENAME =
            Pattern.compile("(?i)\\b[\\w-]+\\.(?:xlsx?|csv|pdf|png|jpe?g|zip|docx?|txt|html?)\\b");
    // Standalone long numeric IDs (order/customer/tracking/article/product numbers).
    private static final Pattern LONG_NUMBER = Pattern.compile("(?<!\\d)\\d{7,}(?!\\d)");
    // Token / secret / ciphertext-like blobs: long mixed base64/hex runs.
    private static final Pattern SECRET =
            Pattern.compile("(?<![A-Za-z0-9+/])[A-Za-z0-9+/]{20,}={0,2}(?![A-Za-z0-9+/])");
    // Narrow Korean address: a 시/도/구/군 prefix, optional intermediate words, then a
    // road/region word + number. Specific enough to avoid mangling ordinary sentences.
    private static final Pattern ADDRESS = Pattern.compile(
            "[가-힣]+(?:시|도|구|군)(?:\\s+[가-힣]+)*\\s+[가-힣]+(?:로|길|동|읍|면|리)\\s*\\d+(?:번지|번길|-\\d+)?");

    private VocPreviewSanitizer() {
    }

    /** Sanitize raw title/content into an operator-safe preview (or suppress it). */
    public static SafePreviewResult sanitize(String raw) {
        if (raw == null || raw.isBlank()) {
            return SafePreviewResult.suppressed();
        }
        // NFC + collapse whitespace; intentionally NOT lowercased (preview is human text).
        String normalized = WS.matcher(Normalizer.normalize(raw, Normalizer.Form.NFC).strip())
                .replaceAll(" ");

        String redacted = redact(normalized);

        // Fail-closed: if the surviving non-token text is too thin, show nothing.
        String visible = stripTokens(redacted);
        if (visible.length() < MIN_VISIBLE) {
            return SafePreviewResult.suppressed();
        }

        String preview = truncate(redacted);
        PreviewStatus status = redacted.equals(normalized) ? PreviewStatus.SAFE : PreviewStatus.REDACTED;
        return new SafePreviewResult(preview, status);
    }

    private static String redact(String s) {
        String out = URL.matcher(s).replaceAll(T_LINK);
        // Structured numerics first, before PiiMasker's phone pattern can eat a sub-span.
        out = RRN.matcher(out).replaceAll(T_RRN);
        out = CARD.matcher(out).replaceAll(T_NUMBER);
        out = PiiMasker.maskText(out);                 // email + phone (mobile, landline)
        out = ACCOUNT.matcher(out).replaceAll(T_NUMBER);
        out = MESSENGER.matcher(out).replaceAll(T_CONTACT);
        out = HANDLE.matcher(out).replaceAll(T_CONTACT);
        out = WIN_PATH.matcher(out).replaceAll(T_PATH);
        out = UNIX_PATH.matcher(out).replaceAll(T_PATH);
        out = FILENAME.matcher(out).replaceAll(T_PATH);
        // Secret/ciphertext blobs before generic digit runs (a blob contains digits).
        out = SECRET.matcher(out).replaceAll(T_SECRET);
        out = LONG_NUMBER.matcher(out).replaceAll(T_NUMBER);
        out = ADDRESS.matcher(out).replaceAll(T_ADDRESS);
        return out;
    }

    /** Remove all fixed tokens, then collapse whitespace — what real text survived. */
    private static String stripTokens(String s) {
        String out = s;
        for (String token : TOKENS) {
            out = out.replace(token, " ");
        }
        return WS.matcher(out).replaceAll(" ").strip();
    }

    private static String truncate(String s) {
        return s.length() <= MAX_LEN ? s : s.substring(0, MAX_LEN) + ELLIPSIS;
    }
}
