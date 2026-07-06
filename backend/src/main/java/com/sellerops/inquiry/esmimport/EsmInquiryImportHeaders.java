package com.sellerops.inquiry.esmimport;

import com.sellerops.ingest.parse.ParsedTable;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.List;

/**
 * The exact, ordered ESM inquiry (문의 관리) export header contract. The importer is
 * fail-closed: a file whose header row is not byte-for-byte these 14 columns, in
 * this order, is rejected before any row is classified. Headers are compared after
 * the same normalization {@link com.sellerops.ingest.parse.FileParser} applies
 * (BOM-strip + strip + lowercase); Korean labels are unaffected by lowercasing.
 */
public final class EsmInquiryImportHeaders {

    // Column order A..N of the inspected sanitized sample.
    public static final String REGISTRATION_KIND = "등록구분";   // A
    public static final String STATUS = "처리상태";              // B
    public static final String PRODUCT_NAME = "상품명";          // C
    public static final String BODY = "문의내용";                // D
    public static final String ANSWER = "답변내용";              // E
    public static final String INQUIRY_TYPE = "문의유형";        // F
    public static final String PRODUCT_REF = "상품번호";         // G
    public static final String ORDER_REF = "주문번호";           // H
    public static final String SELLER_ID = "판매아이디";         // I
    public static final String RECEIVED_AT = "접수일시";         // J
    public static final String PROCESSED_AT = "처리일시";        // K
    public static final String BUYER_ID = "구매자 아이디";       // L (PII — read for cross-checks only, never persisted)
    public static final String ORDER_TYPE = "주문종류";          // M
    public static final String CS_AGENT = "cs담당자명";          // N (lowercased 'CS')

    /** The canonical header row, in order, already normalized to match parsed headers. */
    public static final List<String> EXPECTED = List.of(
            REGISTRATION_KIND, STATUS, PRODUCT_NAME, BODY, ANSWER, INQUIRY_TYPE,
            PRODUCT_REF, ORDER_REF, SELLER_ID, RECEIVED_AT, PROCESSED_AT, BUYER_ID,
            ORDER_TYPE, CS_AGENT);

    private EsmInquiryImportHeaders() {
    }

    /** True iff the parsed table's header row is exactly {@link #EXPECTED}, in order. */
    public static boolean matches(ParsedTable table) {
        return EXPECTED.equals(table.headers());
    }

    /**
     * Stable signature of the exact expected header contract — bound into the preview
     * token so confirm can prove the re-uploaded file has the identical header shape.
     * Constant for a valid file (it only ever equals a file that matched EXPECTED).
     */
    public static String signature() {
        return sha256Hex(String.join("", EXPECTED));
    }

    private static String sha256Hex(String s) {
        try {
            byte[] d = MessageDigest.getInstance("SHA-256").digest(s.getBytes(StandardCharsets.UTF_8));
            StringBuilder sb = new StringBuilder(d.length * 2);
            for (byte b : d) {
                sb.append(Character.forDigit((b >> 4) & 0xF, 16)).append(Character.forDigit(b & 0xF, 16));
            }
            return sb.toString();
        } catch (Exception e) {
            throw new IllegalStateException("SHA-256 unavailable", e);
        }
    }
}
