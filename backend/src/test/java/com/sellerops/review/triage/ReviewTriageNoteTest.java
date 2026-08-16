package com.sellerops.review.triage;

import static org.assertj.core.api.Assertions.assertThat;

import com.sellerops.itemanalysis.ItemAnalysisCategories;
import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.Test;

/**
 * What the row says, and the two things it must never say.
 *
 * <p>It must never recommend replying — Coupang gives sellers no way to answer a 상품평, and a
 * recommendation to do so would reintroduce, as advice, the affordance this surface deliberately
 * lacks. And the note must never change the tier it is explaining: the reason is downstream of the
 * decision, which is the whole shape of the RUBRIC §5 boundary.
 */
class ReviewTriageNoteTest {

    private static final String BODY = "부착 후 며칠 지나니 접착력이 약해서 떨어졌어요.";

    @Test
    void theReasonLeadsWithTheFactThatDecidedTheTier() {
        ReviewTriageNote note = ReviewTriageNote.of(1, BODY, "설치", 11);
        assertThat(note.tier()).isEqualTo(ReviewTriageTier.NEEDS_ATTENTION);
        assertThat(note.reason()).isEqualTo("1점 · 설치 · 같은 분류 11건");
    }

    @Test
    void aReviewWithNoRatingSaysSoRatherThanShowingNothing() {
        assertThat(ReviewTriageNote.of(null, BODY, null, 0).reason()).isEqualTo("평점 없음");
    }

    @Test
    void aRatingOnlyReviewSaysWhatTheBuyerActuallyDid() {
        ReviewTriageNote note = ReviewTriageNote.of(1, "", null, 0);
        assertThat(note.reason()).isEqualTo("1점 · 별점만");
        assertThat(note.recommendedAction()).contains("별점만 남긴 상품평");
    }

    @Test
    void aCategoryUnderTheRepeatFloorIsTaggedButNotCalledRepeated() {
        ReviewTriageNote note = ReviewTriageNote.of(1, BODY, "설치", ReviewTriageNote.REPEAT_MIN - 1);
        assertThat(note.reason()).isEqualTo("1점 · 설치");
        assertThat(note.tags()).containsExactly("설치");
        assertThat(note.recommendedAction()).isEqualTo("내용을 읽고 상품 상태를 확인해 보세요.");
    }

    @Test
    void atTheFloorItIsRepeatedAndTheActionChanges() {
        ReviewTriageNote note = ReviewTriageNote.of(1, BODY, "설치", ReviewTriageNote.REPEAT_MIN);
        assertThat(note.reason()).contains("같은 분류 3건");
        assertThat(note.recommendedAction()).isEqualTo("같은 분류의 상품평이 반복됩니다. 상품·포장 상태를 확인해 보세요.");
    }

    @Test
    void neitherKindOfMissingCategoryBecomesATag() {
        // 기타 is a stored verdict ("we looked, it fitted nothing"); null is no analysis row at all
        // ("we never looked"). Different facts, same rendering: neither is an issue.
        assertThat(ReviewTriageNote.of(1, BODY, ItemAnalysisCategories.FALLBACK, 50).tags()).isEmpty();
        assertThat(ReviewTriageNote.of(1, BODY, null, 50).tags()).isEmpty();
        assertThat(ReviewTriageNote.of(1, BODY, "  ", 50).tags()).isEmpty();
        // …and neither may smuggle a repeat claim in through the count.
        assertThat(ReviewTriageNote.of(1, BODY, ItemAnalysisCategories.FALLBACK, 50).reason())
                .isEqualTo("1점");
    }

    @Test
    void aWellRatedReviewIsOfferedNoActionAtAll() {
        ReviewTriageNote note = ReviewTriageNote.of(5, "튼튼하고 마감이 깔끔해요.", "품질", 11);
        assertThat(note.tier()).isEqualTo(ReviewTriageTier.FYI);
        // The tag and the count still ride along — they are true — but there is nothing to do.
        assertThat(note.reason()).isEqualTo("5점 · 품질 · 같은 분류 11건");
        assertThat(note.recommendedAction()).isNull();
    }

    @Test
    void theNoteExplainsTheTierAndCannotChangeIt() {
        // Same rating and body, every category and count the product can produce: the tier is fixed
        // before any of it is read.
        for (String category : new String[] {null, "설치", "배송", "품질", ItemAnalysisCategories.FALLBACK}) {
            for (long count : new long[] {0, 1, 3, 999}) {
                assertThat(ReviewTriageNote.of(4, BODY, category, count).tier())
                        .as("category %s × count %s", category, count)
                        .isEqualTo(ReviewTriageTier.FYI);
            }
        }
    }

    @Test
    void nothingThisClassCanEmitSuggestsAnsweringTheBuyer() {
        // Coupang publishes no seller reply for 상품평. Every string the map can produce is swept,
        // rather than the three or four a hand-written test would remember to check.
        List<String> emitted = new ArrayList<>();
        for (Integer rating : new Integer[] {null, 1, 2, 3, 4, 5}) {
            for (String body : new String[] {null, "", "   ", BODY}) {
                for (String category : new String[] {null, "설치", ItemAnalysisCategories.FALLBACK}) {
                    for (long count : new long[] {0, ReviewTriageNote.REPEAT_MIN, 99}) {
                        ReviewTriageNote note = ReviewTriageNote.of(rating, body, category, count);
                        emitted.add(note.reason());
                        if (note.recommendedAction() != null) {
                            emitted.add(note.recommendedAction());
                        }
                    }
                }
            }
        }
        assertThat(emitted).isNotEmpty();
        for (String text : emitted) {
            assertThat(text).doesNotContain("답변").doesNotContain("답글").doesNotContain("회신");
        }
    }

    @Test
    void theReasonIsNeverEmptyBecauseAnEmptyLineExplainsNothing() {
        for (Integer rating : new Integer[] {null, 1, 3, 5}) {
            for (String body : new String[] {null, "", BODY}) {
                assertThat(ReviewTriageNote.of(rating, body, null, 0).reason()).isNotBlank();
            }
        }
    }
}
