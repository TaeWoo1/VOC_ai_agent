package com.sellerops.operationscase.investigation;

import com.sellerops.channel.Channel;
import com.sellerops.channel.ChannelRepository;
import com.sellerops.common.MarkupText;
import com.sellerops.common.RedactedBody;
import com.sellerops.common.VocPreviewSanitizer;
import com.sellerops.inquiry.Inquiry;
import com.sellerops.inquiry.InquiryRepository;
import com.sellerops.inquiry.draft.InquiryOrderFactReader;
import com.sellerops.inquiry.publish.ReplyDecisionHistoryReader;
import com.sellerops.inquiry.draft.AnswerBasisState;
import com.sellerops.inquiry.draft.InquiryKnowledgeAssessor;
import com.sellerops.knowledge.RetrievalQuery;
import com.sellerops.knowledge.spine.KnowledgeConflict;
import com.sellerops.knowledge.spine.KnowledgeEntry;
import com.sellerops.knowledge.spine.KnowledgeSpineService;
import com.sellerops.knowledge.spine.SpineRetrieval;
import com.sellerops.knowledge.spine.SpineSourceType;
import com.sellerops.product.library.KnowledgeVariantScope;
import com.sellerops.operationscase.OperationsCase;
import com.sellerops.operationscase.OperationsCaseRepository;
import com.sellerops.operationscase.OperationsSubjectKind;
import com.sellerops.order.fact.OrderFact;
import com.sellerops.order.fact.OrderFactLookup;
import com.sellerops.product.OperatorProductName;
import com.sellerops.product.ProductRepository;
import com.sellerops.review.Review;
import com.sellerops.review.ReviewRepository;
import com.sellerops.reviewissue.ReviewIssue;
import com.sellerops.reviewissue.ReviewIssueEvidence;
import com.sellerops.reviewissue.ReviewIssueEvidenceRepository;
import com.sellerops.reviewissue.ReviewIssueRepository;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import java.util.function.Function;
import java.util.stream.Collectors;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Component;

/**
 * <b>The investigator's whole reach: org-scoped, read-only domain tools.</b>
 *
 * <p>The organisation is not a parameter of any tool. {@link #forOrg} binds it once — from the responsibility run,
 * which the runtime already resolved to one organisation — and every method below reads with that value and nothing
 * else. There is no bearer, no device token, no HTTP call to this backend's own API, and no browser: the tools are
 * repository and service reads inside this process, and {@code OperationsCaseSafetyFenceTest} asserts each of those
 * absences by name. A subject id that belongs to another organisation reads as nothing.
 *
 * <p><b>What a tool returns is already fit to leave.</b> Customer text passes {@link VocPreviewSanitizer#redactFullBody}
 * and a length cap; ids never appear in a result's text; knowledge is a short excerpt of what the seller wrote.
 *
 * <p>There is deliberately no low-level browser tool and no observation command. A source the investigator would
 * like to see again is the runtime's to schedule, and Package B schedules nothing new.
 */
@Component
public class CaseInvestigationTools {

    static final int MAX_BODY = 1200;
    static final int MAX_EXCERPT = 300;
    /** Past decisions are evidence, not a corpus: a few per kind, newest first. */
    static final int MAX_DECISIONS = 3;
    static final ZoneId KST = ZoneId.of("Asia/Seoul");

    private final InquiryRepository inquiries;
    private final ReviewRepository reviews;
    private final ChannelRepository channels;
    private final ProductRepository products;
    /** The one knowledge assessment the inquiry draft also reads — never a second search of our own. */
    private final InquiryKnowledgeAssessor assessor;
    private final KnowledgeSpineService spine;
    private final InquiryOrderFactReader orderFacts;
    private final ReviewIssueRepository issues;
    private final ReviewIssueEvidenceRepository issueEvidence;
    private final OperationsCaseRepository cases;
    /** The inquiry-side decisions, read through the package that owns them — this one may not name an approval. */
    private final ReplyDecisionHistoryReader replyDecisions;

    public CaseInvestigationTools(InquiryRepository inquiries, ReviewRepository reviews, ChannelRepository channels,
                                  ProductRepository products, InquiryKnowledgeAssessor assessor,
                                  KnowledgeSpineService spine, InquiryOrderFactReader orderFacts,
                                  ReviewIssueRepository issues, ReviewIssueEvidenceRepository issueEvidence,
                                  OperationsCaseRepository cases, ReplyDecisionHistoryReader replyDecisions) {
        this.replyDecisions = replyDecisions;
        this.inquiries = inquiries;
        this.reviews = reviews;
        this.channels = channels;
        this.products = products;
        this.assessor = assessor;
        this.spine = spine;
        this.orderFacts = orderFacts;
        this.issues = issues;
        this.issueEvidence = issueEvidence;
        this.cases = cases;
    }

    /** The review-photo lane. Optional: a context without it investigates reviews exactly as before. */
    private com.sellerops.review.media.ReviewMediaRepository reviewMedia;
    private com.sellerops.review.media.ReviewMediaInspector mediaInspector;

    @org.springframework.beans.factory.annotation.Autowired(required = false)
    void setReviewMedia(com.sellerops.review.media.ReviewMediaRepository reviewMedia,
                        com.sellerops.review.media.ReviewMediaInspector mediaInspector) {
        this.reviewMedia = reviewMedia;
        this.mediaInspector = mediaInspector;
    }

    /**
     * One review attachment as an investigation sees it. {@code inspected} is true only when a vision model looked at
     * the photo; otherwise {@code depicts} is null and the line sent to the model says the photo was not seen.
     *
     * @param notSeenReason why it was not looked at ({@code CAPABILITY_OFF}, {@code FETCH_FAILED}, …), or null
     */
    public record MediaFact(int ordinal, String kind, boolean inspected, String depicts, String problemVisible,
                            String problemDescription, String notSeenReason) {
    }

    /** What the review's photos are, as far as Reviewnary knows them. */
    public record ReviewMediaFacts(int attachCount, boolean attachCountObserved, List<MediaFact> media) {
    }

    /** The tools, bound to one organisation. The binding is final and no method can change it. */
    public OrgTools forOrg(UUID orgId) {
        if (orgId == null) {
            throw new IllegalArgumentException("조사 도구는 조직 없이 만들 수 없습니다.");
        }
        return new OrgTools(orgId);
    }

    /** What one tool call was: its name, a digest of its arguments, how many results it returned. */
    public record ToolCall(String name, String argsDigest, int results) {
    }

    public record SubjectFacts(OperationsSubjectKind kind, String channelName, LocalDate receivedOn, Integer rating,
                               String status, String threadRole, String title, String body, boolean redacted,
                               UUID productId, boolean orderReferenced, UUID inquiryId) {
    }

    /**
     * One piece of company knowledge as an investigation sees it. {@code entryId} stays server-side (it names a row);
     * the context sent to the model carries the authority, provenance, title, excerpt and date only.
     */
    public record KnowledgeUse(String entryId, SpineSourceType sourceType, String authority, int authorityRank,
                               String scope, String provenance, String title, String excerpt, LocalDate capturedOn) {
    }

    /**
     * What the company knows about this case, and whether it is enough — for an inquiry, exactly the assessment the
     * draft writer makes.
     *
     * @param basis           {@code GROUNDED}, {@code NEEDS_CLARIFICATION}, {@code NO_ANSWER_BASIS}, or
     *                        {@code CONTEXT_ONLY} for a review (a review asks nothing, so it has no answer basis)
     * @param missingSubject  the thing the seller has not told Reviewnary, in the customer's own noun, when the basis
     *                        is missing; null otherwise
     * @param suggestedScope  where the seller's answer would belong: {@code PRODUCT} or {@code ORG}
     */
    public record KnowledgeAssessment(String basis, String missingSubject, String suggestedScope, String topic,
                                      List<KnowledgeUse> evidence, List<KnowledgeUse> context,
                                      List<KnowledgeConflict> conflicts) {

        public static KnowledgeAssessment none() {
            return new KnowledgeAssessment("CONTEXT_ONLY", null, null, null, List.of(), List.of(), List.of());
        }

        public boolean missing() {
            return AnswerBasisState.NO_ANSWER_BASIS.name().equals(basis);
        }
    }

    public record ProductContext(String name) {
    }

    public record OrderContext(boolean available, String sentence) {
    }

    public record RelatedIssue(String title, long evidenceCount, boolean citesThisReview) {
    }

    public record SimilarCase(String kind, String disposition, String recommendedActionType, String resolution) {
    }

    /**
     * One decision this seller actually made, reduced to what may be shown to an investigation: which kind of
     * decision it was, the closed token they chose, and the day they chose it. No identifier, no approver, no text.
     */
    public record SellerDecision(String kind, String what, LocalDate on) {
    }

    public record PastDecisions(Map<String, Long> reviewDispositions, Map<String, Long> inquiryDraftAuthors,
                                List<SellerDecision> decisions) {

        boolean isEmpty() {
            return reviewDispositions.isEmpty() && inquiryDraftAuthors.isEmpty() && decisions.isEmpty();
        }
    }

    public final class OrgTools {

        private final UUID orgId;
        private final List<ToolCall> calls = new ArrayList<>();

        private OrgTools(UUID orgId) {
            this.orgId = orgId;
        }

        public UUID orgId() {
            return orgId;
        }

        public List<ToolCall> calls() {
            return List.copyOf(calls);
        }

        public Optional<SubjectFacts> getSubject(OperationsSubjectKind kind, UUID subjectId) {
            Optional<SubjectFacts> facts = switch (kind) {
                case INQUIRY -> inquiries.findById(subjectId).filter(i -> orgId.equals(i.getOrgId()))
                        .map(this::inquiryFacts);
                case REVIEW -> reviews.findById(subjectId).filter(r -> orgId.equals(r.getOrgId()))
                        .map(this::reviewFacts);
                case SOURCE -> Optional.empty();
            };
            record("getSubject", kind + ":" + subjectId, facts.isPresent() ? 1 : 0);
            return facts;
        }

        /**
         * The review's attachments. When the photo lane is on for this organisation, photos not yet looked at are
         * inspected first (at most three, each fetched under the image fetch policy), so the investigation reads what
         * the photos show. When it is off, or a photo could not be fetched, the fact says the photo was not seen.
         */
        public ReviewMediaFacts getReviewMedia(UUID reviewId) {
            Review review = reviews.findById(reviewId).filter(r -> orgId.equals(r.getOrgId())).orElse(null);
            if (review == null) {
                record("getReviewMedia", String.valueOf(reviewId), 0);
                return new ReviewMediaFacts(0, false, List.of());
            }
            boolean on = mediaInspector != null && mediaInspector.enabledFor(orgId);
            if (on) {
                try {
                    mediaInspector.inspect(orgId, reviewId);
                } catch (RuntimeException e) {
                    // The investigation continues on what is already known; the rows say what was not seen.
                }
            }
            List<MediaFact> facts = new ArrayList<>();
            if (reviewMedia != null) {
                for (com.sellerops.review.media.ReviewMedia m
                        : reviewMedia.findByOrgIdAndReviewIdOrderByOrdinalAsc(orgId, reviewId)) {
                    boolean inspected = m.getInspectionStatus()
                            == com.sellerops.review.media.ReviewMedia.InspectionStatus.INSPECTED;
                    String reason = inspected ? null
                            : m.getInspectionStatus()
                                    == com.sellerops.review.media.ReviewMedia.InspectionStatus.NOT_INSPECTED
                                    ? (on ? "NOT_YET" : "CAPABILITY_OFF") : m.getInspectionStatus().name();
                    facts.add(new MediaFact(m.getOrdinal(), m.getMediaKind().name(), inspected,
                            inspected ? m.getDepicts() : null,
                            inspected && m.getProblemVisible() != null ? m.getProblemVisible().name() : null,
                            inspected ? m.getProblemDescription() : null, reason));
                }
            }
            record("getReviewMedia", String.valueOf(reviewId), facts.size());
            return new ReviewMediaFacts(review.getMediaCount(), review.isMediaCountObserved(), List.copyOf(facts));
        }

        public Optional<ProductContext> getProductContext(UUID productId) {
            Optional<ProductContext> context = products.findById(productId)
                    .filter(p -> orgId.equals(p.getOrgId()))
                    .map(product -> new ProductContext(OperatorProductName.displayNameOrNull(product)));
            record("getProductContext", String.valueOf(productId), context.isPresent() ? 1 : 0);
            return context;
        }

        /**
         * The company's knowledge for this case, through the Knowledge Spine. For an inquiry this is the draft writer's
         * own assessment, with stored order facts only (a background run never reads a channel for it).
         */
        public KnowledgeAssessment assessKnowledge(OperationsSubjectKind kind, UUID subjectId) {
            KnowledgeAssessment assessment;
            try {
                assessment = switch (kind) {
                    case INQUIRY -> inquiries.findById(subjectId).filter(i -> orgId.equals(i.getOrgId()))
                            .map(this::assessInquiry).orElse(KnowledgeAssessment.none());
                    case REVIEW -> reviews.findById(subjectId).filter(r -> orgId.equals(r.getOrgId()))
                            .map(this::assessReview).orElse(KnowledgeAssessment.none());
                    case SOURCE -> KnowledgeAssessment.none();
                };
            } catch (RuntimeException unreadable) {
                // An unreadable library is reported as nothing found; the prompt then asks rather than asserts.
                assessment = KnowledgeAssessment.none();
            }
            record("assessKnowledge", kind + ":" + subjectId,
                    assessment.evidence().size() + assessment.context().size());
            return assessment;
        }

        private KnowledgeAssessment assessInquiry(Inquiry inquiry) {
            InquiryKnowledgeAssessor.Assessment a = assessor.assess(orgId, inquiry, OrderFactLookup.STORED_ONLY);
            boolean missing = a.basis() == AnswerBasisState.NO_ANSWER_BASIS;
            String subject = missing ? a.missingSubject() : null;
            // A question about 배송·교환·결제·증빙 is answered by a company rule; anything else about a named product
            // is that product's knowledge. The seller can still choose the other scope when they answer.
            String scope = !missing ? null : a.productId() == null || a.asked() != null ? "ORG" : "PRODUCT";
            // A catalogue question the catalogue answered cites the product that answers it, labelled as ANOTHER
            // product; a catalogue question it could not answer is asked of the seller as a catalogue fact.
            List<KnowledgeUse> evidence = new java.util.ArrayList<>(catalogueUses(a.catalogue()));
            evidence.addAll(uses(a.spine().evidence()));
            if (missing && a.catalogue() != null) {
                scope = "ORG";
            }
            return new KnowledgeAssessment(a.basis().name(), subject, scope,
                    a.asked() == null ? null : a.asked().name(), evidence,
                    uses(investigationContext(a.spine())), a.spine().conflicts());
        }

        private KnowledgeAssessment assessReview(Review review) {
            if (review.getProductId() == null) {
                return KnowledgeAssessment.none();
            }
            RedactedBody body = VocPreviewSanitizer.redactFullBody(MarkupText.toPlainText(review.getBody()));
            if (body.text() == null || body.text().isBlank()) {
                return KnowledgeAssessment.none();
            }
            SpineRetrieval found = spine.retrieveForProduct(orgId, review.getProductId(),
                    RetrievalQuery.ofCustomer(null, body.text()), KnowledgeVariantScope.unresolved());
            return new KnowledgeAssessment("CONTEXT_ONLY", null, null, null, uses(found.evidence()),
                    uses(investigationContext(found)), found.conflicts());
        }

        /** Stored order facts only — never an exact channel lookup from a background run. */
        public OrderContext getOrderContext(UUID inquiryId) {
            OrderContext context = inquiries.findById(inquiryId)
                    .filter(i -> orgId.equals(i.getOrgId()))
                    .map(inquiry -> {
                        try {
                            OrderFact fact = orderFacts.read(orgId, inquiry, OrderFactLookup.STORED_ONLY);
                            return fact != null && fact.available()
                                    ? new OrderContext(true, fact.messageKo())
                                    : new OrderContext(false, "이 문의에 연결된 주문 정보는 없습니다.");
                        } catch (RuntimeException unreadable) {
                            return new OrderContext(false, "주문 정보를 읽지 못했습니다.");
                        }
                    })
                    .orElse(new OrderContext(false, "이 문의에 연결된 주문 정보는 없습니다."));
            record("getOrderContext", String.valueOf(inquiryId), context.available() ? 1 : 0);
            return context;
        }

        public List<RelatedIssue> getRelatedIssues(UUID reviewId, UUID productId) {
            Map<UUID, ReviewIssue> open = issues.findByOrgIdAndDismissedFalse(orgId).stream()
                    .collect(Collectors.toMap(ReviewIssue::getId, Function.identity(), (a, b) -> a));
            Set<UUID> onThisReview = reviewId == null ? Set.of()
                    : issueEvidence.findByOrgIdAndReviewId(orgId, reviewId).stream()
                            .map(ReviewIssueEvidence::getIssueId).collect(Collectors.toCollection(LinkedHashSet::new));
            Map<UUID, RelatedIssue> related = new LinkedHashMap<>();
            for (UUID issueId : onThisReview) {
                ReviewIssue issue = open.get(issueId);
                if (issue != null) {
                    related.put(issueId, new RelatedIssue(issue.getTitle(),
                            issueEvidence.countByOrgIdAndIssueId(orgId, issueId), true));
                }
            }
            if (productId != null) {
                for (Object[] row : issueEvidence.issueEvidenceCountsByProduct(orgId, productId)) {
                    UUID issueId = (UUID) row[0];
                    long count = ((Number) row[1]).longValue();
                    ReviewIssue issue = open.get(issueId);
                    if (issue != null && count >= 2 && !related.containsKey(issueId) && related.size() < 3) {
                        related.put(issueId, new RelatedIssue(issue.getTitle(), count, false));
                    }
                }
            }
            List<RelatedIssue> result = List.copyOf(related.values());
            record("getRelatedIssues", reviewId + ":" + productId, result.size());
            return result;
        }

        public List<SimilarCase> getRecentSimilarCases(OperationsSubjectKind kind, UUID productId, UUID excludedCaseId) {
            List<SimilarCase> similar = productId == null ? List.of()
                    : cases.findTop3ByOrgIdAndSubjectKindAndProductIdAndIdNotOrderByCreatedAtDesc(
                                    orgId, kind, productId, excludedCaseId)
                            .stream().map(CaseInvestigationTools::similar).toList();
            record("getRecentSimilarCases", kind + ":" + productId, similar.size());
            return similar;
        }

        public PastDecisions getPastSellerDecisions(UUID productId) {
            Map<String, Long> reviewDispositions = new LinkedHashMap<>();
            Map<String, Long> draftAuthors = new LinkedHashMap<>();
            List<SellerDecision> made = new ArrayList<>();
            if (productId != null) {
                for (Object[] row : cases.reviewDecisionsForProduct(orgId, productId)) {
                    reviewDispositions.put(String.valueOf(row[0]), ((Number) row[1]).longValue());
                }
                for (Object[] row : cases.inquiryDraftAuthorsForProduct(orgId, productId)) {
                    if (row[0] != null) {
                        draftAuthors.put(String.valueOf(row[0]), ((Number) row[1]).longValue());
                    }
                }
                // What this company decided, one decision at a time. Counts say how often; these say what.
                for (ReplyDecisionHistoryReader.ReplyDecision approved
                        : replyDecisions.onProduct(orgId, productId, MAX_DECISIONS)) {
                    made.add(new SellerDecision("REPLY_APPROVED", "v" + approved.approvedDraftVersion(),
                            day(approved.decidedAt())));
                }
                for (Object[] row : cases.recentReviewDecisionsForProduct(orgId, productId,
                        PageRequest.of(0, MAX_DECISIONS))) {
                    made.add(new SellerDecision("REVIEW_TRIAGED", String.valueOf(row[0]), day((Instant) row[1])));
                }
                for (Object[] row : cases.recentTriageCorrectionsForProduct(orgId, productId,
                        PageRequest.of(0, MAX_DECISIONS))) {
                    made.add(new SellerDecision("TRIAGE_CORRECTED",
                            nullSafeToken(row[0]) + "→" + nullSafeToken(row[1]), day((Instant) row[2])));
                }
            }
            PastDecisions decisions = new PastDecisions(reviewDispositions, draftAuthors, List.copyOf(made));
            record("getPastSellerDecisions", String.valueOf(productId),
                    reviewDispositions.size() + draftAuthors.size() + made.size());
            return decisions;
        }

        private static String nullSafeToken(Object token) {
            return token == null ? "-" : String.valueOf(token);
        }

        private static LocalDate day(Instant at) {
            return at == null ? null : at.atZone(KST).toLocalDate();
        }

        private SubjectFacts inquiryFacts(Inquiry inquiry) {
            RedactedBody body = VocPreviewSanitizer.redactFullBody(MarkupText.toPlainText(inquiry.getBody()));
            RedactedBody title = VocPreviewSanitizer.redactFullBody(MarkupText.toPlainText(inquiry.getTitle()));
            return new SubjectFacts(OperationsSubjectKind.INQUIRY, channelName(inquiry.getChannelId()),
                    inquiry.getReceivedAt() == null ? null : inquiry.getReceivedAt().atZone(KST).toLocalDate(),
                    null, inquiry.getStatus(), inquiry.getThreadRole(), cap(title.text(), 200), cap(body.text(), MAX_BODY),
                    body.redacted() || title.redacted(), inquiry.getProductId(),
                    inquiry.getSourceOrderRef() != null && !inquiry.getSourceOrderRef().isBlank(), inquiry.getId());
        }

        private SubjectFacts reviewFacts(Review review) {
            RedactedBody body = VocPreviewSanitizer.redactFullBody(MarkupText.toPlainText(review.getBody()));
            return new SubjectFacts(OperationsSubjectKind.REVIEW, channelName(review.getChannelId()),
                    review.getReceivedAt() == null ? null : review.getReceivedAt().atZone(KST).toLocalDate(),
                    review.getRating(), review.getReplyState() == null ? null : review.getReplyState().name(), null,
                    null, cap(body.text(), MAX_BODY), body.redacted(), review.getProductId(), false, null);
        }

        private String channelName(UUID channelId) {
            return channelId == null ? null : channels.findById(channelId).map(Channel::getNameKo).orElse(null);
        }

        private void record(String name, String args, int results) {
            calls.add(new ToolCall(name, digest(args), results));
        }
    }

    /** Review decisions already reach an investigation through {@code getPastSellerDecisions}; not twice. */
    private static List<KnowledgeEntry> investigationContext(SpineRetrieval found) {
        return found.context().stream()
                .filter(e -> e.sourceType() != SpineSourceType.REVIEW_DECISION
                        && e.sourceType() != SpineSourceType.TRIAGE_CORRECTION)
                .toList();
    }

    /** The catalogue statements that answered a catalogue question, as knowledge the investigator may cite. */
    static List<KnowledgeUse> catalogueUses(com.sellerops.product.catalogue.CatalogueInvestigator.Finding finding) {
        if (finding == null || !finding.grounds()) {
            return List.of();
        }
        return finding.matches().stream().limit(3)
                .map(m -> new KnowledgeUse("CATALOGUE:" + m.sourceId(), SpineSourceType.PRODUCT_FACT,
                        com.sellerops.knowledge.spine.KnowledgeAuthority.PRODUCT_DETAIL.labelKo(),
                        com.sellerops.knowledge.spine.KnowledgeAuthority.PRODUCT_DETAIL.rank(),
                        m.current() ? "PRODUCT" : "CATALOGUE",
                        m.current() ? "채널 상품 정보" : "판매 중인 다른 상품 · " + m.productName(),
                        m.productName(), excerpt(m.text()),
                        m.capturedAt() == null ? null : m.capturedAt().atZone(KST).toLocalDate()))
                .toList();
    }

    private static List<KnowledgeUse> uses(List<KnowledgeEntry> entries) {
        return entries.stream()
                .map(e -> new KnowledgeUse(e.entryId(), e.sourceType(), e.authority().labelKo(), e.authority().rank(),
                        e.scope().name(), e.provenance(), e.title(), excerpt(e.text()),
                        e.capturedAt() == null ? null : e.capturedAt().atZone(KST).toLocalDate()))
                .toList();
    }

    private static SimilarCase similar(OperationsCase c) {
        return new SimilarCase(c.getSubjectKind().name(),
                c.getDisposition() == null ? null : c.getDisposition().name(),
                c.getRecommendedActionType() == null ? null : c.getRecommendedActionType().name(),
                c.getResolutionReason() == null ? null : c.getResolutionReason().name());
    }

    static String excerpt(String content) {
        if (content == null) {
            return "";
        }
        String flat = content.replaceAll("\\s+", " ").strip();
        return flat.length() > MAX_EXCERPT ? flat.substring(0, MAX_EXCERPT) + "…" : flat;
    }

    private static String cap(String text, int max) {
        if (text == null) {
            return null;
        }
        return text.length() > max ? text.substring(0, max) + "…" : text;
    }

    static String digest(String args) {
        try {
            byte[] bytes = MessageDigest.getInstance("SHA-256").digest(String.valueOf(args).getBytes(StandardCharsets.UTF_8));
            StringBuilder hex = new StringBuilder();
            for (int i = 0; i < 6; i++) {
                hex.append(String.format("%02x", bytes[i]));
            }
            return hex.toString();
        } catch (Exception e) {
            return "unavailable";
        }
    }
}
