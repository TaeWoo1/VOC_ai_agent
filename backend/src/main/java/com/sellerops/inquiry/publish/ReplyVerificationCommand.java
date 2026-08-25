package com.sellerops.inquiry.publish;

import java.time.Instant;
import java.util.UUID;

/**
 * Channel-neutral verification request handed to a {@link ChannelReplyAdapter}: which
 * exact inquiry (by external reference + connection identity) to re-query. How the
 * external result is read and judged is entirely the adapter's concern.
 *
 * <p>{@code approvedBody} and {@code providerRef} exist because on some channels "was it answered"
 * is not a field the channel offers — it has to be proven by finding the thing we posted. A board
 * that carries answers as ordinary posts can only be verified by locating the child and comparing
 * it to what the seller approved; an adapter that cannot use them ignores them, and a channel that
 * simply reports an answered flag never looks at them.
 */
public record ReplyVerificationCommand(UUID orgId, UUID sellerAccountId, UUID channelId,
                                       String externalId, Instant receivedAt,
                                       String approvedBody, String providerRef) {
}
