package com.sellerops.producttruth;

import static org.assertj.core.api.Assertions.assertThat;

import com.sellerops.collect.AcquisitionPathRegistry;
import com.sellerops.collect.dto.ChannelCapabilityOverview.AcquisitionPath;
import com.sellerops.connector.ChannelApiGapRegistry;
import com.sellerops.connector.DataType;
import com.sellerops.connector.UnsupportedScope;
import com.sellerops.inquiry.InquirySourceSubtype;
import com.sellerops.inquiry.publish.InquiryReplyCapabilityRegistry;
import com.sellerops.review.publish.ReviewExecutionCapability;
import com.sellerops.review.publish.ReviewExecutionKind;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.Test;

/**
 * The drift fence for Canonical Product Truth.
 *
 * <p>A ledger that describes a system is a second copy of that system's rules, and second copies rot.
 * These assertions pin the rows that restate a fact the code ALSO states, so the build fails the
 * moment the two disagree — rather than the Agent telling a seller something that stopped being true
 * three releases ago.
 *
 * <p><b>Drift does not rewrite the ledger.</b> The whole point of the ledger is that a stale registry
 * or a switched-off connector must not be able to demote a live-proven capability. So when a pin here
 * fails, the answer is a person deciding which of the two is wrong — never a runtime that silently
 * takes the code's side. That is exactly how a live-proven Coupang inquiry path got demoted to
 * PARTIAL by a {@code NEEDS_VERIFICATION} row nobody had updated.
 *
 * <p><b>What is deliberately NOT pinned:</b> anything whose answer depends on configuration. Cafe24's
 * review execution is {@code API_EXECUTION} only when the execution flag, the connector and this
 * seller's write grant all line up; pinning the ledger against that would make the ledger's value
 * depend on the test environment's flags, which is the confusion this package exists to end.
 */
class ProductTruthDriftTest {

    private static final ProductTruthPack PACK = ProductTruthPack.load();

    // ---- channel facts: what a marketplace does not publish -----------------------------------

    /**
     * Coupang gives sellers no review reply feature. The ledger says NOT_SUPPORTED and the code
     * registry says {@code REVIEW_REPLY}; if either moves alone, this fails.
     */
    @Test
    void coupangReviewExecutionMatchesTheRegisteredChannelGap() {
        List<String> codes = ChannelApiGapRegistry.gapsFor("COUPANG").stream()
                .map(UnsupportedScope::code).toList();
        boolean noReplyFeature = codes.contains("REVIEW_REPLY");
        ProductCapability row = row("COUPANG", "REVIEW", ProductCapabilityAxis.EXECUTION);
        assertThat(row.status() == ProductCapabilityStatus.NOT_SUPPORTED)
                .as("계약과 registry 가 쿠팡 리뷰 답글에 대해 같은 말을 하는가")
                .isEqualTo(noReplyFeature);
    }

    /**
     * Neither NAVER nor Coupang publishes a seller review API — which is why neither channel's review
     * acquisition may be AUTOMATIC, and why Cafe24's may.
     */
    @Test
    void reviewAcquisitionIsAutomaticExactlyWhereTheChannelPublishesAReviewApi() {
        for (String channel : ProductTruthPack.CHANNELS) {
            boolean noReviewApi = ChannelApiGapRegistry.gapsFor(channel).stream()
                    .map(UnsupportedScope::code).anyMatch("REVIEW_API"::equals);
            ProductCapabilityMode mode = row(channel, "REVIEW", ProductCapabilityAxis.ACQUISITION).mode();
            if (noReviewApi) {
                assertThat(mode).as("%s 리뷰 수집", channel).isNotEqualTo(ProductCapabilityMode.AUTOMATIC);
            } else {
                assertThat(mode).as("%s 리뷰 수집", channel).isEqualTo(ProductCapabilityMode.AUTOMATIC);
            }
        }
    }

    // ---- acquisition paths --------------------------------------------------------------------

    /**
     * A channel/type with a registered non-connector path is SELLER_GUIDED in the ledger, and its
     * evidence may not be stronger than the registry's verification.
     */
    @Test
    void registeredAcquisitionPathsMatchTheLedgersModeAndEvidence() {
        for (String channel : ProductTruthPack.CHANNELS) {
            List<AcquisitionPath> paths = AcquisitionPathRegistry.pathsFor(channel, DataType.REVIEW);
            if (paths.isEmpty()) {
                continue;
            }
            ProductCapability row = row(channel, "REVIEW", ProductCapabilityAxis.ACQUISITION);
            assertThat(row.mode()).as("%s 리뷰 취득 방식", channel)
                    .isEqualTo(ProductCapabilityMode.SELLER_GUIDED);
            boolean liveProven = paths.stream()
                    .anyMatch(p -> "LIVE_PROVEN".equals(p.verificationStatus()));
            if (!liveProven) {
                assertThat(row.evidence()).as("%s 리뷰 취득 근거", channel)
                        .isNotEqualTo(ProductEvidence.LIVE_PROVEN);
            }
            // Nothing arrives on its own on a seller-repeated path, and the ledger has to say so.
            assertThat(row.limitations()).as("%s 리뷰 취득 한계", channel).isNotEmpty();
        }
    }

    // ---- inquiry answer transports --------------------------------------------------------------

    /**
     * DIRECT_WITH_APPROVAL in the ledger ⟺ an implemented DIRECT_API transport in the registry.
     *
     * <p>The single-source channels are asked on the parent row; NAVER is asked on its subtype rows,
     * because the registry itself is split there — two contracts with non-overlapping identifier
     * spaces, where an approval for one is not an approval for the other. Asking the NAVER parent
     * would be exactly the generalisation the subtypes exist to prevent.
     */
    @Test
    void inquiryExecutionModeMatchesTheAuditedTransport() {
        InquiryReplyCapabilityRegistry registry = new InquiryReplyCapabilityRegistry();
        for (String channel : List.of("CAFE24", "COUPANG")) {
            assertThat(row(channel, "INQUIRY", ProductCapabilityAxis.EXECUTION).mode()
                    == ProductCapabilityMode.DIRECT_WITH_APPROVAL)
                    .as("%s 문의 답변 전송", channel)
                    .isEqualTo(registry.isImplemented(channel, null));
        }
        assertThat(subtypeMode("NAVER", "INQUIRY", ProductCapabilityAxis.EXECUTION, "PRODUCT_INQUIRY")
                == ProductCapabilityMode.DIRECT_WITH_APPROVAL)
                .as("NAVER 상품 문의 답변 전송")
                .isEqualTo(registry.isImplemented("NAVER", InquirySourceSubtype.NAVER_PRODUCT_QNA));
        assertThat(subtypeMode("NAVER", "INQUIRY", ProductCapabilityAxis.EXECUTION, "CUSTOMER_INQUIRY")
                == ProductCapabilityMode.DIRECT_WITH_APPROVAL)
                .as("NAVER 고객 문의 답변 전송")
                .isEqualTo(registry.isImplemented("NAVER", InquirySourceSubtype.NAVER_CUSTOMER_INQUIRY));
        // 톡톡 has no row in the registry at all, and the ledger has to keep saying there is no path
        // rather than inheriting the parent's SUPPORTED.
        assertThat(registry.isImplemented("NAVER", "NAVER_TALKTALK")).isFalse();
        assertThat(subtypeMode("NAVER", "INQUIRY", ProductCapabilityAxis.EXECUTION, "TALKTALK"))
                .isEqualTo(ProductCapabilityMode.NONE);
    }

    /**
     * NAVER 상품 문의 replaces an existing answer instead of refusing. The ledger has to keep saying
     * so, because it is the one case where the product refuses rather than warns.
     */
    @Test
    void theOverwriteContractStaysInTheLedgersLimitations() {
        InquiryReplyCapabilityRegistry registry = new InquiryReplyCapabilityRegistry();
        assertThat(registry.overwritesExistingAnswer("NAVER", InquirySourceSubtype.NAVER_PRODUCT_QNA))
                .isTrue();
        assertThat(row("NAVER", "INQUIRY", ProductCapabilityAxis.EXECUTION).limitations())
                .anySatisfy(l -> assertThat(l).contains("수정으로 동작"));
    }

    // ---- review execution ------------------------------------------------------------------------

    /**
     * The two review-execution answers that do not depend on configuration.
     *
     * <p>NAVER is a guided browser flow whatever the deployment does, and a channel with no reply
     * feature is refused by the default branch. Cafe24 is left out on purpose — its answer is
     * configuration, and configuration is the runtime overlay's business, not this ledger's.
     */
    @Test
    void configurationIndependentReviewExecutionMatchesTheCode() {
        ReviewExecutionCapability capability = ReviewExecutionCapability.disabled();
        UUID org = UUID.randomUUID();
        UUID account = UUID.randomUUID();

        assertThat(capability.of(org, account, "NAVER").kind())
                .isEqualTo(ReviewExecutionKind.GUIDED_BROWSER_EXECUTION);
        assertThat(row("NAVER", "REVIEW", ProductCapabilityAxis.EXECUTION).mode())
                .isEqualTo(ProductCapabilityMode.GUIDED_WITH_APPROVAL);

        assertThat(capability.of(org, account, "COUPANG").kind())
                .isEqualTo(ReviewExecutionKind.NOT_SUPPORTED);
        assertThat(row("COUPANG", "REVIEW", ProductCapabilityAxis.EXECUTION).mode())
                .isEqualTo(ProductCapabilityMode.NONE);
    }

    /**
     * Cafe24's review comment lane really is built — the ledger claims a capability, not a live
     * proof, and the two claims are different rows in this record.
     */
    @Test
    void cafe24ReviewExecutionIsClaimedAsBuiltAndNotAsLiveProven() {
        ProductCapability row = row("CAFE24", "REVIEW", ProductCapabilityAxis.EXECUTION);
        assertThat(row.status()).isEqualTo(ProductCapabilityStatus.SUPPORTED);
        assertThat(row.mode()).isEqualTo(ProductCapabilityMode.DIRECT_WITH_APPROVAL);
        assertThat(row.evidence()).isEqualTo(ProductEvidence.IMPLEMENTED);
        assertThat(row.limitations())
                .anySatisfy(l -> assertThat(l).contains("게시한 적이 없습니다"));
    }

    // ---- exact order lookup -----------------------------------------------------------------------

    /**
     * Exact single-order lookup exists for exactly one channel, and the ledger must not let it read
     * as a general order capability.
     */
    @Test
    void exactOrderLookupIsClaimedOnlyWhereAContractIsVendored() {
        for (String channel : ProductTruthPack.CHANNELS) {
            boolean available = com.sellerops.order.fact.ExactOrderLookupCapability.isAvailable(channel);
            List<String> notes = row(channel, "ORDER", ProductCapabilityAxis.READ).sellerFacingNotes();
            boolean claimsExact = notes.stream().anyMatch(n -> n.contains("주문 하나를 정확히"));
            assertThat(claimsExact).as("%s 단건 정확 조회 주장", channel).isEqualTo(available);
        }
    }

    /** No channel's order row may claim line items, shipping detail, customer detail or edits. */
    @Test
    void noOrderRowClaimsWhatTheProductDoesNotHold() {
        for (String channel : ProductTruthPack.CHANNELS) {
            ProductCapability read = row(channel, "ORDER", ProductCapabilityAxis.READ);
            assertThat(read.limitations()).as("%s 주문 한계", channel).isNotEmpty();
            assertThat(row(channel, "ORDER", ProductCapabilityAxis.EXECUTION).mode())
                    .as("%s 주문 실행", channel).isEqualTo(ProductCapabilityMode.NONE);
        }
    }

    private static ProductCapabilityMode subtypeMode(String channel, String object,
                                                     ProductCapabilityAxis axis, String key) {
        return row(channel, object, axis).subtypes().stream()
                .filter(s -> s.key().equals(key)).findFirst()
                .orElseThrow(() -> new AssertionError("subtype 이 없습니다: " + key))
                .mode();
    }

    private static ProductCapability row(String channel, String object, ProductCapabilityAxis axis) {
        return PACK.capability(channel, object, axis).orElseThrow(
                () -> new AssertionError("행이 없습니다: " + channel + "." + object + "." + axis));
    }
}
