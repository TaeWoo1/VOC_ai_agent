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
import java.util.EnumMap;
import java.util.List;
import java.util.Map;
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

    public InquiryKnowledgeCoverageService(InquiryRepository inquiries, ChannelRepository channels,
                                           InquiryEvidenceRetriever retriever,
                                           OrgKnowledgeSourceRepository orgKnowledge,
                                           AnswerMemoryRepository answerMemories,
                                           InquiryWorkItemRepository workItems) {
        this.inquiries = inquiries;
        this.channels = channels;
        this.retriever = retriever;
        this.orgKnowledge = orgKnowledge;
        this.answerMemories = answerMemories;
        this.workItems = workItems;
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
     * @param missingProduct  needed product knowledge and the inquiry resolves to no named product
     * @param missingPolicy   needed operating policy and no policy passage was found
     * @param missingOrder    needed order context and the deterministic read has none
     */
    public record CoverageReport(String channelCode, int inquiries,
                                 Map<InquiryKnowledgeNeed, Integer> byNeed,
                                 Map<CoverageOutcome, Integer> byOutcome,
                                 int missingProduct, int missingPolicy, int missingOrder,
                                 int orgKnowledgeDocuments, int answerMemories) {
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
                                  String orderReason, int supersededMemories) {
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
                evidence.order().reasonCode(),
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
        Map<CoverageOutcome, Integer> byOutcome = new EnumMap<>(CoverageOutcome.class);
        int missingProduct = 0;
        int missingPolicy = 0;
        int missingOrder = 0;

        for (Inquiry inquiry : corpus) {
            String title = MarkupText.toPlainText(inquiry.getTitle());
            String body = MarkupText.toPlainText(inquiry.getBody());
            InquiryKnowledgeNeed need = InquiryKnowledgeNeed.of(title, body);
            byNeed.merge(need, 1, Integer::sum);

            InquiryEvidenceRetriever.InquiryEvidence evidence = retriever.retrieve(orgId, inquiry);
            var scopes = evidence.scopes();
            boolean wantsProduct = need == InquiryKnowledgeNeed.PRODUCT_KNOWLEDGE_NEEDED
                    || need == InquiryKnowledgeNeed.MULTI_SOURCE;
            boolean wantsPolicy = need == InquiryKnowledgeNeed.ORG_POLICY_NEEDED
                    || need == InquiryKnowledgeNeed.MULTI_SOURCE;
            boolean wantsOrder = need == InquiryKnowledgeNeed.ORDER_CONTEXT_NEEDED
                    || need == InquiryKnowledgeNeed.MULTI_SOURCE;

            boolean hasProduct = scopes.contains(KnowledgeScope.PRODUCT);
            boolean hasPolicy = scopes.contains(KnowledgeScope.ORG_OPERATIONS);
            boolean hasOrder = evidence.order().available();
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
        }
        for (CoverageOutcome outcome : CoverageOutcome.values()) {
            byOutcome.putIfAbsent(outcome, 0);
        }
        // What the library HELD while this was measured. Without it a coverage number is unreadable:
        // "0 grounded" over an empty library and over a full one are different findings.
        return new CoverageReport(channelCode, corpus.size(), byNeed, byOutcome,
                missingProduct, missingPolicy, missingOrder,
                (int) orgKnowledge.countByOrgId(orgId), (int) answerMemories.countByOrgId(orgId));
    }
}
