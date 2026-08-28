package com.sellerops.review.publish.cafe24;

import static org.assertj.core.api.Assertions.assertThat;

import com.sellerops.connector.cafe24.Cafe24BoardCommentRow;
import com.sellerops.review.publish.ReviewExecutionVerification;
import java.util.List;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/** The verification decision and the identity parse, pure. */
class Cafe24ReviewCommentAdapterTest {

    private static Cafe24BoardCommentRow row(long no, boolean mall, String hash) {
        return new Cafe24BoardCommentRow(no, 3674L, "2026-08-28T10:00:00", mall, hash);
    }

    @Test
    @DisplayName("a shop-authored comment whose content hash equals the approved draft is VERIFIED")
    void hashMatchIsVerified() {
        String approved = Cafe24ReviewCommentAdapter.normalizedHash("확인해  드리겠습니다.\n감사합니다.");
        List<Cafe24BoardCommentRow> rows = List.of(row(41, true, approved), row(40, false, "other"));
        assertThat(Cafe24ReviewCommentAdapter.decide(rows, approved, 41L)).isEqualTo(ReviewExecutionVerification.VERIFIED);
    }

    @Test
    @DisplayName("a shop comment exists but its text differs ⇒ STATUS_UNRESOLVED; none ⇒ DELIVERY_UNKNOWN")
    void weakerOutcomesAreNamed() {
        String approved = Cafe24ReviewCommentAdapter.normalizedHash("A");
        assertThat(Cafe24ReviewCommentAdapter.decide(List.of(row(41, true, "not-it")), approved, 41L))
                .isEqualTo(ReviewExecutionVerification.STATUS_UNRESOLVED);
        assertThat(Cafe24ReviewCommentAdapter.decide(List.of(row(40, false, approved)), approved, null))
                .isEqualTo(ReviewExecutionVerification.DELIVERY_UNKNOWN);
    }

    @Test
    @DisplayName("whitespace never changes the hash; the raw text is not what is compared")
    void hashIsWhitespaceNormalized() {
        assertThat(Cafe24ReviewCommentAdapter.normalizedHash(" a  b\n c "))
                .isEqualTo(Cafe24ReviewCommentAdapter.normalizedHash("a b c"));
    }

    @Test
    @DisplayName("the target is parsed from the review's own namespaced id — board and article, nothing invented")
    void targetParsesTheNamespacedId() {
        Cafe24ReviewCommentAdapter.Target t = Cafe24ReviewCommentAdapter.Target.parse("cafe24:b4:a3674");
        assertThat(t.boardNo()).isEqualTo(4);
        assertThat(t.articleNo()).isEqualTo(3674L);
        // A foreign namespace is not a Cafe24 target — null, and the adapter refuses before any read.
        assertThat(Cafe24ReviewCommentAdapter.Target.parse("naver-qna:12")).isNull();
        assertThat(Cafe24ReviewCommentAdapter.Target.parse("cafe24:b0:a1")).isNull();
    }
}
