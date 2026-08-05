package com.sellerops.connector.cafe24.capability;

import com.sellerops.channel.ChannelStatus;
import com.sellerops.connector.cafe24.Cafe24BoardClassifier.BoardKind;
import com.sellerops.connector.cafe24.Cafe24BoardDiscovery.ClassifiedBoard;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

/**
 * Pure decision matrix for the Cafe24 first-connection capability check. Given the facts the
 * service gathered — connection status, whether a credential row exists, the outcome of a live
 * authorize+board-read probe, the discovered boards, and the latest order-sync outcome — it
 * derives each feature's {@code AVAILABLE / NEEDS_ATTENTION / NOT_ENABLED} state and the
 * connection-verified rollup. No I/O, no Spring, no secrets: this is where every honest-state
 * rule lives so it can be exhaustively unit-tested offline.
 *
 * <p><b>Two rules that matter for safety:</b>
 * <ul>
 *   <li><b>Order read is decoupled from community read.</b> {@code ORDER_READ} is driven only by
 *       the order-sync outcome and never by board discovery, so a successful order sync can never
 *       stand in as proof of {@code mall.read_community} (and vice-versa).</li>
 *   <li><b>The 1:1 board is never a feature.</b> {@code INQUIRY_COLLECT} matches the product-inquiry
 *       board number <i>only</i>; the 1:1 board also trips the classifier's inquiry keywords, so we
 *       match by board number, never by kind alone, and emit no feature for the excluded board.</li>
 * </ul>
 */
public final class Cafe24CapabilityEvaluator {

    public static final String AVAILABLE = "AVAILABLE";
    public static final String NEEDS_ATTENTION = "NEEDS_ATTENTION";
    public static final String NOT_ENABLED = "NOT_ENABLED";

    public static final String FEATURE_ORDER = "ORDER_READ";
    public static final String FEATURE_INQUIRY = "INQUIRY_COLLECT";
    public static final String FEATURE_REVIEW = "REVIEW_COLLECT";
    public static final String FEATURE_ISSUE = "ISSUE_ANALYSIS";
    public static final String FEATURE_INQUIRY_REPLY = "INQUIRY_REPLY";
    public static final String FEATURE_EXCLUDED = "ONE_TO_ONE_EXCLUDED";

    // Closed reason vocabulary (safe to surface).
    public static final String REASON_NOT_CONNECTED = "NOT_CONNECTED";
    public static final String REASON_CONNECTION_INCOMPLETE = "CONNECTION_INCOMPLETE";
    public static final String REASON_RECONNECT_REQUIRED = "RECONNECT_REQUIRED";
    public static final String REASON_SCOPE_INSUFFICIENT = "SCOPE_INSUFFICIENT";
    public static final String REASON_CREDENTIAL_MISSING = "CREDENTIAL_MISSING";
    public static final String REASON_PROVIDER_ERROR = "PROVIDER_ERROR";
    public static final String REASON_BOARD_MAPPING_MISMATCH = "BOARD_MAPPING_MISMATCH";
    public static final String REASON_FIRST_SYNC_REQUIRED = "FIRST_SYNC_REQUIRED";
    public static final String REASON_SYNC_FAILED = "SYNC_FAILED";
    public static final String REASON_SYNC_IN_PROGRESS = "SYNC_IN_PROGRESS";
    public static final String REASON_READ_ONLY_CONNECTION = "READ_ONLY_CONNECTION";
    public static final String REASON_NEEDS_VOC_SOURCES = "NEEDS_VOC_SOURCES";

    private static final String LABEL_ORDER = "주문 조회";
    private static final String LABEL_INQUIRY = "문의 수집";
    private static final String LABEL_REVIEW = "리뷰 수집";
    private static final String LABEL_ISSUE = "운영 이슈 분석";
    private static final String LABEL_INQUIRY_REPLY = "문의 답변 API (읽기 전용 연결에서는 미활성화)";
    private static final String LABEL_EXCLUDED = "1:1 맞춤상담 게시판은 수집하지 않습니다";

    /** Outcome of the live authorize + board-read probe. */
    public enum AuthProbe {
        /** Vault opened, token granted, boards read. */
        OK,
        /** Credential/config could not authorize — the seller must reconnect. */
        AUTH_FAILED,
        /**
         * The credential authorizes but the granted scopes do not cover the read, as reported by a
         * standard OAuth2 {@code invalid_scope}/{@code insufficient_scope} on the <b>token endpoint</b>.
         * Distinct from AUTH_FAILED: re-consenting with the same scopes will not fix it — a permission
         * is missing. Note: a scope denial that surfaces only on a <i>resource</i> call (e.g. a 403 on
         * board discovery) is NOT classified here — without a live-verified scope-error body we do not
         * guess, so it stays AUTH_FAILED/RECONNECT_REQUIRED (a known, conservative follow-up).
         */
        SCOPE_INSUFFICIENT,
        /** A transient provider error (e.g. rate limit) — retry later, do not reconnect. */
        PROVIDER_ERROR,
        /** Probe was not run (connection not ready). */
        NOT_ATTEMPTED
    }

    /** Latest ORDER_SUMMARY sync outcome for this account. */
    public enum OrderProbe {
        /** No order sync has ever run. */
        NONE,
        /** Latest order sync collected rows (SUCCESS or PARTIAL). */
        OK,
        /** Latest order sync failed. */
        FAILED,
        /** An order sync is currently running. */
        RUNNING
    }

    private Cafe24CapabilityEvaluator() {
    }

    /**
     * @param boards discovered boards, non-null only when {@code authProbe == OK}; may be empty
     * @param reviewBoardNo  canonical review board number (from the connector's board mapper)
     * @param inquiryBoardNo canonical product-inquiry board number (from the connector's board mapper)
     */
    public static Cafe24ConnectionCapabilityView evaluate(
            UUID sellerAccountId,
            ChannelStatus connectionStatus,
            boolean credentialPresent,
            AuthProbe authProbe,
            List<ClassifiedBoard> boards,
            OrderProbe orderProbe,
            int reviewBoardNo,
            int inquiryBoardNo) {

        boolean connected = connectionStatus == ChannelStatus.CONNECTED;

        // --- gate: connection + credential + live authorize ---
        boolean credentialDecryptable = false;
        boolean identityConfirmed = false;
        String blockReason;
        if (!connected) {
            blockReason = connectionReason(connectionStatus);
        } else if (!credentialPresent) {
            blockReason = REASON_CREDENTIAL_MISSING;
        } else {
            switch (authProbe) {
                case OK -> {
                    credentialDecryptable = true;
                    identityConfirmed = true;
                    blockReason = null;
                }
                case PROVIDER_ERROR -> blockReason = REASON_PROVIDER_ERROR;
                case SCOPE_INSUFFICIENT -> blockReason = REASON_SCOPE_INSUFFICIENT;
                case AUTH_FAILED -> blockReason = REASON_RECONNECT_REQUIRED;
                default -> blockReason = REASON_CONNECTION_INCOMPLETE;
            }
        }

        // --- community boards (only trustworthy when the live probe succeeded) ---
        String reviewState;
        String reviewReason;
        String inquiryState;
        String inquiryReason;
        if (credentialDecryptable && boards != null) {
            boolean reviewOk = matches(boards, reviewBoardNo, BoardKind.REVIEW_BEARING);
            boolean inquiryOk = matches(boards, inquiryBoardNo, BoardKind.INQUIRY_BEARING);
            reviewState = reviewOk ? AVAILABLE : NEEDS_ATTENTION;
            reviewReason = reviewOk ? null : REASON_BOARD_MAPPING_MISMATCH;
            inquiryState = inquiryOk ? AVAILABLE : NEEDS_ATTENTION;
            inquiryReason = inquiryOk ? null : REASON_BOARD_MAPPING_MISMATCH;
        } else {
            reviewState = NEEDS_ATTENTION;
            reviewReason = blockReason;
            inquiryState = NEEDS_ATTENTION;
            inquiryReason = blockReason;
        }

        // --- order read: driven ONLY by order-sync history, never by community ---
        String orderState;
        String orderReason;
        if (!connected) {
            orderState = NEEDS_ATTENTION;
            orderReason = connectionReason(connectionStatus);
        } else {
            switch (orderProbe) {
                case OK -> {
                    orderState = AVAILABLE;
                    orderReason = null;
                }
                case FAILED -> {
                    orderState = NEEDS_ATTENTION;
                    orderReason = REASON_SYNC_FAILED;
                }
                case RUNNING -> {
                    orderState = NEEDS_ATTENTION;
                    orderReason = REASON_SYNC_IN_PROGRESS;
                }
                default -> {
                    orderState = NEEDS_ATTENTION;
                    orderReason = REASON_FIRST_SYNC_REQUIRED;
                }
            }
        }

        // --- issue analysis: derived, needs both VOC sources ---
        boolean issueOk = AVAILABLE.equals(reviewState) && AVAILABLE.equals(inquiryState);
        String issueState = issueOk ? AVAILABLE : NEEDS_ATTENTION;
        String issueReason = issueOk ? null : REASON_NEEDS_VOC_SOURCES;

        List<Cafe24CapabilityFeature> features = new ArrayList<>();
        features.add(new Cafe24CapabilityFeature(FEATURE_ORDER, orderState, LABEL_ORDER, orderReason));
        features.add(new Cafe24CapabilityFeature(FEATURE_INQUIRY, inquiryState, LABEL_INQUIRY, inquiryReason));
        features.add(new Cafe24CapabilityFeature(FEATURE_REVIEW, reviewState, LABEL_REVIEW, reviewReason));
        features.add(new Cafe24CapabilityFeature(FEATURE_ISSUE, issueState, LABEL_ISSUE, issueReason));
        // Structural NOT_ENABLED — read-only connection, no write scope; 1:1 board never collected.
        features.add(new Cafe24CapabilityFeature(
                FEATURE_INQUIRY_REPLY, NOT_ENABLED, LABEL_INQUIRY_REPLY, REASON_READ_ONLY_CONNECTION));
        features.add(new Cafe24CapabilityFeature(FEATURE_EXCLUDED, NOT_ENABLED, LABEL_EXCLUDED, null));

        boolean connectionVerified = credentialDecryptable && identityConfirmed
                && AVAILABLE.equals(reviewState) && AVAILABLE.equals(inquiryState);
        String overall = connectionVerified ? AVAILABLE : NEEDS_ATTENTION;

        return new Cafe24ConnectionCapabilityView(
                sellerAccountId,
                connectionStatus == null ? null : connectionStatus.name(),
                credentialPresent,
                credentialDecryptable,
                identityConfirmed,
                /* excludedBoardHidden */ true,
                connectionVerified,
                overall,
                connectionVerified ? null : blockReason,
                List.copyOf(features));
    }

    private static boolean matches(List<ClassifiedBoard> boards, int boardNo, BoardKind expected) {
        return boards.stream().anyMatch(b -> b.boardNo() == boardNo && b.kind() == expected);
    }

    private static String connectionReason(ChannelStatus status) {
        if (status == ChannelStatus.RECONNECT_REQUIRED) {
            return REASON_RECONNECT_REQUIRED;
        }
        if (status == ChannelStatus.PENDING) {
            return REASON_CONNECTION_INCOMPLETE;
        }
        return REASON_NOT_CONNECTED;
    }
}
