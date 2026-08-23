package com.sellerops.connector.naver;

import com.sellerops.ingest.canonical.CanonicalInquiry;
import java.util.List;

/**
 * One page from ONE inquiry source.
 *
 * <p>{@code last} is the RESOURCE's own end-of-sweep statement, not a page-size guess.
 * {@code totalElements}/{@code totalPages} are carried for the run log and the coverage claim — a
 * "N건 중 M건" sentence needs a denominator the platform said, and nulls stay null.
 */
public record NaverInquiryPage(List<CanonicalInquiry> rows, boolean last,
                               Long totalElements, Integer totalPages) {
}
