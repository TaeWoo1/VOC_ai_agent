package com.sellerops.ingest;

import com.sellerops.community.Cafe24CommunityArticle;
import com.sellerops.community.Cafe24CommunityArticleRepository;
import com.sellerops.community.CommunityReplyStatus;
import com.sellerops.community.CommunitySourceKind;
import com.sellerops.ingest.canonical.CanonicalCommunityArticle;
import com.sellerops.ingest.canonical.CanonicalInquiry;
import com.sellerops.ingest.canonical.CanonicalOrderSummary;
import com.sellerops.ingest.canonical.CanonicalReview;
import com.sellerops.ingest.map.RowError;
import com.sellerops.channel.Channel;
import com.sellerops.channel.ChannelRepository;
import com.sellerops.inquiry.Inquiry;
import com.sellerops.inquiry.InquiryRepository;
import com.sellerops.inquiry.workitem.InquiryWorkItemWriter;
import com.sellerops.order.OrderDailySummary;
import com.sellerops.order.OrderDailySummaryRepository;
import com.sellerops.product.Product;
import com.sellerops.product.ProductService;
import com.sellerops.review.Review;
import com.sellerops.review.ReviewReplyState;
import com.sellerops.review.ReviewRepository;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Optional;
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
 * Cafe24 community articles upsert by their natural key with a hash guard.
 */
@Service
public class IngestionService {

    private final ReviewRepository reviews;
    private final InquiryRepository inquiries;
    private final OrderDailySummaryRepository orderSummaries;
    private final ProductService productService;
    private final Cafe24CommunityArticleRepository communityArticles;
    private final ChannelRepository channels;
    /**
     * Required, non-null. Writes the atomic (inquiry + OPEN work item + audit) unit
     * for connector inquiries. Whether a work item is opened is decided solely by
     * the presence of a {@code sellerAccountId} (the exact connection) — never by
     * whether this collaborator is wired.
     */
    private final InquiryWorkItemWriter workItemWriter;

    public IngestionService(ReviewRepository reviews, InquiryRepository inquiries,
                            OrderDailySummaryRepository orderSummaries, ProductService productService,
                            Cafe24CommunityArticleRepository communityArticles, ChannelRepository channels,
                            InquiryWorkItemWriter workItemWriter) {
        this.reviews = reviews;
        this.inquiries = inquiries;
        this.orderSummaries = orderSummaries;
        this.productService = productService;
        this.communityArticles = communityArticles;
        this.channels = channels;
        this.workItemWriter = workItemWriter;
    }

    public IngestOutcome ingestReviews(UUID orgId, UUID channelId, List<CanonicalReview> rows) {
        Tally tally = new Tally();
        Set<String> seen = new HashSet<>();
        // Resolve the channel's dedup-key formula version once per batch (not per row).
        int keyVersion = ReviewDedupKey.versionFor(
                channels.findById(channelId).map(Channel::getCode).orElse(null));
        for (CanonicalReview row : rows) {
            try {
                Product product = productService.resolveOrCreate(orgId, row.productName(), row.sku());
                boolean hasExternal = isPresent(row.externalId());
                String hash = hasExternal ? null
                        : ReviewDedupKey.contentHash(keyVersion, channelId, product.getId(),
                        datePart(row.receivedAt()), row.body(), row.rating());
                String token = hasExternal ? "ext:" + row.externalId() : "hash:" + hash;

                // A duplicate — whether of a stored row or of an earlier row in THIS file — is still
                // skipped, but it is not silent: it may carry a reply statement the row we kept did
                // not. An export that lists the same 리뷰글번호 twice, N then Y, must not leave the
                // review looking unanswered; that is the duplicate-public-reply path this exists to
                // close, and it does not care which side of a file boundary the two rows sat on.
                boolean firstInBatch = seen.add(token);
                Review existing = row.replyState() == ReviewReplyState.UNKNOWN
                        ? null   // nothing to learn — never pay for the lookup
                        : findReview(orgId, channelId, hasExternal, row.externalId(), hash);
                if (existing != null) {
                    refreshReplyState(existing, row);
                    tally.skip();
                    continue;
                }
                if (!firstInBatch || existsReview(orgId, channelId, hasExternal, row.externalId(), hash)) {
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
                entity.setDedupKeyVersion(keyVersion);
                entity.setReplyState(row.replyState());
                entity.setRepliedAt(row.repliedAt());
                trySave(tally, row.sourceRow(),
                        () -> reviews.save(entity).getId(),
                        () -> existsReview(orgId, channelId, hasExternal, row.externalId(), hash));
            } catch (Exception e) {
                tally.fail(row.sourceRow(), "처리 실패: " + e.getMessage());
            }
        }
        return tally.toOutcome();
    }

    /**
     * File-upload / legacy path: ingest inquiries with <b>no</b> seller-connection
     * identity, so no work item is opened (a bare {@code channelId} is not the exact
     * connection). Delegates with a {@code null} {@code sellerAccountId}.
     */
    public IngestOutcome ingestInquiries(UUID orgId, UUID channelId, List<CanonicalInquiry> rows) {
        return ingestInquiries(orgId, channelId, null, rows);
    }

    /**
     * Connector path: ingest inquiries for a specific seller connection. A work item
     * is opened only for an <b>actionable</b> inquiry — a non-null {@code
     * sellerAccountId} (the exact connection) <em>and</em> canonical status {@code
     * UNANSWERED}. Each such newly inserted (non-duplicate) inquiry atomically opens
     * exactly one OPEN work item bound to that connection plus a WORK_ITEM_OPENED
     * audit — inquiry, work item, and audit commit or roll back together.
     *
     * <p>An already-{@code ANSWERED} inquiry (e.g. Cafe24 {@code reply_status=C}
     * 처리완료) is persisted as Inquiry <b>history</b> but opens <b>no</b> OPEN seller
     * task — it is not actionable. This is channel-neutral: ESM ingests only 미처리
     * (UNANSWERED) inquiries, and the file-upload / legacy path ({@code
     * sellerAccountId == null}) never opens a work item regardless of status.
     *
     * <p>Buyer PII is not persisted: {@code author} is deliberately never written.
     */
    public IngestOutcome ingestInquiries(UUID orgId, UUID channelId, UUID sellerAccountId,
                                         List<CanonicalInquiry> rows) {
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
                entity.setSellerAccountId(sellerAccountId);
                entity.setProductId(product.getId());
                // Buyer PII (row.author()) is intentionally NOT persisted.
                entity.setTitle(row.title());
                entity.setBody(row.body());
                entity.setStatus(row.status());
                entity.setInformStatus(row.informStatus());
                entity.setReceivedAt(row.receivedAt() != null ? row.receivedAt() : Instant.now());
                entity.setExternalId(hasExternal ? row.externalId() : null);
                entity.setContentHash(hash);
                // A work item is a seller task: open one only for an actionable
                // (UNANSWERED) inquiry on an exact connection. Already-answered
                // inquiries are stored as history without opening a task.
                boolean openWorkItem =
                        sellerAccountId != null && "UNANSWERED".equals(entity.getStatus());
                trySave(tally, row.sourceRow(),
                        () -> openWorkItem
                                ? workItemWriter.openConnectorInquiry(entity, sellerAccountId)
                                : inquiries.save(entity).getId(),
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
     * Upsert Cafe24 community board articles into their dedicated store, keyed by the
     * natural key {@code (channel, seller account, board, article)}. New articles
     * insert; an existing article updates in place only when its {@code source_hash}
     * (over title/content/rating/reply_status) changed; an unchanged hash is a no-op
     * skip. Raw {@code sourceKind}/{@code replyStatus} tokens are normalized to their
     * closed sets here, so only canonical values land. {@code insertedIds} holds only
     * genuinely new rows (updates count as success but contribute no id).
     */
    public IngestOutcome ingestCommunityArticles(UUID orgId, UUID channelId, UUID sellerAccountId,
                                                 List<CanonicalCommunityArticle> rows) {
        Tally tally = new Tally();
        Set<String> seen = new HashSet<>();
        for (CanonicalCommunityArticle row : rows) {
            try {
                // Same article twice in one batch: natural-key dedupe within the batch.
                if (!seen.add(row.boardNo() + ":" + row.articleNo())) {
                    tally.skip();
                    continue;
                }
                CommunitySourceKind kind = CommunitySourceKind.normalize(row.sourceKind());
                CommunityReplyStatus reply = CommunityReplyStatus.normalize(row.replyStatus());
                String hash = communitySourceHash(row.title(), row.content(), row.rating(), reply);

                Optional<Cafe24CommunityArticle> existing = communityArticles
                        .findByChannelIdAndSellerAccountIdAndBoardNoAndArticleNo(
                                channelId, sellerAccountId, row.boardNo(), row.articleNo());
                if (existing.isPresent()) {
                    Cafe24CommunityArticle entity = existing.get();
                    if (hash.equals(entity.getSourceHash())) {
                        // Nothing mutable changed — no-op.
                        tally.skip();
                        continue;
                    }
                    applyMutable(entity, kind, reply, row, hash);
                    communityArticles.save(entity);
                    tally.update();
                    continue;
                }

                Cafe24CommunityArticle entity = new Cafe24CommunityArticle();
                entity.setOrgId(orgId);
                entity.setSellerAccountId(sellerAccountId);
                entity.setChannelId(channelId);
                entity.setBoardNo(row.boardNo());
                entity.setArticleNo(row.articleNo());
                entity.setProductNo(row.productNo());
                entity.setSourceCreatedAt(row.sourceCreatedAt());
                applyMutable(entity, kind, reply, row, hash);
                trySave(tally, row.sourceRow(),
                        () -> communityArticles.save(entity).getId(),
                        () -> communityArticles.findByChannelIdAndSellerAccountIdAndBoardNoAndArticleNo(
                                channelId, sellerAccountId, row.boardNo(), row.articleNo()).isPresent());
            } catch (Exception e) {
                tally.fail(row.sourceRow(), "처리 실패: " + e.getMessage());
            }
        }
        return tally.toOutcome();
    }

    /** Write the mutable (source-driven) fields plus the refreshed hash and collect time. */
    private void applyMutable(Cafe24CommunityArticle entity, CommunitySourceKind kind,
                              CommunityReplyStatus reply, CanonicalCommunityArticle row, String hash) {
        entity.setSourceKind(kind.name());
        entity.setReplyStatus(reply.name());
        entity.setTitle(row.title());
        entity.setContent(row.content());
        entity.setRating(row.rating());
        entity.setSourceUpdatedAt(row.sourceUpdatedAt());
        entity.setSourceHash(hash);
        entity.setCollectedAt(Instant.now());
    }

    /** Stable fingerprint over the mutable fields; an unchanged hash means a no-op upsert. */
    private String communitySourceHash(String title, String content, Integer rating,
                                       CommunityReplyStatus reply) {
        return ContentHash.of(title, content,
                rating == null ? "" : Integer.toString(rating), reply.name());
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

    /** The already-stored row this canonical row dedups against, or null when it is new. */
    private Review findReview(UUID orgId, UUID channelId, boolean hasExternal,
                              String externalId, String hash) {
        return (hasExternal
                ? reviews.findByOrgIdAndChannelIdAndExternalId(orgId, channelId, externalId)
                : reviews.findByOrgIdAndChannelIdAndContentHash(orgId, channelId, hash))
                .orElse(null);
    }

    /**
     * A duplicate row still carries NEWS: whether the channel now reports the review as answered.
     * Without this, reply state would freeze at first import — and the SECOND export is exactly
     * where it changes, so the feature would be stale within days of shipping.
     *
     * <p><b>Field-scoped, deliberately.</b> Only {@code reply_state} and {@code replied_at} are ever
     * written here. Body, rating, date, product, external id and hashes are never touched by a
     * duplicate: dedup means "we already have this review", and a re-export must not be able to
     * rewrite the content we stored the first time.
     *
     * <p><b>Monotonic</b> ({@link ReviewReplyState#isProgress}): an import may report a review as
     * answered, or report a previously-unknown one as still unanswered; it may never un-answer a
     * review a prior import reported as answered. The realistic regression is a stale re-upload,
     * which would re-inflate the queue and re-arm duplicate public replies.
     *
     * <p>The row still counts as {@code skipped}: dedup semantics, the ingest counts, and every
     * caller that reads them are unchanged.
     */
    private void refreshReplyState(Review existing, CanonicalReview row) {
        boolean stateAdvances = ReviewReplyState.isProgress(existing.getReplyState(), row.replyState());
        // The date can arrive AFTER the state it belongs to: an export may report ANSWERED with a
        // blank or unparseable 답글등록일시, and a later one supply it. Gating the date on the state
        // moving would make it permanently unlearnable in exactly that case, so it is filled
        // whenever it is still missing — and never overwritten, so a null can't erase what we have.
        boolean dateArrives = row.repliedAt() != null && existing.getRepliedAt() == null
                && (stateAdvances || existing.getReplyState() == row.replyState());
        if (!stateAdvances && !dateArrives) {
            return;
        }
        if (stateAdvances) {
            existing.setReplyState(row.replyState());
        }
        if (dateArrives) {
            existing.setRepliedAt(row.repliedAt());
        }
        reviews.save(existing);
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

        /** A successful in-place update: counts as success, contributes no inserted id. */
        void update() {
            success++;
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
