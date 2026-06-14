package com.sellerops.connector.naver;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;

/**
 * Serializes outbound Naver Commerce API calls so consecutive requests start no
 * closer together than a configured minimum interval, and backs off a full
 * replenish window when the gateway reports an exhausted meter. Naver meters per
 * second per application with a token bucket whose burst capacity borrows from
 * the next second (intro-restriction.md), so the order flow (token mint →
 * last-changed → detail → pagination) otherwise bursts several requests in well
 * under a second and trips HTTP 429. One pacer instance is shared by every
 * {@link NaverHttpClient} call in the process, so the spacing is global, not
 * per-endpoint.
 *
 * <p>Two controls, both honoring the official guidance that limits are dynamic
 * and must be learned from headers rather than assumed:
 * <ul>
 *   <li><b>Floor pacing</b> — {@code minInterval} between call starts keeps the
 *       sustained rate conservatively below the bucket's replenish rate so burst
 *       capacity is never spent.</li>
 *   <li><b>Adaptive backoff</b> — {@link #observe} reads each response's
 *       rate/quota headers; when a meter hits zero, the next call waits a full
 *       {@code exhaustionBackoff} (one replenish window) from that response.</li>
 * </ul>
 *
 * <p>{@code synchronized}: the per-account cadence is low, so a short
 * process-wide lock during pacing is acceptable and keeps spacing correct under
 * a (rare) concurrent run. The {@link Sleeper} is injected so tests advance a
 * fake clock instead of really blocking. A {@code minInterval} of zero disables
 * floor pacing; adaptive backoff still applies when headers demand it.
 */
class NaverRequestPacer {

    private final Clock clock;
    private final Sleeper sleeper;
    private final Duration minInterval;
    private final Duration exhaustionBackoff;
    private Instant nextAllowedAt;

    NaverRequestPacer(Clock clock, Sleeper sleeper, Duration minInterval, Duration exhaustionBackoff) {
        if (minInterval.isNegative()) {
            throw new IllegalArgumentException("네이버 요청 최소 간격은 음수일 수 없습니다.");
        }
        if (exhaustionBackoff.isNegative()) {
            throw new IllegalArgumentException("네이버 요청량 소진 백오프는 음수일 수 없습니다.");
        }
        this.clock = clock;
        this.sleeper = sleeper;
        this.minInterval = minInterval;
        this.exhaustionBackoff = exhaustionBackoff;
    }

    /**
     * Block until the next call is allowed (floor interval, or a pending
     * exhaustion backoff if longer), then schedule the following call at least
     * {@code minInterval} out. Spacing is measured between call starts.
     */
    synchronized void acquire() {
        Instant now = clock.instant();
        if (nextAllowedAt != null && now.isBefore(nextAllowedAt)) {
            sleeper.sleep(Duration.between(now, nextAllowedAt));
            now = nextAllowedAt;
        }
        nextAllowedAt = now.plus(minInterval);
    }

    /**
     * Feed back what the just-received response said about the meters. When a
     * rate or quota meter is exhausted, push the next allowed call out by a full
     * {@code exhaustionBackoff} from now so the bucket can replenish. A snapshot
     * with no usable headers (the common case) is a no-op.
     */
    synchronized void observe(NaverRateLimitSnapshot snapshot) {
        if (snapshot == null || !snapshot.isExhausted()) {
            return;
        }
        Instant backoffUntil = clock.instant().plus(exhaustionBackoff);
        if (nextAllowedAt == null || nextAllowedAt.isBefore(backoffUntil)) {
            nextAllowedAt = backoffUntil;
        }
    }
}
