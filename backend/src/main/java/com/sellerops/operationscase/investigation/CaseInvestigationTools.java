package com.sellerops.operationscase.investigation;

import com.sellerops.channel.Channel;
import com.sellerops.channel.ChannelRepository;
import com.sellerops.common.MarkupText;
import com.sellerops.common.RedactedBody;
import com.sellerops.common.VocPreviewSanitizer;
import com.sellerops.inquiry.Inquiry;
import com.sellerops.inquiry.InquiryRepository;
import com.sellerops.inquiry.draft.InquiryOrderFactReader;
import com.sellerops.knowledge.org.SellerOperationsKnowledgeService;
import com.sellerops.knowledge.org.dto.OrgKnowledgeSearchResponse;
import com.sellerops.operationscase.OperationsCase;
import com.sellerops.operationscase.OperationsCaseRepository;
import com.sellerops.operationscase.OperationsSubjectKind;
import com.sellerops.order.fact.OrderFact;
import com.sellerops.order.fact.OrderFactLookup;
import com.sellerops.product.OperatorProductName;
import com.sellerops.product.ProductRepository;
import com.sellerops.product.library.ProductKnowledgeLibraryService;
import com.sellerops.product.library.dto.KnowledgeSearchResponse;
import com.sellerops.review.Review;
import com.sellerops.review.ReviewRepository;
import com.sellerops.reviewissue.ReviewIssue;
import com.sellerops.reviewissue.ReviewIssueEvidence;
import com.sellerops.reviewissue.ReviewIssueEvidenceRepository;
import com.sellerops.reviewissue.ReviewIssueRepository;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
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
    static final ZoneId KST = ZoneId.of("Asia/Seoul");

    private final InquiryRepository inquiries;
    private final ReviewRepository reviews;
    private final ChannelRepository channels;
    private final ProductRepository products;
    private final ProductKnowledgeLibraryService productKnowledge;
    private final SellerOperationsKnowledgeService orgKnowledge;
    private final InquiryOrderFactReader orderFacts;
    private final ReviewIssueRepository issues;
    private final ReviewIssueEvidenceRepository issueEvidence;
    private final OperationsCaseRepository cases;

    public CaseInvestigationTools(InquiryRepository inquiries, ReviewRepository reviews, ChannelRepository channels,
                                  ProductRepository products, ProductKnowledgeLibraryService productKnowledge,
                                  SellerOperationsKnowledgeService orgKnowledge, InquiryOrderFactReader orderFacts,
                                  ReviewIssueRepository issues, ReviewIssueEvidenceRepository issueEvidence,
                                  OperationsCaseRepository cases) {
        this.inquiries = inquiries;
        this.reviews = reviews;
        this.channels = channels;
        this.products = products;
        this.productKnowledge = productKnowledge;
        this.orgKnowledge = orgKnowledge;
        this.orderFacts = orderFacts;
        this.issues = issues;
        this.issueEvidence = issueEvidence;
        this.cases = cases;
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

    public record KnowledgeHit(String kindLabel, String title, String excerpt) {
    }

    public record ProductContext(String name, List<KnowledgeHit> knowledge) {
    }

    public record OrderContext(boolean available, String sentence) {
    }

    public record RelatedIssue(String title, long evidenceCount, boolean citesThisReview) {
    }

    public record SimilarCase(String kind, String disposition, String recommendedActionType, String resolution) {
    }

    public record PastDecisions(Map<String, Long> reviewDispositions, Map<String, Long> inquiryDraftAuthors) {

        boolean isEmpty() {
            return reviewDispositions.isEmpty() && inquiryDraftAuthors.isEmpty();
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

        public Optional<ProductContext> getProductContext(UUID productId, String question) {
            Optional<ProductContext> context = products.findById(productId)
                    .filter(p -> orgId.equals(p.getOrgId()))
                    .map(product -> {
                        List<KnowledgeHit> hits = new ArrayList<>();
                        try {
                            KnowledgeSearchResponse found = productKnowledge.search(orgId, productId, question, 2);
                            found.passages().forEach(p -> hits.add(
                                    new KnowledgeHit("상품 지식", p.title(), excerpt(p.content()))));
                        } catch (RuntimeException unreadable) {
                            // A product whose library cannot be searched still has a name worth stating.
                        }
                        return new ProductContext(OperatorProductName.displayNameOrNull(product), hits);
                    });
            record("getProductContext", String.valueOf(productId), context.map(c -> 1 + c.knowledge().size()).orElse(0));
            return context;
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

        public List<KnowledgeHit> searchKnowledge(String question) {
            List<KnowledgeHit> hits = new ArrayList<>();
            try {
                OrgKnowledgeSearchResponse found = orgKnowledge.search(orgId, question, 2);
                found.passages().forEach(p -> hits.add(new KnowledgeHit("운영 기준", p.title(), excerpt(p.content()))));
            } catch (RuntimeException unreadable) {
                // An unsearchable library is reported as no hit; the prompt then asks rather than asserts.
            }
            record("searchKnowledge", question, hits.size());
            return hits;
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
            if (productId != null) {
                for (Object[] row : cases.reviewDecisionsForProduct(orgId, productId)) {
                    reviewDispositions.put(String.valueOf(row[0]), ((Number) row[1]).longValue());
                }
                for (Object[] row : cases.inquiryDraftAuthorsForProduct(orgId, productId)) {
                    if (row[0] != null) {
                        draftAuthors.put(String.valueOf(row[0]), ((Number) row[1]).longValue());
                    }
                }
            }
            PastDecisions decisions = new PastDecisions(reviewDispositions, draftAuthors);
            record("getPastSellerDecisions", String.valueOf(productId),
                    reviewDispositions.size() + draftAuthors.size());
            return decisions;
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
