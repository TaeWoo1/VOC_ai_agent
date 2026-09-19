package com.sellerops.inquiry.decision;

/**
 * Whether this system can read the listing's 상세페이지 — decided from stored facts, never guessed (Inquiry Decision v2).
 *
 * <p>It exists so a need the readable evidence did not close can be told apart from a need that may be answered on a
 * page nothing here reads. It changes no verdict the judge made about readable evidence; it only decides what a
 * short verdict MEANS.
 */
public enum DetailCapability {
    /** No listing — nothing to read. */
    NOT_APPLICABLE,
    /** Read, and it was text: what it said is in the evidence already. */
    READABLE,
    /** A NAVER listing whose detail was never read: Catalogue Bootstrap would read it — a SYSTEM_ACQUIRE, not a gap. */
    NOT_ACQUIRED,
    /** Read, and it was pictures: the image lane is not running, so the answer may be there and unread. */
    IMAGE_ONLY,
    /** A Cafe24 listing: its product detail is not collected at all. */
    NOT_COLLECTED;

    /** A source exists and no reader does. */
    public boolean unreadable() {
        return this == IMAGE_ONLY || this == NOT_COLLECTED;
    }
}
