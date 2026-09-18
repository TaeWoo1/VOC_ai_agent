package com.sellerops.product.detail;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.sellerops.connector.naver.NaverProductDetail;
import com.sellerops.ingest.canonical.CanonicalProduct;
import com.sellerops.product.ChannelProduct;
import com.sellerops.product.ChannelProductRepository;
import com.sellerops.product.FactKeys;
import com.sellerops.product.ProductFact;
import com.sellerops.product.ProductFactRepository;
import com.sellerops.product.ProductKnowledgeWriter;
import com.sellerops.product.library.ProductKnowledgeIndexer;
import com.sellerops.product.library.ProductKnowledgeSourceRepository;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

/**
 * A detail read states more than text: the channel's option status, its 추가상품, its 고시 fields and attributes — and
 * a marker that the page was read, so «read and nothing there» is distinguishable from «never read».
 */
class ProductDetailStructuredFactsTest {

    private final UUID org = UUID.randomUUID();
    private final UUID channel = UUID.randomUUID();
    private final UUID product = UUID.randomUUID();
    private final Instant now = Instant.parse("2026-09-18T03:00:00Z");

    private ProductKnowledgeSourceRepository sources;
    private ProductKnowledgeWriter writer;
    private ProductFactRepository facts;
    private ChannelProductRepository listings;
    private ProductDetailEnrichment enrichment;

    @BeforeEach
    void setUp() {
        sources = mock(ProductKnowledgeSourceRepository.class);
        writer = mock(ProductKnowledgeWriter.class);
        facts = mock(ProductFactRepository.class);
        listings = mock(ChannelProductRepository.class);
        when(sources.findAllByOrgIdAndProductIdOrderByCreatedAtAsc(any(), any())).thenReturn(List.of());
        when(writer.write(any(), any(), anyList()))
                .thenReturn(new ProductKnowledgeWriter.WriteResult(List.of(product), 0, 2, 0));
        enrichment = new ProductDetailEnrichment(sources, writer, mock(ProductKnowledgeIndexer.class), facts, listings);
    }

    private NaverProductDetail detail() {
        return new NaverProductDetail("컵 디스펜서", "<img src=\"https://x/a.jpg\">",
                List.of(new NaverProductDetail.Option("101", "용량: 9oz", 0, 12, true),
                        new NaverProductDetail.Option("102", "용량: 13oz", 1000, 0, true),
                        new NaverProductDetail.Option("103", "용량: 6.5oz", null, 5, false)),
                List.of("https://x/a.jpg"), "SALE", "ON", "50003307", true,
                List.of(new NaverProductDetail.Supplement("7", "뚜껑", "9oz 컵 뚜껑", 2000, null, true),
                        new NaverProductDetail.Supplement("8", "홀더", "벽걸이 홀더", null, null, false)),
                Map.of("크기", "지름 75mm", "판매자 태그", "컵디스펜서"), List.of());
    }

    @Test
    @DisplayName("options carry the channel's status; a listing's options no longer listed are retired, not deleted")
    void optionStatusAndRetirement() {
        enrichment.apply(org, channel, product, "123", "NAVER:PRODUCT_API:v1", "NAVER:PRODUCT_DETAIL_API:v2",
                detail(), now);

        @SuppressWarnings("unchecked")
        ArgumentCaptor<List<CanonicalProduct>> rows = ArgumentCaptor.forClass(List.class);
        verify(writer).write(eq(org), eq(channel), rows.capture());
        CanonicalProduct row = rows.getValue().get(0);
        assertThat(row.rawSellingStatus()).isEqualTo("SALE");
        assertThat(row.variants()).extracting(v -> v.rawSellingStatus())
                .containsExactly("SALE", "OUTOFSTOCK", "SUSPENSION");
        verify(writer).retireVariantsNotIn(org, product, channel, Set.of("101", "102", "103"));
    }

    @Test
    @DisplayName("고시·tags become facts, only offered 추가상품 are stated, and the page-shape marker is always written")
    void structuredFactsUnderTheDetailSource() {
        enrichment.apply(org, channel, product, "123", "NAVER:PRODUCT_API:v1", "NAVER:PRODUCT_DETAIL_API:v2",
                detail(), now);

        @SuppressWarnings("unchecked")
        ArgumentCaptor<Map<String, String>> keyed = ArgumentCaptor.forClass(Map.class);
        verify(writer).replaceFacts(eq(org), eq(product), eq("NAVER:PRODUCT_DETAIL_API:v2"), eq("123"),
                keyed.capture(), eq(now), any());
        assertThat(keyed.getValue())
                .containsEntry("spec:크기", "지름 75mm")
                .containsEntry("attr:판매자 태그", "컵디스펜서")
                .containsEntry(FactKeys.SUPPLEMENT_PREFIX + "7", "뚜껑: 9oz 컵 뚜껑")
                .doesNotContainKey(FactKeys.SUPPLEMENT_PREFIX + "8")
                .containsEntry(FactKeys.DETAIL_PAGE, "IMAGE_ONLY");
    }

    @Test
    @DisplayName("API-first freshness: a listing the channel changed after our last read is stale today")
    void changedListingIsStale() {
        ProductFact marker = new ProductFact();
        marker.setFactKey(FactKeys.DETAIL_PAGE);
        marker.setObservedAt(now.minusSeconds(86_400));
        when(facts.findByOrgIdAndProductIdAndFactKeyIn(org, product, List.of(FactKeys.DETAIL_PAGE)))
                .thenReturn(List.of(marker));
        ChannelProduct listing = new ChannelProduct();
        listing.setSourceUpdatedAt(now.minusSeconds(172_800));
        when(listings.findByOrgIdAndProductId(org, product)).thenReturn(List.of(listing));

        assertThat(enrichment.needsEnrichment(org, product, now)).as("read after the last change").isFalse();
        assertThat(enrichment.lastRead(org, product)).isEqualTo(now.minusSeconds(86_400));

        listing.setSourceUpdatedAt(now.minusSeconds(3_600));
        assertThat(enrichment.needsEnrichment(org, product, now)).as("changed since").isTrue();

        when(facts.findByOrgIdAndProductIdAndFactKeyIn(org, product, List.of(FactKeys.DETAIL_PAGE)))
                .thenReturn(List.of());
        assertThat(enrichment.needsEnrichment(org, product, now)).as("never read").isTrue();
    }
}
