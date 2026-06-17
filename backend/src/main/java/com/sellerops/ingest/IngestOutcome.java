package com.sellerops.ingest;

import com.sellerops.ingest.map.RowError;
import java.util.List;
import java.util.UUID;

/**
 * Per-type ingestion tally plus any per-row persistence errors (surfaced to the
 * operator). {@code insertedIds} are the ids of rows newly persisted by this call
 * (excludes dedup skips and failures).
 *
 * {@link com.sellerops.connector.FileUploadConnector} uses these only for
 * REVIEW/INQUIRY upload-triggered item analysis. The ORDER_SUMMARY path may also
 * return inserted ids, but they are intentionally ignored by the analysis trigger.
 */
public record IngestOutcome(int success, int skipped, int failed, List<RowError> errors,
                            List<UUID> insertedIds) {
}
