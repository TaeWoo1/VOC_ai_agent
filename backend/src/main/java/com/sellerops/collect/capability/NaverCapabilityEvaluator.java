package com.sellerops.collect.capability;

import com.sellerops.channel.ChannelStatus;
import java.util.List;
import java.util.UUID;

/**
 * Pure decision matrix for the NAVER guided-connection capability result. Given the facts the
 * service gathered — the account's connection status, whether a credential row exists, and the
 * latest {@code ORDER_SUMMARY} sync outcome — it derives the four capability lines and the
 * top-level rollup. No I/O, no Spring, no secrets, and (crucially) <b>no live provider call</b>:
 * it reflects only persisted state plus NAVER's fixed product policy, so every honest-state rule
 * lives here and is exhaustively unit-testable offline.
 *
 * <p><b>Honesty rules that matter for safety:</b>
 * <ul>
 *   <li><b>ORDER_READ is earned, never assumed.</b> It is {@code AVAILABLE} only when a first
 *       {@code ORDER_SUMMARY} sync actually SUCCEEDED (or PARTIAL) — never from connection status
 *       alone. A missing/failed/running sync leaves it {@code NEEDS_ATTENTION} with a distinct
 *       reason so the wizard can separate a test failure from a sync failure.</li>
 *   <li><b>Identity is confirmed only by a successful first sync.</b> A successful order sync proves
 *       the credential decrypted, authenticated against NAVER's token endpoint, and reached this
 *       seller's orders. NAVER exposes no whoami, so this is the honest ceiling — nothing fabricates
 *       a store name, and identity is never claimed from a mere credential row.</li>
 *   <li><b>The non-order features are fixed policy, never a live claim.</b> {@code REVIEW_IMPORT}
 *       is {@code GUIDED_CONFIRMATION} (NAVER has no review API — reviews arrive only through the
 *       operator-confirmed Action Window export), {@code REVIEW_REPLY} is {@code NOT_ENABLED}
 *       (no automatic send; submission unverified), and {@code INQUIRY_READ} is
 *       {@code INTEGRATION_PENDING} (not integrated for NAVER). They render as informational labels,
 *       so the order connection is never mixed with the review/inquiry surfaces.</li>
 * </ul>
 */
public final class NaverCapabilityEvaluator {

    // Capability states (closed vocabulary, safe to surface).
    public static final String AVAILABLE = "AVAILABLE";
    public static final String GUIDED_CONFIRMATION = "GUIDED_CONFIRMATION";
    public static final String NOT_ENABLED = "NOT_ENABLED";
    public static final String INTEGRATION_PENDING = "INTEGRATION_PENDING";
    public static final String NEEDS_ATTENTION = "NEEDS_ATTENTION";

    // Feature keys.
    public static final String FEATURE_ORDER_READ = "ORDER_READ";
    public static final String FEATURE_REVIEW_IMPORT = "REVIEW_IMPORT";
    public static final String FEATURE_REVIEW_REPLY = "REVIEW_REPLY";
    public static final String FEATURE_INQUIRY_READ = "INQUIRY_READ";

    // Closed reason vocabulary (safe to surface).
    public static final String REASON_CREDENTIAL_MISSING = "CREDENTIAL_MISSING";
    public static final String REASON_FIRST_SYNC_REQUIRED = "FIRST_SYNC_REQUIRED";
    public static final String REASON_SYNC_FAILED = "SYNC_FAILED";
    public static final String REASON_SYNC_IN_PROGRESS = "SYNC_IN_PROGRESS";
    public static final String REASON_GUIDED_EXPORT_ONLY = "GUIDED_EXPORT_ONLY";
    public static final String REASON_REPLY_UNVERIFIED = "REPLY_UNVERIFIED";
    public static final String REASON_INTEGRATION_PENDING = "INTEGRATION_PENDING";

    // firstSyncStatus tokens (mirror SyncJob.status, coarsened).
    public static final String SYNC_STATUS_NONE = "NONE";
    public static final String SYNC_STATUS_SUCCESS = "SUCCESS";
    public static final String SYNC_STATUS_PARTIAL = "PARTIAL";
    public static final String SYNC_STATUS_FAILED = "FAILED";
    public static final String SYNC_STATUS_RUNNING = "RUNNING";

    private static final String LABEL_ORDER = "주문 조회";
    private static final String LABEL_REVIEW_IMPORT = "리뷰 가져오기 (작업 창에서 직접 내보내기)";
    private static final String LABEL_REVIEW_REPLY = "리뷰 답변 (자동 전송 없음 · 미검증)";
    private static final String LABEL_INQUIRY = "문의 조회 (연동 준비 중)";

    private NaverCapabilityEvaluator() {
    }

    /** Latest {@code ORDER_SUMMARY} sync outcome for this account (coarse, persisted). */
    public enum OrderSync {
        /** No order sync has ever run. */
        NONE,
        /** Latest order sync collected rows. */
        SUCCESS,
        /** Latest order sync partially succeeded. */
        PARTIAL,
        /** Latest order sync failed. */
        FAILED,
        /** An order sync is currently running. */
        RUNNING
    }

    /**
     * Derive the sanitized capability view from persisted facts. Order read + identity are driven
     * ONLY by {@code orderSync}; {@code connectionStatus} is reported but never used to claim ORDER
     * read or identity (a successful sync is the sole proof).
     */
    public static ConnectionCapabilityView evaluate(
            UUID sellerAccountId,
            String channelCode,
            ChannelStatus connectionStatus,
            boolean credentialPresent,
            OrderSync orderSync) {

        String orderState;
        String orderReason;
        boolean identityConfirmed;
        String topReason;

        if (!credentialPresent) {
            orderState = NEEDS_ATTENTION;
            orderReason = REASON_CREDENTIAL_MISSING;
            identityConfirmed = false;
            topReason = REASON_CREDENTIAL_MISSING;
        } else {
            switch (orderSync) {
                case SUCCESS, PARTIAL -> {
                    orderState = AVAILABLE;
                    orderReason = null;
                    identityConfirmed = true;
                    topReason = null;
                }
                case FAILED -> {
                    orderState = NEEDS_ATTENTION;
                    orderReason = REASON_SYNC_FAILED;
                    identityConfirmed = false;
                    topReason = REASON_SYNC_FAILED;
                }
                case RUNNING -> {
                    orderState = NEEDS_ATTENTION;
                    orderReason = REASON_SYNC_IN_PROGRESS;
                    identityConfirmed = false;
                    topReason = REASON_SYNC_IN_PROGRESS;
                }
                default -> {
                    orderState = NEEDS_ATTENTION;
                    orderReason = REASON_FIRST_SYNC_REQUIRED;
                    identityConfirmed = false;
                    topReason = REASON_FIRST_SYNC_REQUIRED;
                }
            }
        }

        List<ConnectionCapabilityFeature> features = List.of(
                new ConnectionCapabilityFeature(FEATURE_ORDER_READ, orderState, LABEL_ORDER, orderReason),
                // Fixed NAVER policy — informational labels, never a live claim.
                new ConnectionCapabilityFeature(
                        FEATURE_REVIEW_IMPORT, GUIDED_CONFIRMATION, LABEL_REVIEW_IMPORT, REASON_GUIDED_EXPORT_ONLY),
                new ConnectionCapabilityFeature(
                        FEATURE_REVIEW_REPLY, NOT_ENABLED, LABEL_REVIEW_REPLY, REASON_REPLY_UNVERIFIED),
                new ConnectionCapabilityFeature(
                        FEATURE_INQUIRY_READ, INTEGRATION_PENDING, LABEL_INQUIRY, REASON_INTEGRATION_PENDING));

        boolean overallAvailable = identityConfirmed && AVAILABLE.equals(orderState);

        return new ConnectionCapabilityView(
                sellerAccountId,
                channelCode,
                connectionStatus == null ? null : connectionStatus.name(),
                credentialPresent,
                identityConfirmed,
                // Without a credential on file, a stale sync token must not read as "collected" — a
                // deleted credential coarsens the reported status to NONE so the view stays self-consistent.
                syncToken(credentialPresent ? orderSync : OrderSync.NONE),
                overallAvailable ? AVAILABLE : NEEDS_ATTENTION,
                overallAvailable ? null : topReason,
                features);
    }

    private static String syncToken(OrderSync orderSync) {
        return switch (orderSync) {
            case SUCCESS -> SYNC_STATUS_SUCCESS;
            case PARTIAL -> SYNC_STATUS_PARTIAL;
            case FAILED -> SYNC_STATUS_FAILED;
            case RUNNING -> SYNC_STATUS_RUNNING;
            default -> SYNC_STATUS_NONE;
        };
    }
}
