package com.sellerops.review.triage.feedback;

import com.sellerops.common.ApiException;
import com.sellerops.review.triage.ReviewTriageRules;
import com.sellerops.review.triage.ReviewTriageTier;
import com.sellerops.review.triage.TriageReasonCode;
import com.sellerops.review.triage.llm.AdditiveTriageDecision;
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
 * <p><b>One surface reads one of these, additively.</b> RUBRIC v2 §13.7's conservative pilot lets
 * {@link AiTriageCurrent#isAiAttention()} raise a review the rule left lower and mark it
 * {@code AI 확인 필요}. It may not lower anything, it does not own {@code WATCH}/{@code FYI}, and it is
 * a candidate's suggestion displayed as such — never merged into the rules tier. Everything else
 * here is written to be measured, not read.
 *
 * <p><b>Three strengths of evidence, in three tables</b> (feedback draft §7): a correction and an
 * action are explicit — the seller answered a question or pressed a control that says what they did.
 * A behaviour event is silver — a trace of navigation, weighted at snapshot time, never a label.
 */
@Service
public class TriageFeedbackService {

    private final TriagePredictionRepository predictions;
    private final TriageCorrectionRepository corrections;
    private final CorrectionDispositionRepository dispositions;
    private final AiTriageCurrentRepository current;
    private final TriageActionRepository actions;
    private final TriageBehaviorEventRepository behavior;
    private final Clock clock;

    @Autowired
    public TriageFeedbackService(TriagePredictionRepository predictions,
                                 TriageCorrectionRepository corrections,
                                 CorrectionDispositionRepository dispositions,
                                 AiTriageCurrentRepository current,
                                 TriageActionRepository actions,
                                 TriageBehaviorEventRepository behavior) {
        this(predictions, corrections, dispositions, current, actions, behavior, Clock.systemUTC());
    }

    /** Test seam: an explicit {@link Clock}, the same shape {@code ReviewReplyService} uses. */
    TriageFeedbackService(TriagePredictionRepository predictions,
                          TriageCorrectionRepository corrections,
                          CorrectionDispositionRepository dispositions,
                          AiTriageCurrentRepository current,
                          TriageActionRepository actions,
                          TriageBehaviorEventRepository behavior,
                          Clock clock) {
        this.predictions = predictions;
        this.corrections = corrections;
        this.dispositions = dispositions;
        this.current = current;
        this.actions = actions;
        this.behavior = behavior;
        this.clock = clock;
    }

    /**
     * Record what the classifier said, including when it said nothing.
     *
     * <p>A failure is stored rather than dropped. A run whose failures vanished would report metrics
     * over the rows that happened to succeed and call that the model's accuracy.
     *
     * <p><b>The additive guard of RUBRIC v2 §8.9 is applied HERE</b>, not by the caller. It takes the
     * rating and the body — the same two things the classifier was given — and computes the baseline
     * itself, so no caller can weaken the invariant by supplying a baseline of its own. Neither value
     * is stored; they exist inside this method only long enough to produce a tier.
     *
     * <p>Before the independent review of candidate B this guard ran in the evaluation harness and
     * nowhere else, which meant every stored row stamped {@code +additive-guard/v1} onto a tier the
     * guard had never seen.
     */
    @Transactional
    public TriagePrediction record(UUID orgId, UUID reviewId, Integer rating, String body,
                                   String modelId, ReviewTriageClassifier.Result result) {
        ReviewTriageTier baseline = ReviewTriageRules.tier(rating, body);
        TriagePrediction row = new TriagePrediction();
        row.setOrgId(orgId);
        row.setReviewId(reviewId);
        row.setStatus(result.status());
        row.setModelTier(result.tier());
        row.setTier(AdditiveTriageDecision.decide(baseline, result.tier()));
        row.setReasonCode(result.reasonCode());
        row.setTags(result.tags().isEmpty() ? null : String.join(",", result.tags()));
        row.setSuggestedNextAction(result.suggestedNextAction());
        row.setClassifierVersion(result.classifierVersion());
        row.setModelId(modelId);
        row.setPromptHash(TriagePrompt.promptHash());
        row.setFailureReason(result.failureReason());
        row.setPredictedAt(Instant.now(clock));
        TriagePrediction saved = predictions.save(row);
        refreshCurrent(orgId, reviewId, baseline, saved);
        return saved;
    }

    /**
     * The one row the surface reads (RUBRIC v2 §13.7).
     *
     * <p>{@code aiAttention} is true exactly when the guarded tier is {@code NEEDS_ATTENTION} and the
     * rule's own tier is not — i.e. when the classifier ADDED something. Where the rule already said
     * 확인 필요 the mark is false, because there is nothing for the pilot to add and showing
     * {@code AI 확인 필요} on a row the rating alone put there would let the seller credit the model
     * for the rule's work. A failed classification lands on the baseline and therefore adds nothing.
     */
    private void refreshCurrent(UUID orgId, UUID reviewId, ReviewTriageTier baseline, TriagePrediction saved) {
        boolean added = saved.getTier() == ReviewTriageTier.NEEDS_ATTENTION
                && baseline != ReviewTriageTier.NEEDS_ATTENTION;
        AiTriageCurrent row = current.findByReviewId(reviewId).orElseGet(AiTriageCurrent::new);
        row.setOrgId(orgId);
        row.setReviewId(reviewId);
        row.setPredictionId(saved.getId());
        row.setAiAttention(added);
        row.setClassifierVersion(saved.getClassifierVersion());
        row.setReasonCode(saved.getReasonCode());
        row.setPredictedAt(saved.getPredictedAt());
        current.save(row);
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
            // A prediction with no model answer carries only the baseline, which is the rule's
            // judgment rather than the classifier's. Correcting it would record a disagreement with
            // an answer nobody gave.
            throw ApiException.badRequest("분류가 완료되지 않은 항목은 수정할 수 없습니다.");
        }
        if (reasonCode != null && TriageReasonCode.parse(reasonCode).isEmpty()) {
            throw ApiException.badRequest("알 수 없는 분류 사유입니다.");
        }
        TriageCorrection row = corrections.findByReviewId(prediction.getReviewId()).orElseGet(TriageCorrection::new);
        row.setOrgId(orgId);
        row.setReviewId(prediction.getReviewId());
        row.setPredictionId(predictionId);
        row.setShownTier(prediction.getTier());
        row.setShownSource(TriageShownSource.AI);
        row.setCorrectedTier(tier);
        row.setCorrectedReasonCode(reasonCode);
        row.setCorrectedTags(tags == null || tags.isEmpty() ? null : String.join(",", tags));
        row.setCorrectedAt(Instant.now(clock));
        return corrections.save(row);
    }

    /**
     * The seller's correction on a REVIEW — the pilot's write path.
     *
     * <p>Where the pilot has a current prediction for the review it is linked; where it does not,
     * the correction is of the rule's own tier and says so ({@link TriageShownSource#RULES}). Both
     * are strong evidence, neither is gold, and neither says why until dispositioned.
     *
     * <p>{@code tier} is the seller's binary answer, {@code NEEDS_ATTENTION} or not. A seller does
     * not choose between {@code WATCH} and {@code FYI} here — that split is the rule's and the pilot
     * does not own it (§13.7 item 1) — so "필요 없음" is stored as the rule's own non-attention tier
     * for the row rather than as a tier the seller never saw.
     */
    @Transactional
    public TriageCorrection correctReview(UUID orgId, UUID reviewId, Integer rating, String body,
                                          boolean needsAttention, String reasonCode, boolean aiSurfaceOn) {
        if (reasonCode != null && TriageReasonCode.parse(reasonCode).isEmpty()) {
            throw ApiException.badRequest("알 수 없는 분류 사유입니다.");
        }
        ReviewTriageTier ruleTier = ReviewTriageRules.tier(rating, body);
        Shown shown = shown(reviewId, ruleTier, aiSurfaceOn, current.findByReviewId(reviewId).orElse(null));
        TriageCorrection row = corrections.findByReviewId(reviewId).orElseGet(TriageCorrection::new);
        row.setOrgId(orgId);
        row.setReviewId(reviewId);
        row.setPredictionId(shown.predictionId());
        row.setShownTier(shown.tier());
        row.setShownSource(shown.source());
        row.setCorrectedTier(needsAttention ? ReviewTriageTier.NEEDS_ATTENTION
                : ruleTier == ReviewTriageTier.NEEDS_ATTENTION ? ReviewTriageTier.WATCH : ruleTier);
        row.setCorrectedReasonCode(reasonCode);
        row.setCorrectedTags(null);
        row.setCorrectedAt(Instant.now(clock));
        return corrections.save(row);
    }

    /** An explicit act. Append-only; see {@link TriageActionKind}. */
    @Transactional
    public TriageAction act(UUID orgId, UUID reviewId, Integer rating, String body, TriageActionKind kind,
                            UUID actorId, boolean aiSurfaceOn) {
        Shown shown = shown(reviewId, ReviewTriageRules.tier(rating, body), aiSurfaceOn,
                current.findByReviewId(reviewId).orElse(null));
        TriageAction row = new TriageAction();
        row.setOrgId(orgId);
        row.setReviewId(reviewId);
        row.setPredictionId(shown.predictionId());
        row.setKind(kind);
        row.setShownTier(shown.tier());
        row.setShownSource(shown.source());
        row.setActorId(actorId);
        row.setActedAt(Instant.now(clock));
        return actions.save(row);
    }

    /**
     * A silver trace. Append-only, unweighted here — see {@link TriageBehaviorEvent}.
     *
     * <p>Batched by the caller because {@code EXPOSED} fires once per rendered row and a request per
     * row would make the list slower to record than to read.
     */
    @Transactional
    public int observe(UUID orgId, List<Observation> observations, boolean aiSurfaceOn) {
        List<TriageBehaviorEvent> rows = new java.util.ArrayList<>(observations.size());
        Instant now = Instant.now(clock);
        // One query for the batch's current rows, not one or two per event: an EXPOSED batch fires
        // once per rendered row, on every list load.
        java.util.Map<UUID, AiTriageCurrent> currents = new java.util.HashMap<>();
        for (AiTriageCurrent c : current.findByOrgIdAndReviewIdIn(orgId,
                observations.stream().map(Observation::reviewId).toList())) {
            currents.put(c.getReviewId(), c);
        }
        for (Observation o : observations) {
            Shown shown = shown(o.reviewId(), ReviewTriageRules.tier(o.rating(), o.body()), aiSurfaceOn,
                    currents.get(o.reviewId()));
            TriageBehaviorEvent row = new TriageBehaviorEvent();
            row.setOrgId(orgId);
            row.setReviewId(o.reviewId());
            row.setPredictionId(shown.predictionId());
            row.setKind(o.kind());
            row.setShownTier(shown.tier());
            row.setShownSource(shown.source());
            row.setOccurredAt(now);
            rows.add(row);
        }
        behavior.saveAll(rows);
        return rows.size();
    }

    /** One behaviour observation, as the caller hands it in. Carries no content past this method. */
    public record Observation(UUID reviewId, Integer rating, String body, TriageBehaviorKind kind) {
    }

    private record Shown(UUID predictionId, ReviewTriageTier tier, TriageShownSource source) {
    }

    /**
     * What the seller was looking at: the pilot's mark if the surface showed one, else the rule's tier.
     *
     * <p>Computed from the same predicate the surface uses, never asserted by the client. Three
     * conditions, and all three are the read path's ({@code ChannelReviewService.marksOf}): the org's
     * pilot is ON ({@code aiSurfaceOn}, decided server-side by the caller), the current row says
     * {@code aiAttention}, and the rule did NOT already say 확인 필요. Miss any one and the seller saw
     * the rules chip alone, so the row is {@code RULES} — an org switched off after a run must not
     * keep producing {@code AI}-shown evidence for a mark nobody could see (independent review, D2).
     * The prediction id is still linked where one exists, because the history is still the history.
     */
    private Shown shown(UUID reviewId, ReviewTriageTier ruleTier, boolean aiSurfaceOn, AiTriageCurrent row) {
        UUID predictionId = row == null ? null : row.getPredictionId();
        boolean aiShown = aiSurfaceOn && row != null && row.isAiAttention()
                && ruleTier != ReviewTriageTier.NEEDS_ATTENTION;
        return aiShown
                ? new Shown(predictionId, ReviewTriageTier.NEEDS_ATTENTION, TriageShownSource.AI)
                : new Shown(predictionId, ruleTier, TriageShownSource.RULES);
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

    /**
     * Cut a SILVER snapshot: stamp every loose action and behaviour event with a version.
     *
     * <p>A separate call and a separate version string from {@link #freezeSnapshot}, and it must stay
     * that way — feedback draft §7.4: a silver snapshot may never be merged into a correction
     * snapshot, because a single combined file is how the weaker evidence stops being visible.
     */
    @Transactional
    public int freezeSilverSnapshot(UUID orgId, String snapshotVersion) {
        List<TriageAction> looseActions = actions.findByOrgIdAndSnapshotVersionIsNull(orgId);
        looseActions.forEach(a -> a.setSnapshotVersion(snapshotVersion));
        actions.saveAll(looseActions);
        List<TriageBehaviorEvent> looseEvents = behavior.findByOrgIdAndSnapshotVersionIsNull(orgId);
        looseEvents.forEach(e -> e.setSnapshotVersion(snapshotVersion));
        behavior.saveAll(looseEvents);
        return looseActions.size() + looseEvents.size();
    }
}
