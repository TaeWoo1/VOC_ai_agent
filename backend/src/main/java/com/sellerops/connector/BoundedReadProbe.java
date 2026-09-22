package com.sellerops.connector;

import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

/**
 * <b>A read that cannot become a second page</b> (Full MVP live preflight, 2026-09-22).
 *
 * <p>A live READ approval is written in pages — 「미답변/답변 각 1페이지」 — and {@link PullConnector#fetch} is written
 * in collection semantics: one call may sweep a window until it is exhausted (Coupang), or read whichever of two
 * sources is outstanding (NAVER). Neither can be held to a page count from outside, and a preflight must not change
 * what a production collection means. So a connector whose sources need it offers this instead: <b>each official
 * source it reads for a type, asked for its first page exactly once</b>. There is no page parameter to pass and no
 * cursor to advance — the method has no way to express 「the next one」, which is what makes the approval's bound a
 * property of the code rather than a promise of the caller.
 *
 * <p>Each source answers on its own: one source failing does not stop another being asked, because a preflight
 * exists to learn about each endpoint separately. Nothing is persisted; the caller counts and discards.
 */
public interface BoundedReadProbe {

    /**
     * One entry per official source this connector reads for {@code dataType}, in a fixed order. A source this
     * deployment does not wire is reported ({@code NOT_WIRED}) and not called.
     */
    List<SourcePage> probeFirstPagePerSource(UUID orgId, UUID sellerAccountId, DataType dataType,
                                             LocalDate from, LocalDate to, int pageSize);

    /**
     * What one source's first page showed. {@code morePages} is the provider's own statement that a page after the
     * first exists, {@code null} when it did not say. {@code failure} is kept for classification only and is never
     * rendered — its message may carry a provider body.
     */
    record SourcePage(String source, String outcome, Integer records, Boolean morePages,
                      RuntimeException failure, long elapsedMs) {

        public static final String SUCCESS = "SUCCESS";
        public static final String FAILED = "FAILED";
        public static final String NOT_WIRED = "NOT_WIRED";
        public static final String RATE_LIMITED = "RATE_LIMITED";

        public static SourcePage notWired(String source) {
            return new SourcePage(source, NOT_WIRED, null, null, null, 0);
        }
    }
}
