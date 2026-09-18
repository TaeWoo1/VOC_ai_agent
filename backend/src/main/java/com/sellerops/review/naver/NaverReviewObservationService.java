package com.sellerops.review.naver;

import com.sellerops.channel.Channel;
import com.sellerops.channel.ChannelRepository;
import com.sellerops.collect.runtime.CollectionMethod;
import com.sellerops.common.ApiException;
import com.sellerops.ingest.IngestFollowUp;
import com.sellerops.ingest.IngestOutcome;
import com.sellerops.ingest.IngestionService;
import com.sellerops.ingest.canonical.CanonicalReview;
import com.sellerops.ingest.canonical.ChannelProductRef;
import com.sellerops.product.ChannelProductRepository;
import com.sellerops.responsibility.IdentityVerdict;
import com.sellerops.responsibility.aside.AsideMarketplaceAccess;
import com.sellerops.responsibility.aside.AsideMarketplaceTarget;
import com.sellerops.responsibility.aside.AsideRecipe;
import com.sellerops.responsibility.aside.ScheduledAsideJob;
import com.sellerops.responsibility.aside.ScheduledAsideJobRepository;
import com.sellerops.responsibility.aside.ScheduledAsideJobStatus;
import com.sellerops.review.Review;
import com.sellerops.review.ReviewReplyState;
import com.sellerops.review.ReviewRepository;
import com.sellerops.selleraccount.SellerAccount;
import com.sellerops.selleraccount.SellerAccountRepository;
import com.sellerops.sync.SyncJob;
import com.sellerops.sync.SyncJobRepository;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.format.DateTimeParseException;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import java.util.regex.Pattern;
import java.util.stream.Collectors;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

/**
 * <b>A scheduled NAVER Seller Center review read, from «which store» to canonical rows.</b>
 *
 * <p>Two halves, and neither is a new pipeline:
 *
 * <ul>
 *   <li><b>{@link #resolve} — which store a job reads.</b> The organisation's one non-file-upload NAVER account that
 *   the deployment named ({@link AsideMarketplaceAccess}). Anything but exactly one is empty, and an empty target
 *   queues no work. No slot and no digest travel for this recipe: the store is judged here at delivery, so there is
 *   nothing the helper needs to compare against.</li>
 *   <li><b>{@link #deliver} — what the read is allowed to become.</b> Strict validation of every row (a row this
 *   service does not understand refuses the whole delivery — half a page stored is indistinguishable from a whole
 *   one), the store fence, and then {@link IngestionService#ingestReviews} — the same spine the export file goes
 *   through, deduplicating on the same {@code external_id}.</li>
 * </ul>
 *
 * <p><b>The store fence.</b> NAVER holds no store identifier this backend stores (H-3), so the fence is the one fact
 * both sides DO hold: 채널상품번호. A listing id is unique per channel across every organisation, and this
 * organisation's NAVER listings were collected by the official API with its own credential. Every product number on
 * the page counted as ours ⇒ {@code MATCH}. Any number that belongs to ANOTHER organisation ⇒ {@code MISMATCH}. Any
 * number nobody holds (a listing newer than the last catalogue read) ⇒ {@code UNRESOLVED}, and nothing is stored —
 * a catalogue lag is not proof of a store. An empty page proves no store either, and is refused the same way.
 *
 * <p><b>«new» and «changed» are counted here and nowhere else.</b> New is the rows ingest inserted. Changed is the
 * already-stored reviews whose reply state this read advanced — the one field a re-read may update. Both are written
 * against the job once, so the run's source row quotes ingest rather than a number the helper computed.
 */
@Service
public class NaverReviewObservationService implements AsideMarketplaceTarget {

    private static final Logger log = LoggerFactory.getLogger(NaverReviewObservationService.class);

    static final String NAVER = "NAVER";
    /** The screen's model held 52 rows for 7 days on the measured store; this bounds a read, not a store. */
    static final int MAX_REVIEWS = 500;
    static final int MAX_BODY_CHARS = 5000;
    static final int MAX_ATTACHMENTS = 50;
    /** 리뷰글번호 as the export and the detail link carry it — 10 digits on every one of 4,432 stored rows. */
    private static final Pattern REVIEW_ID = Pattern.compile("^\\d{10}$");
    private static final Pattern PRODUCT_NO = Pattern.compile("^\\d{1,20}$");

    private final AsideMarketplaceAccess access;
    private final SellerAccountRepository accounts;
    private final ChannelRepository channels;
    private final ChannelProductRepository listings;
    private final ScheduledAsideJobRepository jobs;
    private final ReviewRepository reviews;
    private final IngestionService ingestion;
    private final IngestFollowUp followUp;
    private final SyncJobRepository syncJobs;
    private final com.sellerops.product.ProductRepository products;

    public NaverReviewObservationService(AsideMarketplaceAccess access, SellerAccountRepository accounts,
                                         ChannelRepository channels, ChannelProductRepository listings,
                                         ScheduledAsideJobRepository jobs, ReviewRepository reviews,
                                         IngestionService ingestion, IngestFollowUp followUp,
                                         SyncJobRepository syncJobs, com.sellerops.product.ProductRepository products) {
        this.products = products;
        this.access = access;
        this.accounts = accounts;
        this.channels = channels;
        this.listings = listings;
        this.jobs = jobs;
        this.reviews = reviews;
        this.ingestion = ingestion;
        this.followUp = followUp;
        this.syncJobs = syncJobs;
    }

    /** Where attachment references go. Optional so a context without the media lane stores reviews as before. */
    private com.sellerops.review.media.ReviewMediaWriter media;

    @org.springframework.beans.factory.annotation.Autowired(required = false)
    void setMediaWriter(com.sellerops.review.media.ReviewMediaWriter media) {
        this.media = media;
    }

    @Override
    public Optional<Target> resolve(UUID orgId, AsideRecipe recipe) {
        if (orgId == null || recipe != AsideRecipe.NAVER_REVIEW_OBSERVE_V1 || !access.allows(recipe, orgId)) {
            return Optional.empty();
        }
        Map<UUID, String> codeByChannel = channels.findAll().stream()
                .collect(Collectors.toMap(Channel::getId, Channel::getCode, (a, b) -> a));
        List<SellerAccount> named = accounts.findAllByOrgId(orgId).stream()
                .filter(a -> !a.isFileUpload())
                .filter(a -> NAVER.equals(codeByChannel.get(a.getChannelId())))
                .filter(a -> access.allowsAccount(a.getId()))
                .toList();
        if (named.size() != 1) {
            return Optional.empty();
        }
        return Optional.of(new Target(named.get(0).getId(), null, null));
    }

    /**
     * Take in one job's reading. Order: job → store → rows → identity → ingest → counts. A delivery that fails any
     * gate before identity stores nothing and leaves the job undelivered; one that fails identity records the verdict
     * and stores nothing.
     */
    public NaverReviewObservationView deliver(UUID orgId, UUID deviceId, UUID jobId,
                                              NaverReviewObservationRequest request) {
        ScheduledAsideJob job = jobs.findByIdAndDeviceId(jobId, deviceId)
                .filter(j -> orgId.equals(j.getOrgId()))
                .orElseThrow(() -> ApiException.notFound("해당 작업을 찾을 수 없습니다."));
        Instant now = Instant.now();
        if (job.getRecipe() != AsideRecipe.NAVER_REVIEW_OBSERVE_V1) {
            throw ApiException.badRequest("이 작업은 네이버 리뷰 확인 작업이 아닙니다.");
        }
        if (job.getStatus() != ScheduledAsideJobStatus.CLAIMED || job.getLeaseUntil() == null
                || !job.getLeaseUntil().isAfter(now)) {
            throw ApiException.conflict("진행 중인 작업이 아닙니다.");
        }
        if (job.getIdentityVerdict() != null) {
            // One claim, one delivery. A second one would be a second write of the same reading.
            throw ApiException.conflict("이미 결과를 전달한 작업입니다.");
        }
        UUID accountId = resolve(orgId, job.getRecipe()).map(Target::sellerAccountId)
                .orElseThrow(() -> ApiException.conflict("이 계정에서는 네이버 리뷰를 자동으로 확인하도록 설정되어 있지 않습니다."));
        SellerAccount account = accounts.findByIdAndOrgId(accountId, orgId)
                .orElseThrow(() -> ApiException.notFound("판매 계정을 찾을 수 없습니다."));
        Channel channel = channels.findById(account.getChannelId())
                .filter(c -> NAVER.equals(c.getCode()))
                .orElseThrow(() -> ApiException.badRequest("네이버 판매 계정이 아닙니다."));

        List<NaverReviewObservationRequest.Review> rows = validated(request);
        IdentityVerdict verdict = storeVerdict(orgId, channel.getId(), rows);
        if (verdict != IdentityVerdict.MATCH) {
            job.refuseDelivery(verdict);
            jobs.save(job);
            log.info("naver review observation: refused job={} identity={} received={}", jobId, verdict, rows.size());
            return new NaverReviewObservationView(verdict.name(), rows.size(), 0, 0, 0, 0);
        }

        int changed = replyStateAdvances(orgId, channel.getId(), rows);
        List<CanonicalReview> canonical = canonical(rows, catalogSkus(channel.getId(), rows));
        Instant startedAt = Instant.now();
        IngestOutcome outcome = ingestion.ingestReviews(orgId, channel.getId(), canonical);
        followUp.afterReviewIngest(orgId, channel.getId(), outcome.insertedIds());
        SyncJob record = recordRead(orgId, channel.getId(), accountId, rows.size(), outcome, request.windowDays(),
                startedAt);
        if (record != null) {
            ingestion.stampAcquisition(orgId, outcome.insertedIds(), record.getId());
        }
        int mediaStored = recordMedia(orgId, channel.getId(), rows, now);
        int inserted = outcome.insertedIds().size();
        job.recordDelivery(inserted, changed);
        jobs.save(job);
        // Counts and closed words only. The rows are in hand here, which is exactly why they are not in this line.
        log.info("naver review observation: job={} identity=MATCH received={} inserted={} changed={} skipped={} "
                        + "failed={} windowDays={} media={}",
                jobId, rows.size(), inserted, changed, outcome.skipped(), outcome.failed(), request.windowDays(),
                mediaStored);
        return new NaverReviewObservationView(IdentityVerdict.MATCH.name(), rows.size(), inserted, changed,
                outcome.skipped(), outcome.failed());
    }

    /** Every row understood, or none stored. A shape this service does not recognise is a changed page. */
    static List<NaverReviewObservationRequest.Review> validated(NaverReviewObservationRequest request) {
        if (request == null || request.reviews() == null) {
            throw ApiException.badRequest("리뷰 목록이 필요합니다.");
        }
        List<NaverReviewObservationRequest.Review> rows = request.reviews();
        if (rows.size() > MAX_REVIEWS) {
            throw ApiException.badRequest("한 번에 전달할 수 있는 리뷰 수를 넘었습니다.");
        }
        if (request.windowDays() == null || request.windowDays() < 1 || request.windowDays() > 366) {
            throw ApiException.badRequest("확인한 기간이 올바르지 않습니다.");
        }
        Set<String> seen = new HashSet<>();
        for (NaverReviewObservationRequest.Review row : rows) {
            if (row == null || row.reviewId() == null || !REVIEW_ID.matcher(row.reviewId()).matches()
                    || !seen.add(row.reviewId())) {
                throw ApiException.badRequest("리뷰 식별자가 올바르지 않습니다.");
            }
            if (row.rating() == null || row.rating() < 1 || row.rating() > 5) {
                throw ApiException.badRequest("리뷰 평점이 올바르지 않습니다.");
            }
            if (row.productNo() == null || !PRODUCT_NO.matcher(row.productNo()).matches()) {
                throw ApiException.badRequest("상품 번호가 올바르지 않습니다.");
            }
            if (row.body() == null || row.body().length() > MAX_BODY_CHARS) {
                throw ApiException.badRequest("리뷰 본문이 올바르지 않습니다.");
            }
            if (row.answered() == null) {
                // The page states it for every row; a row without it is not a row this reader understood.
                throw ApiException.badRequest("답글 여부가 없습니다.");
            }
            if (row.attachCount() == null || row.attachCount() < 0 || row.attachCount() > MAX_ATTACHMENTS) {
                throw ApiException.badRequest("첨부 수가 올바르지 않습니다.");
            }
            if (row.attachments() != null) {
                // The addresses and the count are two readings of one list; disagreeing, the page moved.
                if (row.attachments().size() != row.attachCount()) {
                    throw ApiException.badRequest("첨부 목록과 첨부 수가 맞지 않습니다.");
                }
                for (NaverReviewObservationRequest.Attachment a : row.attachments()) {
                    if (a == null || a.url() == null || kindOf(a.kind()) == null) {
                        throw ApiException.badRequest("첨부 정보가 올바르지 않습니다.");
                    }
                }
            }
            parseCreatedAt(row.createdAt());
        }
        return rows;
    }

    static com.sellerops.review.media.ReviewMedia.Kind kindOf(String kind) {
        if (kind == null) {
            return null;
        }
        return switch (kind) {
            case "IMAGE" -> com.sellerops.review.media.ReviewMedia.Kind.IMAGE;
            case "VIDEO" -> com.sellerops.review.media.ReviewMedia.Kind.VIDEO;
            case "UNKNOWN" -> com.sellerops.review.media.ReviewMedia.Kind.UNKNOWN;
            default -> null;
        };
    }

    /**
     * The attachments' addresses, onto the canonical review they belong to — found by the review's own id, after
     * ingest, so a review stored by an earlier read or by the export gains its media on this one.
     */
    private int recordMedia(UUID orgId, UUID channelId, List<NaverReviewObservationRequest.Review> rows,
                            Instant at) {
        if (media == null) {
            return 0;
        }
        int stored = 0;
        for (NaverReviewObservationRequest.Review row : rows) {
            if (row.attachments() == null || row.attachments().isEmpty()) {
                continue;
            }
            Optional<Review> review = reviews.findByOrgIdAndChannelIdAndExternalId(orgId, channelId, row.reviewId());
            if (review.isEmpty()) {
                continue;
            }
            stored += media.record(orgId, review.get().getId(), row.attachments().stream()
                            .map(a -> new com.sellerops.review.media.ReviewMediaWriter.Attachment(a.url(),
                                    kindOf(a.kind())))
                            .toList(),
                    AsideRecipe.NAVER_REVIEW_OBSERVE_V1.name(), at);
        }
        return stored;
    }

    /** MATCH only when every product number on the page is this organisation's; see the class comment. */
    IdentityVerdict storeVerdict(UUID orgId, UUID channelId, List<NaverReviewObservationRequest.Review> rows) {
        return com.sellerops.responsibility.aside.AsideCatalogueFence.verdict(listings, orgId, channelId,
                rows.stream().map(NaverReviewObservationRequest.Review::productNo).toList());
    }

    /** Stored reviews whose reply state this reading moves forward — the only field a re-read may change. */
    private int replyStateAdvances(UUID orgId, UUID channelId, List<NaverReviewObservationRequest.Review> rows) {
        int changed = 0;
        for (NaverReviewObservationRequest.Review row : rows) {
            Optional<Review> stored = reviews.findByOrgIdAndChannelIdAndExternalId(orgId, channelId, row.reviewId());
            if (stored.isPresent() && ReviewReplyState.isProgress(stored.get().getReplyState(), replyStateOf(row))) {
                changed++;
            }
        }
        return changed;
    }

    /**
     * 채널상품번호 → the SKU of the product that listing already belongs to, find-only.
     *
     * <p>Ingest attributes a declaring row by the SKU its caller resolved (the Coupang handoff does the same), so a
     * row sent with no SKU is stored unlinked even when the catalogue holds its listing — found on the first live
     * run: 52 reviews stored, all 52 listings present, product link 0. The value that travels on is read out of this
     * database, never one the page supplied, and a listing with no product stays unlinked rather than invented.
     */
    private Map<String, String> catalogSkus(UUID channelId, List<NaverReviewObservationRequest.Review> rows) {
        Map<String, String> skus = new java.util.HashMap<>();
        for (NaverReviewObservationRequest.Review row : rows) {
            if (skus.containsKey(row.productNo())) {
                continue;
            }
            String sku = listings.findByChannelIdAndExternalProductId(channelId, row.productNo())
                    .map(com.sellerops.product.ChannelProduct::getProductId)
                    .flatMap(products::findById)
                    .map(com.sellerops.product.Product::getSku)
                    .orElse(null);
            skus.put(row.productNo(), sku);
        }
        return skus;
    }

    private static List<CanonicalReview> canonical(List<NaverReviewObservationRequest.Review> rows,
                                                   Map<String, String> skus) {
        List<CanonicalReview> out = new ArrayList<>(rows.size());
        for (int i = 0; i < rows.size(); i++) {
            NaverReviewObservationRequest.Review row = rows.get(i);
            String body = row.body();
            out.add(new CanonicalReview(
                    row.productName(),
                    skus.get(row.productNo()),
                    row.rating(),
                    body,
                    parseCreatedAt(row.createdAt()),
                    // The review's own id — the export's 리뷰글번호 — so a review read here and later exported (or
                    // exported first and read here) is ONE canonical row, deduplicated by the spine's ext: key.
                    row.reviewId(),
                    i + 1,
                    replyStateOf(row),
                    null,
                    null,
                    row.attachCount(),
                    // The row model listed its attachments, so this count is a reading rather than a default.
                    true,
                    body.isBlank(),
                    // Attribute by the channel's own listing id, find-only: never a name fallback, never a product
                    // created from a value the page printed.
                    ChannelProductRef.of(row.productNo())));
        }
        return out;
    }

    private static ReviewReplyState replyStateOf(NaverReviewObservationRequest.Review row) {
        return Boolean.TRUE.equals(row.answered()) ? ReviewReplyState.ANSWERED : ReviewReplyState.PENDING;
    }

    private static Instant parseCreatedAt(String raw) {
        try {
            return OffsetDateTime.parse(raw).toInstant();
        } catch (DateTimeParseException | NullPointerException e) {
            throw ApiException.badRequest("리뷰 등록일이 올바르지 않습니다.");
        }
    }

    /**
     * The read's own import record. {@code PARTIAL} with the bound named, because a read of the screen's period is
     * not a completed import of the store — the same rule the Coupang handoff applies to a walk that did not reach
     * the end of its list.
     */
    private SyncJob recordRead(UUID orgId, UUID channelId, UUID accountId, int received, IngestOutcome outcome,
                               Integer windowDays, Instant startedAt) {
        try {
            SyncJob job = new SyncJob();
            job.setOrgId(orgId);
            job.setChannelId(channelId);
            job.setSellerAccountId(accountId);
            job.setDataType("REVIEW");
            job.setUploadType("REVIEW");
            job.setJobType("SCHEDULED_ASIDE_READ");
            job.setMethod(CollectionMethod.SELLER_CENTER_READ.name());
            job.setTrigger("RESPONSIBILITY");
            job.setStartedAt(startedAt);
            job.setFinishedAt(Instant.now());
            job.setTotalRows(received);
            job.setSuccessRows(outcome.success());
            job.setSkippedRows(outcome.skipped());
            job.setFailedRows(outcome.failed());
            job.setStatus("PARTIAL");
            job.setErrorMessage("BOUNDED_WINDOW_DAYS_" + windowDays);
            return syncJobs.save(job);
        } catch (RuntimeException e) {
            log.warn("naver review observation stored, import history not recorded: type={}",
                    e.getClass().getSimpleName());
            return null;
        }
    }
}
