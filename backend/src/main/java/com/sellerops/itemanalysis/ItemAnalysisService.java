package com.sellerops.itemanalysis;

import com.sellerops.inquiry.Inquiry;
import com.sellerops.inquiry.InquiryRepository;
import com.sellerops.itemanalysis.InboxItemAnalyzer.Result;
import com.sellerops.itemanalysis.InboxItemAnalyzer.SourceItem;
import com.sellerops.itemanalysis.dto.BackfillResult;
import com.sellerops.itemanalysis.dto.ItemAnalysisView;
import com.sellerops.itemanalysis.dto.LookupRequest;
import com.sellerops.itemanalysis.dto.ReanalysisResult;
import com.sellerops.itemanalysis.dto.RunResult;
import com.sellerops.review.Review;
import com.sellerops.review.ReviewRepository;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Manual, idempotent, org-scoped analysis of recent inbox items. Deterministic and
 * local — no external call. Re-running is safe: an item that already has an
 * analysis row is skipped (skip-if-exists). The raw body is read in-memory only and
 * is never logged.
 */
@Service
public class ItemAnalysisService {

    private static final Logger log = LoggerFactory.getLogger(ItemAnalysisService.class);

    static final String INQUIRY = "INQUIRY";
    static final String REVIEW = "REVIEW";

    /** Hard ceiling on one backfill batch so a single call can never wrap the whole corpus
     *  in one transaction. Operators re-call until {@code remaining == 0}. */
    static final int MAX_BACKFILL_LIMIT = 2000;

    /** Defensive ceiling on one inbox lookup; the inbox feed is at most ~50 rows. */
    static final int MAX_LOOKUP = 500;

    private final InquiryRepository inquiries;
    private final ReviewRepository reviews;
    private final ItemAnalysisRepository analyses;
    private final InboxItemAnalyzer analyzer;

    public ItemAnalysisService(InquiryRepository inquiries, ReviewRepository reviews,
                               ItemAnalysisRepository analyses, InboxItemAnalyzer analyzer) {
        this.inquiries = inquiries;
        this.reviews = reviews;
        this.analyses = analyses;
        this.analyzer = analyzer;
    }

    @Transactional
    public RunResult run(UUID orgId) {
        int analyzed = 0;
        int skipped = 0;

        for (Inquiry q : inquiries.findTop50ByOrgIdOrderByReceivedAtDesc(orgId)) {
            if (analyzeInquiry(orgId, q)) {
                analyzed++;
            } else {
                skipped++;
            }
        }

        for (Review r : reviews.findTop50ByOrgIdOrderByReceivedAtDesc(orgId)) {
            if (analyzeReview(orgId, r)) {
                analyzed++;
            } else {
                skipped++;
            }
        }

        // Counts only — never the body.
        log.info("item-analysis run org={} analyzed={} skipped={}", orgId, analyzed, skipped);
        return new RunResult(analyzed, skipped);
    }

    /**
     * Analyze exactly the given source ids (the rows a single upload just inserted),
     * skipping any that already have an analysis. Org-scoped: ids not belonging to
     * {@code orgId} are ignored. Same deterministic, local, idempotent path as
     * {@link #run(UUID)} — no rescan of the org, no top-50 dependency.
     */
    @Transactional
    public RunResult analyzeForSources(UUID orgId, String sourceType, List<UUID> ids) {
        int analyzed = 0;
        int skipped = 0;
        if (ids != null && !ids.isEmpty()) {
            if (REVIEW.equals(sourceType)) {
                for (Review r : reviews.findAllById(ids)) {
                    if (!orgId.equals(r.getOrgId())) {
                        continue;
                    }
                    if (analyzeReview(orgId, r)) {
                        analyzed++;
                    } else {
                        skipped++;
                    }
                }
            } else if (INQUIRY.equals(sourceType)) {
                for (Inquiry q : inquiries.findAllById(ids)) {
                    if (!orgId.equals(q.getOrgId())) {
                        continue;
                    }
                    if (analyzeInquiry(orgId, q)) {
                        analyzed++;
                    } else {
                        skipped++;
                    }
                }
            }
        }
        log.info("item-analysis upload-trigger org={} type={} analyzed={} skipped={}",
                orgId, sourceType, analyzed, skipped);
        return new RunResult(analyzed, skipped);
    }

    /**
     * Bounded, idempotent corpus backfill: analyze up to {@code limit} un-analyzed
     * REVIEW/INQUIRY rows for this org, drawing the un-analyzed rows directly from the DB
     * (no top-50 limit, no full-corpus load). INQUIRY is drained first so a large review
     * backlog cannot starve the operationally-urgent inquiries out of the shared budget.
     * Reuses the same deterministic, local, skip-if-exists path as {@link #run(UUID)}.
     */
    @Transactional
    public BackfillResult backfillMissing(UUID orgId, int limit) {
        int safeLimit = Math.min(Math.max(limit, 1), MAX_BACKFILL_LIMIT);
        int analyzedInquiries = 0;
        int analyzedReviews = 0;
        int skipped = 0;

        // Inquiries first (response-latency / unanswered workload is more urgent).
        for (Inquiry q : inquiries.findUnanalyzedByOrgId(orgId, PageRequest.of(0, safeLimit))) {
            if (analyzeInquiry(orgId, q)) {
                analyzedInquiries++;
            } else {
                skipped++;
            }
        }
        int remainingBudget = safeLimit - analyzedInquiries;
        if (remainingBudget > 0) {
            for (Review r : reviews.findUnanalyzedByOrgId(orgId, PageRequest.of(0, remainingBudget))) {
                if (analyzeReview(orgId, r)) {
                    analyzedReviews++;
                } else {
                    skipped++;
                }
            }
        }

        long remaining = inquiries.countUnanalyzedByOrgId(orgId)
                + reviews.countUnanalyzedByOrgId(orgId);
        // Counts only — never the body.
        log.info("item-analysis backfill org={} inquiries={} reviews={} skipped={} remaining={}",
                orgId, analyzedInquiries, analyzedReviews, skipped, remaining);
        return new BackfillResult(analyzedInquiries, analyzedReviews, skipped, remaining);
    }

    /**
     * Recompute up to {@code limit} of this org's analyses that a DIFFERENT analyzer version
     * produced — the path that lets an analyzer change reach the corpus it was built for.
     *
     * <p>Everything else in this service is skip-if-exists, so before this there was no way to
     * revisit a stored verdict at all: a new analyzer would apply only to rows imported after it
     * shipped, leaving one org's corpus split across analyzer versions with no way to converge.
     *
     * <p><b>Manual only.</b> Nothing calls this on deploy or on a version bump. Categories drive the
     * review-queue facet counts, so an automatic run would re-bucket an operator's facets
     * mid-session with no action on their part and no record of why.
     *
     * <p>Bounded ({@code limit}, clamped by {@link #MAX_BACKFILL_LIMIT}), resumable (re-call until
     * {@code remaining == 0}), idempotent (a row at the current version stops being selected), and
     * org-scoped on BOTH sides — the analysis row's org and the loaded source's org must agree,
     * because {@code source_id} is a bare polymorphic reference with no FK and one check would let a
     * cross-org source colour a row.
     *
     * <p><b>{@code dryRun} computes the same verdicts and writes nothing.</b> That is not the
     * default behaviour of a JPA read: a loaded {@link ItemAnalysis} is a MANAGED entity, so calling
     * a setter marks it dirty and Hibernate flushes it at commit — a dry run that "just doesn't
     * save" would persist everything.
     *
     * <p>The guard that carries this is the <b>first</b> one: the dry-run path never touches a
     * setter, diffing {@link Result} against the row's getters instead. {@code readOnly} on
     * {@link #previewReanalysis} is defence in depth behind it.
     *
     * <p>⚠ <b>Do not mistake the second guard for a tested one.</b> {@code ItemAnalysisReanalysisTest}
     * constructs this service directly, so no Spring proxy exists and {@code @Transactional} — and
     * therefore {@code readOnly} — has no effect there at all. Falsification confirms it: removing
     * {@code readOnly} alone breaks no test, and removing the setter guard breaks
     * {@code aDryRunWritesNothing} even while {@code readOnly} is still declared. The no-setters rule
     * is what is proven; {@code readOnly} protects only the deployed path, and only if the first
     * guard regresses.
     *
     * <p><b>Rollback needs no snapshot — for REVIEWS.</b> {@link InboxItemAnalyzer} implementations
     * are pure, and a review's analyzed inputs ({@code body}, {@code rating}, {@code negative}) are
     * immutable after ingest — dedup skips a re-import and {@code refreshReplyState} touches only
     * reply fields. So a prior review verdict is not stored history but a reproducible function of
     * (row, analyzer version): running the previous analyzer reproduces it exactly.
     *
     * <p>⚠ <b>It is NOT a restore for inquiries.</b> {@code Inquiry.status} is mutable after ingest —
     * {@code EsmInquiryReconciler.reconcileAnswered} flips it to {@code ANSWERED} — and the analyzer's
     * inquiry branch reads it for both {@code urgency} and {@code recommendedAction}. Re-running a
     * prior analyzer over an inquiry answered since therefore yields that analyzer's verdict on
     * TODAY's inputs, which may differ from what was stored. That is the more useful outcome (the
     * stored verdict was describing a state that no longer holds) but it is a RECOMPUTE, not a
     * restore, and must not be described as one.
     *
     * <p>⚠ Reproducibility also holds only while a new analyzer is added ALONGSIDE the old one rather
     * than mutating it in place — mutating makes rollback a git-archaeology exercise.
     */
    @Transactional
    public ReanalysisResult reanalyzeOutdated(UUID orgId, int limit) {
        return reanalyze(orgId, limit, false);
    }

    /**
     * Predict {@link #reanalyzeOutdated} without writing: same selection, same verdicts, same report
     * shape, zero writes.
     *
     * <p>A SEPARATE entry point rather than a boolean on the one above, because the second guard has
     * to be the transaction itself. {@code readOnly = true} puts Hibernate in
     * {@code FlushMode.MANUAL}, and Spring's proxying means an annotation only takes effect at the
     * call boundary — a private helper annotated {@code readOnly} and invoked from inside this class
     * would be silently ignored, leaving the dry run one forgotten setter away from persisting.
     */
    @Transactional(readOnly = true)
    public ReanalysisResult previewReanalysis(UUID orgId, int limit) {
        return reanalyze(orgId, limit, true);
    }

    private ReanalysisResult reanalyze(UUID orgId, int limit, boolean dryRun) {
        int safeLimit = Math.min(Math.max(limit, 1), MAX_BACKFILL_LIMIT);
        String current = analyzer.version();
        List<ItemAnalysis> outdated =
                analyses.findOutdatedByOrgId(orgId, current, PageRequest.of(0, safeLimit));

        int changed = 0;
        int unchanged = 0;
        int skipped = 0;
        int categoryChanges = 0;
        int sentimentChanges = 0;
        int urgencyChanges = 0;
        int actionChanges = 0;
        Map<String, int[]> transitions = new LinkedHashMap<>();  // category -> {before, after}

        for (ItemAnalysis row : outdated) {
            Recomputed recomputed = recompute(orgId, row);
            if (recomputed == null) {
                skipped++;
                continue;
            }
            Result result = recomputed.result();

            // Diff BEFORE any write. On the dry-run path this is the whole operation; on the apply
            // path it must still precede applyResult, or every field would compare equal to itself.
            boolean categoryMoved = !Objects.equals(row.getCategory(), result.category());
            if (categoryMoved) {
                categoryChanges++;
            }
            if (!Objects.equals(row.getSentiment(), result.sentiment())) {
                sentimentChanges++;
            }
            if (!Objects.equals(row.getUrgency(), result.urgency())) {
                urgencyChanges++;
            }
            if (!Objects.equals(row.getRecommendedAction(), result.recommendedAction())) {
                actionChanges++;
            }
            transitions.computeIfAbsent(row.getCategory(), c -> new int[2])[0]++;
            transitions.computeIfAbsent(result.category(), c -> new int[2])[1]++;

            // A row can recompute to exactly what is stored and still need writing: the version
            // stamp itself is what makes it current, and leaving it stale would keep the row
            // selected forever, so a resumable batch would never converge.
            boolean verdictMoved = categoryMoved
                    || !Objects.equals(row.getSummary(), result.summary())
                    || !Objects.equals(row.getSentiment(), result.sentiment())
                    || !Objects.equals(row.getUrgency(), result.urgency())
                    || !Objects.equals(row.getRecommendedAction(), result.recommendedAction());
            if (verdictMoved) {
                changed++;
            } else {
                unchanged++;
            }
            if (!dryRun) {
                applyResult(row, result, recomputed.sourceContentHash());
                analyses.save(row);
            }
        }

        // After an apply this counts down; after a dry run it deliberately does not, since nothing
        // was written. See ReanalysisResult on why a client must not loop on a dry run.
        long remaining = analyses.countOutdatedByOrgId(orgId, current);
        long unrecomputable = analyses.countOutdatedUnrecomputableByOrgId(orgId, current);
        // Counts only — never a body, never an id.
        log.info("item-analysis reanalysis org={} dryRun={} examined={} changed={} unchanged={} "
                        + "skipped={} remaining={} unrecomputable={}",
                orgId, dryRun, outdated.size(), changed, unchanged, skipped, remaining, unrecomputable);
        return new ReanalysisResult(dryRun, outdated.size(), changed, unchanged, skipped, remaining,
                unrecomputable,
                new ReanalysisResult.FieldChanges(categoryChanges, sentimentChanges, urgencyChanges,
                        actionChanges),
                transitions.entrySet().stream()
                        .map(e -> new ReanalysisResult.CategoryTransition(
                                e.getKey(), e.getValue()[0], e.getValue()[1]))
                        .toList());
    }

    /** A recomputed verdict plus the source's current content hash, or null when unrecomputable. */
    private record Recomputed(Result result, String sourceContentHash) {
    }

    /**
     * Re-run the analyzer over the row's source, or {@code null} when it cannot be done.
     *
     * <p>Null covers an orphan (the source row is gone), a cross-org source, and an unknown
     * source type. All three are COUNTED AND SKIPPED rather than thrown: a single unrecomputable row
     * must not abort a batch and strand the rest of the corpus at a stale version.
     */
    private Recomputed recompute(UUID orgId, ItemAnalysis row) {
        if (REVIEW.equals(row.getSourceType())) {
            Review r = reviews.findById(row.getSourceId()).orElse(null);
            if (r == null || !orgId.equals(r.getOrgId())) {
                return null;
            }
            return new Recomputed(
                    analyzer.analyze(new SourceItem(REVIEW, r.getId(), r.getBody(),
                            r.getRating(), null, r.isNegative())),
                    r.getContentHash());
        }
        if (INQUIRY.equals(row.getSourceType())) {
            Inquiry q = inquiries.findById(row.getSourceId()).orElse(null);
            if (q == null || !orgId.equals(q.getOrgId())) {
                return null;
            }
            return new Recomputed(
                    analyzer.analyze(new SourceItem(INQUIRY, q.getId(), q.getBody(),
                            null, q.getStatus(), false)),
                    q.getContentHash());
        }
        return null;
    }

    /** @return true if a new analysis was written, false if skipped (already exists). */
    private boolean analyzeInquiry(UUID orgId, Inquiry q) {
        if (analyses.existsByOrgIdAndSourceTypeAndSourceId(orgId, INQUIRY, q.getId())) {
            return false;
        }
        SourceItem item = new SourceItem(INQUIRY, q.getId(), q.getBody(),
                null, q.getStatus(), false);
        persist(orgId, item, q.getContentHash());
        return true;
    }

    /** @return true if a new analysis was written, false if skipped (already exists). */
    private boolean analyzeReview(UUID orgId, Review r) {
        if (analyses.existsByOrgIdAndSourceTypeAndSourceId(orgId, REVIEW, r.getId())) {
            return false;
        }
        SourceItem item = new SourceItem(REVIEW, r.getId(), r.getBody(),
                r.getRating(), null, r.isNegative());
        persist(orgId, item, r.getContentHash());
        return true;
    }

    @Transactional(readOnly = true)
    public List<ItemAnalysisView> list(UUID orgId) {
        return analyses.findAllByOrgIdOrderByCreatedAtDesc(orgId).stream()
                .map(ItemAnalysisView::of)
                .toList();
    }

    /**
     * Inbox-scoped read: return the stored analyses for exactly the given feed rows, so the
     * response is bounded by the feed size rather than the org-wide corpus. Org-scoped (refs
     * for another org return nothing), unknown ids are ignored, and duplicate requested ids
     * collapse in the {@code IN} clause. Does not write or analyze — read-only enrichment.
     */
    @Transactional(readOnly = true)
    public List<ItemAnalysisView> lookup(UUID orgId, List<LookupRequest.SourceRef> refs) {
        if (refs == null || refs.isEmpty()) {
            return List.of();
        }
        List<UUID> reviewIds = new ArrayList<>();
        List<UUID> inquiryIds = new ArrayList<>();
        for (LookupRequest.SourceRef ref : refs.stream().limit(MAX_LOOKUP).toList()) {
            if (ref == null || ref.sourceId() == null) {
                continue;
            }
            if (REVIEW.equals(ref.sourceType())) {
                reviewIds.add(ref.sourceId());
            } else if (INQUIRY.equals(ref.sourceType())) {
                inquiryIds.add(ref.sourceId());
            }
        }
        List<ItemAnalysis> rows = new ArrayList<>();
        if (!reviewIds.isEmpty()) {
            rows.addAll(analyses.findByOrgIdAndSourceTypeAndSourceIdIn(orgId, REVIEW, reviewIds));
        }
        if (!inquiryIds.isEmpty()) {
            rows.addAll(analyses.findByOrgIdAndSourceTypeAndSourceIdIn(orgId, INQUIRY, inquiryIds));
        }
        return rows.stream().map(ItemAnalysisView::of).toList();
    }

    private void persist(UUID orgId, SourceItem item, String sourceContentHash) {
        Result result = analyzer.analyze(item);
        ItemAnalysis row = new ItemAnalysis();
        row.setOrgId(orgId);
        row.setSourceType(item.sourceType());
        row.setSourceId(item.sourceId());
        applyResult(row, result, sourceContentHash);
        analyses.save(row);
    }

    /**
     * Write one analyzer verdict onto a row — the ONLY place the derived columns are set.
     *
     * <p>Shared by first-analysis and re-analysis deliberately. Two copies would drift the moment a
     * field is added, and the drift would be silent in the worst direction: a re-analysis that
     * refreshed most fields but left one at its old analyzer's value produces a row that is
     * internally inconsistent while claiming, via {@code analyzerVersion}, to be wholly current.
     *
     * <p>Identity ({@code orgId}, {@code sourceType}, {@code sourceId}) is NOT set here — it belongs
     * to the row, not to the verdict, and a re-analysis must never move a row to a different source.
     */
    private void applyResult(ItemAnalysis row, Result result, String sourceContentHash) {
        row.setSummary(result.summary());
        row.setCategory(result.category());
        row.setSentiment(result.sentiment());
        row.setUrgency(result.urgency());
        row.setRecommendedAction(result.recommendedAction());
        row.setAnalyzerKind(result.analyzerKind());
        row.setAnalyzerName(result.analyzerName());
        row.setAnalyzerVersion(result.analyzerVersion());
        // modelName / promptVersion stay null for rule-based analysis.
        row.setSourceContentHash(sourceContentHash);
    }
}
