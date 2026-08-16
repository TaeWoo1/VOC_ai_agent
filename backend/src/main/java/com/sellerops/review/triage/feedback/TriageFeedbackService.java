package com.sellerops.review.triage.feedback;

import com.sellerops.common.ApiException;
import com.sellerops.review.triage.ReviewTriageTier;
import com.sellerops.review.triage.TriageReasonCode;
import com.sellerops.review.triage.llm.ReviewTriageClassifier;
import com.sellerops.review.triage.llm.TriagePrompt;
import java.time.Clock;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Writes the three records of {@code docs/slices/llm-triage-classifier-v1.md} §6, and refuses to
 * blur them.
 *
 * <p><b>Nothing here trains anything.</b> A correction changes no running classifier and rewrites no
 * gold label. It becomes a row that a person later dispositions, and only the
 * {@link CorrectionDispositionKind#CLASSIFIER_ERROR} half of that ever reaches an evaluation set — a
 * frozen, numbered snapshot, offline, against the NEXT classifier version.
 *
 * <p><b>No surface reads any of this yet.</b> {@code contracts/review-eval/naver/v1/RUBRIC.md} §5
 * gates a text-derived detector behind precision, recall and false-positive bars that nothing has
 * cleared and a holdout that is unread. {@code ReviewTriageRules} still owns every tier a seller
 * sees; these rows exist to be measured.
 */
@Service
public class TriageFeedbackService {

    private final TriagePredictionRepository predictions;
    private final TriageCorrectionRepository corrections;
    private final CorrectionDispositionRepository dispositions;
    private final Clock clock;

    @Autowired
    public TriageFeedbackService(TriagePredictionRepository predictions,
                                 TriageCorrectionRepository corrections,
                                 CorrectionDispositionRepository dispositions) {
        this(predictions, corrections, dispositions, Clock.systemUTC());
    }

    /** Test seam: an explicit {@link Clock}, the same shape {@code ReviewReplyService} uses. */
    TriageFeedbackService(TriagePredictionRepository predictions,
                          TriageCorrectionRepository corrections,
                          CorrectionDispositionRepository dispositions,
                          Clock clock) {
        this.predictions = predictions;
        this.corrections = corrections;
        this.dispositions = dispositions;
        this.clock = clock;
    }

    /**
     * Record what the classifier said, including when it said nothing.
     *
     * <p>A failure is stored rather than dropped. A run whose failures vanished would report metrics
     * over the rows that happened to succeed and call that the model's accuracy.
     */
    @Transactional
    public TriagePrediction record(UUID orgId, UUID reviewId, String modelId,
                                   ReviewTriageClassifier.Result result) {
        TriagePrediction row = new TriagePrediction();
        row.setOrgId(orgId);
        row.setReviewId(reviewId);
        row.setStatus(result.status());
        row.setTier(result.tier());
        row.setReasonCode(result.reasonCode());
        row.setTags(result.tags().isEmpty() ? null : String.join(",", result.tags()));
        row.setSuggestedNextAction(result.suggestedNextAction());
        row.setClassifierVersion(result.classifierVersion());
        row.setModelId(modelId);
        row.setPromptHash(TriagePrompt.promptHash());
        row.setFailureReason(result.failureReason());
        row.setPredictedAt(Instant.now(clock));
        return predictions.save(row);
    }

    /**
     * The seller's correction, scoped to the prediction it corrects.
     *
     * <p>Refuses a correction on a prediction that never produced a tier. "Correcting" a
     * {@code CLASSIFICATION_FAILED} row would record a disagreement with an answer nobody gave, and
     * that row would then count as a classifier error in a snapshot.
     */
    @Transactional
    public TriageCorrection correct(UUID orgId, UUID predictionId, ReviewTriageTier tier,
                                    String reasonCode, List<String> tags) {
        TriagePrediction prediction = predictions.findById(predictionId)
                .filter(p -> p.getOrgId().equals(orgId))
                .orElseThrow(() -> ApiException.notFound("해당 분류 결과를 찾을 수 없습니다."));
        if (prediction.getStatus() != ReviewTriageClassifier.Status.OK) {
            throw ApiException.badRequest("분류가 완료되지 않은 항목은 수정할 수 없습니다.");
        }
        if (reasonCode != null && TriageReasonCode.parse(reasonCode).isEmpty()) {
            throw ApiException.badRequest("알 수 없는 분류 사유입니다.");
        }
        TriageCorrection row = corrections.findByPredictionId(predictionId).orElseGet(TriageCorrection::new);
        row.setOrgId(orgId);
        row.setPredictionId(predictionId);
        row.setCorrectedTier(tier);
        row.setCorrectedReasonCode(reasonCode);
        row.setCorrectedTags(tags == null || tags.isEmpty() ? null : String.join(",", tags));
        row.setCorrectedAt(Instant.now(clock));
        return corrections.save(row);
    }

    /**
     * A human's reading of a correction. There is no inferring overload and there must not be one:
     * the correction row is identical whether the classifier was wrong or the seller simply wants
     * something else, so anything that guessed would be guessing.
     */
    @Transactional
    public CorrectionDisposition disposition(UUID orgId, UUID correctionId, CorrectionDispositionKind kind,
                                         UUID decidedBy) {
        corrections.findById(correctionId)
                .filter(c -> c.getOrgId().equals(orgId))
                .orElseThrow(() -> ApiException.notFound("해당 수정 내역을 찾을 수 없습니다."));
        CorrectionDisposition row = dispositions.findByCorrectionId(correctionId)
                .orElseGet(CorrectionDisposition::new);
        if (row.getSnapshotVersion() != null) {
            // Already folded into a numbered snapshot. Re-dispositioning would change what a frozen
            // evaluation set contained after it had been measured against.
            throw ApiException.badRequest("이미 고정된 평가 스냅샷에 포함된 항목입니다.");
        }
        row.setOrgId(orgId);
        row.setCorrectionId(correctionId);
        row.setDisposition(kind);
        row.setDecidedBy(decidedBy);
        row.setDecidedAt(Instant.now(clock));
        return dispositions.save(row);
    }

    /**
     * Cut a snapshot: stamp every loose {@code CLASSIFIER_ERROR} with a version and freeze it.
     *
     * <p>{@code SELLER_PREFERENCE} rows are not stamped and never will be. They are a fact about one
     * seller's catalog; folding them into a set that measures the global classifier would make the
     * classifier's accuracy a function of whichever sellers corrected most.
     *
     * @return how many rows the snapshot took
     */
    @Transactional
    public int freezeSnapshot(UUID orgId, String snapshotVersion) {
        List<CorrectionDisposition> loose = dispositions.findByOrgIdAndDispositionAndSnapshotVersionIsNull(
                orgId, CorrectionDispositionKind.CLASSIFIER_ERROR);
        for (CorrectionDisposition row : loose) {
            row.setSnapshotVersion(snapshotVersion);
        }
        dispositions.saveAll(loose);
        return loose.size();
    }
}
