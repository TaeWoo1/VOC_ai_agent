package com.sellerops.connector.esm.inquiry;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.sellerops.connector.esm.EsmHttpClient;
import com.sellerops.connector.esm.inquiry.EsmInquiryProbeReport.CountBucket;
import com.sellerops.connector.esm.inquiry.EsmInquiryProbeReport.FieldPresence;
import com.sellerops.connector.esm.inquiry.EsmInquiryProbeReport.ReceiveDateShape;
import com.sellerops.connector.esm.inquiry.EsmInquiryProbeReport.RetryAfterForm;
import com.sellerops.connector.esm.inquiry.EsmInquiryProbeReport.StatusClass;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;

/**
 * Turns one raw ESM+ INQUIRY probe {@link EsmHttpClient.Response} into a sanitized
 * {@link EsmInquiryProbeReport}: status class, parse/array booleans, field-presence
 * booleans, a coarse count bucket, the reply-status label set, and the {@code
 * receiveDate} shape. It is the redaction boundary for a read-only probe — the raw
 * body is read here and <b>never</b> leaves: no body, identifier, buyer/product
 * value, inquiry text, reply token, exact count, or exact timestamp is ever copied
 * into the report.
 *
 * <p>The success body is a top-level JSON array of {@link EsmInquiryItem}. A
 * non-success body is <b>not</b> parsed or inspected at all (status/headers only).
 * On 429 the standard {@code Retry-After} form is classified by reusing {@link
 * EsmInquiryRateLimitedException#fromResponse} (no clock read, no literal). INQUIRY
 * is official-doc confirmed but live-response unverified; nothing here enables live
 * inquiry ingestion or changes connector capabilities.
 */
public class EsmInquiryProbeReporter {

    private final EsmInquiryParser parser = new EsmInquiryParser();
    private final ObjectMapper mapper = new ObjectMapper();

    public EsmInquiryProbeReport report(EsmHttpClient.Response response) {
        int status = response.statusCode();
        StatusClass statusClass = classify(status);
        RetryAfterForm retryForm = status == 429 ? retryAfterForm(response) : RetryAfterForm.NONE;

        if (status != 200) {
            // Never parse or inspect a non-success body: status/headers only.
            return new EsmInquiryProbeReport(status, statusClass, false, false,
                    FieldPresence.absent(), CountBucket.ZERO, Set.of(), ReceiveDateShape.NONE, retryForm);
        }

        boolean isArray = isJsonArray(response.body());
        List<EsmInquiryItem> items = tryParse(response.body());
        if (items == null) {
            return new EsmInquiryProbeReport(status, statusClass, false, isArray,
                    FieldPresence.absent(), CountBucket.ZERO, Set.of(), ReceiveDateShape.NONE, retryForm);
        }

        return new EsmInquiryProbeReport(status, statusClass, true, isArray,
                fieldPresence(items), bucket(items.size()), statusTokens(items),
                receiveDateShape(items), retryForm);
    }

    private static StatusClass classify(int status) {
        if (status == 200) {
            return StatusClass.SUCCESS;
        }
        if (status == 401 || status == 403) {
            return StatusClass.UNAUTHORIZED;
        }
        if (status == 429) {
            return StatusClass.RATE_LIMITED;
        }
        if (status >= 400 && status < 500) {
            return StatusClass.CLIENT_ERROR;
        }
        if (status >= 500 && status < 600) {
            return StatusClass.SERVER_ERROR;
        }
        return StatusClass.OTHER;
    }

    /** Classify only the standard Retry-After form; never carry the literal value. */
    private static RetryAfterForm retryAfterForm(EsmHttpClient.Response response) {
        EsmInquiryRateLimitedException e = EsmInquiryRateLimitedException.fromResponse(response);
        if (e.retryAfterSeconds() != null) {
            return RetryAfterForm.SECONDS;
        }
        if (e.retryAfterAt().isPresent()) {
            return RetryAfterForm.HTTP_DATE;
        }
        return RetryAfterForm.NONE;
    }

    /** True iff the body parses as a JSON array (the success shape). */
    private boolean isJsonArray(String body) {
        if (body == null) {
            return false;
        }
        try {
            JsonNode node = mapper.readTree(body);
            return node != null && node.isArray();
        } catch (Exception e) {
            return false;
        }
    }

    private List<EsmInquiryItem> tryParse(String body) {
        try {
            return parser.parseItems(body);
        } catch (RuntimeException e) {
            // Parse failure is a recorded boolean; the body is never echoed.
            return null;
        }
    }

    private static FieldPresence fieldPresence(List<EsmInquiryItem> items) {
        boolean messageNo = false, qnaType = false, goodsNo = false, informStatus = false;
        boolean receiveDate = false, title = false, details = false, token = false, reAsking = false;
        for (EsmInquiryItem it : items) {
            messageNo |= present(it.messageNo());
            qnaType |= it.qnaType() != null;
            goodsNo |= present(it.goodsNo());
            informStatus |= present(it.informStatus());
            receiveDate |= present(it.receiveDate());
            title |= present(it.title());
            details |= present(it.details());
            token |= present(it.token());
            reAsking |= it.reAsking() != null;
        }
        return new FieldPresence(messageNo, qnaType, goodsNo, informStatus, receiveDate,
                title, details, token, reAsking);
    }

    /** The distinct reply-status labels observed (schema vocabulary, not row content). */
    private static Set<String> statusTokens(List<EsmInquiryItem> items) {
        Set<String> tokens = new LinkedHashSet<>();
        for (EsmInquiryItem it : items) {
            if (present(it.informStatus())) {
                tokens.add(it.informStatus().strip());
            }
        }
        return Set.copyOf(tokens);
    }

    private static ReceiveDateShape receiveDateShape(List<EsmInquiryItem> items) {
        boolean offset = false;
        boolean tzless = false;
        for (EsmInquiryItem it : items) {
            if (!present(it.receiveDate())) {
                continue;
            }
            // Offset-bearing iff it resolves without assuming a zone; never keep the value.
            if (EsmInquiryParser.parseReceivedAt(it.receiveDate()) != null) {
                offset = true;
            } else {
                tzless = true;
            }
        }
        if (offset && tzless) {
            return ReceiveDateShape.MIXED;
        }
        if (offset) {
            return ReceiveDateShape.OFFSET_BEARING;
        }
        if (tzless) {
            return ReceiveDateShape.TIMEZONE_LESS;
        }
        return ReceiveDateShape.NONE;
    }

    private static CountBucket bucket(int n) {
        if (n <= 0) {
            return CountBucket.ZERO;
        }
        if (n == 1) {
            return CountBucket.ONE;
        }
        if (n < 10) {
            return CountBucket.FEW;
        }
        if (n < 100) {
            return CountBucket.TENS;
        }
        if (n < 1000) {
            return CountBucket.HUNDREDS;
        }
        return CountBucket.THOUSANDS_PLUS;
    }

    private static boolean present(String value) {
        return value != null && !value.isBlank();
    }
}
