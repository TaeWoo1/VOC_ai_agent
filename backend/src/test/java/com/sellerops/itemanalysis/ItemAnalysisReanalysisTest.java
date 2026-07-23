package com.sellerops.itemanalysis;

import static org.assertj.core.api.Assertions.assertThat;

import com.sellerops.attention.triage.ReviewTriage;
import com.sellerops.attention.triage.ReviewTriageRepository;
import com.sellerops.attention.triage.TriageDisposition;
import com.sellerops.inquiry.Inquiry;
import com.sellerops.inquiry.InquiryRepository;
import com.sellerops.itemanalysis.InboxItemAnalyzer.Result;
import com.sellerops.itemanalysis.InboxItemAnalyzer.SourceItem;
import com.sellerops.itemanalysis.dto.ReanalysisResult;
import com.sellerops.review.Review;
import com.sellerops.review.ReviewRepository;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.jdbc.AutoConfigureTestDatabase;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.test.context.ActiveProfiles;

/**
 * The re-analysis path: how an analyzer change reaches rows that already exist.
 *
 * <p>Before this, every write path was skip-if-exists, so a new analyzer applied only to items
 * imported after it shipped and an org's corpus split permanently across versions. These tests are
 * written around the two ways that path could betray an operator: by writing during a dry run, and
 * by destroying work it does not own.
 */
@DataJpaTest
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@ActiveProfiles("test")
class ItemAnalysisReanalysisTest {

    @Autowired InquiryRepository inquiries;
    @Autowired ReviewRepository reviews;
    @Autowired ItemAnalysisRepository analyses;
    @Autowired ReviewTriageRepository triage;

    private final UUID org = UUID.randomUUID();
    private final UUID otherOrg = UUID.randomUUID();

    /**
     * A stand-in for a future analyzer: same shape, different version, and a category no
     * {@code rules-v1} row can already hold — so "did this row get recomputed?" is answerable by
     * looking at it, without depending on the real analyzer's rules ever changing.
     */
    private static final class FakeV2Analyzer implements InboxItemAnalyzer {
        static final String VERSION = "rules-v2-test";

        @Override
        public String version() {
            return VERSION;
        }

        @Override
        public Result analyze(SourceItem item) {
            return new Result("재분석 요약", "품질", "NEGATIVE", "HIGH", "확인 필요",
                    "RULE_BASED", "rule-based", VERSION);
        }
    }

    /** An analyzer that reproduces rules-v1's verdict but stamps a new version — the no-op case. */
    private static final class SameVerdictV2Analyzer implements InboxItemAnalyzer {
        static final String VERSION = "rules-v2-same";
        private final RuleBasedInboxItemAnalyzer delegate = new RuleBasedInboxItemAnalyzer();

        @Override
        public String version() {
            return VERSION;
        }

        @Override
        public Result analyze(SourceItem item) {
            Result r = delegate.analyze(item);
            return new Result(r.summary(), r.category(), r.sentiment(), r.urgency(),
                    r.recommendedAction(), r.analyzerKind(), r.analyzerName(), VERSION);
        }
    }

    private ItemAnalysisService v1;

    @BeforeEach
    void setUp() {
        v1 = service(new RuleBasedInboxItemAnalyzer());
    }

    private ItemAnalysisService service(InboxItemAnalyzer analyzer) {
        return new ItemAnalysisService(inquiries, reviews, analyses, analyzer);
    }

    private Review seedReview(UUID owner, String body, int rating) {
        Review r = new Review();
        r.setOrgId(owner);
        r.setChannelId(UUID.randomUUID());
        r.setRating(rating);
        r.setBody(body);
        r.setNegative(rating <= 2);
        r.setContentHash("hash-" + UUID.randomUUID());
        r.setReceivedAt(Instant.parse("2026-06-09T00:00:00Z"));
        return reviews.save(r);
    }

    private ItemAnalysis stored(UUID sourceId) {
        return analyses.findByOrgIdAndSourceTypeAndSourceIdIn(org, "REVIEW", List.of(sourceId))
                .get(0);
    }

    // --- Selection ---

    @Test
    void aVersionBumpIsWhatMakesARowStale() {
        seedReview(org, "배송이 늦었어요", 1);
        v1.run(org);

        // Same analyzer → nothing outdated. The corpus is current, and saying so is the point:
        // a path that always found work would re-write the whole corpus on every call.
        assertThat(v1.previewReanalysis(org, 100).examined()).isZero();
        assertThat(v1.previewReanalysis(org, 100).remaining()).isZero();

        // A different version → every row is stale.
        assertThat(service(new FakeV2Analyzer()).previewReanalysis(org, 100).examined()).isEqualTo(1);
    }

    @Test
    void aRollbackSelectsJustAsReadilyAsAnUpgrade() {
        // Versions are opaque strings, not ordered ones. Selecting "older than current" would make
        // rolling back to a prior analyzer a silent no-op — the corpus would stay on the version
        // being rolled back FROM, which is the one case where being stuck is most damaging.
        seedReview(org, "배송이 늦었어요", 1);
        ItemAnalysisService v2 = service(new FakeV2Analyzer());
        v2.run(org);

        assertThat(v1.previewReanalysis(org, 100).examined()).isEqualTo(1);
    }

    @Test
    void reanalysisIsOrgScopedOnTheAnalysisRow() {
        seedReview(otherOrg, "배송이 늦었어요", 1);
        v1.run(otherOrg);

        assertThat(service(new FakeV2Analyzer()).reanalyzeOutdated(org, 100).examined()).isZero();
        // The other org's row is untouched and still on the version that wrote it.
        assertThat(analyses.findAllByOrgIdOrderByCreatedAtDesc(otherOrg).get(0).getAnalyzerVersion())
                .isEqualTo("rules-v1");
    }

    @Test
    void aCrossOrgSourceIsSkippedRatherThanRecomputed() {
        // reviews.id is reachable from item_analyses.source_id with no FK and no org constraint, so
        // the analysis row's org alone is not proof the SOURCE belongs to that org. Both are checked.
        Review foreign = seedReview(otherOrg, "배송이 늦었어요", 1);
        ItemAnalysis row = new ItemAnalysis();
        row.setOrgId(org);                 // row claims our org…
        row.setSourceType("REVIEW");
        row.setSourceId(foreign.getId());  // …but points at another org's review
        row.setSummary("s");
        row.setCategory("배송");
        row.setSentiment("NEGATIVE");
        row.setUrgency("HIGH");
        row.setRecommendedAction("확인 필요");
        row.setAnalyzerKind("RULE_BASED");
        row.setAnalyzerName("rule-based");
        row.setAnalyzerVersion("rules-v1");
        analyses.save(row);

        ReanalysisResult result = service(new FakeV2Analyzer()).reanalyzeOutdated(org, 100);

        // Never selected, so never recomputed — and reported as stuck rather than as work pending.
        assertThat(result.examined()).isZero();
        assertThat(result.unrecomputable()).isEqualTo(1);
        assertThat(result.remaining()).isZero();
        assertThat(stored(foreign.getId()).getCategory()).isEqualTo("배송");   // untouched
    }

    // --- Dry run ---

    @Test
    void aDryRunWritesNothing() {
        // THE test for this slice. A loaded ItemAnalysis is a MANAGED entity: touching a setter is
        // enough for Hibernate to flush it at commit, so "compute but don't save" is not the default
        // behaviour of a read — it is a property two guards have to hold up (no setters on this path,
        // and a readOnly transaction). This fails if either is removed.
        Review r = seedReview(org, "배송이 늦었어요", 1);
        v1.run(org);

        ReanalysisResult preview = service(new FakeV2Analyzer()).previewReanalysis(org, 100);

        assertThat(preview.dryRun()).isTrue();
        assertThat(preview.changed()).isEqualTo(1);
        ItemAnalysis after = stored(r.getId());
        assertThat(after.getAnalyzerVersion()).isEqualTo("rules-v1");
        assertThat(after.getCategory()).isEqualTo("배송");
        assertThat(after.getSummary()).isEqualTo("배송 관련 부정 리뷰");
    }

    @Test
    void applyChangesExactlyWhatTheDryRunPredicted() {
        seedReview(org, "배송이 늦었어요", 1);
        seedReview(org, "색상이 예뻐요", 5);
        v1.run(org);
        ItemAnalysisService v2 = service(new FakeV2Analyzer());

        ReanalysisResult predicted = v2.previewReanalysis(org, 100);
        ReanalysisResult applied = v2.reanalyzeOutdated(org, 100);

        assertThat(applied.examined()).isEqualTo(predicted.examined());
        assertThat(applied.changed()).isEqualTo(predicted.changed());
        assertThat(applied.unchanged()).isEqualTo(predicted.unchanged());
        assertThat(applied.fieldChanges()).isEqualTo(predicted.fieldChanges());
        assertThat(applied.categoryTransitions())
                .containsExactlyElementsOf(predicted.categoryTransitions());
    }

    @Test
    void aDryRunsRemainingDoesNotCountDown() {
        // Documented, and asserted so nobody builds a re-call loop on it: with no writes there is
        // nothing to reduce, so looping until remaining == 0 on a dry run would never terminate.
        seedReview(org, "배송이 늦었어요", 1);
        v1.run(org);
        ItemAnalysisService v2 = service(new FakeV2Analyzer());

        assertThat(v2.previewReanalysis(org, 100).remaining()).isEqualTo(1);
        assertThat(v2.previewReanalysis(org, 100).remaining()).isEqualTo(1);
        assertThat(v2.reanalyzeOutdated(org, 100).remaining()).isZero();
    }

    // --- Apply ---

    @Test
    void theRowIsUpdatedInPlaceKeepingItsIdentityAndCreationTime() {
        Review r = seedReview(org, "배송이 늦었어요", 1);
        v1.run(org);
        ItemAnalysis before = stored(r.getId());
        UUID id = before.getId();
        Instant createdAt = before.getCreatedAt();

        service(new FakeV2Analyzer()).reanalyzeOutdated(org, 100);

        // One row, not two: uq_item_analyses_source permits exactly one per source, and an insert
        // would violate it rather than silently duplicate — but the id and creation time are what
        // prove it was the SAME row rather than a delete-and-recreate.
        assertThat(analyses.findAllByOrgIdOrderByCreatedAtDesc(org)).hasSize(1);
        ItemAnalysis after = stored(r.getId());
        assertThat(after.getId()).isEqualTo(id);
        assertThat(after.getCreatedAt()).isEqualTo(createdAt);
        assertThat(after.getAnalyzerVersion()).isEqualTo(FakeV2Analyzer.VERSION);
        assertThat(after.getCategory()).isEqualTo("품질");
    }

    @Test
    void aRowWhoseVerdictIsUnchangedIsStillStampedCurrent() {
        // Otherwise it stays selected forever and a resumable batch never converges — the loop would
        // report progress on every call and finish on none.
        Review r = seedReview(org, "배송이 늦었어요", 1);
        v1.run(org);
        ItemAnalysisService same = service(new SameVerdictV2Analyzer());

        ReanalysisResult result = same.reanalyzeOutdated(org, 100);

        assertThat(result.changed()).isZero();
        assertThat(result.unchanged()).isEqualTo(1);
        assertThat(result.remaining()).isZero();
        assertThat(stored(r.getId()).getAnalyzerVersion()).isEqualTo(SameVerdictV2Analyzer.VERSION);
        assertThat(stored(r.getId()).getCategory()).isEqualTo("배송");   // verdict really is the same
    }

    @Test
    void aSecondRunIsANoOp() {
        seedReview(org, "배송이 늦었어요", 1);
        v1.run(org);
        ItemAnalysisService v2 = service(new FakeV2Analyzer());
        v2.reanalyzeOutdated(org, 100);

        ReanalysisResult second = v2.reanalyzeOutdated(org, 100);

        assertThat(second.examined()).isZero();
        assertThat(second.changed()).isZero();
        assertThat(second.remaining()).isZero();
    }

    @Test
    void aBatchIsBoundedAndResumesUntilRemainingIsZero() {
        for (int i = 0; i < 5; i++) {
            seedReview(org, "배송이 늦었어요 " + i, 1);
        }
        v1.run(org);
        ItemAnalysisService v2 = service(new FakeV2Analyzer());

        ReanalysisResult first = v2.reanalyzeOutdated(org, 2);
        assertThat(first.examined()).isEqualTo(2);
        assertThat(first.remaining()).isEqualTo(3);

        ReanalysisResult second = v2.reanalyzeOutdated(org, 2);
        assertThat(second.remaining()).isEqualTo(1);

        assertThat(v2.reanalyzeOutdated(org, 2).remaining()).isZero();
        assertThat(analyses.countOutdatedByOrgId(org, FakeV2Analyzer.VERSION)).isZero();
    }

    @Test
    void anOrphanedAnalysisIsSkippedNotThrown() {
        // One unrecomputable row must not abort the batch and strand the rest of the corpus at a
        // stale version — the failure would be silent, since a half-migrated corpus looks fine.
        Review alive = seedReview(org, "배송이 늦었어요", 1);
        v1.run(org);
        ItemAnalysis orphan = new ItemAnalysis();
        orphan.setOrgId(org);
        orphan.setSourceType("REVIEW");
        orphan.setSourceId(UUID.randomUUID());   // no such review
        orphan.setSummary("s");
        orphan.setCategory("배송");
        orphan.setSentiment("NEGATIVE");
        orphan.setUrgency("HIGH");
        orphan.setRecommendedAction("확인 필요");
        orphan.setAnalyzerKind("RULE_BASED");
        orphan.setAnalyzerName("rule-based");
        orphan.setAnalyzerVersion("rules-v1");
        analyses.save(orphan);

        ReanalysisResult result = service(new FakeV2Analyzer()).reanalyzeOutdated(org, 100);

        // The live row is recomputed; the orphan is neither examined nor counted as pending work —
        // it is reported as permanently stuck. Counting it in `remaining` would hold the documented
        // "re-call until remaining == 0" loop above zero forever.
        assertThat(result.changed()).isEqualTo(1);
        assertThat(result.unrecomputable()).isEqualTo(1);
        assertThat(result.remaining()).isZero();
        assertThat(stored(alive.getId()).getAnalyzerVersion()).isEqualTo(FakeV2Analyzer.VERSION);
    }

    @Test
    void orphansCannotStarveRealWorkOutOfASmallBatch() {
        // The sharper half of the same bug. Orphans sort first here (created first), so if they were
        // selectable, a limit of 2 would spend every batch on the same two unrecomputable rows and
        // the real review would never be reached — a loop that reports progress forever and finishes
        // never.
        for (int i = 0; i < 2; i++) {
            ItemAnalysis orphan = new ItemAnalysis();
            orphan.setOrgId(org);
            orphan.setSourceType("REVIEW");
            orphan.setSourceId(UUID.randomUUID());
            orphan.setSummary("s");
            orphan.setCategory("배송");
            orphan.setSentiment("NEGATIVE");
            orphan.setUrgency("HIGH");
            orphan.setRecommendedAction("확인 필요");
            orphan.setAnalyzerKind("RULE_BASED");
            orphan.setAnalyzerName("rule-based");
            orphan.setAnalyzerVersion("rules-v1");
            analyses.save(orphan);
        }
        Review alive = seedReview(org, "배송이 늦었어요", 1);
        v1.run(org);

        ReanalysisResult result = service(new FakeV2Analyzer()).reanalyzeOutdated(org, 2);

        assertThat(result.changed()).isEqualTo(1);
        assertThat(result.remaining()).isZero();
        assertThat(result.unrecomputable()).isEqualTo(2);
        assertThat(stored(alive.getId()).getAnalyzerVersion()).isEqualTo(FakeV2Analyzer.VERSION);
    }

    @Test
    void inquiriesAreRecomputedToo() {
        Inquiry q = new Inquiry();
        q.setOrgId(org);
        q.setChannelId(UUID.randomUUID());
        q.setBody("배송이 언제 도착하나요?");
        q.setStatus("UNANSWERED");
        q.setContentHash("hash-inq");
        q.setReceivedAt(Instant.parse("2026-06-10T00:00:00Z"));
        inquiries.save(q);
        v1.run(org);

        service(new FakeV2Analyzer()).reanalyzeOutdated(org, 100);

        assertThat(analyses.findByOrgIdAndSourceTypeAndSourceIdIn(org, "INQUIRY", List.of(q.getId()))
                .get(0).getAnalyzerVersion()).isEqualTo(FakeV2Analyzer.VERSION);
    }

    // --- The guarantee the whole path rests on ---

    @Test
    void reanalysisNeverTouchesOperatorWork() {
        // The reason no snapshot table exists: item_analyses is PURELY DERIVED, so recomputing it
        // cannot destroy anything a human decided. That is a claim about where operator state
        // lives — triage in review_triage, replies in review_reply_* — and a claim load-bearing
        // enough to be worth asserting rather than reasoning about. If a later change ever moved
        // operator state into item_analyses, this is what would catch it.
        Review r = seedReview(org, "배송이 늦었어요", 1);
        v1.run(org);

        ReviewTriage decision = new ReviewTriage();
        decision.setOrgId(org);
        decision.setReviewId(r.getId());
        decision.setChannelId(r.getChannelId());
        decision.setDisposition(TriageDisposition.RESPONSE_NEEDED);
        decision.setDecidedBy("operator@example.com");
        decision.setDecidedAt(Instant.parse("2026-06-11T00:00:00Z"));
        UUID triageId = triage.save(decision).getId();

        service(new FakeV2Analyzer()).reanalyzeOutdated(org, 100);

        ReviewTriage after = triage.findById(triageId).orElseThrow();
        assertThat(after.getDisposition()).isEqualTo(TriageDisposition.RESPONSE_NEEDED);
        assertThat(after.getDecidedBy()).isEqualTo("operator@example.com");
        assertThat(after.getDecidedAt()).isEqualTo(Instant.parse("2026-06-11T00:00:00Z"));
        assertThat(after.getReviewId()).isEqualTo(r.getId());
        // And the analysis really was recomputed — otherwise this passes vacuously.
        assertThat(stored(r.getId()).getAnalyzerVersion()).isEqualTo(FakeV2Analyzer.VERSION);
    }

    // --- The comparison story ---

    @Test
    void theReportSaysWhichFieldsMovedAndWhereTheCategoriesWent() {
        // Categories drive the review-queue facet counts, so this is the difference between a change
        // an operator decided on and one they discovered afterwards.
        seedReview(org, "배송이 늦었어요", 1);      // 배송 → 품질
        seedReview(org, "불량이 왔어요", 1);        // 품질 → 품질 (category unmoved)
        v1.run(org);

        ReanalysisResult result = service(new FakeV2Analyzer()).previewReanalysis(org, 100);

        assertThat(result.fieldChanges().category()).isEqualTo(1);
        assertThat(result.categoryTransitions())
                .contains(new ReanalysisResult.CategoryTransition("배송", 1, 0),
                        new ReanalysisResult.CategoryTransition("품질", 1, 2));
    }

    @Test
    void aCategoryEmptiedToZeroIsStillReported() {
        // A disappearance is exactly the movement an operator needs to see; omitting empty buckets
        // would hide the largest change the report can describe.
        seedReview(org, "배송이 늦었어요", 1);
        v1.run(org);

        assertThat(service(new FakeV2Analyzer()).previewReanalysis(org, 100).categoryTransitions())
                .contains(new ReanalysisResult.CategoryTransition("배송", 1, 0));
    }
}
