package com.sellerops.product.detail;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.sellerops.connector.naver.NaverProductDetail;
import com.sellerops.ingest.canonical.CanonicalProduct;
import com.sellerops.ingest.canonical.CanonicalProductVariant;
import com.sellerops.product.ProductKnowledgeWriter;
import com.sellerops.product.library.ProductKnowledgeSource;
import com.sellerops.product.library.ProductKnowledgeSourceRepository;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

/**
 * <b>What a page made of pictures still teaches us.</b>
 *
 * <p>The target listing has 20 option combinations and, before this lane runs, zero stored variants
 * — so {@code SpecApplicability.VARIANT_NAMED} is unreachable on NAVER for exactly the product whose
 * answers depend on the 규격 chosen. The fix is not new machinery: {@code writeOptions} already runs
 * before the shape is judged. These cases pin that ORDER, because the tempting refactor — "return
 * early when the page is images, there is nothing to do" — is a one-line change that would silently
 * take the variants with it.
 *
 * <p>A variant write is a LOCAL database mutation and not a marketplace WRITE. It is listed as an
 * expected local mutation on the Stage 1 manifest for that reason, rather than omitted as if reading
 * a page changed nothing.
 */
class ProductDetailEnrichmentTest {

    private final UUID org = UUID.randomUUID();
    private final UUID channelId = UUID.randomUUID();
    private final UUID productId = UUID.randomUUID();

    private ProductKnowledgeSourceRepository sources;
    private ProductKnowledgeWriter catalogue;
    private ProductDetailEnrichment enrichment;

    @BeforeEach
    void setUp() {
        sources = mock(ProductKnowledgeSourceRepository.class);
        catalogue = mock(ProductKnowledgeWriter.class);
        when(sources.findAllByOrgIdAndProductIdOrderByCreatedAtAsc(any(), any()))
                .thenReturn(List.of());
        when(catalogue.write(any(), any(), anyList()))
                .thenReturn(new ProductKnowledgeWriter.WriteResult(List.of(productId), 0, 20, 0));
        enrichment = new ProductDetailEnrichment(sources, catalogue);
    }

    @Test
    @DisplayName("a page made of pictures still persists its 규격 — and indexes no text")
    void imageOnlyPageStillPersistsVariants() {
        ProductDetailEnrichment.Result result = enrichment.apply(org, channelId, productId,
                "13250364547", "NAVER:PRODUCT_API:v1", imageOnlyDetail(20), Instant.now());

        assertThat(result.outcome()).isEqualTo(ProductDetailEnrichment.Outcome.IMAGE_ONLY);
        assertThat(result.optionsWritten()).as("the 규격 are what make VARIANT_NAMED reachable")
                .isEqualTo(20);
        verify(sources, never()).save(any(ProductKnowledgeSource.class));
    }

    @Test
    @DisplayName("the option's channel identity travels verbatim — no synthetic id is invented")
    void optionIdentityIsTheChannelsOwn() {
        enrichment.apply(org, channelId, productId, "13250364547", "NAVER:PRODUCT_API:v1",
                imageOnlyDetail(3), Instant.now());

        ArgumentCaptor<List<CanonicalProduct>> rows = ArgumentCaptor.forClass(List.class);
        verify(catalogue).write(eq(org), eq(channelId), rows.capture());
        List<CanonicalProductVariant> variants = rows.getValue().get(0).variants();
        assertThat(variants).extracting(CanonicalProductVariant::externalVariantId)
                .containsExactly("opt-0", "opt-1", "opt-2");
        assertThat(variants).extracting(CanonicalProductVariant::optionName)
                .containsExactly("규격 0", "규격 1", "규격 2");
    }

    @Test
    @DisplayName("an empty page writes no document either, and still keeps its 규격")
    void emptyPageStillPersistsVariants() {
        NaverProductDetail detail = new NaverProductDetail("이름", "", options(20), List.of());

        ProductDetailEnrichment.Result result = enrichment.apply(org, channelId, productId,
                "13250364547", "NAVER:PRODUCT_API:v1", detail, Instant.now());

        assertThat(result.outcome()).isEqualTo(ProductDetailEnrichment.Outcome.EMPTY);
        assertThat(result.optionsWritten()).isEqualTo(20);
        verify(sources, never()).save(any(ProductKnowledgeSource.class));
    }

    @Test
    @DisplayName("a page of prose indexes its text — one document, keyed on the listing")
    void textPageIndexesOneDocument() {
        String prose = "안녕하세요. ".repeat(80) + "이 상품은 전선을 정리하는 몰딩입니다. "
                + "설치 방법과 주의사항을 아래에 자세히 안내드립니다. ".repeat(10);
        NaverProductDetail detail = new NaverProductDetail("이름", "<p>" + prose + "</p>",
                options(20), List.of());

        ProductDetailEnrichment.Result result = enrichment.apply(org, channelId, productId,
                "13250364547", "NAVER:PRODUCT_API:v1", detail, Instant.now());

        assertThat(result.outcome()).isEqualTo(ProductDetailEnrichment.Outcome.TEXT_INDEXED);
        ArgumentCaptor<ProductKnowledgeSource> saved =
                ArgumentCaptor.forClass(ProductKnowledgeSource.class);
        verify(sources).save(saved.capture());
        assertThat(saved.getValue().getChannelSourceRef())
                .isEqualTo("NAVER:PRODUCT_API:v1|13250364547");
        assertThat(saved.getValue().getTitle()).isEqualTo("상품 상세페이지");
        assertThat(saved.getValue().getAuthorName()).as("no machine belongs in a column naming people")
                .isNull();
    }

    /** 26 pictures and 104 characters — the shape the 2026-08-26 probe measured on this listing. */
    private NaverProductDetail imageOnlyDetail(int optionCount) {
        StringBuilder markup = new StringBuilder("<p>배송 안내는 아래 이미지를 참고해 주세요.</p>");
        for (int i = 0; i < 26; i++) {
            markup.append("<img src=\"https://shop-phinf.example.test/detail-").append(i)
                    .append(".jpg\">");
        }
        return new NaverProductDetail("이름", markup.toString(), options(optionCount), List.of());
    }

    private static List<NaverProductDetail.Option> options(int count) {
        return java.util.stream.IntStream.range(0, count)
                .mapToObj(i -> new NaverProductDetail.Option("opt-" + i, "규격 " + i))
                .toList();
    }
}
