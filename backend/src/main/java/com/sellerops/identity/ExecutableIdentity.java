package com.sellerops.identity;

/**
 * Whether a stored inquiry or review is an object reviewnary could act on AT ITS CHANNEL — as opposed
 * to a record it merely holds.
 *
 * <p>Closed on purpose, and derived from acquisition provenance only ({@link ExecutableIdentityResolver}).
 * A channel label is not identity: a CSV whose first column says NAVER and whose ids look like
 * {@code naver-qna:123} is still a file somebody typed, and nothing downstream may send an answer to
 * a marketplace on the strength of it. {@code NONE} is the default and the answer to every doubt.
 */
public enum ExecutableIdentity {

    /**
     * The row was written by a trusted marketplace/API acquisition, is bound to exactly one API-mode
     * seller account of its org, and carries the provider's own object identity. The channel adapters
     * may target it — subject to every gate they already apply ({@code PreSendCheck} stays the backstop).
     */
    MARKETPLACE,

    /**
     * Anything else: a manual upload, an ESM Excel row, a user-typed external id, a row whose run
     * cannot be proven, a synthetic row. Drafts and style only; no approval, no guided run, no send.
     */
    NONE
}
