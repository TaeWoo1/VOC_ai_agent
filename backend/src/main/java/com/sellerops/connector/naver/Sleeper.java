package com.sellerops.connector.naver;

import java.time.Duration;

/**
 * Injectable sleep so {@link NaverRequestPacer} is unit-testable without real
 * waiting. Production uses {@link ThreadSleeper}; tests substitute a fake that
 * records the requested durations and advances a fake clock instead of blocking.
 */
@FunctionalInterface
interface Sleeper {

    /** Block for {@code duration}. A non-positive duration must be a no-op. */
    void sleep(Duration duration);
}
