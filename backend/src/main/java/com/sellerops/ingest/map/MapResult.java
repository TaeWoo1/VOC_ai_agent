package com.sellerops.ingest.map;

import java.util.List;

/** Outcome of mapping a parsed table: successfully mapped rows + per-row errors. */
public record MapResult<T>(List<T> ok, List<RowError> errors) {
}
