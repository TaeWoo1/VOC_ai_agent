package com.sellerops.ingest.parse;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.sellerops.ingest.canonical.CanonicalReview;
import com.sellerops.ingest.map.MapResult;
import com.sellerops.ingest.map.ReviewRowMapper;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import org.apache.poi.ss.usermodel.Row;
import org.apache.poi.ss.usermodel.Sheet;
import org.apache.poi.xssf.usermodel.XSSFWorkbook;
import org.junit.jupiter.api.Test;

class FileParserTest {

    private final FileParser parser = new FileParser();

    @Test
    void parsesCsvWithKoreanHeaders() {
        String csv = "상품명,평점,내용\n전선몰딩,5,좋아요\n코너몰딩,2,깨졌어요\n";
        ParsedTable table = parser.parse("reviews.csv",
                new ByteArrayInputStream(csv.getBytes(StandardCharsets.UTF_8)));

        assertThat(table.headers()).containsExactly("상품명", "평점", "내용");
        assertThat(table.rows()).hasSize(2);
        assertThat(table.rows().get(0).get("상품명")).isEqualTo("전선몰딩");
        assertThat(table.rows().get(1).get("내용")).isEqualTo("깨졌어요");
    }

    @Test
    void stripsLeadingBomFromFirstCsvHeader() {
        // Excel-compatible exports (our own sample download included) prefix the
        // first header with a UTF-8 BOM. It must not turn 상품명 into a key that
        // misses the "상품명" alias and collapses every product to "(미지정 상품)".
        String csv = "\uFEFF상품명,평점,내용\n전선몰딩,5,좋아요\n";
        ParsedTable table = parser.parse("reviews.csv",
                new ByteArrayInputStream(csv.getBytes(StandardCharsets.UTF_8)));

        assertThat(table.headers()).containsExactly("상품명", "평점", "내용");
        assertThat(table.headers().get(0)).doesNotContain("\uFEFF");
        assertThat(table.rows().get(0).get("상품명")).isEqualTo("전선몰딩");
    }

    @Test
    void parsesXlsxFirstSheet() throws Exception {
        byte[] bytes = buildXlsx();
        ParsedTable table = parser.parse("orders.xlsx", new ByteArrayInputStream(bytes));

        assertThat(table.headers()).containsExactly("날짜", "주문수", "매출액");
        assertThat(table.rows()).hasSize(1);
        assertThat(table.rows().get(0).get("주문수")).isEqualTo("42");
    }

    @Test
    void parsesAndMapsNaverReviewExportXlsx() throws Exception {
        // Mirror a NAVER seller-center review export: NAVER headers + synthetic rows
        // (no raw sample data). The 상품주문번호 column is present but has no canonical
        // slot, so it is never mapped/persisted.
        byte[] bytes = buildNaverReviewXlsx();
        ParsedTable table = parser.parse("review_20260102_090807.xlsx",
                new ByteArrayInputStream(bytes));

        MapResult<CanonicalReview> r = new ReviewRowMapper().map(table);
        assertThat(r.errors()).isEmpty();
        assertThat(r.ok()).hasSize(1);
        CanonicalReview row = r.ok().get(0);
        assertThat(row.externalId()).isEqualTo("RV-1001");
        assertThat(row.sku()).isEqualTo("SKU-77");
        assertThat(row.productName()).isEqualTo("전선몰딩 1호");
        assertThat(row.rating()).isEqualTo(5);
        assertThat(row.body()).isEqualTo("설치가 쉬웠어요");
        assertThat(row.receivedAt())
                .isEqualTo(java.time.Instant.parse("2026-01-02T00:00:00Z"));
    }

    // ─────────────────── format is decided by the bytes, never by the name ───────────────────

    /**
     * <b>The file NAVER actually gives a seller.</b>
     *
     * <p>The Seller Center review export arrives with no filename in {@code Content-Disposition}, so the
     * browser saves it as a bare UUID with no extension. Measured live on 2026-08-23 — three downloads,
     * 39–65 KB, every one a valid workbook, and the manual import path could not accept any of them
     * because format was decided by {@code endsWith(".xlsx")}. The guided path escaped it only because
     * the runtime renames the file before uploading, which is precisely the drift this fixes.
     *
     * <p>The workbook here is BUILT, not committed: it carries the real export's header row (column names
     * are not personal data) and fabricated cells, so the contract is pinned without a byte of customer
     * text in the repository.
     */
    @Test
    void anExtensionlessNaverExportIsAcceptedBecauseItsBytesSayWorkbook() throws Exception {
        ParsedTable table = parser.parse("f532f7b3-55e9-4f02-94db-78a4a78c3f2e",
                new ByteArrayInputStream(buildNaverReviewExport()));

        assertThat(table.headers()).contains("리뷰글번호", "리뷰상세내용", "구매자평점", "리뷰등록일", "상품명");
        assertThat(table.rows()).hasSize(1);
        assertThat(table.rows().get(0).get("리뷰글번호")).isEqualTo("900000001");
    }

    /** …and it reaches the review mapper intact, which is the only reason accepting it matters. */
    @Test
    void thatSameExtensionlessExportMapsToAReview() throws Exception {
        ParsedTable table = parser.parse("f532f7b3-55e9-4f02-94db-78a4a78c3f2e",
                new ByteArrayInputStream(buildNaverReviewExport()));
        MapResult<CanonicalReview> mapped = new ReviewRowMapper().map(table);

        assertThat(mapped.errors()).isEmpty();
        assertThat(mapped.ok()).singleElement().satisfies(review -> {
            assertThat(review.externalId()).isEqualTo("900000001");
            assertThat(review.rating()).isEqualTo(5);
            assertThat(review.body()).isEqualTo("배송이 빨랐어요");
        });
    }

    @Test
    void aCsvWithNoExtensionIsAcceptedToo() {
        String csv = "상품명,평점,내용\n전선몰딩,5,좋아요\n";
        ParsedTable table = parser.parse("4adc92f2-567a-47d2-b3b9-6d9769e1c7f3",
                new ByteArrayInputStream(csv.getBytes(StandardCharsets.UTF_8)));

        assertThat(table.headers()).containsExactly("상품명", "평점", "내용");
        assertThat(table.rows()).hasSize(1);
    }

    /**
     * The other direction, and the reason this is not a loosening: a name that PROMISES a workbook buys
     * nothing. Bytes decide, so a lie in the filename is caught rather than trusted.
     */
    @Test
    void aNameThatPromisesAWorkbookDoesNotMakeOneAndIsRefused() {
        for (String name : new String[] {"data.txt", "export.xlsx", "export.csv", ""}) {
            assertThatThrownBy(() ->
                    parser.parse(name, new ByteArrayInputStream("x".getBytes(StandardCharsets.UTF_8))))
                    .as("%s", name)
                    .isInstanceOf(UnsupportedUploadFormatException.class);
        }
    }

    @Test
    void aJpegIsRefusedNoMatterWhatItIsCalled() {
        byte[] jpeg = {(byte) 0xFF, (byte) 0xD8, (byte) 0xFF, (byte) 0xE0, 0x00, 0x10, 'J', 'F', 'I', 'F'};

        assertThatThrownBy(() -> parser.parse("reviews.xlsx", new ByteArrayInputStream(jpeg)))
                .isInstanceOf(UnsupportedUploadFormatException.class);
    }

    /** A workbook is a zip, but a zip is not a workbook — an arbitrary archive never reaches POI. */
    @Test
    void aZipThatIsNotAWorkbookIsRefused() {
        byte[] zip = {0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x00, 0x00, 0x08, 0x00,
                'n', 'o', 't', 'e', 's', '.', 't', 'x', 't'};

        assertThatThrownBy(() -> parser.parse("reviews.xlsx", new ByteArrayInputStream(zip)))
                .isInstanceOf(UnsupportedUploadFormatException.class);
    }

    @Test
    void anEmptyUploadIsRefusedRatherThanReadAsAnEmptyTable() {
        assertThatThrownBy(() -> parser.parse("export", new ByteArrayInputStream(new byte[0])))
                .isInstanceOf(UnsupportedUploadFormatException.class);
    }

    /**
     * A minimal stand-in for the real export: the header row NAVER writes, and one fabricated review.
     * Built in-process on purpose — a committed copy of a live export would be customer review text in
     * the repository.
     */
    private byte[] buildNaverReviewExport() throws Exception {
        String[] headers = {"상품번호", "상품명", "리뷰구분", "구매자평점", "포토/영상", "리뷰상세내용",
                "리뷰도움수", "등록자", "리뷰등록일", "최종수정일", "리뷰글번호", "관련리뷰글번호",
                "관련리뷰상세내용", "전시상태", "답글여부", "답글등록일시"};
        String[] values = {"6473457702", "테스트 상품", "일반", "5", "N", "배송이 빨랐어요",
                "0", "테스터", "2026-08-02", "2026-08-02", "900000001", "", "", "정상", "N", ""};
        try (XSSFWorkbook wb = new XSSFWorkbook(); ByteArrayOutputStream out = new ByteArrayOutputStream()) {
            Sheet sheet = wb.createSheet("Sheet0");
            Row header = sheet.createRow(0);
            Row data = sheet.createRow(1);
            for (int i = 0; i < headers.length; i++) {
                header.createCell(i).setCellValue(headers[i]);
                data.createCell(i).setCellValue(values[i]);
            }
            wb.write(out);
            return out.toByteArray();
        }
    }

    private byte[] buildXlsx() throws Exception {
        try (XSSFWorkbook wb = new XSSFWorkbook(); ByteArrayOutputStream out = new ByteArrayOutputStream()) {
            Sheet sheet = wb.createSheet("orders");
            Row header = sheet.createRow(0);
            header.createCell(0).setCellValue("날짜");
            header.createCell(1).setCellValue("주문수");
            header.createCell(2).setCellValue("매출액");
            Row data = sheet.createRow(1);
            data.createCell(0).setCellValue("2026-06-01");
            data.createCell(1).setCellValue(42);
            data.createCell(2).setCellValue(567000);
            wb.write(out);
            return out.toByteArray();
        }
    }

    private byte[] buildNaverReviewXlsx() throws Exception {
        try (XSSFWorkbook wb = new XSSFWorkbook(); ByteArrayOutputStream out = new ByteArrayOutputStream()) {
            Sheet sheet = wb.createSheet("Sheet0");
            Row header = sheet.createRow(0);
            String[] cols = {"리뷰글번호", "상품번호", "상품명", "구매자평점",
                    "리뷰상세내용", "리뷰등록일", "상품주문번호"};
            for (int i = 0; i < cols.length; i++) {
                header.createCell(i).setCellValue(cols[i]);
            }
            Row data = sheet.createRow(1);
            data.createCell(0).setCellValue("RV-1001");
            data.createCell(1).setCellValue("SKU-77");
            data.createCell(2).setCellValue("전선몰딩 1호");
            data.createCell(3).setCellValue("5");
            data.createCell(4).setCellValue("설치가 쉬웠어요");
            data.createCell(5).setCellValue("2026.01.02. 09:08:07");
            data.createCell(6).setCellValue("ORDER-SHOULD-NOT-PERSIST");
            wb.write(out);
            return out.toByteArray();
        }
    }
}
