package com.sellerops.inquiry.publish;

import java.time.Instant;
import java.util.UUID;

/**
 * Channel-neutral verification request handed to a {@link ChannelReplyAdapter}: which
 * exact inquiry (by external reference + connection identity) to re-query. How the
 * external result is read and judged is entirely the adapter's concern.
 */
public record ReplyVerificationCommand(UUID orgId, UUID sellerAccountId, UUID channelId,
                                       String externalId, Instant receivedAt) {
}
