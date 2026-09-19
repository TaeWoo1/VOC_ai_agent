package com.sellerops.knowledge.teach;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.sellerops.channel.Channel;
import com.sellerops.channel.ChannelRepository;
import com.sellerops.common.ApiException;
import com.sellerops.common.MarkupText;
import com.sellerops.common.VocPreviewSanitizer;
import com.sellerops.inquiry.Inquiry;
import com.sellerops.inquiry.InquiryRepository;
import com.sellerops.inquiry.draft.InquiryDraftComposer;
import com.sellerops.inquiry.draft.InquiryEvidenceRetriever;
import com.sellerops.inquiry.reply.InquiryReplyDraftService;
import com.sellerops.inquiry.reply.dto.ReplyDraftView;
import com.sellerops.knowledge.KnowledgeText;
import com.sellerops.knowledge.KnowledgeTopic;
import com.sellerops.knowledge.candidate.KnowledgeCandidateService;
import com.sellerops.knowledge.guidance.SellerGuidance;
import com.sellerops.knowledge.guidance.SellerGuidanceService;
import com.sellerops.knowledge.memory.AnswerMemory;
import com.sellerops.knowledge.memory.AnswerMemoryRepository;
import com.sellerops.knowledge.org.OrgKnowledgeType;
import com.sellerops.knowledge.spine.KnowledgeEntry;
import com.sellerops.knowledge.spine.SpineSourceType;
import com.sellerops.knowledge.spine.KnowledgeSpineService;
import com.sellerops.knowledge.teach.dto.CaseCorrectionRequest;
import com.sellerops.knowledge.teach.dto.CaseDetailView;
import com.sellerops.knowledge.teach.dto.CaseDraftEditRequest;
import com.sellerops.knowledge.teach.dto.CaseTeachRequest;
import com.sellerops.operationscase.CaseDisposition;
import com.sellerops.operationscase.CaseEventActor;
import com.sellerops.operationscase.CaseEventKind;
import com.sellerops.operationscase.CaseKnowledgeGap;
import com.sellerops.operationscase.OperationsCase;
import com.sellerops.operationscase.OperationsCaseEvent;
import com.sellerops.operationscase.OperationsCaseEventRepository;
import com.sellerops.operationscase.OperationsCaseProcessor;
import com.sellerops.operationscase.OperationsCaseRepository;
import com.sellerops.operationscase.OperationsSubjectKind;
import com.sellerops.operationscase.RecommendedActionType;
import com.sellerops.operationscase.investigation.CaseDraftPreparer;
import com.sellerops.operationscase.investigation.CaseInvestigator;
import com.sellerops.product.OperatorProductName;
import com.sellerops.product.ProductRepository;
import com.sellerops.review.Review;
import com.sellerops.review.ReviewRepository;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.stereotype.Service;

/**
 * <b>The seller's side of a customer-operations case</b> (Knowledge &amp; Intelligence Closure v1): read it, teach the
 * knowledge it is missing, rewrite its draft, correct its recommendation — and choose what Reviewnary keeps.
 *
 * <p><b>Why it is not in {@code operationscase}.</b> That package is the responsibility runtime, fenced to never write
 * policy, knowledge or a draft of its own accord. Everything here starts with a seller's press on the case screen: a
 * seller who types 「방수 안 됩니다」 into [정보 알려주기] is writing company knowledge on purpose, through the same writer
 * the Knowledge Inbox uses ({@link KnowledgeCandidateService#teach}), and a seller who presses 「다음에도 참고」 is asking
 * for exactly one guidance row. Nothing is inferred and no rule, threshold or policy is mutated.
 *
 * <p><b>Teach closes the loop on the same case.</b> After the knowledge is saved, the case is re-investigated through
 * the same investigator and re-drafted through the same production draft path the scheduled run used, and both
 * outcomes are recorded by the processor's own recording methods — so a taught case reads exactly as if the knowledge
 * had been there the first time. The next similar case needs no teaching: the knowledge is ordinary company knowledge
 * in the Knowledge Spine.
 *
 * <p>Nothing here approves, sends or reaches a marketplace; a draft remains a draft on the inquiry screen.
 */
@Service
public class CaseKnowledgeService {

    private static final ObjectMapper MAPPER = new ObjectMapper();
    private static final ZoneId KST = ZoneId.of("Asia/Seoul");
    static final int MAX_BODY = 1200;

    private final OperationsCaseRepository cases;
    private final OperationsCaseEventRepository events;
    private final OperationsCaseProcessor processor;
    private final CaseInvestigator investigator;
    private final CaseDraftPreparer preparer;
    private final InquiryRepository inquiries;
    private final ReviewRepository reviews;
    private final ChannelRepository channels;
    private final ProductRepository products;
    private final InquiryEvidenceRetriever retriever;
    private final KnowledgeCandidateService candidates;
    private final SellerGuidanceService guidance;
    private final KnowledgeSpineService spine;
    private final InquiryReplyDraftService drafts;
    private final InquiryDraftComposer composer;
    private final AnswerMemoryRepository memories;

    public CaseKnowledgeService(OperationsCaseRepository cases, OperationsCaseEventRepository events,
                                OperationsCaseProcessor processor, CaseInvestigator investigator,
                                CaseDraftPreparer preparer, InquiryRepository inquiries, ReviewRepository reviews,
                                ChannelRepository channels, ProductRepository products,
                                InquiryEvidenceRetriever retriever, KnowledgeCandidateService candidates,
                                SellerGuidanceService guidance, KnowledgeSpineService spine,
                                InquiryReplyDraftService drafts, InquiryDraftComposer composer,
                                AnswerMemoryRepository memories) {
        this.cases = cases;
        this.events = events;
        this.processor = processor;
        this.investigator = investigator;
        this.preparer = preparer;
        this.inquiries = inquiries;
        this.reviews = reviews;
        this.channels = channels;
        this.products = products;
        this.retriever = retriever;
        this.candidates = candidates;
        this.guidance = guidance;
        this.spine = spine;
        this.drafts = drafts;
        this.composer = composer;
        this.memories = memories;
    }

    // ── read ────────────────────────────────────────────────────────────────────────────────────────────────────

    public CaseDetailView detail(UUID orgId, UUID caseId) {
        OperationsCase c = requireCase(orgId, caseId);
        String channelName = c.getChannelId() == null ? null
                : channels.findById(c.getChannelId()).map(Channel::getNameKo).orElse(null);
        UUID namedProduct = retriever.namedProduct(orgId, c.getProductId());
        String productName = namedProduct == null ? null
                : products.findById(namedProduct).map(OperatorProductName::displayNameOrNull).orElse(null);
        Subject subject = subject(orgId, c);
        CaseKnowledgeGap gap = gapOf(c);
        return new CaseDetailView(c.getId(), c.isOpen(), c.getSubjectKind().name(), channelName, productName,
                namedProduct != null, subject.receivedOn(), subject.rating(), subject.title(), subject.body(),
                com.sellerops.operationscase.CaseReason.noteFor(c),
                c.getDisposition() == null ? null : c.getDisposition().name(),
                c.getDecidedBy() == null ? null : c.getDecidedBy().name(), c.getSummary(),
                c.getRecommendedActionType() == null ? null : c.getRecommendedActionType().name(),
                c.getRecommendedAction(), strings(c.getMissingInformation()), whyDecisionNeeded(c, gap),
                investigated(orgId, c), knowledgeUsed(orgId, c, namedProduct),
                gap == null ? null : new CaseDetailView.Gap(gap.missingSubject(), gapSentence(gap),
                        namedProduct == null ? "ORG" : gap.suggestedScope(),
                        gap.needs() == null ? prefillOf(orgId, c, namedProduct, gap)
                                : combinedPrefill(needLines(orgId, c, namedProduct, gap)),
                        needLines(orgId, c, namedProduct, gap)),
                draft(orgId, c), c.getSubjectKind() == OperationsSubjectKind.INQUIRY
                        ? "/inquiries/" + c.getSubjectId() : "/reviews/reply/" + c.getSubjectId(),
                media(orgId, c));
    }

    /** The review-photo lane. Optional: a context without it shows a case with no photos, as before. */
    private com.sellerops.review.media.ReviewMediaRepository reviewMedia;
    private com.sellerops.review.media.ReviewMediaInspector mediaInspector;

    @org.springframework.beans.factory.annotation.Autowired(required = false)
    void setReviewMedia(com.sellerops.review.media.ReviewMediaRepository reviewMedia,
                        com.sellerops.review.media.ReviewMediaInspector mediaInspector) {
        this.reviewMedia = reviewMedia;
        this.mediaInspector = mediaInspector;
    }

    private List<CaseDetailView.Media> media(UUID orgId, OperationsCase c) {
        if (reviewMedia == null || c.getSubjectKind() != OperationsSubjectKind.REVIEW) {
            return List.of();
        }
        boolean on = mediaInspector != null && mediaInspector.enabledFor(orgId);
        return reviewMedia.findByOrgIdAndReviewIdOrderByOrdinalAsc(orgId, c.getSubjectId()).stream()
                .map(m -> {
                    boolean inspected = m.getInspectionStatus()
                            == com.sellerops.review.media.ReviewMedia.InspectionStatus.INSPECTED;
                    boolean video = m.getMediaKind() == com.sellerops.review.media.ReviewMedia.Kind.VIDEO;
                    return new CaseDetailView.Media(m.getOrdinal(), m.getMediaKind().name(), inspected,
                            mediaStatusKo(m.getInspectionStatus(), on), inspected ? m.getDepicts() : null,
                            inspected && m.getProblemVisible() != null ? m.getProblemVisible().name() : null,
                            inspected ? m.getProblemDescription() : null,
                            video ? null : "/api/responsibilities/customer-operations/cases/" + c.getId()
                                    + "/media/" + m.getOrdinal());
                }).toList();
    }

    static String mediaStatusKo(com.sellerops.review.media.ReviewMedia.InspectionStatus status, boolean on) {
        return switch (status) {
            case INSPECTED -> "Reviewnary가 사진을 확인했습니다.";
            case NOT_INSPECTED -> on ? "아직 사진을 확인하지 않았습니다." : "사진 확인 기능이 꺼져 있어 사진 내용은 보지 않았습니다.";
            case FETCH_FAILED -> "사진을 가져오지 못해 내용은 보지 않았습니다.";
            case MODEL_FAILED -> "사진을 확인하지 못했습니다.";
            case NOT_AN_IMAGE -> "사진이 아니어서 내용은 보지 않았습니다.";
        };
    }

    /**
     * One of this case's review photos, fetched for the seller's own screen under the image fetch policy. Empty when
     * the case is not this organisation's review, the ordinal has no photo, or the fetch was refused.
     */
    public java.util.Optional<com.sellerops.product.detail.image.DetailImageFetcher.Loaded> mediaImage(
            UUID orgId, UUID caseId, int ordinal) {
        OperationsCase c = requireCase(orgId, caseId);
        if (reviewMedia == null || mediaInspector == null || c.getSubjectKind() != OperationsSubjectKind.REVIEW) {
            return java.util.Optional.empty();
        }
        return reviewMedia.findByOrgIdAndReviewIdOrderByOrdinalAsc(orgId, c.getSubjectId()).stream()
                .filter(m -> m.getOrdinal() == ordinal
                        && m.getMediaKind() != com.sellerops.review.media.ReviewMedia.Kind.VIDEO)
                .findFirst()
                .flatMap(mediaInspector::loadForSeller);
    }

    // ── teach ───────────────────────────────────────────────────────────────────────────────────────────────────

    /**
     * Save the seller's answer to the case's knowledge gap as seller-confirmed knowledge, then re-investigate and
     * re-draft the case through the production paths.
     */
    public CaseDetailView teach(UUID orgId, UUID caseId, CaseTeachRequest request, UUID userId, String userName) {
        OperationsCase c = requireCase(orgId, caseId);
        if (!c.isOpen() || c.getSubjectKind() != OperationsSubjectKind.INQUIRY) {
            throw ApiException.conflict("정보를 알려 줄 수 있는 건이 아닙니다.");
        }
        CaseKnowledgeGap gap = gapOf(c);
        if (gap == null) {
            throw ApiException.conflict("이 건에는 부족한 정보가 없습니다.");
        }
        UUID namedProduct = retriever.namedProduct(orgId, c.getProductId());
        String scope = "PRODUCT".equals(request.scope()) && namedProduct != null ? "PRODUCT" : "ORG";
        candidates.teach(orgId, scope, namedProduct, teachSubject(gap), gap.candidateId(), request.content(),
                orgTypeFor(gap.topic()), userId, userName);
        Map<String, Object> taught = new LinkedHashMap<>();
        taught.put("scope", scope);
        taught.put("topic", gap.topic());
        // Which past answer the seller started from, and whether they kept it word for word — an id and a boolean,
        // never the text. The knowledge itself is the seller's: it was saved because they confirmed it.
        CaseDetailView.Prefill offered = prefillOf(orgId, c, namedProduct, gap);
        if (offered != null) {
            taught.put("precedentMemoryId", gap.precedentMemoryId().toString());
            taught.put("precedentUnchanged",
                    KnowledgeText.normalize(offered.text()).equals(KnowledgeText.normalize(request.content())));
        }
        events.save(OperationsCaseEvent.of(c, c.getLastRunId(), CaseEventActor.SELLER, CaseEventKind.KNOWLEDGE_TAUGHT,
                json(taught)));
        rerun(orgId, c);
        return detail(orgId, caseId);
    }

    /** Re-investigate (when the organisation has the capability), then re-draft when the case is a reply. */
    private void rerun(UUID orgId, OperationsCase c) {
        OperationsCase current = c;
        CaseInvestigator.Outcome outcome = investigator.investigate(current, current.getLastRunId());
        current = processor.recordInvestigation(current, current.getLastRunId(), outcome);
        boolean reply = outcome.kind() != CaseInvestigator.Kind.CONCLUDED
                || (current.getDisposition() == CaseDisposition.NEEDS_DECISION
                        && current.getRecommendedActionType() == RecommendedActionType.REPLY_TO_CUSTOMER);
        if (reply && current.getWorkItemId() != null) {
            processor.recordPrepared(current, current.getLastRunId(), preparer.prepare(orgId, current.getWorkItemId()));
        }
    }

    // ── corrections ─────────────────────────────────────────────────────────────────────────────────────────────

    /** The seller rewrote the prepared draft; with 「다음에도 참고」, the rewrite is kept as guidance. */
    public CaseDetailView editDraft(UUID orgId, UUID caseId, CaseDraftEditRequest request, UUID userId,
                                    String userName) {
        OperationsCase c = requireCase(orgId, caseId);
        if (c.getWorkItemId() == null || c.getDraftVersion() == null) {
            throw ApiException.conflict("고칠 초안이 없습니다.");
        }
        ReplyDraftView current = drafts.latestView(c.getWorkItemId());
        if (current == null) {
            throw ApiException.conflict("고칠 초안이 없습니다.");
        }
        boolean material = !KnowledgeText.normalize(request.body()).equals(KnowledgeText.normalize(current.comments()));
        if (!material) {
            throw ApiException.badRequest("고친 내용이 없습니다.");
        }
        drafts.save(orgId, c.getWorkItemId(), userId, current.title(), request.body(), current.version());
        events.save(OperationsCaseEvent.of(c, c.getLastRunId(), CaseEventActor.SELLER,
                CaseEventKind.SELLER_EDITED_DRAFT, json(Map.of("fromVersion", current.version()))));
        if (request.remember()) {
            remember(orgId, c, SellerGuidance.Kind.DRAFT_CORRECTION, null, request.body().strip(), request.scope(),
                    userId, userName);
        }
        return detail(orgId, caseId);
    }

    /** The seller said a different action is right; with 「다음에도 참고」, that judgement is kept as guidance. */
    public CaseDetailView correct(UUID orgId, UUID caseId, CaseCorrectionRequest request, UUID userId,
                                  String userName) {
        OperationsCase c = requireCase(orgId, caseId);
        RecommendedActionType corrected = parseAction(request.correctedActionType());
        String note = request.note() == null ? "" : request.note().strip();
        if (corrected == null && note.isEmpty()) {
            throw ApiException.badRequest("맞는 처리 방법을 고르거나 적어 주세요.");
        }
        Map<String, Object> provenance = new LinkedHashMap<>();
        provenance.put("from", c.getRecommendedActionType() == null ? null : c.getRecommendedActionType().name());
        provenance.put("to", corrected == null ? null : corrected.name());
        events.save(OperationsCaseEvent.of(c, c.getLastRunId(), CaseEventActor.SELLER, CaseEventKind.SELLER_CORRECTED,
                json(provenance)));
        if (request.remember()) {
            String text = note.isEmpty() ? "이런 건은 「" + actionKo(corrected) + "」로 처리합니다."
                    : corrected == null ? note : note + " (처리: " + actionKo(corrected) + ")";
            remember(orgId, c, SellerGuidance.Kind.DECISION_CORRECTION, corrected == null ? null : corrected.name(),
                    text, request.scope(), userId, userName);
        }
        return detail(orgId, caseId);
    }

    private void remember(UUID orgId, OperationsCase c, SellerGuidance.Kind kind, String correctedAction, String text,
                          String requestedScope, UUID userId, String userName) {
        UUID namedProduct = retriever.namedProduct(orgId, c.getProductId());
        UUID productId = "ORG".equals(requestedScope) || namedProduct == null ? null : namedProduct;
        Subject subject = subject(orgId, c);
        guidance.record(new SellerGuidanceService.Record(orgId, productId, kind, c.getSubjectKind().name(), c.getId(),
                correctedAction, (subject.title() == null ? "" : subject.title()) + " "
                        + (subject.body() == null ? "" : subject.body()),
                text, userId, userName));
        events.save(OperationsCaseEvent.of(c, c.getLastRunId(), CaseEventActor.SELLER,
                CaseEventKind.SELLER_GUIDANCE_RECORDED,
                json(Map.of("kind", kind.name(), "scope", productId == null ? "ORG" : "PRODUCT"))));
    }

    // ── helpers ─────────────────────────────────────────────────────────────────────────────────────────────────

    private OperationsCase requireCase(UUID orgId, UUID caseId) {
        return cases.findByIdAndOrgId(caseId, orgId)
                .orElseThrow(() -> ApiException.notFound("해당 건을 찾을 수 없습니다."));
    }

    private record Subject(String title, String body, Integer rating, LocalDate receivedOn) {
    }

    private Subject subject(UUID orgId, OperationsCase c) {
        if (c.getSubjectKind() == OperationsSubjectKind.INQUIRY) {
            Inquiry i = inquiries.findById(c.getSubjectId()).filter(x -> orgId.equals(x.getOrgId())).orElse(null);
            if (i == null) {
                return new Subject(null, null, null, null);
            }
            return new Subject(cap(VocPreviewSanitizer.redactFullBody(MarkupText.toPlainText(i.getTitle())).text()),
                    cap(VocPreviewSanitizer.redactFullBody(MarkupText.toPlainText(i.getBody())).text()), null,
                    i.getReceivedAt() == null ? null : i.getReceivedAt().atZone(KST).toLocalDate());
        }
        if (c.getSubjectKind() == OperationsSubjectKind.REVIEW) {
            Review r = reviews.findById(c.getSubjectId()).filter(x -> orgId.equals(x.getOrgId())).orElse(null);
            if (r == null) {
                return new Subject(null, null, null, null);
            }
            return new Subject(null, cap(VocPreviewSanitizer.redactFullBody(MarkupText.toPlainText(r.getBody())).text()),
                    r.getRating(), r.getReceivedAt() == null ? null : r.getReceivedAt().atZone(KST).toLocalDate());
        }
        return new Subject(null, null, null, null);
    }

    static CaseKnowledgeGap gapOf(OperationsCase c) {
        if (c.getKnowledgeGap() == null || c.getKnowledgeGap().isBlank()) {
            return null;
        }
        try {
            return MAPPER.readValue(c.getKnowledgeGap(), CaseKnowledgeGap.class);
        } catch (Exception unreadable) {
            return null;
        }
    }

    /**
     * The past answer the retrieval found for this gap, re-read now (Past Answer Prefill v1). Null — the empty box, as
     * before — when there was none, when it is gone, or when it no longer passes the fences it was found under.
     */
    /** The need list of an Inquiry Decision v2 gap, with each uncovered need's REUSABLE precedent re-read and fenced. */
    private List<CaseDetailView.NeedLine> needLines(UUID orgId, OperationsCase c, UUID namedProduct,
                                                    CaseKnowledgeGap gap) {
        if (gap.needs() == null) {
            return null;
        }
        boolean open = c.isOpen() && c.getSubjectKind() == OperationsSubjectKind.INQUIRY && memories != null;
        return gap.needs().stream().map(n -> {
            boolean covered = "FULL".equals(n.status()) || "CONDITIONAL_ON_CUSTOMER".equals(n.status());
            CaseDetailView.Prefill prefill = covered || !open || n.precedents() == null ? null
                    : n.precedents().stream().map(memories::findById).flatMap(java.util.Optional::stream)
                            .map(m -> prefill(orgId, c.getSubjectId(), namedProduct, m))
                            .filter(java.util.Objects::nonNull).findFirst().orElse(null);
            return new CaseDetailView.NeedLine(n.ask(), n.status(), n.statusKo(), covered,
                    n.evidence() == null ? List.of() : n.evidence(), n.missing(), n.askCustomer(), prefill,
                    n.acquirable());
        }).toList();
    }

    /**
     * The seller's starting text for a partial Teach: the precedents of the uncovered needs — one need, its answer as
     * it was; several, each under its need so the seller can see which part answers what. Null when there is none.
     */
    static CaseDetailView.Prefill combinedPrefill(List<CaseDetailView.NeedLine> needs) {
        List<CaseDetailView.NeedLine> offered = needs.stream().filter(n -> !n.covered() && n.prefill() != null)
                .toList();
        if (offered.isEmpty()) {
            return null;
        }
        if (offered.size() == 1) {
            return offered.get(0).prefill();
        }
        StringBuilder text = new StringBuilder();
        for (CaseDetailView.NeedLine n : offered) {
            text.append("[").append(n.ask()).append("]\n").append(n.prefill().text()).append("\n\n");
        }
        CaseDetailView.Prefill first = offered.get(0).prefill();
        return new CaseDetailView.Prefill(text.toString().strip(), first.strengthKo(), first.answeredOn());
    }

    private CaseDetailView.Prefill prefillOf(UUID orgId, OperationsCase c, UUID namedProduct, CaseKnowledgeGap gap) {
        if (!c.isOpen() || c.getSubjectKind() != OperationsSubjectKind.INQUIRY || gap.precedentMemoryId() == null
                || memories == null) {
            return null;
        }
        return memories.findById(gap.precedentMemoryId())
                .map(m -> prefill(orgId, c.getSubjectId(), namedProduct, m))
                .orElse(null);
    }

    /**
     * The fences a precedent is re-checked against when it is shown: this organisation's, not another product's (an
     * unbound answer names no product, so it is about none in particular), not this inquiry's own answer, and not
     * empty. The retrieval applied all of these when it found the answer; the case outlives that retrieval.
     */
    static CaseDetailView.Prefill prefill(UUID orgId, UUID inquiryId, UUID namedProduct, AnswerMemory m) {
        if (m == null || !orgId.equals(m.getOrgId()) || m.getAnswerBody() == null || m.getAnswerBody().isBlank()
                || (m.getProductId() != null && !m.getProductId().equals(namedProduct))
                || (inquiryId != null && inquiryId.equals(m.getOriginInquiryId()))) {
            return null;
        }
        return new CaseDetailView.Prefill(m.getAnswerBody().strip(),
                m.getStrength() == null ? null : m.getStrength().labelKo(),
                m.getUpdatedAt() == null ? null : m.getUpdatedAt().atZone(KST).toLocalDate());
    }

    /**
     * What the taught knowledge is titled with: the uncovered needs in the seller's words when the gap has a need list
     * (Inquiry Decision v2) — so the next customer asking the same need finds it under its own name — else the gap's
     * subject, as before.
     */
    static String teachSubject(CaseKnowledgeGap gap) {
        if (gap.needs() != null) {
            String asks = gap.needs().stream()
                    .filter(n -> !"FULL".equals(n.status()) && !"CONDITIONAL_ON_CUSTOMER".equals(n.status()))
                    .map(com.sellerops.inquiry.draft.dto.NeedCoverageView::ask).distinct()
                    .collect(java.util.stream.Collectors.joining(" · "));
            if (!asks.isBlank()) {
                return asks.length() > 180 ? asks.substring(0, 180) : asks;
            }
        }
        return gap.missingSubject();
    }

    static String gapSentence(CaseKnowledgeGap gap) {
        return gap.missingSubject() == null
                ? "이 문의에 답할 판매자 안내 기준이 없습니다."
                : "「" + gap.missingSubject() + "」에 대해 고객에게 안내할 기준이 없습니다.";
    }

    private static String whyDecisionNeeded(OperationsCase c, CaseKnowledgeGap gap) {
        if (!c.isOpen() || c.getDisposition() != CaseDisposition.NEEDS_DECISION) {
            return null;
        }
        if (gap != null) {
            return "답변에 필요한 회사 정보가 없어 Reviewnary가 답을 만들 수 없습니다. 정보를 알려 주시면 다시 준비합니다.";
        }
        if (c.getRecommendedActionType() != null && c.getRecommendedActionType().authority()
                == com.sellerops.operationscase.RequiredAuthority.HUMAN) {
            return "고객에게 무엇을 말하거나 약속할지는 판매자가 정합니다.";
        }
        return "Reviewnary가 확신할 수 없어 판매자 판단이 필요합니다.";
    }

    private List<CaseDetailView.Investigated> investigated(UUID orgId, OperationsCase c) {
        List<OperationsCaseEvent> history = events.findByOrgIdAndCaseIdOrderByCreatedAtAsc(orgId, c.getId());
        for (int i = history.size() - 1; i >= 0; i--) {
            OperationsCaseEvent e = history.get(i);
            if (e.getKind() != CaseEventKind.INVESTIGATED) {
                continue;
            }
            List<CaseDetailView.Investigated> out = new ArrayList<>();
            try {
                for (JsonNode call : MAPPER.readTree(e.getProvenance()).path("tools")) {
                    String tool = call.path("tool").asText();
                    if ("getReviewMedia".equals(tool)) {
                        out.addAll(photosLooked(orgId, c));
                        continue;
                    }
                    String label = toolKo(tool);
                    if (label != null) {
                        out.add(new CaseDetailView.Investigated(label, call.path("results").asInt()));
                    }
                }
            } catch (Exception unreadable) {
                return List.of();
            }
            return out;
        }
        return List.of();
    }

    /**
     * The photos, as the canonical media rows say now: how many a vision model actually looked at, and — separately —
     * how many it did not. A photo only counted or only addressed is never listed as looked at.
     */
    private List<CaseDetailView.Investigated> photosLooked(UUID orgId, OperationsCase c) {
        if (reviewMedia == null || c.getSubjectKind() != OperationsSubjectKind.REVIEW) {
            return List.of();
        }
        return photoLines(reviewMedia.findByOrgIdAndReviewIdOrderByOrdinalAsc(orgId, c.getSubjectId()));
    }

    static List<CaseDetailView.Investigated> photoLines(List<com.sellerops.review.media.ReviewMedia> rows) {
        long seen = rows.stream().filter(m -> m.getInspectionStatus()
                == com.sellerops.review.media.ReviewMedia.InspectionStatus.INSPECTED).count();
        List<CaseDetailView.Investigated> out = new ArrayList<>();
        if (seen > 0) {
            out.add(new CaseDetailView.Investigated("고객이 올린 사진", (int) seen));
        }
        if (rows.size() > seen) {
            out.add(new CaseDetailView.Investigated("보지 못한 사진", (int) (rows.size() - seen)));
        }
        return out;
    }

    private static String toolKo(String tool) {
        return switch (tool) {
            case "getSubject" -> "고객이 남긴 내용";
            case "getProductContext" -> "연결된 상품";
            case "getOrderContext" -> "주문 정보";
            case "assessKnowledge" -> "회사·상품 지식";
            case "getRelatedIssues" -> "반복되는 리뷰 문제";
            case "getRecentSimilarCases" -> "같은 상품의 최근 비슷한 건";
            case "getPastSellerDecisions" -> "판매자의 지난 결정";
            default -> null;
        };
    }

    private List<CaseDetailView.KnowledgeUsed> knowledgeUsed(UUID orgId, OperationsCase c, UUID namedProduct) {
        if (c.getKnowledgeUsed() == null || c.getKnowledgeUsed().isBlank()) {
            return List.of();
        }
        List<CaseInvestigator.UsedKnowledge> used;
        try {
            used = MAPPER.readValue(c.getKnowledgeUsed(), new TypeReference<List<CaseInvestigator.UsedKnowledge>>() { });
        } catch (Exception unreadable) {
            return List.of();
        }
        // Text is re-read from the raw source: the case stores which entries, never a second copy of what they say.
        Map<String, KnowledgeEntry> live = new LinkedHashMap<>();
        spine.entries(orgId, namedProduct).forEach(e -> live.put(e.entryId(), e));
        List<CaseDetailView.KnowledgeUsed> out = new ArrayList<>();
        for (CaseInvestigator.UsedKnowledge u : used) {
            KnowledgeEntry entry = live.get(u.entryId());
            if (entry == null) {
                continue;
            }
            String flat = entry.text() == null ? "" : entry.text().replaceAll("\\s+", " ").strip();
            boolean pastAnswer = entry.sourceType() == SpineSourceType.INQUIRY_ANSWER
                    || entry.sourceType() == SpineSourceType.REVIEW_REPLY;
            out.add(new CaseDetailView.KnowledgeUsed(entry.authority().labelKo(), entry.provenance(), entry.title(),
                    flat.length() > 200 ? flat.substring(0, 200) + "…" : flat,
                    entry.capturedAt() == null ? null : entry.capturedAt().atZone(KST).toLocalDate(), u.cited(),
                    entry.scope().name(), pastAnswer,
                    pastAnswer && entry.text() != null ? entry.text().strip() : null));
        }
        return out;
    }

    private CaseDetailView.Draft draft(UUID orgId, OperationsCase c) {
        if (c.getWorkItemId() == null) {
            return null;
        }
        ReplyDraftView latest = drafts.latestView(c.getWorkItemId());
        if (latest == null) {
            return null;
        }
        return new CaseDetailView.Draft(latest.version(), latest.title(), latest.comments(), latest.authorKind(),
                latest.answerBasis(), composer.evidenceFor(orgId, c.getWorkItemId(), latest.version()));
    }

    static OrgKnowledgeType orgTypeFor(String topic) {
        if (topic == null) {
            return OrgKnowledgeType.GENERAL_CS_FAQ;
        }
        try {
            return switch (KnowledgeTopic.valueOf(topic)) {
                case SHIPPING -> OrgKnowledgeType.SHIPPING_POLICY;
                case EXCHANGE_RETURN -> OrgKnowledgeType.EXCHANGE_REFUND_POLICY;
                case CANCELLATION -> OrgKnowledgeType.CANCELLATION_POLICY;
                case PAYMENT -> OrgKnowledgeType.PAYMENT_POLICY;
                case TAX_INVOICE -> OrgKnowledgeType.TAX_INVOICE;
                case CASH_RECEIPT -> OrgKnowledgeType.CASH_RECEIPT;
            };
        } catch (IllegalArgumentException unknown) {
            return OrgKnowledgeType.GENERAL_CS_FAQ;
        }
    }

    private static RecommendedActionType parseAction(String raw) {
        if (raw == null || raw.isBlank()) {
            return null;
        }
        try {
            return RecommendedActionType.valueOf(raw.strip());
        } catch (IllegalArgumentException e) {
            throw ApiException.badRequest("지원하지 않는 처리 방법입니다.");
        }
    }

    static String actionKo(RecommendedActionType action) {
        if (action == null) {
            return "판매자 판단";
        }
        return switch (action) {
            case NO_ACTION -> "할 일 없음";
            case MONITOR_REPEAT_ISSUE -> "반복되는지 지켜보기";
            case REPLY_TO_CUSTOMER -> "고객에게 답변";
            case CONTACT_CUSTOMER -> "고객에게 따로 연락";
            case REFUND_OR_COMPENSATION -> "환불·보상 검토";
            case CANCEL_OR_EXCHANGE -> "취소·교환 검토";
            case ADD_KNOWLEDGE -> "회사 지식 보충";
            case REVIEW_PRODUCT_LISTING -> "상품 정보 점검";
        };
    }

    private static List<String> strings(String json) {
        if (json == null || json.isBlank()) {
            return List.of();
        }
        try {
            return MAPPER.readValue(json, new TypeReference<List<String>>() { });
        } catch (Exception e) {
            return List.of();
        }
    }

    private static String cap(String text) {
        if (text == null) {
            return null;
        }
        return text.length() > MAX_BODY ? text.substring(0, MAX_BODY) + "…" : text;
    }

    private static String json(Object value) {
        try {
            return MAPPER.writeValueAsString(value);
        } catch (Exception e) {
            return null;
        }
    }
}
