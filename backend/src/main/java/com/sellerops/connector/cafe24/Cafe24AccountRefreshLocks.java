package com.sellerops.connector.cafe24;

import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.locks.ReentrantLock;
import java.util.function.Supplier;

/**
 * Per-seller-account serialization for the Cafe24 refresh-token rotation.
 *
 * <p>Cafe24 refresh tokens are single-use: each successful refresh returns a replacement and
 * spends the old one server-side. The collection scheduler admits one run per {@code (account,
 * dataType)}, but the three Cafe24 streams (ORDER_SUMMARY / REVIEW / INQUIRY) are distinct data
 * types, so two of them — plus the capability probe — can run for the same account at the same
 * time. Each independently opens the shared credential and refreshes, and without serialization
 * two callers spend the <i>same</i> refresh token: one wins the rotation, the other gets a
 * spurious {@code invalid_grant} and the connection is wrongly marked dead.
 *
 * <p>This guard holds a per-account lock across the open → refresh → rotate critical section so,
 * within one process, at most one refresh is in flight per account. The second caller then reads
 * the already-rotated token and refreshes cleanly. The lock is intentionally in-process (the
 * pilot runs a single backend host); {@link Cafe24Authorizer} additionally re-reads and retries
 * once on {@code invalid_grant} so a cross-process rotation race is still recovered rather than
 * mistaken for a dead token.
 *
 * <p>The map holds one lightweight {@link ReentrantLock} per account ever refreshed — bounded by
 * the seller-account count, never pruned (pruning would reintroduce the race it exists to close).
 */
public final class Cafe24AccountRefreshLocks {

    private final ConcurrentHashMap<UUID, ReentrantLock> locks = new ConcurrentHashMap<>();

    /** Run {@code action} while holding this account's refresh lock. */
    public <T> T withAccountLock(UUID sellerAccountId, Supplier<T> action) {
        ReentrantLock lock = locks.computeIfAbsent(sellerAccountId, k -> new ReentrantLock());
        lock.lock();
        try {
            return action.get();
        } finally {
            lock.unlock();
        }
    }
}
