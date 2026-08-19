package com.sellerops.auth.password;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayDeque;
import java.util.Deque;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * At most N reset mails per email address per window (in-memory, per JVM). Being throttled changes nothing the
 * caller can see — the endpoint's answer is the same sentence either way (docs/service_readiness_v1.md §2-2).
 */
public class PasswordResetThrottle {

    private final int limit;
    private final Duration window;
    private final Clock clock;
    private final Map<String, Deque<Instant>> hits = new ConcurrentHashMap<>();

    public PasswordResetThrottle(int limit, Duration window, Clock clock) {
        this.limit = limit;
        this.window = window;
        this.clock = clock;
    }

    /** True when this request may send a mail; records the hit. */
    public boolean allow(String key) {
        Instant now = clock.instant();
        Deque<Instant> q = hits.computeIfAbsent(key, k -> new ArrayDeque<>());
        synchronized (q) {
            while (!q.isEmpty() && q.peekFirst().isBefore(now.minus(window))) {
                q.pollFirst();
            }
            if (q.size() >= limit) {
                return false;
            }
            q.addLast(now);
            return true;
        }
    }
}
