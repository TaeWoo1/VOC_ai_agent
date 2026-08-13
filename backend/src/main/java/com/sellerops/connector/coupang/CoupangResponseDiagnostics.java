package com.sellerops.connector.coupang;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonMappingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.exc.MismatchedInputException;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.StringJoiner;
import java.util.stream.Collectors;

/**
 * The sanitization rules every Coupang response diagnostic obeys, in one place.
 *
 * <p>These were written for the order stream and are reused verbatim by the inquiry stream —
 * <b>deliberately shared rather than copied</b>. A second implementation of "what is safe to
 * say about a provider body" is a second thing to keep correct, and the failure mode of getting
 * it wrong (a buyer's inquiry text or an order amount in a log line) is exactly what these rules
 * exist to prevent. One implementation means one place to review.
 *
 * <p>What may be recorded: the {@code Content-Type} family, the Jackson binding path (field
 * NAMES and array indices) and target type, JSON node types, object KEY-NAME sets, and array
 * counts. Object keys are API schema, not data. <b>Never</b> a response value, buyer PII,
 * inquiry text, order id, amount, secret, header value, or raw body.
 */
final class CoupangResponseDiagnostics {

    /** The scalar error fields a non-2xx provider body may safely contribute to a message. */
    private static final List<String> SAFE_ERROR_FIELDS =
            List.of("code", "message", "errorCode", "error", "errorMessage");
    private static final int MAX_ERROR_DETAIL = 200;

    private CoupangResponseDiagnostics() {
    }

    /**
     * A sanitized, length-capped detail suffix for a non-2xx Coupang response — only the known
     * scalar error fields ({@link #SAFE_ERROR_FIELDS}); nested objects/arrays, headers, and the
     * raw body are never included. Returns {@code ""} when nothing safe is parseable.
     */
    static String errorDetail(ObjectMapper mapper, String body) {
        if (body == null || body.isBlank()) {
            return "";
        }
        try {
            JsonNode root = mapper.readTree(body);
            if (root == null || !root.isObject()) {
                return "";
            }
            LinkedHashMap<String, String> picked = new LinkedHashMap<>();
            for (String field : SAFE_ERROR_FIELDS) {
                JsonNode value = root.get(field);
                if (value != null && value.isValueNode() && !value.asText().isBlank()) {
                    picked.put(field, value.asText());
                }
            }
            if (picked.isEmpty()) {
                return "";
            }
            String detail = picked.entrySet().stream()
                    .map(e -> e.getKey() + "=" + e.getValue())
                    .collect(Collectors.joining(", "));
            if (detail.length() > MAX_ERROR_DETAIL) {
                detail = detail.substring(0, MAX_ERROR_DETAIL) + "…";
            }
            return " [" + detail + "]";
        } catch (Exception e) {
            return "";
        }
    }

    /**
     * A SHAPE-ONLY description of why a 200 body failed to bind — the exact information needed to
     * correct the DTO without a live re-run leaking anything. {@code payloadPath} names the keys to
     * walk from the root to the record-carrying node (e.g. {@code "data"} for the order envelope,
     * {@code "data","content"} for the inquiry envelope); the node it reaches is reported by type,
     * element count, and its first element's key names.
     */
    static String shapeDiagnostic(ObjectMapper mapper, CoupangHttpClient.Response response,
                                  JsonProcessingException cause, String... payloadPath) {
        StringBuilder sb = new StringBuilder();
        sb.append("contentType=").append(contentTypeFamily(response));
        if (cause instanceof JsonMappingException mapping) {
            sb.append(" path=").append(mappingPath(mapping));
            if (cause instanceof MismatchedInputException mismatch && mismatch.getTargetType() != null) {
                sb.append(" targetType=").append(mismatch.getTargetType().getSimpleName());
            }
        }
        try {
            JsonNode root = mapper.readTree(response.body());
            sb.append(" root=").append(nodeType(root));
            if (root != null && root.isObject()) {
                sb.append(" rootKeys=").append(fieldNames(root));
                JsonNode payload = root;
                StringBuilder walked = new StringBuilder();
                for (String key : payloadPath) {
                    payload = payload == null ? null : payload.get(key);
                    if (walked.length() > 0) {
                        walked.append('.');
                    }
                    walked.append(key);
                    // Report every level: a 200 whose `data` is an error object rather than a
                    // container is the case this has to make visible, and stopping at the leaf
                    // would show only "absent".
                    sb.append(' ').append(walked).append('=').append(nodeType(payload));
                    if (payload != null && payload.isObject()) {
                        sb.append(' ').append(walked).append("Keys=").append(fieldNames(payload));
                    }
                }
                if (payload != null && payload.isArray()) {
                    sb.append(" count=").append(payload.size());
                    if (!payload.isEmpty()) {
                        sb.append(" itemKeys=").append(fieldNames(payload.get(0)));
                    }
                }
            }
        } catch (Exception ignored) {
            // Body was not even well-formed JSON; length only (still no content).
            sb.append(" root=non-json(").append(response.body() == null ? 0 : response.body().length())
                    .append("chars)");
        }
        return sb.toString();
    }

    /**
     * The Jackson binding path as a compact {@code field[index].field} string built ONLY from
     * {@link JsonMappingException.Reference} field names and array indices — never a bound value.
     */
    static String mappingPath(JsonMappingException mapping) {
        StringBuilder sb = new StringBuilder();
        for (JsonMappingException.Reference ref : mapping.getPath()) {
            if (ref.getFieldName() != null) {
                if (sb.length() > 0) {
                    sb.append('.');
                }
                sb.append(ref.getFieldName());
            } else if (ref.getIndex() >= 0) {
                sb.append('[').append(ref.getIndex()).append(']');
            }
        }
        return sb.length() == 0 ? "<root>" : sb.toString();
    }

    /** The safe {@code (위치=…, 타입=…)} suffix for an operator-facing message — names/types only. */
    static String mappingPathSuffix(JsonProcessingException cause) {
        if (!(cause instanceof JsonMappingException mapping)) {
            return "";
        }
        String path = mappingPath(mapping);
        String type = cause instanceof MismatchedInputException mismatch && mismatch.getTargetType() != null
                ? ", 타입=" + mismatch.getTargetType().getSimpleName() : "";
        return " (위치=" + path + type + ")";
    }

    /** The response media type only — any charset/boundary parameters are dropped. */
    static String contentTypeFamily(CoupangHttpClient.Response response) {
        String raw = response.header("Content-Type").orElse(null);
        if (raw == null || raw.isBlank()) {
            return "<none>";
        }
        int semicolon = raw.indexOf(';');
        return (semicolon >= 0 ? raw.substring(0, semicolon) : raw).trim();
    }

    static String nodeType(JsonNode node) {
        return node == null ? "absent" : node.getNodeType().name();
    }

    /** The object's KEY names (schema), never its values. */
    static String fieldNames(JsonNode node) {
        if (node == null || !node.isObject()) {
            return "[]";
        }
        StringJoiner joiner = new StringJoiner(",", "[", "]");
        node.fieldNames().forEachRemaining(joiner::add);
        return joiner.toString();
    }
}
