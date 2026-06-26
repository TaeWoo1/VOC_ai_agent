package com.sellerops.common;

/**
 * Outcome of {@link VocPreviewSanitizer#sanitize(String)}. {@code text} is the
 * operator-safe preview, or {@code null} when nothing safe could be shown
 * (empty source, or so much was redacted that little real text remained). The
 * public DTO surfaces only {@code text}; {@code status} is an internal detail kept
 * for precise testing and future use.
 */
public record SafePreviewResult(String text, PreviewStatus status) {

    public enum PreviewStatus {
        /** Source was already safe — emitted unchanged (only normalized/truncated). */
        SAFE,
        /** One or more sensitive spans were replaced with fixed tokens. */
        REDACTED,
        /** Fail-closed: empty source, or too little safe text remained to show. */
        SUPPRESSED
    }

    static SafePreviewResult suppressed() {
        return new SafePreviewResult(null, PreviewStatus.SUPPRESSED);
    }
}
