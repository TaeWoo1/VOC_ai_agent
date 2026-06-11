package com.sellerops.ingest;

import com.sellerops.ingest.map.RowError;
import java.util.List;
import java.util.UUID;

/** Outcome of one upload: the recorded sync-job id, status, and row tallies. */
public record IngestResult(
        UUID syncJobId,
        UploadType uploadType,
        String status,
        int totalRows,
        int successRows,
        int skippedRows,
        int failedRows,
        String errorMessage,
        List<RowError> sampleErrors) {
}
