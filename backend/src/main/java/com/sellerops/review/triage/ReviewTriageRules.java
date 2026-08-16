package com.sellerops.review.triage;

/**
 * The whole of the tier decision, in one pure function of two inputs.
 *
 * <p><b>The two inputs are the rating and whether there is anything to read.</b> That is the entire
 * input space — there is no third. In particular the body's CONTENT is not an input: blankness is,
 * content is not, and {@code ReviewTriageRulesTest} pins that no text whatsoever can move a review
 * between tiers.
 *
 * <p><b>Why that boundary exists.</b> {@code contracts/review-eval/naver/v1/RUBRIC.md} §5 is a
 * pre-committed go/no-go: a text-derived detector may be built, but may not be surfaced to an
 * operator until it clears precision ≥ 0.80 (Wilson lower bound), recall ≥ 0.30, ≤ 0.05 false
 * positives on 4–5★ rows, and leaves {@code LOW_RATING_REVIEW} counts unchanged — "a detector may
 * only ADD". {@code labels.json} carries zero labels against an adequacy floor of 200, so nothing
 * can clear it today. Body-derived material still reaches the operator on this surface, but only as
 * a CITATION beside the row ({@link ReviewTriageNote}), never as the reason it ranked where it did.
 *
 * <p>Three cases are worth stating rather than inferring:
 *
 * <ul>
 *   <li><b>1–2★ with no text is {@link ReviewTriageTier#WATCH}, not 확인 필요.</b> RUBRIC §2's
 *       tie-breakers label exactly this case {@code NO_ACTION}: "There is nothing to detect. Rating
 *       already handles it." It is not demoted to 참고 either — the rating is real and still counts.
 *   <li><b>A null rating is {@code WATCH}.</b> Unknown is not good news; sorting it into 참고 would
 *       hide a review nobody has judged.
 *   <li><b>3★ is {@code WATCH}.</b> The attention queue's band is 1–3★
 *       ({@code IngestedReviewVocItemSource}); this surface splits it because 확인 필요 is a stronger
 *       claim than "inside the attention window", and 3★ is where the two honestly differ.
 * </ul>
 *
 * <p><b>This class is one of two representations of the same rule.</b> The other is
 * {@code ReviewRepository.TRIAGE_TIER_RANK}, which sorts and counts pages the service never fully
 * loads. They are pinned equal, exhaustively, by {@code ChannelReviewTriageIT} — see
 * {@code docs/slices/review-triage-v1.md} §3.1. Change one and you must change the other.
 */
public final class ReviewTriageRules {

    /** The rating at or below which a review is a complaint rather than a middling report. */
    static final int LOW_RATING_MAX = 2;
    /** The rating at or above which a review carries no action. */
    static final int GOOD_RATING_MIN = 4;

    private ReviewTriageRules() {
    }

    /**
     * The tier for a rating and a body.
     *
     * <p>{@code body} is read for blankness ONLY. It is taken as a parameter rather than a boolean so
     * that callers cannot disagree about what "textless" means — the same
     * {@code null-or-blank} test the list, the detail and the JPQL rank all use.
     */
    public static ReviewTriageTier tier(Integer rating, String body) {
        if (rating == null) {
            return ReviewTriageTier.WATCH;
        }
        if (rating <= LOW_RATING_MAX) {
            return isTextless(body) ? ReviewTriageTier.WATCH : ReviewTriageTier.NEEDS_ATTENTION;
        }
        if (rating >= GOOD_RATING_MIN) {
            return ReviewTriageTier.FYI;
        }
        return ReviewTriageTier.WATCH;
    }

    /**
     * The sort key: 0 is the top of the operator's list.
     *
     * <p>Stated explicitly rather than taken from {@link Enum#ordinal()}. An ordinal is a
     * declaration-order accident; reordering the enum for readability would silently rearrange a
     * worklist, and the failure would be invisible in review. It is also the value
     * {@code ReviewRepository.TRIAGE_TIER_RANK} must reproduce in SQL, so it needs to be a number
     * this code names on purpose.
     */
    public static int rank(ReviewTriageTier tier) {
        return switch (tier) {
            case NEEDS_ATTENTION -> 0;
            case WATCH -> 1;
            case FYI -> 2;
        };
    }

    /**
     * The buyer rated and wrote nothing.
     *
     * <p>The channel's placeholder for an empty review cell is never stored, so a blank body means
     * exactly this and nothing else — there is no case where a body went missing. Mirrors
     * {@code ChannelReviewService.isTextless}; both must keep agreeing with the JPQL rank's
     * {@code trim(r.body) = ''} test.
     */
    public static boolean isTextless(String body) {
        return body == null || body.isBlank();
    }
}
