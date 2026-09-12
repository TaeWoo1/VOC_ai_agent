package com.sellerops.attention.reply;

import com.sellerops.common.ApiException;
import com.sellerops.attention.reply.dto.ReviewReplyDraftView;
import com.sellerops.inquiry.draft.DraftAuthorKind;
import java.util.Optional;
import java.util.UUID;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.stereotype.Service;

/**
 * Append-only, versioned reply-draft persistence for one review. Ported closely from
 * {@code InquiryReplyDraftService}, whose versioning and race handling this slice reuses
 * rather than reinvents.
 *
 * <p><b>Authorization and the disposition gate are the CALLER's job</b>, and this class
 * assumes both have already run — {@link ReviewReplyService} owns them, because they are the
 * same checks the read and the approval paths need and stating them once is what keeps the
 * three from drifting. This class is reachable only through that facade. It is package-scoped
 * in effect: nothing else is wired to it.
 *
 * <p><b>Versioning &amp; concurrency:</b> the caller passes {@code baseVersion} (the version it
 * edited from; {@code 0} for the first save). A save from the head inserts {@code version+1};
 * a base that is not the head is a stale write (409). An exact retry (same content already at
 * the head) is an idempotent no-op that returns the head without inserting a duplicate
 * version. Concurrent saves are serialized by the {@code (review_id, version)} UNIQUE
 * constraint — the loser re-resolves to the head (idempotent if identical, else 409).
 *
 * <p>No content ever reaches an audit row or a log/exception message.
 *
 * <p><b>Carries no {@code @Transactional}, and must not gain one</b> — the same rule
 * {@code InquiryReplyDraftService} follows and {@code ReviewTriageWriter} explains at length.
 * {@code save()} on a Spring Data repository runs in its own transaction and commits on
 * return, so the UNIQUE violation surfaces at the call below where the catch can recover from
 * it. Under an ambient transaction nothing flushes until the proxy commits, the catch becomes
 * dead code, and a lost race turns into a 500 — with every test still green, because tests
 * that do not race never reach it.
 */
@Service
public class ReviewReplyDraftService {

    private final ReviewReplyDraftRepository drafts;

    public ReviewReplyDraftService(ReviewReplyDraftRepository drafts) {
        this.drafts = drafts;
    }

    /** The current draft for a review (assumes the caller already authorized it). */
    /** The head version, or 0 when none — the {@code baseVersion} the next save must pass. */
    public int currentVersion(UUID reviewId) {
        return latest(reviewId).map(ReviewReplyDraft::getVersion).orElse(0);
    }

    public Optional<ReviewReplyDraft> latest(UUID reviewId) {
        return drafts.findTopByReviewIdOrderByVersionDesc(reviewId);
    }

    /** One exact version — how an approval's bound body is re-served. */
    public Optional<ReviewReplyDraft> version(UUID reviewId, int version) {
        return drafts.findByReviewIdAndVersion(reviewId, version);
    }

    /**
     * Save a new version (assumes the caller already authorized and gated).
     *
     * @throws ApiException 400 on a blank/over-long body or a missing/negative base; 409 on a
     *                      stale base or a lost concurrent race with different content.
     */
    /**
     * What wrote this version and what it was written from (Grounded Review Drafting v1).
     *
     * <p>Recorded on the row rather than derived later, for the reason the inquiry lane records it:
     * a seller looking at an approved reply is entitled to know whether a model wrote that sentence,
     * and «it has evidence rows» is not the same fact as «a model wrote it» — the template floor has
     * an author and no evidence.
     *
     * @param authorKind   {@code SELLER}, {@code MODEL} or {@code RULE}
     * @param modelVersion the vendor model id, or the template provenance string for a RULE draft
     * @param basis        {@code GROUNDED} / {@code NO_ANSWER_BASIS}
     * @param productId    the product the retrieval was scoped to, or null
     */
    public record Provenance(String authorKind, String modelVersion, String knowledgeState,
                             String basis, UUID productId) {

        /**
         * What a hand-typed save records — the same sentence the inquiry lane's
         * {@code InquiryReplyDraftService.Provenance.seller()} states.
         *
         * <p><b>A seller edit is {@code SELLER} whatever the version before it was</b>, and it
         * carries no model version, no knowledge state and no basis: the moment a person changes a
         * word the draft is theirs, and inheriting the previous version's «a model wrote this, from
         * these passages» would put a machine's name on a human's sentence.
         *
         * <p>Before this existed the seller path passed {@code null} here, so a hand-typed version
         * was stored with {@code author_kind IS NULL} — byte-identical to a row written before V90
         * recorded authorship at all. That made the one question this column exists to answer —
         * «did the seller keep what the model wrote, or rewrite it?» — unanswerable on the review
         * lane while the inquiry lane answered it from the same shape of column.
         */
        public static Provenance seller() {
            return new Provenance(DraftAuthorKind.SELLER.name(), null, null, null, null);
        }
    }

    /** Save a new version and stamp what wrote it. A replayed identical save stamps nothing. */
    public ReviewReplyDraftView saveAs(UUID orgId, UUID reviewId, String actor, String body,
                                       Integer baseVersion, Provenance provenance) {
        return save(orgId, reviewId, actor, body, baseVersion, provenance);
    }

    /**
     * Save a hand-typed version. Stamps {@link Provenance#seller()} — the caller is a person
     * editing in the reply screen, and {@link ReviewReplyService} is the only one of them.
     */
    public ReviewReplyDraftView save(UUID orgId, UUID reviewId, String actor, String body,
                                     Integer baseVersion) {
        return save(orgId, reviewId, actor, body, baseVersion, Provenance.seller());
    }

    private ReviewReplyDraftView save(UUID orgId, UUID reviewId, String actor, String body,
                                      Integer baseVersion, Provenance provenance) {
        if (baseVersion == null || baseVersion < 0) {
            throw ApiException.badRequest("baseVersion이 필요합니다 (첫 저장은 0).");
        }
        String normalized = ReviewReplyValidation.normalize(body);
        if (ReviewReplyValidation.isBlank(normalized)) {
            throw ApiException.badRequest("답변 내용을 입력하세요.");
        }
        if (ReviewReplyValidation.utf8Bytes(normalized) > ReviewReplyValidation.BODY_MAX_BYTES) {
            throw ApiException.badRequest(
                    "답변 내용이 너무 깁니다 (최대 " + ReviewReplyValidation.BODY_MAX_BYTES + " 바이트).");
        }

        String fingerprint = ReviewReplyFingerprint.of(normalized);
        Optional<ReviewReplyDraft> latest = drafts.findTopByReviewIdOrderByVersionDesc(reviewId);
        int currentVersion = latest.map(ReviewReplyDraft::getVersion).orElse(0);

        // Idempotent replay/no-op: the content is already the head, and the base is either the
        // head (a re-save of identical content) or the head's predecessor (the save being
        // retried already produced this head).
        if (latest.isPresent() && latest.get().getContentFingerprint().equals(fingerprint)
                && (baseVersion == currentVersion || baseVersion == currentVersion - 1)) {
            return ReviewReplyDraftView.of(latest.get());
        }
        // Stale write: the base is not the current head (and the content differs).
        if (baseVersion != currentVersion) {
            throw ApiException.conflict("이미 최신 초안이 있습니다. 새로고침 후 다시 시도하세요.");
        }

        ReviewReplyDraft draft = new ReviewReplyDraft();
        draft.setOrgId(orgId);
        draft.setReviewId(reviewId);
        draft.setVersion(currentVersion + 1);
        draft.setBody(normalized);
        draft.setContentFingerprint(fingerprint);
        draft.setFingerprintAlgorithm(ReviewReplyValidation.FINGERPRINT_ALGORITHM);
        draft.setCreatedBy(actor);
        if (provenance != null) {
            draft.setAuthorKind(provenance.authorKind());
            draft.setModelVersion(provenance.modelVersion());
            draft.setKnowledgeState(provenance.knowledgeState());
            draft.setAnswerBasis(provenance.basis());
            draft.setProductId(provenance.productId());
        }
        try {
            return ReviewReplyDraftView.of(drafts.save(draft));
        } catch (DataIntegrityViolationException race) {
            // A concurrent writer took this version. Re-resolve to the head: an identical
            // concurrent save is an idempotent success, otherwise it is a stale write the
            // caller must re-base on.
            ReviewReplyDraft head = drafts.findTopByReviewIdOrderByVersionDesc(reviewId)
                    .orElseThrow(() -> race);
            if (head.getContentFingerprint().equals(fingerprint)) {
                return ReviewReplyDraftView.of(head);
            }
            throw ApiException.conflict("동시에 다른 초안이 저장되었습니다. 새로고침 후 다시 시도하세요.");
        }
    }
}
