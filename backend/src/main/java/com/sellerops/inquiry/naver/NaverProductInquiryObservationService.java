package com.sellerops.inquiry.naver;

import com.sellerops.channel.Channel;
import com.sellerops.channel.ChannelRepository;
import com.sellerops.collect.runtime.CollectionMethod;
import com.sellerops.common.ApiException;
import com.sellerops.ingest.IngestFollowUp;
import com.sellerops.ingest.IngestOutcome;
import com.sellerops.ingest.IngestionService;
import com.sellerops.ingest.canonical.CanonicalInquiry;
import com.sellerops.ingest.canonical.ChannelProductRef;
import com.sellerops.inquiry.InquiryRepository;
import com.sellerops.inquiry.InquirySourceSubtype;
import com.sellerops.product.ChannelProductRepository;
import com.sellerops.responsibility.IdentityVerdict;
import com.sellerops.responsibility.SourceCompleteness;
import com.sellerops.responsibility.aside.AsideCatalogueFence;
import com.sellerops.responsibility.aside.AsideMarketplaceAccess;
import com.sellerops.responsibility.aside.AsideMarketplaceTarget;
import com.sellerops.responsibility.aside.AsideRecipe;
import com.sellerops.responsibility.aside.ScheduledAsideJob;
import com.sellerops.responsibility.aside.ScheduledAsideJobRepository;
import com.sellerops.responsibility.aside.ScheduledAsideJobStatus;
import com.sellerops.selleraccount.SellerAccount;
import com.sellerops.selleraccount.SellerAccountRepository;
import com.sellerops.sync.SyncJob;
import com.sellerops.sync.SyncJobRepository;
import java.time.Instant;
import java.time.LocalDate;
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
 * <b>A scheduled NAVER Seller Center 상품 문의 read, from «which store» to canonical inquiries.</b>
 *
 * <p>The sibling of {@code NaverReviewObservationService}, and like it not a new pipeline: {@link #resolve} names the
 * organisation's one deployment-named NAVER account, and {@link #deliver} validates the page, fences the store on
 * 채널상품번호 ({@link AsideCatalogueFence}) and hands the rows to {@link IngestionService#ingestInquiries} — the spine
 * the official API collection already goes through.
 *
 * <p><b>One inquiry, one row, whichever path read it.</b> The screen's row id is the Commerce API's {@code questionId}
 * (READ-ONLY discovery 2026-09-17: id, creation instant and a hash of the question text identical on 7/7 inquiries
 * the API had stored). So the canonical row is keyed {@code naver-qna:<id>} and carries exactly the fields the API
 * client writes — same subtype, same product ref, no title, no token, and no secrecy flag (the API publishes none, and
 * a field the two paths set differently would make each of them «change» what the other wrote). A browser read of an
 * inquiry the API already stored is therefore a skip, not an update.
 *
 * <p><b>Coverage is judged here, because only here is it knowable.</b> The screen pages at a handful of rows and this
 * recipe does not click to the next page. The newest page is {@code BOUNDED} when it provably reaches back into what
 * was already stored — its oldest row was stored before this delivery — or when it holds the whole period. Otherwise
 * an inquiry could be sitting behind the page unseen, and the read is {@code PARTIAL}: its rows are still stored, but
 * it is not a baseline anything can be «new since».
 *
 * <p><b>«new» and «changed» are ingest's numbers.</b> New is the rows ingest inserted; changed is the rows it updated
 * (an inquiry the seller has since answered, or whose text the channel changed). Both are written against the job once.
 */
@Service
public class NaverProductInquiryObservationService implements AsideMarketplaceTarget {

    private static final Logger log = LoggerFactory.getLogger(NaverProductInquiryObservationService.class);

    static final String NAVER = "NAVER";
    /** The screen's page is 8 rows; this bounds a delivery, not a store. */
    static final int MAX_INQUIRIES = 100;
    static final int MAX_BODY_CHARS = 5000;
    /** questionId as the API and the screen carry it — a bare int64. */
    private static final Pattern QUESTION_ID = Pattern.compile("^[1-9]\\d{0,18}$");
    private static final Pattern PRODUCT_NO = Pattern.compile("^\\d{1,20}$");
    private static final String EXTERNAL_ID_PREFIX = "naver-qna:";

    private final AsideMarketplaceAccess access;
    private final SellerAccountRepository accounts;
    private final ChannelRepository channels;
    private final ChannelProductRepository listings;
    private final ScheduledAsideJobRepository jobs;
    private final InquiryRepository inquiries;
    private final IngestionService ingestion;
    private final IngestFollowUp followUp;
    private final SyncJobRepository syncJobs;

    public NaverProductInquiryObservationService(AsideMarketplaceAccess access, SellerAccountRepository accounts,
                                                 ChannelRepository channels, ChannelProductRepository listings,
                                                 ScheduledAsideJobRepository jobs, InquiryRepository inquiries,
                                                 IngestionService ingestion, IngestFollowUp followUp,
                                                 SyncJobRepository syncJobs) {
        this.access = access;
        this.accounts = accounts;
        this.channels = channels;
        this.listings = listings;
        this.jobs = jobs;
        this.inquiries = inquiries;
        this.ingestion = ingestion;
        this.followUp = followUp;
        this.syncJobs = syncJobs;
    }

    @Override
    public Optional<Target> resolve(UUID orgId, AsideRecipe recipe) {
        if (orgId == null || recipe != AsideRecipe.NAVER_PRODUCT_INQUIRY_OBSERVE_V1 || !access.allows(recipe, orgId)) {
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
     * Take in one job's reading. Order: job → store → rows → identity → coverage → ingest → counts. A delivery that
     * fails any gate before identity stores nothing and leaves the job undelivered; one that fails identity records
     * the verdict and stores nothing.
     */
    public NaverProductInquiryObservationView deliver(UUID orgId, UUID deviceId, UUID jobId,
                                                      NaverProductInquiryObservationRequest request) {
        ScheduledAsideJob job = jobs.findByIdAndDeviceId(jobId, deviceId)
                .filter(j -> orgId.equals(j.getOrgId()))
                .orElseThrow(() -> ApiException.notFound("해당 작업을 찾을 수 없습니다."));
        Instant now = Instant.now();
        if (job.getRecipe() != AsideRecipe.NAVER_PRODUCT_INQUIRY_OBSERVE_V1) {
            throw ApiException.badRequest("이 작업은 네이버 상품 문의 확인 작업이 아닙니다.");
        }
        if (job.getStatus() != ScheduledAsideJobStatus.CLAIMED || job.getLeaseUntil() == null
                || !job.getLeaseUntil().isAfter(now)) {
            throw ApiException.conflict("진행 중인 작업이 아닙니다.");
        }
        if (job.getIdentityVerdict() != null) {
            throw ApiException.conflict("이미 결과를 전달한 작업입니다.");
        }
        UUID accountId = resolve(orgId, job.getRecipe()).map(Target::sellerAccountId)
                .orElseThrow(() -> ApiException.conflict("이 계정에서는 네이버 상품 문의를 자동으로 확인하도록 설정되어 있지 않습니다."));
        SellerAccount account = accounts.findByIdAndOrgId(accountId, orgId)
                .orElseThrow(() -> ApiException.notFound("판매 계정을 찾을 수 없습니다."));
        Channel channel = channels.findById(account.getChannelId())
                .filter(c -> NAVER.equals(c.getCode()))
                .orElseThrow(() -> ApiException.badRequest("네이버 판매 계정이 아닙니다."));

        List<NaverProductInquiryObservationRequest.Inquiry> rows = validated(request);
        IdentityVerdict verdict = AsideCatalogueFence.verdict(listings, orgId, channel.getId(),
                rows.stream().map(NaverProductInquiryObservationRequest.Inquiry::channelProductNo).toList());
        if (verdict != IdentityVerdict.MATCH) {
            job.refuseDelivery(verdict);
            jobs.save(job);
            log.info("naver product inquiry observation: refused job={} identity={} received={}", jobId, verdict,
                    rows.size());
            return new NaverProductInquiryObservationView(verdict.name(), null, rows.size(), 0, 0, 0, 0);
        }

        // Asked BEFORE ingest: after it, every row on the page is stored and the question would answer itself.
        SourceCompleteness coverage = coverage(orgId, channel.getId(), rows, request.totalCount());
        Instant startedAt = Instant.now();
        IngestOutcome outcome = ingestion.ingestInquiries(orgId, channel.getId(), accountId, canonical(rows));
        followUp.afterInquiryIngest(orgId, outcome.insertedIds());
        int inserted = outcome.insertedIds().size();
        int changed = Math.max(0, outcome.success() - inserted);
        recordRead(orgId, channel.getId(), accountId, rows.size(), outcome, coverage, request, startedAt);
        job.recordDelivery(inserted, changed, coverage);
        jobs.save(job);
        long secret = rows.stream().filter(r -> Boolean.TRUE.equals(r.secret())).count();
        // Counts and closed words only. The rows are in hand here, which is exactly why they are not in this line.
        log.info("naver product inquiry observation: job={} identity=MATCH coverage={} received={} total={} "
                        + "inserted={} changed={} skipped={} failed={} secret={}",
                jobId, coverage, rows.size(), request.totalCount(), inserted, changed, outcome.skipped(),
                outcome.failed(), secret);
        return new NaverProductInquiryObservationView(IdentityVerdict.MATCH.name(), coverage.name(), rows.size(),
                inserted, changed, outcome.skipped(), outcome.failed());
    }

    /** Every row understood, newest first, or none stored. A shape this service does not recognise is a changed page. */
    static List<NaverProductInquiryObservationRequest.Inquiry> validated(NaverProductInquiryObservationRequest request) {
        if (request == null || request.inquiries() == null) {
            throw ApiException.badRequest("문의 목록이 필요합니다.");
        }
        List<NaverProductInquiryObservationRequest.Inquiry> rows = request.inquiries();
        if (rows.size() > MAX_INQUIRIES) {
            throw ApiException.badRequest("한 번에 전달할 수 있는 문의 수를 넘었습니다.");
        }
        if (request.pageSize() == null || request.pageSize() < 1 || request.pageSize() > MAX_INQUIRIES
                || rows.size() > request.pageSize()) {
            throw ApiException.badRequest("목록의 페이지 크기가 올바르지 않습니다.");
        }
        if (request.totalCount() == null || request.totalCount() < rows.size()) {
            throw ApiException.badRequest("목록의 전체 건수가 올바르지 않습니다.");
        }
        LocalDate start = parseDate(request.windowStart());
        LocalDate end = parseDate(request.windowEnd());
        if (start.isAfter(end) || start.plusDays(366).isBefore(end)) {
            throw ApiException.badRequest("확인한 기간이 올바르지 않습니다.");
        }
        if (rows.size() < request.pageSize() && rows.size() != request.totalCount()) {
            // A short page is the last page; a short FIRST page that is not the whole period is a page still drawing.
            throw ApiException.badRequest("목록이 모두 표시되지 않았습니다.");
        }
        Set<String> seen = new HashSet<>();
        Instant previous = null;
        for (NaverProductInquiryObservationRequest.Inquiry row : rows) {
            if (row == null || row.questionId() == null || !QUESTION_ID.matcher(row.questionId()).matches()
                    || !seen.add(row.questionId())) {
                throw ApiException.badRequest("문의 식별자가 올바르지 않습니다.");
            }
            if (row.channelProductNo() == null || !PRODUCT_NO.matcher(row.channelProductNo()).matches()) {
                throw ApiException.badRequest("상품 번호가 올바르지 않습니다.");
            }
            if (row.body() == null || row.body().length() > MAX_BODY_CHARS) {
                throw ApiException.badRequest("문의 본문이 올바르지 않습니다.");
            }
            if (row.answered() == null || row.secret() == null) {
                // The page states both for every row; a row without them is not a row this reader understood.
                throw ApiException.badRequest("답변 여부가 없습니다.");
            }
            Instant createdAt = parseCreatedAt(row.createdAt());
            if (previous != null && createdAt.isAfter(previous)) {
                // «The newest page» is only a bound if the page is in newest-first order.
                throw ApiException.badRequest("문의 목록의 순서가 올바르지 않습니다.");
            }
            previous = createdAt;
        }
        return rows;
    }

    /** See the class comment: the newest page reaches back into stored history, or it is the whole period. */
    private SourceCompleteness coverage(UUID orgId, UUID channelId,
                                        List<NaverProductInquiryObservationRequest.Inquiry> rows, int totalCount) {
        if (rows.size() == totalCount) {
            return SourceCompleteness.BOUNDED;
        }
        NaverProductInquiryObservationRequest.Inquiry oldest = rows.get(rows.size() - 1);
        boolean reachesStored = inquiries
                .findByOrgIdAndChannelIdAndExternalId(orgId, channelId, EXTERNAL_ID_PREFIX + oldest.questionId())
                .isPresent();
        return reachesStored ? SourceCompleteness.BOUNDED : SourceCompleteness.PARTIAL;
    }

    /** Exactly the row the official API client writes for the same inquiry — see the class comment. */
    static List<CanonicalInquiry> canonical(List<NaverProductInquiryObservationRequest.Inquiry> rows) {
        List<CanonicalInquiry> out = new ArrayList<>(rows.size());
        for (int i = 0; i < rows.size(); i++) {
            NaverProductInquiryObservationRequest.Inquiry row = rows.get(i);
            boolean answered = Boolean.TRUE.equals(row.answered());
            out.add(new CanonicalInquiry(
                    null,
                    null,
                    // Buyer PII: no writer field exists on the request at all.
                    null,
                    row.body(),
                    answered ? "ANSWERED" : "UNANSWERED",
                    parseCreatedAt(row.createdAt()),
                    EXTERNAL_ID_PREFIX + row.questionId(),
                    i + 1,
                    null,
                    null,
                    // Not the page's 비밀글 flag: the API publishes none — see the class comment.
                    null,
                    InquirySourceSubtype.NAVER_PRODUCT_QNA,
                    ChannelProductRef.of(row.channelProductNo()),
                    // The list does not carry the answer text; an existing stored answer is never cleared by a null.
                    null,
                    null));
        }
        return out;
    }

    private static Instant parseCreatedAt(String raw) {
        try {
            return OffsetDateTime.parse(raw).toInstant();
        } catch (DateTimeParseException | NullPointerException e) {
            throw ApiException.badRequest("문의 등록일이 올바르지 않습니다.");
        }
    }

    private static LocalDate parseDate(String raw) {
        try {
            return LocalDate.parse(raw);
        } catch (DateTimeParseException | NullPointerException e) {
            throw ApiException.badRequest("확인한 기간이 올바르지 않습니다.");
        }
    }

    /** The read's own import record, {@code PARTIAL} with the bound named — a page is never a completed import. */
    private void recordRead(UUID orgId, UUID channelId, UUID accountId, int received, IngestOutcome outcome,
                            SourceCompleteness coverage, NaverProductInquiryObservationRequest request,
                            Instant startedAt) {
        try {
            SyncJob job = new SyncJob();
            job.setOrgId(orgId);
            job.setChannelId(channelId);
            job.setSellerAccountId(accountId);
            job.setDataType("INQUIRY");
            job.setUploadType("INQUIRY");
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
            job.setErrorMessage("NEWEST_PAGE_" + received + "_OF_" + request.totalCount() + "_" + coverage.name());
            syncJobs.save(job);
        } catch (RuntimeException e) {
            log.warn("naver product inquiry observation stored, import history not recorded: type={}",
                    e.getClass().getSimpleName());
        }
    }
}
