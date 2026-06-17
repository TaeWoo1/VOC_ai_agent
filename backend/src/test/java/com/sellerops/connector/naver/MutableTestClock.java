package com.sellerops.connector.naver;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneId;
import java.time.ZoneOffset;

/**
 * A clock the tests advance by hand. {@link RecordingSleeper} advances it on each
 * simulated sleep so the pacer's wall-clock arithmetic behaves exactly as it
 * would in production — without any real waiting.
 */
final class MutableTestClock extends Clock {

    private Instant now;

    MutableTestClock(Instant start) {
        this.now = start;
    }

    void advance(Duration duration) {
        now = now.plus(duration);
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
