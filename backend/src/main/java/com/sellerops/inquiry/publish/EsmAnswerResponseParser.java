package com.sellerops.inquiry.publish;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.sellerops.inquiry.publish.EsmAnswerClient.Outcome;

/**
 * Pure parser of the ESM answer POST response into an {@link Outcome}. Success is a
 * body carrying a {@code messageNo} (accepted as a JSON string OR number, normalized
 * to a string); an explicit failure carries a numeric {@code resultCode} (the
 * free-text {@code message} is intentionally ignored — never surfaced or stored).
 * Anything else — a non-JSON body, or a body with neither field — is treated as
 * {@link Outcome.Kind#DELIVERY_UNKNOWN} (ambiguous; verify by re-query, never resend).
 */
public final class EsmAnswerResponseParser {

    /** Official answer endpoint sub-path (append to the ESM base URL). */
    public static final String QNA_PATH = "/item/v1/communications/customer/bulletin-board/qna";

    private static final ObjectMapper MAPPER = new ObjectMapper();

    private EsmAnswerResponseParser() {
    }

    public static Outcome parse(String body) {
        JsonNode node;
        try {
            node = MAPPER.readTree(body);
        } catch (Exception e) {
            return Outcome.deliveryUnknown();
        }
        if (node == null || !node.isObject()) {
            return Outcome.deliveryUnknown();
        }
        JsonNode messageNo = node.get("messageNo");
        if (messageNo != null && !messageNo.isNull() && !messageNo.asText().isBlank()) {
            return Outcome.success(messageNo.asText());
        }
        JsonNode resultCode = node.get("resultCode");
        if (resultCode != null && resultCode.canConvertToInt()) {
            return Outcome.failure(resultCode.intValue());
        }
        return Outcome.deliveryUnknown();
    }
}
