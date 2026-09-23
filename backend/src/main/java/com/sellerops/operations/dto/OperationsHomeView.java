package com.sellerops.operations.dto;

import com.sellerops.coverage.dto.ChannelCoverageRow;
import com.sellerops.repeatedissue.dto.RepeatedIssueContextView;
import com.sellerops.reviewissue.dto.ReviewIssueView;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

/**
 * <b>Operations Home</b> — what a seller should look at now, in one bounded org-scoped read.
 *
 * <p><b>Why one read.</b> The Home is the only screen that is neither a channel's record nor an
 * account's queue, and every existing attention read is one of those. Composing it in the client
 * would mean a seller with three channels sees three numbers that cannot be added — the rank
 * expression is the same on each, but «how many need me» is one question and it deserves one answer
 * computed once.
 *
 * <p><b>Nothing here is invented, and three properties enforce that.</b>
 *
 * <ul>
 *   <li><b>No count is a sum of two others.</b> The existing dashboard's {@code urgentCount} is
 *       {@code unansweredInquiries + negativeReviews} — two populations added into a third that
 *       nobody measured and then called urgent. This view has no such field: every number answers one
 *       question over one population, and a screen that wants a total must say what it added.</li>
 *   <li><b>«분류된 수»와 «지금 결정 필요한 수»가 나뉘어 있다.</b> A tier is a read-time function of the
 *       review, so recording a decision does not change it. Reporting only the tier keeps asking for
 *       work already done; reporting only the undecided loses the tier's own size. Both are here.</li>
 *   <li><b>Model calls: zero.</b> Every field is SQL over rows this backend already holds. A screen a
 *       seller opens every morning must not cost a vendor round trip.</li>
 * </ul>
 *
 * <p><b>What is deliberately absent: a single "urgency" ordering across the four areas.</b> Ranking a
 * review against a repeated problem against a stale channel would require a weight nobody measured.
 * The areas are returned side by side and the screen shows them side by side.
 */
public record OperationsHomeView(
        /** 지금 확인할 리뷰. */
        ReviewAttention reviews,
        /** 반복 문제. */
        RepeatedProblems problems,
        /** 최근 수집 상태 — {@link ChannelCoverageRow} reused whole; this view adds no field to it. */
        List<ChannelCoverageRow> collection,
        /** 준비된 작업 — only what some existing record says is actually prepared. */
        PreparedWork prepared) {

    /**
     * The review side, as two different facts about the same rows plus a bounded list.
     *
     * <p><b>{@code watch} is an observation, never a work count.</b> WATCH means «if this keeps
     * happening it is worth changing something», which is the repeated-problem lane's question, not a
     * request for a decision today. It is reported so a seller can see the signal exists and is
     * deliberately not added to anything.
     */
    public record ReviewAttention(
            /** 확인 필요로 분류됐고 아직 아무도 결정하지 않은 수 — the one number that asks for work. */
            long needsAttentionUndecided,
            /** 확인 필요로 분류된 전체. Includes reviews already decided; never the work number. */
            long needsAttentionTotal,
            /** 지켜보기로 분류된 전체. An observation signal; see above. */
            long watchTotal,
            /** The undecided 확인 필요 reviews themselves, newest first, bounded. */
            List<AttentionReview> rows) {
    }

    /**
     * One review on the Home, carrying only what the row needs to be worth opening.
     *
     * <p>{@code accountId} rides along so the screen can link straight into the decision workspace
     * without a second read to learn which account the review belongs to.
     */
    public record AttentionReview(
            UUID reviewId,
            UUID accountId,
            String channelCode,
            Integer rating,
            LocalDate occurredOn,
            String productName,
            /** The masked opening of what the customer wrote, or null when masking left nothing. */
            String quote) {
    }

    /**
     * The repeated-problem side.
     *
     * <p><b>{@code observing} is counted apart from {@code decidable} and must not be drawn as work.</b>
     * 관찰 중 means reviewnary has not concluded anything needs doing. A seller may still act there —
     * that is a separate decision, taken on the problem's own screen — but a Home that presented 20
     * observed problems as 20 pending tasks would be manufacturing urgency out of an evidence trickle.
     *
     * <p><b>All three counts are about problems still happening.</b> The Home is 「지금 볼 일」, so a problem whose
     * newest evidence predates the observation window is counted under {@code dormant} and appears in none of the
     * others — the screen would otherwise print a number for 「지금」 that includes a problem last seen last year.
     */
    public record RepeatedProblems(
            /** 확인 필요 + 조치 중, still happening — problems that are somebody's move right now. */
            long decidable,
            /** 관찰 중, still happening. Reported, never presented as pending work. */
            long observing,
            /**
             * Problems whose newest evidence is older than the observation window — counted here, listed nowhere.
             *
             * <p><b>It exists so that «none» can tell the truth.</b> Without it an org whose problems all went quiet
             * months ago reads 「아직 모인 반복 문제가 없습니다」, and that is false: the problems are there, in
             * 고객운영 메모리, with every piece of their evidence. Nothing about them changed to get here — no row
             * was written, no lifecycle moved, nothing was dismissed — so this number is a statement about what this
             * screen is showing, never about the problem itself.
             *
             * <p>Not addable to the other two, like everything else in this view: a dormant problem is neither
             * somebody's move today nor under observation today.
             */
            long dormant,
            /**
             * The problems worth drawing, each with the full repeat context the workspace shows —
             * severity, trend, evidence count, per-product denominators and the rating spread. Bounded
             * hard, because each row costs its own context read.
             */
            List<HomeProblem> rows) {
    }

    /** One repeated problem, as the canonical issue view plus the context the Home is asked to show. */
    public record HomeProblem(ReviewIssueView issue, RepeatedIssueContextView context) {
    }

    /**
     * <b>준비된 작업 — only what an existing record says is prepared.</b>
     *
     * <p>Each number is a row somebody already wrote: an approval the seller stood behind, a draft
     * that exists. Nothing here is derived from «this looks like it needs a reply» — a Home that
     * invented work would be asking a seller to do something no record supports, and the one thing
     * this section must never do is grow when nothing was prepared.
     */
    public record PreparedWork(
            /** Reviews whose reply the seller approved and has not yet reported as sent. */
            long reviewRepliesApproved,
            /** Inquiries awaiting the seller that actually HAVE a draft — phase alone is not a draft. */
            long inquiryDraftsReady,
            /**
             * Improvement drafts the seller asked for and that still have an opportunity behind them.
             *
             * <p>This is the same test as the other two, applied to a third record: the seller pressed
             * 채택 (a decision row exists) and a draft body exists. Nothing is derived from 「이 문제는
             * 조치가 필요해 보인다」 — a repeated problem nobody has decided about is counted under
             * {@link RepeatedProblems}, never here.
             *
             * <p>It is also re-derived before it is counted, so an accepted opportunity whose issue was
             * since resolved or fell under the repeat threshold drops out rather than asking a seller
             * to finish work its own workspace no longer offers.
             */
            long improvementDraftsReady,
            List<PreparedItem> rows) {
    }

    /**
     * One prepared item. {@code kind} is a closed token — {@code REVIEW_REPLY}, {@code INQUIRY_REPLY}
     * or {@code IMPROVEMENT_DRAFT} — and {@code to} is the surface that owns finishing it, so the Home
     * hands work over rather than becoming a second place to do it.
     *
     * <p>{@code id} is the id of the record behind the row, not of the destination: two accepted
     * opportunities on one repeated problem link to the same issue and would otherwise be one row
     * twice.
     *
     * <p><b>{@code label} and {@code detail} are separate because one of them repeats.</b> The label is
     * the kind of work and reads the same on every row of that kind; the detail is what tells one row
     * from the next. Folding them into a single string produced four rows reading 「승인된 리뷰 답변」 on
     * the live org — five links a seller could not choose between without opening them.
     *
     * <p>{@code detail} is a fact the product already shows elsewhere: the seller's own catalogue name
     * for a review, the inquiry's own subject for an inquiry. Null when neither exists, and then the
     * row stands on its label alone rather than on an invented description.
     *
     * <p><b>{@code phase} is the row's own truth, not the section's claim.</b> The 실행 대기 section
     * used to badge every row 「승인함 · 등록 전」, which is what a standing {@code ReviewReplyApproval}
     * is and what an inquiry row is NOT: an inquiry reaches this list on the predicate «a draft row
     * exists», with the work item still {@code OPEN} or {@code PROPOSED} and no approval anywhere. The
     * badge therefore told a seller they had approved something they had not, on the one screen that
     * exists to tell them what is outstanding. Rather than mint a status word for the wire, the row
     * carries the phase the work item already has and the screen says what that phase means. Null for
     * kinds that have no work item — a review reply is here BECAUSE an approval stands, and an
     * improvement draft has no lifecycle of this shape.
     */
    public record PreparedItem(String kind, UUID id, String label, String detail,
                               String channelCode, String to, String phase) {
    }
}
