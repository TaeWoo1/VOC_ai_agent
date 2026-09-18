package com.sellerops.product;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * A 고시 value that only points at the detail page states nothing about the product (286 of 332 in the first live read,
 * 2026-09-19). It is refused as a {@code spec:} fact on write, and a stored one is removed.
 */
class NoticePlaceholderTest {

    private final UUID org = UUID.randomUUID();
    private final UUID product = UUID.randomUUID();
    private static final String DETAIL = "NAVER:PRODUCT_DETAIL_API:v2";

    @Test
    @DisplayName("the pointer grammar: observed spellings and close variants; real values that mention the page are kept")
    void grammar() {
        assertThat(List.of("상품상세참조", "상품상세 참조", "상품 상세 참조", "상세페이지 참조", "상세페이지참고",
                "(상품상세참조)", "상품상세페이지 참조 바랍니다", "상세설명 참조", " 상세정보참조. "))
                .allMatch(NoticePlaceholder::isPlaceholder);
        assertThat(List.of("대한민국", "지름 75mm", "상세페이지 참조, 2m", "9oz 종이컵 전용", "참조", "", "상세"))
                .noneMatch(NoticePlaceholder::isPlaceholder);
        assertThat(NoticePlaceholder.isPlaceholder(null)).isFalse();
        assertThat(NoticePlaceholder.isPlaceholderSpec("spec:크기", "상품상세참조")).isTrue();
        assertThat(NoticePlaceholder.isPlaceholderSpec("attr:판매자 태그", "상품상세참조"))
                .as("only spec: facts are 고시 statements").isFalse();
    }

    @Test
    @DisplayName("a re-read replaces the set without the pointer, and a stored pointer under that key is removed")
    void replaceFactsRefusesAndRemovesPointers() {
        ProductFactRepository facts = mock(ProductFactRepository.class);
        ProductKnowledgeWriter writer = writer(facts);
        when(facts.findByOrgIdAndProductIdAndFactKeyAndSource(any(), any(), any(), any())).thenReturn(Optional.empty());
        ProductFact stored = fact("spec:크기", "상품상세참조");
        when(facts.findByOrgIdAndProductId(org, product)).thenReturn(List.of(stored));

        int written = writer.replaceFacts(org, product, DETAIL, "123",
                Map.of("spec:크기", "상품상세 참조", "spec:재질", "ABS"), Instant.now(), null);

        assertThat(written).isEqualTo(1);
        verify(facts).delete(stored);
    }

    @Test
    @DisplayName("the cleanup removes stored spec pointers of the organisation and nothing else")
    void dropPlaceholderSpecs() {
        ProductFactRepository facts = mock(ProductFactRepository.class);
        ProductFact pointer = fact("spec:크기", "상품상세참조");
        ProductFact spaced = fact("spec:재질", "상품상세 참조");
        ProductFact real = fact("spec:제조국", "대한민국");
        when(facts.findByOrgIdAndFactKeyStartingWith(org, "spec:")).thenReturn(List.of(pointer, spaced, real));

        assertThat(writer(facts).dropPlaceholderSpecs(org)).isEqualTo(2);
        verify(facts).delete(pointer);
        verify(facts).delete(spaced);
        verify(facts, never()).delete(real);
    }

    private ProductKnowledgeWriter writer(ProductFactRepository facts) {
        ProductRepository products = mock(ProductRepository.class);
        return new ProductKnowledgeWriter(products, new ProductService(products), mock(ChannelProductRepository.class),
                mock(ProductVariantRepository.class), facts);
    }

    private ProductFact fact(String key, String value) {
        ProductFact f = new ProductFact();
        f.setOrgId(org);
        f.setProductId(product);
        f.setFactKey(key);
        f.setFactValue(value);
        f.setSource(DETAIL);
        return f;
    }
}
