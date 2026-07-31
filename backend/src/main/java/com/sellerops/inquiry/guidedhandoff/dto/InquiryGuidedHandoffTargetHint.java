package com.sellerops.inquiry.guidedhandoff.dto;

/**
 * The PRIVACY-SAFE locating hint a Guided Handoff returns so the operator can find the
 * exact inquiry on the Cafe24 admin themselves. It carries only the seller's own,
 * non-buyer facts needed to locate the board article:
 *
 * <ul>
 *   <li>{@code channelCode} — the channel (e.g. {@code CAFE24});</li>
 *   <li>{@code boardNo} / {@code boardLabel} — the board (6 / 문의사항);</li>
 *   <li>{@code articleNo} — the mall's own board-article number (a locating id, not buyer PII);</li>
 *   <li>{@code productRef} — the product sku/ref the inquiry is about, when known;</li>
 *   <li>{@code recencyBucket} — a coarse KST date-only bucket of the created date, never a raw timestamp;</li>
 *   <li>{@code status} / {@code informStatus} — the canonical + raw reply status, verbatim.</li>
 * </ul>
 *
 * <p>It NEVER carries the inquiry title/body, writer/member/email/IP/order identifiers,
 * the mall id, or any token — those never cross this boundary or reach a log.
 */
public record InquiryGuidedHandoffTargetHint(
        String channelCode,
        int boardNo,
        String boardLabel,
        long articleNo,
        String productRef,
        String recencyBucket,
        String status,
        String informStatus) {
}
