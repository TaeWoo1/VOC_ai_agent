package com.sellerops.inquiry.guidedhandoff;

import com.sellerops.channel.Channel;
import com.sellerops.channel.ChannelRepository;
import com.sellerops.common.ApiException;
import com.sellerops.inquiry.Inquiry;
import com.sellerops.inquiry.InquiryRepository;
import com.sellerops.inquiry.guidedhandoff.dto.InquiryGuidedHandoffOutcomeResponse;
import com.sellerops.inquiry.guidedhandoff.dto.InquiryGuidedHandoffStep;
import com.sellerops.inquiry.guidedhandoff.dto.InquiryGuidedHandoffTargetHint;
import com.sellerops.inquiry.guidedhandoff.dto.InquiryGuidedHandoffView;
import com.sellerops.inquiry.publish.ChannelReplyAdapterRegistry;
import com.sellerops.inquiry.workitem.InquiryWorkItem;
import com.sellerops.inquiry.workitem.InquiryWorkItemAudit;
import com.sellerops.inquiry.workitem.InquiryWorkItemAuditRepository;
import com.sellerops.inquiry.workitem.InquiryWorkItemEvent;
import com.sellerops.inquiry.workitem.InquiryWorkItemPhase;
import com.sellerops.inquiry.workitem.InquiryWorkItemRepository;
import java.time.ZoneId;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * Coordinates the <b>Guided Handoff</b> for a Cafe24 board-6 (문의사항) inquiry: the operator
 * answers on the Cafe24 admin themselves, and SellerOps only guides and records — it never
 * clicks, types, submits, or sends.
 *
 * <p><b>The work item stays OPEN.</b> Unlike the ESM confirm-publish path (which advances
 * OPEN → PROPOSED → ACTION_PENDING and is meant for a channel with a live reply adapter),
 * a guided handoff writes only audit rows and never touches the work-item phase. That is
 * deliberate: the verified completion is the existing connector reconcile
 * ({@code InquiryWorkItemWriter.reconcileConnectorAnswered}) when the answer is later
 * re-collected as {@code reply_status=C} — which only completes an item that is still OPEN.
 * So a guided reply must not advance the phase, or the item could never complete.
 *
 * <p><b>Eligibility is fail-closed.</b> A guided handoff is offered only for an inquiry that
 * is (1) a Cafe24 board-6 article (parsed from the canonical external id), (2) on a channel
 * with <em>no</em> reply adapter (a read-only, operator-answered channel), and (3) bound to
 * an exact seller connection. Minting additionally requires the item to be OPEN. Nothing
 * here reads or emits the inquiry title/body, buyer identity, mall id, or any token.
 */
@Service
public class InquiryGuidedHandoffService {

    static final String CAFE24_CHANNEL_CODE = "CAFE24";
    static final int PRODUCT_INQUIRY_BOARD_NO = 6;
    static final String PRODUCT_INQUIRY_BOARD_LABEL = "문의사항";
    static final ZoneId CAFE24_ZONE = ZoneId.of("Asia/Seoul");

    static final String OUTCOME_SUBMITTED = "OPERATOR_REPORTED_SUBMITTED";
    static final String OUTCOME_ABORTED = "SUBMISSION_ABORTED";

    // Coarse, non-secret ineligibility reason codes surfaced to the client.
    static final String REASON_NOT_OPEN = "NOT_OPEN";
    static final String REASON_NOT_CAFE24_BOARD6 = "NOT_CAFE24_BOARD6";
    static final String REASON_HAS_REPLY_ADAPTER = "HAS_REPLY_ADAPTER";
    static final String REASON_NO_BOUND_STORE = "NO_BOUND_STORE";

    private final InquiryWorkItemRepository workItems;
    private final InquiryRepository inquiries;
    private final InquiryWorkItemAuditRepository audits;
    private final ChannelReplyAdapterRegistry adapters;
    private final ChannelRepository channels;
    private final TransactionTemplate tx;

    public InquiryGuidedHandoffService(InquiryWorkItemRepository workItems, InquiryRepository inquiries,
                                       InquiryWorkItemAuditRepository audits,
                                       ChannelReplyAdapterRegistry adapters, ChannelRepository channels,
                                       PlatformTransactionManager transactionManager) {
        this.workItems = workItems;
        this.inquiries = inquiries;
        this.audits = audits;
        this.adapters = adapters;
        this.channels = channels;
        this.tx = new TransactionTemplate(transactionManager);
    }

    /** Read-only eligibility + target hint + checklist; never writes. */
    public InquiryGuidedHandoffView capability(UUID orgId, UUID workItemId) {
        InquiryWorkItem workItem = loadWorkItem(orgId, workItemId);
        Inquiry inquiry = loadInquiry(orgId, workItem.getInquiryId());
        return describe(workItem, inquiry, /*requireOpen*/ true);
    }

    /**
     * Mint the guided handoff: record a {@code GUIDED_HANDOFF_MINTED} audit (idempotent)
     * without changing the phase, and return the descriptor. 409 if not eligible to mint.
     */
    public InquiryGuidedHandoffView mint(UUID orgId, UUID workItemId, String actor) {
        InquiryWorkItem workItem = loadWorkItem(orgId, workItemId);
        Inquiry inquiry = loadInquiry(orgId, workItem.getInquiryId());
        String reason = ineligibilityReason(workItem, inquiry, /*requireOpen*/ true);
        if (reason != null) {
            throw ApiException.conflict("이 문의는 Guided Handoff 대상이 아닙니다: " + reason);
        }
        String commandId = "guided-handoff-mint:" + workItemId;
        tx.executeWithoutResult(status -> {
            if (!audits.existsByWorkItemIdAndCommandId(workItemId, commandId)) {
                audits.save(handoffAudit(workItem, commandId,
                        InquiryWorkItemEvent.GUIDED_HANDOFF_MINTED, actor));
            }
        });
        return describe(workItem, inquiry, /*requireOpen*/ true);
    }

    /**
     * Record the operator's UNVERIFIED self-report. Does not change the phase and is never
     * a completion. Idempotent by {@code commandId}; a command id reused for a different
     * outcome is a 409.
     */
    public InquiryGuidedHandoffOutcomeResponse recordOutcome(UUID orgId, UUID workItemId,
                                                             String commandId, String operatorOutcome,
                                                             String actor) {
        if (commandId == null || commandId.isBlank()) {
            throw ApiException.badRequest("commandId는 필수입니다.");
        }
        String outcome = normalizeOutcome(operatorOutcome);
        InquiryWorkItem workItem = loadWorkItem(orgId, workItemId);
        Inquiry inquiry = loadInquiry(orgId, workItem.getInquiryId());
        // The report is allowed for any guided Cafe24 board-6 item regardless of phase
        // (the item may already have completed via re-collect); it never mutates phase.
        String reason = ineligibilityReason(workItem, inquiry, /*requireOpen*/ false);
        if (reason != null) {
            throw ApiException.conflict("이 문의는 Guided Handoff 대상이 아닙니다: " + reason);
        }

        String prefix = "guided-handoff-outcome:" + commandId + ":";
        String full = prefix + outcome;
        boolean replayed = tx.execute(status -> {
            List<InquiryWorkItemAudit> prior =
                    audits.findByWorkItemIdAndCommandIdStartingWith(workItemId, prefix);
            boolean exact = prior.stream().anyMatch(a -> a.getCommandId().equals(full));
            if (exact) {
                return true;   // idempotent replay — nothing written
            }
            if (!prior.isEmpty()) {
                // Same commandId already recorded a DIFFERENT outcome — conflict.
                throw ApiException.conflict("동일한 commandId가 다른 결과로 이미 기록되었습니다.");
            }
            audits.save(handoffAudit(workItem, full,
                    InquiryWorkItemEvent.GUIDED_HANDOFF_REPORTED, actor));
            return false;
        });

        return new InquiryGuidedHandoffOutcomeResponse(
                workItemId.toString(),
                true,
                replayed,
                false,
                "운영자 보고는 UNVERIFIED입니다. 작업 완료는 다음 수집에서 처리완료(답변) 상태가 재확인될 때 이루어집니다.");
    }

    // ---- internals -------------------------------------------------------------------

    private InquiryGuidedHandoffView describe(InquiryWorkItem workItem, Inquiry inquiry, boolean requireOpen) {
        String reason = ineligibilityReason(workItem, inquiry, requireOpen);
        if (reason != null) {
            return InquiryGuidedHandoffView.notEligible(reason);
        }
        Cafe24InquiryArticleRef ref = Cafe24InquiryArticleRef.parse(inquiry.getExternalId()).orElseThrow();
        InquiryGuidedHandoffTargetHint hint = new InquiryGuidedHandoffTargetHint(
                CAFE24_CHANNEL_CODE,
                ref.boardNo(),
                PRODUCT_INQUIRY_BOARD_LABEL,
                ref.articleNo(),
                null,   // productRef: article_no + date locate the row; sku hint deferred
                recencyBucket(inquiry),
                inquiry.getStatus(),
                inquiry.getInformStatus());
        return new InquiryGuidedHandoffView(
                true,
                null,
                InquiryGuidedHandoffView.MODE_GUIDED_HANDOFF,
                "guided-handoff:" + workItem.getId(),
                true,
                true,
                hint,
                checklist(),
                null);   // deepLink: Cafe24 admin screen URL not derivable in V1 — checklist-only
    }

    /** The coarse reason a guided handoff is not offered, or {@code null} when eligible. */
    private String ineligibilityReason(InquiryWorkItem workItem, Inquiry inquiry, boolean requireOpen) {
        if (requireOpen && workItem.getPhase() != InquiryWorkItemPhase.OPEN) {
            return REASON_NOT_OPEN;
        }
        if (workItem.getSellerAccountId() == null || !isCafe24(workItem.getChannelId())) {
            return REASON_NO_BOUND_STORE;
        }
        Optional<Cafe24InquiryArticleRef> ref = Cafe24InquiryArticleRef.parse(inquiry.getExternalId());
        if (ref.isEmpty() || ref.get().boardNo() != PRODUCT_INQUIRY_BOARD_NO) {
            return REASON_NOT_CAFE24_BOARD6;
        }
        // Guided handoff is only for a read-only channel: if a live reply adapter exists,
        // the normal publish path applies instead.
        if (adapters.resolve(workItem.getChannelId()).isPresent()) {
            return REASON_HAS_REPLY_ADAPTER;
        }
        return null;
    }

    private boolean isCafe24(UUID channelId) {
        return channels.findById(channelId)
                .map(Channel::getCode)
                .map(CAFE24_CHANNEL_CODE::equals)
                .orElse(false);
    }

    private String recencyBucket(Inquiry inquiry) {
        if (inquiry.getReceivedAt() == null) {
            return null;
        }
        return inquiry.getReceivedAt().atZone(CAFE24_ZONE).toLocalDate().toString();
    }

    private List<InquiryGuidedHandoffStep> checklist() {
        return List.of(
                new InquiryGuidedHandoffStep(1, "카페24 관리자(EC)에 로그인하세요."),
                new InquiryGuidedHandoffStep(2, "게시판 관리 → 상품 문의(게시판 6, 문의사항)로 이동하세요."),
                new InquiryGuidedHandoffStep(3, "아래 대상 정보(게시글 번호·작성일·상태)로 해당 문의를 찾으세요."),
                new InquiryGuidedHandoffStep(4,
                        "승인된 답변 초안을 확인하고, 필요하면 수정한 뒤 카페24 답변 입력란에 직접 붙여넣어 제출하세요."),
                new InquiryGuidedHandoffStep(5,
                        "제출 후 이 화면에서 '답변함'으로 보고하세요. SellerOps가 대신 클릭·제출하지 않습니다."),
                new InquiryGuidedHandoffStep(6,
                        "다음 수집에서 처리완료(답변) 상태가 재확인되면 작업이 자동으로 완료됩니다."));
    }

    private InquiryWorkItemAudit handoffAudit(InquiryWorkItem workItem, String commandId,
                                              InquiryWorkItemEvent eventType, String actor) {
        InquiryWorkItemAudit audit = new InquiryWorkItemAudit();
        audit.setOrgId(workItem.getOrgId());
        audit.setWorkItemId(workItem.getId());
        audit.setCommandId(commandId);
        audit.setEventType(eventType);
        // The guided handoff never changes the phase; record it as a self-transition.
        audit.setPhaseFrom(workItem.getPhase());
        audit.setPhaseTo(workItem.getPhase());
        audit.setActor(actor);
        return audit;
    }

    private String normalizeOutcome(String raw) {
        if (raw == null) {
            throw ApiException.badRequest("operatorOutcome는 필수입니다.");
        }
        String v = raw.strip();
        if (v.equals(OUTCOME_SUBMITTED) || v.equals(OUTCOME_ABORTED)) {
            return v;
        }
        throw ApiException.badRequest("operatorOutcome 값이 올바르지 않습니다.");
    }

    private InquiryWorkItem loadWorkItem(UUID orgId, UUID workItemId) {
        return workItems.findById(workItemId)
                .filter(w -> w.getOrgId().equals(orgId))
                .orElseThrow(() -> ApiException.notFound("문의 작업을 찾을 수 없습니다."));
    }

    private Inquiry loadInquiry(UUID orgId, UUID inquiryId) {
        return inquiries.findById(inquiryId)
                .filter(i -> i.getOrgId().equals(orgId))
                .orElseThrow(() -> ApiException.notFound("문의를 찾을 수 없습니다."));
    }
}
