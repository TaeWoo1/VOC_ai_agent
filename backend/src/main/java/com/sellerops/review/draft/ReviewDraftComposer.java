package com.sellerops.review.draft;

import com.sellerops.agent.llm.AgentDraftGenerator;
import com.sellerops.agent.llm.AgentDraftService;
import com.sellerops.agent.quota.AgentQuotaService;
import com.sellerops.agent.quota.AgentUsageKind;
import com.sellerops.agent.quota.QuotaDecision;
import com.sellerops.attention.reply.ReviewReplyDraftService;
import com.sellerops.attention.reply.ReviewReplyTemplateKey;
import com.sellerops.attention.reply.ReviewReplyTemplateService;
import com.sellerops.attention.reply.RuleBasedReviewReplyProvider;
import com.sellerops.attention.reply.ReviewReplyProposalProvider.ReviewReplyContext;
import com.sellerops.attention.reply.dto.ReviewReplyDraftView;
import com.sellerops.inquiry.draft.DraftAuthorKind;
import com.sellerops.inquiry.draft.DraftEvidenceSnippets;
import com.sellerops.inquiry.draft.DraftKnowledgeState;
import com.sellerops.inquiry.draft.InquiryDraftEvidence;
import com.sellerops.inquiry.draft.InquiryEvidenceRetriever;
import com.sellerops.inquiry.draft.InquiryEvidenceRetriever.ScopedPassage;
import com.sellerops.inquiry.draft.dto.DraftEvidenceView;
import com.sellerops.knowledge.KnowledgeScope;
import com.sellerops.knowledge.RetrievalQuery;
import com.sellerops.product.library.KnowledgeVariantScope;
import com.sellerops.review.Review;
import com.sellerops.review.draft.dto.GeneratedReviewDraftView;
import com.sellerops.review.draft.dto.ReviewKnowledgeGapView;
import com.sellerops.reviewissue.ReviewIssue;
import com.sellerops.reviewissue.ReviewIssueEvidence;
import com.sellerops.reviewissue.ReviewIssueEvidenceRepository;
import com.sellerops.reviewissue.ReviewIssueRepository;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.stereotype.Service;

/**
 * <b>Grounded Review Drafting v1 — write a public reply from what this seller can actually prove.</b>
 * (2026-09-03)
 *
 * <p>Before this, a review reply draft was a template chosen by a star rating and five keywords. It
 * could not be wrong about a fact, because it stated none; it also could not be useful, because a
 * seller who has written down how their product is installed had no way for that sentence to reach
 * the reply. This composer puts the same three corpora behind a review that already stand behind an
 * inquiry — the product's notes, the company's operating rules, and what this seller has answered
 * before — through the SAME retriever, scorer, absence gate and passage budget
 * ({@link InquiryEvidenceRetriever#retrieveFor}). No second retrieval subsystem exists.
 *
 * <p><b>The template is the floor; the evidence is the lift.</b> With no current evidence, the reply
 * IS the org's own template — no model is called at all, which is the strongest possible guarantee
 * that nothing was invented: the machine that could invent was not started. With evidence, a model
 * writes inside it, and the org's template still supplies the voice through the style layer.
 *
 * <p><b>Three checks stand between the model and a saved public reply.</b> The prompt forbids the
 * seven promise classes; {@link AnswerStyleInstruction#forbiddenPresentIn} refuses a draft carrying a
 * phrase this company banned; {@link ReviewClaimGuard} refuses a draft that offers a remedy the
 * evidence never mentions. All three REFUSE rather than edit, and every refusal falls back to the
 * template floor — which promises nothing by construction.
 *
 * <p><b>It writes a draft and nothing else.</b> No approval, no submission ref, no execution. The
 * result is one more append-only version on the review, indistinguishable in the approval contract
 * from one the seller typed — except for the provenance stamped on it and the citations recorded
 * beside it.
 */
@Service
public class ReviewDraftComposer {

    /** The operational sentences. None of them says anything about the seller's knowledge. */
    static final String CAPABILITY_OFF = "AI 답변 초안 기능이 켜져 있지 않습니다. 저장된 문구로 초안을 준비했습니다.";
    static final String MODEL_FAILED = "AI 초안을 생성하지 못했습니다. 저장된 문구로 초안을 준비했습니다.";
    /**
     * The refusal that only this lane has.
     *
     * <p>It names the class of promise rather than the word, because the word is the seller's
     * business: 「환불」 in a reply is fine when the company's return policy is one of the grounds and
     * wrong when it is not, and the sentence a seller needs is which of those happened.
     */
    static final String UNSUPPORTED_CLAIM =
            "근거에 없는 교환·환불·보상 약속이 들어가 AI 초안을 저장하지 않았습니다. "
                    + "저장된 문구로 초안을 준비했습니다.";

    /** The sentences the seller reads above the draft, per basis. */
    static final String BASIS_GROUNDED_NOTE = "판매자가 등록한 근거를 사용해 썼습니다.";
    static final String BASIS_NONE_NOTE =
            "이 후기에 해당하는 근거를 찾지 못해, 저장된 문구로 안전한 기본 답글만 준비했습니다.";

    private final InquiryEvidenceRetriever retriever;
    private final ReviewReplyDraftService drafts;
    private final ReviewDraftEvidenceRepository evidence;
    private final ReviewReplyTemplateService templates;
    private final AgentDraftService model;
    private final AgentQuotaService quota;
    private final DraftEvidenceSnippets snippets;
    private final ReviewIssueEvidenceRepository issueEvidence;
    private final ReviewIssueRepository issues;

    public ReviewDraftComposer(InquiryEvidenceRetriever retriever, ReviewReplyDraftService drafts,
                               ReviewDraftEvidenceRepository evidence,
                               ReviewReplyTemplateService templates, AgentDraftService model,
                               AgentQuotaService quota, DraftEvidenceSnippets snippets,
                               ReviewIssueEvidenceRepository issueEvidence,
                               ReviewIssueRepository issues) {
        this.retriever = retriever;
        this.drafts = drafts;
        this.evidence = evidence;
        this.templates = templates;
        this.model = model;
        this.quota = quota;
        this.snippets = snippets;
        this.issueEvidence = issueEvidence;
        this.issues = issues;
    }

    /**
     * Compose and save one draft version for an already-authorized, already-gated review.
     *
     * <p>The caller owns authorization, the {@code RESPONSE_NEEDED} gate and the approval freeze —
     * the same three checks a hand-typed save goes through, because this produces the same kind of
     * row. A review with a standing approval therefore cannot be regenerated, which is the correct
     * answer: the seller approved an exact sentence, and replacing it silently would unbind it.
     *
     * @param redactedBody the review body AFTER the preview sanitizer — never the raw column
     */
    public GeneratedReviewDraftView compose(UUID orgId, Review review, String redactedBody,
                                            String actor) {
        UUID productId = retriever.namedProduct(orgId, review.getProductId());
        // The review's own words are the question. There is no title and no structured topic: a
        // review states, it does not ask, so the only form of "what is this about" that exists is
        // what the customer wrote. The candidate ladder (TITLE/SUBJECT/FULL) narrows it the same way
        // it narrows a forwarded mail thread.
        RetrievalQuery question = RetrievalQuery.of(null, null, redactedBody);
        InquiryEvidenceRetriever.InquiryEvidence retrieved =
                retriever.retrieveFor(orgId, productId, question, KnowledgeVariantScope.unresolved());

        ReviewReplyTemplateKey key = RuleBasedReviewReplyProvider.keyFor(
                new ReviewReplyContext(orgId, review.getId(), redactedBody, review.getRating()));
        ReviewReplyTemplateService.Resolved template = templates.resolve(orgId, key);

        boolean grounded = retrieved.state() == DraftKnowledgeState.GROUNDED;
        String basis = grounded ? "GROUNDED" : "NO_ANSWER_BASIS";

        String body = template.body();
        String authorKind = DraftAuthorKind.RULE.name();
        String provenanceVersion = template.customized() ? "templates-v1+org" : "templates-v1";
        String unavailable = null;
        List<ScopedPassage> cited = List.of();

        if (grounded) {
            Written written = writeGrounded(orgId, redactedBody, retrieved.passages(), template.body());
            unavailable = written.unavailable();
            if (written.body() != null) {
                body = written.body();
                authorKind = DraftAuthorKind.MODEL.name();
                provenanceVersion = model.versionFor(orgId);
                cited = retrieved.passages();
            }
        }

        int base = drafts.currentVersion(review.getId());
        ReviewReplyDraftView saved = drafts.saveAs(orgId, review.getId(), actor, body, base,
                new ReviewReplyDraftService.Provenance(authorKind, provenanceVersion,
                        retrieved.state().name(), basis, productId));

        List<DraftEvidenceView> views = recordEvidence(orgId, review.getId(), saved.version(), cited);
        return new GeneratedReviewDraftView(saved, authorKind, basis,
                grounded && !views.isEmpty() ? BASIS_GROUNDED_NOTE : BASIS_NONE_NOTE, views,
                gapsFor(orgId, review, redactedBody, productId, retrieved, key),
                key.category(), template.customized() ? "ORG" : "DEFAULT", unavailable);
    }

    /** The model's answer, or the reason there is none. A null body means "use the template floor". */
    private record Written(String body, String unavailable) {
    }

    /**
     * Ask the model, then check what it wrote — twice, deterministically, before it can be saved.
     *
     * <p>Every refusal returns a null body, so the caller writes the template. There is no repair
     * pass and no second call: a draft that promised something the seller never agreed to is not
     * improved by asking again with the same evidence.
     */
    private Written writeGrounded(UUID orgId, String reviewBody, List<ScopedPassage> passages,
                                  String voice) {
        if (!model.isEnabledFor(orgId)) {
            return new Written(null, CAPABILITY_OFF);
        }
        QuotaDecision decision = quota.consume(orgId, AgentUsageKind.DRAFT, null);
        if (!decision.allowed()) {
            return new Written(null, decision.messageKo());
        }
        Optional<String> written = model.draftReviewReply(orgId, reviewBody, passagesFor(passages), voice);
        if (written.isEmpty()) {
            return new Written(null, MODEL_FAILED);
        }
        String candidate = written.get();
        List<String> unsupported = ReviewClaimGuard.unsupportedClaims(candidate,
                passages.stream().map(ScopedPassage::text).toList());
        if (!unsupported.isEmpty()) {
            return new Written(null, UNSUPPORTED_CLAIM);
        }
        return new Written(candidate, null);
    }

    /** The passages as the model sees them: scope label, heading, text. No ids, no scores. */
    private static List<AgentDraftGenerator.Passage> passagesFor(List<ScopedPassage> passages) {
        return passages.stream()
                .map(p -> new AgentDraftGenerator.Passage(p.scope().labelKo(), p.heading(), p.text()))
                .toList();
    }

    /** Store what this version was written from, and return it as the citation list. */
    private List<DraftEvidenceView> recordEvidence(UUID orgId, UUID reviewId, int version,
                                                   List<ScopedPassage> passages) {
        List<DraftEvidenceView> views = new ArrayList<>();
        int ordinal = 0;
        for (ScopedPassage passage : passages) {
            ReviewDraftEvidence row = new ReviewDraftEvidence();
            row.setOrgId(orgId);
            row.setReviewId(reviewId);
            row.setDraftVersion(version);
            row.setOrdinal(ordinal++);
            row.setKind(InquiryDraftEvidence.kindOf(passage.scope()));
            row.setSourceId(passage.sourceId());
            row.setChunkId(passage.chunkId());
            row.setTitle(passage.heading());
            row.setLocator(passage.locator());
            evidence.save(row);
            views.add(new DraftEvidenceView(InquiryDraftEvidence.kindOf(passage.scope()),
                    passage.scope().labelKo(), passage.heading(), passage.locator(),
                    passage.sourceId(), passage.chunkId(),
                    DraftEvidenceView.snippetOf(passage.text())));
        }
        return List.copyOf(views);
    }

    /**
     * The citations of a stored version, with their excerpts read back from the source documents.
     *
     * <p>Read back rather than stored, for the reason the inquiry lane reads them back: the seller's
     * knowledge screen owns the one copy of every sentence, so a citation cannot drift from the
     * document it points at, and a document the seller has since deleted leaves a citation with no
     * excerpt instead of a quote of something that no longer exists.
     */
    public List<DraftEvidenceView> evidenceFor(UUID orgId, UUID reviewId, int version) {
        return evidence.findByOrgIdAndReviewIdAndDraftVersionOrderByOrdinalAsc(orgId, reviewId, version)
                .stream()
                .map(row -> snippets.viewOf(row.getKind(), row.getSourceId(), row.getChunkId(),
                        row.getTitle(), row.getLocator()))
                .toList();
    }

    /* ─────────────────────────── what is missing, asked as a question ─────────────────────────── */

    /** How much of the customer's own sentence is quoted back when nothing else names the subject. */
    static final int EXCERPT_CHARS = 40;

    /**
     * The gaps, as closed structures. Deterministic; no model is asked what is missing.
     *
     * <p>At most two, because there are two corpora a seller can register into: this product's
     * knowledge and the company's operating rules. The ORG gap is raised only for the one review
     * topic that is unambiguously a company matter — 배송 — because asking a seller to write a
     * shipping policy because a customer complained about packaging would be noise.
     */
    private List<ReviewKnowledgeGapView> gapsFor(UUID orgId, Review review, String redactedBody,
                                                 UUID productId,
                                                 InquiryEvidenceRetriever.InquiryEvidence retrieved,
                                                 ReviewReplyTemplateKey key) {
        boolean hasProductPassage =
                retrieved.passages().stream().anyMatch(p -> p.scope() == KnowledgeScope.PRODUCT);
        boolean hasPolicyPassage =
                retrieved.passages().stream().anyMatch(p -> p.scope() == KnowledgeScope.ORG_OPERATIONS);
        List<ReviewKnowledgeGapView> gaps = new ArrayList<>();
        Subject subject = subjectFor(orgId, review, redactedBody);
        if (productId != null && !hasProductPassage) {
            gaps.add(new ReviewKnowledgeGapView("PRODUCT", subject.text(), subject.kind(),
                    "'" + subject.text() + "'에 대해 고객에게 안내하는 공식 기준이 있나요? "
                            + "이 상품에 저장된 지식에서 찾지 못했습니다.",
                    productId.toString()));
        }
        // The ONE topic use of the template key, and it is a legitimate one: 「배송」 is a company
        // matter whether the customer praised the delivery or complained about it, so a keyword that
        // detects the topic without the polarity is exactly the right signal for «do you have a
        // shipping standard written down?». It is unreachable at ★4+, where POSITIVE wins.
        if (key == ReviewReplyTemplateKey.DELIVERY && !hasPolicyPassage) {
            gaps.add(new ReviewKnowledgeGapView("ORG", "배송", "TOPIC",
                    "배송에 대해 고객에게 안내하는 회사 기준이 있나요? 저장된 운영 정책에서 찾지 못했습니다.",
                    null));
        }
        return List.copyOf(gaps);
    }

    /** What the ask is about, and which of the three shipped signals named it. */
    private record Subject(String text, String kind) {
    }

    /**
     * <b>Two tiers, and the template key is not one of them.</b>
     *
     * <p>The tempting third tier is the matched {@link ReviewReplyTemplateKey}'s name — but those
     * names describe a KIND OF REVIEW (「불량 · 파손 리뷰」), not a subject a seller could write a
     * standard about, and turning one into a second Korean noun would be inventing a vocabulary the
     * seller has never seen. So: the repeated issue this review is recorded evidence for, or the
     * customer's own words. Both are things the seller has already read on their own screens.
     */
    private Subject subjectFor(UUID orgId, Review review, String redactedBody) {
        String issue = issueTitleFor(orgId, review.getId());
        return issue != null ? new Subject(issue, "ISSUE")
                : new Subject(excerpt(redactedBody), "REVIEW_TEXT");
    }

    /** The title of a repeated issue this exact review is recorded evidence for, or null. */
    private String issueTitleFor(UUID orgId, UUID reviewId) {
        try {
            List<ReviewIssueEvidence> rows = issueEvidence.findByOrgIdAndReviewId(orgId, reviewId);
            for (ReviewIssueEvidence row : rows) {
                Optional<ReviewIssue> issue = issues.findById(row.getIssueId());
                if (issue.isPresent() && !issue.get().isDismissed()) {
                    return issue.get().getTitle();
                }
            }
        } catch (RuntimeException e) {
            return null;
        }
        return null;
    }

    /** The customer's own opening words, bounded. Quoted, never interpreted. */
    static String excerpt(String body) {
        if (body == null) {
            return "";
        }
        String flat = body.replaceAll("\\s+", " ").strip();
        return flat.length() <= EXCERPT_CHARS ? flat : flat.substring(0, EXCERPT_CHARS) + "…";
    }
}
