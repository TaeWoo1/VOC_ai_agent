package com.sellerops.connector;

import com.sellerops.channel.Channel;
import com.sellerops.channel.ChannelRepository;
import com.sellerops.collect.runtime.CollectionDescriptor;
import com.sellerops.collect.runtime.CollectionMethod;
import com.sellerops.collect.runtime.CollectionRunService;
import com.sellerops.collect.runtime.ConnectorResult;
import com.sellerops.common.ApiException;
import com.sellerops.ingest.IngestOutcome;
import com.sellerops.ingest.IngestResult;
import com.sellerops.ingest.IngestionService;
import com.sellerops.ingest.UploadType;
import com.sellerops.ingest.canonical.CanonicalInquiry;
import com.sellerops.ingest.canonical.CanonicalOrderSummary;
import com.sellerops.ingest.canonical.CanonicalReview;
import com.sellerops.ingest.map.InquiryRowMapper;
import com.sellerops.ingest.map.MapResult;
import com.sellerops.ingest.map.OrderSummaryRowMapper;
import com.sellerops.ingest.map.ReviewRowMapper;
import com.sellerops.ingest.map.RowError;
import com.sellerops.ingest.parse.FileParser;
import com.sellerops.ingest.parse.UnsupportedUploadFormatException;
import com.sellerops.ingest.parse.ParsedTable;
import com.sellerops.ingest.IngestFollowUp;
import com.sellerops.sync.SyncJob;
import java.io.InputStream;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

/**
 * Connector for uploaded CSV/XLSX files. Parses → maps to canonical records → ingests via
 * the shared {@link IngestionService} → records the run through the common
 * {@link CollectionRunService}. The run's {@code method} carries the source: a human upload
 * defaults to {@code MANUAL_UPLOAD}; a collector-captured seller-center export passes
 * {@code SELLER_CENTER_EXPORT} (the {@code API} method is rejected — uploads are never API-pull).
 *
 * <p>The run row stays faithful to the legacy upload shape — {@code jobType="FILE_UPLOAD"},
 * the upload sub-type, the raw first row-error in {@code error_message}, null
 * {@code dataType}/{@code sellerAccountId} — so the history endpoints are unchanged; {@code method}
 * is the only field that distinguishes the two sources. With no seller account the runtime's
 * health update no-ops, exactly as uploads behaved before.
 */
@Component
public class FileUploadConnector implements ChannelConnector {

    private static final Logger log = LoggerFactory.getLogger(FileUploadConnector.class);

    private final ChannelRepository channels;
    private final FileParser fileParser;
    private final ReviewRowMapper reviewMapper;
    private final InquiryRowMapper inquiryMapper;
    private final OrderSummaryRowMapper orderMapper;
    private final IngestionService ingestionService;
    private final CollectionRunService collectionRuns;
    private final IngestFollowUp followUp;

    public FileUploadConnector(ChannelRepository channels, FileParser fileParser,
                               ReviewRowMapper reviewMapper, InquiryRowMapper inquiryMapper,
                               OrderSummaryRowMapper orderMapper, IngestionService ingestionService,
                               CollectionRunService collectionRuns, IngestFollowUp followUp) {
        this.channels = channels;
        this.fileParser = fileParser;
        this.reviewMapper = reviewMapper;
        this.inquiryMapper = inquiryMapper;
        this.orderMapper = orderMapper;
        this.ingestionService = ingestionService;
        this.collectionRuns = collectionRuns;
        this.followUp = followUp;
    }

    @Override
    public String kind() {
        return "FILE_UPLOAD";
    }

    /** Backward-compatible entry point: an upload with no explicit method is a manual upload. */
    public IngestResult ingest(UUID orgId, UUID channelId, UploadType type,
                               String filename, InputStream data) {
        return ingest(orgId, channelId, type, filename, data, CollectionMethod.MANUAL_UPLOAD);
    }

    public IngestResult ingest(UUID orgId, UUID channelId, UploadType type,
                               String filename, InputStream data, CollectionMethod method) {
        if (channelId == null || !channels.existsById(channelId)) {
            throw ApiException.notFound("채널을 찾을 수 없습니다.");
        }
        CollectionMethod resolvedMethod = resolveUploadMethod(method);

        String channelCode = channels.findById(channelId)
                .map(Channel::getCode).orElse(channelId.toString());
        SyncJob job = collectionRuns.open(uploadDescriptor(orgId, channelId, channelCode, type, resolvedMethod));
        try {
            ParsedTable table = fileParser.parse(filename, data);
            List<RowError> mapErrors;
            IngestOutcome outcome;

            switch (type) {
                case REVIEW -> {
                    MapResult<CanonicalReview> r = reviewMapper.map(table);
                    mapErrors = r.errors();
                    // The run is already open, so every inserted review carries its provenance (V83):
                    // this is where SELLER_CENTER_EXPORT and MANUAL_UPLOAD stop being the same row.
                    outcome = ingestionService.ingestReviews(orgId, channelId, r.ok(), job.getId());
                }
                case INQUIRY -> {
                    MapResult<CanonicalInquiry> r = inquiryMapper.map(table);
                    mapErrors = r.errors();
                    outcome = ingestionService.ingestInquiries(orgId, channelId, r.ok());
                }
                case ORDER_SUMMARY -> {
                    MapResult<CanonicalOrderSummary> r = orderMapper.map(table);
                    mapErrors = r.errors();
                    outcome = ingestionService.ingestOrderSummaries(orgId, channelId, r.ok());
                }
                default -> throw ApiException.badRequest("지원하지 않는 업로드 유형입니다.");
            }

            // Follow up exactly the rows this upload inserted: item-analysis, issue-memory refresh,
            // customer-memory index. Moved into IngestFollowUp so the API-sync and Coupang-handoff
            // paths do the SAME three things — they each used to do a different subset, which is
            // audit defects B and C. Best-effort inside: the rows are saved either way.
            switch (type) {
                case REVIEW -> followUp.afterReviewIngest(orgId, channelId, outcome.insertedIds());
                case INQUIRY -> followUp.afterInquiryIngest(orgId, outcome.insertedIds());
                default -> { /* order summaries carry no customer utterance to analyse or index */ }
            }

            // Both mapping errors (bad rows) and per-row persistence errors are surfaced.
            List<RowError> allErrors = new ArrayList<>(mapErrors);
            allErrors.addAll(outcome.errors());
            int failed = outcome.failed() + mapErrors.size();
            String errorMessage = allErrors.isEmpty()
                    ? null
                    : allErrors.get(0).message();

            return finish(job, channelCode, type, resolvedMethod, outcome.success(), outcome.skipped(),
                    failed, errorMessage, sample(allErrors));
        } catch (UnsupportedUploadFormatException e) {
            // The bytes are not a readable export. That is this RUN's outcome, so it lands as a recorded
            // FAILED attempt with its reason rather than a 400 with no trace — the seller sees a failure
            // they can retry, and a parse failure never reads as an honest zero.
            return finish(job, channelCode, type, resolvedMethod, 0, 0, 0, e.getMessage(), List.of());
        } catch (ApiException e) {
            finish(job, channelCode, type, resolvedMethod, 0, 0, 0, e.getMessage(), List.of());
            throw e;
        } catch (Exception e) {
            return finish(job, channelCode, type, resolvedMethod, 0, 0, 0,
                    "파일을 처리하지 못했습니다: " + e.getMessage(), List.of());
        }
    }

    /**
     * An upload arrives either as a human {@code MANUAL_UPLOAD} (the default when the request
     * omits the method) or a collector-captured {@code SELLER_CENTER_EXPORT}. {@code API} is not
     * a file-upload provenance — reject it before any run row is opened.
     */
    private CollectionMethod resolveUploadMethod(CollectionMethod method) {
        if (method == null) {
            return CollectionMethod.MANUAL_UPLOAD;
        }
        if (method == CollectionMethod.API) {
            throw ApiException.badRequest("업로드에는 API 수집 방식을 사용할 수 없습니다.");
        }
        return method;
    }

    /**
     * Open-time identity for an upload run. {@code jobType=kind()} ("FILE_UPLOAD") keeps the
     * legacy connector kind; {@code method} (MANUAL_UPLOAD or SELLER_CENTER_EXPORT) is the
     * orthogonal source dimension and the only field that distinguishes a human upload from a
     * collector-captured export. No seller account (uploads are channel-scoped) and no dataType,
     * preserving today's row and leaving the runtime's connection-health update a no-op.
     */
    /**
     * The run row for one upload.
     *
     * <p>{@code dataType} is set only for a run that OBSERVED the channel — a guided export or a guided screen
     * read (see {@link CollectionMethod#observesChannel()}). That is what makes it visible to
     * {@code ChannelCoverageService.lastSuccessfulSync(org, channel, dataType)}, and it is the difference
     * between a guided import that updates "last checked" and one that lands 115 reviews while the product
     * keeps saying the channel has never been checked (observed 2026-09-02). A {@code MANUAL_UPLOAD} keeps
     * {@code null}: a file of unknown age is not an observation of the channel now, and letting it refresh
     * freshness would let a year-old export read as today's state.
     *
     * <p>{@code sellerAccountId} stays null on purpose — an upload is not bound to an account, and the guided
     * import's account binding lives where it is proven, on the segment's plan
     * ({@code ExecutableIdentityResolver} resolves it through the attempt, never through this row).
     */
    private CollectionDescriptor uploadDescriptor(UUID orgId, UUID channelId, String channelCode,
                                                  UploadType type, CollectionMethod method) {
        return new CollectionDescriptor(orgId, /*sellerAccountId*/ null, channelId, channelCode,
                /*dataType*/ method.observesChannel() ? observedDataType(type) : null, method, /*trigger*/ "UPLOAD",
                /*jobType*/ kind(), /*uploadType*/ type.name());
    }

    /** The upload's kind as a collection data type. `UploadType` and `DataType` share these three names. */
    private static DataType observedDataType(UploadType type) {
        return switch (type) {
            case REVIEW -> DataType.REVIEW;
            case INQUIRY -> DataType.INQUIRY;
            case ORDER_SUMMARY -> DataType.ORDER_SUMMARY;
            default -> null;
        };
    }

    /**
     * Finalize the run through the common runtime and build the operator-facing result.
     * The status mapping ({@link ConnectorResult#jobStatus()}) is equivalent to the legacy
     * resolveStatus, with one deliberate exception: an empty upload (total 0) is an error → FAILED
     * <b>unless it is a {@code SELLER_CENTER_EXPORT}</b>, where an empty export is a legitimate quiet
     * range and lands SUCCESS 0/0/0 (see {@link #erroredOnEmpty}). Otherwise failures with
     * any landed/skipped row are PARTIAL, all-fail is FAILED, and a clean (incl. all-duplicate)
     * upload is SUCCESS. The raw first row-error is preserved in {@code error_message}; the
     * {@code IngestResult} is built in-memory so the HTTP response is unchanged.
     */
    private IngestResult finish(SyncJob job, String channelCode, UploadType type,
                                CollectionMethod method, int success, int skipped, int failed,
                                String errorMessage, List<RowError> sampleErrors) {
        int total = success + skipped + failed;
        ConnectorResult r = ConnectorResult.of(channelCode, DataType.valueOf(type.name()),
                method, success, skipped, failed,
                /*rateLimited*/ false, /*errored*/ erroredOnEmpty(total, method, errorMessage), /*failureCode*/ null);
        collectionRuns.finalizeRun(job, r, errorMessage);
        return new IngestResult(job.getId(), type, r.jobStatus(), total, success, skipped, failed,
                errorMessage, sampleErrors);
    }

    /**
     * Whether an upload that produced <b>zero rows</b> is an error — and it depends on who chose the
     * file.
     *
     * <p>A {@code MANUAL_UPLOAD} of an empty file stays {@code FAILED}, unchanged: a human picking a
     * file almost certainly picked the wrong one, and answering "success" would hide that. That is
     * the legacy {@code resolveStatus} rule, pinned by {@code FileUploadConnectorTest}.
     *
     * <p>A {@code SELLER_CENTER_EXPORT} is different: the Action Window hands over an artifact the
     * platform produced for the range the seller selected, and an export of a quiet range is
     * legitimately empty — a real header-only export has been observed. Reporting that as a failure
     * would tell a seller their correct export was broken, and the seller-facing blocker copy
     * ("저장 중 문제가 생겼어요 / 잠시 후 다시 시도해 주세요") would be false twice over. So an empty
     * export is an honest zero: {@code SUCCESS} with 0/0/0.
     *
     * <p>An {@code errorMessage} always wins. A parse failure on the export path reaches here with
     * zero rows too, and that <b>is</b> an error — this rule must never turn "we could not read it"
     * into "there was nothing in it". {@code RunOutcome.classify} already treats an empty-but-clean
     * run as SUCCESS ("including an empty incremental pull"); this restores that intent for exports
     * without touching the manual-upload contract.
     */
    private boolean erroredOnEmpty(int total, CollectionMethod method, String errorMessage) {
        if (total > 0) {
            return false;
        }
        return errorMessage != null || method != CollectionMethod.SELLER_CENTER_EXPORT;
    }

    private List<RowError> sample(List<RowError> errors) {
        return errors.size() > 10 ? errors.subList(0, 10) : errors;
    }
}
