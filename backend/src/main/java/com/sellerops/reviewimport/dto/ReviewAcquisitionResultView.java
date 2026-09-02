package com.sellerops.reviewimport.dto;

import java.time.Instant;
import java.time.LocalDate;

/**
 * What ONE guided acquisition run actually did, in the four facts a seller asked for.
 *
 * <p><b>Why this exists rather than the counts riding home on the client.</b> The conversation card that
 * drove the run knows the run's id and nothing else it may assert: a count the browser hands back and the
 * transcript prints as fact is a number nobody verified. The client names WHICH run (an id the server
 * minted and already proved belongs to this org); the server answers WHAT happened, from the attempt row
 * the ingest wrote.
 *
 * <p>Sanitized by construction: a window, three integers and an outcome word. No plan or segment identity,
 * no file name, no seller data.
 */
public record ReviewAcquisitionResultView(
        LocalDate periodStart,
        LocalDate periodEnd,
        String result,
        Integer rowsNew,
        Integer rowsDuplicate,
        Integer rowsFailed,
        Instant finishedAt) {
}
