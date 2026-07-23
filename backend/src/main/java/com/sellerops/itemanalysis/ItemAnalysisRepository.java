package com.sellerops.itemanalysis;

import java.util.Collection;
import java.util.List;
import java.util.UUID;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface ItemAnalysisRepository extends JpaRepository<ItemAnalysis, UUID> {

    boolean existsByOrgIdAndSourceTypeAndSourceId(UUID orgId, String sourceType, UUID sourceId);

    List<ItemAnalysis> findAllByOrgIdOrderByCreatedAtDesc(UUID orgId);

    /**
     * Scoped read for the inbox: analyses for this org of one source type whose source id is
     * in {@code sourceIds}. Org-scoped (ids from another org return nothing); unknown ids are
     * simply absent; duplicate requested ids collapse in the {@code IN} clause.
     */
    List<ItemAnalysis> findByOrgIdAndSourceTypeAndSourceIdIn(
            UUID orgId, String sourceType, Collection<UUID> sourceIds);

    /**
     * Stored analyses for this org produced by an analyzer version OTHER than {@code current} —
     * the rows a re-analysis must recompute, bounded by {@code pageable}.
     *
     * <p>Ordered by {@code createdAt, id} so successive bounded calls walk the corpus in a stable
     * order. Without a total order the same rows can reappear across calls while others are never
     * reached, and a resumable batch that never converges is worse than no batch at all — it looks
     * like progress.
     *
     * <p>{@code <>} rather than "older than": versions are opaque strings, not ordered ones. A
     * rollback to a prior analyzer must select rows just as readily as an upgrade, and any ordering
     * comparison here would quietly make rollback a no-op.
     */
    @Query("select a from ItemAnalysis a where a.orgId = :orgId and a.analyzerVersion <> :current "
            + RECOMPUTABLE + " order by a.createdAt asc, a.id asc")
    List<ItemAnalysis> findOutdatedByOrgId(@Param("orgId") UUID orgId,
                                           @Param("current") String current, Pageable pageable);

    /**
     * How many of this org's analyses are outdated AND still recomputable — the number a caller
     * loops against.
     *
     * <p>The recomputability clause is what makes that loop terminate. A row whose source is gone,
     * or belongs to another org, can never be recomputed: counting it here would hold
     * {@code remaining} permanently above zero, so "re-call until {@code remaining == 0}" would never
     * finish. Excluding it from the SELECTION as well is what stops it starving real work — with a
     * small {@code limit}, a handful of such rows sorting first would otherwise fill every batch
     * forever while the recomputable ones were never reached.
     */
    @Query("select count(a) from ItemAnalysis a where a.orgId = :orgId and a.analyzerVersion <> :current "
            + RECOMPUTABLE)
    long countOutdatedByOrgId(@Param("orgId") UUID orgId, @Param("current") String current);

    /**
     * Outdated analyses this org can NEVER recompute — the source row is missing or belongs to
     * another org.
     *
     * <p>Reported rather than silently excluded. These rows are stuck at an old analyzer version
     * permanently, and a corpus that is "fully re-analyzed" except for a quiet residue is exactly
     * the kind of thing that should be visible rather than inferred from a count that stops moving.
     * This slice does not delete them: they are derived rows referencing something absent, and
     * deciding what to do about that is a separate question from re-analysis.
     */
    @Query("select count(a) from ItemAnalysis a where a.orgId = :orgId and a.analyzerVersion <> :current "
            + "and not " + RECOMPUTABLE_PREDICATE)
    long countOutdatedUnrecomputableByOrgId(@Param("orgId") UUID orgId, @Param("current") String current);

    /**
     * "This analysis points at a source row that exists and belongs to the same org."
     *
     * <p>Written once and shared by the three queries above so the selection, the loop's termination
     * count, and the stuck-row count cannot disagree about what recomputable means — a divergence
     * there would make the loop terminate on a different set than it processed.
     *
     * <p>The {@code orgId} match inside each EXISTS is load-bearing: {@code source_id} is a bare
     * polymorphic reference with no FK, so a same-id row in another org is a real possibility, not a
     * hypothetical. {@code ItemAnalysisService} re-checks it when it loads the source; this is the
     * same rule expressed where the counting happens.
     */
    String RECOMPUTABLE_PREDICATE = """
            ( (a.sourceType = 'REVIEW'
                 and exists (select 1 from Review r where r.id = a.sourceId and r.orgId = a.orgId))
              or (a.sourceType = 'INQUIRY'
                 and exists (select 1 from Inquiry q where q.id = a.sourceId and q.orgId = a.orgId)) )
            """;

    String RECOMPUTABLE = " and " + RECOMPUTABLE_PREDICATE;
}
