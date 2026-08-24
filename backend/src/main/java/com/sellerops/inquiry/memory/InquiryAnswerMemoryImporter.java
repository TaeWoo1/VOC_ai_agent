package com.sellerops.inquiry.memory;

import com.sellerops.channel.Channel;
import com.sellerops.channel.ChannelRepository;
import com.sellerops.common.MarkupText;
import com.sellerops.inquiry.Inquiry;
import com.sellerops.inquiry.InquiryRepository;
import com.sellerops.inquiry.proposal.InquiryProposalProvider;
import com.sellerops.knowledge.memory.AnswerMemoryService;
import com.sellerops.knowledge.memory.AnswerMemoryStrength;
import com.sellerops.product.OperatorProductName;
import com.sellerops.product.ProductRepository;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

/**
 * The seller's answers, as the channel already has them, brought into Answer Memory.
 *
 * <p><b>This is not a collection path.</b> It reaches no marketplace and opens no credential. It
 * reads rows the collection already stored — an inquiry whose channel reports it ANSWERED and
 * carries the answer text — and records that the seller said it. The Demo Org's 18 REAL answered
 * NAVER inquiries are the only genuinely seller-authored answers in this deployment, and they exist
 * because a person typed them into 스마트스토어, not because anything here generated them.
 *
 * <p><b>Idempotent, and safe to run on every ingest.</b> The origin ref is the inquiry, so a
 * re-collection updates one row rather than adding one. Strength never falls: an answer this org has
 * since approved or verified in SellerOps keeps that standing when the channel re-states it.
 *
 * <p><b>The product binding is inherited only when it means something.</b> Ingest mints a shared
 * {@code (미지정 상품)} row for nameless sources, so most inquiries carry a non-null product id that
 * points at a bucket. Binding a memory to it would scope that answer to a bucket and hide it from
 * every real question, so an unnamed product reads as no product here — the same judgement the draft
 * retrieval makes ({@code OperatorProductName#displayNameOrNull}).
 */
@Component
public class InquiryAnswerMemoryImporter {

    private static final Logger log = LoggerFactory.getLogger(InquiryAnswerMemoryImporter.class);

    private final InquiryRepository inquiries;
    private final ChannelRepository channels;
    private final ProductRepository products;
    private final AnswerMemoryService memory;
    private final InquiryProposalProvider rules;

    public InquiryAnswerMemoryImporter(InquiryRepository inquiries, ChannelRepository channels,
                                       ProductRepository products, AnswerMemoryService memory,
                                       InquiryProposalProvider rules) {
        this.inquiries = inquiries;
        this.channels = channels;
        this.products = products;
        this.memory = memory;
        this.rules = rules;
    }

    /**
     * Import every collected seller answer this org has.
     *
     * <p>Bounded by the rows that carry an answer body — on every channel SellerOps reads today that
     * is a small subset, and on Cafe24 it is currently none, because board comments are not
     * collected. Best-effort per row: one malformed inquiry must not stop the rest.
     *
     * @return how many memory rows were written or updated
     */
    public int importCollectedAnswers(UUID orgId) {
        int written = 0;
        for (Inquiry inquiry : inquiries.findAnsweredWithAnswerBody(orgId)) {
            try {
                if (remember(orgId, inquiry)) {
                    written++;
                }
            } catch (RuntimeException e) {
                // Enum and count only — never the inquiry's content and never the buyer.
                log.warn("answer-memory import skipped one row org={}: {}", orgId, e.toString());
            }
        }
        return written;
    }

    private boolean remember(UUID orgId, Inquiry inquiry) {
        String title = MarkupText.toPlainText(inquiry.getTitle());
        String body = MarkupText.toPlainText(inquiry.getBody());
        String category = rules.propose(new InquiryProposalProvider.SellerInquiryContext(
                orgId, inquiry.getId(), title, body, null, null)).summaryCategory();
        return memory.remember(new AnswerMemoryService.RememberCommand(
                orgId,
                "inquiry-answer:" + inquiry.getId(),
                AnswerMemoryStrength.IMPORTED_SELLER_ANSWER,
                // The question is read to build the topic signature and is not stored.
                (title == null ? "" : title) + " " + (body == null ? "" : body),
                null,
                MarkupText.toPlainText(inquiry.getAnswerBody()),
                namedProductOrNull(orgId, inquiry.getProductId()),
                channelCode(inquiry.getChannelId()),
                inquiry.getSourceSubtype(),
                category,
                inquiry.getId(),
                null,
                null,
                null,
                null,
                inquiry.getDataOrigin())).isPresent();
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
