package com.sellerops.connector.esm.inquiry;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.sellerops.connector.esm.EsmHttpClient;
import com.sellerops.connector.esm.inquiry.EsmInquiryProbeReport.CountBucket;
import com.sellerops.connector.esm.inquiry.EsmInquiryProbeReport.EnvelopePresence;
import com.sellerops.connector.esm.inquiry.EsmInquiryProbeReport.FieldPresence;
import com.sellerops.connector.esm.inquiry.EsmInquiryProbeReport.RegDateShape;
import com.sellerops.connector.esm.inquiry.EsmInquiryProbeReport.RetryAfterForm;
import com.sellerops.connector.esm.inquiry.EsmInquiryProbeReport.StatusClass;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;

/**
 * Turns one raw ESM+ INQUIRY probe {@link EsmHttpClient.Response} into a sanitized
 * {@link EsmInquiryProbeReport}: status class, parse/JSON booleans, envelope &amp;
 * field presence booleans, a coarse count bucket, the reply-status label set, the
 * {@code regDate} shape, and the {@code Retry-After} form. It is the redaction
 * boundary for a read-only probe — the raw body is read here and <b>never</b>
 * leaves: no body, identifier, buyer/product value, inquiry text, exact count, or
 * exact timestamp is ever copied into the report.
 *
 * <p>A non-success body is <b>not</b> parsed or inspected at all (status/headers
 * only). On 429 the standard {@code Retry-After} form is classified by reusing
 * {@link EsmInquiryRateLimitedException#fromResponse} (no clock read, no literal).
 * INQUIRY remains NEEDS_VERIFICATION; nothing here changes connector capabilities.
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
                    EnvelopePresence.absent(), FieldPresence.absent(), CountBucket.ZERO,
                    Set.of(), RegDateShape.NONE, retryForm);
        }

        boolean validJson = isJsonObject(response.body());
        EsmInquiryResponse parsed = tryParse(response.body());
        if (parsed == null) {
            return new EsmInquiryProbeReport(status, statusClass, false, validJson,
                    EnvelopePresence.absent(), FieldPresence.absent(), CountBucket.ZERO,
                    Set.of(), RegDateShape.NONE, retryForm);
        }

        List<EsmInquiryResponse.Item> items = parsed.items() == null ? List.of() : parsed.items();
        EnvelopePresence env = new EnvelopePresence(
                parsed.items() != null, parsed.totalCount() != null,
                parsed.page() != null, parsed.pageSize() != null);
        return new EsmInquiryProbeReport(status, statusClass, true, validJson, env,
                fieldPresence(items), bucket(items.size()), statusTokens(items),
                regDateShape(items), retryForm);
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

    private boolean isJsonObject(String body) {
        if (body == null) {
            return false;
        }
        try {
            JsonNode node = mapper.readTree(body);
            return node != null && node.isObject();
        } catch (Exception e) {
            return false;
        }
    }

    private EsmInquiryResponse tryParse(String body) {
        try {
            return parser.parse(body);
        } catch (RuntimeException e) {
            // Parse failure is a recorded boolean; the body is never echoed.
            return null;
        }
    }

    private static FieldPresence fieldPresence(List<EsmInquiryResponse.Item> items) {
        boolean inquiryId = false, qnaType = false, itemName = false, itemNo = false;
        boolean buyerId = false, contents = false, status = false, regDate = false;
        for (EsmInquiryResponse.Item it : items) {
            inquiryId |= present(it.inquiryId());
            qnaType |= present(it.qnaType());
            itemName |= present(it.itemName());
            itemNo |= present(it.itemNo());
            buyerId |= present(it.buyerId());
            contents |= present(it.contents());
            status |= present(it.status());
            regDate |= present(it.regDate());
        }
        return new FieldPresence(inquiryId, qnaType, itemName, itemNo, buyerId, contents, status, regDate);
    }

    /** The distinct reply-status labels observed (schema vocabulary, not row content). */
    private static Set<String> statusTokens(List<EsmInquiryResponse.Item> items) {
        Set<String> tokens = new LinkedHashSet<>();
        for (EsmInquiryResponse.Item it : items) {
            if (present(it.status())) {
                tokens.add(it.status().strip());
            }
        }
        return Set.copyOf(tokens);
    }

    private static RegDateShape regDateShape(List<EsmInquiryResponse.Item> items) {
        boolean offset = false;
        boolean tzless = false;
        for (EsmInquiryResponse.Item it : items) {
            if (!present(it.regDate())) {
                continue;
            }
            // Offset-bearing iff it resolves without assuming a zone; never keep the value.
            if (EsmInquiryParser.parseReceivedAt(it.regDate()) != null) {
                offset = true;
            } else {
                tzless = true;
            }
        }
        if (offset && tzless) {
            return RegDateShape.MIXED;
        }
        if (offset) {
            return RegDateShape.OFFSET_BEARING;
        }
        if (tzless) {
            return RegDateShape.TIMEZONE_LESS;
        }
        return RegDateShape.NONE;
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
