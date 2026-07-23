package com.sellerops.sync;

import java.time.Instant;
import java.util.UUID;

/**
 * One review import, as the operator's history shows it — counts, provenance, outcome, timing.
 *
 * <p><b>What the counts mean</b> (from {@code IngestOutcome} and {@code CollectionRunService.finish}),
 * because the surface that renders them has to say it correctly:
 *
 * <ul>
 *   <li>{@code successRows} — reviews <b>newly inserted</b> by this import.</li>
 *   <li>{@code skippedRows} — <b>duplicates</b> rejected by dedup. A re-import of the same export is
 *       all skips, and that is a success, not an empty result.</li>
 *   <li>{@code failedRows} — mapping errors plus per-row persistence errors.</li>
 *   <li>{@code totalRows} — the <b>sum of the three</b>, not the file's row count: rows the parser
 *       dropped as blank never reach a tally.</li>
 * </ul>
 *
 * <p><b>{@code status}</b> is {@code RUNNING} (opened and never finalized — e.g. a crash mid-ingest),
 * {@code SUCCESS}, {@code PARTIAL}, or {@code FAILED}. {@code RATE_LIMITED} is never persisted as a
 * status ({@code ConnectorResult.jobStatus}). Two successes need care from any caller: an <b>empty
 * export</b> ({@code SELLER_CENTER_EXPORT}, 0/0/0) and an <b>all-duplicate re-import</b> (0 success,
 * N skipped) are both correct outcomes, not failures and not "nothing collected".
 *
 * <p><b>{@code method} is nullable.</b> {@code SELLER_CENTER_EXPORT} means an Action Window export
 * landed; {@code MANUAL_UPLOAD} means a human picked a file; <b>{@code null} means unknown</b> — V6
 * added the column additive-and-nullable so rows that predate it stay valid. A null must be rendered
 * as unknown and never guessed into either provenance.
 *
 * <p><b>{@code errorMessage} is deliberately absent.</b> {@code sync_jobs.error_message} holds the raw
 * first row-error, and {@code FileUploadConnector} also stores exception text there
 * ({@code "파일을 처리하지 못했습니다: " + e.getMessage()}), which can embed parser or filename detail.
 * The status is enough for an operator surface to explain itself; the raw string never crosses this
 * boundary. Nothing else identifying is carried either — no filename, no row content, no account.
 *
 * <p><b>{@code channelId} is deliberately absent too</b>, for a different reason: nothing renders it.
 * Shipping an id the surface never shows is exposure without purpose. When a second channel actually
 * reaches this history, per-row channel attribution is a real feature — a label the seller can read,
 * not a raw id — and it arrives with that change rather than sitting on the wire in advance.
 */
public record ReviewImportView(
        UUID id,
        String method,
        String status,
        int totalRows,
        int successRows,
        int skippedRows,
        int failedRows,
        Instant startedAt,
        Instant finishedAt) {

    static ReviewImportView from(SyncJob j) {
        return new ReviewImportView(j.getId(), j.getMethod(), j.getStatus(),
                j.getTotalRows(), j.getSuccessRows(), j.getSkippedRows(), j.getFailedRows(),
                j.getStartedAt(), j.getFinishedAt());
    }
}
