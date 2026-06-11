package com.sellerops.ingest;

import com.sellerops.ingest.map.RowError;
import java.util.List;

/** Per-type ingestion tally plus any per-row persistence errors (surfaced to the operator). */
public record IngestOutcome(int success, int skipped, int failed, List<RowError> errors) {
}
