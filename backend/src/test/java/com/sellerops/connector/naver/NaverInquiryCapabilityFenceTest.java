package com.sellerops.connector.naver;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.sellerops.connector.ConnectorCapabilities;
import com.sellerops.connector.DataType;
import com.sellerops.connector.FetchRequest;
import com.sellerops.connector.UnsupportedDataTypeException;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.UUID;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * What the NAVER connector says it can do, and why the word it uses matters.
 *
 * <p>{@code SelfPilotReconciler} creates a 60-minute routine schedule for every routine data type a
 * connected account's connector <b>advertises</b>. So "advertise INQUIRY" is not a documentation act —
 * it is, five minutes later, a standing marketplace call. This test pins the two-step fence that keeps
 * those apart: no inquiry client ⇒ no advertisement at all; a wired but unproven client ⇒ advertised
 * as {@code NEEDS_VERIFICATION}, reachable for an operator's approved run and refused by the
 * reconciler.
 */
class NaverInquiryCapabilityFenceTest {

    private static final String BASE_URL = "https://fake.naver.test";
    private static final Clock CLOCK =
            Clock.fixed(Instant.parse("2026-08-24T03:00:00Z"), ZoneOffset.UTC);

    private final FakeNaverHttpClient http = new FakeNaverHttpClient();

    private NaverApiConnector connector(NaverInquiryCollector inquiries) {
        return new NaverApiConnector(
                new NaverTokenClient(http, CLOCK, BASE_URL),
                new NaverOrdersClient(http, CLOCK, BASE_URL, 100),
                new NaverProductsClient(http, CLOCK, BASE_URL),
                inquiries,
                null);
    }

    private NaverInquiryCollector wired() {
        return new NaverInquiryCollector(new NaverProductQnaClient(http, BASE_URL),
                new NaverCustomerInquiriesClient(http, BASE_URL), CLOCK);
    }

    @Test
    @DisplayName("no inquiry source wired: INQUIRY is not offered, rather than offered-and-failing")
    void anUnwiredCapabilityIsNotAdvertised() {
        ConnectorCapabilities capabilities = connector(null).capabilities("NAVER");

        assertThat(capabilities.supports(DataType.INQUIRY)).isFalse();
        assertThat(capabilities.verificationStatus()).doesNotContainKey(DataType.INQUIRY);
    }

    @Test
    @DisplayName("a collector with neither source wired advertises nothing either")
    void anEmptyCollectorIsTheSameAsNoCollector() {
        ConnectorCapabilities capabilities =
                connector(new NaverInquiryCollector(null, null, CLOCK)).capabilities("NAVER");

        assertThat(capabilities.supports(DataType.INQUIRY)).isFalse();
    }

    @Test
    @DisplayName("both resources proven: the type carries the word, and only then")
    void theFoldAcrossTwoResourcesIsTheConservativeOne() {
        // Both 상품 문의 and 고객 문의 were live-proven 2026-08-24, each with only its own flag armed.
        ConnectorCapabilities capabilities = connector(wired()).capabilities("NAVER");

        assertThat(capabilities.supports(DataType.INQUIRY)).isTrue();
        assertThat(capabilities.verificationStatus().get(DataType.INQUIRY)).isEqualTo("CONFIRMED");
        // The other proven ones are untouched by this package.
        assertThat(capabilities.verificationStatus().get(DataType.ORDER_SUMMARY)).isEqualTo("CONFIRMED");
        assertThat(capabilities.verificationStatus().get(DataType.PRODUCT)).isEqualTo("CONFIRMED");
    }

    /**
     * The fold itself, exercised against a source that is NOT proven — the property the two live
     * proofs were run one-source-at-a-time to preserve.
     *
     * <p>Both real sources now read {@code CONFIRMED}, so nothing in production exercises the
     * unproven branch any more. That is exactly when a fence quietly stops being one: the next
     * resource added here starts unproven, and this test is what makes the type-level word notice.
     */
    @Test
    @DisplayName("one unproven resource is enough to hold the whole data type back")
    void anUnprovenResourceHoldsTheTypeBack() {
        assertThat(NaverInquiryCollector.fold("CONFIRMED", "NEEDS_VERIFICATION"))
                .isEqualTo("NEEDS_VERIFICATION");
        assertThat(NaverInquiryCollector.fold("NEEDS_VERIFICATION", "CONFIRMED"))
                .isEqualTo("NEEDS_VERIFICATION");
        assertThat(NaverInquiryCollector.fold("CONFIRMED", "CONFIRMED")).isEqualTo("CONFIRMED");
        // A source that is not wired is not waited on — null means "this connector does not read it".
        assertThat(NaverInquiryCollector.fold("CONFIRMED", null)).isEqualTo("CONFIRMED");
        assertThat(NaverInquiryCollector.fold(null, "NEEDS_VERIFICATION")).isEqualTo("NEEDS_VERIFICATION");
    }

    @Test
    @DisplayName("with only the proven resource wired, the type is CONFIRMED — that is what a proof buys")
    void aSoleProvenResourceCarriesTheTypesWord() {
        NaverInquiryCollector qnaOnly = new NaverInquiryCollector(
                new NaverProductQnaClient(http, BASE_URL), null, CLOCK);

        ConnectorCapabilities capabilities = connector(qnaOnly).capabilities("NAVER");

        assertThat(capabilities.verificationStatus().get(DataType.INQUIRY)).isEqualTo("CONFIRMED");
    }

    @Test
    @DisplayName("with only the customer resource wired, it carries its own proof and no other")
    void aSoleResourceCarriesItsOwnProof() {
        NaverInquiryCollector customerOnly = new NaverInquiryCollector(
                null, new NaverCustomerInquiriesClient(http, BASE_URL), CLOCK);

        ConnectorCapabilities capabilities = connector(customerOnly).capabilities("NAVER");

        assertThat(capabilities.verificationStatus().get(DataType.INQUIRY)).isEqualTo("CONFIRMED");
    }

    @Test
    @DisplayName("an unwired INQUIRY fetch is refused before any HTTP and before the vault is opened")
    void anUnwiredInquiryFetchIsRefusedWithZeroHttp() {
        assertThatThrownBy(() -> connector(null).fetch(new FetchRequest(
                UUID.randomUUID(), UUID.randomUUID(), "NAVER", DataType.INQUIRY, null, 50)))
                .isInstanceOf(UnsupportedDataTypeException.class);

        assertThat(http.sent).isEmpty();
    }

    @Test
    @DisplayName("the capability note names TWO inquiry resources and says TalkTalk is not one of them")
    void theNoteDistinguishesTheResourcesItActuallyHas() {
        String notes = connector(wired()).capabilities("NAVER").notes();

        assertThat(notes).contains("/v1/contents/qnas").contains("/v1/pay-user/inquiries");
        // "NAVER 문의 = UNSUPPORTED" was the claim this package corrects; "NAVER TalkTalk has no
        // Commerce API" is the part of it that was true and stays.
        assertThat(notes).contains("TalkTalk");
    }

    @Test
    @DisplayName("an operator's bounded INQUIRY window is seedable only when a source is wired")
    void boundedSeedingFollowsTheSameFence() {
        java.time.LocalDate from = java.time.LocalDate.parse("2026-08-01");
        java.time.LocalDate to = java.time.LocalDate.parse("2026-08-24");

        assertThat(connector(null).backfillCursor(DataType.INQUIRY, from, to)).isEmpty();
        assertThat(connector(wired()).backfillCursor(DataType.INQUIRY, from, to)).isPresent();
        // An inverted or half-specified window is refused on both lanes, as before.
        assertThat(connector(wired()).backfillCursor(DataType.INQUIRY, to, from)).isEmpty();
        assertThat(connector(wired()).backfillCursor(DataType.INQUIRY, null, to)).isEmpty();
    }
}
