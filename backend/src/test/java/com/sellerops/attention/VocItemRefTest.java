package com.sellerops.attention;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.sellerops.common.ApiException;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

/**
 * The ref format, as a pure unit — no Spring, no DB. This is the boundary a client-supplied
 * string crosses before any lookup happens, so its failure modes are worth owning here
 * rather than only through the route.
 */
class VocItemRefTest {

    private final UUID reviewId = UUID.randomUUID();

    @Test
    void aMintedReviewRefRoundTripsBackToTheSameId() {
        // The only property that ultimately matters: what the drill-down hands out is what
        // the decision endpoint can resolve.
        assertThat(VocItemRef.parseReviewId(VocItemRef.forReview(reviewId))).isEqualTo(reviewId);
    }

    @Test
    void aMintedRefIsSourceQualifiedAndCarriesNothingButTheId() {
        String ref = VocItemRef.forReview(reviewId);

        assertThat(ref).isEqualTo("review:" + reviewId);
        // Pinned as a literal on purpose: the prefix IS the contract with clients that
        // round-trip it, and with any future store that becomes addressable. Deriving the
        // expectation from the constant would let a rename pass silently and break every
        // stored/echoed ref.
        assertThat(ref).startsWith("review:");
    }

    @ParameterizedTest
    @ValueSource(strings = {
            "",                                        // empty
            "   ",                                     // blank
            "not-a-ref",                               // no separator at all
            ":" + "6f1c8b1e-0000-4000-8000-000000000000", // no source
            "review:",                                 // no id
            "review:not-a-uuid",                       // separator, right source, bad id
            "review:123",                              // numeric, still not a uuid
    })
    void aMalformedRefIsRejectedBeforeAnythingIsLookedUp(String raw) {
        assertThatThrownBy(() -> VocItemRef.parseReviewId(raw))
                .isInstanceOf(ApiException.class);
    }

    @Test
    void aNullRefIsRejectedRatherThanTreatedAsAnUnaddressableRow() {
        // A null actionRef on a ROW means "not addressable" (a Cafe24 article). A null
        // arriving AS a ref is a client error — the two must not be confused, or a client
        // that dropped the field would look like it addressed something.
        assertThatThrownBy(() -> VocItemRef.parseReviewId(null))
                .isInstanceOf(ApiException.class);
    }

    @Test
    void aWellFormedRefForAnUnsupportedSourceIsRejectedAsUnsupportedNotAsMissing() {
        // The shape a Cafe24 community article would have if that store were ever
        // addressable. It is well-formed and simply not triageable today, and the message
        // has to say so: answering "not found" would imply the row might exist somewhere
        // and invite a retry that can never succeed.
        String articleRef = "article:" + UUID.randomUUID();

        assertThatThrownBy(() -> VocItemRef.parseReviewId(articleRef))
                .isInstanceOf(ApiException.class)
                .hasMessageContaining("처리 상태를 기록할 수 없습니다");
    }

    @Test
    void surroundingWhitespaceIsToleratedButTheSourceIsNot() {
        // Tolerant of transport noise, strict about meaning.
        assertThat(VocItemRef.parseReviewId("  review:" + reviewId + "  ")).isEqualTo(reviewId);
        assertThatThrownBy(() -> VocItemRef.parseReviewId("Review:" + reviewId))
                .isInstanceOf(ApiException.class);
    }

    @Test
    void parsingIsLenientAboutUuidGroupWidthsAndThatIsDeliberate() {
        // Pins the gap the javadoc admits to: UUID.fromString accepts abbreviated groups, so
        // this parses even though forReview could never mint it. Asserted rather than left
        // as a claim, because the doc explains WHY it is tolerated — the id is
        // authorization-neutral and 404s like any other unaddressable ref — and that
        // reasoning is only sound while this really is the behaviour.
        assertThat(VocItemRef.parseReviewId("review:1-1-1-1-1"))
                .isEqualTo(UUID.fromString("00000001-0001-0001-0001-000000000001"));
        // Two spellings, one id: aliasing is possible and harmless (idempotency keys off
        // commandId, never the ref).
        assertThat(VocItemRef.parseReviewId("review:00000001-0001-0001-0001-000000000001"))
                .isEqualTo(VocItemRef.parseReviewId("review:1-1-1-1-1"));
    }

    @Test
    void anIdBearingExtraSeparatorsDoesNotSilentlyTruncate() {
        // Split on the FIRST separator, then demand the whole remainder parse as a UUID —
        // so a ref with a smuggled suffix is rejected, not quietly read as its prefix.
        assertThatThrownBy(() -> VocItemRef.parseReviewId("review:" + reviewId + ":extra"))
                .isInstanceOf(ApiException.class);
    }
}
