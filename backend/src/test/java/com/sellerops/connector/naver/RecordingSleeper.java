package com.sellerops.connector.naver;

import java.time.Duration;
import java.util.ArrayList;
import java.util.List;

/**
 * Test {@link Sleeper} that never really blocks: it records each requested
 * duration and advances a {@link MutableTestClock} by that amount, so the pacer
 * sees time pass exactly as it would after a real sleep. The recorded
 * {@link #waits} are how tests assert that (and how much) pacing happened.
 */
final class RecordingSleeper implements Sleeper {

    private final MutableTestClock clock;
    final List<Duration> waits = new ArrayList<>();

    RecordingSleeper(MutableTestClock clock) {
        this.clock = clock;
    }

    @Override
    public void sleep(Duration duration) {
        waits.add(duration);
        clock.advance(duration);
    }
}
