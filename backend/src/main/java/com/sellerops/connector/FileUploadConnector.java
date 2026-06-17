package com.sellerops.connector;

import com.sellerops.channel.ChannelRepository;
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
import com.sellerops.sync.SyncJobRepository;
import java.io.InputStream;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

/**
 * Connector for operator-uploaded CSV/XLSX files. Parses → maps to canonical
 * records → ingests via the shared {@link IngestionService} → records a SyncJob.
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
    private final SyncJobRepository syncJobs;
    private final ItemAnalysisService itemAnalysis;

    public FileUploadConnector(ChannelRepository channels, FileParser fileParser,
                               ReviewRowMapper reviewMapper, InquiryRowMapper inquiryMapper,
                               OrderSummaryRowMapper orderMapper, IngestionService ingestionService,
                               SyncJobRepository syncJobs, ItemAnalysisService itemAnalysis) {
        this.channels = channels;
        this.fileParser = fileParser;
        this.reviewMapper = reviewMapper;
        this.inquiryMapper = inquiryMapper;
        this.orderMapper = orderMapper;
        this.ingestionService = ingestionService;
        this.syncJobs = syncJobs;
        this.itemAnalysis = itemAnalysis;
    }

    @Override
    public String kind() {
        return "FILE_UPLOAD";
    }

    public IngestResult ingest(UUID orgId, UUID channelId, UploadType type,
                               String filename, InputStream data) {
        if (channelId == null || !channels.existsById(channelId)) {
            throw ApiException.notFound("채널을 찾을 수 없습니다.");
        }

        SyncJob job = startJob(orgId, channelId, type);
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
            int total = outcome.success() + outcome.skipped() + outcome.failed() + mapErrors.size();
            int failed = outcome.failed() + mapErrors.size();
            String status = resolveStatus(total, outcome.success(), failed);
            String errorMessage = allErrors.isEmpty()
                    ? null
                    : allErrors.get(0).message();

            return finishJob(job, type, total, outcome.success(), outcome.skipped(),
                    failed, status, errorMessage, sample(allErrors));
        } catch (ApiException e) {
            finishJob(job, type, 0, 0, 0, 0, "FAILED", e.getMessage(), List.of());
            throw e;
        } catch (Exception e) {
            return finishJob(job, type, 0, 0, 0, 0, "FAILED",
                    "파일을 처리하지 못했습니다: " + e.getMessage(), List.of());
        }
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

    private SyncJob startJob(UUID orgId, UUID channelId, UploadType type) {
        SyncJob job = new SyncJob();
        job.setOrgId(orgId);
        job.setChannelId(channelId);
        job.setJobType(kind());
        job.setUploadType(type.name());
        job.setStatus("RUNNING");
        job.setStartedAt(Instant.now());
        return syncJobs.save(job);
    }

    private IngestResult finishJob(SyncJob job, UploadType type, int total, int success,
                                   int skipped, int failed, String status, String errorMessage,
                                   List<RowError> sampleErrors) {
        job.setTotalRows(total);
        job.setSuccessRows(success);
        job.setSkippedRows(skipped);
        job.setFailedRows(failed);
        job.setStatus(status);
        job.setErrorMessage(errorMessage);
        job.setFinishedAt(Instant.now());
        syncJobs.save(job);
        return new IngestResult(job.getId(), type, status, total, success, skipped, failed,
                errorMessage, sampleErrors);
    }

    private String resolveStatus(int total, int success, int failed) {
        if (total == 0) {
            return "FAILED";
        }
        if (failed > 0) {
            // Some rows failed: partial if anything (incl. dedup skips) was processed,
            // otherwise a full failure.
            return success > 0 ? "PARTIAL" : (success + failed < total ? "PARTIAL" : "FAILED");
        }
        // No failures. Successes and/or dedup skips (e.g. an all-duplicate re-upload)
        // are a successful, idempotent outcome — not a failure.
        return "SUCCESS";
    }

    private List<RowError> sample(List<RowError> errors) {
        return errors.size() > 10 ? errors.subList(0, 10) : errors;
    }
}
