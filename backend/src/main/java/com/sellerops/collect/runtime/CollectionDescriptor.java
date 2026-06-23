package com.sellerops.collect.runtime;

import com.sellerops.connector.DataType;
import java.util.UUID;

/**
 * Identity of one collection run: who ({@code orgId}, {@code sellerAccountId},
 * {@code channelId}/{@code channelCode}), what ({@code dataType}), how ({@code method}),
 * and why ({@code trigger}: UPLOAD / SCHEDULED / MANUAL / RETRY).
 *
 * <p>{@code sellerAccountId} and {@code channelId} may be null for legacy channel-only
 * jobs; the runtime skips connection-health updates when there is no seller account.
 *
 * <p>{@code jobType} and {@code uploadType} are optional carry-through labels that let a
 * caller keep the legacy {@code sync_jobs} shape faithful: the manual-upload path passes
 * {@code jobType="FILE_UPLOAD"} (the connector kind, orthogonal to {@code method}) and the
 * upload sub-type, so the stored row matches today's exactly while gaining {@code method}.
 * When null, {@code open} falls back to {@code method.name()} for {@code jobType} and leaves
 * {@code uploadType} unset — preserving the API-pull path unchanged.
 */
public record CollectionDescriptor(
        UUID orgId,
        UUID sellerAccountId,
        UUID channelId,
        String channelCode,
        DataType dataType,
        CollectionMethod method,
        String trigger,
        String jobType,
        String uploadType) {

    /** Backward-compatible descriptor with no explicit jobType/uploadType (API-pull style). */
    public CollectionDescriptor(UUID orgId, UUID sellerAccountId, UUID channelId, String channelCode,
                                DataType dataType, CollectionMethod method, String trigger) {
        this(orgId, sellerAccountId, channelId, channelCode, dataType, method, trigger, null, null);
    }
}
