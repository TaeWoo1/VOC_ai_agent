package com.sellerops.reviewissue;

import com.sellerops.reviewissue.dto.ReviewIssueView;
import java.util.Comparator;

/**
 * <b>The order an ACTIVE repeated-problem list is read in — one rule, one place.</b>
 *
 * <p>The issue surfaces exist to answer 「무엇이 반복되고 있나」, and until 2026-09-07 they were ordered
 * severity-first. That was a deliberate choice with a written reason (a rising count of minor friction
 * should not displace a report that customers are receiving broken product) and it produced, on the
 * demo org, a product page whose five visible rows carried <b>6</b> evidence between them while the
 * eight folded behind 「문제 8건 더 보기」 carried <b>40</b> — every HIGH-severity issue there has one or
 * two rows, and 접착 부족 (NORMAL, 16 rows) was the one the opportunity card directly below was about.
 * A surface for finding repetition that hides the repetition is not doing its job.
 *
 * <p><b>What changed and what did not.</b> Severity is now the FIRST TIE-BREAK rather than the first
 * key: it still decides between two problems seen equally often, and it is still printed on every row,
 * so nothing about how bad a problem is has been hidden or renamed. Product-owner decision, 2026-09-07.
 *
 * <p><b>Nothing was removed.</b> The change-judgement rung (「무언가 발동했는가」) survives underneath
 * severity, so two problems with the same count and severity keep the relative order they had.
 *
 * <p>Callers: the issue memory list ({@link ReviewIssueQueryService#list}) and one product's repeated
 * problems ({@code ProductSignalsService.issuesFor}) — the two lists a person or an agent scans. Order
 * carries into the opportunity list, which is derived from the first of them. It is deliberately NOT
 * used by the report (which re-sorts by the period's own counts) or by the loop summary (which counts
 * and does not read an order).
 */
public final class IssueOrdering {

    private IssueOrdering() {
    }

    /**
     * Most evidence first, then severity, then whether a change judgement fired, then recency.
     *
     * <p>{@code evidenceCount} is whatever the CALLER scoped it to: org-wide on the issue memory, this
     * product's own rows on a product page ({@code ReviewIssueView#scopedTo}). That is the point of
     * sharing the comparator rather than the number — each surface ranks by the count it prints.
     */
    public static final Comparator<ReviewIssueView> ACTIVE_FIRST = Comparator
            .comparingLong(ReviewIssueView::evidenceCount).reversed()
            .thenComparingInt(v -> IssueSeverity.valueOf(v.severity()).rank())
            .thenComparing(v -> v.change() == null || v.change().kinds().isEmpty())
            .thenComparing(ReviewIssueView::lastEvidenceOn, Comparator.nullsLast(Comparator.reverseOrder()))
            // Total, so two identical rows do not swap between two reads of the same data.
            .thenComparing(v -> v.id().toString());

    /**
     * <b>Whether this issue is something the seller can act on today.</b>
     *
     * <p>Zero evidence means every review row behind the problem has been retracted — the re-extractor
     * reconciles rather than appends, so an improved extractor withdraws rows a worse one had matched
     * ({@code ReviewIssueExtractionService}). The issue row itself is KEPT: it carries the operator's
     * lifecycle history, and deleting history because the current extractor changed its mind would
     * destroy the record of what was decided and when.
     *
     * <p>But it is not a live operational problem, and the demo org was showing three of them
     * (배송 결함 · 설치 난이도 · 크기 난이도, 0 rows each) among the ones asking for attention. So it is
     * excluded from the ACTIVE list only: the detail page still opens by id, the history is intact, and
     * the set-aside (dismissed) list is untouched — that list is a record of decisions, not a worklist.
     */
    public static boolean hasLiveEvidence(ReviewIssueView view) {
        return view.evidenceCount() > 0;
    }
}
