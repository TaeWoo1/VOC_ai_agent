package com.sellerops.ingest;

import com.sellerops.community.Cafe24CommunityArticle;
import com.sellerops.community.Cafe24CommunityArticleRepository;
import com.sellerops.community.CommunityReplyStatus;
import com.sellerops.community.CommunitySourceKind;
import com.sellerops.ingest.canonical.CanonicalCommunityArticle;
import com.sellerops.ingest.canonical.ChannelOrderRef;
import com.sellerops.ingest.canonical.ChannelProductRef;
import com.sellerops.ingest.canonical.CanonicalInquiry;
import com.sellerops.ingest.canonical.CanonicalOrderSummary;
import com.sellerops.ingest.canonical.CanonicalReview;
import com.sellerops.ingest.map.RowError;
import com.sellerops.channel.Channel;
import com.sellerops.channel.ChannelRepository;
import com.sellerops.inquiry.Inquiry;
import com.sellerops.inquiry.InquiryOrderBinding;
import com.sellerops.inquiry.InquiryProductBinding;
import com.sellerops.inquiry.InquiryRepository;
import com.sellerops.inquiry.lifecycle.InquiryOperationalStateProjector;
import com.sellerops.inquiry.workitem.InquiryWorkItemWriter;
import com.sellerops.order.OrderDailySummary;
import com.sellerops.order.OrderDailySummaryRepository;
import com.sellerops.product.ChannelProduct;
import com.sellerops.product.ChannelProductRepository;
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
import org.springframework.beans.factory.annotation.Autowired;
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

    /**
     * The listing catalogue, used ONLY by the identifier-attribution lane (see
     * {@link ChannelProductRef}). Null when a caller wires the legacy constructor — and a null here
     * fails closed: a row that asks to be attributed by channel identifier is then left unattributed
     * rather than dropped into the name path that creates products.
     */
    private final ChannelProductRepository channelProducts;

    /**
     * The one writer of {@code inquiries.operational_state}, held directly rather than injected.
     *
     * <p>It is a pure function of (row, work item) with no state and no collaborators, and routing it
     * through the container would mean changing every constructor — including the legacy one — to buy
     * nothing. What matters for the fence is that this class asks the projector rather than setting
     * the column, so the single-writer guarantee is unchanged.
     */
    private final InquiryOperationalStateProjector operationalState =
            new InquiryOperationalStateProjector();

    @Autowired
    public IngestionService(ReviewRepository reviews, InquiryRepository inquiries,
                            OrderDailySummaryRepository orderSummaries, ProductService productService,
                            Cafe24CommunityArticleRepository communityArticles, ChannelRepository channels,
                            InquiryWorkItemWriter workItemWriter, ChannelProductRepository channelProducts) {
        this.reviews = reviews;
        this.inquiries = inquiries;
        this.orderSummaries = orderSummaries;
        this.productService = productService;
        this.communityArticles = communityArticles;
        this.channels = channels;
        this.workItemWriter = workItemWriter;
        this.channelProducts = channelProducts;
    }

    /** Legacy wiring: no listing catalogue, so identifier attribution resolves to nothing. */
    public IngestionService(ReviewRepository reviews, InquiryRepository inquiries,
                            OrderDailySummaryRepository orderSummaries, ProductService productService,
                            Cafe24CommunityArticleRepository communityArticles, ChannelRepository channels,
                            InquiryWorkItemWriter workItemWriter) {
        this(reviews, inquiries, orderSummaries, productService, communityArticles, channels,
                workItemWriter, null);
    }

    public IngestOutcome ingestReviews(UUID orgId, UUID channelId, List<CanonicalReview> rows) {
        return ingestReviews(orgId, channelId, rows, null);
    }

    /**
     * As above, stamping each INSERTED row with the run that brought it in ({@code
     * reviews.acquisition_sync_job_id}, V83). {@code acquisitionSyncJobId} is the {@code sync_jobs} row
     * the caller already opened — the file-upload connector opens its run before it parses a byte, so
     * the id exists here. A null stamps nothing; a duplicate (skipped) row keeps whatever it had, so a
     * re-import can never re-attribute a review to a later run.
     */
    public IngestOutcome ingestReviews(UUID orgId, UUID channelId, List<CanonicalReview> rows,
                                       UUID acquisitionSyncJobId) {
        Tally tally = new Tally();
        Set<String> seen = new HashSet<>();
        // The channel's formula, resolved once per batch. The VERSION is then decided per row: a textless
        // review keys on its purchased option (v3) while a review with text keeps the channel's own version.
        // `reviews.dedup_key_version` has always been a per-row column; this is the first source that needs it.
        String channelCode = channels.findById(channelId).map(Channel::getCode).orElse(null);
        for (CanonicalReview row : rows) {
            try {
                Product product = productService.resolveOrCreate(orgId, row.productName(), row.sku());
                boolean hasExternal = isPresent(row.externalId());
                int keyVersion = ReviewDedupKey.versionForRow(channelCode, row.textless());
                String hash = hasExternal ? null
                        : ReviewDedupKey.contentHash(keyVersion, channelId, product.getId(),
                        datePart(row.receivedAt()), row.body(), row.rating(), row.sourceOptionId());
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
                // Source facts, written on INSERT only. They are not part of any dedup key, so a duplicate
                // must not be able to rewrite them either — see refreshReplyState for why a re-import is
                // deliberately allowed to change reply state and nothing else.
                entity.setSourceOptionId(row.sourceOptionId());
                entity.setMediaCount(row.mediaCount());
                // Carried, never derived from the count: `0 / false` is the file-upload path saying
                // nobody asked about media, and `0 / true` would be a reader saying there is none.
                entity.setMediaCountObserved(row.mediaObserved());
                entity.setAcquisitionSyncJobId(acquisitionSyncJobId);
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
     * Stamp the acquisition run on reviews inserted before their run row existed. The Coupang WING
     * handoff records its {@code sync_jobs} row AFTER ingesting (so the row can carry the counts), and
     * this is how those rows still get their provenance in the same request. Idempotent and bounded to
     * the ids the ingest itself returned; an empty list or a null job writes nothing.
     *
     * <p><b>Its own transaction, because the update is a modifying query that flushes.</b> The caller
     * ({@code AgentReviewHandoffService.handOff}) is not transactional — deliberately, so a failure late in a
     * handoff cannot roll back reviews that were already stored — and a {@code flushAutomatically} update with
     * no transaction throws {@code InvalidDataAccessApiUsageException}, which the seller receives as a 500 on
     * a handoff whose rows were already ingested. Measured live 2026-09-12 on the first WING read this branch
     * ever carried: read OK, 9 reviews collected, handoff 500, stored 0. One bounded statement, so its own
     * transaction is also the smallest one that can be correct.
     */
    @org.springframework.transaction.annotation.Transactional
    public int stampAcquisition(UUID orgId, List<UUID> insertedIds, UUID acquisitionSyncJobId) {
        if (acquisitionSyncJobId == null || insertedIds == null || insertedIds.isEmpty()) {
            return 0;
        }
        return reviews.stampAcquisitionSyncJob(orgId, insertedIds, acquisitionSyncJobId);
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
                UUID productId = attributeProduct(orgId, channelId, row);
                boolean hasExternal = isPresent(row.externalId());
                String hash = hasExternal ? null
                        : ContentHash.of(channelId.toString(), String.valueOf(productId),
                        datePart(row.receivedAt()), row.body());
                String token = hasExternal ? "ext:" + row.externalId() : "hash:" + hash;

                // Same key twice within one page → duplicate skip (batch-level dedup).
                if (!seen.add(token)) {
                    tally.skip();
                    continue;
                }

                // Source-aware upsert on the external-id key: a re-collected inquiry whose
                // title/body/reply-status changed updates the stored row in place instead of
                // being skipped, so the platform's latest state is reflected. Non-external
                // (file-upload) rows keep the content-hash insert-or-skip.
                if (hasExternal) {
                    Optional<Inquiry> existingOpt = inquiries
                            .findByOrgIdAndChannelIdAndExternalId(orgId, channelId, row.externalId());
                    if (existingOpt.isPresent()) {
                        Inquiry existing = existingOpt.get();
                        if (sourceUnchanged(existing, row)) {
                            // Nothing about the inquiry changed — but the SOURCE STILL SHOWED IT TO US,
                            // and that is a different fact from silence. Before this line an unchanged
                            // row and a deleted row left exactly the same trace (none), which is why no
                            // absence-based reconciliation could be built on top of this path. Recording
                            // it costs one column write; not recording it costs the distinction.
                            existing.setLastSeenAt(Instant.now());
                            // The row's CONTENT is unchanged, but our catalogue may not be: a listing
                            // collected since the last read can attribute a row that arrived before it
                            // existed. This branch already writes, so the repair is free here and
                            // would otherwise never happen for a backlog that never changes again.
                            repairAttribution(existing, row, productId);
                            applyThreadRole(existing, row);
                            // Same reasoning as the attribution repair above: the CONTENT is
                            // unchanged, but a work item left mid-workflow on an already-answered row
                            // is a lifecycle the source has already settled. This branch writes
                            // anyway, so the reconcile is free here — and for a backlog row that
                            // never changes again, this is the only place it could ever happen.
                            reconcileAnsweredElsewhere(existing, sellerAccountId);
                            tally.skip();
                            continue;
                        }
                        applyInquirySource(existing, row);
                        repairAttribution(existing, row, productId);
                        applyThreadRole(existing, row);
                        existing.setLastSeenAt(Instant.now());
                        // Answered NOW, not "answered as of this sweep". The transition-only form
                        // could never close a row that turned ANSWERED while its work item sat in
                        // PROPOSED, because that row's next sweep is no longer a transition.
                        reconcileAnsweredElsewhere(existing, sellerAccountId);
                        tally.update();
                        continue;
                    }
                } else if (existsInquiry(orgId, channelId, false, null, hash)) {
                    tally.skip();
                    continue;
                }

                Inquiry entity = new Inquiry();
                entity.setOrgId(orgId);
                entity.setChannelId(channelId);
                entity.setSellerAccountId(sellerAccountId);
                entity.setProductId(productId);
                entity.setProductBinding(
                        productId == null ? null : InquiryProductBinding.SOURCE_EXACT.name());
                entity.setSourceSubtype(row.sourceSubtype());
                entity.setSourceProductRef(sourceProductRef(row));
                applyOrderRef(entity, row);
                applyThreadRole(entity, row);
                // Buyer PII (row.author()) is intentionally NOT persisted.
                applyInquirySource(entity, row);
                entity.setReceivedAt(row.receivedAt() != null ? row.receivedAt() : Instant.now());
                entity.setExternalId(hasExternal ? row.externalId() : null);
                entity.setContentHash(hash);
                entity.setLastSeenAt(Instant.now());
                // A work item is a seller task: open one only for an actionable
                // (UNANSWERED) inquiry on an exact connection. Already-answered
                // inquiries are stored as history without opening a task — and a row the SOURCE says
                // is a reply inside a thread is not a customer's question at all, so it never becomes
                // one either. Opening it and excluding it afterwards would leave a task in the ledger
                // that no one ever has to do.
                boolean openWorkItem = sellerAccountId != null
                        && "UNANSWERED".equals(entity.getStatus())
                        && entity.getOperationalState().isActive();
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

    /** The channel's own product identifier, for sources that declare one. Null for the rest. */
    private static String sourceProductRef(CanonicalInquiry row) {
        ChannelProductRef ref = row.productRef();
        return ref == null ? null : ref.externalProductId();
    }

    /**
     * Record which order the CHANNEL said this inquiry is about — verbatim, or not at all.
     *
     * <p><b>Two absences, and only one of them clears anything.</b> A {@code null} ref means the
     * source declares no order lane (file upload, ESM, NAVER 상품 문의): it says nothing about this
     * row's order and must not erase what another read established. A {@link ChannelOrderRef#absent()}
     * means the source HAS the lane and this article carried no order — a positive statement, and the
     * one that clears a stale binding.
     *
     * <p>There is no merge and no precedence here because there is no second lane to lose to — see
     * {@link InquiryOrderBinding}. What the channel last said is what is stored.
     */
    private static void applyOrderRef(Inquiry entity, CanonicalInquiry row) {
        ChannelOrderRef ref = row.orderRef();
        if (ref == null) {
            return;
        }
        String reference = ref.preferredRef();
        entity.setSourceOrderRef(reference);
        entity.setOrderBinding(reference == null ? null : InquiryOrderBinding.SOURCE_EXACT.name());
    }

    /**
     * On re-collection, fill an attribution that was missing — and only that.
     *
     * <p>A row can be stored unattributed for a reason that later stops being true: the listing was
     * not in {@code channel_products} when the inquiry arrived, and a catalogue read has since put it
     * there. Re-reading the inquiry is when that becomes knowable, so this is where the repair
     * belongs. It never <em>changes</em> an existing attribution: a product id that is already set was
     * either matched exactly or corrected by hand, and a later read is not evidence against either.
     * The source ref is always refreshed, because it is a verbatim record of what the source just
     * said rather than a judgement about it.
     *
     * <p><b>A person's answer is not overwritten either.</b> A {@code USER_CONFIRMED} binding fails
     * the null check above and is left exactly where it is, even when the source later supplies an
     * identifier that resolves elsewhere. That disagreement stays visible — {@code source_product_ref}
     * sits beside {@code product_id} and says what the channel claimed — rather than being settled by
     * whichever collection ran last.
     */
    private void repairAttribution(Inquiry existing, CanonicalInquiry row, UUID productId) {
        existing.setSourceProductRef(sourceProductRef(row));
        applyOrderRef(existing, row);
        if (existing.getProductId() == null && productId != null) {
            existing.setProductId(productId);
            existing.setProductBinding(InquiryProductBinding.SOURCE_EXACT.name());
        }
    }

    /**
     * Which product this inquiry is about — or nothing, when nothing proves it.
     *
     * <p><b>Two lanes, and the row chooses.</b> A row carrying a {@link ChannelProductRef} is
     * attributed by the channel's own identifier against {@code channel_products}, exactly, or not at
     * all: no name fallback, no placeholder listing, no {@code (미지정 상품)} bucket. A row without one
     * keeps the legacy name/SKU resolve-or-create that every existing source already used.
     *
     * <p>The identifier lane exists because NAVER's inquiry resources name their product with a NUMBER
     * and the canonical Demo Org contains products that share a name. Resolving those by name would
     * merge two sellers' products into one answer; creating one would invent a listing the seller does
     * not have. An unattributed inquiry is a smaller, truer thing than either.
     *
     * <p>Org-scoped on purpose: the listing key {@code (channel, external_product_id)} is unique
     * globally, but tenancy is asserted rather than assumed, and the {@code realDataOnly} filter keeps
     * a synthetic listing from naming a real product.
     */
    private UUID attributeProduct(UUID orgId, UUID channelId, CanonicalInquiry row) {
        ChannelProductRef ref = row.productRef();
        if (ref == null) {
            return productService.resolveOrCreate(orgId, row.productName(), row.sku()).getId();
        }
        if (!ref.hasIdentifier() || channelProducts == null) {
            return null;
        }
        return channelProducts
                .findByChannelIdAndExternalProductId(channelId, ref.externalProductId())
                .filter(listing -> listing.getOrgId() == null || orgId.equals(listing.getOrgId()))
                .map(ChannelProduct::getProductId)
                .orElse(null);
    }

    /**
     * Write the source-driven mutable fields of an inquiry (used by both insert and update).
     * Buyer PII is never set. Status is <b>monotonic</b>: an inquiry already {@code ANSWERED}
     * is never downgraded to {@code UNANSWERED} by a later re-collection (mirrors the review
     * reply-state guard), so a stale export cannot reopen it. {@code is_secret} is preserved
     * from the source ({@code null} for sources that do not classify secrecy).
     */
    private void applyInquirySource(Inquiry entity, CanonicalInquiry row) {
        entity.setTitle(row.title());
        entity.setBody(row.body());
        // informStatus records the latest raw source token verbatim; canonical status is
        // monotonic below. On Cafe24 the two can legitimately disagree: a shop answer written as a
        // board COMMENT leaves reply_status at N while the inquiry is genuinely ANSWERED
        // (Cafe24InquiryAnswerObserver, verdict STANDARD_BOARD_COMMENT, 2026-08-26). The raw token
        // keeps saying what the channel said; only the canonical status carries the conclusion.
        entity.setInformStatus(row.informStatus());
        entity.setSecret(row.isSecret());
        // The platform's own answer, when the source carries one. Only ever written FROM the source:
        // a row that stops carrying an answer is a source that does not publish answer bodies, not a
        // seller who deleted one, so an existing stored answer is never cleared by a null.
        if (row.answerBody() != null) {
            entity.setAnswerBody(row.answerBody());
        }
        if (row.answeredAt() != null) {
            entity.setAnsweredAt(row.answeredAt());
        }
        if (!"ANSWERED".equals(entity.getStatus())) {
            entity.setStatus(row.status());
        }
    }

    /**
     * Record the structural role the SOURCE just declared, and re-project the consequence.
     *
     * <p><b>Null claims nothing.</b> A source that publishes no thread structure (file upload, ESM,
     * NAVER, Coupang) leaves the stored role exactly where it is; it must not overwrite a role another
     * read established, and it must not be read as "the source said ROOT".
     *
     * <p>The projection runs on every path — insert, update, and the unchanged re-read — because a row
     * whose content never changes again is precisely the row that would otherwise keep a role it was
     * given before we knew how to ask. The projector is idempotent, so a re-run writes nothing.
     */
    /**
     * Save the row, and — when the source says it is answered — let the work item settle with it.
     *
     * <p>One place, so the two branches above cannot disagree about what "answered" does. Without a
     * seller account there is no connection to attribute the observation to, so the row is simply
     * saved: an answer we cannot say we observed through a connection is not one we act on.
     */
    private void reconcileAnsweredElsewhere(Inquiry entity, UUID sellerAccountId) {
        if ("ANSWERED".equals(entity.getStatus()) && sellerAccountId != null) {
            // Completes an absent/OPEN/PROPOSED work item atomically — never reopens, never replies.
            workItemWriter.reconcileConnectorAnswered(entity);
            return;
        }
        inquiries.save(entity);
    }

    private void applyThreadRole(Inquiry entity, CanonicalInquiry row) {
        if (row.threadRole() == null) {
            return;
        }
        if (row.threadRole() == entity.threadRole()
                && java.util.Objects.equals(entity.getThreadParentExternalId(),
                        row.threadParentExternalId())) {
            // Already recorded. Returning here keeps the routine sweep's unchanged path free of a
            // per-row work-item lookup — a hundred rows a page, every run, to learn nothing.
            return;
        }
        entity.setThreadRole(row.threadRole().name());
        entity.setThreadParentExternalId(row.threadParentExternalId());
        operationalState.apply(entity, workItemFor(entity));
    }

    /**
     * The dismissal ledger for a row that already exists, or null for one being inserted. An
     * unsaved inquiry has no id and therefore no work item — and cannot have been dismissed.
     */
    private com.sellerops.inquiry.workitem.InquiryWorkItem workItemFor(Inquiry entity) {
        return entity.getId() == null ? null : workItemWriter.findWorkItem(entity.getId());
    }

    /** True when the stored inquiry already matches the re-collected source (a no-op upsert). */
    private boolean sourceUnchanged(Inquiry existing, CanonicalInquiry row) {
        String nextStatus = "ANSWERED".equals(existing.getStatus()) ? "ANSWERED" : row.status();
        return java.util.Objects.equals(existing.getTitle(), row.title())
                && java.util.Objects.equals(existing.getBody(), row.body())
                && java.util.Objects.equals(existing.getStatus(), nextStatus)
                && java.util.Objects.equals(existing.getInformStatus(), row.informStatus())
                && java.util.Objects.equals(existing.getSecret(), row.isSecret())
                && (row.answerBody() == null
                        || java.util.Objects.equals(existing.getAnswerBody(), row.answerBody()))
                // A row whose text never changes still CHANGES for us the first time the source's
                // structural role is read off it. Leaving it out of this comparison is what would let
                // the historical backlog keep a classification made before the field was projected.
                && (row.threadRole() == null || row.threadRole() == existing.threadRole());
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
                        // Nothing mutable changed — but record that we looked and it was still there.
                        // `collected_at` is this table's observation primitive (the twin of
                        // `inquiries.last_seen_at`); leaving it stale on a no-op made "unchanged" and
                        // "gone" indistinguishable here for the same reason it did there.
                        entity.setCollectedAt(Instant.now());
                        communityArticles.save(entity);
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
