package com.sellerops.ingest;

import com.sellerops.ingest.canonical.CanonicalInquiry;
import com.sellerops.ingest.canonical.CanonicalOrderSummary;
import com.sellerops.ingest.canonical.CanonicalReview;
import com.sellerops.ingest.map.RowError;
import com.sellerops.inquiry.Inquiry;
import com.sellerops.inquiry.InquiryRepository;
import com.sellerops.order.OrderDailySummary;
import com.sellerops.order.OrderDailySummaryRepository;
import com.sellerops.product.Product;
import com.sellerops.product.ProductService;
import com.sellerops.review.Review;
import com.sellerops.review.ReviewRepository;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.stereotype.Service;

/**
 * Source-agnostic persistence + dedup. Any connector (file upload now, Coupang/
 * Naver later) maps its source into canonical records and calls these methods,
 * so dedup and storage are written once.
 *
 * Persistence is per-row, NOT one batch transaction: each {@code save} runs in
 * its own transaction (Spring Data default), so a single bad/duplicate row
 * cannot roll back rows that already succeeded.
 *
 * A save-time {@link DataIntegrityViolationException} is disambiguated: if the
 * row's dedup key now exists (a concurrent re-upload won the race) it is counted
 * as a duplicate skip; otherwise it is a genuine persistence failure, counted as
 * failed and surfaced via {@link RowError} (keyed by the originating file row).
 *
 * Dedup order per row: external_id when present, else content hash of
 * channel + product + date + body. Order summaries upsert by (channel, date).
 */
@Service
public class IngestionService {

    private final ReviewRepository reviews;
    private final InquiryRepository inquiries;
    private final OrderDailySummaryRepository orderSummaries;
    private final ProductService productService;

    public IngestionService(ReviewRepository reviews, InquiryRepository inquiries,
                            OrderDailySummaryRepository orderSummaries, ProductService productService) {
        this.reviews = reviews;
        this.inquiries = inquiries;
        this.orderSummaries = orderSummaries;
        this.productService = productService;
    }

    public IngestOutcome ingestReviews(UUID orgId, UUID channelId, List<CanonicalReview> rows) {
        Tally tally = new Tally();
        Set<String> seen = new HashSet<>();
        for (CanonicalReview row : rows) {
            try {
                Product product = productService.resolveOrCreate(orgId, row.productName(), row.sku());
                boolean hasExternal = isPresent(row.externalId());
                String hash = hasExternal ? null
                        : ContentHash.of(channelId.toString(), product.getId().toString(),
                        datePart(row.receivedAt()), row.body());
                String token = hasExternal ? "ext:" + row.externalId() : "hash:" + hash;

                if (!seen.add(token) || existsReview(orgId, channelId, hasExternal, row.externalId(), hash)) {
                    tally.skip();
                    continue;
                }

                Review entity = new Review();
                entity.setOrgId(orgId);
                entity.setChannelId(channelId);
                entity.setProductId(product.getId());
                entity.setBody(row.body());
                entity.setRating(row.rating());
                entity.setNegative(row.rating() != null && row.rating() <= 2);
                entity.setReceivedAt(row.receivedAt() != null ? row.receivedAt() : Instant.now());
                entity.setExternalId(hasExternal ? row.externalId() : null);
                entity.setContentHash(hash);
                trySave(tally, row.sourceRow(),
                        () -> reviews.save(entity).getId(),
                        () -> existsReview(orgId, channelId, hasExternal, row.externalId(), hash));
            } catch (Exception e) {
                tally.fail(row.sourceRow(), "처리 실패: " + e.getMessage());
            }
        }
        return tally.toOutcome();
    }

    public IngestOutcome ingestInquiries(UUID orgId, UUID channelId, List<CanonicalInquiry> rows) {
        Tally tally = new Tally();
        Set<String> seen = new HashSet<>();
        for (CanonicalInquiry row : rows) {
            try {
                Product product = productService.resolveOrCreate(orgId, row.productName(), row.sku());
                boolean hasExternal = isPresent(row.externalId());
                String hash = hasExternal ? null
                        : ContentHash.of(channelId.toString(), product.getId().toString(),
                        datePart(row.receivedAt()), row.body());
                String token = hasExternal ? "ext:" + row.externalId() : "hash:" + hash;

                if (!seen.add(token) || existsInquiry(orgId, channelId, hasExternal, row.externalId(), hash)) {
                    tally.skip();
                    continue;
                }

                Inquiry entity = new Inquiry();
                entity.setOrgId(orgId);
                entity.setChannelId(channelId);
                entity.setProductId(product.getId());
                entity.setAuthor(row.author());
                entity.setBody(row.body());
                entity.setStatus(row.status());
                entity.setReceivedAt(row.receivedAt() != null ? row.receivedAt() : Instant.now());
                entity.setExternalId(hasExternal ? row.externalId() : null);
                entity.setContentHash(hash);
                trySave(tally, row.sourceRow(),
                        () -> inquiries.save(entity).getId(),
                        () -> existsInquiry(orgId, channelId, hasExternal, row.externalId(), hash));
            } catch (Exception e) {
                tally.fail(row.sourceRow(), "처리 실패: " + e.getMessage());
            }
        }
        return tally.toOutcome();
    }

    public IngestOutcome ingestOrderSummaries(UUID orgId, UUID channelId, List<CanonicalOrderSummary> rows) {
        Tally tally = new Tally();
        for (CanonicalOrderSummary row : rows) {
            try {
                OrderDailySummary entity = orderSummaries
                        .findByOrgIdAndChannelIdAndSummaryDate(orgId, channelId, row.summaryDate())
                        .orElseGet(OrderDailySummary::new);
                entity.setOrgId(orgId);
                entity.setChannelId(channelId);
                entity.setSummaryDate(row.summaryDate());
                entity.setOrderCount(row.orderCount());
                entity.setSalesAmount(row.salesAmount());
                trySave(tally, row.sourceRow(),
                        () -> orderSummaries.save(entity).getId(),
                        () -> orderSummaries
                                .findByOrgIdAndChannelIdAndSummaryDate(orgId, channelId, row.summaryDate())
                                .isPresent());
            } catch (Exception e) {
                tally.fail(row.sourceRow(), "처리 실패: " + e.getMessage());
            }
        }
        return tally.toOutcome();
    }

    /**
     * Persist one row, recording the new id on success. On a unique-constraint
     * violation, re-probe the dedup key: present ⇒ a concurrent writer won
     * (duplicate skip); absent ⇒ genuine failure.
     */
    private void trySave(Tally tally, int sourceRow, java.util.function.Supplier<UUID> save,
                         java.util.function.BooleanSupplier nowExists) {
        try {
            UUID id = save.get();
            tally.success(id);
        } catch (DataIntegrityViolationException dup) {
            if (nowExists.getAsBoolean()) {
                tally.skip();
            } else {
                tally.fail(sourceRow, "저장 실패: 제약 조건 위반");
            }
        }
    }

    private boolean existsReview(UUID orgId, UUID channelId, boolean hasExternal,
                                 String externalId, String hash) {
        return hasExternal
                ? reviews.existsByOrgIdAndChannelIdAndExternalId(orgId, channelId, externalId)
                : reviews.existsByOrgIdAndChannelIdAndContentHash(orgId, channelId, hash);
    }

    private boolean existsInquiry(UUID orgId, UUID channelId, boolean hasExternal,
                                  String externalId, String hash) {
        return hasExternal
                ? inquiries.existsByOrgIdAndChannelIdAndExternalId(orgId, channelId, externalId)
                : inquiries.existsByOrgIdAndChannelIdAndContentHash(orgId, channelId, hash);
    }

    private boolean isPresent(String s) {
        return s != null && !s.isBlank();
    }

    private String datePart(Instant receivedAt) {
        return receivedAt == null ? "" : receivedAt.toString().substring(0, 10);
    }

    /** Mutable per-call tally that builds an {@link IngestOutcome}. */
    private static final class Tally {
        private int success;
        private int skipped;
        private int failed;
        private final List<RowError> errors = new ArrayList<>();
        private final List<UUID> insertedIds = new ArrayList<>();

        void success(UUID id) {
            success++;
            insertedIds.add(id);
        }

        void skip() {
            skipped++;
        }

        void fail(int sourceRow, String message) {
            failed++;
            errors.add(new RowError(sourceRow, message));
        }

        IngestOutcome toOutcome() {
            return new IngestOutcome(success, skipped, failed, errors, insertedIds);
        }
    }
}
