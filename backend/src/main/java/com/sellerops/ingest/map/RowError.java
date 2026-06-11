package com.sellerops.ingest.map;

/** A row that could not be mapped. rowNumber is 1-based incl. the header row. */
public record RowError(int rowNumber, String message) {
}
