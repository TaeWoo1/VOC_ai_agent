package com.sellerops.order.fact;

import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

/**
 * Every exact order read leaves one line, and the line contains no order and no person.
 *
 * <p><b>Why a component and not a {@code log.info} at the call site.</b> A marketplace request made
 * on a seller's behalf has to be countable — how many, for what, with what result — or nobody can
 * answer "why did we call Cafe24 four hundred times yesterday". Putting the record in one class
 * makes the answer one grep, and makes the redaction rule a single reviewable decision rather than a
 * habit each caller has to remember.
 *
 * <p><b>What is recorded:</b> the inquiry this was for (a SellerOps UUID), the channel, the outcome
 * category, and when. <b>What is never recorded:</b> the order identifier, the mall id, the access
 * token, the request URI, any response body or field, and any buyer attribute. The identifier is
 * deliberately absent even though it is stored in {@code inquiries.source_order_ref} — a database
 * column has an owner, a retention and a reader; a log line has none of the three.
 */
@Component
public class ExactOrderReadAudit {

    private static final Logger log = LoggerFactory.getLogger(ExactOrderReadAudit.class);

    /**
     * Record one attempted read.
     *
     * @param inquiryId what the read was FOR — the "action context". Null for a read not tied to an
     *                  inquiry, which today no caller makes
     */
    public void record(UUID orgId, UUID inquiryId, String channelCode, ExactOrderReadOutcome outcome) {
        log.info("exact-order-read org={} inquiry={} channel={} outcome={}",
                orgId, inquiryId, channelCode, outcome);
    }

    /** Record that a read was NOT made because a fresh fact was already held. */
    public void recordSuppressed(UUID orgId, UUID inquiryId, String channelCode) {
        log.debug("exact-order-read-suppressed org={} inquiry={} channel={}",
                orgId, inquiryId, channelCode);
    }
}
