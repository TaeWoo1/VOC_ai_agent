package com.sellerops.connector;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.sellerops.channel.ChannelRepository;
import com.sellerops.common.ApiException;
import com.sellerops.collect.runtime.CollectionDescriptor;
import com.sellerops.collect.runtime.CollectionMethod;
import com.sellerops.collect.runtime.CollectionRunService;
import com.sellerops.collect.runtime.ConnectorResult;
import com.sellerops.ingest.IngestOutcome;
import com.sellerops.ingest.IngestResult;
import com.sellerops.ingest.IngestionService;
import com.sellerops.ingest.UploadType;
import com.sellerops.ingest.map.InquiryRowMapper;
import com.sellerops.ingest.map.MapResult;
import com.sellerops.ingest.map.OrderSummaryRowMapper;
import com.sellerops.ingest.map.ReviewRowMapper;
import com.sellerops.ingest.map.RowError;
import com.sellerops.ingest.parse.FileParser;
import com.sellerops.ingest.parse.ParsedTable;
import com.sellerops.itemanalysis.ItemAnalysisService;
import com.sellerops.itemanalysis.dto.RunResult;
import com.sellerops.sync.SyncJob;
import java.io.ByteArrayInputStream;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

/**
 * Upload connector contract. Dependencies are mocked so the test isolates: (1) the
 * enrichment trigger — analyze exactly the inserted ids, only for REVIEW/INQUIRY, never let
 * analysis failure fail the upload; and (2) the wiring through {@link CollectionRunService}
 * — a faithful run row stamped with the source {@code method} (MANUAL_UPLOAD by default,
 * SELLER_CENTER_EXPORT for collector captures; API rejected), and a status mapping
 * equivalent to the legacy resolveStatus.
 */
class FileUploadConnectorTest {

    private ChannelRepository channels;
    private FileParser fileParser;
    private ReviewRowMapper reviewMapper;
    private InquiryRowMapper inquiryMapper;
    private OrderSummaryRowMapper orderMapper;
    private IngestionService ingestionService;
    private CollectionRunService collectionRuns;
    private ItemAnalysisService itemAnalysis;

    private FileUploadConnector connector;

    private final UUID org = UUID.randomUUID();
    private final UUID channel = UUID.randomUUID();

    @BeforeEach
    @SuppressWarnings("unchecked")
    void setUp() {
        channels = mock(ChannelRepository.class);
        fileParser = mock(FileParser.class);
        reviewMapper = mock(ReviewRowMapper.class);
        inquiryMapper = mock(InquiryRowMapper.class);
        orderMapper = mock(OrderSummaryRowMapper.class);
        ingestionService = mock(IngestionService.class);
        collectionRuns = mock(CollectionRunService.class);
        itemAnalysis = mock(ItemAnalysisService.class);

        connector = new FileUploadConnector(channels, fileParser, reviewMapper, inquiryMapper,
                orderMapper, ingestionService, collectionRuns, itemAnalysis);

        when(channels.existsById(channel)).thenReturn(true);
        when(collectionRuns.open(any())).thenReturn(new SyncJob());
        when(collectionRuns.finalizeRun(any(SyncJob.class), any(ConnectorResult.class), any()))
                .thenAnswer(inv -> inv.getArgument(0));
        when(fileParser.parse(any(), any()))
                .thenReturn(new ParsedTable(List.of(), List.of()));
        when(reviewMapper.map(any())).thenReturn(new MapResult<>(List.of(), List.of()));
        when(inquiryMapper.map(any())).thenReturn(new MapResult<>(List.of(), List.of()));
        when(orderMapper.map(any())).thenReturn(new MapResult<>(List.of(), List.of()));
    }

    private static ByteArrayInputStream data() {
        return new ByteArrayInputStream(new byte[0]);
    }

    @Test
    void reviewUploadTriggersAnalysisOnInsertedIds() {
        List<UUID> inserted = List.of(UUID.randomUUID(), UUID.randomUUID());
        when(ingestionService.ingestReviews(eq(org), eq(channel), any()))
                .thenReturn(new IngestOutcome(2, 0, 0, List.of(), inserted));
        when(itemAnalysis.analyzeForSources(eq(org), eq("REVIEW"), eq(inserted)))
                .thenReturn(new RunResult(2, 0));

        IngestResult result = connector.ingest(org, channel, UploadType.REVIEW, "r.csv", data());

        assertThat(result.status()).isEqualTo("SUCCESS");
        verify(itemAnalysis).analyzeForSources(org, "REVIEW", inserted);
    }

    @Test
    void inquiryUploadTriggersAnalysisWithInquiryType() {
        List<UUID> inserted = List.of(UUID.randomUUID());
        when(ingestionService.ingestInquiries(eq(org), eq(channel), any()))
                .thenReturn(new IngestOutcome(1, 0, 0, List.of(), inserted));
        when(itemAnalysis.analyzeForSources(eq(org), eq("INQUIRY"), eq(inserted)))
                .thenReturn(new RunResult(1, 0));

        connector.ingest(org, channel, UploadType.INQUIRY, "q.csv", data());

        verify(itemAnalysis).analyzeForSources(org, "INQUIRY", inserted);
    }

    @Test
    void analysisFailureDoesNotFailUpload() {
        List<UUID> inserted = List.of(UUID.randomUUID());
        when(ingestionService.ingestReviews(eq(org), eq(channel), any()))
                .thenReturn(new IngestOutcome(1, 0, 0, List.of(), inserted));
        when(itemAnalysis.analyzeForSources(any(), any(), any()))
                .thenThrow(new RuntimeException("analyzer boom"));

        IngestResult result = connector.ingest(org, channel, UploadType.REVIEW, "r.csv", data());

        // Rows are persisted; enrichment is best-effort → upload still succeeds.
        assertThat(result.status()).isEqualTo("SUCCESS");
        assertThat(result.successRows()).isEqualTo(1);
    }

    @Test
    void orderSummaryUploadDoesNotTriggerAnalysis() {
        when(ingestionService.ingestOrderSummaries(eq(org), eq(channel), any()))
                .thenReturn(new IngestOutcome(1, 0, 0, List.of(), List.of()));

        connector.ingest(org, channel, UploadType.ORDER_SUMMARY, "o.csv", data());

        verify(itemAnalysis, never()).analyzeForSources(any(), any(), any());
    }

    @Test
    void uploadOpensRunWithFaithfulShapePlusManualUploadMethod() {
        when(ingestionService.ingestReviews(eq(org), eq(channel), any()))
                .thenReturn(new IngestOutcome(3, 0, 0, List.of(), List.of()));

        connector.ingest(org, channel, UploadType.REVIEW, "r.csv", data());

        ArgumentCaptor<CollectionDescriptor> cap = ArgumentCaptor.forClass(CollectionDescriptor.class);
        verify(collectionRuns).open(cap.capture());
        CollectionDescriptor d = cap.getValue();
        assertThat(d.method()).isEqualTo(CollectionMethod.MANUAL_UPLOAD);  // the new dimension
        assertThat(d.trigger()).isEqualTo("UPLOAD");
        assertThat(d.jobType()).isEqualTo("FILE_UPLOAD");                  // legacy connector kind preserved
        assertThat(d.uploadType()).isEqualTo("REVIEW");
        assertThat(d.sellerAccountId()).isNull();                         // channel-scoped → health no-op
        assertThat(d.dataType()).isNull();                                // legacy upload row stays dataType-less
        assertThat(d.orgId()).isEqualTo(org);
        assertThat(d.channelId()).isEqualTo(channel);
    }

    @Test
    void exportUploadStampsSellerCenterExportMethod() {
        when(ingestionService.ingestReviews(eq(org), eq(channel), any()))
                .thenReturn(new IngestOutcome(3, 0, 0, List.of(), List.of()));

        connector.ingest(org, channel, UploadType.REVIEW, "r.csv", data(),
                CollectionMethod.SELLER_CENTER_EXPORT);

        // The run descriptor carries the export method; every other faithful-row field is unchanged.
        ArgumentCaptor<CollectionDescriptor> dc = ArgumentCaptor.forClass(CollectionDescriptor.class);
        verify(collectionRuns).open(dc.capture());
        CollectionDescriptor d = dc.getValue();
        assertThat(d.method()).isEqualTo(CollectionMethod.SELLER_CENTER_EXPORT);  // the source distinction
        assertThat(d.trigger()).isEqualTo("UPLOAD");
        assertThat(d.jobType()).isEqualTo("FILE_UPLOAD");
        assertThat(d.uploadType()).isEqualTo("REVIEW");
        assertThat(d.sellerAccountId()).isNull();
        assertThat(d.dataType()).isNull();

        // The finalize result mirrors the same method (used only by the sanitized view).
        ArgumentCaptor<ConnectorResult> rc = ArgumentCaptor.forClass(ConnectorResult.class);
        verify(collectionRuns).finalizeRun(any(SyncJob.class), rc.capture(), any());
        assertThat(rc.getValue().method()).isEqualTo(CollectionMethod.SELLER_CENTER_EXPORT);
    }

    @Test
    void nullMethodDefaultsToManualUpload() {
        when(ingestionService.ingestReviews(eq(org), eq(channel), any()))
                .thenReturn(new IngestOutcome(1, 0, 0, List.of(), List.of()));

        connector.ingest(org, channel, UploadType.REVIEW, "r.csv", data(), /*method*/ null);

        ArgumentCaptor<CollectionDescriptor> dc = ArgumentCaptor.forClass(CollectionDescriptor.class);
        verify(collectionRuns).open(dc.capture());
        assertThat(dc.getValue().method()).isEqualTo(CollectionMethod.MANUAL_UPLOAD);
    }

    @Test
    void apiMethodIsRejectedBeforeOpeningRun() {
        assertThatThrownBy(() -> connector.ingest(org, channel, UploadType.REVIEW, "r.csv", data(),
                CollectionMethod.API))
                .isInstanceOf(ApiException.class);

        // Rejected up front → no RUNNING run row is ever opened, no finalize.
        verify(collectionRuns, never()).open(any());
        verify(collectionRuns, never()).finalizeRun(any(), any(), any());
    }

    @Test
    void finalizeReceivesTalliesAndRawFirstError() {
        when(ingestionService.ingestReviews(eq(org), eq(channel), any()))
                .thenReturn(new IngestOutcome(2, 1, 1, List.of(new RowError(5, "bad cell")), List.of()));

        IngestResult result = connector.ingest(org, channel, UploadType.REVIEW, "r.csv", data());
        assertThat(result.status()).isEqualTo("PARTIAL");
        assertThat(result.errorMessage()).isEqualTo("bad cell");

        ArgumentCaptor<ConnectorResult> rc = ArgumentCaptor.forClass(ConnectorResult.class);
        ArgumentCaptor<String> mc = ArgumentCaptor.forClass(String.class);
        verify(collectionRuns).finalizeRun(any(SyncJob.class), rc.capture(), mc.capture());
        ConnectorResult r = rc.getValue();
        assertThat(r.method()).isEqualTo(CollectionMethod.MANUAL_UPLOAD);
        assertThat(r.successRows()).isEqualTo(2);
        assertThat(r.skippedRows()).isEqualTo(1);
        assertThat(r.failedRows()).isEqualTo(1);
        assertThat(r.totalRows()).isEqualTo(4);
        assertThat(r.rateLimited()).isFalse();
        assertThat(mc.getValue()).isEqualTo("bad cell");  // raw first row-error preserved (not a bounded code)
    }

    @Test
    void statusMappingMatchesLegacyResolveStatus() {
        assertThat(statusFor(0, 0, 0)).isEqualTo("FAILED");    // empty upload → error
        assertThat(statusFor(0, 5, 0)).isEqualTo("SUCCESS");   // all-duplicate re-upload → idempotent success
        assertThat(statusFor(5, 0, 0)).isEqualTo("SUCCESS");   // clean
        assertThat(statusFor(3, 0, 2)).isEqualTo("PARTIAL");   // some succeeded, some failed
        assertThat(statusFor(0, 0, 4)).isEqualTo("FAILED");    // all failed, no skips
        assertThat(statusFor(0, 2, 3)).isEqualTo("PARTIAL");   // failures alongside dedup skips
    }

    private String statusFor(int success, int skipped, int failed) {
        List<RowError> errors = failed > 0 ? List.of(new RowError(2, "row error")) : List.of();
        when(ingestionService.ingestReviews(eq(org), eq(channel), any()))
                .thenReturn(new IngestOutcome(success, skipped, failed, errors, List.of()));
        return connector.ingest(org, channel, UploadType.REVIEW, "r.csv", data()).status();
    }
}
