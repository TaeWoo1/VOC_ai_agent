package com.sellerops.inquiry.memory;

import com.sellerops.channel.Channel;
import com.sellerops.channel.ChannelRepository;
import com.sellerops.common.MarkupText;
import com.sellerops.inquiry.Inquiry;
import com.sellerops.inquiry.proposal.InquiryProposalProvider;
import com.sellerops.inquiry.reply.InquiryReplyDraft;
import com.sellerops.knowledge.memory.AnswerMemoryService;
import com.sellerops.knowledge.memory.AnswerMemoryStrength;
import com.sellerops.product.OperatorProductName;
import com.sellerops.product.ProductRepository;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

/**
 * The two moments in the send lifecycle that are worth remembering.
 *
 * <p><b>Draft → 수정 → 승인 → SENT → VERIFIED, and only two of those write memory.</b> An APPROVAL is
 * the seller saying "this is what we say" — a preference, recorded as {@code USER_APPROVED}. A
 * VERIFIED send is that plus proof the customer received it, recorded as
 * {@code EXECUTOR_SENT_VERIFIED}. A draft, an edit in progress, and a dispatch whose delivery is
 * still ambiguous write nothing: the first two are not the seller's word yet, and the third is not
 * known to have happened.
 *
 * <p><b>Wired now, though no live WRITE exists.</b> Publish execution is off in this deployment, so
 * the verified path will not fire until a real send does. That is the point of connecting the
 * contract first — nothing here manufactures a SENT or VERIFIED row to make a demo work, and when a
 * real one arrives the memory records it without a second design.
 *
 * <p><b>Best-effort, always.</b> The approval and the send are the operations; remembering them is
 * not. A failure here is logged with ids and counts only and never fails the publish that produced
 * it — a seller must not be told their approval failed because an index could not be updated.
 */
@Component
public class InquiryAnswerMemoryHook {

    private static final Logger log = LoggerFactory.getLogger(InquiryAnswerMemoryHook.class);

    private final AnswerMemoryService memory;
    private final ChannelRepository channels;
    private final ProductRepository products;
    private final InquiryProposalProvider rules;

    public InquiryAnswerMemoryHook(AnswerMemoryService memory, ChannelRepository channels,
                                   ProductRepository products, InquiryProposalProvider rules) {
        this.memory = memory;
        this.channels = channels;
        this.products = products;
        this.rules = rules;
    }

    /**
     * The seller confirmed this exact draft version.
     *
     * <p>Keyed on the version as well as the work item, so approving a revised draft after a first
     * approval is a second act rather than a silent overwrite of the first.
     */
    public void rememberApproved(Inquiry inquiry, InquiryReplyDraft approved, UUID sellerUserId) {
        remember(inquiry, approved, AnswerMemoryStrength.USER_APPROVED,
                "approved:" + approved.getWorkItemId() + ":" + approved.getVersion(), sellerUserId);
    }

    /**
     * The channel confirmed the answer is there.
     *
     * <p>Keyed on the work item alone: an inquiry is answered once, and a second verification of the
     * same send is the same fact observed twice.
     */
    public void rememberVerified(Inquiry inquiry, InquiryReplyDraft sent, UUID sellerUserId) {
        remember(inquiry, sent, AnswerMemoryStrength.EXECUTOR_SENT_VERIFIED,
                "verified:" + sent.getWorkItemId(), sellerUserId);
    }

    private void remember(Inquiry inquiry, InquiryReplyDraft draft, AnswerMemoryStrength strength,
                          String originRef, UUID sellerUserId) {
        if (inquiry == null || draft == null) {
            return;
        }
        try {
            String title = MarkupText.toPlainText(inquiry.getTitle());
            String body = MarkupText.toPlainText(inquiry.getBody());
            String category = rules.propose(new InquiryProposalProvider.SellerInquiryContext(
                    inquiry.getOrgId(), inquiry.getId(), title, body, null, null)).summaryCategory();
            memory.remember(new AnswerMemoryService.RememberCommand(
                    inquiry.getOrgId(), originRef, strength,
                    // Read for the topic signature and then dropped; never stored.
                    (title == null ? "" : title) + " " + (body == null ? "" : body),
                    draft.getTitle(), draft.getComments(),
                    namedProductOrNull(inquiry.getOrgId(), inquiry.getProductId()),
                    channelCode(inquiry.getChannelId()), inquiry.getSourceSubtype(), category,
                    inquiry.getId(), draft.getWorkItemId(), draft.getVersion(), sellerUserId, null,
                    inquiry.getDataOrigin()));
        } catch (RuntimeException e) {
            log.warn("answer-memory hook skipped org={} strength={}: {}",
                    inquiry.getOrgId(), strength, e.toString());
        }
    }

    private UUID namedProductOrNull(UUID orgId, UUID productId) {
        if (productId == null) {
            return null;
        }
        return products.findById(productId)
                .filter(p -> orgId.equals(p.getOrgId()))
                .filter(p -> OperatorProductName.displayNameOrNull(p) != null)
                .map(p -> productId)
                .orElse(null);
    }

    private String channelCode(UUID channelId) {
        return channelId == null ? null
                : channels.findById(channelId).map(Channel::getCode).orElse(null);
    }
}
