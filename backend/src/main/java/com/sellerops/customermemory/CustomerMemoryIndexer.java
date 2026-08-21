package com.sellerops.customermemory;

import com.sellerops.inquiry.Inquiry;
import com.sellerops.inquiry.InquiryRepository;
import com.sellerops.itemanalysis.ItemAnalysis;
import com.sellerops.itemanalysis.ItemAnalysisRepository;
import com.sellerops.review.Review;
import com.sellerops.review.ReviewRepository;
import com.sellerops.inquirysignal.InquirySignature;
import com.sellerops.inquirysignal.InquirySignatureService;
import com.sellerops.reviewissue.IssueSignature;
import com.sellerops.reviewissue.IssueSignatureExtractor;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.Comparator;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.function.Function;
import java.util.stream.Collectors;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Writes the customer-memory index from rows an ingest just inserted.
 *
 * <p><b>It classifies nothing of its own.</b> Every vocabulary it stores is owned elsewhere:
 * {@code topic} is copied from the {@code item_analyses} row that
 * {@link com.sellerops.ingest.IngestFollowUp} writes immediately before calling here, a review's
 * {@code signature_key} comes from the {@link IssueSignatureExtractor} port the review issue memory
 * uses, and an inquiry's comes from {@link InquirySignatureService}. Re-deriving any of them here would
 * create a second definition of the same judgement, which is the failure this package exists downstream
 * of, not upstream of.
 *
 * <p><b>Why the inquiry axis has its own extractor.</b> Measured on the demo org 2026-08-21: the
 * deterministic review extractor produced a signature for 0 of 3,220 real inquiries. The diagnosis is
 * not new — {@code contracts/review-eval/naver/v1/RUBRIC.md} recorded it as surface-form rigidity — and
 * an inquiry is mostly not a complaint anyway ("교환 가능한가요?" has no problem in it). So the review
 * extractor still answers for reviews, unchanged, and the inquiry axis asks a semantic classifier whose
 * output is two closed-vocabulary labels. When that capability is off, an inquiry's signature is null,
 * which is exactly what it was before.
 *
 * <p><b>Idempotent.</b> Indexing the same source id twice updates the existing row rather than adding
 * one — enforced both here (probe first) and by {@code uq_customer_memory_entries_source}. A replayed
 * upload or a re-run sync therefore cannot inflate a repeated-inquiry count.
 *
 * <p><b>Customer text passes through and is not kept.</b> A body is read to extract a signature and is
 * then discarded; no column on {@link CustomerMemoryEntry} can hold it. Nothing here is logged beyond
 * counts.
 */
@Service
public class CustomerMemoryIndexer {

    private static final Logger log = LoggerFactory.getLogger(CustomerMemoryIndexer.class);

    /** Matches {@code ItemAnalysisService}'s stored source types. */
    private static final String SOURCE_REVIEW = "REVIEW";
    private static final String SOURCE_INQUIRY = "INQUIRY";

    private static final String ANSWERED_STATUS = "ANSWERED";

    /** Ceiling on one backfill pass, matching {@code ItemAnalysisService.MAX_BACKFILL_LIMIT}. */
    private static final int MAX_BACKFILL_LIMIT = 1000;

    private final CustomerMemoryEntryRepository entries;
    private final ReviewRepository reviews;
    private final InquiryRepository inquiries;
    private final ItemAnalysisRepository analyses;
    private final IssueSignatureExtractor extractor;
    /**
     * The inquiry axis's classifier. Nullable so the review-only test wiring does not have to stand up
     * the model stack — the same convention {@code SyncRunExecutor} uses for its optional collaborators.
     * Null (or disabled) leaves an inquiry's signature null, which is the pre-v2 behaviour.
     */
    private final InquirySignatureService inquirySignatures;

    /** Full production wiring. Explicitly annotated because a second constructor now exists. */
    @org.springframework.beans.factory.annotation.Autowired
    public CustomerMemoryIndexer(CustomerMemoryEntryRepository entries, ReviewRepository reviews,
                                 InquiryRepository inquiries, ItemAnalysisRepository analyses,
                                 IssueSignatureExtractor extractor,
                                 InquirySignatureService inquirySignatures) {
        this.entries = entries;
        this.reviews = reviews;
        this.inquiries = inquiries;
        this.analyses = analyses;
        this.extractor = extractor;
        this.inquirySignatures = inquirySignatures;
    }

    /** Review-axis-only wiring (tests). The inquiry signature stays null, as it was before v2. */
    public CustomerMemoryIndexer(CustomerMemoryEntryRepository entries, ReviewRepository reviews,
                                 InquiryRepository inquiries, ItemAnalysisRepository analyses,
                                 IssueSignatureExtractor extractor) {
        this(entries, reviews, inquiries, analyses, extractor, null);
    }

    /** Index reviews by id. Ids outside {@code orgId} are ignored (never trusted from a caller). */
    @Transactional
    public int indexReviews(UUID orgId, List<UUID> reviewIds) {
        if (reviewIds == null || reviewIds.isEmpty()) {
            return 0;
        }
        List<Review> rows = reviews.findByOrgIdAndIdIn(orgId, reviewIds);
        Map<UUID, String> topics = topicsFor(orgId, SOURCE_REVIEW, rows.stream().map(Review::getId).toList());
        Map<UUID, CustomerMemoryEntry> existing =
                existingFor(orgId, CustomerMemoryKind.REVIEW, rows.stream().map(Review::getId).toList());

        int written = 0;
        for (Review row : rows) {
            CustomerMemoryEntry entry = existing.getOrDefault(row.getId(), new CustomerMemoryEntry());
            entry.setOrgId(orgId);
            entry.setEntryKind(CustomerMemoryKind.REVIEW);
            entry.setSourceId(row.getId());
            entry.setChannelId(row.getChannelId());
            entry.setProductId(row.getProductId());
            entry.setTopic(topics.get(row.getId()));
            applySignature(entry, row.getBody());
            entry.setExtractorKind(extractor.kind());
            entry.setExtractorVersion(extractor.version());
            entry.setOccurredOn(dayOf(row.getReceivedAt()));
            // A review is not a question, so "answered" is not a property it has. Stored false rather
            // than nullable so the repeated-inquiry queries never have to reason about a third state.
            entry.setAnswered(false);
            entries.save(entry);
            written++;
        }
        log.info("customer-memory index: kind=REVIEW org={} requested={} indexed={}",
                orgId, reviewIds.size(), written);
        return written;
    }

    /** Index inquiries by id. Ids outside {@code orgId} are ignored. */
    @Transactional
    public int indexInquiries(UUID orgId, List<UUID> inquiryIds) {
        if (inquiryIds == null || inquiryIds.isEmpty()) {
            return 0;
        }
        List<Inquiry> rows = inquiries.findAllById(inquiryIds).stream()
                .filter(q -> orgId.equals(q.getOrgId()))
                .toList();
        Map<UUID, String> topics = topicsFor(orgId, SOURCE_INQUIRY, rows.stream().map(Inquiry::getId).toList());
        Map<UUID, CustomerMemoryEntry> existing =
                existingFor(orgId, CustomerMemoryKind.INQUIRY, rows.stream().map(Inquiry::getId).toList());

        int written = 0;
        for (Inquiry row : rows) {
            CustomerMemoryEntry entry = existing.getOrDefault(row.getId(), new CustomerMemoryEntry());
            entry.setOrgId(orgId);
            entry.setEntryKind(CustomerMemoryKind.INQUIRY);
            entry.setSourceId(row.getId());
            entry.setChannelId(row.getChannelId());
            entry.setProductId(row.getProductId());
            entry.setTopic(topics.get(row.getId()));
            // Title and body together: an inquiry's problem word is as often in the subject as in the
            // body ("접착 불량 문의" / "붙였는데 떨어져요"), and the extractor splits on clause endings
            // so joining them cannot fuse two clauses into one unit.
            applyInquirySignature(orgId, entry,
                    com.sellerops.inquirysignal.InquiryText.forClassification(row.getTitle(), row.getBody()));
            entry.setOccurredOn(dayOf(row.getReceivedAt()));
            entry.setAnswered(ANSWERED_STATUS.equalsIgnoreCase(row.getStatus()));
            entries.save(entry);
            written++;
        }
        log.info("customer-memory index: kind=INQUIRY org={} requested={} indexed={}",
                orgId, inquiryIds.size(), written);
        return written;
    }

    /**
     * Bounded, idempotent backfill over rows that are ALREADY STORED — the operator trigger this index
     * was missing, and without which the capability is unreachable for every existing seller.
     *
     * <p><b>Why a backfill is required rather than optional.</b> The index is written by
     * {@link com.sellerops.ingest.IngestFollowUp} at ingest time, and ingest is idempotent by design: a
     * re-collection of already-collected data inserts nothing, so {@code insertedIds} is empty and the
     * follow-up correctly does nothing. That means <b>no amount of re-collecting can populate this index
     * for data collected before it existed</b> — proven on the demo org 2026-08-21, where 7,136 real
     * customer utterances left the index at 0 after a full re-derivation of everything else. An index
     * that only a future ingest can fill is the same shape of defect as an analysis that only the upload
     * path triggers (audit defect B): the code works and the capability is dead.
     *
     * <p><b>It is the third member of a trio, not a new idea.</b> {@code /api/item-analysis/backfill} and
     * {@code /api/review-issues/extract} are the other two, and this follows their contract exactly:
     * manual (nothing runs on deploy), bounded by {@code limit}, paged by a stable total order, and
     * idempotent by key — so paging needs no server-side bookmark and a re-run is cheap rather than
     * incorrect. Page until {@code scanned < limit}.
     *
     * <p>One corpus per call ({@code kind}), so a caller walks reviews and inquiries independently and
     * neither walk can be disturbed by the other growing.
     */
    @Transactional
    public BackfillResult backfill(UUID orgId, CustomerMemoryKind kind, int limit, int page) {
        int safeLimit = Math.min(Math.max(limit, 1), MAX_BACKFILL_LIMIT);
        var pageable = org.springframework.data.domain.PageRequest.of(Math.max(page, 0), safeLimit);

        // ONE corpus per call, chosen by the caller — the same shape /api/review-issues/extract has.
        // An earlier draft walked both in one call and had to guess where the review pages ended to
        // offset the inquiry pages; that arithmetic is exactly the kind that is right until the corpus
        // grows between two calls. Two independent walks have no such seam.
        if (kind == CustomerMemoryKind.REVIEW) {
            List<Review> batch = reviews.findForIssueExtraction(orgId, pageable);
            int indexed = indexReviews(orgId, batch.stream().map(Review::getId).toList());
            log.info("customer-memory backfill org={} kind=REVIEW page={} scanned={} indexed={}",
                    orgId, page, batch.size(), indexed);
            return new BackfillResult(batch.size(), indexed, 0);
        }
        List<Inquiry> batch = inquiries.findForMemoryIndexing(orgId, pageable);
        int indexed = indexInquiries(orgId, batch.stream().map(Inquiry::getId).toList());
        log.info("customer-memory backfill org={} kind=INQUIRY page={} scanned={} indexed={}",
                orgId, page, batch.size(), indexed);
        return new BackfillResult(batch.size(), 0, indexed);
    }

    /** One bounded pass over one corpus. {@code scanned < limit} means that corpus is exhausted. */
    public record BackfillResult(int scanned, int indexedReviews, int indexedInquiries) {
    }

    /**
     * The strongest signature in a body, or none.
     *
     * <p>"Strongest" = highest severity, then earliest unit — a body that says both 배송:지연 and
     * 접착:탈락 is indexed under the one an operator would act on first. Secondary signatures are
     * deliberately not stored: the issue memory ({@code review_issue_evidence}) already keeps every
     * unit of every review, and duplicating that here would make two tables answer "what is wrong
     * with this review" differently the first time either drifted.
     */
    private void applySignature(CustomerMemoryEntry entry, String body) {
        Optional<IssueSignature> strongest = extractor.extract(body == null ? "" : body).stream()
                .filter(IssueSignatureExtractor.ExtractedUnit::isMatched)
                .max(Comparator
                        .comparing((IssueSignatureExtractor.ExtractedUnit u) -> u.signature().severity())
                        .thenComparing(u -> -u.ordinal()))
                .map(IssueSignatureExtractor.ExtractedUnit::signature);
        entry.setSignatureKey(strongest.map(IssueSignature::signatureKey).orElse(null));
        entry.setSeverity(strongest.map(s -> s.severity().name()).orElse(null));
    }

    /**
     * The inquiry axis: a semantic signature when the capability is on, nothing when it is not.
     *
     * <p><b>No fallback to the review extractor.</b> It was measured at 0/3,220 on this very corpus, so
     * "fall back to the rules" would mean "fall back to nothing" while recording RULE_BASED provenance —
     * a row that claims to have been classified by something that classified nothing. Null with no
     * extractor stamp is the honest state.
     *
     * <p>The topic column keeps whatever {@code item_analyses} said, independently: the two answer
     * different questions and a semantic signature does not overwrite a stored analysis.
     */
    private void applyInquirySignature(UUID orgId, CustomerMemoryEntry entry, String text) {
        if (inquirySignatures == null || !inquirySignatures.isEnabledFor(orgId)) {
            entry.setSignatureKey(null);
            entry.setSeverity(null);
            return;
        }
        Optional<InquirySignature> signature = inquirySignatures.signatureFor(orgId, text);
        entry.setSignatureKey(signature.map(InquirySignature::signatureKey).orElse(null));
        entry.setSeverity(signature.map(s -> s.severity().name()).orElse(null));
        if (signature.isPresent()) {
            entry.setExtractorKind(inquirySignatures.extractorKind());
            entry.setExtractorVersion(inquirySignatures.extractorVersion());
        }
    }

    private Map<UUID, String> topicsFor(UUID orgId, String sourceType, List<UUID> sourceIds) {
        if (sourceIds.isEmpty()) {
            return Map.of();
        }
        return analyses.findByOrgIdAndSourceTypeAndSourceIdIn(orgId, sourceType, sourceIds).stream()
                .collect(Collectors.toMap(ItemAnalysis::getSourceId, ItemAnalysis::getCategory,
                        (a, b) -> a, HashMap::new));
    }

    private Map<UUID, CustomerMemoryEntry> existingFor(UUID orgId, CustomerMemoryKind kind, List<UUID> ids) {
        if (ids.isEmpty()) {
            return Map.of();
        }
        return entries.findByOrgIdAndEntryKindAndSourceIdIn(orgId, kind, ids).stream()
                .collect(Collectors.toMap(CustomerMemoryEntry::getSourceId, Function.identity(),
                        (a, b) -> a, HashMap::new));
    }

    private static String join(String title, String body) {
        String t = title == null ? "" : title.trim();
        String b = body == null ? "" : body.trim();
        if (t.isEmpty()) {
            return b;
        }
        // A sentence-ending period so the splitter treats the subject as its own opinion unit rather
        // than letting it run into the first clause of the body.
        return t.endsWith(".") ? t + " " + b : t + ". " + b;
    }

    /**
     * The source row's calendar day in UTC — the same convention {@code ReviewSegmentIngestedEvent}
     * and {@code review_issue_evidence.occurred_on} already use, so a window computed over one index
     * lines up with a window computed over the other.
     */
    private static LocalDate dayOf(java.time.Instant instant) {
        return instant == null ? LocalDate.now(ZoneOffset.UTC) : instant.atZone(ZoneOffset.UTC).toLocalDate();
    }
}
