package com.sellerops.reviewimport;

/**
 * Lifecycle of one historical review-import plan. Derived from its segments, not set by hand:
 *
 * <ul>
 *   <li>{@code DRAFT} — segments are proposed, none has been run yet.</li>
 *   <li>{@code ACTIVE} — at least one segment has been attempted and remaining work exists.</li>
 *   <li>{@code COMPLETED} — no segment is left to run (each is COMPLETED, or concluded MISSING).</li>
 *   <li>{@code ABANDONED} — the operator ended the plan with remaining work; it stays reachable.</li>
 * </ul>
 */
public enum ReviewImportPlanStatus {
    DRAFT,
    ACTIVE,
    COMPLETED,
    ABANDONED
}
