package com.sellerops.connector.cafe24;

import com.sellerops.inquiry.Inquiry;
import com.sellerops.inquiry.InquiryRepository;
import com.sellerops.inquiry.workitem.InquiryWorkItemWriter;
import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * Ask the source about the rows routine collection can no longer reach, and settle them.
 *
 * <p><b>The gap this closes.</b> {@link Cafe24InquiryAnswerObserver} fixed new collection, but the
 * sweep's window is a fortnight and this backlog is eleven years old: the 25 rows the demo org still
 * holds as 미답변 were last touched by a backfill on 2026-08-22 and would never be re-read again. Every
 * one of them has an empty {@code answered_at} — which is not evidence that they are unanswered, only
 * evidence that <b>nobody has ever looked at the representation that would say so</b>. Article 3674
 * already proved that a seller's answer can exist while {@code reply_status} still reads {@code N}.
 *
 * <p><b>It reads; it does not sweep.</b> The articles are named, one by one, from rows we already
 * hold — there is no window, no offset and no way to reach an article the caller did not name.
 * Budget is {@code 1 + (named articles that have comments)}.
 *
 * <p><b>What it writes, and what it refuses to write.</b> A parent whose comment is provably the
 * shop's becomes {@code ANSWERED} with {@code answered_at} set to the COMMENT's own time — not the
 * time we looked. Nothing else is written: no {@code answer_body} (「답변했다」 and 「이렇게 답했다」 are
 * different claims, and the second one has Answer Memory as its downstream), no comment text, no
 * comment id, no author, no member id, and no row for the comment itself. {@code inform_status} keeps
 * whatever the channel said — the channel's word and our conclusion live in different columns.
 *
 * <p><b>A customer's comment and an unknown author both leave the row alone.</b> Only
 * {@link Cafe24BoardCommentRow#authoredByMall()} — the platform's own 상점명 condition — counts. The
 * recoverable error is leaving an answered inquiry in the queue; the unrecoverable one is telling a
 * seller that a customer has been answered when nobody answered them.
 */
public class Cafe24HistoricalCommentReconciler {

    private static final Logger log =
            LoggerFactory.getLogger(Cafe24HistoricalCommentReconciler.class);

    private final Cafe24InquiryAnswerObserver observer;
    private final InquiryRepository inquiries;
    private final InquiryWorkItemWriter workItemWriter;

    public Cafe24HistoricalCommentReconciler(Cafe24InquiryAnswerObserver observer,
                                             InquiryRepository inquiries,
                                             InquiryWorkItemWriter workItemWriter) {
        this.observer = observer;
        this.inquiries = inquiries;
        this.workItemWriter = workItemWriter;
    }

    /** What one run did. Counts only — the outcome of a bounded read is a report, not a record. */
    public record Outcome(int candidates, int requested, int returnedWithComments, int commentReads,
                          int answeredByShopComment, int noShopComment, int unreadable) {

        /** The manifest's budget, recomputed from what actually happened rather than asserted. */
        public int requests() {
            return 1 + commentReads;
        }
    }

    /**
     * Reconcile the named articles of one board.
     *
     * @param candidates the article numbers to ask about — nothing else is reachable
     * @return the counts, so the caller can report a budget it did not have to trust
     */
    public Outcome reconcile(String accessToken, String mallId, UUID orgId, UUID channelId,
                             int boardNo, List<Long> candidates) {
        if (candidates == null || candidates.isEmpty()) {
            return new Outcome(0, 0, 0, 0, 0, 0, 0);
        }
        Map<Long, Instant> answered =
                observer.observeExact(accessToken, mallId, boardNo, candidates);

        List<Long> settled = new ArrayList<>();
        int unreadable = 0;
        for (Map.Entry<Long, Instant> entry : new LinkedHashMap<>(answered).entrySet()) {
            String externalId = Cafe24InquiryArticleMapper.externalId(boardNo, entry.getKey());
            Inquiry row = inquiries
                    .findByOrgIdAndChannelIdAndExternalId(orgId, channelId, externalId).orElse(null);
            if (row == null) {
                // The source answered about an article we no longer hold under this identity. That is
                // a reporting fact, not a licence to create one.
                unreadable++;
                continue;
            }
            row.setStatus("ANSWERED");
            row.setAnsweredAt(entry.getValue());
            row.setLastSeenAt(Instant.now());
            // answer_body stays null on purpose, and inform_status is not touched.
            workItemWriter.reconcileConnectorAnswered(row);
            settled.add(entry.getKey());
        }

        Outcome outcome = new Outcome(candidates.size(), candidates.size(), answered.size(),
                answered.size(), settled.size(), candidates.size() - answered.size(), unreadable);
        log.info("카페24 과거 댓글 정합: board={} 후보={} 요청={} 판매자답변확인={} 댓글없음={} "
                        + "행없음={}",
                boardNo, outcome.candidates(), outcome.requests(), outcome.answeredByShopComment(),
                outcome.noShopComment(), outcome.unreadable());
        return outcome;
    }
}
