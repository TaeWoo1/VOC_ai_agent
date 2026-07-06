package com.sellerops.inquiry.esmimport;

import static org.assertj.core.api.Assertions.assertThat;

import com.sellerops.ingest.parse.FileParser;
import com.sellerops.ingest.parse.ParsedTable;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.Test;

/** Row classification: canonical/provenance mapping, PII drop, and reason codes. */
class EsmInquiryRowMapperTest {

    private final EsmInquiryRowMapper mapper = new EsmInquiryRowMapper();
    private final FileParser parser = new FileParser();
    private final UUID account = UUID.fromString("33333333-3333-3333-3333-333333333333");

    private ParsedTable table(Map<String, String> row) {
        return new ParsedTable(EsmInquiryImportHeaders.EXPECTED, List.of(row));
    }

    private Map<String, String> baseRow() {
        Map<String, String> r = new LinkedHashMap<>();
        for (String h : EsmInquiryImportHeaders.EXPECTED) {
            r.put(h, "");
        }
        r.put(EsmInquiryImportHeaders.REGISTRATION_KIND, "상품문의");   // a buyer inquiry kind
        r.put(EsmInquiryImportHeaders.STATUS, "미처리");
        r.put(EsmInquiryImportHeaders.BODY, "배송 문의드립니다");
        r.put(EsmInquiryImportHeaders.INQUIRY_TYPE, "배송");
        r.put(EsmInquiryImportHeaders.PRODUCT_REF, "1000000001");
        r.put(EsmInquiryImportHeaders.ORDER_REF, "2000000001");
        r.put(EsmInquiryImportHeaders.SELLER_ID, "SELLER123");
        r.put(EsmInquiryImportHeaders.RECEIVED_AT, "2026-07-01 09:00:00");
        r.put(EsmInquiryImportHeaders.BUYER_ID, "buyerSecret");
        return r;
    }

    @Test
    void mapsValidUnansweredRow() {
        List<EsmClassifiedRow> rows = mapper.classify(table(baseRow()), EsmMarketplace.GMARKET, account);
        assertThat(rows).hasSize(1);
        EsmClassifiedRow row = rows.get(0);
        assertThat(row.valid()).isTrue();
        assertThat(row.status()).isEqualTo("UNANSWERED");
        assertThat(row.sourceRow()).isEqualTo(2);
        assertThat(row.canonical().externalId()).startsWith("esm:GMARKET:" + account + ":");
        assertThat(row.canonical().receivedAt().toString()).isEqualTo("2026-07-01T00:00:00Z");
        assertThat(row.provenance().inquiryType()).isEqualTo("배송");
        assertThat(row.provenance().originalOrderRef()).isEqualTo("2000000001");
        assertThat(row.provenance().receivedAtRaw()).isEqualTo("2026-07-01 09:00:00");
    }

    @Test
    void neverCarriesBuyerIdIntoCanonicalOrProvenance() {
        EsmClassifiedRow row = mapper.classify(table(baseRow()), EsmMarketplace.GMARKET, account).get(0);
        // author (buyer/writer) is dropped; body is the inquiry, not the buyer id.
        assertThat(row.canonical().author()).isNull();
        assertThat(row.canonical().body()).doesNotContain("buyerSecret");
        assertThat(row.provenance().toString()).doesNotContain("buyerSecret");
    }

    @Test
    void missingBodyIsInvalid() {
        Map<String, String> r = baseRow();
        r.put(EsmInquiryImportHeaders.BODY, "");
        EsmClassifiedRow row = mapper.classify(table(r), EsmMarketplace.GMARKET, account).get(0);
        assertThat(row.valid()).isFalse();
        assertThat(row.reason()).isEqualTo(EsmImportReasonCode.MISSING_BODY);
        // Even an invalid row still exposes its selling id for the file-level cross-check.
        assertThat(row.sellerId()).isEqualTo("SELLER123");
    }

    @Test
    void contradictoryStatusIsInvalid() {
        Map<String, String> r = baseRow();
        r.put(EsmInquiryImportHeaders.ANSWER, "이미 답변함");
        EsmClassifiedRow row = mapper.classify(table(r), EsmMarketplace.GMARKET, account).get(0);
        assertThat(row.valid()).isFalse();
        assertThat(row.reason()).isEqualTo(EsmImportReasonCode.CONTRADICTORY_STATUS);
    }

    @Test
    void badTimestampIsInvalid() {
        Map<String, String> r = baseRow();
        r.put(EsmInquiryImportHeaders.RECEIVED_AT, "2026/07/01");
        EsmClassifiedRow row = mapper.classify(table(r), EsmMarketplace.GMARKET, account).get(0);
        assertThat(row.valid()).isFalse();
        assertThat(row.reason()).isEqualTo(EsmImportReasonCode.BAD_TIMESTAMP);
    }

    @Test
    void emergencyMessageRowIsOperationalNoticeNotBuyerInquiry() {
        Map<String, String> r = baseRow();
        r.put(EsmInquiryImportHeaders.REGISTRATION_KIND, "긴급메시지");   // shipping-delay emergency
        EsmClassifiedRow row = mapper.classify(table(r), EsmMarketplace.GMARKET, account).get(0);
        assertThat(row.operationalNotice()).isTrue();
        assertThat(row.valid()).isFalse();          // never persists
        assertThat(row.excluded()).isTrue();
        assertThat(row.reason()).isNull();           // excluded, NOT a malformed error
        // No canonical inquiry / status / fingerprint is produced — cannot open a WorkItem.
        assertThat(row.canonical()).isNull();
        assertThat(row.status()).isNull();
        // Selling id is still carried for the file-level cross-check.
        assertThat(row.sellerId()).isEqualTo("SELLER123");
    }

    @Test
    void unknownRegistrationKindIsUnsupportedAndWritesNothing() {
        Map<String, String> r = baseRow();
        r.put(EsmInquiryImportHeaders.REGISTRATION_KIND, "알수없는구분");
        EsmClassifiedRow row = mapper.classify(table(r), EsmMarketplace.GMARKET, account).get(0);
        assertThat(row.unsupported()).isTrue();
        assertThat(row.valid()).isFalse();
        assertThat(row.reason()).isNull();
        assertThat(row.canonical()).isNull();
    }

    @Test
    void operationalNoticeIsClassifiedEvenWithNoBodyOrBadTimestamp() {
        // Kind is decided from structured columns first: a 긴급메시지 row is an operational
        // notice regardless of body/timestamp, never a BAD_TIMESTAMP/MISSING_BODY error.
        Map<String, String> r = baseRow();
        r.put(EsmInquiryImportHeaders.REGISTRATION_KIND, "긴급메시지");
        r.put(EsmInquiryImportHeaders.BODY, "");
        r.put(EsmInquiryImportHeaders.RECEIVED_AT, "2026/99/99");
        EsmClassifiedRow row = mapper.classify(table(r), EsmMarketplace.GMARKET, account).get(0);
        assertThat(row.operationalNotice()).isTrue();
        assertThat(row.reason()).isNull();
    }

    @Test
    void dotSeparatedReceivedTimestampParses() {
        Map<String, String> r = baseRow();
        r.put(EsmInquiryImportHeaders.RECEIVED_AT, "2026.07.01 09:00:00");   // real ESM export shape
        EsmClassifiedRow row = mapper.classify(table(r), EsmMarketplace.GMARKET, account).get(0);
        assertThat(row.valid()).isTrue();
        assertThat(row.canonical().receivedAt().toString()).isEqualTo("2026-07-01T00:00:00Z");
        // The verbatim raw string (dots) is preserved in provenance.
        assertThat(row.provenance().receivedAtRaw()).isEqualTo("2026.07.01 09:00:00");
    }

    @Test
    void dotSeparatedProcessedTimestampParses() {
        Map<String, String> r = baseRow();
        r.put(EsmInquiryImportHeaders.STATUS, "처리완료");
        r.put(EsmInquiryImportHeaders.ANSWER, "답변 드렸습니다");
        r.put(EsmInquiryImportHeaders.RECEIVED_AT, "2026.07.01 09:00:00");
        r.put(EsmInquiryImportHeaders.PROCESSED_AT, "2026.07.02 10:30:00");
        EsmClassifiedRow row = mapper.classify(table(r), EsmMarketplace.GMARKET, account).get(0);
        assertThat(row.valid()).isTrue();
        assertThat(row.status()).isEqualTo("ANSWERED");
        assertThat(row.provenance().processedAtRaw()).isEqualTo("2026.07.02 10:30:00");
    }

    @Test
    void dotAndDashRowsProduceSameFingerprintButKeepDistinctRawProvenance() {
        Map<String, String> dash = baseRow();
        dash.put(EsmInquiryImportHeaders.RECEIVED_AT, "2026-07-01 09:00:00");
        Map<String, String> dot = baseRow();
        dot.put(EsmInquiryImportHeaders.RECEIVED_AT, "2026.07.01 09:00:00");

        EsmClassifiedRow dashRow = mapper.classify(table(dash), EsmMarketplace.GMARKET, account).get(0);
        EsmClassifiedRow dotRow = mapper.classify(table(dot), EsmMarketplace.GMARKET, account).get(0);

        // Same identity: canonical timestamp collapses the two separators to one fingerprint.
        assertThat(dotRow.fingerprint()).isEqualTo(dashRow.fingerprint());
        assertThat(dotRow.canonical().externalId()).isEqualTo(dashRow.canonical().externalId());
        // But the exact source strings remain distinct and unchanged in provenance.
        assertThat(dashRow.provenance().receivedAtRaw()).isEqualTo("2026-07-01 09:00:00");
        assertThat(dotRow.provenance().receivedAtRaw()).isEqualTo("2026.07.01 09:00:00");
        assertThat(dotRow.provenance().receivedAtRaw()).isNotEqualTo(dashRow.provenance().receivedAtRaw());
    }

    @Test
    void headerContractMatchesRealWorkbookAndPreservesLeadingZeros() {
        String[] data = EsmInquiryWorkbooks.unanswered("SELLER123", "본문", "2026-07-01 09:00:00");
        data[EsmInquiryWorkbooks.PRODUCT_REF] = "0007";   // must survive as text
        byte[] xlsx = EsmInquiryWorkbooks.build(List.<String[]>of(data));

        ParsedTable parsed = parser.parse("문의 관리.xlsx", new java.io.ByteArrayInputStream(xlsx));
        assertThat(EsmInquiryImportHeaders.matches(parsed)).isTrue();

        EsmClassifiedRow row = mapper.classify(parsed, EsmMarketplace.GMARKET, account).get(0);
        assertThat(row.valid()).isTrue();
        assertThat(row.provenance().originalProductRef()).isEqualTo("0007");
    }

    @Test
    void rejectsWrongHeaderShape() {
        String[] wrong = EsmInquiryWorkbooks.HEADERS.clone();
        wrong[1] = "상태";  // not 처리상태
        byte[] xlsx = EsmInquiryWorkbooks.build(wrong,
                List.<String[]>of(EsmInquiryWorkbooks.unanswered("S", "b", "2026-07-01 09:00:00")));
        ParsedTable parsed = parser.parse("문의 관리.xlsx", new java.io.ByteArrayInputStream(xlsx));
        assertThat(EsmInquiryImportHeaders.matches(parsed)).isFalse();
    }
}
