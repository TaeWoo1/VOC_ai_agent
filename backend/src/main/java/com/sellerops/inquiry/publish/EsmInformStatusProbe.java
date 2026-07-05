package com.sellerops.inquiry.publish;

import java.time.Instant;
import java.util.UUID;

/**
 * Port re-querying the exact inquiry to read its current raw {@code informStatus}
 * (e.g. {@code 미처리}/{@code 처리완료}) for verification. Returns null when the
 * inquiry is not found. {@code answerDate} is never consulted.
 */
public interface EsmInformStatusProbe {
    String currentInformStatus(UUID orgId, UUID sellerAccountId, String messageNo, Instant receivedAt);
}
