package com.sellerops.inquiry.proposal;

import com.sellerops.common.ApiException;
import com.sellerops.inquiry.Inquiry;
import com.sellerops.inquiry.InquiryRepository;
import com.sellerops.inquiry.proposal.InquiryProposalProvider.Draft;
import com.sellerops.inquiry.proposal.InquiryProposalProvider.SellerInquiryContext;
import com.sellerops.inquiry.proposal.dto.InquiryDetail;
import com.sellerops.inquiry.proposal.dto.ProposalResult;
import com.sellerops.inquiry.proposal.dto.ProposalView;
import com.sellerops.inquiry.workitem.InquiryWorkItem;
import com.sellerops.inquiry.workitem.InquiryWorkItemPhase;
import com.sellerops.inquiry.workitem.InquiryWorkItemRepository;
import java.util.Optional;
import java.util.UUID;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;

/**
 * Seller-initiated inquiry proposal coordinator + seller-only detail read.
 *
 * <p><b>propose (OPEN &rarr; PROPOSED):</b> ordering is deliberate — the org guard
 * and the idempotency precheck run <b>before</b> the provider is ever invoked. Only
 * an OPEN work item may transition. If the provider fails, the item stays OPEN with
 * no proposal, no audit, and no partial write. On success the proposal, phase flip,
 * and PROPOSAL_ADDED audit are written atomically. A replay after success returns
 * the existing proposal without invoking the provider again; a concurrent second
 * caller resolves to the same proposal via the UNIQUE constraint. It stops at
 * PROPOSED (no approval, no execution).
 *
 * <p>The seller (from the JWT) is the audit actor; the proposal is attributed to the
 * rule provider ({@code SYSTEM:RULE_PROPOSER}). Buyer identity, inquiry body, reply
 * drafts, and tokens are never written to the proposal.
 */
@Service
public class InquiryProposalService {

    /** The reply is a write on the seller's own channel (ported ActionKind). */
    static final String ACTION_KIND = "POST_INQUIRY_REPLY";
    /** The proposal is authored by the rule provider, not the human seller. */
    static final String PROPOSED_BY = "SYSTEM:RULE_PROPOSER";
    /** A channel write always requires explicit seller approval before execution. */
    static final boolean REQUIRES_APPROVAL = true;

    private final InquiryWorkItemRepository workItems;
    private final InquiryProposalRepository proposals;
    private final InquiryRepository inquiries;
    private final InquiryProposalProvider provider;
    private final InquiryProposalWriter writer;

    public InquiryProposalService(InquiryWorkItemRepository workItems, InquiryProposalRepository proposals,
                                  InquiryRepository inquiries, InquiryProposalProvider provider,
                                  InquiryProposalWriter writer) {
        this.workItems = workItems;
        this.proposals = proposals;
        this.inquiries = inquiries;
        this.provider = provider;
        this.writer = writer;
    }

    /** Seller-only, org-scoped detail exposing the raw title/details (never author). */
    public InquiryDetail detail(UUID orgId, UUID workItemId) {
        InquiryWorkItem workItem = loadWorkItem(orgId, workItemId);
        Inquiry inquiry = loadInquiry(orgId, workItem.getInquiryId());
        ProposalView proposal = proposals.findByWorkItemId(workItemId).map(this::toView).orElse(null);
        return new InquiryDetail(
                workItem.getId(),
                inquiry.getId(),
                workItem.getSellerAccountId(),
                workItem.getChannelId(),
                workItem.getPhase().name(),
                inquiry.getStatus(),
                inquiry.getInformStatus(),
                inquiry.getTitle(),
                inquiry.getBody(),
                inquiry.getReceivedAt(),
                proposal);
    }

    /** Generate a proposal and move the work item OPEN &rarr; PROPOSED. */
    public ProposalResult propose(UUID orgId, UUID workItemId, UUID sellerUserId) {
        InquiryWorkItem workItem = loadWorkItem(orgId, workItemId);

        // Idempotency precheck BEFORE the provider: a prior proposal is an exact replay.
        Optional<InquiryProposal> existing = proposals.findByWorkItemId(workItemId);
        if (existing.isPresent()) {
            return result(workItem, existing.get());
        }

        if (workItem.getPhase() != InquiryWorkItemPhase.OPEN) {
            throw ApiException.conflict("OPEN 상태의 문의만 제안을 생성할 수 있습니다.");
        }

        Inquiry inquiry = loadInquiry(orgId, workItem.getInquiryId());

        Draft draft;
        try {
            draft = provider.propose(new SellerInquiryContext(
                    orgId, inquiry.getId(), inquiry.getTitle(), inquiry.getBody(),
                    inquiry.getStatus(), inquiry.getInformStatus()));
        } catch (RuntimeException providerFailure) {
            // Provider unavailable: leave the item OPEN and retryable — write nothing.
            throw new ApiException(HttpStatus.SERVICE_UNAVAILABLE,
                    "제안 생성기를 일시적으로 사용할 수 없습니다. 잠시 후 다시 시도하세요.");
        }

        InquiryProposal proposal = new InquiryProposal();
        proposal.setOrgId(orgId);
        proposal.setWorkItemId(workItemId);
        proposal.setInquiryId(inquiry.getId());
        proposal.setActionKind(ACTION_KIND);
        proposal.setSummaryCategory(draft.summaryCategory());
        proposal.setRequiresApproval(REQUIRES_APPROVAL);
        proposal.setProposedBy(PROPOSED_BY);
        proposal.setProviderKind(draft.providerKind());
        proposal.setProviderName(draft.providerName());
        proposal.setProviderVersion(draft.providerVersion());

        try {
            InquiryProposal saved = writer.attachProposalAndTransition(
                    workItem, proposal, "SELLER:" + sellerUserId);
            return result(workItem, saved);
        } catch (DataIntegrityViolationException race) {
            // A concurrent caller won the UNIQUE race — resolve to the persisted proposal.
            InquiryProposal winner = proposals.findByWorkItemId(workItemId)
                    .orElseThrow(() -> race);
            return new ProposalResult(workItemId, InquiryWorkItemPhase.PROPOSED.name(), toView(winner));
        }
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

    private ProposalResult result(InquiryWorkItem workItem, InquiryProposal proposal) {
        return new ProposalResult(workItem.getId(), workItem.getPhase().name(), toView(proposal));
    }

    private ProposalView toView(InquiryProposal p) {
        return new ProposalView(
                p.getId(), p.getWorkItemId(), p.getInquiryId(), p.getActionKind(),
                p.getSummaryCategory(), p.isRequiresApproval(), p.getProposedBy(),
                p.getProviderKind(), p.getProviderName(), p.getProviderVersion());
    }
}
