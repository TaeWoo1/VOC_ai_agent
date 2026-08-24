package com.sellerops.order.fact;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import org.springframework.stereotype.Component;

/**
 * The short-lived memory that stops one seller opening one inquiry from calling the mall twice.
 *
 * <p><b>Why in memory and not in a table.</b> An order state written to a table is a stored fact, and
 * a stored fact gets read later — which is the exact failure this whole area exists to prevent: a
 * row that was true when it was written, cited after it stopped being true. Nothing here survives a
 * restart, nothing here is queryable, and nothing here can be joined to. It is a request-coalescing
 * device with a clock, not a store.
 *
 * <p><b>{@link #TTL} is five minutes, and the number is chosen from the actual duplicate.</b> The
 * duplicate this prevents is a seller opening an inquiry (the detail renders the operational card)
 * and then pressing 초안 생성 seconds later (the drafter grounds in the same order). Both want the
 * same order, both are the same sitting. Five minutes covers that sitting and expires long before a
 * seller comes back after lunch — at which point "현재 확인된 상태입니다" would be a lie, and the
 * mall gets asked again.
 *
 * <p>The key includes the seller account, so two connections to the same mall never share an answer,
 * and the org, so a bug in one tenant cannot surface in another.
 */
@Component
public class OrderFactCache {

    /** How long an observed order state may be reused before it must be re-read. */
    public static final Duration TTL = Duration.ofMinutes(5);

    private record Key(UUID orgId, UUID sellerAccountId, String channelCode, String reference) {
    }

    private record Entry(ExactOrderObservation observation, Instant expiresAt) {
    }

    private final Map<Key, Entry> entries = new ConcurrentHashMap<>();
    private final Clock clock;

    public OrderFactCache() {
        this(Clock.systemUTC());
    }

    /** Test seam: an explicit {@link Clock} pins expiry. */
    public OrderFactCache(Clock clock) {
        this.clock = clock;
    }

    /** A still-valid observation for this exact order, or null. Only successful reads are held. */
    public ExactOrderObservation get(UUID orgId, UUID sellerAccountId, String channelCode,
                                     String reference) {
        Key key = new Key(orgId, sellerAccountId, channelCode, reference);
        Entry entry = entries.get(key);
        if (entry == null) {
            return null;
        }
        if (!entry.expiresAt().isAfter(clock.instant())) {
            entries.remove(key, entry);
            return null;
        }
        return entry.observation();
    }

    /**
     * Remember one successful read.
     *
     * <p><b>Failures are not cached.</b> A rate limit, a timeout or an auth refusal caches nothing:
     * caching them would turn one bad minute into five minutes of "확인할 수 없습니다" for a seller
     * whose connection recovered in between.
     */
    public void put(UUID orgId, UUID sellerAccountId, String channelCode, String reference,
                    ExactOrderObservation observation) {
        if (observation == null || !observation.ok()) {
            return;
        }
        entries.put(new Key(orgId, sellerAccountId, channelCode, reference),
                new Entry(observation, clock.instant().plus(TTL)));
    }

    /** Drop everything. Test seam and a safety valve; never called on a request path. */
    public void clear() {
        entries.clear();
    }
}
