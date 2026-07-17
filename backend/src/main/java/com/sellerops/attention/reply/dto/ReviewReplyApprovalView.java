package com.sellerops.attention.reply.dto;

import java.time.Instant;

/**
 * The current approval, or absent entirely when the operator has never approved this review's
 * draft. Never-approved is the absence of this object, not a state on it — the same
 * distinction the attention surface draws between a null {@code triageDisposition} and
 * {@code NO_ACTION}.
 *
 * <p>{@code approvedVersion}/{@code approvedFingerprint} are non-null exactly when
 * {@code state} is {@code APPROVED}.
 *
 * <p><b>{@code approvedBody} is the ONLY copyable text on the wire</b>, and it is present only
 * when {@code capabilities.canCopy} is true. The server serves it from the approved version
 * rather than letting the client pick a body to copy: a client that assembled its own copy
 * text could copy an unsaved editor buffer that no one approved, and the clipboard's next stop
 * is a public marketplace reply.
 *
 * <p>Withholding it when copying is not allowed is a contract measure, not a secrecy one —
 * while an approval stands the same text is also visible as the head draft's body, so nothing
 * is hidden from the operator. What it buys is that "copy the approved head" is the only
 * behaviour a client can express: there is no second body to reach for, so a client cannot
 * drift into copying whatever happens to be in the box.
 */
public record ReviewReplyApprovalView(
        String state,
        Integer approvedVersion,
        String approvedFingerprint,
        String approvedBody,
        Instant decidedAt) {
}
