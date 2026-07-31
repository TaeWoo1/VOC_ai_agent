package com.sellerops.connector.cafe24.spike;

import java.util.regex.Pattern;

/**
 * The fixed, non-identifying spike comment identity plus a defensive validator for
 * operator-supplied comment text. The spike must never post anything that looks like
 * personal data: the default is a fixed harmless test phrase, and any operator-typed
 * override is rejected fail-closed if it carries an e-mail, a phone/order-number-like
 * digit run, or is empty/oversized.
 *
 * <p>The writer is a fixed service display name (not a customer or staff identity),
 * so a re-run can recognise its own prior comment for duplicate protection without
 * ever reading an arbitrary customer's writer value into a result.
 */
public final class SpikeContentGuard {

    /**
     * Fixed, non-identifying writer marker for spike comments. Used both as the
     * {@code writer} on the POST and as the duplicate-detection marker on re-run.
     * It is a service label, never a person.
     */
    public static final String SPIKE_WRITER_MARKER = "SellerOps 연결점검";

    /**
     * Default harmless test comment body — no PII, no order number, no contact, and
     * explicitly self-identifying as a capability test rather than a real answer.
     */
    public static final String FIXED_TEST_CONTENT =
            "[SellerOps 연결 점검] 문의 답변 API 동작 확인용 테스트 댓글입니다. 실제 고객 문의에 대한 답변이 아닙니다.";

    /** e-mail-ish. */
    private static final Pattern EMAIL = Pattern.compile("[^\\s@]+@[^\\s@]+");
    /** Everything that is not a digit — stripped before counting a phone/order run. */
    private static final Pattern NON_DIGIT = Pattern.compile("\\D");
    /** 7+ digits (after removing separators) — phone / order / member-number shaped. */
    private static final int MAX_DIGITS = 6;
    private static final int MAX_LENGTH = 500;

    private SpikeContentGuard() {
    }

    /**
     * Resolve the comment body for a command. FIXED source → the fixed phrase.
     * OPERATOR source → the operator text, validated fail-closed.
     *
     * @throws SpikeContentRejectedException if operator text is blank, too long, or
     *     carries e-mail / long-digit-run shaped material
     */
    public static String resolveContent(SpikeReplyCommand.ContentSource source, String operatorContent) {
        if (source == SpikeReplyCommand.ContentSource.FIXED) {
            return FIXED_TEST_CONTENT;
        }
        String text = operatorContent == null ? "" : operatorContent.strip();
        if (text.isEmpty()) {
            throw new SpikeContentRejectedException("EMPTY");
        }
        if (text.length() > MAX_LENGTH) {
            throw new SpikeContentRejectedException("TOO_LONG");
        }
        if (EMAIL.matcher(text).find()) {
            throw new SpikeContentRejectedException("LOOKS_LIKE_EMAIL");
        }
        // Strip separators first so a hyphenated/spaced number (010-1234-5678) still trips.
        if (NON_DIGIT.matcher(text).replaceAll("").length() > MAX_DIGITS) {
            throw new SpikeContentRejectedException("LOOKS_LIKE_CONTACT_OR_ORDER_NUMBER");
        }
        return text;
    }

    /** Raised when operator comment text fails the fail-closed PII/shape check. */
    public static final class SpikeContentRejectedException extends RuntimeException {
        private final String reasonCode;

        public SpikeContentRejectedException(String reasonCode) {
            // The message carries only the coarse reason code — never the rejected text.
            super("SPIKE_CONTENT_REJECTED:" + reasonCode);
            this.reasonCode = reasonCode;
        }

        public String reasonCode() {
            return reasonCode;
        }
    }
}
