package com.sellerops.review;

import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
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
}
