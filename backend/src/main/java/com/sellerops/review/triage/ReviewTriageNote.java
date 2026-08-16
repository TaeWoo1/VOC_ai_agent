package com.sellerops.review.triage;

import com.sellerops.itemanalysis.ItemAnalysisCategories;
import java.util.List;

/**
 * What the surface says about one review: its tier, the short reason it landed there, the issue tags
 * worth carrying, and the one thing the seller might do about it.
 *
 * <p><b>Computed at read time, stored nowhere.</b> There is no triage table behind this and no
 * control that writes one — a 확인 필요 row stays 확인 필요. That is a deliberate v1 boundary
 * ({@code docs/slices/review-triage-v1.md} §6): a half-integration with
 * {@code attention.triage.ReviewTriage}, which records a HUMAN's decision reached on a different
 * screen, would make a row's appearance depend on which surface the operator happened to use.
 *
 * <p><b>The reason explains; it does not decide.</b> {@link #reason} and {@link #tags} may name
 * body-derived material, but {@link #tier} was already fixed by {@link ReviewTriageRules} from the
 * rating and the presence of text alone. Nothing here can move a review between tiers, and
 * {@code ReviewTriageNoteTest} pins that.
 */
public record ReviewTriageNote(
        ReviewTriageTier tier,
        /** A short line of facts, e.g. {@code "1점 · 설치 · 같은 분류 11건"}. Never empty. */
        String reason,
        /** Issue tags worth carrying, from the stored analysis category. Often empty. */
        List<String> tags,
        /** One suggested next step, or {@code null} when there is genuinely nothing to do. */
        String recommendedAction) {

    /**
     * One review is not a pattern and two co-occur by chance often enough to be noise — the same
     * reasoning as {@code ReviewIssueThresholds.NEW_MIN_EVIDENCE}, which today holds the same value.
     *
     * <p>Declared here rather than imported from it on purpose. They are thresholds on DIFFERENT
     * mechanisms over different inputs: a stored analysis category on this surface, an aspect+problem
     * signature in the issue memory. Importing one would let a future revision of those DRAFT
     * thresholds silently redefine what this list calls repeated.
     */
    public static final long REPEAT_MIN = 3;

    /**
     * Build the note for one review.
     *
     * @param category      the stored {@code item_analyses.category}, or {@code null} when no analysis
     *                      row exists
     * @param categoryCount how many of this channel's reviews share that category, unwindowed
     */
    public static ReviewTriageNote of(Integer rating, String body, String category, long categoryCount) {
        ReviewTriageTier tier = ReviewTriageRules.tier(rating, body);
        boolean textless = ReviewTriageRules.isTextless(body);
        String tag = tagOf(category);
        boolean repeated = tag != null && categoryCount >= REPEAT_MIN;

        List<String> parts = new java.util.ArrayList<>(3);
        parts.add(rating == null ? "평점 없음" : rating + "점");
        if (textless) {
            parts.add("별점만");
        }
        if (tag != null) {
            parts.add(tag);
        }
        if (repeated) {
            parts.add("같은 분류 " + categoryCount + "건");
        }

        return new ReviewTriageNote(tier, String.join(" · ", parts),
                tag == null ? List.of() : List.of(tag), action(tier, textless, repeated));
    }

    /**
     * The category as a tag, or {@code null} when it is not one.
     *
     * <p>Two different absences collapse to the same answer here, and both are correct.
     * {@code null} is {@code UNCLASSIFIED} — no analysis row exists, so nothing ever looked at this
     * review. 기타 is a real stored verdict: something looked and it fitted no category. Neither is an
     * issue, and neither earns a chip — the same choice
     * {@code docs/slices/review-classification-queue-v1.md} made for an unanalyzed row.
     *
     * <p><b>Only a category from the known vocabulary is ever emitted.</b>
     * {@code item_analyses.category} is a plain {@code varchar(40)} whose vocabulary lives in a column
     * COMMENT and in {@link ItemAnalysisCategories} — there is no CHECK constraint — so without this
     * test an arbitrary stored string would ride straight into {@link #reason} and {@link #tags},
     * which are the one part of this note that does not pass through {@code VocPreviewSanitizer}.
     * Today the only writer is the rule-based analyzer, so nothing unexpected is reachable; the point
     * is that "every string this class can emit is a fixed literal, a rating or a known category"
     * should be true by construction rather than by who happens to write the column.
     */
    private static String tagOf(String category) {
        if (category == null || category.isBlank() || ItemAnalysisCategories.FALLBACK.equals(category)) {
            return null;
        }
        return ItemAnalysisCategories.isSupported(category) ? category : null;
    }

    /**
     * The suggested next step — a fixed map over the tier and two facts, never a generated sentence.
     *
     * <p><b>None of these may imply replying.</b> Coupang gives sellers no way to answer a 상품평;
     * {@code ChannelReviewService} and {@code ChannelReviews.tsx} both document the absence of a reply
     * control as deliberate, and a recommendation to reply would reintroduce that promise through the
     * back door. Every action here is something the seller does on their own side of the counter.
     * {@code ReviewTriageNoteTest} pins that no string this class can emit contains 답변/답글/회신.
     *
     * <p>참고 gets {@code null} rather than a reassuring sentence. A row with nothing to do should say
     * nothing — filling the slot would make the column look uniformly actionable.
     */
    private static String action(ReviewTriageTier tier, boolean textless, boolean repeated) {
        return switch (tier) {
            case NEEDS_ATTENTION -> repeated
                    ? "같은 분류의 상품평이 반복됩니다. 상품·포장 상태를 확인해 보세요."
                    : "내용을 읽고 상품 상태를 확인해 보세요.";
            case WATCH -> textless
                    ? "별점만 남긴 상품평입니다. 같은 상품의 다른 상품평과 함께 보세요."
                    : "같은 분류가 늘어나는지 지켜보세요.";
            case FYI -> null;
        };
    }
}
