package com.sellerops.common;

import com.sellerops.common.SafePreviewResult.PreviewStatus;
import java.text.Normalizer;
import java.util.List;
import java.util.regex.Pattern;

/**
 * Deterministic, read-time redactor for raw VOC text (a review/inquiry title or body).
 * Channel-generic and fail-closed: it takes plain text only (no channel logic) and, when in
 * doubt, redacts rather than emit risky content.
 *
 * <p>Conservative by design and <b>not</b> a guarantee of perfect PII removal. It
 * reuses {@link PiiMasker} for phone/email and adds URLs, resident-registration /
 * card / bank-like numbers, long numeric IDs, messenger handles, token/secret-like
 * blobs, file paths, and a narrow Korean-address heuristic. Each match becomes a
 * fixed {@code [...]} token. Pure: no DB, no clock, no logging of the input.
 *
 * <p><b>Two entry points over one rule set</b>, differing only in what they do after
 * redacting:
 *
 * <ul>
 *   <li>{@link #sanitize(String)} — the <b>preview</b>: one line, 60 characters, suppressed
 *       entirely when too little real text survives. For a list row, where the operator is
 *       recognising an item rather than reading it, and where showing nothing costs them
 *       nothing.
 *   <li>{@link #redactFullBody(String)} — the <b>whole body</b>: no truncation, no
 *       suppression, line structure preserved. For the reply-preparation surface, where the
 *       operator must actually read the complaint to answer it.
 * </ul>
 *
 * <p>Both run the identical {@link #redact} pipeline over identically-shaped input, and both
 * halves of that matter. Sharing {@code redact} alone is NOT enough to make them agree: what
 * gets redacted is a function of {@code redact} ∘ normalization, and several patterns admit
 * only a single separator character, so a path that left a two-character whitespace run in
 * place would silently redact less while appearing to share every rule. That is why
 * {@link #normalizeForRedaction} is shared too, and why it guarantees no whitespace run
 * reaches {@code redact} longer than one character. The two paths may differ on presentation
 * — one line vs many — never on how much whitespace {@code redact} sees.
 *
 * <p><b>Why full-body exposure is not a hole in the preview's fail-closed rule.</b> The
 * preview's suppression is a <i>display</i> judgement — a 60-character snippet that is
 * mostly {@code [번호]} tells the operator nothing, so it shows nothing. It was never a
 * claim that the redacted text is unsafe to show; the redaction is what makes it safe, and
 * the redaction is the same here. Product scope v1.4 records the seller-facing exception
 * (§9) that authorizes this surface; the collector's sanitized-output contract is untouched
 * and is a different rule about a different boundary.
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

    /**
     * A whitespace run, Unicode-aware.
     *
     * <p>{@code (?U)} is load-bearing, not decoration. Java's bare {@code \s} is
     * {@code [ \t\n\x0B\f\r]} — ASCII only — so a non-breaking space (U+00A0), an ideographic
     * space (U+3000), or a narrow NBSP (U+202F) is not whitespace to it and survives
     * normalization untouched. None of those are exotic: they are what arrives when a customer
     * pastes from a web page or a word processor, or types on a CJK IME. And they defeat the
     * redaction patterns exactly as a two-character run does, because {@code [-.\s]?} does not
     * match them either — {@code 010<NBSP>1234<NBSP>5678} went through completely unredacted.
     *
     * <p>{@code (?U)} makes {@code \s} mean Unicode {@code White_Space}, which covers all three.
     * This was a pre-existing gap in the preview, not something the full-body path introduced —
     * both paths shared it, which is precisely why comparing them could not reveal it.
     *
     * <p>Still not airtight, and the class note above already says so rather than promising
     * otherwise: zero-width characters (U+200B, U+FEFF) are not {@code White_Space} under any
     * flag, so they remain a way to split a digit run. That is a separate, older evasion than
     * the one this pattern closes.
     */
    private static final Pattern WS = Pattern.compile("(?U)\\s+");
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

    /**
     * Normalize raw VOC text so it is safe to hand to {@link #redact}.
     *
     * <p><b>The one-whitespace-character rule is part of the redaction contract, not
     * formatting.</b> Several patterns admit at most a SINGLE separator between digit groups
     * — {@code PiiMasker.MOBILE} is {@code 01[016789][-.\s]?\d{3,4}[-.\s]?\d{4}},
     * {@link #CARD} is {@code \d{4}[-\s]\d{4}…} — so any whitespace RUN of two or more
     * characters reaching {@link #redact} silently defeats them. A trailing space before a
     * line break is two characters, and it is ordinary in typed review text: a body
     * containing {@code "010 \n1234 \n5678"} would pass through completely unredacted.
     *
     * <p>So every whitespace run collapses to exactly one character here, and both entry
     * points go through this method. They differ only in WHICH character survives — never in
     * how many — which is what lets them share {@link #redact} and actually agree about what
     * is sensitive, rather than merely appear to.
     *
     * <p>{@code preserveLineBreaks=false} (the preview) flattens everything to spaces: a
     * snippet is one line. {@code true} (the full body) keeps a run that contained a newline
     * as a single {@code \n}, so the operator still sees where the lines broke.
     *
     * <p><b>What that costs, stated rather than hidden:</b> with {@code true}, a blank line
     * (a run of two newlines) also collapses to one, so paragraph spacing is lost and
     * consecutive lines sit flush. That is deliberate. Preserving {@code \n\n} would put a
     * two-character run back in front of {@link #redact} and reopen the hole above for any
     * body whose sensitive span happens to straddle a paragraph break — trading a real leak
     * for cosmetics. Line structure survives; only its spacing does not.
     *
     * <p>Not lowercased: the output is human text, and the case-insensitive patterns carry
     * their own {@code (?i)}.
     */
    private static String normalizeForRedaction(String raw, boolean preserveLineBreaks) {
        String nfc = Normalizer.normalize(raw, Normalizer.Form.NFC).strip();
        return WS.matcher(nfc).replaceAll(match ->
                preserveLineBreaks && match.group().indexOf('\n') >= 0 ? "\n" : " ");
    }

    /** Sanitize raw title/content into an operator-safe preview (or suppress it). */
    public static SafePreviewResult sanitize(String raw) {
        if (raw == null || raw.isBlank()) {
            return SafePreviewResult.suppressed();
        }
        String normalized = normalizeForRedaction(raw, false);

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

    /**
     * Redact a whole VOC body for a surface that must display all of it — the same rules as
     * {@link #sanitize}, without the preview's truncation or suppression.
     *
     * <p>Line structure is preserved (see {@link #normalizeForRedaction}); everything else about the
     * redaction is identical, because it is literally the same {@link #redact} call.
     *
     * <p>Never suppresses on thinness. A body that redacts down to almost nothing still
     * comes back, because the operator is answering this review either way and a
     * silently-empty panel would tell them the review is empty rather than that it was
     * mostly sensitive. {@link RedactedBody#redacted()} is how the surface says so out loud.
     * The one null case is a null/blank source: nothing in, nothing out.
     */
    public static RedactedBody redactFullBody(String raw) {
        if (raw == null || raw.isBlank()) {
            return RedactedBody.empty();
        }
        // Same normalization as the preview, differing only in which single character a
        // whitespace run collapses to — see normalizeForRedaction. CR/CRLF fold into \n first
        // so a Windows line ending is one run, not a run plus a stray \r.
        String normalized = normalizeForRedaction(
                raw.replace("\r\n", "\n").replace("\r", "\n"), true);
        if (normalized.isEmpty()) {
            return RedactedBody.empty();
        }

        String redacted = redact(normalized);
        return new RedactedBody(redacted, !redacted.equals(normalized));
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
