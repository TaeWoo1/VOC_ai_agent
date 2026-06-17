package com.sellerops.common;

import java.util.regex.Pattern;

/**
 * Masks obvious customer PII (phone, email) in free text shown on customer-facing
 * surfaces (currently the inbox snippet). Display-boundary only: the raw source
 * text is preserved in the database for future evidence/RAG. Full-token
 * replacement is used so no prefix leaks.
 *
 * <p>Deliberately conservative — narrow, phone/email-shaped patterns only. It does
 * not mask Korean addresses, free-text names, or generic long digit runs (order
 * numbers, measurements, prices like {@code 5,000원} / {@code 30mm}), which would
 * produce false positives. {@link #maskName(String)} is provided for a future
 * author-display surface but is not applied to body text.
 */
public final class PiiMasker {

    private static final String PHONE_TOKEN = "[전화번호]";
    private static final String EMAIL_TOKEN = "[이메일]";

    private static final Pattern EMAIL =
            Pattern.compile("[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}");

    // Korean mobile: 010/011/016/017/018/019 with optional - . or space separators.
    private static final Pattern MOBILE =
            Pattern.compile("01[016789][-.\\s]?\\d{3,4}[-.\\s]?\\d{4}");

    // Landline: leading-0 area code (1-2 digits) + 3-4 + 4, optional separators.
    // Runs after MOBILE so 01x numbers are already tokenized.
    private static final Pattern LANDLINE =
            Pattern.compile("0\\d{1,2}[-.\\s]?\\d{3,4}[-.\\s]?\\d{4}");

    private PiiMasker() {
    }

    /** Replace email then phone (mobile, landline) with full tokens. Null/blank safe. */
    public static String maskText(String text) {
        if (text == null || text.isBlank()) {
            return text;
        }
        String out = EMAIL.matcher(text).replaceAll(EMAIL_TOKEN);
        out = MOBILE.matcher(out).replaceAll(PHONE_TOKEN);
        out = LANDLINE.matcher(out).replaceAll(PHONE_TOKEN);
        return out;
    }

    /**
     * Partially mask a personal name: keep the first character, replace the rest
     * with asterisks (홍길동 → 홍**, 김민 → 김*). Single char / null / blank returned
     * unchanged. Not wired to inbox body snippets — reserved for author display.
     */
    public static String maskName(String name) {
        if (name == null || name.isBlank() || name.length() == 1) {
            return name;
        }
        return name.charAt(0) + "*".repeat(name.length() - 1);
    }
}
