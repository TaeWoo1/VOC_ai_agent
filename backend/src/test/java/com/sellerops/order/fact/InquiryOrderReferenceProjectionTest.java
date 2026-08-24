package com.sellerops.order.fact;

import static org.assertj.core.api.Assertions.assertThat;

import com.sellerops.connector.naver.NaverCustomerInquiriesClient;
import com.sellerops.ingest.canonical.CanonicalInquiry;
import com.sellerops.ingest.canonical.ChannelOrderRef;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Paths;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * What each source actually declares about the order behind an inquiry.
 *
 * <p><b>Three different answers, and none of them is a guess.</b> NAVER 고객 문의 hangs off an order
 * and its contract marks {@code orderId} 필수; a Cafe24 board article MAY carry one; NAVER 상품 문의
 * hangs off a listing and has no order at all. Any source that answered "probably" would be the
 * defect.
 */
class InquiryOrderReferenceProjectionTest {

    @Test
    @DisplayName("NAVER 고객 문의 binds to the one product order when the list names exactly one")
    void aSingleProductOrderIsTheExactIdentity() {
        ChannelOrderRef ref = NaverCustomerInquiriesClient.orderRef("ORD-1", "PO-9");

        assertThat(ref.orderId()).isEqualTo("ORD-1");
        assertThat(ref.productOrderId()).isEqualTo("PO-9");
        assertThat(ref.preferredRef())
                .as("the per-line id is what channel_orders is keyed on")
                .isEqualTo("PO-9");
    }

    @Test
    @DisplayName("a comma-separated list of two binds only at the payment unit")
    void severalProductOrdersFallBackToThePaymentUnit() {
        ChannelOrderRef ref = NaverCustomerInquiriesClient.orderRef("ORD-1", "PO-9,PO-10");

        assertThat(ref.productOrderId())
                .as("no single line is \"이 주문\" when the customer asked about two")
                .isNull();
        assertThat(ref.preferredRef()).isEqualTo("ORD-1");
    }

    @Test
    @DisplayName("a 고객 문의 with no order still declares the lane — absent, not null")
    void theLaneIsDeclaredEvenWhenEmpty() {
        ChannelOrderRef ref = NaverCustomerInquiriesClient.orderRef(null, null);

        assertThat(ref.hasIdentifier()).isFalse();
        assertThat(ref)
                .as("\"this article named no order\" and \"this source does not do orders\" differ")
                .isNotNull();
    }

    @Test
    @DisplayName("the NAVER projection takes the order and still refuses the buyer")
    void theBuyerStaysUnprojected() throws IOException {
        String client = Files.readString(Paths.get(
                "src/main/java/com/sellerops/connector/naver/NaverCustomerInquiriesClient.java"));

        // customerId / customerName are REQUIRED fields on this resource. Taking the order reference
        // is not a reason to start taking them, and the record has no component for either.
        assertThat(client).doesNotContain("@JsonProperty(\"customerId\")");
        assertThat(client).doesNotContain("@JsonProperty(\"customerName\")");
    }

    @Test
    @DisplayName("the Cafe24 REVIEW path declares no order lane at all")
    void reviewsHaveNoOrderLane() throws IOException {
        String reviewMapper = Files.readString(Paths.get(
                "src/main/java/com/sellerops/connector/cafe24/Cafe24BoardArticleMapper.java"));

        assertThat(reviewMapper)
                .as("a purchase review is about a product, and its order is nobody's operational question")
                .doesNotContain("ChannelOrderRef")
                .doesNotContain("orderId");
    }

    @Test
    @DisplayName("a source that declares no lane leaves the ref null, which never clears a binding")
    void aSourceWithNoLaneSaysNothing() {
        CanonicalInquiry legacy = new CanonicalInquiry(null, null, null, "본문", "UNANSWERED",
                java.time.Instant.parse("2026-08-24T00:00:00Z"), "x", 1, "제목", null);

        assertThat(legacy.orderRef())
                .as("null is silence; absent() is a statement")
                .isNull();
    }
}
