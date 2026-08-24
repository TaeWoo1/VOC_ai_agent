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
import com.sellerops.product.OperatorProductName;
import com.sellerops.product.ProductRepository;
import com.sellerops.product.library.ProductKnowledgeLibraryService;
import com.sellerops.product.library.dto.KnowledgePassage;
import com.sellerops.product.library.dto.KnowledgeSearchResponse;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
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

    /**
     * How many passages reach the model.
     *
     * <p>Three, not five. The retrieval is already scoped to one product and ranked; passages four
     * and five are the ones whose {@code topicCoverage} barely cleared the floor, and a drafter given
     * a weak passage tends to use it. The citation list a seller reads before sending is also three
     * lines rather than five.
     */
    static final int MAX_PASSAGES = 3;

    /**
     * How much of the question is used as the retrieval query.
     *
     * <p>The Cafe24 backlog contains forwarded mail threads running to thousands of characters, where
     * the actual question is the first line and the rest is quoted history. A whole thread as a query
     * dilutes every term: the IDF weighting spreads across hundreds of shingles and the topic the
     * seller was asked about stops being the topic that scores. The title plus the head of the body
     * is where the question is.
     */
    static final int QUERY_CHARS = 400;

    private final InquiryWorkItemRepository workItems;
    private final InquiryRepository inquiries;
    private final InquiryReplyDraftService drafts;
    private final InquiryDraftEvidenceRepository evidence;
    private final ProductRepository products;
    private final ProductKnowledgeLibraryService library;
    private final AgentDraftService model;
    private final AgentQuotaService quota;
    private final InquiryProposalProvider rules;

    public InquiryDraftComposer(InquiryWorkItemRepository workItems, InquiryRepository inquiries,
                                InquiryReplyDraftService drafts, InquiryDraftEvidenceRepository evidence,
                                ProductKnowledgeLibraryService library, AgentDraftService model,
                                AgentQuotaService quota, InquiryProposalProvider rules,
                                ProductRepository products) {
        this.workItems = workItems;
        this.inquiries = inquiries;
        this.drafts = drafts;
        this.evidence = evidence;
        this.library = library;
        this.model = model;
        this.quota = quota;
        this.rules = rules;
        this.products = products;
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
        InquiryWorkItem workItem = workItems.findById(workItemId)
                .filter(w -> w.getOrgId().equals(orgId))
                .orElseThrow(() -> ApiException.notFound("문의 작업을 찾을 수 없습니다."));
        Inquiry inquiry = inquiries.findById(workItem.getInquiryId())
                .filter(i -> i.getOrgId().equals(orgId))
                .orElseThrow(() -> ApiException.notFound("문의를 찾을 수 없습니다."));

        // The question, as a person wrote it — the stored body may be a mail thread wrapped in markup.
        String title = MarkupText.toPlainText(inquiry.getTitle());
        String details = MarkupText.toPlainText(inquiry.getBody());

        Retrieved retrieved = retrieve(orgId, inquiry, title, details);

        String quotaMessage = null;
        Optional<AgentDraftResponseParser.ParsedDraft> written = Optional.empty();
        String modelVersion = model.versionFor(orgId);
        if (model.isEnabledFor(orgId)) {
            QuotaDecision decision = quota.consume(orgId, AgentUsageKind.DRAFT, null);
            if (decision.allowed()) {
                written = model.draft(orgId, title, details, passagesFor(retrieved.passages()));
            } else {
                quotaMessage = decision.messageKo();
            }
        }

        DraftAuthorKind authorKind = written.isPresent() ? DraftAuthorKind.MODEL : DraftAuthorKind.RULE;
        // A rule draft is not grounded in anything, whatever the retrieval found — saying otherwise
        // would attach citations to a sentence that was never shown them.
        DraftKnowledgeState state = authorKind == DraftAuthorKind.MODEL
                ? retrieved.state() : degrade(retrieved.state());
        List<KnowledgePassage> cited = authorKind == DraftAuthorKind.MODEL
                ? retrieved.passages() : List.of();

        String replyTitle = written.map(AgentDraftResponseParser.ParsedDraft::title)
                .filter(t -> t != null && !t.isBlank())
                .orElseGet(() -> defaultTitle(title));
        String replyBody = written.map(AgentDraftResponseParser.ParsedDraft::comments)
                .filter(c -> c != null && !c.isBlank())
                .orElseGet(() -> ruleBody(orgId, inquiry.getId(), title, details));

        int base = drafts.currentVersion(workItemId);
        ReplyDraftView saved = drafts.save(orgId, workItemId, sellerUserId, replyTitle, replyBody, base,
                new InquiryReplyDraftService.Provenance(authorKind,
                        authorKind == DraftAuthorKind.MODEL ? modelVersion : null,
                        state, retrieved.productId()));

        List<DraftEvidenceView> views = recordEvidence(orgId, workItemId, saved.version(), cited);
        return new GeneratedDraftView(saved, authorKind.name(), state.name(), state.messageKo(),
                retrieved.productId(), views, quotaMessage);
    }

    /** The evidence for one draft version, for a reader that did not just generate it. */
    public List<DraftEvidenceView> evidenceFor(UUID orgId, UUID workItemId, int version) {
        workItems.findById(workItemId)
                .filter(w -> w.getOrgId().equals(orgId))
                .orElseThrow(() -> ApiException.notFound("문의 작업을 찾을 수 없습니다."));
        return evidence.findAllByWorkItemIdAndDraftVersionOrderByOrdinalAsc(workItemId, version).stream()
                .map(row -> new DraftEvidenceView(row.getKind(), row.getTitle(), row.getLocator(),
                        row.getSourceId(), row.getChunkId()))
                .toList();
    }

    /**
     * What the library could offer, and which of the four absences it is.
     *
     * <p><b>A resolved product id is not the same as a resolved product.</b> Ingest mints a shared
     * {@code (미지정 상품)} row for every nameless source row, so most of the Cafe24 backlog carries a
     * non-null {@code productId} that points at a bucket of unrelated inquiries. Searching its library
     * would report NO_LIBRARY — "이 상품에 등록된 상품 지식이 없다" — about a product that does not
     * exist, and inviting the seller to write knowledge for it would be inviting them to write it into
     * a bucket. {@link OperatorProductName#displayNameOrNull} already knows the three shapes of "no name is
     * actually known"; this reuses that judgement rather than re-deriving it.
     */
    private Retrieved retrieve(UUID orgId, Inquiry inquiry, String title, String details) {
        UUID productId = inquiry.getProductId();
        if (productId == null || !namedProduct(orgId, productId)) {
            return new Retrieved(null, DraftKnowledgeState.NO_PRODUCT, List.of());
        }
        String query = query(title, details);
        KnowledgeSearchResponse found = library.search(orgId, productId, query, MAX_PASSAGES);
        if (found.documentsSearched() == 0) {
            return new Retrieved(productId, DraftKnowledgeState.NO_LIBRARY, List.of());
        }
        if (found.passages().isEmpty()) {
            return new Retrieved(productId, DraftKnowledgeState.NO_MATCH, List.of());
        }
        return new Retrieved(productId, DraftKnowledgeState.GROUNDED, found.passages());
    }

    /** Whether this product id points at a real, named product rather than ingest's shared bucket. */
    private boolean namedProduct(UUID orgId, UUID productId) {
        return products.findById(productId)
                .filter(p -> p.getOrgId().equals(orgId))
                .map(p -> OperatorProductName.displayNameOrNull(p) != null)
                .orElse(false);
    }

    /**
     * The state to report when the model never ran. GROUNDED becomes NO_MATCH: passages existed, but
     * nothing that wrote this draft ever saw them, and the seller must not read a citation into it.
     */
    private static DraftKnowledgeState degrade(DraftKnowledgeState state) {
        return state == DraftKnowledgeState.GROUNDED ? DraftKnowledgeState.NO_MATCH : state;
    }

    static String query(String title, String details) {
        String joined = ((title == null ? "" : title) + " " + (details == null ? "" : details)).strip();
        return joined.length() > QUERY_CHARS ? joined.substring(0, QUERY_CHARS) : joined;
    }

    private static List<AgentDraftGenerator.Passage> passagesFor(List<KnowledgePassage> passages) {
        return passages.stream()
                .limit(MAX_PASSAGES)
                .map(p -> new AgentDraftGenerator.Passage(p.title(), p.content()))
                .toList();
    }

    private List<DraftEvidenceView> recordEvidence(UUID orgId, UUID workItemId, int version,
                                                   List<KnowledgePassage> passages) {
        List<DraftEvidenceView> views = new ArrayList<>(passages.size());
        int ordinal = 0;
        for (KnowledgePassage passage : passages) {
            InquiryDraftEvidence row = new InquiryDraftEvidence();
            row.setOrgId(orgId);
            row.setWorkItemId(workItemId);
            row.setDraftVersion(version);
            row.setOrdinal(ordinal++);
            row.setKind(InquiryDraftEvidence.KIND_PRODUCT_KNOWLEDGE);
            row.setSourceId(passage.sourceId());
            row.setChunkId(passage.chunkId());
            row.setTitle(passage.title());
            row.setLocator(locator(passage));
            evidence.save(row);
            views.add(new DraftEvidenceView(row.getKind(), row.getTitle(), row.getLocator(),
                    row.getSourceId(), row.getChunkId()));
        }
        return views;
    }

    /** {@code product-knowledge/USAGE:데모 운영자} — the same shape the agent runtime cites. */
    private static String locator(KnowledgePassage passage) {
        String author = passage.authorName() == null || passage.authorName().isBlank()
                ? "판매자" : passage.authorName();
        return "product-knowledge/" + passage.sourceType().name() + ":" + author;
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

    /** What the retrieval produced: the product it was scoped to, the verdict, and the passages. */
    private record Retrieved(UUID productId, DraftKnowledgeState state, List<KnowledgePassage> passages) {
    }
}
