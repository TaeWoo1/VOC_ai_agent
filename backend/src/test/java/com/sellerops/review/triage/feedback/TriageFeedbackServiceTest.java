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
    private TriageFeedbackService service;

    @BeforeEach
    void setUp() {
        predictions = new FakePredictions();
        corrections = new FakeCorrections();
        dispositions = new FakeDispositions();
        service = new TriageFeedbackService(predictions.repo, corrections.repo, dispositions.repo, FIXED);
    }

    private TriagePrediction recordOk() {
        return service.record(ORG, REVIEW, "test-model", ReviewTriageClassifier.Result.ok(
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
    @DisplayName("a failed classification is stored, not dropped")
    void failuresAreRecorded() {
        // A run whose failures vanished would report metrics over the rows that happened to succeed
        // and call that the model's accuracy.
        TriagePrediction row = service.record(ORG, REVIEW, "test-model",
                ReviewTriageClassifier.Result.failed("v/1", "http 529"));

        assertThat(row.getStatus()).isEqualTo(ReviewTriageClassifier.Status.CLASSIFICATION_FAILED);
        assertThat(row.getTier()).as("a failure has no tier — never FYI").isNull();
        assertThat(row.getFailureReason()).isEqualTo("http 529");
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
        TriagePrediction failed = service.record(ORG, REVIEW, "m",
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
        TriageCorrection preference = correctionFor(service.record(ORG, UUID.randomUUID(), "m",
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
                            .filter(r -> r.getPredictionId().equals(i.getArgument(0))).findFirst());
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
