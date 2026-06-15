package com.sellerops.ingest.parse;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.sellerops.common.ApiException;
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
    void rejectsUnsupportedExtension() {
        assertThatThrownBy(() ->
                parser.parse("data.txt", new ByteArrayInputStream("x".getBytes(StandardCharsets.UTF_8))))
                .isInstanceOf(ApiException.class);
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
}
