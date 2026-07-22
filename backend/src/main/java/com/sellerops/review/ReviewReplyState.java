package com.sellerops.review;

import java.util.Locale;

/**
 * What the CHANNEL says about whether the seller already answered a review, normalized to a small
 * closed set.
 *
 * <p><b>This is the channel's statement, not SellerOps' record.</b> A reply SellerOps guided is
 * recorded separately as {@code OPERATOR_REPORTED_SUBMITTED} + {@code UNVERIFIED} (there is no
 * read-back oracle for a public reply). This value only ever mirrors what an import said, and it
 * arrives with an import — never from a SellerOps action.
 *
 * <p>NAVER's review export states it as {@code 답글여부}: {@code Y} = 답변 완료, {@code N} = 미답변.
 * ESM+ exports carry a {@code 답변 상태} column whose token vocabulary is <b>unconfirmed</b> (the
 * observed file was header-only), so its tokens are deliberately not guessed here — an unrecognized
 * value normalizes to {@link #UNKNOWN}, exactly as {@code CommunityReplyStatus} does.
 *
 * <p><b>Deliberately no {@code IN_PROGRESS}.</b> Cafe24's inquiry vocabulary has one (처리중); a
 * review export has no such state, and inventing one would put a value on the surface that no source
 * can ever produce. The three names here ARE a subset of {@code CommunityReplyStatus}'s names, on
 * purpose: both sources land on the same operator-facing chip
 * ({@code frontend/src/lib/vocItems.ts}), and a test pins the subset so the two cannot drift.
 *
 * <p><b>Never guessed as answered.</b> Absence, blankness, and anything unrecognized all mean
 * UNKNOWN — which the attention surface still counts as needing a look. Guessing ANSWERED would hide
 * real work; guessing PENDING would re-arm the duplicate-reply risk this exists to remove.
 */
public enum ReviewReplyState {

    /** The channel says no reply has been posted. */
    PENDING,

    /** The channel says a reply has been posted. The only value that excludes a review from the queue. */
    ANSWERED,

    /** No usable statement — absent column, blank cell, or an unrecognized token. Never a guess. */
    UNKNOWN;

    /** Map a raw export token to a canonical value; unknown/blank → {@link #UNKNOWN}. */
    public static ReviewReplyState normalize(String raw) {
        if (raw == null || raw.isBlank()) {
            return UNKNOWN;
        }
        return switch (raw.strip().toUpperCase(Locale.ROOT)) {
            // NAVER 답글여부 — the ONLY grounded vocabulary. "N" also matches Cafe24's 답변전 token,
            // and both mean the same thing. The enum's own names round-trip so a re-read of a value
            // this class produced is stable.
            //
            // Korean prose tokens (미답변 / 답변완료 …) are deliberately ABSENT: no observed export
            // uses them, and adding them would be a channel-support decision made in a switch
            // statement. An unrecognized token is UNKNOWN, which still asks for a look.
            case "N", "NO", "PENDING" -> PENDING;
            case "Y", "YES", "ANSWERED" -> ANSWERED;
            default -> UNKNOWN;
        };
    }

    /**
     * Whether moving from {@code current} to {@code incoming} is allowed by the MONOTONIC rule.
     *
     * <p>An import may teach us that a review IS answered, or that a previously-unknown review is
     * still unanswered. It may never un-answer a review that a prior import reported as answered.
     *
     * <p><b>Why asymmetric.</b> The realistic regression is a stale re-upload — last month's export
     * imported after this month's — which would mark every review answered since as unanswered
     * again, re-inflating the queue and re-arming duplicate public replies. The alternative failure,
     * a genuinely deleted channel reply staying marked answered, costs one missed prompt that the
     * operator can still see on the surface (the row carries a 답변 완료 chip and remains listed
     * under arrivals). An irreversible outward-facing double-post is the worse outcome, so the rule
     * favours avoiding it.
     */
    public static boolean isProgress(ReviewReplyState current, ReviewReplyState incoming) {
        if (current == incoming || incoming == UNKNOWN) {
            return false;   // nothing learned
        }
        return current != ANSWERED;
    }
}
