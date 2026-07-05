package com.sellerops.inquiry.reply;

import com.sellerops.common.ApiException;
import com.sellerops.inquiry.reply.dto.ReplyDraftView;
import com.sellerops.inquiry.workitem.InquiryWorkItem;
import com.sellerops.inquiry.workitem.InquiryWorkItemPhase;
import com.sellerops.inquiry.workitem.InquiryWorkItemRepository;
import java.util.Optional;
import java.util.UUID;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.stereotype.Service;

/**
 * Seller reply-draft persistence: append-only, versioned ESM answer drafts on a
 * PROPOSED work item.
 *
 * <p>Ordering is deliberate — the <b>org guard runs before any content is read or
 * validated</b>. Only a PROPOSED item accepts a draft. The seller edits only
 * title/comments; {@code answerStatus} is backend-fixed. Both fields are normalized
 * (CRLF/CR &rarr; LF, trimmed) before validation, persistence, and fingerprinting.
 *
 * <p><b>Versioning &amp; concurrency:</b> the caller passes {@code baseVersion} (the
 * version it edited from; {@code 0} for the first save). A save from the head
 * inserts {@code version+1}; a base that is not the head is a stale write (409). An
 * exact retry (same content already at the head) is an idempotent no-op that returns
 * the head without inserting a duplicate version. Concurrent saves are serialized by
 * the {@code (work_item_id, version)} UNIQUE constraint — the loser re-resolves to
 * the head (idempotent if identical, else 409). No content ever reaches an audit
 * row or a log/exception message.
 */
@Service
public class InquiryReplyDraftService {

    private final InquiryWorkItemRepository workItems;
    private final InquiryReplyDraftRepository drafts;

    public InquiryReplyDraftService(InquiryWorkItemRepository workItems,
                                    InquiryReplyDraftRepository drafts) {
        this.workItems = workItems;
        this.drafts = drafts;
    }

    /** The current draft for a work item (assumes the caller already org-verified it). */
    public ReplyDraftView latestView(UUID workItemId) {
        return drafts.findTopByWorkItemIdOrderByVersionDesc(workItemId)
                .map(ReplyDraftView::of).orElse(null);
    }

    public ReplyDraftView save(UUID orgId, UUID workItemId, UUID sellerUserId,
                               String title, String comments, Integer baseVersion) {
        // Org guard BEFORE reading/validating any content.
        InquiryWorkItem workItem = workItems.findById(workItemId)
                .filter(w -> w.getOrgId().equals(orgId))
                .orElseThrow(() -> ApiException.notFound("문의 작업을 찾을 수 없습니다."));
        if (workItem.getPhase() != InquiryWorkItemPhase.PROPOSED) {
            throw ApiException.conflict("PROPOSED 상태의 문의만 답변 초안을 저장할 수 있습니다.");
        }
        if (baseVersion == null || baseVersion < 0) {
            throw ApiException.badRequest("baseVersion이 필요합니다 (첫 저장은 0).");
        }

        String normalizedTitle = EsmAnswerValidation.normalize(title);
        String normalizedComments = EsmAnswerValidation.normalize(comments);
        if (EsmAnswerValidation.isBlank(normalizedTitle)) {
            throw ApiException.badRequest("제목을 입력하세요.");
        }
        if (EsmAnswerValidation.isBlank(normalizedComments)) {
            throw ApiException.badRequest("답변 내용을 입력하세요.");
        }
        if (EsmAnswerValidation.utf8Bytes(normalizedTitle) > EsmAnswerValidation.TITLE_MAX_BYTES) {
            throw ApiException.badRequest(
                    "제목이 너무 깁니다 (최대 " + EsmAnswerValidation.TITLE_MAX_BYTES + " 바이트).");
        }
        if (EsmAnswerValidation.utf8Bytes(normalizedComments) > EsmAnswerValidation.COMMENTS_MAX_BYTES) {
            throw ApiException.badRequest(
                    "답변 내용이 너무 깁니다 (최대 " + EsmAnswerValidation.COMMENTS_MAX_BYTES + " 바이트).");
        }

        String fingerprint = ReplyDraftFingerprint.of(normalizedTitle, normalizedComments);

        Optional<InquiryReplyDraft> latest = drafts.findTopByWorkItemIdOrderByVersionDesc(workItemId);
        int currentVersion = latest.map(InquiryReplyDraft::getVersion).orElse(0);

        // Idempotent replay/no-op: the content is already the head, and the base is
        // either the head (re-save of identical content) or the head's predecessor
        // (the save being retried already produced this head).
        if (latest.isPresent() && latest.get().getContentFingerprint().equals(fingerprint)
                && (baseVersion == currentVersion || baseVersion == currentVersion - 1)) {
            return ReplyDraftView.of(latest.get());
        }
        // Stale write: the base is not the current head (and the content differs).
        if (baseVersion != currentVersion) {
            throw ApiException.conflict(
                    "이미 최신 초안이 있습니다. 새로고침 후 다시 시도하세요.");
        }

        InquiryReplyDraft draft = new InquiryReplyDraft();
        draft.setOrgId(orgId);
        draft.setWorkItemId(workItemId);
        draft.setVersion(currentVersion + 1);
        draft.setAnswerStatus(EsmAnswerValidation.ANSWER_STATUS);
        draft.setTitle(normalizedTitle);
        draft.setComments(normalizedComments);
        draft.setContentFingerprint(fingerprint);
        draft.setFingerprintAlgorithm(EsmAnswerValidation.FINGERPRINT_ALGORITHM);
        draft.setCreatedBy("SELLER:" + sellerUserId);
        try {
            return ReplyDraftView.of(drafts.save(draft));
        } catch (DataIntegrityViolationException race) {
            // A concurrent writer took this version. Re-resolve to the head: an
            // identical concurrent save is an idempotent success, otherwise it is a
            // stale write the caller must re-base on.
            InquiryReplyDraft head = drafts.findTopByWorkItemIdOrderByVersionDesc(workItemId)
                    .orElseThrow(() -> race);
            if (head.getContentFingerprint().equals(fingerprint)) {
                return ReplyDraftView.of(head);
            }
            throw ApiException.conflict("동시에 다른 초안이 저장되었습니다. 새로고침 후 다시 시도하세요.");
        }
    }
}
