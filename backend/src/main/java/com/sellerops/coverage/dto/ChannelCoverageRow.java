package com.sellerops.coverage.dto;

import com.sellerops.coverage.ChannelDataState;
import java.time.Instant;

/**
 * What one channel can currently say about one data type — capability, connection, routine, and rows.
 *
 * <p><b>Every field is a fact this backend already holds; none is a judgement about the seller's
 * business.</b> The derived {@code state} is the only composed value, and the four facts it is
 * composed from ride along beside it so a caller can say WHY, not just WHAT — "네이버 문의는 자동
 * 수집이 멈춰 있습니다" is a different sentence from "쿠팡은 리뷰 API가 없습니다", and a bare enum
 * would make them the same sentence.
 *
 * @param channelCode the catalogue code (NAVER / COUPANG / CAFE24)
 * @param channelNameKo the seller-facing channel name
 * @param dataType INQUIRY / REVIEW / ORDER_SUMMARY
 * @param state the derived freshness verdict — see {@link ChannelDataState}
 * @param supported whether the CHANNEL offers this data type (declared capability, not local wiring)
 * @param verificationStatus the declared capability's verification word, or null
 * @param connected whether this org holds a CONNECTED account on the channel
 * @param connectionStatus the account's status word, or null when the org has no account here
 * @param routineEnabled whether an enabled routine schedule exists for this (account, data type)
 * @param routinePausedBy null / OPERATOR / SYSTEM — who stopped it, when it is stopped
 * @param lastSuccessfulSyncAt the newest SUCCESS/PARTIAL run for this (channel, data type)
 * @param rows how many rows this org holds for this channel and type (current-truth corpus)
 * @param openRows the subset still needing work (unanswered inquiries / negative reviews); null for orders
 * @param newestObservedAt the newest SOURCE time among those rows — never the read time
 */
public record ChannelCoverageRow(
        String channelCode,
        String channelNameKo,
        String dataType,
        ChannelDataState state,
        boolean supported,
        String verificationStatus,
        boolean connected,
        String connectionStatus,
        boolean routineEnabled,
        String routinePausedBy,
        Instant lastSuccessfulSyncAt,
        long rows,
        Long openRows,
        Instant newestObservedAt) {
}
