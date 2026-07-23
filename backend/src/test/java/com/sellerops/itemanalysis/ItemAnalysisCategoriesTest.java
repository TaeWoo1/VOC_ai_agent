package com.sellerops.itemanalysis;

import static org.assertj.core.api.Assertions.assertThat;

import com.sellerops.itemanalysis.InboxItemAnalyzer.SourceItem;
import java.util.UUID;
import org.junit.jupiter.api.Test;

/**
 * The writer and the filter must agree on one vocabulary.
 *
 * <p>A category the analyzer can emit but {@link ItemAnalysisCategories} does not list is
 * unreachable by every facet that filters on it, and the failure is silent — those rows simply never
 * appear under any filter, and no error is raised anywhere. Pinning the agreement here is what turns
 * that into a build failure instead.
 */
class ItemAnalysisCategoriesTest {

    private final RuleBasedInboxItemAnalyzer analyzer = new RuleBasedInboxItemAnalyzer();

    private String categoryOf(String body) {
        return analyzer.analyze(new SourceItem("REVIEW", UUID.randomUUID(), body, 3, null, false))
                .category();
    }

    @Test
    void everyCategoryTheAnalyzerCanEmitIsInTheCanonicalVocabulary() {
        // One body per detection branch, plus a body matching nothing (the 기타 fallback).
        for (String body : new String[]{
                "배송이 늦었어요", "교환하고 싶어요", "스펙이 궁금합니다", "설치가 어려워요",
                "가격이 비싸요", "불량이 왔습니다", "색상이 달라요", "사이즈가 안 맞아요",
                "그냥 그렇습니다"}) {
            assertThat(ItemAnalysisCategories.isSupported(categoryOf(body)))
                    .as("analyzer emitted an unlistable category for: %s", body)
                    .isTrue();
        }
    }

    @Test
    void theFallbackIsTheCategoryForABodyMatchingNoKeyword() {
        assertThat(categoryOf("그냥 그렇습니다")).isEqualTo(ItemAnalysisCategories.FALLBACK);
        assertThat(ItemAnalysisCategories.isSupported(ItemAnalysisCategories.FALLBACK)).isTrue();
    }

    @Test
    void theUnclassifiedSentinelIsNotAStorableCategory() {
        // It is a filter value only. If it were ever also a storable category, "no analysis row"
        // and "analyzed as unclassified" would collide in the one place they must stay distinct.
        assertThat(ItemAnalysisCategories.isSupported(ItemAnalysisCategories.UNCLASSIFIED)).isFalse();
        assertThat(ItemAnalysisCategories.isUnclassified(ItemAnalysisCategories.FALLBACK)).isFalse();
    }

    @Test
    void theOrderedListAndTheMembershipSetDescribeTheSameVocabulary() {
        assertThat(ItemAnalysisCategories.ORDERED).doesNotHaveDuplicates();
        assertThat(ItemAnalysisCategories.SUPPORTED)
                .containsExactlyInAnyOrderElementsOf(ItemAnalysisCategories.ORDERED);
    }
}
