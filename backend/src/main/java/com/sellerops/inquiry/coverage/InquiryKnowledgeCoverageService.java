package com.sellerops.inquiry.coverage;

import com.sellerops.channel.Channel;
import com.sellerops.channel.ChannelRepository;
import com.sellerops.common.ApiException;
import com.sellerops.common.MarkupText;
import com.sellerops.inquiry.Inquiry;
import com.sellerops.inquiry.InquiryRepository;
import com.sellerops.inquiry.workitem.InquiryWorkItem;
import com.sellerops.inquiry.workitem.InquiryWorkItemRepository;
import com.sellerops.inquiry.draft.InquiryEvidenceRetriever;
import com.sellerops.inquiry.draft.InquiryKnowledgeNeed;
import com.sellerops.knowledge.KnowledgeScope;
import com.sellerops.knowledge.memory.AnswerMemoryRepository;
import com.sellerops.knowledge.org.OrgKnowledgeSourceRepository;
import com.sellerops.order.ChannelOrderRepository;
import com.sellerops.order.fact.ExactOrderLookupCapability;
import com.sellerops.order.fact.OrderFactState;
import java.util.EnumMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * How much of a real backlog this knowledge architecture can actually reach.
 *
 * <p><b>A measurement, run over the database, touching no marketplace and no model.</b> For each
 * still-unanswered inquiry it asks two independent questions — what would this need to be answered
 * from, and what did the retrieval actually find — and reports the cross-tabulation as counts. No
 * draft is generated, so the number costs nothing and does not move because a model had a good day.
 *
 * <p><b>Counts only, and that is a privacy property, not a formatting choice.</b> The corpus is real
 * customer mail containing names, addresses and order numbers. Nothing that leaves this class is
 * derived from an individual inquiry: the output is a set of integers per category. A per-row report
 * would be the same data leak as printing the backlog.
 *
 * <p><b>What the numbers are for.</b> "69건 중 몇 건이 근거 기반으로 처리 가능한가" separates two things
 * that look identical from outside: a question this design cannot reach, and a question it reaches
 * the moment someone writes the policy. The first is a reason to change the architecture; the second
 * is a reason to write a document. Before this package every org-level question was the first kind,
 * because there was no org-level lane at all.
 */
@Service
public class InquiryKnowledgeCoverageService {

    private final InquiryRepository inquiries;
    private final ChannelRepository channels;
    private final InquiryEvidenceRetriever retriever;
    private final OrgKnowledgeSourceRepository orgKnowledge;
    private final AnswerMemoryRepository answerMemories;
    private final InquiryWorkItemRepository workItems;
    private final ChannelOrderRepository channelOrders;

    public InquiryKnowledgeCoverageService(InquiryRepository inquiries, ChannelRepository channels,
                                           InquiryEvidenceRetriever retriever,
                                           OrgKnowledgeSourceRepository orgKnowledge,
                                           AnswerMemoryRepository answerMemories,
                                           InquiryWorkItemRepository workItems,
                                           ChannelOrderRepository channelOrders) {
        this.inquiries = inquiries;
        this.channels = channels;
        this.retriever = retriever;
        this.orgKnowledge = orgKnowledge;
        this.answerMemories = answerMemories;
        this.workItems = workItems;
        this.channelOrders = channelOrders;
    }

    /** What the retrieval managed for one inquiry, judged against what that inquiry needed. */
    public enum CoverageOutcome {

        /** Every scope this question needs produced at least one passage. */
        GROUNDED,

        /** Some needed scope produced a passage and another did not. */
        PARTIALLY_GROUNDED,

        /** Nothing was found in any scope. */
        UNSUPPORTED;
    }

    /**
     * The audit over one channel's real unanswered backlog.
     *
     * @param byNeed          the collapsed label per inquiry, for a bucket chart
     * @param byAxis          how many inquiries need EACH axis — the honest denominator. A question
     *                        needing product and policy counts once in each and never lands in an
     *                        "order" total it has nothing to do with, which the {@code MULTI_SOURCE}
     *                        label could not prevent
     * @param missingProduct  needed product knowledge and the inquiry resolves to no named product
     * @param missingPolicy   needed operating policy and no policy passage was found
     * @param missingOrder    needed order context and the deterministic read produced no fact
     * @param byOrderFact     every inquiry's order-fact verdict, whether or not it asked about one.
     *                        Kept unconditional because "얼마나 많은 문의가 주문을 지목하는가" is a fact
     *                        about the SOURCE, and filtering it by our own keyword classifier would
     *                        measure the classifier
     */
    public record CoverageReport(String channelCode, int inquiries,
                                 Map<InquiryKnowledgeNeed, Integer> byNeed,
                                 Map<InquiryKnowledgeNeed, Integer> byAxis,
                                 Map<CoverageOutcome, Integer> byOutcome,
                                 Map<OrderFactState, Integer> byOrderFact,
                                 int missingProduct, int missingPolicy, int missingOrder,
                                 int orderReferencePresent, int orderBoundToStoredFact,
                                 int orgKnowledgeDocuments, int answerMemories,
                                 int storedOrders, String exactLookupCapability) {
    }

    /**
     * What the retrieval would offer ONE inquiry, with no draft written and no model spent.
     *
     * <p>The per-row companion of {@link #measure}, and the only per-row thing here. It carries the
     * seller's own document titles and provenance strings and no customer text at all — which is
     * what makes it printable in a proof, unlike a generated draft.
     *
     * @param passages heading + locator + score. The passage TEXT is deliberately absent: this
     *                 answers "what would ground a reply", not "what does it say".
     */
    public record EvidencePreview(InquiryKnowledgeNeed need, String knowledgeState, UUID productId,
                                  List<String> scopes, List<PreviewPassage> passages,
                                  String orderFactState, boolean orderReferencePresent,
                                  int supersededMemories) {
    }

    /** One would-be citation. */
    public record PreviewPassage(String scope, String heading, String locator, double score) {
    }

    /** Preview the evidence for one work item. Reads nothing the seller has not written. */
    @Transactional(readOnly = true)
    public EvidencePreview preview(UUID orgId, UUID workItemId) {
        InquiryWorkItem workItem = workItems.findById(workItemId)
                .filter(w -> orgId.equals(w.getOrgId()))
                .orElseThrow(() -> ApiException.notFound("문의 작업을 찾을 수 없습니다."));
        Inquiry inquiry = inquiries.findById(workItem.getInquiryId())
                .filter(i -> orgId.equals(i.getOrgId()))
                .orElseThrow(() -> ApiException.notFound("문의를 찾을 수 없습니다."));

        InquiryEvidenceRetriever.InquiryEvidence evidence = retriever.retrieve(orgId, inquiry);
        return new EvidencePreview(
                InquiryKnowledgeNeed.of(MarkupText.toPlainText(inquiry.getTitle()),
                        MarkupText.toPlainText(inquiry.getBody())),
                evidence.state().name(),
                evidence.productId(),
                evidence.scopes().stream().map(Enum::name).toList(),
                evidence.passages().stream()
                        .map(p -> new PreviewPassage(p.scope().name(), p.heading(), p.locator(), p.score()))
                        .toList(),
                evidence.order().state().name(),
                inquiry.getSourceOrderRef() != null,
                evidence.supersededMemories());
    }

    /**
     * Measure one channel's backlog.
     *
     * <p>Bounded by the channel's own unanswered rows. Read-only in every sense: no draft version is
     * written, no memory is recorded, no work item moves.
     */
    @Transactional(readOnly = true)
    public CoverageReport measure(UUID orgId, String channelCode) {
        Channel channel = channels.findByCode(channelCode)
                .orElseThrow(() -> ApiException.notFound("채널을 찾을 수 없습니다."));
        List<Inquiry> corpus = inquiries.findRealUnansweredForCoverage(orgId, channel.getId());

        Map<InquiryKnowledgeNeed, Integer> byNeed = new EnumMap<>(InquiryKnowledgeNeed.class);
        Map<InquiryKnowledgeNeed, Integer> byAxis = new EnumMap<>(InquiryKnowledgeNeed.class);
        Map<CoverageOutcome, Integer> byOutcome = new EnumMap<>(CoverageOutcome.class);
        Map<OrderFactState, Integer> byOrderFact = new EnumMap<>(OrderFactState.class);
        int missingProduct = 0;
        int missingPolicy = 0;
        int missingOrder = 0;
        int referencePresent = 0;
        int boundToStoredFact = 0;

        for (Inquiry inquiry : corpus) {
            String title = MarkupText.toPlainText(inquiry.getTitle());
            String body = MarkupText.toPlainText(inquiry.getBody());
            InquiryKnowledgeNeed need = InquiryKnowledgeNeed.of(title, body);
            byNeed.merge(need, 1, Integer::sum);
            Set<InquiryKnowledgeNeed> axes = InquiryKnowledgeNeed.axesOf(title, body);
            axes.forEach(axis -> byAxis.merge(axis, 1, Integer::sum));

            InquiryEvidenceRetriever.InquiryEvidence evidence = retriever.retrieve(orgId, inquiry);
            var scopes = evidence.scopes();
            // The axes, not the collapsed label. Before 2026-08-25 this read MULTI_SOURCE as needing
            // all three, which put two product+policy questions into the order-context total.
            boolean wantsProduct = axes.contains(InquiryKnowledgeNeed.PRODUCT_KNOWLEDGE_NEEDED);
            boolean wantsPolicy = axes.contains(InquiryKnowledgeNeed.ORG_POLICY_NEEDED);
            boolean wantsOrder = axes.contains(InquiryKnowledgeNeed.ORDER_CONTEXT_NEEDED);

            boolean hasProduct = scopes.contains(KnowledgeScope.PRODUCT);
            boolean hasPolicy = scopes.contains(KnowledgeScope.ORG_OPERATIONS);
            boolean hasOrder = evidence.order().available();
            byOrderFact.merge(evidence.order().state(), 1, Integer::sum);
            if (inquiry.getSourceOrderRef() != null) {
                referencePresent++;
                if (hasOrder) {
                    boundToStoredFact++;
                }
            }
            if (wantsProduct && !hasProduct) {
                missingProduct++;
            }
            if (wantsPolicy && !hasPolicy) {
                missingPolicy++;
            }
            if (wantsOrder && !hasOrder) {
                missingOrder++;
            }

            int wanted = (wantsProduct ? 1 : 0) + (wantsPolicy ? 1 : 0) + (wantsOrder ? 1 : 0);
            int met = (wantsProduct && hasProduct ? 1 : 0) + (wantsPolicy && hasPolicy ? 1 : 0)
                    + (wantsOrder && hasOrder ? 1 : 0);
            // A question with no identified need is judged on whether anything was found at all: it
            // is the CURRENTLY_UNANSWERABLE bucket, and evidence for it is still evidence.
            CoverageOutcome outcome;
            if (wanted == 0) {
                outcome = scopes.isEmpty() ? CoverageOutcome.UNSUPPORTED : CoverageOutcome.GROUNDED;
            } else if (met == wanted) {
                outcome = CoverageOutcome.GROUNDED;
            } else if (met > 0 || !scopes.isEmpty()) {
                outcome = CoverageOutcome.PARTIALLY_GROUNDED;
            } else {
                outcome = CoverageOutcome.UNSUPPORTED;
            }
            byOutcome.merge(outcome, 1, Integer::sum);
        }
        for (InquiryKnowledgeNeed need : InquiryKnowledgeNeed.values()) {
            byNeed.putIfAbsent(need, 0);
            byAxis.putIfAbsent(need, 0);
        }
        for (CoverageOutcome outcome : CoverageOutcome.values()) {
            byOutcome.putIfAbsent(outcome, 0);
        }
        for (OrderFactState state : OrderFactState.values()) {
            byOrderFact.putIfAbsent(state, 0);
        }
        // What the library and the ORDER STORE held while this was measured. Without both, a coverage
        // number is unreadable: "0 bound" over an empty order store and over a full one are different
        // findings, and only the second is a defect.
        long stored = channelOrders.countByChannel(orgId).stream()
                .filter(row -> channel.getId().equals(row[0]))
                .mapToLong(row -> ((Number) row[1]).longValue())
                .sum();
        return new CoverageReport(channelCode, corpus.size(), byNeed, byAxis, byOutcome, byOrderFact,
                missingProduct, missingPolicy, missingOrder, referencePresent, boundToStoredFact,
                (int) orgKnowledge.countByOrgId(orgId), (int) answerMemories.countByOrgId(orgId),
                (int) stored,
                ExactOrderLookupCapability.endpointFor(channelCode)
                        .orElse(ExactOrderLookupCapability.NO_VENDORED_EXACT_LOOKUP));
    }
}
