package com.sellerops.review.triage.feedback;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.sellerops.common.ApiException;
import com.sellerops.review.triage.ReviewTriageTier;
import com.sellerops.review.triage.llm.ReviewTriageClassifier;
import com.sellerops.review.triage.llm.TriagePrompt;
import com.sellerops.review.triage.llm.TriageSuggestedAction;
import java.lang.reflect.Field;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * The three records stay three, and a correction never becomes training.
 *
 * <p>In-memory fakes rather than a Spring context: the behaviour under test is entirely in the
 * service's rules about what may be recorded, and a slice test would spend its time on JPA.
 */
class TriageFeedbackServiceTest {

    private static final UUID ORG = UUID.randomUUID();
    private static final UUID REVIEW = UUID.randomUUID();
    private static final Clock FIXED = Clock.fixed(Instant.parse("2026-08-17T00:00:00Z"), ZoneOffset.UTC);

    private FakePredictions predictions;
    private FakeCorrections corrections;
    private FakeDispositions dispositions;
    private FakeCurrent current;
    private FakeActions actions;
    private FakeBehavior behavior;
    private TriageFeedbackService service;

    @BeforeEach
    void setUp() {
        predictions = new FakePredictions();
        corrections = new FakeCorrections();
        dispositions = new FakeDispositions();
        current = new FakeCurrent();
        actions = new FakeActions();
        behavior = new FakeBehavior();
        service = new TriageFeedbackService(predictions.repo, corrections.repo, dispositions.repo,
                current.repo, actions.repo, behavior.repo, FIXED);
    }

    private TriagePrediction recordOk() {
        // 5★ with text — the rule's own answer is FYI, so the guard leaves the model's answer alone.
        return service.record(ORG, REVIEW, 5, "좋아요", "test-model", ReviewTriageClassifier.Result.ok(
                ReviewTriageTier.FYI, "PRAISE_ONLY", List.of(), TriageSuggestedAction.NONE, "v/1"));
    }

    @Test
    @DisplayName("a prediction carries what produced it, and no review content")
    void aPredictionCarriesItsProvenance() {
        TriagePrediction row = recordOk();

        assertThat(row.getClassifierVersion()).isEqualTo("v/1");
        assertThat(row.getModelId()).isEqualTo("test-model");
        assertThat(row.getPromptHash()).isEqualTo(TriagePrompt.promptHash()).hasSize(64);
        assertThat(row.getPredictedAt()).isEqualTo(Instant.parse("2026-08-17T00:00:00Z"));
        // Every persisted string, checked against the closed vocabularies. A body reaching this
        // table is the failure the whole schema is shaped to prevent.
        assertThat(row.getTier()).isEqualTo(ReviewTriageTier.FYI);
        assertThat(row.getTags()).isNull();
        assertThat(row.getFailureReason()).isNull();
    }

    @Test
    @DisplayName("the stored tier passes through the additive guard, and the raw answer is kept beside it")
    void theStoredTierIsGuarded() {
        // The defect the independent review of candidate B found: this guard lived in the evaluation
        // harness only, so every stored row stamped +additive-guard/v1 onto an unguarded tier.
        // 2★ with text → the rule says 확인 필요; the model says WATCH; the row must hold both.
        TriagePrediction row = service.record(ORG, REVIEW, 2, "포장이 눌렸어요", "test-model",
                ReviewTriageClassifier.Result.ok(ReviewTriageTier.WATCH, "CRITIQUE_NO_REQUEST",
                        List.of(), TriageSuggestedAction.MONITOR_REPEAT, "v/1"));

        assertThat(row.getTier()).as("the guarded decision").isEqualTo(ReviewTriageTier.NEEDS_ATTENTION);
        assertThat(row.getModelTier()).as("what the model actually said").isEqualTo(ReviewTriageTier.WATCH);
    }

    @Test
    @DisplayName("a promotion is stored as the model gave it")
    void promotionsPassThrough() {
        // 5★ with text → the rule says FYI; the model promotes; the guard must not interfere.
        TriagePrediction row = service.record(ORG, REVIEW, 5, "좋은데 하나 아쉬워요", "test-model",
                ReviewTriageClassifier.Result.ok(ReviewTriageTier.NEEDS_ATTENTION,
                        "PRAISE_WITH_CONCESSION", List.of(), TriageSuggestedAction.INVESTIGATE_PRODUCT, "v/1"));

        assertThat(row.getTier()).isEqualTo(ReviewTriageTier.NEEDS_ATTENTION);
        assertThat(row.getModelTier()).isEqualTo(ReviewTriageTier.NEEDS_ATTENTION);
    }

    @Test
    @DisplayName("an outage stores the rule's own answer, never FYI and never null")
    void aFailureStoresTheBaseline() {
        TriagePrediction row = service.record(ORG, REVIEW, 1, "깨져서 왔어요", "test-model",
                ReviewTriageClassifier.Result.failed("v/1", "http 529"));

        assertThat(row.getTier()).as("an outage is no worse than the rule")
                .isEqualTo(ReviewTriageTier.NEEDS_ATTENTION);
        assertThat(row.getModelTier()).as("the model said nothing").isNull();
    }

    @Test
    @DisplayName("a failed classification is stored, not dropped, and is never mistakable for a judgment")
    void failuresAreRecorded() {
        // A run whose failures vanished would report metrics over the rows that happened to succeed
        // and call that the model's accuracy.
        TriagePrediction row = service.record(ORG, REVIEW, 5, "좋아요", "test-model",
                ReviewTriageClassifier.Result.failed("v/1", "http 529"));

        assertThat(row.getStatus()).isEqualTo(ReviewTriageClassifier.Status.CLASSIFICATION_FAILED);
        assertThat(row.getFailureReason()).isEqualTo("http 529");
        // RUBRIC §8.5 as clarified: the tier here is the RULE's answer for a 5★ review, and it is
        // marked CLASSIFICATION_FAILED with no model tier beside it. What §8.5 forbids is the
        // classifier INVENTING FYI so an outage reads as a considered judgment; these three columns
        // together make that impossible to mistake.
        assertThat(row.getTier()).isEqualTo(ReviewTriageTier.FYI);
        assertThat(row.getModelTier()).as("no model answer exists").isNull();
    }

    @Test
    @DisplayName("re-classifying inserts, never updates — the history stays answerable")
    void predictionsAreImmutable() {
        TriagePrediction first = recordOk();
        TriagePrediction second = recordOk();

        assertThat(predictions.rows).hasSize(2);
        assertThat(second.getId()).isNotEqualTo(first.getId());
    }

    @Test
    @DisplayName("a prediction that produced no tier cannot be corrected")
    void cannotCorrectAFailure() {
        TriagePrediction failed = service.record(ORG, REVIEW, 5, "좋아요", "m",
                ReviewTriageClassifier.Result.failed("v/1", "http 500"));

        // Otherwise it would record a disagreement with an answer nobody gave, and that row would
        // later count as a classifier error inside a snapshot.
        assertThatThrownBy(() -> service.correct(ORG, failed.getId(), ReviewTriageTier.NEEDS_ATTENTION,
                "DEFECT_OR_DAMAGE", List.of()))
                .isInstanceOf(ApiException.class);
    }

    @Test
    @DisplayName("a correction is scoped to the prediction and carries no free text")
    void aCorrectionIsScopedAndClosed() {
        TriagePrediction prediction = recordOk();
        TriageCorrection correction = service.correct(ORG, prediction.getId(),
                ReviewTriageTier.NEEDS_ATTENTION, "DELIVERY_PROBLEM", List.of("배송"));

        assertThat(correction.getPredictionId()).isEqualTo(prediction.getId());
        assertThat(correction.getCorrectedTier()).isEqualTo(ReviewTriageTier.NEEDS_ATTENTION);
        assertThat(correction.getCorrectedTags()).isEqualTo("배송");
        // No field exists for a note. The check is on the type, so adding one has to be deliberate.
        assertThat(TriageCorrection.class.getDeclaredFields())
                .as("a free-text field here would be customer prose in a table the harness reads")
                .noneMatch(f -> f.getName().toLowerCase().contains("note")
                        || f.getName().toLowerCase().contains("comment"));
    }

    @Test
    @DisplayName("an unknown reason code is refused rather than stored")
    void correctionVocabularyIsClosed() {
        TriagePrediction prediction = recordOk();
        assertThatThrownBy(() -> service.correct(ORG, prediction.getId(), ReviewTriageTier.WATCH,
                "SOUNDS_BAD", List.of())).isInstanceOf(ApiException.class);
    }

    // ── the pilot's read row, RUBRIC v2 §13.7 ─────────────────────────────────────────────

    @Test
    @DisplayName("the current row marks AI 확인 필요 only where the classifier ADDED something")
    void theCurrentRowIsAdditiveOnly() {
        // 5★ FYI by rule, model promotes → the pilot added it → marked.
        service.record(ORG, REVIEW, 5, "좋은데 하나 아쉬워요", "m", ReviewTriageClassifier.Result.ok(
                ReviewTriageTier.NEEDS_ATTENTION, "PRAISE_WITH_CONCESSION", List.of(),
                TriageSuggestedAction.INVESTIGATE_PRODUCT, "v/1"));
        assertThat(current.rows).hasSize(1);
        assertThat(current.rows.get(0).isAiAttention()).isTrue();

        // 1★ with text — the RULE already says 확인 필요. Whatever the model says, the pilot added
        // nothing, so the mark is false: crediting the model for the rule's work would be a lie
        // the seller could not detect.
        UUID lowStar = UUID.randomUUID();
        service.record(ORG, lowStar, 1, "깨졌어요", "m", ReviewTriageClassifier.Result.ok(
                ReviewTriageTier.NEEDS_ATTENTION, "DEFECT_OR_DAMAGE", List.of(),
                TriageSuggestedAction.INVESTIGATE_PRODUCT, "v/1"));
        assertThat(current.rows.stream().filter(r -> r.getReviewId().equals(lowStar)).findFirst().orElseThrow()
                .isAiAttention()).as("nothing to add on a rules positive").isFalse();

        // Model says WATCH on a 5★ → nothing added → not marked. And a failure lands on the baseline
        // → nothing added → not marked. Neither can ever produce a mark.
        UUID watch = UUID.randomUUID();
        service.record(ORG, watch, 5, "그냥 그래요", "m", ReviewTriageClassifier.Result.ok(
                ReviewTriageTier.WATCH, "CRITIQUE_NO_REQUEST", List.of(), TriageSuggestedAction.MONITOR_REPEAT, "v/1"));
        UUID failed = UUID.randomUUID();
        service.record(ORG, failed, 5, "좋아요", "m", ReviewTriageClassifier.Result.failed("v/1", "http 500"));
        assertThat(current.rows.stream().filter(r -> r.getReviewId().equals(watch) || r.getReviewId().equals(failed)))
                .allMatch(r -> !r.isAiAttention());
    }

    @Test
    @DisplayName("re-classifying rewrites the current row in place; the prediction history still grows")
    void theCurrentRowIsRewrittenNotAppended() {
        recordOk();
        recordOk();
        assertThat(predictions.rows).hasSize(2);
        assertThat(current.rows).as("one live answer per review").hasSize(1);
        assertThat(current.rows.get(0).getPredictionId()).isEqualTo(predictions.rows.get(1).getId());
    }

    // ── explicit feedback on a REVIEW ────────────────────────────────────────────────────────

    @Test
    @DisplayName("a correction on a review the pilot marked is scoped to the AI prediction")
    void aReviewCorrectionAgainstTheAiMark() {
        TriagePrediction p = service.record(ORG, REVIEW, 5, "좋은데 하나 아쉬워요", "m",
                ReviewTriageClassifier.Result.ok(ReviewTriageTier.NEEDS_ATTENTION, "PRAISE_WITH_CONCESSION",
                        List.of(), TriageSuggestedAction.INVESTIGATE_PRODUCT, "v/1"));
        TriageCorrection c = service.correctReview(ORG, REVIEW, 5, "좋은데 하나 아쉬워요", false, null, true);

        assertThat(c.getPredictionId()).isEqualTo(p.getId());
        assertThat(c.getShownSource()).isEqualTo(TriageShownSource.AI);
        assertThat(c.getShownTier()).isEqualTo(ReviewTriageTier.NEEDS_ATTENTION);
        // "필요 없음" is stored as the RULE's own non-attention tier for the row — the seller never
        // chose between WATCH and FYI, and the pilot does not own that split.
        assertThat(c.getCorrectedTier()).isEqualTo(ReviewTriageTier.FYI);
    }

    @Test
    @DisplayName("a correction on a review no classifier saw is a correction of the RULE, and says so")
    void aReviewCorrectionAgainstTheRule() {
        // 1★ with text, no prediction anywhere: the seller says 필요 없음 to a rules 확인 필요.
        TriageCorrection c = service.correctReview(ORG, REVIEW, 1, "별로", false, "CRITIQUE_NO_REQUEST", true);

        assertThat(c.getPredictionId()).isNull();
        assertThat(c.getShownSource()).isEqualTo(TriageShownSource.RULES);
        assertThat(c.getShownTier()).isEqualTo(ReviewTriageTier.NEEDS_ATTENTION);
        assertThat(c.getCorrectedTier()).isEqualTo(ReviewTriageTier.WATCH);
        assertThat(c.getCorrectedReasonCode()).isEqualTo("CRITIQUE_NO_REQUEST");
    }

    @Test
    @DisplayName("shown = AI only when the surface actually showed it: pilot on, mark set, rule not already positive")
    void shownFollowsTheSurfaceNotTheTable() {
        // A mark exists in the table.
        TriagePrediction p = service.record(ORG, REVIEW, 5, "좋은데 하나 아쉬워요", "m",
                ReviewTriageClassifier.Result.ok(ReviewTriageTier.NEEDS_ATTENTION, "PRAISE_WITH_CONCESSION",
                        List.of(), TriageSuggestedAction.INVESTIGATE_PRODUCT, "v/1"));
        assertThat(current.rows.get(0).isAiAttention()).isTrue();

        // Pilot switched OFF for the org after the run: the seller saw the rules chip alone, so the
        // evidence is RULES — an org switched off must not keep producing AI-shown rows for a mark
        // nobody could see (independent review, D2). The prediction is still linked: history is history.
        TriageCorrection off = service.correctReview(ORG, REVIEW, 5, "좋은데 하나 아쉬워요", false, null, false);
        assertThat(off.getShownSource()).isEqualTo(TriageShownSource.RULES);
        assertThat(off.getShownTier()).isEqualTo(ReviewTriageTier.FYI);
        assertThat(off.getPredictionId()).isEqualTo(p.getId());

        // Pilot ON, but the RULE already says 확인 필요 for this row: no mark is ever rendered there,
        // so shown is RULES / NEEDS_ATTENTION — the same filter the read path applies.
        UUID low = UUID.randomUUID();
        service.record(ORG, low, 1, "깨졌어요", "m", ReviewTriageClassifier.Result.ok(
                ReviewTriageTier.NEEDS_ATTENTION, "DEFECT_OR_DAMAGE", List.of(),
                TriageSuggestedAction.INVESTIGATE_PRODUCT, "v/1"));
        TriageAction a = service.act(ORG, low, 1, "깨졌어요", TriageActionKind.ACTION_COMPLETED, null, true);
        assertThat(a.getShownSource()).isEqualTo(TriageShownSource.RULES);
        assertThat(a.getShownTier()).isEqualTo(ReviewTriageTier.NEEDS_ATTENTION);
    }

    @Test
    @DisplayName("AI_ATTENTION_SHOWN is written only where the server resolves the display to AI; a client claim elsewhere is dropped")
    void aiAttentionShownIsServerResolved() {
        // A marked row (5★, model says 확인 필요) and a rules-positive row (1★) — a client claims SHOWN on both,
        // plus on a row no classifier ever saw.
        service.record(ORG, REVIEW, 5, "좋은데 하나 아쉬워요", "m",
                ReviewTriageClassifier.Result.ok(ReviewTriageTier.NEEDS_ATTENTION, "PRAISE_WITH_CONCESSION",
                        List.of(), TriageSuggestedAction.INVESTIGATE_PRODUCT, "v/1"));
        UUID low = UUID.randomUUID();
        UUID unseen = UUID.randomUUID();
        service.record(ORG, low, 1, "깨졌어요", "m", ReviewTriageClassifier.Result.ok(
                ReviewTriageTier.NEEDS_ATTENTION, "DEFECT_OR_DAMAGE", List.of(),
                TriageSuggestedAction.INVESTIGATE_PRODUCT, "v/1"));

        int written = service.observe(ORG, List.of(
                new TriageFeedbackService.Observation(REVIEW, 5, "좋은데 하나 아쉬워요", TriageBehaviorKind.AI_ATTENTION_SHOWN),
                new TriageFeedbackService.Observation(low, 1, "깨졌어요", TriageBehaviorKind.AI_ATTENTION_SHOWN),
                new TriageFeedbackService.Observation(unseen, 5, "좋아요", TriageBehaviorKind.AI_ATTENTION_SHOWN),
                // REVIEW_OPENED is not gated this way: opening a rules row is still a (RULES-shown) trace.
                new TriageFeedbackService.Observation(low, 1, "깨졌어요", TriageBehaviorKind.REVIEW_OPENED)), true);

        assertThat(written).isEqualTo(2);
        assertThat(behavior.rows).extracting(TriageBehaviorEvent::getKind, TriageBehaviorEvent::getShownSource)
                .containsExactly(
                        org.assertj.core.groups.Tuple.tuple(TriageBehaviorKind.AI_ATTENTION_SHOWN, TriageShownSource.AI),
                        org.assertj.core.groups.Tuple.tuple(TriageBehaviorKind.REVIEW_OPENED, TriageShownSource.RULES));

        // Surface OFF: the same claim on the marked row writes nothing — the seller could not have seen a mark.
        behavior.rows.clear();
        assertThat(service.observe(ORG, List.of(new TriageFeedbackService.Observation(REVIEW, 5, "좋은데 하나 아쉬워요",
                TriageBehaviorKind.AI_ATTENTION_SHOWN)), false)).isZero();
    }

    @Test
    @DisplayName("the display decision is one function, and it is the read path's predicate")
    void theDisplayDecisionIsOneFunction() {
        AiTriageCurrent marked = new AiTriageCurrent();
        marked.setAiAttention(true);
        AiTriageCurrent unmarked = new AiTriageCurrent();
        unmarked.setAiAttention(false);
        // AI exactly when: surface on ∧ row marked ∧ rule not already NEEDS_ATTENTION.
        assertThat(TriageDisplayDecision.resolve(ReviewTriageTier.FYI, marked, true).aiShown()).isTrue();
        assertThat(TriageDisplayDecision.resolve(ReviewTriageTier.WATCH, marked, true).aiShown()).isTrue();
        assertThat(TriageDisplayDecision.resolve(ReviewTriageTier.NEEDS_ATTENTION, marked, true).aiShown()).isFalse();
        assertThat(TriageDisplayDecision.resolve(ReviewTriageTier.FYI, marked, false).aiShown()).isFalse();
        assertThat(TriageDisplayDecision.resolve(ReviewTriageTier.FYI, unmarked, true).aiShown()).isFalse();
        assertThat(TriageDisplayDecision.resolve(ReviewTriageTier.FYI, null, true).aiShown()).isFalse();
        // And when RULES, the tier shown is the rule's own, whatever the row said.
        assertThat(TriageDisplayDecision.resolve(ReviewTriageTier.WATCH, marked, false).tier()).isEqualTo(ReviewTriageTier.WATCH);
        assertThat(TriageDisplayDecision.resolve(ReviewTriageTier.FYI, marked, true).tier()).isEqualTo(ReviewTriageTier.NEEDS_ATTENTION);
    }

    @Test
    @DisplayName("what was shown is computed from the store, never asserted by the caller")
    void shownIsNotCallerSupplied() {
        // No overload takes a shownSource. A client that could say "I was shown AI" could write
        // feedback against a mechanism that never spoke.
        assertThat(TriageFeedbackService.class.getMethods())
                .filteredOn(m -> m.getName().equals("correctReview") || m.getName().equals("act"))
                .allMatch(m -> java.util.Arrays.stream(m.getParameterTypes())
                        .noneMatch(t -> t == TriageShownSource.class));
    }

    @Test
    @DisplayName("actions append; a start and a completion are two rows, and neither trains anything")
    void actionsAppend() {
        service.act(ORG, REVIEW, 5, "좋아요", TriageActionKind.ACTION_STARTED, null, true);
        service.act(ORG, REVIEW, 5, "좋아요", TriageActionKind.ACTION_COMPLETED, null, true);
        assertThat(actions.rows).hasSize(2);
        assertThat(actions.rows).extracting(TriageAction::getKind)
                .containsExactly(TriageActionKind.ACTION_STARTED, TriageActionKind.ACTION_COMPLETED);
    }

    // ── silver ───────────────────────────────────────────────────────────────────────────────

    @Test
    @DisplayName("there is no IGNORED behaviour kind, and no weight column — silver stays silver")
    void silverHasNoIgnoreAndNoWeight() {
        assertThat(TriageBehaviorKind.values()).extracting(Enum::name)
                .as("absence of rows is the record of being ignored, and absence is not a signal")
                .noneMatch(n -> n.contains("IGNOR") || n.contains("SKIP") || n.contains("DISMISS"));
        assertThat(TriageBehaviorEvent.class.getDeclaredFields())
                .as("the weight is a snapshot-time policy, not a stored fact")
                .noneMatch(f -> f.getName().toLowerCase().contains("weight"));
    }

    @Test
    @DisplayName("silver and corrections freeze into SEPARATE snapshots, and neither call touches the other")
    void silverIsFrozenApart() {
        TriageCorrection error = correctionFor(recordOk());
        service.disposition(ORG, error.getId(), CorrectionDispositionKind.CLASSIFIER_ERROR, null);
        service.act(ORG, REVIEW, 5, "좋아요", TriageActionKind.ACTION_COMPLETED, null, true);
        service.observe(ORG, List.of(new TriageFeedbackService.Observation(REVIEW, 5, "좋아요",
                TriageBehaviorKind.REVIEW_OPENED)), true);

        assertThat(service.freezeSnapshot(ORG, "gold-eval/1")).isEqualTo(1);
        assertThat(actions.rows.get(0).getSnapshotVersion()).as("a correction snapshot took no silver").isNull();
        assertThat(behavior.rows.get(0).getSnapshotVersion()).isNull();

        assertThat(service.freezeSilverSnapshot(ORG, "silver/1")).isEqualTo(2);
        assertThat(actions.rows.get(0).getSnapshotVersion()).isEqualTo("silver/1");
        assertThat(behavior.rows.get(0).getSnapshotVersion()).isEqualTo("silver/1");
        assertThat(dispositions.rows.get(0).getSnapshotVersion())
                .as("a silver snapshot took no correction").isEqualTo("gold-eval/1");
    }

    @Test
    @DisplayName("a second correction supersedes rather than accumulating")
    void oneLiveCorrectionPerPrediction() {
        TriagePrediction prediction = recordOk();
        service.correct(ORG, prediction.getId(), ReviewTriageTier.WATCH, "CRITIQUE_NO_REQUEST", List.of());
        service.correct(ORG, prediction.getId(), ReviewTriageTier.NEEDS_ATTENTION, "DEFECT_OR_DAMAGE", List.of());

        assertThat(corrections.rows).hasSize(1);
        assertThat(corrections.rows.get(0).getCorrectedTier()).isEqualTo(ReviewTriageTier.NEEDS_ATTENTION);
    }

    @Test
    @DisplayName("only CLASSIFIER_ERROR reaches a snapshot; SELLER_PREFERENCE never does")
    void theSeparationHolds() {
        TriageCorrection error = correctionFor(recordOk());
        TriageCorrection preference = correctionFor(service.record(ORG, UUID.randomUUID(), 5, "좋아요", "m",
                ReviewTriageClassifier.Result.ok(ReviewTriageTier.FYI, "PRAISE_ONLY", List.of(),
                        TriageSuggestedAction.NONE, "v/1")));

        service.disposition(ORG, error.getId(), CorrectionDispositionKind.CLASSIFIER_ERROR, null);
        service.disposition(ORG, preference.getId(), CorrectionDispositionKind.SELLER_PREFERENCE, null);

        assertThat(service.freezeSnapshot(ORG, "snapshot/1")).isEqualTo(1);

        Map<CorrectionDispositionKind, String> stamped = new HashMap<>();
        dispositions.rows.forEach(r -> stamped.put(r.getDisposition(), r.getSnapshotVersion()));
        assertThat(stamped.get(CorrectionDispositionKind.CLASSIFIER_ERROR)).isEqualTo("snapshot/1");
        assertThat(stamped.get(CorrectionDispositionKind.SELLER_PREFERENCE))
                .as("a seller's preference is a fact about their catalog, not about the classifier")
                .isNull();
    }

    @Test
    @DisplayName("a frozen snapshot does not take the same row twice, and cannot be re-dispositioned")
    void aSnapshotIsFrozen() {
        TriageCorrection correction = correctionFor(recordOk());
        service.disposition(ORG, correction.getId(), CorrectionDispositionKind.CLASSIFIER_ERROR, null);
        service.freezeSnapshot(ORG, "snapshot/1");

        assertThat(service.freezeSnapshot(ORG, "snapshot/2"))
                .as("a row already counted must not be counted again — it would double-weight silently")
                .isZero();
        assertThatThrownBy(() -> service.disposition(ORG, correction.getId(),
                CorrectionDispositionKind.SELLER_PREFERENCE, null)).isInstanceOf(ApiException.class);
    }

    @Test
    @DisplayName("nothing here can train anything — there is no such method")
    void nothingTrains() {
        // The guarantee is structural: the service has no path from a correction to a classifier.
        assertThat(TriageFeedbackService.class.getDeclaredMethods())
                .noneMatch(m -> m.getName().toLowerCase().matches(".*(train|learn|apply|promote).*"));
    }

    private TriageCorrection correctionFor(TriagePrediction prediction) {
        return service.correct(ORG, prediction.getId(), ReviewTriageTier.NEEDS_ATTENTION,
                "DEFECT_OR_DAMAGE", List.of());
    }

    // ── in-memory repositories ───────────────────────────────────────────────────────────────
    //
    // Mockito mocks of the real interfaces, backed by a list, rather than hand-written classes: the
    // interfaces extend JpaRepository and implementing it would be twenty stub methods that say
    // nothing. The mock is the real type, so a signature change here still breaks the build.

    /** Assigns an id on first save, exactly as the JPA provider would, and keeps the row. */
    private static <T> T store(List<T> rows, T row) {
        try {
            Field id = row.getClass().getSuperclass().getDeclaredField("id");
            id.setAccessible(true);
            if (id.get(row) == null) {
                id.set(row, UUID.randomUUID());
                rows.add(row);
            }
        } catch (ReflectiveOperationException e) {
            throw new IllegalStateException(e);
        }
        return row;
    }

    private static class FakePredictions {
        final List<TriagePrediction> rows = new ArrayList<>();
        final TriagePredictionRepository repo = org.mockito.Mockito.mock(TriagePredictionRepository.class);

        FakePredictions() {
            org.mockito.Mockito.when(repo.save(org.mockito.ArgumentMatchers.any()))
                    .thenAnswer(i -> store(rows, i.getArgument(0)));
            org.mockito.Mockito.when(repo.findById(org.mockito.ArgumentMatchers.any()))
                    .thenAnswer(i -> rows.stream()
                            .filter(r -> r.getId().equals(i.getArgument(0))).findFirst());
        }
    }

    private static class FakeCorrections {
        final List<TriageCorrection> rows = new ArrayList<>();
        final TriageCorrectionRepository repo = org.mockito.Mockito.mock(TriageCorrectionRepository.class);

        FakeCorrections() {
            org.mockito.Mockito.when(repo.save(org.mockito.ArgumentMatchers.any()))
                    .thenAnswer(i -> store(rows, i.getArgument(0)));
            org.mockito.Mockito.when(repo.findById(org.mockito.ArgumentMatchers.any()))
                    .thenAnswer(i -> rows.stream()
                            .filter(r -> r.getId().equals(i.getArgument(0))).findFirst());
            org.mockito.Mockito.when(repo.findByPredictionId(org.mockito.ArgumentMatchers.any()))
                    .thenAnswer(i -> rows.stream()
                            .filter(r -> i.getArgument(0).equals(r.getPredictionId())).findFirst());
            org.mockito.Mockito.when(repo.findByReviewId(org.mockito.ArgumentMatchers.any()))
                    .thenAnswer(i -> rows.stream()
                            .filter(r -> i.getArgument(0).equals(r.getReviewId())).findFirst());
        }
    }

    private static class FakeCurrent {
        final List<AiTriageCurrent> rows = new ArrayList<>();
        final AiTriageCurrentRepository repo = org.mockito.Mockito.mock(AiTriageCurrentRepository.class);

        FakeCurrent() {
            org.mockito.Mockito.when(repo.save(org.mockito.ArgumentMatchers.any()))
                    .thenAnswer(i -> store(rows, i.getArgument(0)));
            org.mockito.Mockito.when(repo.findByReviewId(org.mockito.ArgumentMatchers.any()))
                    .thenAnswer(i -> rows.stream()
                            .filter(r -> i.getArgument(0).equals(r.getReviewId())).findFirst());
            org.mockito.Mockito.when(repo.findByOrgIdAndReviewIdIn(org.mockito.ArgumentMatchers.any(),
                            org.mockito.ArgumentMatchers.any()))
                    .thenAnswer(i -> rows.stream()
                            .filter(r -> r.getOrgId().equals(i.getArgument(0))
                                    && ((java.util.Collection<?>) i.getArgument(1)).contains(r.getReviewId()))
                            .toList());
        }
    }

    private static class FakeActions {
        final List<TriageAction> rows = new ArrayList<>();
        final TriageActionRepository repo = org.mockito.Mockito.mock(TriageActionRepository.class);

        FakeActions() {
            org.mockito.Mockito.when(repo.save(org.mockito.ArgumentMatchers.any()))
                    .thenAnswer(i -> store(rows, i.getArgument(0)));
            org.mockito.Mockito.when(repo.saveAll(org.mockito.ArgumentMatchers.any()))
                    .thenAnswer(i -> i.getArgument(0));
            org.mockito.Mockito.when(repo.findByOrgIdAndSnapshotVersionIsNull(org.mockito.ArgumentMatchers.any()))
                    .thenAnswer(i -> rows.stream()
                            .filter(r -> r.getOrgId().equals(i.getArgument(0)) && r.getSnapshotVersion() == null)
                            .toList());
        }
    }

    private static class FakeBehavior {
        final List<TriageBehaviorEvent> rows = new ArrayList<>();
        final TriageBehaviorEventRepository repo = org.mockito.Mockito.mock(TriageBehaviorEventRepository.class);

        FakeBehavior() {
            org.mockito.Mockito.when(repo.saveAll(org.mockito.ArgumentMatchers.any()))
                    .thenAnswer(i -> {
                        for (TriageBehaviorEvent e : (List<TriageBehaviorEvent>) i.getArgument(0)) {
                            store(rows, e);
                        }
                        return i.getArgument(0);
                    });
            org.mockito.Mockito.when(repo.findByOrgIdAndSnapshotVersionIsNull(org.mockito.ArgumentMatchers.any()))
                    .thenAnswer(i -> rows.stream()
                            .filter(r -> r.getOrgId().equals(i.getArgument(0)) && r.getSnapshotVersion() == null)
                            .toList());
        }
    }

    private static class FakeDispositions {
        final List<CorrectionDisposition> rows = new ArrayList<>();
        final CorrectionDispositionRepository repo = org.mockito.Mockito.mock(CorrectionDispositionRepository.class);

        FakeDispositions() {
            org.mockito.Mockito.when(repo.save(org.mockito.ArgumentMatchers.any()))
                    .thenAnswer(i -> store(rows, i.getArgument(0)));
            org.mockito.Mockito.when(repo.findByCorrectionId(org.mockito.ArgumentMatchers.any()))
                    .thenAnswer(i -> rows.stream()
                            .filter(r -> r.getCorrectionId().equals(i.getArgument(0))).findFirst());
            org.mockito.Mockito.when(repo.findByOrgIdAndDispositionAndSnapshotVersionIsNull(
                            org.mockito.ArgumentMatchers.any(), org.mockito.ArgumentMatchers.any()))
                    .thenAnswer(i -> rows.stream()
                            .filter(r -> r.getOrgId().equals(i.getArgument(0))
                                    && r.getDisposition() == i.getArgument(1)
                                    && r.getSnapshotVersion() == null)
                            .toList());
        }
    }
}
