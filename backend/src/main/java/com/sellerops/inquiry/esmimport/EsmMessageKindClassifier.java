package com.sellerops.inquiry.esmimport;

import java.util.Set;

/**
 * Classifies an ESM export row's {@link EsmMessageKind} from its <b>structured</b>
 * columns — primarily 등록구분 (registration kind), with 문의유형 (inquiry type) retained
 * for future operational-notice sub-typing. Free-text body content is never used: a
 * classification must be defensible from the export's own structured taxonomy, not from
 * keyword-matching inquiry text.
 *
 * <p>Fail-closed: only registration kinds on an explicit allow-list become
 * {@link EsmMessageKind#BUYER_INQUIRY}; the observed platform emergency-message kind
 * becomes {@link EsmMessageKind#PLATFORM_OPERATIONAL_NOTICE}; anything else (including a
 * blank or unrecognized kind) is {@link EsmMessageKind#UNSUPPORTED_OR_UNKNOWN} and is
 * never persisted as a buyer inquiry. The allow-lists are widened only when a new
 * registration kind is observed in a real export and deliberately classified.
 */
public final class EsmMessageKindClassifier {

    /** 등록구분 values that denote a genuine buyer inquiry requiring a seller reply. */
    static final Set<String> BUYER_REGISTRATION_KINDS = Set.of(
            "상품문의");   // observed buyer product Q&A

    /** 등록구분 values that denote a platform operational message (not a buyer inquiry). */
    static final Set<String> OPERATIONAL_REGISTRATION_KINDS = Set.of(
            "긴급메시지");  // observed shipping-delay emergency message

    private EsmMessageKindClassifier() {
    }

    /**
     * @param registrationKind 등록구분 (nullable/blank → unsupported)
     * @param inquiryType      문의유형 (currently informational; reserved for future
     *                         operational-notice sub-typing, e.g. shipping-delay)
     */
    public static EsmMessageKind classify(String registrationKind, String inquiryType) {
        String kind = registrationKind == null ? "" : registrationKind.strip();
        if (OPERATIONAL_REGISTRATION_KINDS.contains(kind)) {
            return EsmMessageKind.PLATFORM_OPERATIONAL_NOTICE;
        }
        if (BUYER_REGISTRATION_KINDS.contains(kind)) {
            return EsmMessageKind.BUYER_INQUIRY;
        }
        return EsmMessageKind.UNSUPPORTED_OR_UNKNOWN;   // fail closed
    }
}
