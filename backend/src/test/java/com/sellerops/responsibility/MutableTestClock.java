package com.sellerops.responsibility;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneId;
import java.time.ZoneOffset;

/** A clock the test moves. The runtime reads windows, leases and retries from it; nothing else does. */
final class MutableTestClock extends Clock {

    private volatile Instant now;

    MutableTestClock(Instant start) {
        this.now = start;
    }

    void set(Instant instant) {
        this.now = instant;
    }

    void advance(Duration duration) {
        this.now = now.plus(duration);
    }

    @Override
    public ZoneId getZone() {
        return ZoneOffset.UTC;
    }

    @Override
    public Clock withZone(ZoneId zone) {
        return this;
    }

    @Override
    public Instant instant() {
        return now;
    }
}
