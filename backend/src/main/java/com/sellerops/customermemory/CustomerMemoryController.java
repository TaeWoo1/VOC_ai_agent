package com.sellerops.customermemory;

import com.sellerops.auth.AuthPrincipal;
import com.sellerops.common.ApiException;
import com.sellerops.customermemory.dto.CustomerMemorySearchView;
import com.sellerops.customermemory.dto.RepeatedInquiryView;
import java.time.LocalDate;
import java.time.format.DateTimeParseException;
import java.util.List;
import java.util.UUID;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * The customer-memory read surface: recall, and repeats.
 *
 * <p><b>There is no free-text parameter on this controller and that is the design.</b> Recall is
 * driven either by an inquiry id (the cue is read from that inquiry's own index row) or by
 * closed-vocabulary values. A {@code ?q=} over customer text is what scope lock v1.12 explicitly did
 * not open, and leaving the parameter out is a stronger guarantee than validating it.
 *
 * <p>Read-only, org-scoped from the principal, and it writes nothing — indexing happens on the ingest
 * path ({@code IngestFollowUp}), never from a request.
 */
@RestController
@RequestMapping("/api/customer-memory")
public class CustomerMemoryController {

    private final CustomerMemoryQueryService query;
    private final RepeatedInquiryService repeats;
    private final CustomerMemoryIndexer indexer;

    public CustomerMemoryController(CustomerMemoryQueryService query, RepeatedInquiryService repeats,
                                    CustomerMemoryIndexer indexer) {
        this.query = query;
        this.repeats = repeats;
        this.indexer = indexer;
    }

    /**
     * Precedents for one inquiry, or for an explicit closed-vocabulary cue.
     *
     * @param inquiryId when present, the cue is read from this inquiry's own index row and the
     *     inquiry itself is excluded from its own precedents
     * @param productId a legitimate cue ON ITS OWN — "what have we seen about this product". It is an
     *     id, not customer text, so admitting it opens nothing the fence closes; refusing it (as this
     *     route did until 2026-08-21) made a product-scoped recall a 400, and the Operator's
     *     CUSTOMER_HISTORY need failed on a live run because of it
     */
    @GetMapping("/search")
    public CustomerMemorySearchView search(@AuthenticationPrincipal AuthPrincipal principal,
                                           @RequestParam(required = false) UUID inquiryId,
                                           @RequestParam(required = false) String signatureKey,
                                           @RequestParam(required = false) String topic,
                                           @RequestParam(required = false) UUID productId,
                                           @RequestParam(defaultValue = "5") int limit) {
        if (inquiryId != null) {
            return query.recallForInquiry(principal.orgId(), inquiryId, limit);
        }
        if ((signatureKey == null || signatureKey.isBlank())
                && (topic == null || topic.isBlank())
                && productId == null) {
            throw ApiException.badRequest("조회 기준이 필요합니다 (inquiryId, signatureKey/topic, 또는 productId).");
        }
        return query.search(principal.orgId(), signatureKey, topic, productId, null, limit);
    }

    /** Repeated customer questions in a trailing window. */
    @GetMapping("/repeats")
    public List<RepeatedInquiryView> repeats(@AuthenticationPrincipal AuthPrincipal principal,
                                             @RequestParam(required = false) String referenceDate,
                                             @RequestParam(defaultValue = "28") int windowDays) {
        return repeats.repeats(principal.orgId(), parseDate(referenceDate), windowDays);
    }

    /**
     * Bounded, idempotent backfill over already-stored rows — the third member of the trio
     * {@code /api/item-analysis/backfill} and {@code /api/review-issues/extract} already form.
     *
     * <p><b>It is not an optional convenience.</b> The index is written at ingest, and ingest is
     * idempotent, so a re-collection of already-collected data inserts nothing and populates nothing.
     * Without this route the capability is permanently empty for every seller whose data predates it —
     * measured on the demo org 2026-08-21: 7,136 real utterances, index 0, and no re-collection could
     * change that. It reads only rows this backend already holds; it touches no marketplace.
     *
     * <p>Walk each corpus separately: {@code kind=REVIEW} then {@code kind=INQUIRY}, incrementing
     * {@code page} until {@code scanned < limit}. Idempotent by key, so paging needs no bookmark.
     */
    @PostMapping("/backfill")
    public CustomerMemoryIndexer.BackfillResult backfill(@AuthenticationPrincipal AuthPrincipal principal,
                                                         @RequestParam(defaultValue = "REVIEW") String kind,
                                                         @RequestParam(defaultValue = "500") int limit,
                                                         @RequestParam(defaultValue = "0") int page) {
        CustomerMemoryKind parsed;
        try {
            parsed = CustomerMemoryKind.valueOf(kind.toUpperCase(java.util.Locale.ROOT));
        } catch (IllegalArgumentException e) {
            throw ApiException.badRequest("kind는 REVIEW 또는 INQUIRY여야 합니다.");
        }
        return indexer.backfill(principal.orgId(), parsed, limit, page);
    }

    private static LocalDate parseDate(String value) {
        if (value == null || value.isBlank()) {
            return null;
        }
        try {
            return LocalDate.parse(value);
        } catch (DateTimeParseException e) {
            throw ApiException.badRequest("referenceDate 형식이 올바르지 않습니다 (YYYY-MM-DD).");
        }
    }
}
