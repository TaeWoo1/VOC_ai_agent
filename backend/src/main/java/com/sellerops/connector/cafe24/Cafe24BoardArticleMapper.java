package com.sellerops.connector.cafe24;

import com.sellerops.ingest.canonical.CanonicalCommunityArticle;
import java.time.Instant;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.time.ZoneId;
import java.time.format.DateTimeParseException;

/**
 * Maps a Cafe24 board-article row to a source-agnostic
 * {@link CanonicalCommunityArticle}, deciding {@code source_kind} from the board it
 * came from. This is the single authority for the confirmed target-mall board
 * identities:
 *
 * <ul>
 *   <li>board 4 (구매후기) → {@code REVIEW}</li>
 *   <li>board 6 (문의사항) → {@code PRODUCT_INQUIRY}</li>
 *   <li>board 9 (1:1 맞춤상담) → {@code ONE_TO_ONE_INQUIRY}</li>
 * </ul>
 *
 * <p>These board numbers are the values Board Discovery confirmed on the target
 * mall; a later slice will source them per-mall from the discovery mapping rather
 * than as constants here. Raw {@code reply_status} is passed through unchanged —
 * ingestion normalizes it, and the concrete Cafe24 token → canonical state mapping
 * is a live-verification item (PR C). Timestamps parse only when they carry an
 * offset; a timezone-less or unexpected value stays {@code null} (unknown), never
 * an assumed zone.
 */
final class Cafe24BoardArticleMapper {

    static final int REVIEW_BOARD_NO = 4;
    static final int PRODUCT_INQUIRY_BOARD_NO = 6;
    static final int ONE_TO_ONE_BOARD_NO = 9;

    /** Cafe24's explicit platform zone — board dates are KST calendar dates. */
    static final ZoneId CAFE24_ZONE = ZoneId.of("Asia/Seoul");

    private Cafe24BoardArticleMapper() {
    }

    /**
     * Build a canonical article. The caller guarantees {@code row.articleNo()} is
     * non-null (a row without it cannot be keyed and is dropped upstream).
     * {@code sourceRow} is the 1-based position in the fetched page.
     */
    static CanonicalCommunityArticle toCanonical(int boardNo, Cafe24BoardArticleRow row, int sourceRow) {
        return new CanonicalCommunityArticle(
                boardNo,
                row.articleNo(),
                sourceKindForBoard(boardNo),
                row.productNo(),
                row.title(),
                row.content(),
                row.rating(),
                row.replyStatus(),
                parseOffsetInstant(row.createdDate()),
                parseOffsetInstant(row.updatedDate()),
                sourceRow);
    }

    static String sourceKindForBoard(int boardNo) {
        return switch (boardNo) {
            case REVIEW_BOARD_NO -> "REVIEW";
            case PRODUCT_INQUIRY_BOARD_NO -> "PRODUCT_INQUIRY";
            case ONE_TO_ONE_BOARD_NO -> "ONE_TO_ONE_INQUIRY";
            default -> "OTHER";
        };
    }

    /**
     * Offset-bearing timestamp → instant; anything else (incl. timezone-less) → null.
     * Package-visible so the sibling {@link Cafe24InquiryArticleMapper} shares the one
     * offset-only parse policy (no assumed zone, no clock).
     */
    static Instant parseOffsetInstant(String value) {
        if (value == null || value.isBlank()) {
            return null;
        }
        try {
            return OffsetDateTime.parse(value.trim()).toInstant();
        } catch (DateTimeParseException e) {
            return null;
        }
    }

    /**
     * The article's {@code created_date} as a Cafe24 (KST) calendar date, or
     * {@code null} when it is missing or not offset-bearing. Used only to enforce the
     * operator's backfill window locally: the platform's {@code start_date}/{@code
     * end_date} article filter is doc-asserted, not contract-guaranteed, so the
     * connector must re-check inclusion itself. A {@code null} result is treated as
     * out-of-window (fail closed) by the caller — never assumed in-window.
     */
    static LocalDate parseKstDate(String offsetBearing) {
        Instant instant = parseOffsetInstant(offsetBearing);
        return instant == null ? null : instant.atZone(CAFE24_ZONE).toLocalDate();
    }
}
