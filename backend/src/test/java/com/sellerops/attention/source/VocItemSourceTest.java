package com.sellerops.attention.source;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;

import com.sellerops.attention.OperatorAttentionService;
import com.sellerops.community.Cafe24CommunityArticleRepository;
import java.lang.reflect.Field;
import java.util.Arrays;
import java.util.List;
import org.junit.jupiter.api.Test;

/**
 * The channel-generic source seam (PR #135): the registry resolves a source by
 * channel, and {@code OperatorAttentionService} is decoupled from the Cafe24 store.
 * Plain unit test — no Spring, no DB.
 */
class VocItemSourceTest {

    private VocItemSourceRegistry registryWithCafe24() {
        Cafe24VocItemSource cafe24 = new Cafe24VocItemSource(mock(Cafe24CommunityArticleRepository.class));
        return new VocItemSourceRegistry(List.of(cafe24));
    }

    @Test
    void resolvesCafe24ButNotGmarketOrNull() {
        VocItemSourceRegistry registry = registryWithCafe24();

        assertThat(registry.forChannel("CAFE24"))
                .get()
                .isInstanceOf(Cafe24VocItemSource.class);
        // GMARKET (ESM+) has no source adapter → safe empty, by explicit registry policy.
        assertThat(registry.forChannel("GMARKET")).isEmpty();
        assertThat(registry.forChannel(null)).isEmpty();
    }

    @Test
    void cafe24SourceSupportsOnlyTheCafe24ChannelCode() {
        Cafe24VocItemSource cafe24 = new Cafe24VocItemSource(mock(Cafe24CommunityArticleRepository.class));
        assertThat(cafe24.supports("CAFE24")).isTrue();
        assertThat(cafe24.supports("GMARKET")).isFalse();
        assertThat(cafe24.supports(null)).isFalse();
    }

    /**
     * Architecture guardrail: the generic attention service must depend on the source
     * registry, NOT on any channel-specific store. A regression that re-introduces a
     * direct {@code Cafe24CommunityArticleRepository} dependency (or drops the
     * registry) would re-couple the surface to Cafe24 and fail here.
     */
    @Test
    void operatorAttentionServiceIsDecoupledFromTheCafe24Store() {
        List<Class<?>> fieldTypes = Arrays.stream(OperatorAttentionService.class.getDeclaredFields())
                .map(Field::getType)
                .toList();

        assertThat(fieldTypes).contains(VocItemSourceRegistry.class);
        assertThat(fieldTypes).doesNotContain(Cafe24CommunityArticleRepository.class);
    }
}
