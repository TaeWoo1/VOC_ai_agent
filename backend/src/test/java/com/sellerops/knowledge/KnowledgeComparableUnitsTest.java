package com.sellerops.knowledge;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/** The unit a passage is COMPARED in, beside the passage a seller is SHOWN. */
class KnowledgeComparableUnitsTest {

    @Test
    @DisplayName("every unit carries the document's title")
    void theTitleRidesOnEachSentence() {
        List<String> units = KnowledgeText.comparableUnits(
                "규격 안내\n1호는 두께 1.2mm입니다. 2호는 두께 1.6mm입니다.");
        assertThat(units).hasSize(2).allSatisfy(u -> assertThat(u).startsWith("규격 안내\n"));
        assertThat(units.get(1)).contains("2호는 두께 1.6mm입니다.");
    }

    @Test
    @DisplayName("a fragment is folded into its neighbour rather than compared alone")
    void shortFragmentsAreNotClaims() {
        assertThat(KnowledgeText.comparableUnits("안내\n네.\n택배는 다음 영업일에 나갑니다."))
                .singleElement().asString().contains("네.").contains("택배는");
    }

    @Test
    @DisplayName("the passage the seller reads never changes")
    void chunkingIsUntouched() {
        String body = "1문단입니다. 조금 더 길게 씁니다.\n\n2문단입니다. 이것도 길게 씁니다.";
        assertThat(KnowledgeText.chunk(body)).hasSize(1);
        assertThat(KnowledgeText.comparableUnits("제목\n" + body)).hasSizeGreaterThan(1)
                .allSatisfy(u -> assertThat(u).startsWith("제목\n"));
    }

    @Test
    @DisplayName("a titleless passage is still comparable")
    void noTitleIsNotAnError() {
        assertThat(KnowledgeText.comparableUnits("두께는 1.6mm입니다.")).containsExactly("두께는 1.6mm입니다.");
        assertThat(KnowledgeText.comparableUnits("")).isEmpty();
        assertThat(KnowledgeText.comparableUnits(null)).isEmpty();
    }
}
