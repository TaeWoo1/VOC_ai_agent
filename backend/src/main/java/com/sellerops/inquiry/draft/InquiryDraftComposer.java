package com.sellerops.inquiry.draft;

import com.sellerops.agent.llm.AgentDraftGenerator;
import com.sellerops.agent.llm.AgentDraftResponseParser;
import com.sellerops.agent.llm.AgentDraftService;
import com.sellerops.agent.quota.AgentQuotaService;
import com.sellerops.agent.quota.AgentUsageKind;
import com.sellerops.agent.quota.QuotaDecision;
import com.sellerops.common.ApiException;
import com.sellerops.common.MarkupText;
import com.sellerops.inquiry.Inquiry;
import com.sellerops.inquiry.InquiryRepository;
import com.sellerops.inquiry.draft.dto.DraftEvidenceView;
import com.sellerops.inquiry.draft.dto.GeneratedDraftView;
import com.sellerops.inquiry.proposal.InquiryProposalProvider;
import com.sellerops.inquiry.reply.InquiryReplyDraftService;
import com.sellerops.inquiry.reply.dto.ReplyDraftView;
import com.sellerops.inquiry.workitem.InquiryWorkItem;
import com.sellerops.inquiry.workitem.InquiryWorkItemRepository;
import com.sellerops.knowledge.KnowledgeScope;
import com.sellerops.order.fact.OrderFact;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import org.springframework.stereotype.Service;

/**
 * Inquiry Draft v1 — write a reply the seller can send, from what SellerOps can actually prove.
 *
 * <p><b>The order of evidence is the product.</b> The customer's question, then the canonical product
 * it is about, then the seller's own knowledge about that product. Nothing else is consulted, and
 * nothing that is not consulted is cited. When the knowledge is thin the draft is still written — a
 * seller with an empty library is not helped by a refusal — but it is written from the question alone
 * and the screen says so, in one sentence, above the text
 * ({@link DraftKnowledgeState#messageKo()}).
 *
 * <p><b>Two provenances that must not be confused.</b> A passage retrieved from 상품 지식 is something
 * a person at this company typed; a product FACT (brand, category, listing title) is something a
 * marketplace told us. They are different claims with different failure modes, and this class emits
 * only the first kind of evidence. The agent runtime keeps the same separation
 * ({@code PRODUCT_KNOWLEDGE_DOC} vs {@code PRODUCT_FACT}).
 *
 * <p><b>It writes a draft and nothing else.</b> No approval, no intent, no execution, no marketplace
 * call. The result is one more append-only version on the work item — the same object a seller who
 * typed it by hand would have produced, distinguishable only by the provenance stamped on it.
 */
@Service
public class InquiryDraftComposer {

    // How many passages reach the model, and how much of the question is used to find them, are
    // both decisions of the retrieval and live on InquiryEvidenceRetriever. They used to be here,
    // when there was one lane and this class WAS the retrieval.

    private final InquiryWorkItemRepository workItems;
    private final InquiryRepository inquiries;
    private final InquiryReplyDraftService drafts;
    private final InquiryDraftEvidenceRepository evidence;
    private final InquiryEvidenceRetriever retriever;
    private final AgentDraftService model;
    private final AgentQuotaService quota;
    private final InquiryProposalProvider rules;

    public InquiryDraftComposer(InquiryWorkItemRepository workItems, InquiryRepository inquiries,
                                InquiryReplyDraftService drafts, InquiryDraftEvidenceRepository evidence,
                                InquiryEvidenceRetriever retriever, AgentDraftService model,
                                AgentQuotaService quota, InquiryProposalProvider rules) {
        this.workItems = workItems;
        this.inquiries = inquiries;
        this.drafts = drafts;
        this.evidence = evidence;
        this.retriever = retriever;
        this.model = model;
        this.quota = quota;
        this.rules = rules;
    }

    /**
     * Generate one draft version for a work item, grounded where grounding is possible.
     *
     * <p>Charged against the org's daily AI budget before the model is reached, on the same counter
     * every other draft spends — a regenerate is a call, not a free retry. An exhausted budget does
     * not fail the request: the deterministic drafter writes instead, the version is stamped
     * {@link DraftAuthorKind#RULE}, and the seller is told why in {@code quotaMessage}. The dashboard,
     * the queue, and the send path are all unaffected by that exhaustion.
     */
    public GeneratedDraftView generate(UUID orgId, UUID workItemId, UUID sellerUserId) {
        return compose(orgId, workItemId, "SELLER:" + sellerUserId);
    }

    /**
     * As {@link #generate}, with the author named rather than derived from a user id — the seam the
     * Proactive Operations Agent drafts through, before any human has opened the inquiry.
     *
     * <p><b>Nothing else differs.</b> Same retrieval, same three lanes, same quota counter, same
     * fallback to the deterministic drafter when the budget is spent, same evidence rows, same
     * knowledge state. The org's daily AI budget is charged here exactly as it is for a seller-initiated
     * draft, because it is the same call and pretending otherwise would let a background loop spend a
     * budget the seller cannot see.
     */
    public GeneratedDraftView generateAs(UUID orgId, UUID workItemId, String actor) {
        return compose(orgId, workItemId, actor);
    }

    private GeneratedDraftView compose(UUID orgId, UUID workItemId, String actor) {
        InquiryWorkItem workItem = workItems.findById(workItemId)
                .filter(w -> w.getOrgId().equals(orgId))
                .orElseThrow(() -> ApiException.notFound("문의 작업을 찾을 수 없습니다."));
        Inquiry inquiry = inquiries.findById(workItem.getInquiryId())
                .filter(i -> i.getOrgId().equals(orgId))
                .orElseThrow(() -> ApiException.notFound("문의를 찾을 수 없습니다."));

        // The question, as a person wrote it — the stored body may be a mail thread wrapped in markup.
        String title = MarkupText.toPlainText(inquiry.getTitle());
        String details = MarkupText.toPlainText(inquiry.getBody());

        InquiryEvidenceRetriever.InquiryEvidence retrieved = retriever.retrieve(orgId, inquiry);

        String quotaMessage = null;
        Optional<AgentDraftResponseParser.ParsedDraft> written = Optional.empty();
        String modelVersion = model.versionFor(orgId);
        if (model.isEnabledFor(orgId)) {
            QuotaDecision decision = quota.consume(orgId, AgentUsageKind.DRAFT, null);
            if (decision.allowed()) {
                written = model.draft(orgId, title, details, passagesFor(retrieved.passages()),
                        retrieved.order().messageKo());
            } else {
                quotaMessage = decision.messageKo();
            }
        }

        DraftAuthorKind authorKind = written.isPresent() ? DraftAuthorKind.MODEL : DraftAuthorKind.RULE;
        // A rule draft is not grounded in anything, whatever the retrieval found — saying otherwise
        // would attach citations to a sentence that was never shown them.
        DraftKnowledgeState state = authorKind == DraftAuthorKind.MODEL
                ? retrieved.state() : degrade(retrieved.state());
        List<InquiryEvidenceRetriever.ScopedPassage> cited = authorKind == DraftAuthorKind.MODEL
                ? retrieved.passages() : List.of();
        Set<KnowledgeScope> scopes = authorKind == DraftAuthorKind.MODEL
                ? retrieved.scopes() : Set.of();

        String replyTitle = written.map(AgentDraftResponseParser.ParsedDraft::title)
                .filter(t -> t != null && !t.isBlank())
                .orElseGet(() -> defaultTitle(title));
        String replyBody = written.map(AgentDraftResponseParser.ParsedDraft::comments)
                .filter(c -> c != null && !c.isBlank())
                .orElseGet(() -> ruleBody(orgId, inquiry.getId(), title, details));

        int base = drafts.currentVersion(workItemId);
        ReplyDraftView saved = drafts.saveAs(orgId, workItemId, actor, replyTitle, replyBody, base,
                new InquiryReplyDraftService.Provenance(authorKind,
                        authorKind == DraftAuthorKind.MODEL ? modelVersion : null,
                        state, retrieved.productId()));

        // The order fact is cited on the same terms as a passage: only when the model actually saw
        // it. A rule draft was shown nothing, so it cites nothing.
        OrderFact citedOrder = authorKind == DraftAuthorKind.MODEL ? retrieved.order() : null;
        List<DraftEvidenceView> views =
                recordEvidence(orgId, workItemId, saved.version(), cited, citedOrder);
        return new GeneratedDraftView(saved, authorKind.name(), state.name(), state.messageKo(scopes),
                retrieved.productId(), views, quotaMessage);
    }

    /** The evidence for one draft version, for a reader that did not just generate it. */
    public List<DraftEvidenceView> evidenceFor(UUID orgId, UUID workItemId, int version) {
        workItems.findById(workItemId)
                .filter(w -> w.getOrgId().equals(orgId))
                .orElseThrow(() -> ApiException.notFound("문의 작업을 찾을 수 없습니다."));
        return evidence.findAllByWorkItemIdAndDraftVersionOrderByOrdinalAsc(workItemId, version).stream()
                .map(row -> new DraftEvidenceView(row.getKind(), InquiryDraftEvidence.scopeLabelOf(row.getKind()),
                        row.getTitle(), row.getLocator(), row.getSourceId(), row.getChunkId()))
                .toList();
    }

    /**
     * The state to report when the model never ran. GROUNDED becomes NO_MATCH: passages existed, but
     * nothing that wrote this draft ever saw them, and the seller must not read a citation into it.
     */
    private static DraftKnowledgeState degrade(DraftKnowledgeState state) {
        return state == DraftKnowledgeState.GROUNDED ? DraftKnowledgeState.NO_MATCH : state;
    }

    private static List<AgentDraftGenerator.Passage> passagesFor(
            List<InquiryEvidenceRetriever.ScopedPassage> passages) {
        return passages.stream()
                .map(p -> new AgentDraftGenerator.Passage(p.scope().labelKo(), p.heading(), p.text()))
                .toList();
    }

    /**
     * Record what the drafter was shown, one row per passage, with its scope.
     *
     * <p>The scope is stored in {@code kind}, which is a string column precisely so a new kind of
     * evidence does not need a migration to be recordable. Three kinds exist now; before this package
     * there was one, and the column already anticipated the rest.
     */
    private List<DraftEvidenceView> recordEvidence(UUID orgId, UUID workItemId, int version,
                                                   List<InquiryEvidenceRetriever.ScopedPassage> passages,
                                                   OrderFact order) {
        List<DraftEvidenceView> views = new ArrayList<>(passages.size() + 1);
        int ordinal = 0;
        for (InquiryEvidenceRetriever.ScopedPassage passage : passages) {
            InquiryDraftEvidence row = new InquiryDraftEvidence();
            row.setOrgId(orgId);
            row.setWorkItemId(workItemId);
            row.setDraftVersion(version);
            row.setOrdinal(ordinal++);
            row.setKind(InquiryDraftEvidence.kindOf(passage.scope()));
            row.setSourceId(passage.sourceId());
            row.setChunkId(passage.chunkId());
            row.setTitle(passage.heading());
            row.setLocator(passage.locator());
            evidence.save(row);
            views.add(new DraftEvidenceView(row.getKind(), passage.scope().labelKo(), row.getTitle(),
                    row.getLocator(), row.getSourceId(), row.getChunkId()));
        }
        // Last, and only when an order was actually resolved. A row for "주문 번호가 없었습니다" would
        // be a citation of an absence, and the screen already says that in the state sentence.
        if (order != null && order.available()) {
            InquiryDraftEvidence row = new InquiryDraftEvidence();
            row.setOrgId(orgId);
            row.setWorkItemId(workItemId);
            row.setDraftVersion(version);
            row.setOrdinal(ordinal);
            row.setKind(InquiryDraftEvidence.KIND_ORDER_FACT);
            // No source/chunk: this evidence points at no document. What it points at is a moment.
            row.setTitle(KnowledgeScope.ORDER_STATE.labelKo());
            row.setLocator(orderLocator(order));
            evidence.save(row);
            views.add(new DraftEvidenceView(row.getKind(), KnowledgeScope.ORDER_STATE.labelKo(),
                    row.getTitle(), row.getLocator(), null, null));
        }
        return views;
    }

    /**
     * {@code order-fact/NAVER:OBSERVED_FRESH@2026-08-25} — channel, freshness, and the day it was seen.
     *
     * <p>The order identifier is deliberately absent. A locator exists so a person can re-check the
     * claim, and re-checking an order state means re-reading the channel at a date — which this
     * says — not looking the number up in a log.
     */
    private static String orderLocator(OrderFact order) {
        String day = order.asOf() == null ? "미상"
                : order.asOf().atZone(java.time.ZoneId.of("Asia/Seoul")).toLocalDate().toString();
        return "order-fact/" + (order.channelCode() == null ? "채널미상" : order.channelCode())
                + ":" + order.state().name() + "@" + day;
    }

    private static String defaultTitle(String inquiryTitle) {
        String base = inquiryTitle == null || inquiryTitle.isBlank() ? "문의" : inquiryTitle.strip();
        String prefixed = "[답변] " + base;
        return prefixed.length() > 100 ? prefixed.substring(0, 100) : prefixed;
    }

    /**
     * The deterministic body, used when no model wrote one.
     *
     * <p>It commits to nothing. The rule provider knows what the question is ABOUT, not what the
     * answer is, so the text says the seller will check and reply — which is true, and is what the
     * seller then edits. Inventing a shipping date here would be the same defect as inventing one in
     * the model, minus the excuse.
     */
    private String ruleBody(UUID orgId, UUID inquiryId, String title, String details) {
        // Only title/details drive the categorisation (RuleBasedInquiryProposalProvider reads nothing
        // else); the ids travel because the record carries them, not because this path uses them.
        String category = rules.propose(new InquiryProposalProvider.SellerInquiryContext(
                orgId, inquiryId, title, details, null, null)).summaryCategory();
        String opening = switch (category) {
            case "delivery_status_reply" -> "배송 관련 문의 주셔서 감사합니다.";
            case "exchange_return_reply" -> "교환·반품 문의 주셔서 감사합니다.";
            case "stock_availability_reply", "stock_restock_reply" -> "재고 문의 주셔서 감사합니다.";
            case "product_info_reply" -> "상품 문의 주셔서 감사합니다.";
            case "installation_guidance_reply" -> "설치 관련 문의 주셔서 감사합니다.";
            case "pricing_reply" -> "가격 문의 주셔서 감사합니다.";
            case "quality_issue_reply" -> "불편을 드려 죄송합니다. 문의 주셔서 감사합니다.";
            default -> "문의 주셔서 감사합니다.";
        };
        return opening + "\n문의하신 내용을 확인한 뒤 정확한 안내를 드리겠습니다. 잠시만 기다려 주세요.\n감사합니다.";
    }
}
