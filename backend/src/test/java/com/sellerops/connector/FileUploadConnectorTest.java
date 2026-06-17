package com.sellerops.connector;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.sellerops.channel.ChannelRepository;
import com.sellerops.ingest.IngestOutcome;
import com.sellerops.ingest.IngestResult;
import com.sellerops.ingest.IngestionService;
import com.sellerops.ingest.UploadType;
import com.sellerops.ingest.map.InquiryRowMapper;
import com.sellerops.ingest.map.MapResult;
import com.sellerops.ingest.map.OrderSummaryRowMapper;
import com.sellerops.ingest.map.ReviewRowMapper;
import com.sellerops.ingest.parse.FileParser;
import com.sellerops.ingest.parse.ParsedTable;
import com.sellerops.itemanalysis.ItemAnalysisService;
import com.sellerops.itemanalysis.dto.RunResult;
import com.sellerops.sync.SyncJob;
import com.sellerops.sync.SyncJobRepository;
import java.io.ByteArrayInputStream;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

/**
 * Upload-scoped enrichment trigger. Dependencies are mocked so the test isolates the
 * connector's contract: analyze exactly the inserted ids, only for REVIEW/INQUIRY, and
 * never let analysis failure fail the upload.
 */
class FileUploadConnectorTest {

    private ChannelRepository channels;
    private FileParser fileParser;
    private ReviewRowMapper reviewMapper;
    private InquiryRowMapper inquiryMapper;
    private OrderSummaryRowMapper orderMapper;
    private IngestionService ingestionService;
    private SyncJobRepository syncJobs;
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
        syncJobs = mock(SyncJobRepository.class);
        itemAnalysis = mock(ItemAnalysisService.class);

        connector = new FileUploadConnector(channels, fileParser, reviewMapper, inquiryMapper,
                orderMapper, ingestionService, syncJobs, itemAnalysis);

        when(channels.existsById(channel)).thenReturn(true);
        when(syncJobs.save(any(SyncJob.class))).thenAnswer(inv -> inv.getArgument(0));
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
}
