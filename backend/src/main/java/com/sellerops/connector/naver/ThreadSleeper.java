package com.sellerops.connector.naver;

import java.time.Duration;

/**
 * Production {@link Sleeper} over {@link Thread#sleep}. An interrupt restores the
 * flag and aborts the call rather than silently swallowing it — consistent with
 * {@link JdkNaverHttpClient}'s interrupt handling. Only constructed behind the
 * connector flag (see {@link NaverConnectorConfiguration}).
 */
final class ThreadSleeper implements Sleeper {

    @Override
    public void sleep(Duration duration) {
        long millis = duration.toMillis();
        if (millis <= 0) {
            return;
        }
        try {
            Thread.sleep(millis);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException("네이버 API 호출 간격 대기가 중단되었습니다.");
        }
    }
}
