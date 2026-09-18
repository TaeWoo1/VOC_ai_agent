package com.sellerops.product.detail;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.sellerops.channel.Channel;
import com.sellerops.channel.ChannelRepository;
import com.sellerops.connector.naver.NaverProductDetail;
import com.sellerops.product.ChannelProduct;
import com.sellerops.product.ChannelProductRepository;
import com.sellerops.selleraccount.SellerAccount;
import com.sellerops.selleraccount.SellerAccountRepository;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * The caller {@link ProductDetailEnrichment} did not have, and the three conditions that bound it.
 *
 * <p>What these cases protect is a negative: that connecting the text lane to the seller's path did
 * not connect the catalogue to it. Every test below is either "one request" or "no request".
 */
class ProductDetailEnrichmentTriggerTest {

    private final UUID org = UUID.randomUUID();
    private final UUID productId = UUID.randomUUID();
    private final UUID channelId = UUID.randomUUID();
    private final UUID accountId = UUID.randomUUID();

    private ProductDetailEnrichment enrichment;
    private ChannelProductRepository listings;
    private ChannelRepository channels;
    private SellerAccountRepository accounts;
    private RecordingSource source;

    @BeforeEach
    void setUp() {
        enrichment = mock(ProductDetailEnrichment.class);
        listings = mock(ChannelProductRepository.class);
        channels = mock(ChannelRepository.class);
        accounts = mock(SellerAccountRepository.class);
        source = new RecordingSource();

        when(enrichment.needsEnrichment(any(), any(), any())).thenReturn(true);
        when(enrichment.apply(any(), any(), any(), any(), any(), any(), any(), any()))
                .thenReturn(new ProductDetailEnrichment.Result(
                        ProductDetailEnrichment.Outcome.TEXT_INDEXED,
                        DetailContentShape.classify("<p>" + "가".repeat(400) + "</p>"), 20, 26));

        ChannelProduct listing = new ChannelProduct();
        listing.setOrgId(org);
        listing.setProductId(productId);
        listing.setChannelId(channelId);
        listing.setExternalProductId("13250364547");
        when(listings.findByOrgIdAndProductId(org, productId)).thenReturn(List.of(listing));

        Channel channel = new Channel();
        channel.setCode("NAVER");
        when(channels.findById(channelId)).thenReturn(Optional.of(channel));

        SellerAccount account = new SellerAccount();
        account.setOrgId(org);
        account.setChannelId(channelId);
        when(accounts.findByOrgIdAndChannelId(org, channelId)).thenReturn(Optional.of(account));
    }

    private ProductDetailEnrichmentTrigger trigger(boolean enabled, List<ProductDetailSource> sources) {
        return new ProductDetailEnrichmentTrigger(enrichment, listings, channels, accounts, sources,
                Clock.fixed(Instant.parse("2026-08-26T00:00:00Z"), ZoneOffset.UTC), enabled);
    }

    private ProductDetailEnrichmentTrigger trigger() {
        return trigger(true, List.of(source));
    }

    @Test
    @DisplayName("all three conditions hold — exactly one listing is read and applied")
    void oneRequestWhenNeeded() {
        var result = trigger().enrichIfNeeded(org, productId);

        assertThat(result.outcome()).isEqualTo(ProductDetailEnrichmentTrigger.Outcome.APPLIED);
        assertThat(source.reads).containsExactly("13250364547");
        verify(enrichment, times(1)).apply(eq(org), eq(channelId), eq(productId), eq("13250364547"),
                eq("NAVER:PRODUCT_API:v1"), eq("NAVER:PRODUCT_API:v1/detail"), any(), any());
    }

    @Test
    @DisplayName("fresh detail knowledge — no request, and that is the common case")
    void freshKnowledgeMakesNoRequest() {
        when(enrichment.needsEnrichment(any(), any(), any())).thenReturn(false);

        assertThat(trigger().enrichIfNeeded(org, productId).outcome())
                .isEqualTo(ProductDetailEnrichmentTrigger.Outcome.NOT_NEEDED);
        assertThat(source.reads).isEmpty();
    }

    @Test
    @DisplayName("the switch is off, or no channel can read a 상세페이지 — no request, no repository touch")
    void disabledMakesNoRequest() {
        assertThat(trigger(false, List.of(source)).enrichIfNeeded(org, productId).outcome())
                .isEqualTo(ProductDetailEnrichmentTrigger.Outcome.DISABLED);
        assertThat(trigger(true, List.of()).enrichIfNeeded(org, productId).outcome())
                .isEqualTo(ProductDetailEnrichmentTrigger.Outcome.DISABLED);
        assertThat(source.reads).isEmpty();
        verify(enrichment, never()).needsEnrichment(any(), any(), any());
    }

    @Test
    @DisplayName("no product means nothing to read")
    void noProductMakesNoRequest() {
        assertThat(trigger().enrichIfNeeded(org, null).outcome())
                .isEqualTo(ProductDetailEnrichmentTrigger.Outcome.DISABLED);
        assertThat(source.reads).isEmpty();
    }

    @Test
    @DisplayName("a Cafe24-only product has no 상세페이지 source, and asking again is cheap-gated")
    void noCapableListing() {
        Channel cafe24 = new Channel();
        cafe24.setCode("CAFE24");
        when(channels.findById(channelId)).thenReturn(Optional.of(cafe24));

        var trigger = trigger();
        assertThat(trigger.enrichIfNeeded(org, productId).outcome())
                .isEqualTo(ProductDetailEnrichmentTrigger.Outcome.NO_CAPABLE_LISTING);
        assertThat(trigger.enrichIfNeeded(org, productId).outcome())
                .as("the second ask does not re-run the resolution")
                .isEqualTo(ProductDetailEnrichmentTrigger.Outcome.NOT_NEEDED);
        assertThat(source.reads).isEmpty();
    }

    @Test
    @DisplayName("a listing with no connected account is not read")
    void noAccount() {
        when(accounts.findByOrgIdAndChannelId(org, channelId)).thenReturn(Optional.empty());

        assertThat(trigger().enrichIfNeeded(org, productId).outcome())
                .isEqualTo(ProductDetailEnrichmentTrigger.Outcome.NO_ACCOUNT);
        assertThat(source.reads).isEmpty();
    }

    @Test
    @DisplayName("a channel failure never escapes — the draft path must not fail with it")
    void readFailureIsIsolated() {
        source.failWith = new IllegalStateException("네이버 상품 API 권한이 없습니다.");

        assertThat(trigger().enrichIfNeeded(org, productId).outcome())
                .isEqualTo(ProductDetailEnrichmentTrigger.Outcome.READ_FAILED);
        verify(enrichment, never()).apply(any(), any(), any(), any(), any(), any(), any(), any());
    }

    @Test
    @DisplayName("a refusal of THIS CALLER is its own outcome, with its reason — a caller reading many stops on it")
    void callerRefusalIsTyped() {
        source.failWith = new ChannelAccessRefused(ChannelAccessRefused.Reason.ENVIRONMENT_NOT_ALLOWED, null);

        ProductDetailEnrichmentTrigger.Result result = trigger().enrichIfNeeded(org, productId);

        assertThat(result.outcome()).isEqualTo(ProductDetailEnrichmentTrigger.Outcome.CHANNEL_REFUSED);
        assertThat(result.refusal()).isEqualTo(ChannelAccessRefused.Reason.ENVIRONMENT_NOT_ALLOWED);
        verify(enrichment, never()).apply(any(), any(), any(), any(), any(), any(), any(), any());
    }

    @Test
    @DisplayName("a listing the channel no longer has is an absence, never a deletion")
    void notFoundWritesNothing() {
        source.returnNull = true;

        assertThat(trigger().enrichIfNeeded(org, productId).outcome())
                .isEqualTo(ProductDetailEnrichmentTrigger.Outcome.NOT_FOUND);
        verify(enrichment, never()).apply(any(), any(), any(), any(), any(), any(), any(), any());
    }

    @Test
    @DisplayName("a page that is pictures writes nothing — and is not re-read on the next draft")
    void imageOnlyPagesAreNotReReadImmediately() {
        when(enrichment.apply(any(), any(), any(), any(), any(), any(), any(), any()))
                .thenReturn(new ProductDetailEnrichment.Result(
                        ProductDetailEnrichment.Outcome.IMAGE_ONLY,
                        DetailContentShape.classify("<img src=\"https://cdn/a.jpg\">"), 20, 26));

        var trigger = trigger();
        var first = trigger.enrichIfNeeded(org, productId);
        assertThat(first.needsImageUnderstanding()).isTrue();

        // Enrichment stores nothing for an image-only page, so staleness never clears. Without the
        // attempt memory every subsequent draft on this product would spend another request.
        assertThat(trigger.enrichIfNeeded(org, productId).outcome())
                .isEqualTo(ProductDetailEnrichmentTrigger.Outcome.NOT_NEEDED);
        assertThat(source.reads).hasSize(1);
    }

    @Test
    @DisplayName("the default is OFF — an ordinary boot reads no seller's 상세페이지")
    void defaultIsOff() throws Exception {
        // Read off the source rather than through a Spring context, because what is protected here
        // is the DEFAULT — the value a deployment gets by saying nothing — and a context that sets
        // the property proves the opposite of the thing in question. This capability has never run
        // live; merging a class must not be what starts calling a seller's channel.
        String source = java.nio.file.Files.readString(java.nio.file.Path.of(
                "src/main/java/com/sellerops/product/detail/ProductDetailEnrichmentTrigger.java"));
        assertThat(source).contains("${sellerops.product.detail.enrichment.enabled:false}");
        assertThat(source).doesNotContain("enrichment.enabled:true");
    }

    @Test
    @DisplayName("there is no catalogue path — the trigger takes one product id and nothing else")
    void thereIsNoSweep() {
        assertThat(ProductDetailEnrichmentTrigger.class.getDeclaredMethods())
                .filteredOn(m -> m.getName().startsWith("enrich"))
                .allSatisfy(m -> assertThat(m.getParameterTypes())
                        .as("no collection of products can be handed to it")
                        .containsExactly(UUID.class, UUID.class));
    }

    /** A source that records what it was asked for. It reaches no network. */
    private static final class RecordingSource implements ProductDetailSource {
        final List<String> reads = new ArrayList<>();
        RuntimeException failWith;
        boolean returnNull;

        @Override
        public String channelCode() {
            return "NAVER";
        }

        @Override
        public String sourceKind() {
            return "NAVER:PRODUCT_API:v1";
        }

        @Override
        public NaverProductDetail read(UUID orgId, UUID sellerAccountId, String externalProductId) {
            reads.add(externalProductId);
            if (failWith != null) {
                throw failWith;
            }
            return returnNull ? null
                    : new NaverProductDetail("상품", "<p>내용</p>", List.of(), List.of());
        }
    }
}
