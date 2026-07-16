package com.sellerops.attention.triage;

import com.sellerops.attention.VocItemRef;
import com.sellerops.attention.triage.dto.TriageDecisionResponse;
import com.sellerops.common.ApiException;
import com.sellerops.review.Review;
import com.sellerops.review.ReviewRepository;
import com.sellerops.selleraccount.SellerAccount;
import com.sellerops.selleraccount.SellerAccountRepository;
import java.util.UUID;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.stereotype.Service;

/**
 * Records one operator's triage decision about one collected review — the write half of the
 * attention surface, which until now was read-only end to end.
 *
 * <p><b>Hermetic by construction.</b> Nothing here contacts a marketplace, drafts text, or
 * queues an action. It writes two local rows and returns. That is the whole capability, and
 * it is deliberately the whole capability: the operator's judgement is worth persisting on
 * its own, before any publish path exists to consume it.
 *
 * <p><b>The ref is an address, not a capability.</b> {@code actionRef} names a row; it
 * authorizes nothing. Authorization is re-derived from the authenticated principal on every
 * call, in this order, and the ref is never trusted for any of it:
 *
 * <ol>
 *   <li>{@code orgId} comes from the JWT — never from the request path, body, or ref.
 *   <li>The account must exist IN THAT ORG ({@code findByIdAndOrgId}) — org scoping at the
 *       query boundary, so a cross-org account reads as absent, matching
 *       {@code OperatorAttentionService.requireAccount}.
 *   <li>The review must exist IN THAT ORG — same reason.
 *   <li>The review's channel must be the account's channel.
 * </ol>
 *
 * <p>Steps 2–4 all fail as 404. That is non-disclosure, not laziness: a caller must not be
 * able to tell "no such review" from "someone else's review" from "your review, wrong
 * account", because the difference is exactly what makes an id enumerable. The ref-parse
 * failures are 400 and happen BEFORE any lookup, so a malformed ref cannot probe for rows
 * either.
 *
 * <p><b>On the account/channel check.</b> {@code reviews} has no {@code seller_account_id}
 * (a file upload resolves none), so channel is the finest scope that actually exists here
 * — the same limit {@code IngestedReviewVocItemSource} reads under. The account is how the
 * caller is authorized and how the channel is resolved; it is not recorded on the decision
 * (see {@link ReviewTriage}).
 *
 * <p>One consequence is worth stating rather than discovering: this service does NOT
 * reproduce that source's multi-account ambiguity guard, which returns an empty drill-down
 * when an org holds two accounts on one channel. It does not need to — under ambiguity the
 * read side emits no rows, so no ref reaches a client, and the endpoint is unreachable
 * through the product. A ref minted BEFORE a second account appeared would still be
 * writable afterwards; the decision it records is org+channel-scoped and account-agnostic,
 * so it stays true regardless. Adding the guard here would instead make previously recorded
 * decisions un-editable the moment an unrelated account is connected.
 */
@Service
public class ReviewTriageService {

    /**
     * Actor-tag prefix for the authenticated caller.
     *
     * <p>{@code SELLER:} and not {@code OPERATOR:}, though this surface's vocabulary is
     * "operator" throughout. The tag names the authorization context, and this endpoint's
     * is identical to every existing {@code SELLER:} site ({@code InquiryProposalService},
     * {@code InquiryReplyDraftService}, {@code InquiryPublishService}): a seller's own JWT,
     * their own account, no role gate. The one {@code OPERATOR:} site
     * ({@code InquiryDismissalAdminController}) is an admin route behind a persisted
     * {@code users.role == OWNER} check, which this is not. Tagging these rows
     * {@code OPERATOR:} would make an ordinary seller action indistinguishable, in the
     * trail, from an admin one.
     */
    static final String ACTOR_PREFIX = "SELLER:";

    /**
     * Ceiling on the client-supplied command id, matching
     * {@code review_triage_audit.command_id} in V18 and {@code DismissalManifest}'s own
     * limit.
     *
     * <p>Checked here rather than left to the column, because the column cannot be trusted
     * to check it in the only place it would matter. Tests run on H2 with the schema
     * generated from the entities, so this bound only exists at all because
     * {@link ReviewTriageAudit} pins {@code length} — without it, tests would build a
     * {@code varchar(255)} while production ran V18's {@code varchar(120)}, and an
     * over-long id would pass every test and fail in production as a 500. With the guard,
     * it is a 400 everywhere.
     */
    static final int MAX_COMMAND_ID_LEN = 120;

    private final ReviewTriageRepository triages;
    private final ReviewTriageAuditRepository audits;
    private final ReviewRepository reviews;
    private final SellerAccountRepository sellerAccounts;
    private final ReviewTriageWriter writer;

    public ReviewTriageService(ReviewTriageRepository triages, ReviewTriageAuditRepository audits,
                               ReviewRepository reviews, SellerAccountRepository sellerAccounts,
                               ReviewTriageWriter writer) {
        this.triages = triages;
        this.audits = audits;
        this.reviews = reviews;
        this.sellerAccounts = sellerAccounts;
        this.writer = writer;
    }

    /**
     * Record (or replace) the decision on the review named by {@code actionRef}.
     *
     * <p><b>Idempotency.</b> {@code commandId} is client-generated and unique per org. An
     * exact replay — same command id, same review, same disposition — writes nothing and
     * returns the CURRENT state with {@code replayed=true}. Reusing a command id for
     * anything else is a 409, never a second effect.
     *
     * <p>The replayed response echoes the review's current disposition, which is not
     * necessarily the one this command set: if a later command changed it, a replay of the
     * earlier command truthfully reports "already applied, and here is where things now
     * stand" rather than replaying a stale value as if it were live.
     *
     * <p>Re-deciding with a NEW command id is an ordinary update and appends a row —
     * including when the disposition is unchanged, which records that someone re-affirmed
     * it. Nothing here is terminal.
     *
     * <p><b>Concurrency.</b> Every guarantee above holds under concurrent callers, not only
     * serialized ones — which matters because an idempotency key exists precisely so a
     * client can retry, and the commonest retry trigger (a timeout) races the still-in-flight
     * original by construction. The lookup below is only a fast path; correctness comes from
     * the UNIQUE constraints, which serialize writers and let the loser re-resolve
     * ({@link #resolveRace}) rather than fail. A concurrent exact replay returns the same
     * 200 as a sequential one.
     */
    public TriageDecisionResponse decide(UUID orgId, UUID accountId, String actionRef,
                                         String disposition, String commandId, UUID actorUserId) {
        // Validate the payload before touching the database: a caller who sends nonsense
        // learns only that it was nonsense, not whether any row exists.
        if (commandId == null || commandId.isBlank()) {
            throw ApiException.badRequest("commandId가 필요합니다.");
        }
        String command = commandId.strip();
        if (command.length() > MAX_COMMAND_ID_LEN) {
            throw ApiException.badRequest("commandId가 너무 깁니다.");
        }
        TriageDisposition target = TriageDisposition.parse(disposition);
        UUID reviewId = VocItemRef.parseReviewId(actionRef);

        SellerAccount account = sellerAccounts.findByIdAndOrgId(accountId, orgId)
                .orElseThrow(() -> ApiException.notFound("판매 계정을 찾을 수 없습니다."));
        Review review = reviews.findByIdAndOrgId(reviewId, orgId)
                .orElseThrow(ReviewTriageService::unaddressable);
        // The account's channel is the scope; a review on another channel is not addressable
        // from this account. Same 404 as an absent review, on purpose (see the class note).
        if (account.getChannelId() == null || !account.getChannelId().equals(review.getChannelId())) {
            throw unaddressable();
        }

        // Fast path only — NOT the correctness boundary. A concurrent caller can commit
        // between this read and our write; that is what resolveRace exists for.
        var prior = audits.findByOrgIdAndCommandId(orgId, command);
        if (prior.isPresent()) {
            return replay(prior.get(), reviewId, target, actionRef);
        }

        String actor = ACTOR_PREFIX + actorUserId;
        try {
            writer.applyDecision(orgId, reviewId, review.getChannelId(), target, command, actor);
            return applied(actionRef, target);
        } catch (DataIntegrityViolationException race) {
            return resolveRace(race, orgId, reviewId, review.getChannelId(), target, command, actor, actionRef);
        }
    }

    /**
     * A concurrent caller won a UNIQUE race. Work out which one, and answer as if we had
     * simply arrived second — never with a 500.
     *
     * <p>The re-reads here are clean: {@link ReviewTriageWriter} commits inside
     * {@code tx.execute}, so by the time this runs the failed transaction has already ended
     * and each lookup opens its own. That is the whole reason this method can exist, and the
     * reason {@code decide} is not {@code @Transactional} — see the writer's note.
     */
    private TriageDecisionResponse resolveRace(DataIntegrityViolationException race, UUID orgId, UUID reviewId,
                                               UUID channelId, TriageDisposition target, String command,
                                               String actor, String actionRef) {
        // (a) uq_review_triage_audit_org_command — this exact command id already landed.
        // Our own request lost to a copy of itself, so the effect the caller asked for has
        // happened: the same replay answer a sequential retry would get (or 409 if the id
        // was reused for something else).
        var raced = audits.findByOrgIdAndCommandId(orgId, command);
        if (raced.isPresent()) {
            return replay(raced.get(), reviewId, target, actionRef);
        }
        // (b) uq_review_triage_review — a DIFFERENT command created the row first. Our
        // decision is legitimate and unapplied; it was only ever an INSERT because the row
        // did not exist yet. Retry ONCE as the update it now is. This cannot loop: the row
        // exists, so review_id cannot collide again, and the writer's lock serializes us
        // behind the winner so our recorded predecessor is its disposition, not a stale one.
        if (triages.findByOrgIdAndReviewId(orgId, reviewId).isEmpty()) {
            // Neither constraint explains this — do not guess.
            throw race;
        }
        try {
            writer.applyDecision(orgId, reviewId, channelId, target, command, actor);
            return applied(actionRef, target);
        } catch (DataIntegrityViolationException stillRacing) {
            // Only our own command id can still collide (review_id cannot — the row is
            // there), which means an identical call committed while we retried.
            return audits.findByOrgIdAndCommandId(orgId, command)
                    .map(a -> replay(a, reviewId, target, actionRef))
                    .orElseThrow(() -> stillRacing);
        }
    }

    private static TriageDecisionResponse applied(String actionRef, TriageDisposition target) {
        return new TriageDecisionResponse(actionRef, target.name(), false);
    }

    /**
     * A command id already spent in this org: either the exact same effect (return the
     * current state, write nothing) or a different one (409, never a second effect).
     */
    private TriageDecisionResponse replay(ReviewTriageAudit prior, UUID reviewId,
                                          TriageDisposition target, String actionRef) {
        ReviewTriage priorTriage = triages.findById(prior.getReviewTriageId())
                .orElseThrow(() -> new IllegalStateException(
                        "review_triage_audit references a review_triage row that does not exist"));
        boolean sameReview = priorTriage.getReviewId().equals(reviewId);
        if (!sameReview || prior.getDispositionTo() != target) {
            throw ApiException.conflict("commandId가 이미 다른 결정에 사용되었습니다.");
        }
        return new TriageDecisionResponse(actionRef, priorTriage.getDisposition().name(), true);
    }

    /**
     * The one "you cannot address this" answer. Deliberately identical for an absent
     * review, a cross-org review, and a review on another account's channel — the caller
     * learns that the ref is not theirs to act on, and nothing about why.
     */
    private static ApiException unaddressable() {
        return ApiException.notFound("해당 항목을 찾을 수 없습니다.");
    }
}
