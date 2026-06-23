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
import com.sellerops.ingest.parse.ParsedTable;
import com.sellerops.itemanalysis.ItemAnalysisService;
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
    private final ItemAnalysisService itemAnalysis;

    public FileUploadConnector(ChannelRepository channels, FileParser fileParser,
                               ReviewRowMapper reviewMapper, InquiryRowMapper inquiryMapper,
                               OrderSummaryRowMapper orderMapper, IngestionService ingestionService,
                               CollectionRunService collectionRuns, ItemAnalysisService itemAnalysis) {
        this.channels = channels;
        this.fileParser = fileParser;
        this.reviewMapper = reviewMapper;
        this.inquiryMapper = inquiryMapper;
        this.orderMapper = orderMapper;
        this.ingestionService = ingestionService;
        this.collectionRuns = collectionRuns;
        this.itemAnalysis = itemAnalysis;
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
                    outcome = ingestionService.ingestReviews(orgId, channelId, r.ok());
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

            // Enrich exactly the rows this upload inserted with rule-based item-analysis.
            // Best-effort: enrichment failure must never fail the upload (rows are saved).
            if (type == UploadType.REVIEW || type == UploadType.INQUIRY) {
                triggerAnalysis(orgId, type.name(), outcome.insertedIds());
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
     * Trigger rule-based item-analysis on the newly inserted source ids. Deliberately
     * swallows failures (logged): the upload has already persisted its rows, and
     * enrichment is best-effort — {@code /inbox} loads analyses fail-soft.
     */
    private void triggerAnalysis(UUID orgId, String sourceType, List<UUID> insertedIds) {
        if (insertedIds == null || insertedIds.isEmpty()) {
            return;
        }
        try {
            itemAnalysis.analyzeForSources(orgId, sourceType, insertedIds);
        } catch (Exception e) {
            log.warn("upload-triggered item-analysis failed org={} type={} count={}: {}",
                    orgId, sourceType, insertedIds.size(), e.getMessage());
        }
    }

    /**
     * Open-time identity for an upload run. {@code jobType=kind()} ("FILE_UPLOAD") keeps the
     * legacy connector kind; {@code method} (MANUAL_UPLOAD or SELLER_CENTER_EXPORT) is the
     * orthogonal source dimension and the only field that distinguishes a human upload from a
     * collector-captured export. No seller account (uploads are channel-scoped) and no dataType,
     * preserving today's row and leaving the runtime's connection-health update a no-op.
     */
    private CollectionDescriptor uploadDescriptor(UUID orgId, UUID channelId, String channelCode,
                                                  UploadType type, CollectionMethod method) {
        return new CollectionDescriptor(orgId, /*sellerAccountId*/ null, channelId, channelCode,
                /*dataType*/ null, method, /*trigger*/ "UPLOAD",
                /*jobType*/ kind(), /*uploadType*/ type.name());
    }

    /**
     * Finalize the run through the common runtime and build the operator-facing result.
     * The status mapping ({@link ConnectorResult#jobStatus()}) is equivalent to the legacy
     * resolveStatus: an empty upload (total 0) is an error → FAILED; otherwise failures with
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
                /*rateLimited*/ false, /*errored*/ total == 0, /*failureCode*/ null);
        collectionRuns.finalizeRun(job, r, errorMessage);
        return new IngestResult(job.getId(), type, r.jobStatus(), total, success, skipped, failed,
                errorMessage, sampleErrors);
    }

    private List<RowError> sample(List<RowError> errors) {
        return errors.size() > 10 ? errors.subList(0, 10) : errors;
    }
}
