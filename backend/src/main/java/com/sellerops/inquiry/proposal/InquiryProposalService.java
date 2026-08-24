package com.sellerops.inquiry.proposal;

import com.sellerops.channel.Channel;
import com.sellerops.channel.ChannelRepository;
import com.sellerops.common.ApiException;
import com.sellerops.common.MarkupText;
import com.sellerops.inquiry.Inquiry;
import com.sellerops.inquiry.InquiryRepository;
import com.sellerops.inquiry.proposal.InquiryProposalProvider.Draft;
import com.sellerops.inquiry.proposal.InquiryProposalProvider.SellerInquiryContext;
import com.sellerops.inquiry.proposal.dto.InquiryDetail;
import com.sellerops.inquiry.proposal.dto.ProposalResult;
import com.sellerops.inquiry.proposal.dto.ProposalView;
import com.sellerops.inquiry.reply.InquiryReplyDraftRepository;
import com.sellerops.inquiry.reply.dto.ReplyDraftView;
import com.sellerops.inquiry.workitem.InquiryWorkItem;
import com.sellerops.inquiry.workitem.InquiryWorkItemPhase;
import com.sellerops.inquiry.workitem.InquiryWorkItemRepository;
import com.sellerops.inquiry.draft.InquiryDraftEvidenceRepository;
import com.sellerops.inquiry.draft.dto.DraftEvidenceView;
import com.sellerops.inquiry.publish.InquiryReplyCapabilityRegistry;
import com.sellerops.inquiry.publish.PreSendCheck;
import com.sellerops.inquiry.publish.InquiryTargetStateReader;
import com.sellerops.product.OperatorProductName;
import com.sellerops.product.ProductRepository;
import java.util.List;
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
    private final InquiryReplyDraftRepository drafts;
    private final ChannelRepository channels;
    private final ProductRepository products;
    private final InquiryDraftEvidenceRepository draftEvidence;
    private final InquiryReplyCapabilityRegistry capabilities;
    private final InquiryTargetStateReader targetState;

    public InquiryProposalService(InquiryWorkItemRepository workItems, InquiryProposalRepository proposals,
                                  InquiryRepository inquiries, InquiryProposalProvider provider,
                                  InquiryProposalWriter writer, InquiryReplyDraftRepository drafts,
                                  ChannelRepository channels, ProductRepository products,
                                  InquiryDraftEvidenceRepository draftEvidence,
                                  InquiryTargetStateReader targetState,
                                  InquiryReplyCapabilityRegistry capabilities) {
        this.workItems = workItems;
        this.proposals = proposals;
        this.inquiries = inquiries;
        this.provider = provider;
        this.writer = writer;
        this.drafts = drafts;
        this.channels = channels;
        this.products = products;
        this.draftEvidence = draftEvidence;
        this.capabilities = capabilities;
        this.targetState = targetState;
    }

    /** Seller-only, org-scoped detail exposing the raw title/details (never author). */
    public InquiryDetail detail(UUID orgId, UUID workItemId) {
        InquiryWorkItem workItem = loadWorkItem(orgId, workItemId);
        Inquiry inquiry = loadInquiry(orgId, workItem.getInquiryId());
        ProposalView proposal = proposals.findByWorkItemId(workItemId).map(this::toView).orElse(null);
        ReplyDraftView draft = drafts.findTopByWorkItemIdOrderByVersionDesc(workItemId)
                .map(ReplyDraftView::of).orElse(null);
        // Resolve the channel labels fail-open (null if the catalog row is absent), mirroring the
        // review reply-work read; the raw channelId still travels for callers that key on it.
        Channel channel = channels.findById(workItem.getChannelId()).orElse(null);
        PreSendCheck answerState = targetState.read(orgId, workItem.getChannelId());
        String channelCode = channel == null ? null : channel.getCode();
        String channelNameKo = channel == null ? null : channel.getNameKo();
        return new InquiryDetail(
                workItem.getId(),
                inquiry.getId(),
                workItem.getSellerAccountId(),
                workItem.getChannelId(),
                channelCode,
                channelNameKo,
                inquiry.getSecret(),
                workItem.getPhase().name(),
                inquiry.getStatus(),
                inquiry.getInformStatus(),
                MarkupText.toPlainText(inquiry.getTitle()),
                MarkupText.toPlainText(inquiry.getBody()),
                inquiry.getReceivedAt(),
                proposal,
                draft,
                inquiry.getProductId(),
                productName(inquiry.getProductId()),
                inquiry.getProductBinding(),
                inquiry.getSourceSubtype(),
                answerState.stateProven(),
                answerStateNote(answerState),
                draft == null ? List.of()
                        : draftEvidence.findAllByWorkItemIdAndDraftVersionOrderByOrdinalAsc(
                                workItemId, draft.version()).stream()
                        .map(row -> new DraftEvidenceView(row.getKind(), row.getTitle(), row.getLocator(),
                                row.getSourceId(), row.getChunkId()))
                        .toList(),
                capabilities.capability(channelCode, inquiry.getSourceSubtype()));
    }

    /**
     * The canonical product's own name, or null — never the channel listing title, and never ingest's
     * shared {@code (미지정 상품)} bucket, which is an artifact rather than a product. The screen says
     * "상품 미지정" for a null, which is the truth in both cases.
     */
    private String productName(UUID productId) {
        return productId == null ? null
                : products.findById(productId).map(OperatorProductName::displayNameOrNull).orElse(null);
    }

    /**
     * The sentence shown beside the send control when the answer state is stale.
     *
     * <p>Only the negative case produces text. "확인했습니다" on a fresh channel is a reassurance the
     * seller did not ask for and would learn to skip, which is exactly how a warning stops working
     * on the day it matters.
     */
    private static String answerStateNote(PreSendCheck check) {
        if (check.stateProven()) {
            return null;
        }
        return PreSendCheck.STATE_NOT_FRESH.equals(check.note())
                ? "이 채널의 문의 수집이 최신이 아니라, 이 문의에 이미 답변이 달렸는지 지금은 확인할 수 없습니다."
                : "이 채널의 문의 수집 상태를 읽지 못해, 이 문의에 이미 답변이 달렸는지 확인할 수 없습니다.";
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
