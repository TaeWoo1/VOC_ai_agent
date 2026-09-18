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
import com.sellerops.knowledge.KnowledgeTopic;
import com.sellerops.inquiry.InquiryRepository;
import com.sellerops.inquiry.draft.dto.DraftEvidenceView;
import com.sellerops.inquiry.draft.dto.GeneratedDraftView;
import com.sellerops.inquiry.draft.dto.KnowledgeGapView;
import com.sellerops.knowledge.RetrievalOutcome;
import com.sellerops.knowledge.candidate.KnowledgeCandidate;
import com.sellerops.knowledge.candidate.KnowledgeCandidateService;
import com.sellerops.inquiry.reply.InquiryReplyDraftService;
import com.sellerops.inquiry.reply.dto.ReplyDraftView;
import com.sellerops.inquiry.workitem.InquiryWorkItem;
import com.sellerops.inquiry.workitem.InquiryWorkItemRepository;
import com.sellerops.knowledge.KnowledgeScope;
import com.sellerops.knowledge.style.AnswerStyleInstruction;
import com.sellerops.knowledge.style.AnswerStyleProfile;
import com.sellerops.knowledge.style.AnswerStyleService;
import com.sellerops.order.fact.OrderFact;
import com.sellerops.organization.profile.SellerProfileService;
import com.sellerops.product.ProductVariantRepository;
import com.sellerops.product.catalogue.CatalogueInvestigator;
import com.sellerops.product.detail.ProductDetailEnrichmentTrigger;
import com.sellerops.product.detail.image.ProductDetailImageKnowledge;
import com.sellerops.product.library.KnowledgeVariantScope;
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
    private final AnswerStyleService styles;
    private final SellerProfileService profiles;

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
    /**
     * The fifth, and the only one caused by the company's own setting.
     *
     * <p>A generated reply that carries a phrase this company has banned is REFUSED, not edited.
     * Deleting the words out of the sentence would leave a reply whose meaning nobody chose, and
     * saving it anyway would make 「사용하지 않을 표현」 a preference rather than a rule.
     */
    static final String STYLE_FORBIDDEN_PHRASE = "사용하지 않기로 한 표현이 들어가 초안을 저장하지 "
            + "않았습니다. 다시 생성해 보시거나, 설정에서 그 표현을 확인해 주세요.";

    /**
     * 확인 필요 — where an ask that a draft could not answer is filed. Optional: a knowledge inbox
     * must never be able to fail a draft, and a context without one drafts exactly as before.
     */
    private final KnowledgeCandidateService candidates;
    private InquiryKnowledgeAssessor assessor;

    public InquiryDraftComposer(InquiryWorkItemRepository workItems, InquiryRepository inquiries,
                                InquiryReplyDraftService drafts, InquiryDraftEvidenceRepository evidence,
                                InquiryEvidenceRetriever retriever, AgentDraftService model,
                                AgentQuotaService quota, ProductVariantRepository variants,
                                DraftEvidenceSnippets snippets,
                                ProductDetailEnrichmentTrigger detail,
                                ProductDetailImageKnowledge images, AnswerStyleService styles,
                                SellerProfileService profiles,
                                KnowledgeCandidateService candidates) {
        this.workItems = workItems;
        this.inquiries = inquiries;
        this.drafts = drafts;
        this.evidence = evidence;
        this.retriever = retriever;
        this.assessor = InquiryKnowledgeAssessor.withoutContext(retriever, variants);
        this.model = model;
        this.quota = quota;
        this.variants = variants;
        this.snippets = snippets;
        this.detail = detail;
        this.images = images;
        this.styles = styles;
        this.profiles = profiles;
        this.candidates = candidates;
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
    /**
     * The production wiring: the knowledge verdict comes from {@link InquiryKnowledgeAssessor}, the same assessment
     * the case investigator reads (Knowledge &amp; Intelligence Closure v1).
     */
    @org.springframework.beans.factory.annotation.Autowired
    public InquiryDraftComposer(InquiryWorkItemRepository workItems, InquiryRepository inquiries,
                                InquiryReplyDraftService drafts, InquiryDraftEvidenceRepository evidence,
                                InquiryEvidenceRetriever retriever, InquiryKnowledgeAssessor assessor,
                                AgentDraftService model, AgentQuotaService quota, ProductVariantRepository variants,
                                DraftEvidenceSnippets snippets, ProductDetailEnrichmentTrigger detail,
                                ProductDetailImageKnowledge images, AnswerStyleService styles,
                                SellerProfileService profiles, KnowledgeCandidateService candidates) {
        this(workItems, inquiries, drafts, evidence, retriever, model, quota, variants, snippets, detail, images,
                styles, profiles, candidates);
        this.assessor = assessor;
    }

    public GeneratedDraftView generate(UUID orgId, UUID workItemId, UUID sellerUserId) {
        return generate(orgId, workItemId, sellerUserId, null);
    }

    /**
     * As {@link #generate(UUID, UUID, UUID)}, with a one-turn wording hint from the conversation.
     *
     * <p>The hint overrides ONE field of the org's style profile for this draft (see
     * {@link ToneHint}); a null hint is exactly the three-argument call. Nothing about retrieval,
     * basis, quota or the facts section moves — a tone is a request about manner, and manner never
     * wins over grounding. In {@code NO_ANSWER_BASIS} the hint is ignored along with the model.
     */
    public GeneratedDraftView generate(UUID orgId, UUID workItemId, UUID sellerUserId, ToneHint tone) {
        return compose(orgId, workItemId, "SELLER:" + sellerUserId, tone);
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
        return compose(orgId, workItemId, actor, null);
    }

    /**
     * Compose, then file what could not be answered in 확인 필요.
     *
     * <p>(Knowledge Setup &amp; Inbox UX v1 §3) The review lane has filed its gaps since Grounded
     * Review Drafting v1; the inquiry lane produced the same verdict, returned it to whoever was
     * looking at that one inquiry, and dropped it. So the inbox that is supposed to collect
     * 「reviewnary가 모르는 것」 held half of them, and the half it held was the half a seller was
     * least likely to be standing in front of.
     *
     * <p>Nothing about the draft moves. The filing runs after the version is written, is idempotent
     * by the question, and cannot throw into the caller: a knowledge inbox must never be able to
     * fail a draft.
     */
    private GeneratedDraftView compose(UUID orgId, UUID workItemId, String actor, ToneHint tone) {
        GeneratedDraftView view = composeDraft(orgId, workItemId, actor, tone);
        KnowledgeGapView gap = markGap(orgId, view.knowledgeGap());
        // The id travels back with the gap so that answering THIS ask on THIS screen closes THIS row
        // (Knowledge Gap Continuity v1). When the seller already answered this exact ask and the draft
        // still cannot use it, the gap says THAT instead — a different sentence, not a repeated demand.
        return gap == view.knowledgeGap() ? view : new GeneratedDraftView(view.draft(), view.authorKind(),
                view.knowledgeState(), view.knowledgeNote(), view.answerBasis(), view.answerBasisNote(),
                view.answerBasisAction(), view.productId(), view.evidence(), view.companyContextUsed(),
                view.unavailableMessage(), gap);
    }

    /**
     * File one ask, when BOTH lanes came back empty about a noun the customer actually wrote.
     *
     * <p>Both lanes, because a question the operating rules answered is not a gap in the product's
     * knowledge; and a noun the customer wrote, because {@code missingSubject} is quoted from the
     * question rather than classified, and an ask a seller cannot recognise is an ask they will not
     * answer. Everything else — a partial hit, an unresolved 규격, a vendor failure — is a different
     * fact and files nothing.
     *
     * @return the gap, carrying either the 확인 필요 row it was filed as or the fact that this seller
     *         already answered this exact ask — and unchanged when neither is true
     */
    private KnowledgeGapView markGap(UUID orgId, KnowledgeGapView gap) {
        if (candidates == null || gap == null) {
            return gap;
        }
        // A catalogue question asks the seller a catalogue fact — whether they sell it — once their on-sale catalogue
        // has been read and states nothing about it. The operating-rule lane has no say in that: a shipping policy
        // that did not mention a 9oz dispenser is not why the seller is being asked about one.
        boolean catalogue = gap.catalogueChecked() != null;
        String subject = catalogue ? gap.askedSubject() : gap.missingSubject();
        if (subject == null || subject.isBlank()) {
            return gap;
        }
        if (!catalogue && (!ABSENT.equals(gap.productOutcome()) || !ABSENT.equals(gap.policyOutcome()))) {
            return gap;
        }
        String scope = catalogue || gap.productId() == null ? "ORG" : "PRODUCT";
        String question = catalogue
                ? "「" + subject + "」" + objectParticle(subject) + " 판매하시는지 알려 주세요."
                : "「" + subject + "」에 대해 고객에게 안내할 공식 기준이 필요합니다.";
        try {
            UUID scopedProduct = "ORG".equals(scope) ? null : gap.productId();
            KnowledgeCandidate filed = candidates.noteGap(orgId, scope, scopedProduct, subject, question);
            if (filed != null) {
                return gap.filedAs(filed.getId());
            }
            // Nothing was filed. The ONE reason that is worth a different sentence is that this exact
            // ask was already answered — a fact `noteGap` decides on and used to swallow. Read here so
            // the screen can stop telling a seller to add what they added (Inquiry Operations
            // Workspace v1 §6); one extra query, only on the path that filed nothing.
            return candidates.alreadyAnswered(orgId, scope, scopedProduct, question)
                    ? gap.answeredBefore() : gap;
        } catch (RuntimeException e) {
            // Enum-free and content-free: the draft is what the seller asked for, and it is already saved.
            return gap;
        }
    }

    /** 을/를 for a Korean noun phrase; 를 for anything that does not end in a Hangul syllable. */
    static String objectParticle(String word) {
        char last = word.charAt(word.length() - 1);
        if (last < 0xAC00 || last > 0xD7A3) {
            return "를";
        }
        return (last - 0xAC00) % 28 == 0 ? "를" : "을";
    }

    /** The retrieval outcome that means "this lane has nothing about it" — {@code RetrievalOutcome.ABSENT}. */
    private static final String ABSENT = RetrievalOutcome.ABSENT.name();

    private GeneratedDraftView composeDraft(UUID orgId, UUID workItemId, String actor, ToneHint tone) {
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

        // Computed ONCE and used three times: it decides which 규격's knowledge may be retrieved at
        // all, the caution line the drafter reads, and — with the library's verdict — whether there
        // is a basis to draft. Two computations of the same classification would be two chances for
        // the screen and the prompt to disagree.
        //
        // It runs BEFORE the retrieval rather than after it, which is the 2026-08-27 change: a
        // document written about 2호 is not weak evidence about a customer who said 3호, and a filter
        // applied to the results would already have let it take one of the four slots.
        // Computed ONCE, by the assessment the case investigator also reads: the 규격 verdict (before retrieval), the
        // Knowledge Spine retrieval, and the basis. Two computations of the same classification would be two chances
        // for the screen, the prompt and the investigation to disagree.
        InquiryKnowledgeAssessor.Assessment assessment =
                assessor.assess(orgId, inquiry, com.sellerops.order.fact.OrderFactLookup.EXACT_ALLOWED);
        SpecApplicability.Verdict verdict = assessment.verdict();
        SpecApplicability.Applicability applicability = verdict.applicability();
        InquiryEvidenceRetriever.InquiryEvidence retrieved = assessment.retrieved();
        List<com.sellerops.knowledge.spine.KnowledgeEntry> context = assessment.spine().draftContext();
        AnswerBasisState basis = assessment.basis();
        AnswerStyleProfile style = tone == null ? styleFor(orgId) : tone.applyTo(styleFor(orgId));
        if (!basis.mayGenerate()) {
            // No model call and no saved version. Nothing here is a refusal to help — the seller
            // writes their own reply on the same screen — it is a refusal to manufacture one.
            //
            // Unless the 상세페이지 read is what failed. Then this verdict rests on a library we
            // could not finish filling, and 「답변 기준이 필요합니다」 would send the seller off to
            // write knowledge that may already be sitting on their own listing.
            String operational = detailFailure != null ? detailFailure
                    : inFlight(orgId, inquiry) ? DETAIL_READ_PENDING : null;
            // The seller's own approved sentence, verbatim, and only here.
            //
            // It is allowed ONLY when the retrieval actually settled with no usable evidence. If the
            // machinery did not finish (a 상세페이지 read that failed, pictures still being read) we
            // do not know there is no basis, and answering "확인 후 안내드리겠습니다" to a question we
            // may be seconds from being able to answer is the deferral this product deleted.
            if (operational == null && style.hasUnknownFallback()) {
                return approvedFallback(orgId, workItemId, actor, title, retrieved, basis, verdict, assessment.asked(),
                        assessment.named(), style, assessment.gap());
            }
            return noBasis(retrieved, basis, verdict, assessment.asked(), assessment.named(), operational,
                    assessment.gap());
        }

        // Each branch names its own reason, because the three are not interchangeable to the person
        // reading the screen: a budget comes back tomorrow, a switch is an operator's job, and a
        // vendor that did not answer is worth pressing the button again for.
        // The company's own description of itself (Seller Context v1-B), read ONCE, and only on the
        // path that reaches a model. It is deliberately read AFTER the basis verdict: the verdict
        // never sees it, so a summary alone can never turn NO_ANSWER_BASIS into a draft.
        String company = companyContextFor(orgId);
        String unavailable = null;
        Optional<AgentDraftResponseParser.ParsedDraft> written = Optional.empty();
        String modelVersion = model.versionFor(orgId);
        if (!model.isEnabledFor(orgId)) {
            unavailable = CAPABILITY_OFF;
        } else {
            QuotaDecision decision = quota.consume(orgId, AgentUsageKind.DRAFT, null);
            if (decision.allowed()) {
                written = model.draft(orgId, title, details,
                        passagesFor(assessment.catalogue(), retrieved.passages(), context),
                        retrieved.order().messageKo(),
                        applicability.messageKo(retrieved.figuresUnaided(),
                                retrieved.variantSpecific()),
                        AnswerStyleInstruction.of(style), company);
                if (written.isEmpty()) {
                    unavailable = MODEL_FAILED;
                } else if (!AnswerStyleInstruction
                        .forbiddenPresentIn(written.get().comments(), style).isEmpty()) {
                    // The prompt asked; this checks. A style line is a request to a model, and a
                    // rule the company set is not satisfied by having asked politely.
                    written = Optional.empty();
                    unavailable = STYLE_FORBIDDEN_PHRASE;
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
            return noBasis(retrieved, basis, verdict, assessment.asked(), assessment.named(), unavailable,
                    assessment.gap());
        }

        AgentDraftResponseParser.ParsedDraft parsed = written.get();
        String replyTitle = parsed.title() == null || parsed.title().isBlank()
                ? defaultTitle(title) : parsed.title();
        String replyBody = parsed.comments();

        int base = drafts.currentVersion(workItemId);
        ReplyDraftView saved = drafts.saveAs(orgId, workItemId, actor, replyTitle, replyBody, base,
                new InquiryReplyDraftService.Provenance(DraftAuthorKind.MODEL,
                        stamped(modelVersion, style), knowledgeStateOf(assessment), retrieved.productId(),
                        basis));

        List<DraftEvidenceView> views = recordEvidence(orgId, workItemId, saved.version(),
                catalogueMatches(assessment.catalogue()), retrieved.passages(), context, retrieved.order());
        return new GeneratedDraftView(saved, DraftAuthorKind.MODEL.name(), knowledgeStateOf(assessment).name(),
                assessment.groundedByCatalogue() ? CATALOGUE_GROUNDED
                        : retrieved.state().messageKo(retrieved.scopes()), basis.name(), basis.messageKo(),
                basis.actionKo(retrieved.state(), verdict.topicWord(), applicability,
                        retrieved.productOutcome(), retrieved.policyOutcome(), assessment.asked(),
                        retrieved.policyDeclares(assessment.asked()), verdict.optionsRegistered()),
                retrieved.productId(), views, company != null, null, assessment.gap());
    }

    /**
     * The seller's registered 회사 정보, or null. Never fails a draft, and never a basis.
     *
     * <p>Null when no profile exists, when the lookup threw, or when the service is absent — three
     * different facts that all mean the same thing to a drafter: nothing to say about the company.
     */
    private String companyContextFor(UUID orgId) {
        try {
            return profiles == null ? null : profiles.summaryFor(orgId).orElse(null);
        } catch (RuntimeException e) {
            return null;
        }
    }

    /**
     * The org's answer style, or the shipped default. Never fails a draft.
     *
     * <p>A settings lookup that threw would otherwise decide whether a seller gets a reply, and the
     * honest degradation is the wording this product had before the setting existed — not silence.
     */
    private AnswerStyleProfile styleFor(UUID orgId) {
        try {
            return styles == null ? AnswerStyleProfile.defaults() : styles.profileFor(orgId);
        } catch (RuntimeException e) {
            return AnswerStyleProfile.defaults();
        }
    }

    /**
     * {@code agent-draft/v1+…+style/v3} — which wording produced this version.
     *
     * <p>Appended to the model version rather than given a column of its own, because the question a
     * reader asks months later is one question: "what wrote this". A prompt snapshot would answer it
     * too, and would also store the customer's message a second time.
     */
    private static String stamped(String modelVersion, AnswerStyleProfile style) {
        String identity = style == null ? AnswerStyleProfile.defaults().identity() : style.identity();
        return modelVersion == null ? identity : modelVersion + "+" + identity;
    }

    /**
     * The seller's own approved sentence, saved as a draft version, with no model call.
     *
     * <p><b>Verbatim.</b> No greeting is prepended, no closing appended, no tone applied — the rest
     * of the style profile is about how a model should word an answer, and this is not an answer. It
     * is the company's own way of saying "we will check and come back", which is exactly why it is
     * allowed to appear where a generated deferral is not.
     *
     * <p>The basis verdict is unchanged: this is still {@code NO_ANSWER_BASIS}, the screen still says
     * what is missing, and the seller can still add the knowledge that would produce a real answer.
     * A draft that defers is not a draft that answers, and the two must not look the same.
     */
    private GeneratedDraftView approvedFallback(UUID orgId, UUID workItemId, String actor,
                                                String inquiryTitle,
                                                InquiryEvidenceRetriever.InquiryEvidence retrieved,
                                                AnswerBasisState basis,
                                                SpecApplicability.Verdict verdict,
                                                KnowledgeTopic asked,
                                                java.util.Set<KnowledgeTopic> named,
                                                AnswerStyleProfile style,
                                                com.sellerops.inquiry.draft.dto.KnowledgeGapView gap) {
        int base = drafts.currentVersion(workItemId);
        ReplyDraftView saved = drafts.saveAs(orgId, workItemId, actor, defaultTitle(inquiryTitle),
                style.unknownFallback(), base,
                new InquiryReplyDraftService.Provenance(DraftAuthorKind.SELLER_APPROVED_FALLBACK,
                        style.identity(), retrieved.state(), retrieved.productId(), basis));
        // No evidence rows: nothing was cited, because nothing applied. A citation of an absence is
        // the one kind of evidence this product does not record.
        return new GeneratedDraftView(saved, DraftAuthorKind.SELLER_APPROVED_FALLBACK.name(),
                retrieved.state().name(), retrieved.state().messageKo(retrieved.scopes()),
                basis.name(), basis.messageKo(),
                gap != null && gap.catalogueChecked() != null ? gap.catalogueChecked()
                        : basis.actionKo(retrieved.state(), verdict.topicWord(), verdict.applicability(),
                        retrieved.productOutcome(), retrieved.policyOutcome(), asked, retrieved.policyDeclares(asked),
                        verdict.optionsRegistered()),
                retrieved.productId(), List.of(), false, null, gap);
    }

    /**
     * The view for a draft that was not written, and why.
     *
     * <p>No version is saved, so a later approval cannot bind to something nobody composed, and the
     * work item's version counter does not advance on a non-event.
     */
    private static GeneratedDraftView noBasis(InquiryEvidenceRetriever.InquiryEvidence retrieved,
                                              AnswerBasisState basis,
                                              SpecApplicability.Verdict verdict,
                                              KnowledgeTopic asked,
                                              java.util.Set<KnowledgeTopic> named,
                                              String unavailableMessage,
                                              com.sellerops.inquiry.draft.dto.KnowledgeGapView gap) {
        String action = gap != null && gap.catalogueChecked() != null && basis == AnswerBasisState.NO_ANSWER_BASIS
                ? gap.catalogueChecked()
                : basis.actionKo(retrieved.state(), verdict.topicWord(), verdict.applicability(),
                        retrieved.productOutcome(), retrieved.policyOutcome(), asked, retrieved.policyDeclares(asked),
                        verdict.optionsRegistered());
        return new GeneratedDraftView(null, null, retrieved.state().name(),
                retrieved.state().messageKo(retrieved.scopes()), basis.name(), basis.messageKo(), action,
                retrieved.productId(), List.of(), false, unavailableMessage, gap);
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
            ProductDetailEnrichmentTrigger.Outcome outcome = detail.enrichIfNeeded(orgId, inquiry.getProductId()).outcome();
            // A refusal of this caller did not finish the read either — same sentence, never silence.
            return outcome == ProductDetailEnrichmentTrigger.Outcome.READ_FAILED
                    || outcome == ProductDetailEnrichmentTrigger.Outcome.CHANNEL_REFUSED ? DETAIL_READ_FAILED : null;
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

    /** Every option recorded for the bound product; empty when there are no variants. */
    private List<SpecApplicability.Option> optionsFor(UUID orgId, UUID productId) {
        return productId == null ? List.of()
                : variants.findByOrgIdAndProductId(orgId, productId).stream()
                        .filter(v -> v.getOptionName() != null && !v.getOptionName().isBlank())
                        .map(v -> new SpecApplicability.Option(v.getId(), v.getOptionName()))
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

    /** The catalogue statements that ground this draft; empty unless this was a catalogue question it answered. */
    static List<CatalogueInvestigator.Statement> catalogueMatches(CatalogueInvestigator.Finding finding) {
        return finding == null || !finding.grounds() ? List.of() : finding.matches().stream()
                .limit(CATALOGUE_PASSAGES).toList();
    }

    /** The knowledge note when the seller's catalogue, and nothing in this product's own library, answered. */
    static final String CATALOGUE_GROUNDED = "판매자가 지금 판매 중인 상품 정보를 근거로 썼습니다.";

    /** The draft's knowledge state: GROUNDED when the catalogue answered, the lanes' own state otherwise. */
    private static DraftKnowledgeState knowledgeStateOf(InquiryKnowledgeAssessor.Assessment assessment) {
        return assessment.groundedByCatalogue() ? DraftKnowledgeState.GROUNDED : assessment.retrieved().state();
    }

    /** Catalogue statements a draft is shown. Enough to name what is on sale; not a product list. */
    static final int CATALOGUE_PASSAGES = 3;

    /**
     * A statement from the seller's own catalogue, labelled for what it is: the product the inquiry is on
     * ({@code 상품 정보}), or another product the seller sells ({@code 판매 중인 다른 상품}) — the one label the prompt
     * forbids moving a figure out of.
     */
    static String catalogueLabel(CatalogueInvestigator.Statement s) {
        return s.current() ? KnowledgeScope.PRODUCT.labelKo() : InquiryDraftEvidence.LABEL_CATALOGUE_PRODUCT;
    }

    private static List<AgentDraftGenerator.Passage> passagesFor(
            CatalogueInvestigator.Finding catalogue,
            List<InquiryEvidenceRetriever.ScopedPassage> passages,
            List<com.sellerops.knowledge.spine.KnowledgeEntry> context) {
        // The catalogue first when it answered: for what is on sale now it is the current authority, ahead of any
        // past answer the lanes carried.
        List<AgentDraftGenerator.Passage> out = new ArrayList<>();
        for (CatalogueInvestigator.Statement s : catalogueMatches(catalogue)) {
            out.add(new AgentDraftGenerator.Passage(catalogueLabel(s), s.productName(), s.text()));
        }
        out.addAll(passages.stream()
                .map(p -> new AgentDraftGenerator.Passage(p.scope().labelKo(), p.heading(), p.text()))
                .toList());
        // Seller guidance and the channel's stated attributes, after the grounding passages. They inform the reply;
        // whether a reply may be written at all was already decided from the passages alone.
        for (com.sellerops.knowledge.spine.KnowledgeEntry entry : context) {
            out.add(new AgentDraftGenerator.Passage(contextLabel(entry), entry.title(), entry.text()));
        }
        return out;
    }

    static String contextLabel(com.sellerops.knowledge.spine.KnowledgeEntry entry) {
        return entry.sourceType() == com.sellerops.knowledge.spine.SpineSourceType.SELLER_GUIDANCE
                ? InquiryDraftEvidence.LABEL_SELLER_GUIDANCE : KnowledgeScope.PRODUCT.labelKo();
    }

    private List<DraftEvidenceView> recordEvidence(UUID orgId, UUID workItemId, int version,
                                                   List<CatalogueInvestigator.Statement> catalogue,
                                                   List<InquiryEvidenceRetriever.ScopedPassage> passages,
                                                   List<com.sellerops.knowledge.spine.KnowledgeEntry> context,
                                                   OrderFact order) {
        List<DraftEvidenceView> views = new ArrayList<>(passages.size() + 1);
        int ordinal = 0;
        // The exact product source for every catalogue statement the draft was shown: which product (source id), where
        // on it and when it was captured (locator). The excerpt is the statement itself.
        for (CatalogueInvestigator.Statement s : catalogue) {
            InquiryDraftEvidence row = new InquiryDraftEvidence();
            row.setOrgId(orgId);
            row.setWorkItemId(workItemId);
            row.setDraftVersion(version);
            row.setOrdinal(ordinal++);
            row.setKind(s.current() ? InquiryDraftEvidence.KIND_PRODUCT_FACT
                    : InquiryDraftEvidence.KIND_CATALOGUE_PRODUCT);
            row.setSourceId(s.productId());
            row.setTitle(s.productName());
            row.setLocator(s.locator());
            evidence.save(row);
            views.add(new DraftEvidenceView(row.getKind(), catalogueLabel(s), row.getTitle(), row.getLocator(),
                    row.getSourceId(), null, DraftEvidenceView.snippetOf(s.text())));
        }
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
        for (com.sellerops.knowledge.spine.KnowledgeEntry entry : context) {
            InquiryDraftEvidence row = new InquiryDraftEvidence();
            row.setOrgId(orgId);
            row.setWorkItemId(workItemId);
            row.setDraftVersion(version);
            row.setOrdinal(ordinal++);
            row.setKind(entry.sourceType() == com.sellerops.knowledge.spine.SpineSourceType.SELLER_GUIDANCE
                    ? InquiryDraftEvidence.KIND_SELLER_GUIDANCE : InquiryDraftEvidence.KIND_PRODUCT_FACT);
            row.setSourceId(entry.sourceRefs().isEmpty() ? null : entry.sourceRefs().get(0).id());
            row.setTitle(entry.title());
            row.setLocator(entry.entryId().substring(0, entry.entryId().indexOf(':')).toLowerCase(java.util.Locale.ROOT)
                    + "/" + (entry.channelCode() == null ? "판매자" : entry.channelCode()));
            evidence.save(row);
            views.add(new DraftEvidenceView(row.getKind(), contextLabel(entry), row.getTitle(), row.getLocator(),
                    row.getSourceId(), null, DraftEvidenceView.snippetOf(entry.text())));
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

    /**
     * The one operating topic the customer's own words name, or null — the noun the gap line is
     * allowed to use. Two topics (「반품 배송비」) name none: the line stays general rather than guess.
     */
    private static KnowledgeTopic askedTopic(Inquiry inquiry) {
        java.util.Set<KnowledgeTopic> topics = namedTopics(inquiry);
        return topics.size() == 1 ? topics.iterator().next() : null;
    }

    /** Every operating topic the customer's words name — the set {@link #askedTopic} is the single member of. */
    private static java.util.Set<KnowledgeTopic> namedTopics(Inquiry inquiry) {
        return KnowledgeTopic.of(
                (inquiry.getTitle() == null ? "" : inquiry.getTitle()) + " "
                        + (inquiry.getBody() == null ? "" : inquiry.getBody()));
    }
}
