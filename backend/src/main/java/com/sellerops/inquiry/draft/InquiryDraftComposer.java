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
import com.sellerops.inquiry.reply.InquiryReplyDraftService;
import com.sellerops.inquiry.reply.dto.ReplyDraftView;
import com.sellerops.inquiry.workitem.InquiryWorkItem;
import com.sellerops.inquiry.workitem.InquiryWorkItemRepository;
import com.sellerops.knowledge.KnowledgeScope;
import com.sellerops.order.fact.OrderFact;
import com.sellerops.product.ProductVariantRepository;
import com.sellerops.product.detail.ProductDetailEnrichmentTrigger;
import com.sellerops.product.detail.image.ProductDetailImageKnowledge;
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
 * <p><b>It writes a draft and nothing else.</b> No approval, no intent, no execution. The result is
 * one more append-only version on the work item — the same object a seller who typed it by hand would
 * have produced, distinguishable only by the provenance stamped on it.
 *
 * <p><b>One bounded marketplace READ can happen here, and it is new.</b> Before writing, this asks
 * {@link ProductDetailEnrichmentTrigger} whether the bound product's 상세페이지 has ever been read;
 * if not, one listing is read and indexed. That is the "actionable inquiry + exact attribution +
 * missing knowledge" trigger, and it is the only reason a draft touches a channel besides the order
 * fact. It cannot fail the draft: every outcome of that call is swallowed and reported.
 *
 * <p><b>"No basis" and "did not run" are different answers</b> (product-owner, 2026-08-27).
 * {@link AnswerBasisState} is a statement about EVIDENCE. A spent budget, a capability that is off,
 * a vendor that did not answer, and a 상세페이지 read that failed are statements about the MACHINERY,
 * and reporting them as {@code NO_ANSWER_BASIS} told a seller to go write knowledge they already
 * had. They travel in {@code unavailableMessage} instead — and when a detail read failed, the basis
 * verdict is still reported but must not be the sentence on screen: we did not finish looking, so
 * "there is nothing to find" is not ours to say.
 *
 * <p><b>When there is no basis, nothing is written</b> (product-owner, 2026-08-26).
 * {@link AnswerBasisState#NO_ANSWER_BASIS} means no current evidence applies, and in that state no
 * model is called and no version is saved. The deterministic drafter that used to fill the gap is
 * gone with it: its output was 「확인한 뒤 정확한 안내를 드리겠습니다」 — a promise SellerOps made on
 * the seller's behalf with nothing behind it, in exactly the state where nothing is behind it. A
 * seller-approved fallback belongs to Organization Answer Style, which does not exist yet, and until
 * it does the honest screen is one that says what is missing.
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
    private final ProductVariantRepository variants;
    private final DraftEvidenceSnippets snippets;
    private final ProductDetailEnrichmentTrigger detail;
    private final ProductDetailImageKnowledge images;

    /**
     * The three operational sentences, and one rule covering all of them: <b>none of them says
     * anything about the seller's knowledge.</b> Each names what did not run and what to do next,
     * and none of them is 「답변 기준이 필요합니다」 — that sentence belongs to
     * {@link AnswerBasisState#NO_ANSWER_BASIS} alone.
     */
    static final String CAPABILITY_OFF = "AI 답변 초안 기능이 켜져 있지 않습니다.";
    static final String MODEL_FAILED = "답변 초안을 생성하지 못했습니다. 잠시 후 다시 시도해 주세요.";
    static final String DETAIL_READ_FAILED = "상품 상세 정보를 확인하지 못했습니다.";
    /**
     * The third answer, and the first one with a producer.
     *
     * <p>Before the image lane existed there was no moment at which SellerOps was part-way through
     * learning something about a product — so this sentence would have been a state nobody sets, and
     * it was deliberately not written. A picture whose reading is in flight is that moment.
     */
    static final String DETAIL_READ_PENDING = "상품 상세 정보를 확인 중입니다.";

    public InquiryDraftComposer(InquiryWorkItemRepository workItems, InquiryRepository inquiries,
                                InquiryReplyDraftService drafts, InquiryDraftEvidenceRepository evidence,
                                InquiryEvidenceRetriever retriever, AgentDraftService model,
                                AgentQuotaService quota, ProductVariantRepository variants,
                                DraftEvidenceSnippets snippets,
                                ProductDetailEnrichmentTrigger detail,
                                ProductDetailImageKnowledge images) {
        this.workItems = workItems;
        this.inquiries = inquiries;
        this.drafts = drafts;
        this.evidence = evidence;
        this.retriever = retriever;
        this.model = model;
        this.quota = quota;
        this.variants = variants;
        this.snippets = snippets;
        this.detail = detail;
        this.images = images;
    }

    /**
     * Generate one draft version for a work item, grounded where grounding is possible.
     *
     * <p>Charged against the org's daily AI budget before the model is reached, on the same counter
     * every other draft spends — a regenerate is a call, not a free retry. An exhausted budget does
     * not fail the request and does not produce a substitute reply: nothing is written, and the
     * seller is told that the budget — not their knowledge library — is what stopped it
     * ({@code unavailableMessage}). The dashboard, the queue and the send path are unaffected.
     */
    public GeneratedDraftView generate(UUID orgId, UUID workItemId, UUID sellerUserId) {
        return compose(orgId, workItemId, "SELLER:" + sellerUserId);
    }

    /**
     * As {@link #generate}, with the author named rather than derived from a user id — the seam the
     * Proactive Operations Agent drafts through, before any human has opened the inquiry.
     *
     * <p><b>Nothing else differs.</b> Same retrieval, same three lanes, same quota counter, same
     * evidence rows, same knowledge state. The org's daily AI budget is charged here exactly as it is for a seller-initiated
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

        String detailFailure = enrichDetailIfNeeded(orgId, inquiry);
        InquiryEvidenceRetriever.InquiryEvidence retrieved = retriever.retrieve(orgId, inquiry);

        // Computed ONCE and used twice: it decides the caution line the drafter reads and, with the
        // library's verdict, whether there is a basis to draft at all. Two computations of the same
        // classification would be two chances for the screen and the prompt to disagree.
        SpecApplicability.Applicability applicability =
                SpecApplicability.of(title, details, optionNamesFor(orgId, retrieved.productId()));
        AnswerBasisState basis = AnswerBasisState.of(retrieved.state(), applicability);
        if (!basis.mayGenerate()) {
            // No model call and no saved version. Nothing here is a refusal to help — the seller
            // writes their own reply on the same screen — it is a refusal to manufacture one.
            //
            // Unless the 상세페이지 read is what failed. Then this verdict rests on a library we
            // could not finish filling, and 「답변 기준이 필요합니다」 would send the seller off to
            // write knowledge that may already be sitting on their own listing.
            return noBasis(retrieved, basis, detailFailure != null ? detailFailure
                    : inFlight(orgId, inquiry) ? DETAIL_READ_PENDING : null);
        }

        // Each branch names its own reason, because the three are not interchangeable to the person
        // reading the screen: a budget comes back tomorrow, a switch is an operator's job, and a
        // vendor that did not answer is worth pressing the button again for.
        String unavailable = null;
        Optional<AgentDraftResponseParser.ParsedDraft> written = Optional.empty();
        String modelVersion = model.versionFor(orgId);
        if (!model.isEnabledFor(orgId)) {
            unavailable = CAPABILITY_OFF;
        } else {
            QuotaDecision decision = quota.consume(orgId, AgentUsageKind.DRAFT, null);
            if (decision.allowed()) {
                written = model.draft(orgId, title, details, passagesFor(retrieved.passages()),
                        retrieved.order().messageKo(),
                        applicability.messageKo(retrieved.figuresUnaided()));
                if (written.isEmpty()) {
                    unavailable = MODEL_FAILED;
                }
            } else {
                unavailable = decision.messageKo();
            }
        }
        if (written.isEmpty()) {
            // Nothing wrote this reply, and a template saying 「확인 후 안내드리겠습니다」 in its place
            // is a promise with no author. The BASIS is reported as it was actually computed — this
            // question IS grounded, and overwriting that with NO_ANSWER_BASIS would be a second
            // false statement laid on top of the first — and the operational reason travels beside it.
            return noBasis(retrieved, basis, unavailable);
        }

        AgentDraftResponseParser.ParsedDraft parsed = written.get();
        String replyTitle = parsed.title() == null || parsed.title().isBlank()
                ? defaultTitle(title) : parsed.title();
        String replyBody = parsed.comments();

        int base = drafts.currentVersion(workItemId);
        ReplyDraftView saved = drafts.saveAs(orgId, workItemId, actor, replyTitle, replyBody, base,
                new InquiryReplyDraftService.Provenance(DraftAuthorKind.MODEL, modelVersion,
                        retrieved.state(), retrieved.productId()));

        List<DraftEvidenceView> views = recordEvidence(orgId, workItemId, saved.version(),
                retrieved.passages(), retrieved.order());
        return new GeneratedDraftView(saved, DraftAuthorKind.MODEL.name(), retrieved.state().name(),
                retrieved.state().messageKo(retrieved.scopes()), basis.name(), basis.messageKo(),
                basis.actionKo(retrieved.state()), retrieved.productId(), views, null);
    }

    /**
     * The view for a draft that was not written, and why.
     *
     * <p>No version is saved, so a later approval cannot bind to something nobody composed, and the
     * work item's version counter does not advance on a non-event.
     */
    private static GeneratedDraftView noBasis(InquiryEvidenceRetriever.InquiryEvidence retrieved,
                                              AnswerBasisState basis, String unavailableMessage) {
        return new GeneratedDraftView(null, null, retrieved.state().name(),
                retrieved.state().messageKo(retrieved.scopes()), basis.name(), basis.messageKo(),
                basis.actionKo(retrieved.state()), retrieved.productId(), List.of(),
                unavailableMessage);
    }

    /**
     * One bounded 상세페이지 read, when this inquiry names a product exactly and that product's
     * detail has never been read (or is 30 days old).
     *
     * <p><b>Every failure is swallowed here on purpose.</b> The seller asked for a draft, not for a
     * channel read, and a NAVER outage must not become an error on their screen. The trigger already
     * reports its own outcome; this catch exists for the repository lookups around it.
     */
    private String enrichDetailIfNeeded(UUID orgId, Inquiry inquiry) {
        if (inquiry.getProductId() == null || inquiry.productBinding() == null) {
            // No attribution, or an attribution nothing stated — there is no listing to read.
            return null;
        }
        try {
            return detail.enrichIfNeeded(orgId, inquiry.getProductId()).outcome()
                    == ProductDetailEnrichmentTrigger.Outcome.READ_FAILED ? DETAIL_READ_FAILED : null;
        } catch (RuntimeException ignored) {
            // Deliberately silent about the CAUSE — the trigger logs its own outcomes and a second
            // line here would say the same thing with less information — but not about the FACT: a
            // lookup that threw is a lookup that did not finish, exactly like a channel that refused.
            return DETAIL_READ_FAILED;
        }
    }

    /**
     * Whether this product's pictures are being read right now. Swallows everything: a draft must not
     * fail because a progress query did.
     */
    private boolean inFlight(UUID orgId, com.sellerops.inquiry.Inquiry inquiry) {
        try {
            return images != null && images.inFlight(orgId, inquiry.getProductId());
        } catch (RuntimeException e) {
            return false;
        }
    }

    /** Every {@code option_name} recorded for the bound product; empty when there are no variants. */
    private List<String> optionNamesFor(UUID orgId, UUID productId) {
        return productId == null ? List.of()
                : variants.findByOrgIdAndProductId(orgId, productId).stream()
                        .map(com.sellerops.product.ProductVariant::getOptionName)
                        .filter(name -> name != null && !name.isBlank())
                        .toList();
    }

    /** The evidence for one draft version, for a reader that did not just generate it. */
    public List<DraftEvidenceView> evidenceFor(UUID orgId, UUID workItemId, int version) {
        workItems.findById(workItemId)
                .filter(w -> w.getOrgId().equals(orgId))
                .orElseThrow(() -> ApiException.notFound("문의 작업을 찾을 수 없습니다."));
        return snippets.viewsOf(
                evidence.findAllByWorkItemIdAndDraftVersionOrderByOrdinalAsc(workItemId, version));
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
            // The excerpt comes from the passage the drafter was ACTUALLY shown, not from a
            // re-read: at generation the two are the same text, and this one cannot go stale.
            views.add(new DraftEvidenceView(row.getKind(), passage.scope().labelKo(), row.getTitle(),
                    row.getLocator(), row.getSourceId(), row.getChunkId(),
                    DraftEvidenceView.snippetOf(passage.text())));
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
            // No excerpt: an order fact points at a moment, not a document.
            views.add(new DraftEvidenceView(row.getKind(), KnowledgeScope.ORDER_STATE.labelKo(),
                    row.getTitle(), row.getLocator(), null, null, null));
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
}
