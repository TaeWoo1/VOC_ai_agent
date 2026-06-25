package com.sellerops.connector.cafe24;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.sellerops.connector.cafe24.Cafe24BoardClassifier.BoardKind;
import org.junit.jupiter.api.Test;

/**
 * Board Discovery end-to-end over the recording fake: list → classify → sanitized
 * result with per-kind counts, plus 429 propagation. Synthetic boards only.
 */
class Cafe24BoardDiscoveryTest {

    private final FakeCafe24HttpClient http = new FakeCafe24HttpClient();
    private final Cafe24BoardDiscovery discovery =
            new Cafe24BoardDiscovery(new Cafe24BoardsClient(http), new Cafe24BoardClassifier());

    @Test
    void listsClassifiesAndTalliesBoards() {
        http.enqueue(FakeCafe24HttpClient.boardsOk(
                FakeCafe24HttpClient.board(1, "공지사항", "board"),
                FakeCafe24HttpClient.board(4, "상품 사용후기", "board"),
                FakeCafe24HttpClient.board(6, "상품 Q&A", "board"),
                FakeCafe24HttpClient.board(9, "1:1 문의", "board")));

        Cafe24BoardDiscovery.Result result = discovery.discover("access-1", "samplemall");

        assertThat(result.boards())
                .extracting(Cafe24BoardDiscovery.ClassifiedBoard::boardNo,
                        Cafe24BoardDiscovery.ClassifiedBoard::kind)
                .containsExactly(
                        org.assertj.core.groups.Tuple.tuple(1, BoardKind.OTHER),
                        org.assertj.core.groups.Tuple.tuple(4, BoardKind.REVIEW_BEARING),
                        org.assertj.core.groups.Tuple.tuple(6, BoardKind.INQUIRY_BEARING),
                        org.assertj.core.groups.Tuple.tuple(9, BoardKind.INQUIRY_BEARING));
        assertThat(result.countsByKind())
                .containsEntry(BoardKind.REVIEW_BEARING, 1)
                .containsEntry(BoardKind.INQUIRY_BEARING, 2)
                .containsEntry(BoardKind.OTHER, 1);
    }

    @Test
    void emptyMallYieldsEmptyResultWithZeroCounts() {
        http.enqueue(FakeCafe24HttpClient.boardsOk());

        Cafe24BoardDiscovery.Result result = discovery.discover("access-1", "samplemall");

        assertThat(result.boards()).isEmpty();
        assertThat(result.countsByKind())
                .containsEntry(BoardKind.REVIEW_BEARING, 0)
                .containsEntry(BoardKind.INQUIRY_BEARING, 0)
                .containsEntry(BoardKind.OTHER, 0);
    }

    @Test
    void rateLimitedBoardsPropagates() {
        http.enqueue(FakeCafe24HttpClient.rateLimited429("5"));

        assertThatThrownBy(() -> discovery.discover("access-1", "samplemall"))
                .isInstanceOf(Cafe24RateLimitedException.class);
    }
}
