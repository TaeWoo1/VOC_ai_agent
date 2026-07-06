package com.sellerops.inquiry.esmimport;

import com.sellerops.ingest.canonical.CanonicalInquiry;
import com.sellerops.ingest.parse.ParsedTable;
import java.time.Instant;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Component;

/**
 * Maps the exact-header ESM inquiry export into per-row classifications. Pure and
 * deterministic given (file bytes, marketplace, sellerAccountId): the same inputs
 * always produce the same fingerprints and verdicts, which is what lets the preview
 * token bind a canonical result the confirm step can reproduce.
 *
 * <p>Buyer id (구매자 아이디) is read only to be carried nowhere — it is never placed
 * into the canonical inquiry, provenance, or any error. All identifiers are treated
 * as text (leading zeros preserved) because the source cells are text.
 */
@Component
@ConditionalOnProperty(name = "sellerops.inquiry-import.esm.enabled", havingValue = "true")
public class EsmInquiryRowMapper {

    private static final String UNSPECIFIED_PRODUCT = "(미지정 상품)";

    /**
     * Classify every data row. Caller must have already verified the header contract
     * ({@link EsmInquiryImportHeaders#matches}). Row numbers are 1-based with the
     * header as row 1 (first data row = 2), matching the existing upload convention.
     */
    public List<EsmClassifiedRow> classify(ParsedTable table, EsmMarketplace marketplace, UUID sellerAccountId) {
        List<EsmClassifiedRow> out = new ArrayList<>();
        int rowNumber = 1;
        for (Map<String, String> row : table.rows()) {
            rowNumber++;
            out.add(classifyRow(rowNumber, row, marketplace, sellerAccountId));
        }
        return out;
    }

    private EsmClassifiedRow classifyRow(int sourceRow, Map<String, String> row,
                                         EsmMarketplace marketplace, UUID sellerAccountId) {
        String sellerId = blankToNull(row.get(EsmInquiryImportHeaders.SELLER_ID));
        String body = blankToNull(row.get(EsmInquiryImportHeaders.BODY));
        if (body == null) {
            return EsmClassifiedRow.invalid(sourceRow, EsmImportReasonCode.MISSING_BODY, sellerId);
        }

        String receivedAtRaw = blankToNull(row.get(EsmInquiryImportHeaders.RECEIVED_AT));
        if (receivedAtRaw == null) {
            return EsmClassifiedRow.invalid(sourceRow, EsmImportReasonCode.MISSING_RECEIVED_AT, sellerId);
        }
        // Parse once (dash or dot, strict): derive both the stored UTC instant and the
        // separator-independent canonical form that feeds the fingerprint.
        Instant receivedAt;
        String receivedAtCanonical;
        try {
            LocalDateTime receivedLocal = EsmInquiryTimestamp.parseLocal(receivedAtRaw);
            receivedAt = receivedLocal.atZone(EsmInquiryTimestamp.ESM_ZONE).toInstant();
            receivedAtCanonical = EsmInquiryTimestamp.canonical(receivedAtRaw);
        } catch (Exception e) {
            return EsmClassifiedRow.invalid(sourceRow, EsmImportReasonCode.BAD_TIMESTAMP, sellerId);
        }

        String processedAtRaw = blankToNull(row.get(EsmInquiryImportHeaders.PROCESSED_AT));
        if (processedAtRaw != null) {
            try {
                EsmInquiryTimestamp.parseLocal(processedAtRaw);
            } catch (Exception e) {
                return EsmClassifiedRow.invalid(sourceRow, EsmImportReasonCode.BAD_TIMESTAMP, sellerId);
            }
        }

        String rawStatus = blankToNull(row.get(EsmInquiryImportHeaders.STATUS));
        boolean answerPresent = blankToNull(row.get(EsmInquiryImportHeaders.ANSWER)) != null;
        boolean processedPresent = processedAtRaw != null;
        EsmInquiryStatusClassifier.Verdict verdict =
                EsmInquiryStatusClassifier.classify(rawStatus, answerPresent, processedPresent);
        if (!verdict.valid()) {
            return EsmClassifiedRow.invalid(sourceRow, verdict.reason(), sellerId);
        }

        String inquiryType = blankToNull(row.get(EsmInquiryImportHeaders.INQUIRY_TYPE));
        String productRef = blankToNull(row.get(EsmInquiryImportHeaders.PRODUCT_REF));
        String orderRef = blankToNull(row.get(EsmInquiryImportHeaders.ORDER_REF));
        String registrationKind = blankToNull(row.get(EsmInquiryImportHeaders.REGISTRATION_KIND));
        String orderType = blankToNull(row.get(EsmInquiryImportHeaders.ORDER_TYPE));
        String productName = blankToNull(row.get(EsmInquiryImportHeaders.PRODUCT_NAME));

        String fingerprint = EsmInquiryFingerprint.compute(
                marketplace, sellerAccountId, inquiryType, orderRef, productRef, receivedAtCanonical, body);
        String externalId = EsmInquiryFingerprint.externalId(marketplace, sellerAccountId, fingerprint);

        // Product is optional; resolve by name+ref, defaulting like the legacy upload path.
        String resolvedName = (productName == null && productRef == null) ? UNSPECIFIED_PRODUCT : productName;
        CanonicalInquiry canonical = new CanonicalInquiry(
                resolvedName, productRef, null, body, verdict.canonicalStatus(),
                receivedAt, externalId, sourceRow, null, rawStatus);

        EsmImportProvenanceData provenance = new EsmImportProvenanceData(
                sourceRow, registrationKind, inquiryType, productRef, orderRef, orderType,
                receivedAtRaw, processedAtRaw, fingerprint, EsmInquiryFingerprint.VERSION);

        return EsmClassifiedRow.valid(sourceRow, sellerId, verdict.canonicalStatus(),
                fingerprint, canonical, provenance);
    }

    private static String blankToNull(String s) {
        return (s == null || s.isBlank()) ? null : s.strip();
    }
}
