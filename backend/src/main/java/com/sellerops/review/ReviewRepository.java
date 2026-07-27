package com.sellerops.review;

import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.domain.Slice;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface ReviewRepository extends JpaRepository<Review, UUID> {
    List<Review> findTop50ByOrgIdOrderByReceivedAtDesc(UUID orgId);

    /**
     * One review, org-scoped at the query boundary — a cross-org id reads as absent rather
     * than as a row the caller may not have. Used where an id arrives from a client (the
     * attention surface's {@code actionRef}), so the org filter is authorization, not
     * tidiness: {@code findById} alone would resolve any org's review.
     */
    Optional<Review> findByIdAndOrgId(UUID id, UUID orgId);

    long countByOrgIdAndReceivedAtAfter(UUID orgId, Instant after);

    long countByOrgIdAndNegativeTrue(UUID orgId);

    List<Review> findAllByOrgId(UUID orgId);

    /** Reviews for this org that have no item_analyses row yet (bounded by {@code pageable}). */
    @Query("select r from Review r where r.orgId = :orgId and not exists "
            + "(select 1 from ItemAnalysis a where a.orgId = r.orgId "
            + "and a.sourceType = 'REVIEW' and a.sourceId = r.id) order by r.receivedAt desc")
    List<Review> findUnanalyzedByOrgId(@Param("orgId") UUID orgId, Pageable pageable);

    /**
     * Reviews for this org in a stable order, for paging through the corpus during issue extraction.
     *
     * <p>Ordered by {@code receivedAt desc, id asc} rather than date alone. {@code received_at} is
     * date-granular on the file import path, so many rows share a value; without the id tiebreak the
     * page boundaries would be undefined and a paged backfill could revisit or skip rows.
     *
     * <p>There is deliberately no "not yet extracted" predicate to match
     * {@link #findUnanalyzedByOrgId}: issue extraction stores no marker on the review, because it is
     * idempotent by key — re-running it over an already-processed review attaches nothing. Paging is
     * therefore the caller's job, and a re-run is cheap rather than incorrect.
     */
    @Query("select r from Review r where r.orgId = :orgId order by r.receivedAt desc, r.id asc")
    List<Review> findForIssueExtraction(@Param("orgId") UUID orgId, Pageable pageable);

    /** Count of reviews for this org still missing an item_analyses row. */
    @Query("select count(r) from Review r where r.orgId = :orgId and not exists "
            + "(select 1 from ItemAnalysis a where a.orgId = r.orgId "
            + "and a.sourceType = 'REVIEW' and a.sourceId = r.id)")
    long countUnanalyzedByOrgId(@Param("orgId") UUID orgId);

    boolean existsByOrgIdAndChannelIdAndExternalId(UUID orgId, UUID channelId, String externalId);

    boolean existsByOrgIdAndChannelIdAndContentHash(UUID orgId, UUID channelId, String contentHash);

    /** The stored row a duplicate import matches, so its reply state can be refreshed forward. */
    Optional<Review> findByOrgIdAndChannelIdAndExternalId(UUID orgId, UUID channelId, String externalId);

    /** As above for the no-external-id path, keyed on the content hash. */
    Optional<Review> findByOrgIdAndChannelIdAndContentHash(UUID orgId, UUID channelId, String contentHash);

    /**
     * Window-scoped count for the operator attention surface. Scoped by CHANNEL, not by
     * seller account: {@code reviews} carries no {@code seller_account_id} (a file
     * upload resolves no account), so channel is the finest identity this store has.
     * Half-open [{@code from}, {@code toExclusive}) over {@code receivedAt}, matching
     * the community-article source's window semantics so the two read alike.
     */
    @Query("""
            select count(r) from Review r
            where r.orgId = :orgId and r.channelId = :channelId
              and r.receivedAt >= :from and r.receivedAt < :toExclusive
            """)
    long countInWindowByChannel(@Param("orgId") UUID orgId, @Param("channelId") UUID channelId,
                                @Param("from") Instant from, @Param("toExclusive") Instant toExclusive);

    /**
     * As {@link #countInWindowByChannel} but restricted to an inclusive rating bucket
     * [{@code minRating}, {@code maxRating}]. Rows with a null rating are excluded — a
     * null comparison is unknown in JPQL — so an unrated review never lands in a
     * low/mid-rating attention signal.
     */
    @Query("""
            select count(r) from Review r
            where r.orgId = :orgId and r.channelId = :channelId
              and r.rating >= :minRating and r.rating <= :maxRating
              and r.receivedAt >= :from and r.receivedAt < :toExclusive
            """)
    long countInWindowByChannelAndRatingBetween(@Param("orgId") UUID orgId, @Param("channelId") UUID channelId,
                                                @Param("minRating") int minRating,
                                                @Param("maxRating") int maxRating,
                                                @Param("from") Instant from,
                                                @Param("toExclusive") Instant toExclusive);

    /**
     * As {@link #countInWindowByChannelAndRatingBetween}, excluding reviews the CHANNEL reports as
     * already answered — the count behind the operator's "needs a look" bands.
     *
     * <p>{@code UNKNOWN} is deliberately still counted: an absent statement is not evidence of an
     * answer, and hiding work behind an unknown is the one failure this must not have. Only an
     * explicit {@code ANSWERED} excludes.
     *
     * <p>A separate query rather than a nullable predicate on the existing one: the arrival count
     * ({@link #countInWindowByChannel}) must keep counting every review, and two explicit queries
     * state that difference where it can be read.
     */
    @Query("""
            select count(r) from Review r
            where r.orgId = :orgId and r.channelId = :channelId
              and r.rating >= :minRating and r.rating <= :maxRating
              and r.replyState <> com.sellerops.review.ReviewReplyState.ANSWERED
              and r.receivedAt >= :from and r.receivedAt < :toExclusive
              and not
            """ + REPORTED_SUBMISSION_PREDICATE + """
            """)
    long countUnansweredInWindowByChannelAndRatingBetween(
            @Param("orgId") UUID orgId, @Param("channelId") UUID channelId,
            @Param("minRating") int minRating, @Param("maxRating") int maxRating,
            @Param("from") Instant from, @Param("toExclusive") Instant toExclusive);

    /**
     * Attention drill-down: one page of reviews inside the same half-open window the
     * counts use, so a signal's count and its drilled rows stay consistent. Null
     * {@code minRating}/{@code maxRating} collapse to "no constraint". {@code id} is an
     * internal pagination tiebreaker only (never surfaced) and makes the order total.
     */
    @Query("""
            select r from Review r
            where r.orgId = :orgId and r.channelId = :channelId
              and (:minRating is null or r.rating >= :minRating)
              and (:maxRating is null or r.rating <= :maxRating)
              and r.receivedAt >= :from and r.receivedAt < :toExclusive
            order by r.receivedAt desc, r.id desc
            """)
    Page<Review> findInWindowByChannelFiltered(@Param("orgId") UUID orgId, @Param("channelId") UUID channelId,
                                               @Param("minRating") Integer minRating,
                                               @Param("maxRating") Integer maxRating,
                                               @Param("from") Instant from,
                                               @Param("toExclusive") Instant toExclusive,
                                               Pageable pageable);

    /**
     * As {@link #findInWindowByChannelFiltered}, excluding channel-answered reviews — the drill-down
     * behind the "needs a look" bands.
     *
     * <p>It exists so the list and the count apply the SAME predicate: a card that says N건 and a
     * list that shows something else is the drift this repository's window semantics were written to
     * prevent. Pair it with {@link #countUnansweredInWindowByChannelAndRatingBetween}, never with the
     * unfiltered count.
     *
     * <p><b>Ordered actionable-first, then worst-first</b>: a review whose reply the operator has
     * already reported posting sinks below every row that still needs doing, and within each group
     * the 1★ from yesterday outranks the 3★ from this morning. Completed work must not hold the top
     * of a worklist — a seller working top-down would keep re-reading what they just finished. The
     * arrival lenses ({@link #findInWindowByChannelFiltered}) stay chronological, because a record of
     * what came in is chronological by definition.
     *
     * <p>Reported rows stay LISTED while being excluded from
     * {@link #countUnansweredInWindowByChannelAndRatingBetween}, so the count and the list here
     * deliberately differ. That is survivable only because the drill-down already carries a sentence
     * explaining why its total can exceed a card's count (the two low/mid-rating cards share a type),
     * and because both surfaces read {@link #REPORTED_SUBMISSION_PREDICATE} rather than each deciding
     * separately what "reported" means. Anything reported is UNVERIFIED, so it may not vanish.
     *
     * <p>The ordering is safe here specifically because this lens is only ever driven with
     * {@code minRating >= 1}, which excludes null ratings: {@code rating asc} would otherwise sort
     * nulls FIRST on H2 and LAST on PostgreSQL, making the top of an operator's worklist depend on
     * which database they were running. Do not reuse this ordering on a nullable-rating lens without
     * an explicit NULLS clause.
     */
    @Query("""
            select r from Review r
            where r.orgId = :orgId and r.channelId = :channelId
              and (:minRating is null or r.rating >= :minRating)
              and (:maxRating is null or r.rating <= :maxRating)
              and r.replyState <> com.sellerops.review.ReviewReplyState.ANSWERED
              and r.receivedAt >= :from and r.receivedAt < :toExclusive
            order by case when
            """ + REPORTED_SUBMISSION_PREDICATE + """
                     then 1 else 0 end asc,
                     r.rating asc, r.receivedAt desc, r.id desc
            """)
    Page<Review> findUnansweredInWindowByChannelFiltered(@Param("orgId") UUID orgId, @Param("channelId") UUID channelId,
                                                        @Param("minRating") Integer minRating,
                                                        @Param("maxRating") Integer maxRating,
                                                        @Param("from") Instant from,
                                                        @Param("toExclusive") Instant toExclusive,
                                                        Pageable pageable);

    // --- Classification facet over the "needs a look" lens ---
    //
    // Every query below repeats the SAME predicate as findUnansweredInWindowByChannelFiltered
    // (window + rating band + ANSWERED exclusion) and adds exactly one classification clause. That
    // repetition is deliberate: the facet's counts, its filtered pages and its unfiltered total are
    // read together on one screen, so any divergence between them shows up as a number that does not
    // add up. Stating the shared predicate in each is what makes the divergence impossible to
    // introduce silently.
    //
    // The join to ItemAnalysis is an EXISTS on (orgId, sourceType, sourceId) rather than a fetch: the
    // category is only a predicate here, and the row's own category is resolved per page by
    // IngestedReviewVocItemSource.categoriesFor.

    /**
     * As {@link #findUnansweredInWindowByChannelFiltered}, restricted to rows whose stored analysis
     * carries {@code category}. The {@code a.orgId = r.orgId} clause is load-bearing, not tidiness:
     * {@code item_analyses.source_id} is a bare polymorphic reference with no FK, so a same-id row
     * from another org would otherwise qualify a review it does not describe.
     */
    @Query("""
            select r from Review r
            where r.orgId = :orgId and r.channelId = :channelId
              and (:minRating is null or r.rating >= :minRating)
              and (:maxRating is null or r.rating <= :maxRating)
              and r.replyState <> com.sellerops.review.ReviewReplyState.ANSWERED
              and r.receivedAt >= :from and r.receivedAt < :toExclusive
              and exists (select 1 from ItemAnalysis a
                          where a.orgId = r.orgId and a.sourceType = 'REVIEW'
                            and a.sourceId = r.id and a.category = :category)
            order by case when
            """ + REPORTED_SUBMISSION_PREDICATE + """
                     then 1 else 0 end asc,
                     r.rating asc, r.receivedAt desc, r.id desc
            """)
    Page<Review> findUnansweredInWindowByChannelAndCategory(
            @Param("orgId") UUID orgId, @Param("channelId") UUID channelId,
            @Param("minRating") Integer minRating, @Param("maxRating") Integer maxRating,
            @Param("from") Instant from, @Param("toExclusive") Instant toExclusive,
            @Param("category") String category, Pageable pageable);

    /**
     * As {@link #findUnansweredInWindowByChannelFiltered}, restricted to rows with NO analysis row.
     *
     * <p>This is a coverage state, not a verdict about the review: analysis runs on newly-inserted
     * ids only and swallows its own failures, so these are rows nothing ever looked at. It is
     * distinct from the stored 기타 category, which IS a verdict.
     */
    @Query("""
            select r from Review r
            where r.orgId = :orgId and r.channelId = :channelId
              and (:minRating is null or r.rating >= :minRating)
              and (:maxRating is null or r.rating <= :maxRating)
              and r.replyState <> com.sellerops.review.ReviewReplyState.ANSWERED
              and r.receivedAt >= :from and r.receivedAt < :toExclusive
              and not exists (select 1 from ItemAnalysis a
                              where a.orgId = r.orgId and a.sourceType = 'REVIEW'
                                and a.sourceId = r.id)
            order by case when
            """ + REPORTED_SUBMISSION_PREDICATE + """
                     then 1 else 0 end asc,
                     r.rating asc, r.receivedAt desc, r.id desc
            """)
    Page<Review> findUnansweredInWindowByChannelUnclassified(
            @Param("orgId") UUID orgId, @Param("channelId") UUID channelId,
            @Param("minRating") Integer minRating, @Param("maxRating") Integer maxRating,
            @Param("from") Instant from, @Param("toExclusive") Instant toExclusive, Pageable pageable);

    /**
     * The window's category breakdown: {@code [category, count]} pairs over the same
     * needs-a-look predicate. Always computed UNFILTERED by category — a breakdown recomputed
     * under its own filter would collapse to the one option the operator already chose.
     */
    @Query("""
            select a.category, count(r) from Review r, ItemAnalysis a
            where a.orgId = r.orgId and a.sourceType = 'REVIEW' and a.sourceId = r.id
              and r.orgId = :orgId and r.channelId = :channelId
              and (:minRating is null or r.rating >= :minRating)
              and (:maxRating is null or r.rating <= :maxRating)
              and r.replyState <> com.sellerops.review.ReviewReplyState.ANSWERED
              and r.receivedAt >= :from and r.receivedAt < :toExclusive
            group by a.category
            """)
    List<Object[]> countUnansweredInWindowByChannelGroupedByCategory(
            @Param("orgId") UUID orgId, @Param("channelId") UUID channelId,
            @Param("minRating") Integer minRating, @Param("maxRating") Integer maxRating,
            @Param("from") Instant from, @Param("toExclusive") Instant toExclusive);

    /** How many needs-a-look rows in the window have no analysis row at all. */
    @Query("""
            select count(r) from Review r
            where r.orgId = :orgId and r.channelId = :channelId
              and (:minRating is null or r.rating >= :minRating)
              and (:maxRating is null or r.rating <= :maxRating)
              and r.replyState <> com.sellerops.review.ReviewReplyState.ANSWERED
              and r.receivedAt >= :from and r.receivedAt < :toExclusive
              and not exists (select 1 from ItemAnalysis a
                              where a.orgId = r.orgId and a.sourceType = 'REVIEW'
                                and a.sourceId = r.id)
            """)
    long countUnansweredInWindowByChannelUnclassified(
            @Param("orgId") UUID orgId, @Param("channelId") UUID channelId,
            @Param("minRating") Integer minRating, @Param("maxRating") Integer maxRating,
            @Param("from") Instant from, @Param("toExclusive") Instant toExclusive);

    /**
     * The window's needs-a-look total, ignoring any category filter — the denominator the
     * breakdown is comparable to.
     *
     * <p>Deliberately an INDEPENDENT query rather than the sum of the breakdown plus the
     * unclassified count. Deriving it would make the invariant that ties them together
     * ({@code sum(categories) + unclassified == unfilteredTotal}) true by construction, so the
     * test asserting it would prove nothing about the queries it is meant to guard.
     */
    @Query("""
            select count(r) from Review r
            where r.orgId = :orgId and r.channelId = :channelId
              and (:minRating is null or r.rating >= :minRating)
              and (:maxRating is null or r.rating <= :maxRating)
              and r.replyState <> com.sellerops.review.ReviewReplyState.ANSWERED
              and r.receivedAt >= :from and r.receivedAt < :toExclusive
            """)
    long countUnansweredInWindowByChannelFiltered(
            @Param("orgId") UUID orgId, @Param("channelId") UUID channelId,
            @Param("minRating") Integer minRating, @Param("maxRating") Integer maxRating,
            @Param("from") Instant from, @Param("toExclusive") Instant toExclusive);

    /**
     * "The operator has reported posting a reply for the version of this review's reply that
     * currently stands."
     *
     * <p><b>Version-scoped, deliberately.</b> Outcomes carry {@code recorded_version} because they
     * describe one approved VERSION, not a review. An operator who edits and re-approves after
     * posting has new text that was never posted, and this predicate stops matching — so the review
     * returns to the count on its own.
     *
     * <p><b>Existence, not recency</b> — diverging from
     * {@code ReviewReplyOutcomeRepository.findTopBy...OrderByCreatedAtDesc} on purpose. That read
     * describes where the CURRENT ATTEMPT stands, for the panel. This one asks whether a post was
     * ever reported for the reply that stands, and a later abort does not un-post an earlier
     * reported post. {@code SUBMISSION_ABORTED} never matches: it means "I did not post it".
     *
     * <p>Says nothing about the CHANNEL. {@code verification} is always {@code UNVERIFIED} — there
     * is no read-back oracle for a public reply — so this is the operator's report about their own
     * work, never a claim that the export's 답글여부 became Y.
     *
     * <p>Stated once and shared by the count (which EXCLUDES these rows) and the worklist ordering
     * (which SINKS them). Two copies would let the number and the order disagree about what
     * "reported" means.
     */
    String REPORTED_SUBMISSION_PREDICATE = """
            exists (select 1 from ReviewReplyOutcome o, ReviewReplyApproval ap
                    where o.orgId = r.orgId and o.reviewId = r.id
                      and ap.orgId = r.orgId and ap.reviewId = r.id
                      and ap.state = com.sellerops.attention.reply.ReviewReplyApprovalState.APPROVED
                      and ap.approvedVersion = o.recordedVersion
                      and o.operatorOutcome
                          = com.sellerops.attention.reply.OperatorOutcome.OPERATOR_REPORTED_SUBMITTED)
            """;

    /**
     * "The operator has COMMITTED to replying to this review" — the membership rule of the
     * 내 답변 작업 worklist.
     *
     * <p>Two independent commitments, unioned rather than one derived from the other: an explicit
     * {@code RESPONSE_NEEDED} triage decision, OR reply work that already exists (a saved draft, or
     * a standing approval). A seller who saved a draft and then moved the disposition has still done
     * work that must not vanish; a seller who marked 대응 필요 without drafting yet has still
     * committed. Approvals are unioned with drafts for the same reason
     * {@code IngestedReviewVocItemSource.preparedFor} does it: an approval implies a draft only
     * because a service rule says so, and a read correct only while an unrelated invariant holds
     * breaks silently.
     *
     * <p>This is a COMMITMENT, not a workflow phase: it promises no draft, no queue, and no send.
     */
    String COMMITTED_REPLY_WORK_PREDICATE = """
            (exists (select 1 from ReviewTriage t
                     where t.orgId = r.orgId and t.reviewId = r.id
                       and t.disposition
                           = com.sellerops.attention.triage.TriageDisposition.RESPONSE_NEEDED)
             or exists (select 1 from ReviewReplyDraft d
                        where d.orgId = r.orgId and d.reviewId = r.id)
             or exists (select 1 from ReviewReplyApproval a2
                        where a2.orgId = r.orgId and a2.reviewId = r.id
                          and a2.state
                              = com.sellerops.attention.reply.ReviewReplyApprovalState.APPROVED))
            """;

    /**
     * "This review is NOT currently set aside from the reply to-do" — the 작업에서 제외 / 복원 rule.
     *
     * <p>A dismissal removes an otherwise-eligible review from the to-do; the review re-enters through
     * either of two independent paths, so this predicate holds when there is no dismissal at all, OR:
     *
     * <ul>
     *   <li><b>Explicit restore (복원), arbitrated by the shared event sequence.</b> Dismissal and
     *       restore draw from one globally-monotonic {@code seq}, so the latest EXPLICIT action is the
     *       one with the greatest seq. A restore whose {@code seq} exceeds the review's greatest
     *       dismissal {@code seq} means the newest explicit event is a restore — active. This is a
     *       TOTAL order, so it decides same-{@code dismissed_at} cases (same clock tick) that a
     *       timestamp comparison cannot.
     *   <li><b>Automatic re-entry, by timestamp.</b> A fresh committing action newer than the latest
     *       dismissal's {@code dismissed_at} — a {@code RESPONSE_NEEDED} triage decision, or a saved
     *       draft version. Preserved exactly as before; independent of the restore log.
     * </ul>
     *
     * <p><b>Only decision/version timestamps count for the automatic paths</b> — {@code
     * ReviewTriage.decidedAt} changes only on a triage decision, and {@code ReviewReplyDraft.createdAt}
     * only on a new saved version. An ordinary read, or an unrelated timestamp touch (e.g. a re-import
     * bumping {@code reviews.updated_at}), moves neither, so it can never reactivate a dismissed review.
     * Likewise a restore moves only the seq order, never a draft or a disposition.
     */
    String NOT_DISMISSED_PREDICATE = """
            (not exists (select 1 from ReviewReplyWorkDismissal dis
                         where dis.orgId = r.orgId and dis.reviewId = r.id)
             or exists (select 1 from ReviewReplyWorkRestore res
                        where res.orgId = r.orgId and res.reviewId = r.id
                          and res.seq > (select max(d0.seq) from ReviewReplyWorkDismissal d0
                                         where d0.orgId = r.orgId and d0.reviewId = r.id))
             or exists (select 1 from ReviewTriage tdis
                        where tdis.orgId = r.orgId and tdis.reviewId = r.id
                          and tdis.disposition
                              = com.sellerops.attention.triage.TriageDisposition.RESPONSE_NEEDED
                          and tdis.decidedAt > (select max(d1.dismissedAt) from ReviewReplyWorkDismissal d1
                                                where d1.orgId = r.orgId and d1.reviewId = r.id))
             or exists (select 1 from ReviewReplyDraft ddis
                        where ddis.orgId = r.orgId and ddis.reviewId = r.id
                          and ddis.createdAt > (select max(d2.dismissedAt) from ReviewReplyWorkDismissal d2
                                                where d2.orgId = r.orgId and d2.reviewId = r.id)))
            """;

    /**
     * The 내 답변 작업 TO-DO: reviews this operator committed to replying to and has not yet
     * reported posting. Account/org scoped via {@code channelId}, exactly like every other lens here.
     *
     * <p>Reported rows are EXCLUDED (not sunk): this list is "what is still mine to do", and a
     * reported reply belongs to the separate recently-reported section. That divergence from the
     * arrival worklist — which sinks rather than drops — is deliberate: there, the row must stay
     * visible because the report is UNVERIFIED and correctable; here, a finished item would crowd
     * out the work that remains.
     *
     * <p><b>Ordering is worst-first, with NULL ratings pushed LAST explicitly.</b> Unlike
     * {@link #findUnansweredInWindowByChannelFiltered}, this lens has no {@code minRating} floor, so
     * a null rating is reachable — and bare {@code rating asc} sorts nulls FIRST on H2 and LAST on
     * PostgreSQL, which would make the top of an operator's own worklist depend on the database.
     * The explicit CASE removes that.
     */
    @Query("""
            select r from Review r
            where r.orgId = :orgId and r.channelId = :channelId
              and
            """ + COMMITTED_REPLY_WORK_PREDICATE + """
              and
            """ + NOT_DISMISSED_PREDICATE + """
              and not
            """ + REPORTED_SUBMISSION_PREDICATE + """
            order by case when r.rating is null then 1 else 0 end asc,
                     r.rating asc, r.receivedAt desc, r.id desc
            """)
    Page<Review> findCommittedReplyWorkByChannel(@Param("orgId") UUID orgId,
                                                @Param("channelId") UUID channelId,
                                                Pageable pageable);

    /**
     * The 내 답변 작업 RECENTLY REPORTED section: reviews whose reply the operator reported posting,
     * most-recently-reported first, bounded by the caller's page size.
     *
     * <p>Ordered by when the REPORT was recorded (the outcome's own {@code createdAt}), not by the
     * review's date — "recently reported" is a fact about the operator's work, not about the review.
     * The correlated MAX keeps one row per review even when several outcomes exist for it.
     *
     * <p>Every row here is {@code UNVERIFIED} by construction — there is no read-back oracle for a
     * public reply — so the surface must present it as "기록함 · 확인 안 함", never as 완료.
     */
    @Query("""
            select r from Review r
            where r.orgId = :orgId and r.channelId = :channelId
              and
            """ + REPORTED_SUBMISSION_PREDICATE + """
            order by (select max(o2.createdAt) from ReviewReplyOutcome o2
                      where o2.orgId = r.orgId and o2.reviewId = r.id
                        and o2.operatorOutcome
                            = com.sellerops.attention.reply.OperatorOutcome.OPERATOR_REPORTED_SUBMITTED)
                     desc, r.id desc
            """)
    Page<Review> findRecentlyReportedByChannel(@Param("orgId") UUID orgId,
                                              @Param("channelId") UUID channelId,
                                              Pageable pageable);

    /**
     * The 제외한 작업 recovery list: reviews the operator committed to, has NOT reported posting, and
     * has currently set aside — the exact negation of {@link #NOT_DISMISSED_PREDICATE}. A dismissed
     * review keeps its draft (dismissal deletes nothing), so it still satisfies the committed
     * predicate; it is only filtered out of the to-do, which is what makes it recoverable here.
     *
     * <p><b>Not window-scoped</b>, like the whole reply-work read — so a review dismissed long ago
     * stays reachable regardless of age, which is the point: a set-aside review must never become
     * permanently unreachable. Returned as a {@link Slice} (fetches size+1, no count query) so the
     * caller can page with a "더 보기" affordance rather than hide older items behind a hard cap.
     *
     * <p><b>Ordering is deterministic:</b> by the review's latest dismissal time DESC (most-recently
     * set aside first — a fact about the operator's action, like the recently-reported lens orders by
     * report time), then {@code r.id} DESC as a total tiebreak so pages never overlap or skip on equal
     * timestamps.
     */
    @Query("""
            select r from Review r
            where r.orgId = :orgId and r.channelId = :channelId
              and
            """ + COMMITTED_REPLY_WORK_PREDICATE + """
              and not
            """ + NOT_DISMISSED_PREDICATE + """
              and not
            """ + REPORTED_SUBMISSION_PREDICATE + """
            order by (select max(dord.dismissedAt) from ReviewReplyWorkDismissal dord
                      where dord.orgId = r.orgId and dord.reviewId = r.id) desc,
                     r.id desc
            """)
    Slice<Review> findDismissedReplyWorkByChannel(@Param("orgId") UUID orgId,
                                                  @Param("channelId") UUID channelId,
                                                  Pageable pageable);
}
