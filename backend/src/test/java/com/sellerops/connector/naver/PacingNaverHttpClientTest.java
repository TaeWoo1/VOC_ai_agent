package com.sellerops.connector.naver;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.net.URI;
import java.time.Duration;
import java.time.Instant;
import java.util.Map;
import org.junit.jupiter.api.Test;

/**
 * The pacing decorator spaces every method (token mint, order GET, detail POST)
 * through one shared pacer, passes responses through untouched, and never alters
 * a 429 — all without real sleeping (the recording sleeper advances a fake clock).
 */
class PacingNaverHttpClientTest {

    private static final URI TOKEN_URI = URI.create("https://fake.naver.test/external/v1/oauth2/token");
    private static final URI GET_URI = URI.create("https://fake.naver.test/external/v1/pay-order/x");
    private static final URI POST_URI = URI.create("https://fake.naver.test/external/v1/pay-order/y");
    private static final Duration ONE_SECOND = Duration.ofSeconds(1);

    private static final Duration FIVE_SECONDS = Duration.ofSeconds(5);

    private final FakeNaverHttpClient delegate = new FakeNaverHttpClient();
    private final MutableTestClock clock = new MutableTestClock(Instant.parse("2026-06-14T00:00:00Z"));
    private final RecordingSleeper sleeper = new RecordingSleeper(clock);
    private final PacingNaverHttpClient paced =
            new PacingNaverHttpClient(delegate, new NaverRequestPacer(clock, sleeper, ONE_SECOND, FIVE_SECONDS));

    @Test
    void firstCallProceedsImmediately() {
        delegate.enqueue(FakeNaverHttpClient.tokenOk("token-1", 3000));

        paced.postForm(TOKEN_URI, Map.of("client_id", "c"));

        assertThat(sleeper.waits).isEmpty();
        assertThat(delegate.sent).hasSize(1);
    }

    @Test
    void tokenThenOrderCallsAreSpacedAcrossEndpointsByTheOnePacer() {
        delegate.enqueue(FakeNaverHttpClient.tokenOk("token-1", 3000)); // postForm (token)
        delegate.enqueue(FakeNaverHttpClient.ok("{\"data\":{}}"));       // get (last-changed)
        delegate.enqueue(FakeNaverHttpClient.ok("{\"data\":[]}"));       // postJson (detail)

        paced.postForm(TOKEN_URI, Map.of("client_id", "c"));
        paced.get(GET_URI, "token-1");
        paced.postJson(POST_URI, "token-1", "{}");

        // First call free; the next two each wait the full interval — token mint
        // and order calls share the same pacer, so spacing is global.
        assertThat(sleeper.waits).containsExactly(ONE_SECOND, ONE_SECOND);
        assertThat(delegate.sent).hasSize(3);
        assertThat(delegate.sent.get(0).method()).isEqualTo("POST_FORM");
        assertThat(delegate.sent.get(1).method()).isEqualTo("GET");
        assertThat(delegate.sent.get(2).method()).isEqualTo("POST_JSON");
    }

    @Test
    void responsesArePassedThroughUnchanged() {
        delegate.enqueue(new NaverHttpClient.Response(200, "{\"ok\":true}", Map.of("X-H", "v")));

        NaverHttpClient.Response response = paced.get(GET_URI, "token-1");

        assertThat(response.statusCode()).isEqualTo(200);
        assertThat(response.body()).isEqualTo("{\"ok\":true}");
        assertThat(response.header("X-H")).contains("v");
    }

    @Test
    void rateLimitedResponseIsReturnedUnaltered() {
        delegate.enqueue(FakeNaverHttpClient.tokenOk("token-1", 3000));
        delegate.enqueue(FakeNaverHttpClient.rateLimited429());

        paced.postForm(TOKEN_URI, Map.of("client_id", "c"));
        NaverHttpClient.Response response = paced.postJson(POST_URI, "token-1", "{}");

        // The decorator paced the call but did not interpret the 429 — callers
        // still see HTTP 429 and apply their own rate-limit handling.
        assertThat(response.statusCode()).isEqualTo(429);
        assertThat(sleeper.waits).containsExactly(ONE_SECOND);
    }

    @Test
    void anExhaustedRemainingHeaderForcesTheNextCallToWaitTheBackoff() {
        // A 200 whose RateLimit-Remaining is 0 must delay the following call by
        // the full exhaustion backoff, not just the ordinary floor interval.
        delegate.enqueue(new NaverHttpClient.Response(
                200, "{\"data\":{}}", Map.of("GNCP-GW-RateLimit-Remaining", "0")));
        delegate.enqueue(FakeNaverHttpClient.ok("{\"data\":{}}"));

        paced.get(GET_URI, "token-1");  // first call free, learns remaining=0
        paced.get(GET_URI, "token-1");  // must wait the backoff window

        assertThat(sleeper.waits).containsExactly(FIVE_SECONDS);
    }

    @Test
    void aHealthyRemainingHeaderLeavesOnlyTheFloorPacing() {
        delegate.enqueue(new NaverHttpClient.Response(
                200, "{\"data\":{}}", Map.of("GNCP-GW-RateLimit-Remaining", "5")));
        delegate.enqueue(FakeNaverHttpClient.ok("{\"data\":{}}"));

        paced.get(GET_URI, "token-1");
        paced.get(GET_URI, "token-1");

        assertThat(sleeper.waits).containsExactly(ONE_SECOND);
    }

    @Test
    void anUnenqueuedCallStillFailsLoudly() {
        // Pacing must not swallow the fake's "unexpected HTTP call" guard.
        assertThatThrownBy(() -> paced.get(GET_URI, "token-1"))
                .isInstanceOf(AssertionError.class);
    }
}
