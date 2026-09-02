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

    /**
     * <b>The 2026-09-02 live guided import, refused at the last step.</b>
     *
     * The seller was walked through the whole NAVER export — login, dates, 조회, download — and the run died
     * `INGEST_FAILED` with "지원하지 않는 파일 형식입니다" about a workbook Excel opens without complaint.
     * The detector looked for the OOXML marker in the first 8 KB because this class asserted the entry is
     * always first. In NAVER's export it is SECOND: nine entries, {@code xl/worksheets/sheet1.xml} first, and
     * the marker's local header 15,413 bytes in.
     *
     * <p>Built synthetically here rather than from the real export — that file is seller data and does not
     * belong in the repository. What matters is the SHAPE: a valid package whose marker sits past the old
     * window.
     */
    @Test
    @DisplayName("a workbook whose [Content_Types].xml is not the first entry is still a workbook")
    void aWorkbookWithALateContentTypesEntryIsRecognised() throws Exception {
        byte[] zip = zipWithLateContentTypes();

        assertThat(zip[0]).isEqualTo((byte) 0x50);
        // The shape that caused the refusal: nothing to find in the window the detector used to read.
        assertThat(UploadFormat.of(java.util.Arrays.copyOf(zip, UploadFormat.SNIFF_BYTES)))
                .isEqualTo(UploadFormat.UNKNOWN);
        // Reading the stream, which is what production does, now finds it.
        assertThat(UploadFormat.detect(new BufferedInputStream(new ByteArrayInputStream(zip))))
                .isEqualTo(UploadFormat.XLSX);
    }

    @Test
    @DisplayName("a big archive that never declares OOXML is still UNKNOWN — the longer look is not a loosening")
    void aLargeArchiveWithoutTheMarkerIsStillUnknown() throws Exception {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        try (java.util.zip.ZipOutputStream zos = new java.util.zip.ZipOutputStream(out)) {
            zos.putNextEntry(new java.util.zip.ZipEntry("notes/a.txt"));
            zos.write(new byte[64 * 1024]);
            zos.closeEntry();
        }

        assertThat(UploadFormat.detect(new BufferedInputStream(new ByteArrayInputStream(out.toByteArray()))))
                .isEqualTo(UploadFormat.UNKNOWN);
    }

    @Test
    @DisplayName("the longer look still rewinds — a workbook parses from byte zero afterwards")
    void theZipLookRewindsToo() throws Exception {
        byte[] zip = zipWithLateContentTypes();
        BufferedInputStream in = new BufferedInputStream(new ByteArrayInputStream(zip));

        assertThat(UploadFormat.detect(in)).isEqualTo(UploadFormat.XLSX);
        assertThat(in.readAllBytes()).isEqualTo(zip);
    }

    /** A valid OOXML package whose marker entry is second and lands well past {@link UploadFormat#SNIFF_BYTES}. */
    private static byte[] zipWithLateContentTypes() throws Exception {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        try (java.util.zip.ZipOutputStream zos = new java.util.zip.ZipOutputStream(out)) {
            zos.putNextEntry(new java.util.zip.ZipEntry("xl/worksheets/sheet1.xml"));
            // Incompressible, so the entry really occupies the window rather than deflating away to nothing.
            byte[] filler = new byte[32 * 1024];
            new java.util.Random(7).nextBytes(filler);
            zos.write(filler);
            zos.closeEntry();
            zos.putNextEntry(new java.util.zip.ZipEntry("[Content_Types].xml"));
            zos.write("<Types/>".getBytes(StandardCharsets.UTF_8));
            zos.closeEntry();
        }
        return out.toByteArray();
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
