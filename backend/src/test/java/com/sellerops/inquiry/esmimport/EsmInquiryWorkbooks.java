package com.sellerops.inquiry.esmimport;

import java.io.ByteArrayOutputStream;
import java.util.List;
import org.apache.poi.ss.usermodel.Cell;
import org.apache.poi.ss.usermodel.Row;
import org.apache.poi.ss.usermodel.Sheet;
import org.apache.poi.xssf.usermodel.XSSFWorkbook;

/**
 * Builds ESM inquiry (문의 관리) .xlsx bytes for tests, matching the inspected sample:
 * one sheet, header at row 1, all cells string-typed (so leading zeros survive). Header
 * labels are written in their real case (e.g. {@code CS담당자명}); the parser lowercases
 * them, matching the importer's expected contract.
 */
final class EsmInquiryWorkbooks {

    // Original-case headers A..N.
    static final String[] HEADERS = {
            "등록구분", "처리상태", "상품명", "문의내용", "답변내용", "문의유형", "상품번호",
            "주문번호", "판매아이디", "접수일시", "처리일시", "구매자 아이디", "주문종류", "CS담당자명"};

    // Column indexes.
    static final int REGISTRATION_KIND = 0;
    static final int STATUS = 1;
    static final int PRODUCT_NAME = 2;
    static final int BODY = 3;
    static final int ANSWER = 4;
    static final int INQUIRY_TYPE = 5;
    static final int PRODUCT_REF = 6;
    static final int ORDER_REF = 7;
    static final int SELLER_ID = 8;
    static final int RECEIVED_AT = 9;
    static final int PROCESSED_AT = 10;
    static final int BUYER_ID = 11;
    static final int ORDER_TYPE = 12;
    static final int CS_AGENT = 13;

    private EsmInquiryWorkbooks() {
    }

    /** A 14-cell row, all blank. Callers fill the columns they care about. */
    static String[] row() {
        String[] r = new String[HEADERS.length];
        java.util.Arrays.fill(r, "");
        return r;
    }

    /** A well-formed unanswered row for the given selling id, body, and received timestamp. */
    static String[] unanswered(String sellerId, String body, String receivedAt) {
        String[] r = row();
        r[REGISTRATION_KIND] = "상품문의";
        r[STATUS] = "미처리";
        r[PRODUCT_NAME] = "테스트 상품";
        r[BODY] = body;
        r[INQUIRY_TYPE] = "배송";
        r[PRODUCT_REF] = "1000000001";
        r[ORDER_REF] = "2000000001";
        r[SELLER_ID] = sellerId;
        r[RECEIVED_AT] = receivedAt;
        r[BUYER_ID] = "buyer***";
        r[ORDER_TYPE] = "일반";
        return r;
    }

    /** A well-formed answered row (처리완료 + answer content + processed time). */
    static String[] answered(String sellerId, String body, String receivedAt, String processedAt) {
        String[] r = unanswered(sellerId, body, receivedAt);
        r[STATUS] = "처리완료";
        r[ANSWER] = "답변 드렸습니다";
        r[PROCESSED_AT] = processedAt;
        return r;
    }

    /**
     * A platform operational notice row as seen in the real export: 등록구분 긴급메시지
     * (shipping-delay emergency message), 문의유형 배송, 미처리. Carries the selling id so the
     * file-level cross-check still applies, but is excluded from import.
     */
    static String[] operationalNotice(String sellerId, String body, String receivedAt) {
        String[] r = unanswered(sellerId, body, receivedAt);
        r[REGISTRATION_KIND] = "긴급메시지";
        return r;
    }

    /** A row whose 등록구분 is not a recognized kind — must fail closed (unsupported). */
    static String[] unsupported(String sellerId, String body, String receivedAt) {
        String[] r = unanswered(sellerId, body, receivedAt);
        r[REGISTRATION_KIND] = "알수없는구분";
        return r;
    }

    static byte[] build(List<String[]> dataRows) {
        return build(HEADERS, dataRows);
    }

    static byte[] build(String[] headers, List<String[]> dataRows) {
        try (XSSFWorkbook wb = new XSSFWorkbook(); ByteArrayOutputStream out = new ByteArrayOutputStream()) {
            Sheet sheet = wb.createSheet("worksheet1");
            Row header = sheet.createRow(0);
            for (int c = 0; c < headers.length; c++) {
                Cell cell = header.createCell(c);
                cell.setCellValue(headers[c]);
            }
            int r = 1;
            for (String[] data : dataRows) {
                Row row = sheet.createRow(r++);
                for (int c = 0; c < data.length; c++) {
                    Cell cell = row.createCell(c);
                    cell.setCellValue(data[c] == null ? "" : data[c]);
                }
            }
            wb.write(out);
            return out.toByteArray();
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }
}
