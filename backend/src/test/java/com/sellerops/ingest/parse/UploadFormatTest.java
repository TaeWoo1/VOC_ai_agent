package com.sellerops.ingest.parse;

import static org.assertj.core.api.Assertions.assertThat;

import java.io.BufferedInputStream;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import org.apache.poi.ss.usermodel.Sheet;
import org.apache.poi.xssf.usermodel.XSSFWorkbook;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * The one file-detection contract, in isolation.
 *
 * <p>It exists because two paths were answering "what is this file" differently: the guided Action Window
 * runtime sniffed magic bytes and renamed the download before uploading, while the manual fallback read
 * the filename extension. NAVER's export has no extension, so the fallback could not accept the very file
 * the guided path had failed to deliver. Sharing one detector is what stops that drift returning.
 */
class UploadFormatTest {

    @Test
    @DisplayName("a workbook is recognised by its bytes, with no filename involved at all")
    void aWorkbookIsRecognisedByItsBytes() throws Exception {
        assertThat(UploadFormat.of(workbookBytes())).isEqualTo(UploadFormat.XLSX);
    }

    @Test
    @DisplayName("a zip that is not OOXML is UNKNOWN — an archive never reaches the workbook parser")
    void aBareZipIsNotAWorkbook() {
        byte[] zip = {0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x00, 0x00, 'n', 'o', 't', 'e', 's'};

        assertThat(UploadFormat.of(zip)).isEqualTo(UploadFormat.UNKNOWN);
    }

    @Test
    @DisplayName("delimited UTF-8 text is CSV; prose and single words are not")
    void delimitedTextIsCsvAndProseIsNot() {
        assertThat(UploadFormat.of(utf8("상품명,평점,내용\n전선몰딩,5,좋아요\n"))).isEqualTo(UploadFormat.CSV);
        assertThat(UploadFormat.of(utf8("날짜;주문수;매출액\n2026-08-01;3;1000\n"))).isEqualTo(UploadFormat.CSV);
        assertThat(UploadFormat.of(utf8("상품명\t평점\n전선몰딩\t5\n"))).isEqualTo(UploadFormat.CSV);

        assertThat(UploadFormat.of(utf8("이 파일은 리뷰 내보내기가 아닙니다"))).isEqualTo(UploadFormat.UNKNOWN);
        assertThat(UploadFormat.of(utf8("x"))).isEqualTo(UploadFormat.UNKNOWN);
        assertThat(UploadFormat.of(utf8(""))).isEqualTo(UploadFormat.UNKNOWN);
        assertThat(UploadFormat.of(null)).isEqualTo(UploadFormat.UNKNOWN);
    }

    @Test
    @DisplayName("binary that is not a workbook stays UNKNOWN — strict UTF-8 is what keeps it out")
    void binaryIsNotMistakenForText() {
        byte[] jpeg = {(byte) 0xFF, (byte) 0xD8, (byte) 0xFF, (byte) 0xE0, 0x00, 0x10, 'J', 'F', 'I', 'F'};
        byte[] pdf = "%PDF-1.7\n%âã".getBytes(StandardCharsets.ISO_8859_1);
        byte[] nulPadded = {'a', ',', 'b', 0x00, 'c'};

        assertThat(UploadFormat.of(jpeg)).isEqualTo(UploadFormat.UNKNOWN);
        assertThat(UploadFormat.of(pdf)).isEqualTo(UploadFormat.UNKNOWN);
        assertThat(UploadFormat.of(nulPadded)).as("NUL never occurs in a delimited export")
                .isEqualTo(UploadFormat.UNKNOWN);
    }

    /**
     * The sniff window can land mid-character. Reporting that as malformed would misjudge a real UTF-8
     * export purely because of where we stopped reading.
     */
    @Test
    @DisplayName("a multi-byte character cut in half by the sniff window is not a malformed file")
    void aTruncatedMultibyteCharacterDoesNotBreakDetection() {
        byte[] full = utf8("상품명,평점,내용\n" + "가".repeat(20_000));

        assertThat(full.length).isGreaterThan(UploadFormat.SNIFF_BYTES);
        assertThat(UploadFormat.of(java.util.Arrays.copyOf(full, UploadFormat.SNIFF_BYTES)))
                .isEqualTo(UploadFormat.CSV);
    }

    @Test
    @DisplayName("detect() rewinds the stream, so the caller parses the same bytes")
    void detectLeavesTheStreamWhereItFoundIt() throws Exception {
        byte[] csv = utf8("상품명,평점\n전선몰딩,5\n");
        BufferedInputStream in = new BufferedInputStream(new ByteArrayInputStream(csv));

        assertThat(UploadFormat.detect(in)).isEqualTo(UploadFormat.CSV);
        assertThat(in.readAllBytes()).isEqualTo(csv);
    }

    private static byte[] utf8(String s) {
        return s.getBytes(StandardCharsets.UTF_8);
    }

    private static byte[] workbookBytes() throws Exception {
        try (XSSFWorkbook wb = new XSSFWorkbook(); ByteArrayOutputStream out = new ByteArrayOutputStream()) {
            Sheet sheet = wb.createSheet("Sheet0");
            sheet.createRow(0).createCell(0).setCellValue("리뷰글번호");
            wb.write(out);
            return out.toByteArray();
        }
    }
}
