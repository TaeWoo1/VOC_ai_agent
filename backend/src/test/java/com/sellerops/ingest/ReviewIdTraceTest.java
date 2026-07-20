package com.sellerops.ingest;

import static org.assertj.core.api.Assertions.assertThat;

import com.sellerops.common.ReviewIdFingerprint;
import com.sellerops.ingest.canonical.CanonicalReview;
import com.sellerops.ingest.map.MapResult;
import com.sellerops.ingest.map.ReviewRowMapper;
import com.sellerops.ingest.parse.FileParser;
import com.sellerops.ingest.parse.ParsedTable;
import java.io.ByteArrayInputStream;
import java.nio.charset.StandardCharsets;
import org.junit.jupiter.api.Test;

/**
 * <b>The review-id trace.</b> Milestone step 1 asks a question that must be answered by execution rather than
 * by reading the code: does the identifier column of the seller's review export reach the canonical backend
 * field <b>without transformation</b>?
 *
 * <p>These tests run the REAL parse → map chain over synthetic bytes shaped like a NAVER SmartStore review
 * export ({@code 리뷰글번호}: a 10-digit number, present and unique on every row — see
 * {@code docs/review_acquisition.md} §S) and assert that the value arriving in
 * {@link CanonicalReview#externalId()} is character-for-character the value in the file.
 *
 * <p>That equality is what makes the whole reconciliation meaningful: if the import mutated the id at all,
 * an identity fingerprint computed on the backend could never match one computed from the live page.
 *
 * <p>All rows are SYNTHETIC. No real seller review, id, order number, or author appears here.
 */
class ReviewIdTraceTest {

    private final FileParser parser = new FileParser();
    private final ReviewRowMapper mapper = new ReviewRowMapper();

    /** A 10-digit id, the shape the analysed NAVER export uses. */
    private static final String NAVER_ID = "4185720931";

    private CanonicalReview mapOne(String csv) {
        ParsedTable table = parser.parse("review.csv", new ByteArrayInputStream(csv.getBytes(StandardCharsets.UTF_8)));
        MapResult<CanonicalReview> result = mapper.map(table);
        assertThat(result.errors()).isEmpty();
        assertThat(result.ok()).hasSize(1);
        return result.ok().get(0);
    }

    @Test
    void naverReviewIdColumnReachesExternalIdCharacterForCharacter() {
        CanonicalReview row = mapOne("""
                리뷰글번호,상품명,구매자평점,리뷰상세내용,리뷰등록일
                %s,전선몰딩 1호,1,접착력이 약해요,2026.02.01. 09:08:07
                """.formatted(NAVER_ID));

        assertThat(row.externalId()).isEqualTo(NAVER_ID);
        // No prefixing, no numeric coercion, no compositing with channel or account.
        assertThat(row.externalId()).doesNotContain(":");
        assertThat(row.externalId()).hasSize(NAVER_ID.length());
    }

    @Test
    void theImportedIdAndTheSourceCellFingerprintIdentically() {
        CanonicalReview row = mapOne("""
                리뷰글번호,상품명,구매자평점,리뷰상세내용,리뷰등록일
                %s,전선몰딩 1호,1,접착력이 약해요,2026.02.01. 09:08:07
                """.formatted(NAVER_ID));

        // This is the property the live reconciliation stands on: whatever the live page exposes, if it is
        // the same id, its fingerprint equals the fingerprint of what we imported.
        assertThat(ReviewIdFingerprint.of(row.externalId())).isEqualTo(ReviewIdFingerprint.of(NAVER_ID));
        assertThat(ReviewIdFingerprint.of(row.externalId())).matches("[0-9a-f]{64}");
    }

    @Test
    void headerCaseAndBomDoNotBreakTheTrace() {
        // Excel-exported files often carry a UTF-8 BOM on the first header; the parser strips it. The
        // alias lookup is lowercase, so an uppercase spelling of the ASCII alias must still be found.
        CanonicalReview row = mapOne("﻿" + """
                REVIEW_ID,상품명,구매자평점,리뷰상세내용,리뷰등록일
                %s,전선몰딩 1호,1,접착력이 약해요,2026.02.01. 09:08:07
                """.formatted(NAVER_ID));

        assertThat(row.externalId()).isEqualTo(NAVER_ID);
    }

    @Test
    void surroundingWhitespaceIsStrippedByTheImportAndIsIrrelevantToIdentityAnyway() {
        CanonicalReview row = mapOne("""
                리뷰글번호,상품명,구매자평점,리뷰상세내용,리뷰등록일
                "  %s  ",전선몰딩 1호,1,접착력이 약해요,2026.02.01. 09:08:07
                """.formatted(NAVER_ID));

        assertThat(row.externalId()).isEqualTo(NAVER_ID);
        assertThat(ReviewIdFingerprint.of(row.externalId())).isEqualTo(ReviewIdFingerprint.of("  " + NAVER_ID + "  "));
    }

    @Test
    void aRowWithNoIdColumnCarriesNoIdentityRatherThanAFabricatedOne() {
        CanonicalReview row = mapOne("""
                상품명,구매자평점,리뷰상세내용,리뷰등록일
                전선몰딩 1호,1,접착력이 약해요,2026.02.01. 09:08:07
                """);

        assertThat(row.externalId()).isNull();
        assertThat(ReviewIdFingerprint.of(row.externalId())).isNull();
    }

    @Test
    void theSensitiveExportColumnsHaveNoCanonicalSlotAtAll() {
        // 상품주문번호 / 등록자 are present in a real export and must never become an identity.
        CanonicalReview row = mapOne("""
                리뷰글번호,상품명,구매자평점,리뷰상세내용,리뷰등록일,상품주문번호,등록자
                %s,전선몰딩 1호,1,접착력이 약해요,2026.02.01. 09:08:07,9911223344556677,synthetic-writer
                """.formatted(NAVER_ID));

        assertThat(row.externalId()).isEqualTo(NAVER_ID);
        assertThat(row.toString()).doesNotContain("9911223344556677");
        assertThat(row.toString()).doesNotContain("synthetic-writer");
    }
}
