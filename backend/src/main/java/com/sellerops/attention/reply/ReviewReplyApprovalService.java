package com.sellerops.attention.reply;

import com.sellerops.common.ApiException;
import com.sellerops.attention.reply.dto.ReviewReplyApprovalResponse;
import java.util.Objects;
import java.util.Optional;
import java.util.UUID;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.stereotype.Service;

/**
 * Records one operator's approval decision about one review's reply draft — approve (freeze +
 * bind) or withdraw (unfreeze + unbind).
 *
 * <p><b>Hermetic by construction.</b> Nothing here contacts a marketplace, sends text, or
 * queues an action. Approving freezes a draft and marks it copy-ready; that is the whole
 * capability, and it is deliberately the whole capability.
 *
 * <p><b>Authorization and the disposition gate are the CALLER's job</b> —
 * {@link ReviewReplyService} owns both. This class owns the transition, its idempotency, and
 * its trail.
 *
 * <p>Carries no {@code @Transactional}, and must not gain one: see
 * {@link ReviewReplyApprovalWriter}, whose recovery contract depends on this method observing
 * the constraint violation itself.
 */
@Service
public class ReviewReplyApprovalService {

    /**
     * Ceiling on the client-supplied command id, matching
     * {@code review_reply_approval_audit.command_id} in V19.
     *
     * <p>Checked here rather than left to the column, because the column cannot be trusted to
     * check it where it matters: tests run on H2 with the schema generated from the entities,
     * so this bound exists there only because {@link ReviewReplyApprovalAudit} pins
     * {@code length}. With the guard it is a 400 everywhere rather than a production-only 500.
     */
    static final int MAX_COMMAND_ID_LEN = 120;

    private final ReviewReplyApprovalRepository approvals;
    private final ReviewReplyApprovalAuditRepository audits;
    private final ReviewReplyApprovalWriter writer;

    public ReviewReplyApprovalService(ReviewReplyApprovalRepository approvals,
                                      ReviewReplyApprovalAuditRepository audits,
                                      ReviewReplyApprovalWriter writer) {
        this.approvals = approvals;
        this.audits = audits;
        this.writer = writer;
    }

    /** The current approval for a review, if the operator has ever decided one. */
    public Optional<ReviewReplyApproval> current(UUID orgId, UUID reviewId) {
        return approvals.findByOrgIdAndReviewId(orgId, reviewId);
    }

    /**
     * Validate and normalize a client command id.
     *
     * <p>Static and public because the gate order depends on it: {@link ReviewReplyService} must
     * settle whether an id is well-formed BEFORE it can ask whether that id is already spent, and
     * a malformed id has to answer 400 rather than inherit whatever a closed gate would have
     * said. {@link #decide} calls it again — it is a pure function, so paying for it twice costs
     * nothing and removes the need to trust that a caller ran it.
     */
    public static String requireCommandId(String commandId) {
        if (commandId == null || commandId.isBlank()) {
            throw ApiException.badRequest("commandId가 필요합니다.");
        }
        String command = commandId.strip();
        if (command.length() > MAX_COMMAND_ID_LEN) {
            throw ApiException.badRequest("commandId가 너무 깁니다.");
        }
        return command;
    }

    /**
     * Whether this command id has already had an effect in this org.
     *
     * <p>Exists for {@code ReviewReplyService.gateOrReplay}: a gate closed by this command's own
     * earlier success must not refuse its retry. It answers only "already applied", never "the
     * same decision" — whether the prior effect MATCHES is {@link #replay}'s judgement, and
     * splitting that out would put the same comparison in two places.
     */
    public boolean isCommandSpent(UUID orgId, String commandId) {
        return audits.findByOrgIdAndCommandId(orgId, requireCommandId(commandId)).isPresent();
    }

    /**
     * Apply an approval transition (assumes the caller already authorized and gated).
     *
     * <p><b>Idempotency.</b> {@code commandId} is client-generated and unique per org. An exact
     * replay — same command id, same review, same target state, <b>same binding</b> — writes
     * nothing and returns the CURRENT state with {@code replayed=true}. Reusing a command id for
     * anything else is a 409, never a second effect. The binding is part of that comparison
     * because it is part of the effect; see {@link #replay}.
     *
     * <p>Re-deciding with a NEW command id is an ordinary update and appends a row. This class
     * does not itself forbid a transition into the state already held; {@link ReviewReplyService}
     * gates it at both ends (a standing approval freezes approving, and there is nothing to
     * withdraw once withdrawn), so a SEQUENTIAL caller cannot produce an {@code X → X} edge.
     *
     * <p><b>Concurrently, it can</b>, and the trail is honest about it rather than the Javadoc
     * being optimistic: that gate is a check-then-act with no lock across it, so two callers can
     * both read "not yet approved" and both commit, and the second records {@code APPROVED →
     * APPROVED}. {@code ReviewReplyApprovalConcurrencyTest} asserts exactly that edge. It is not
     * worth a lock: the writer's own {@code PESSIMISTIC_WRITE} still serializes the WRITES, so
     * the predecessor each row names is real and the terminal state is correct — the cost is one
     * redundant audit row and {@code decidedBy}/{@code decidedAt} attributed to whoever committed
     * last, neither of which misstates what the reply currently is. Nothing here is terminal in
     * either direction.
     *
     * <p><b>Concurrency.</b> The lookup below is only a fast path; correctness comes from the
     * UNIQUE constraints, which serialize writers and let the loser re-resolve
     * ({@link #resolveRace}) rather than fail. A concurrent exact replay returns the same 200 as
     * a sequential one.
     *
     * @param approvedVersion     the bound version for APPROVED; must be null for WITHDRAWN
     * @param approvedFingerprint the bound fingerprint for APPROVED; must be null for WITHDRAWN
     */
    public ReviewReplyApprovalResponse decide(UUID orgId, UUID reviewId, String actionRef,
                                              ReviewReplyApprovalState target, Integer approvedVersion,
                                              String approvedFingerprint, String commandId,
                                              String actor) {
        String command = requireCommandId(commandId);

        // Fast path only — NOT the correctness boundary.
        Optional<ReviewReplyApprovalAudit> prior = audits.findByOrgIdAndCommandId(orgId, command);
        if (prior.isPresent()) {
            return replay(prior.get(), reviewId, target, approvedVersion, actionRef);
        }

        try {
            writer.applyApproval(orgId, reviewId, target, approvedVersion, approvedFingerprint,
                    command, actor);
            return new ReviewReplyApprovalResponse(actionRef, target.name(), false);
        } catch (DataIntegrityViolationException race) {
            return resolveRace(race, orgId, reviewId, target, approvedVersion, approvedFingerprint,
                    command, actor, actionRef);
        }
    }

    /**
     * A concurrent caller won a UNIQUE race. Work out which one, and answer as if we had simply
     * arrived second — never with a 500.
     *
     * <p>The re-reads here are clean: {@link ReviewReplyApprovalWriter} commits inside
     * {@code tx.execute}, so by the time this runs the failed transaction has already ended and
     * each lookup opens its own.
     */
    private ReviewReplyApprovalResponse resolveRace(DataIntegrityViolationException race, UUID orgId,
                                                    UUID reviewId, ReviewReplyApprovalState target,
                                                    Integer approvedVersion, String approvedFingerprint,
                                                    String command, String actor, String actionRef) {
        // (a) uq_review_reply_approval_audit_org_command — this exact command id already landed.
        // Our own request lost to a copy of itself, so the effect the caller asked for has
        // happened.
        Optional<ReviewReplyApprovalAudit> raced = audits.findByOrgIdAndCommandId(orgId, command);
        if (raced.isPresent()) {
            return replay(raced.get(), reviewId, target, approvedVersion, actionRef);
        }
        // (b) uq_review_reply_approval_review — a DIFFERENT command created the row first. Our
        // decision is legitimate and unapplied; it was only ever an INSERT because the row did
        // not exist yet. Retry ONCE as the update it now is. This cannot loop: the row exists,
        // so review_id cannot collide again, and the writer's lock serializes us behind the
        // winner so our recorded predecessor is its state, not a stale one.
        if (approvals.findByOrgIdAndReviewId(orgId, reviewId).isEmpty()) {
            // Neither constraint explains this — do not guess.
            throw race;
        }
        try {
            writer.applyApproval(orgId, reviewId, target, approvedVersion, approvedFingerprint,
                    command, actor);
            return new ReviewReplyApprovalResponse(actionRef, target.name(), false);
        } catch (DataIntegrityViolationException stillRacing) {
            // Only our own command id can still collide (review_id cannot — the row is there),
            // which means an identical call committed while we retried.
            return audits.findByOrgIdAndCommandId(orgId, command)
                    .map(a -> replay(a, reviewId, target, approvedVersion, actionRef))
                    .orElseThrow(() -> stillRacing);
        }
    }

    /**
     * A command id already spent in this org: either the exact same effect (return the current
     * state, write nothing) or a different one (409, never a second effect).
     *
     * <p><b>The binding is part of the effect, so it is part of what a replay must match.</b>
     * This is where this method has to diverge from {@code ReviewTriageService.replay}, which
     * compares only the review and the target state — correctly, because a disposition IS the
     * entire payload of a triage decision, so two identical dispositions on one review are
     * literally the same effect. An APPROVED transition additionally carries
     * {@code (approvedVersion, approvedFingerprint)}, and {@link ReviewReplyApprovalAudit}
     * persists them precisely because the trail must say what was true. Comparing state alone
     * would call two approvals of DIFFERENT text "the same command":
     *
     * <ol>
     *   <li>approve v1 with {@code C1} → audit(C1, →APPROVED, version 1)
     *   <li>withdraw with {@code C2}; edit; save v2
     *   <li>approve v2 reusing {@code C1} → state matches, so it reads as a replay: 200,
     *       {@code replayed=true}, nothing written — the operator's approval of v2 silently
     *       never happens, and the response claims their intent was satisfied.
     * </ol>
     *
     * <p>That is exactly the conflict this method exists to raise. Version identifies the
     * binding on its own — drafts are append-only, so a version determines its fingerprint —
     * so comparing it is sufficient and comparing both would only restate it. Null on both
     * sides for a withdrawal, which binds nothing.
     */
    private ReviewReplyApprovalResponse replay(ReviewReplyApprovalAudit prior, UUID reviewId,
                                               ReviewReplyApprovalState target,
                                               Integer approvedVersion, String actionRef) {
        ReviewReplyApproval priorApproval = approvals.findById(prior.getReviewReplyApprovalId())
                .orElseThrow(() -> new IllegalStateException(
                        "review_reply_approval_audit references a review_reply_approval row that "
                                + "does not exist"));
        boolean sameReview = priorApproval.getReviewId().equals(reviewId);
        boolean sameBinding = Objects.equals(prior.getApprovedVersion(), approvedVersion);
        if (!sameReview || prior.getStateTo() != target || !sameBinding) {
            throw ApiException.conflict("commandId가 이미 다른 결정에 사용되었습니다.");
        }
        return new ReviewReplyApprovalResponse(actionRef, priorApproval.getState().name(), true);
    }
}
