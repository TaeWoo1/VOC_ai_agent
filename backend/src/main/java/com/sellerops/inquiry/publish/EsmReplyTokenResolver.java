package com.sellerops.inquiry.publish;

import java.time.Instant;
import java.util.UUID;

/**
 * Port resolving the transient per-inquiry reply token AT SEND TIME by re-querying
 * the inquiry window derived from the inquiry's stored {@code receivedAt} and
 * matching the exact {@code messageNo} + SellerAccount identity. The token is never
 * persisted; callers use it immediately and discard it. Throws when unresolvable.
 */
public interface EsmReplyTokenResolver {
    String resolve(UUID orgId, UUID sellerAccountId, String messageNo, Instant receivedAt);
}
