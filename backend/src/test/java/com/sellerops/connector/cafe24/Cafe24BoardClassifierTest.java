package com.sellerops.connector.cafe24;

import static org.assertj.core.api.Assertions.assertThat;

import com.sellerops.connector.cafe24.Cafe24BoardClassifier.BoardKind;
import org.junit.jupiter.api.Test;

/**
 * The offline board classifier: name-keyword → {@link BoardKind}, the
 * inquiry-before-review precedence, the OTHER fallback, and null/blank safety.
 * Synthetic board names only — no real mall data.
 */
class Cafe24BoardClassifierTest {

    private final Cafe24BoardClassifier classifier = new Cafe24BoardClassifier();

    private static Cafe24BoardRow board(String name) {
        return new Cafe24BoardRow(1, name, "board");
    }

    @Test
    void reviewBoardsAreReviewBearing() {
        assertThat(classifier.classify(board("상품 사용후기"))).isEqualTo(BoardKind.REVIEW_BEARING);
        assertThat(classifier.classify(board("포토 리뷰"))).isEqualTo(BoardKind.REVIEW_BEARING);
        assertThat(classifier.classify(board("Product Review"))).isEqualTo(BoardKind.REVIEW_BEARING);
    }

    @Test
    void inquiryBoardsAreInquiryBearing() {
        assertThat(classifier.classify(board("상품 문의"))).isEqualTo(BoardKind.INQUIRY_BEARING);
        assertThat(classifier.classify(board("상품 Q&A"))).isEqualTo(BoardKind.INQUIRY_BEARING);
        assertThat(classifier.classify(board("1:1 맞춤상담"))).isEqualTo(BoardKind.INQUIRY_BEARING);
        assertThat(classifier.classify(board("Customer Inquiry"))).isEqualTo(BoardKind.INQUIRY_BEARING);
    }

    @Test
    void inquiryKeywordsWinOverReviewKeywords() {
        // A board whose name carries both signals resolves to the more actionable
        // inquiry surface (documented precedence).
        assertThat(classifier.classify(board("후기 문의 게시판"))).isEqualTo(BoardKind.INQUIRY_BEARING);
    }

    @Test
    void otherBoardsFallThrough() {
        assertThat(classifier.classify(board("공지사항"))).isEqualTo(BoardKind.OTHER);
        assertThat(classifier.classify(board("자유게시판"))).isEqualTo(BoardKind.OTHER);
        assertThat(classifier.classify(board("갤러리"))).isEqualTo(BoardKind.OTHER);
    }

    @Test
    void nullOrBlankNameIsOtherNeverGuessed() {
        assertThat(classifier.classify(board(null))).isEqualTo(BoardKind.OTHER);
        assertThat(classifier.classify(board(""))).isEqualTo(BoardKind.OTHER);
        assertThat(classifier.classify(board("   "))).isEqualTo(BoardKind.OTHER);
        assertThat(classifier.classify(null)).isEqualTo(BoardKind.OTHER);
    }
}
