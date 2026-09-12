package com.sellerops.collect;

import com.sellerops.collect.runtime.CollectionMethod;
import com.sellerops.sync.SyncJob;
import java.util.Set;

/**
 * **What one screen-read run can honestly say about what it did NOT read.**
 *
 * A bounded acquisition reads the newest page and stops. That is the right bound and it is not going to
 * change here, but until now the run row said so in the agent's own word — `PAGE_LIMIT_REACHED`, rendered to
 * the seller in red as if it were an error. It is not an error, and it is not nothing either: whether reviews
 * remain behind the last page read is a real question, and the counts the handoff already returns answer it
 * more often than not.
 *
 * <p><b>The derivation, and why each branch means what it says.</b>
 *
 * <ul>
 *   <li>{@code skippedRows > 0} — the read ran into reviews this organisation already held. Whatever sits
 *       further back was, at some earlier point, read. <b>{@link #REACHED_KNOWN_GROUND}</b>.</li>
 *   <li>no stop reason recorded — the walk ended because the pager said this was the last page
 *       ({@code FINAL_PAGE_REACHED} is the only stop reason that carries {@code complete}). There is no tail
 *       behind it to miss. Also {@link #REACHED_KNOWN_GROUND}.</li>
 *   <li>the walk stopped at a bound of its OWN ({@code PAGE_LIMIT_REACHED} / {@code REVIEW_LIMIT_REACHED})
 *       and every row it read was new — so the page it stopped on was full of reviews nobody had seen, and
 *       there may well be more behind it. <b>{@link #BACKLOG_POSSIBLE}</b>.</li>
 *   <li>anything else — a page that could not be read, a pager that would not resolve, a run that received
 *       nothing. <b>{@link #UNDETERMINED}</b>, which is a real answer and the most common honest one.</li>
 *   <li>a run that <b>failed</b> — it never read, so it is asked nothing and answers {@code null}. The reason
 *       it failed is on the same row and is what the seller needs from it.</li>
 * </ul>
 *
 * <p><b>What {@link #REACHED_KNOWN_GROUND} does not mean.</b> It does not mean every review is collected. It
 * means nothing in THIS run indicated reviews were left behind it. A seller who has never run a backfill can
 * see it on every incremental run while four fifths of their history has never been read, and that is not a
 * contradiction — it is the difference between "this read reached what we had" and "we have everything".
 * Nothing in this file or its copy is allowed to blur it.
 *
 * <p><b>No new column, no new table.</b> Every input is already on the run row: the collection method, the
 * three row counts, and the stop reason the handoff records in {@code error_message} when a walk did not
 * complete. It is a pure function of one row, computed where it is read.
 */
public enum ReviewCoverageSignal {
    REACHED_KNOWN_GROUND,
    BACKLOG_POSSIBLE,
    UNDETERMINED;

    /** The walk's own bounds — the two stop reasons that say "we stopped", not "the list ended". */
    private static final Set<String> OWN_BOUND_STOPS = Set.of("PAGE_LIMIT_REACHED", "REVIEW_LIMIT_REACHED");

    /**
     * The signal for one run, or {@code null} when the question is not asked of it.
     *
     * <p>Null is not a fourth value: an API pull and a file upload have their own completeness semantics, and
     * answering a question they were never asked would put a coverage sentence on a row that cannot support
     * one. Only a screen read carries this.
     */
    public static ReviewCoverageSignal of(SyncJob job) {
        if (job == null || !CollectionMethod.SELLER_CENTER_READ.name().equals(job.getMethod())) {
            return null;
        }
        // A run that FAILED never read a page, so it is not in a position to answer this question at all —
        // not even with "undeterminable", which reads as a statement ABOUT the list rather than about a read
        // that did not happen. Its row carries the reason it failed instead, and putting a coverage sentence
        // beside that would push the one thing the seller needs down the row behind a hedge.
        if ("FAILED".equals(job.getStatus())) {
            return null;
        }
        if (job.getTotalRows() <= 0) {
            return UNDETERMINED;
        }
        if (job.getSkippedRows() > 0) {
            return REACHED_KNOWN_GROUND;
        }
        String stop = job.getErrorMessage();
        if (stop == null || stop.isBlank()) {
            return REACHED_KNOWN_GROUND;
        }
        return OWN_BOUND_STOPS.contains(stop) ? BACKLOG_POSSIBLE : UNDETERMINED;
    }
}
