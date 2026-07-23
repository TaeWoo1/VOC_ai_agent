package com.sellerops.attention.reply;

import com.sellerops.attention.reply.dto.ReviewReplyOutcomeResponse;
import com.sellerops.common.ApiException;
import java.security.SecureRandom;
import java.util.HexFormat;
import java.util.Optional;
import java.util.UUID;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.stereotype.Service;

/**
 * Mints single-use submission bindings and records the operator's report about their own manual
 * reply post — approve-guided, human-performed, explicitly UNVERIFIED.
 *
 * <p><b>Hermetic by construction.</b> Nothing here contacts a marketplace, sends text, or verifies a
 * post. It mints an opaque binding and appends an operator-reported outcome; that is the whole
 * capability.
 *
 * <p><b>Authorization and the disposition gate are the CALLER's job</b> — {@link ReviewReplyService}
 * owns both. This class owns the binding, the append, its idempotency, and its single-use guarantee.
 *
 * <p>Carries no {@code @Transactional}, and must not gain one: see {@link ReviewReplyOutcomeWriter},
 * whose recovery contract depends on {@link #record} observing the constraint violation itself.
 */
@Service
public class ReviewReplyOutcomeService {

    private static final SecureRandom RANDOM = new SecureRandom();

    private final ReviewReplySubmissionRefRepository refs;
    private final ReviewReplyOutcomeRepository outcomes;
    private final ReviewReplyOutcomeWriter writer;

    public ReviewReplyOutcomeService(ReviewReplySubmissionRefRepository refs,
                                     ReviewReplyOutcomeRepository outcomes,
                                     ReviewReplyOutcomeWriter writer) {
        this.refs = refs;
        this.outcomes = outcomes;
        this.writer = writer;
    }

    /**
     * Mint a fresh, single-use {@code submissionRef} bound to an approved head. Each call mints a new
     * ref (a new potential guided run); single-use is enforced at record time, not here.
     *
     * <p>The ref is an opaque 16-hex token — the exact shape the Action Window contract's
     * {@code submissionRef} requires, and never reversible to a review id.
     */
    public String mint(UUID orgId, UUID reviewId, int boundVersion, String boundFingerprint, String actor) {
        ReviewReplySubmissionRef row = new ReviewReplySubmissionRef();
        row.setOrgId(orgId);
        row.setReviewId(reviewId);
        row.setSubmissionRef(newSubmissionRef());
        row.setBoundVersion(boundVersion);
        row.setBoundFingerprint(boundFingerprint);
        row.setCreatedBy(actor);
        return refs.save(row).getSubmissionRef();
    }

    /** The binding behind a ref, org-scoped; empty when unknown or cross-org. */
    public Optional<ReviewReplySubmissionRef> binding(UUID orgId, String submissionRef) {
        return refs.findByOrgIdAndSubmissionRef(orgId, submissionRef);
    }

    /** Whether a binding has already been spent (an outcome recorded against it). */
    public boolean isSpent(String submissionRef) {
        return outcomes.findBySubmissionRef(submissionRef).isPresent();
    }

    /** Whether this command id has already had an effect in this org (for the caller's gateOrReplay). */
    public boolean isCommandSpent(UUID orgId, String commandId) {
        return outcomes.findByOrgIdAndCommandId(orgId,
                ReviewReplyApprovalService.requireCommandId(commandId)).isPresent();
    }

    /** The latest outcome recorded for one approved version of a review, if any. */
    public Optional<ReviewReplyOutcome> latestForVersion(UUID orgId, UUID reviewId, int recordedVersion) {
        return outcomes.findTopByOrgIdAndReviewIdAndRecordedVersionOrderByCreatedAtDesc(
                orgId, reviewId, recordedVersion);
    }

    /**
     * Append an operator-reported outcome (assumes the caller already authorized, gated, and resolved
     * the binding). Version + fingerprint are server-sourced from the binding.
     *
     * <p><b>Idempotency.</b> {@code commandId} is client-generated and unique per org. An exact replay
     * — same command id, same review, same binding, same reported outcome — writes nothing and returns
     * {@code replayed=true}. Reusing a command id for anything else is a 409.
     *
     * <p><b>Concurrency.</b> The lookup below is only a fast path; correctness comes from the two
     * UNIQUE constraints, which serialize writers and let the loser re-resolve ({@link #resolveRace})
     * rather than fail.
     */
    public ReviewReplyOutcomeResponse record(UUID orgId, UUID reviewId, String actionRef,
                                             String submissionRef, Integer recordedVersion,
                                             String recordedFingerprint, String fingerprintAlgorithm,
                                             OperatorOutcome operatorOutcome, String awRunRef,
                                             String commandId, String actor) {
        String command = ReviewReplyApprovalService.requireCommandId(commandId);
        // A caller with no guided run says so by OMISSION. Normalising blank to null keeps a client
        // that sends "" from creating a third state that is neither a run nor an honest absence —
        // and there is no placeholder it could send that would be true.
        String runRef = awRunRef == null || awRunRef.isBlank() ? null : awRunRef.strip();

        // Fast path only — NOT the correctness boundary.
        Optional<ReviewReplyOutcome> prior = outcomes.findByOrgIdAndCommandId(orgId, command);
        if (prior.isPresent()) {
            return replay(prior.get(), reviewId, submissionRef, operatorOutcome, actionRef);
        }

        try {
            writer.appendOutcome(orgId, reviewId, submissionRef, recordedVersion, recordedFingerprint,
                    fingerprintAlgorithm, operatorOutcome, runRef, command, actor);
            return new ReviewReplyOutcomeResponse(actionRef, true, false);
        } catch (DataIntegrityViolationException race) {
            return resolveRace(race, orgId, reviewId, actionRef, submissionRef, operatorOutcome, command);
        }
    }

    /**
     * A concurrent caller won a UNIQUE race. Work out which one, and answer as if we had simply
     * arrived second — never with a 500.
     */
    private ReviewReplyOutcomeResponse resolveRace(DataIntegrityViolationException race, UUID orgId,
                                                   UUID reviewId, String actionRef, String submissionRef,
                                                   OperatorOutcome operatorOutcome, String command) {
        // (a) uq_review_reply_outcome_org_command — this exact command id already landed (our own
        // request lost to a copy of itself); the effect the caller asked for has happened.
        Optional<ReviewReplyOutcome> raced = outcomes.findByOrgIdAndCommandId(orgId, command);
        if (raced.isPresent()) {
            return replay(raced.get(), reviewId, submissionRef, operatorOutcome, actionRef);
        }
        // (b) uq_review_reply_outcome_submission_ref — a DIFFERENT command already spent this binding.
        // This IS the single-use / anti-double-post guarantee firing under concurrency: refuse, do not
        // append a second outcome to a binding meant to carry one.
        if (outcomes.findBySubmissionRef(submissionRef).isPresent()) {
            throw ApiException.conflict("이미 결과가 기록된 제출입니다. 다시 시작해 주세요.");
        }
        // Neither constraint explains this — do not guess.
        throw race;
    }

    /**
     * A command id already spent in this org: either the exact same effect (nothing written) or a
     * different one (409). The effect is (review, binding, reported outcome) — the recorded version
     * and fingerprint are determined by the binding, so comparing the ref is sufficient.
     */
    private ReviewReplyOutcomeResponse replay(ReviewReplyOutcome prior, UUID reviewId,
                                              String submissionRef, OperatorOutcome operatorOutcome,
                                              String actionRef) {
        boolean sameReview = prior.getReviewId().equals(reviewId);
        boolean sameBinding = prior.getSubmissionRef().equals(submissionRef);
        if (!sameReview || !sameBinding || prior.getOperatorOutcome() != operatorOutcome) {
            throw ApiException.conflict("commandId가 이미 다른 결정에 사용되었습니다.");
        }
        return new ReviewReplyOutcomeResponse(actionRef, true, true);
    }

    /** A fresh opaque 16-hex token (8 random bytes) — matches the contract's {@code submissionRef} shape. */
    private static String newSubmissionRef() {
        byte[] bytes = new byte[8];
        RANDOM.nextBytes(bytes);
        return HexFormat.of().formatHex(bytes);
    }
}
