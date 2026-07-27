package com.sellerops.reviewimport;

import java.time.LocalDate;
import java.util.UUID;

/**
 * Published AFTER a review-import segment ingests successfully (execution COMPLETED + coverage COVERED),
 * so downstream analysis can refresh off the reviews that just landed. It carries only the org, the
 * channel, and a reference date — no plan id, segment id, launch ref, row, or personal data — because a
 * listener needs nothing more to re-derive its own view over the org's reviews.
 *
 * <p>By design this is consumed with {@code @TransactionalEventListener(AFTER_COMMIT)}: the ingest
 * transaction commits first, then the listener runs in its own transaction, best-effort. A listener that
 * throws can never roll back or fail the ingest that produced the reviews — the collection result is the
 * durable truth; the analysis refresh is a follow-on that is safe to retry because it is idempotent.
 */
public record ReviewSegmentIngestedEvent(UUID orgId, UUID channelId, LocalDate referenceDate) {
}
