package com.sellerops.operations;

import static org.assertj.core.api.Assertions.assertThat;

import com.sellerops.operations.dto.OperationsHomeView.PreparedItem;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * <b>준비된 작업 목록이 잘릴 때 일의 종류가 통째로 사라지지 않는다.</b>
 *
 * <p>The counts above the list have always been totals and the list has always been a bounded sample.
 * The defect was that the cut was taken in build order, so the last kind to be appended was the first
 * to vanish — measured live at 4 approved replies + 3 inquiry drafts + 1 improvement draft, where the
 * five drawn rows were four replies and one inquiry and the sentence above them said an improvement
 * draft was waiting. The seller was told a thing existed and shown a list that did not contain it.
 *
 * <p>The fix may not be a ranking: deciding that one review outranks one repeated problem is exactly
 * the weight {@code OperationsHomeView} refuses to carry. So these tests assert coverage AND that the
 * surviving rows keep the order they were built in.
 */
class PreparedWorkCoverageTest {

    private static PreparedItem item(String kind, String detail) {
        return new PreparedItem(kind, UUID.randomUUID(), kind + " label", detail, null, "/x");
    }

    private static List<PreparedItem> live() {
        List<PreparedItem> rows = new ArrayList<>();
        for (int i = 1; i <= 4; i++) {
            rows.add(item("REVIEW_REPLY", "r" + i));
        }
        for (int i = 1; i <= 3; i++) {
            rows.add(item("INQUIRY_REPLY", "q" + i));
        }
        rows.add(item("IMPROVEMENT_DRAFT", "m1"));
        return rows;
    }

    @Test
    @DisplayName("every kind that has a row keeps one, and the rest of the cap goes to the existing order")
    void everyKindSurvivesTheCut() {
        List<PreparedItem> out = OperationsHomeService.withTypeCoverage(live(), 5);

        assertThat(out).hasSize(5);
        assertThat(out).extracting(PreparedItem::kind).contains(
                "REVIEW_REPLY", "INQUIRY_REPLY", "IMPROVEMENT_DRAFT");
        // Coverage decides WHICH rows survive, never where they sit: the output is still
        // 리뷰 → 문의 → 개선, and the filled slots are the next rows in that same order.
        assertThat(out).extracting(PreparedItem::detail)
                .containsExactly("r1", "r2", "r3", "q1", "m1");
    }

    @Test
    @DisplayName("a list that already fits is returned unchanged — coverage is not a reshuffle")
    void shortListIsUntouched() {
        List<PreparedItem> rows = live().subList(0, 3);
        assertThat(OperationsHomeService.withTypeCoverage(rows, 5))
                .containsExactlyElementsOf(rows);
    }

    @Test
    @DisplayName("one kind alone is trimmed exactly as before — the first rows in order")
    void singleKindIsPlainTruncation() {
        List<PreparedItem> rows = new ArrayList<>();
        for (int i = 1; i <= 8; i++) {
            rows.add(item("REVIEW_REPLY", "r" + i));
        }
        assertThat(OperationsHomeService.withTypeCoverage(rows, 5)).extracting(PreparedItem::detail)
                .containsExactly("r1", "r2", "r3", "r4", "r5");
    }

    @Test
    @DisplayName("more kinds than slots stops at the cap rather than growing the list")
    void coverageNeverExceedsTheCap() {
        List<PreparedItem> rows = List.of(
                item("REVIEW_REPLY", "r1"), item("INQUIRY_REPLY", "q1"), item("IMPROVEMENT_DRAFT", "m1"));
        assertThat(OperationsHomeService.withTypeCoverage(rows, 2)).extracting(PreparedItem::detail)
                .containsExactly("r1", "q1");
    }

    @Test
    @DisplayName("the kind a seller has none of is not conjured into the list")
    void absentKindsStayAbsent() {
        List<PreparedItem> rows = new ArrayList<>();
        for (int i = 1; i <= 6; i++) {
            rows.add(item("REVIEW_REPLY", "r" + i));
        }
        rows.add(item("IMPROVEMENT_DRAFT", "m1"));
        assertThat(OperationsHomeService.withTypeCoverage(rows, 5)).extracting(PreparedItem::kind)
                .containsExactly("REVIEW_REPLY", "REVIEW_REPLY", "REVIEW_REPLY", "REVIEW_REPLY",
                        "IMPROVEMENT_DRAFT");
    }
}
