package com.sellerops.proactive.dto;

import java.util.List;

/**
 * The open proactive cases, most urgent first.
 *
 * <p>{@code total} is counted, not derived from {@code items} — a page that asked for five must not
 * make the seller believe five is all there is.
 */
public record ProactiveCaseListResponse(List<ProactiveCaseView> items, long total, long high) {
}
