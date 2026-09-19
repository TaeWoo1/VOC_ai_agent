package com.sellerops.inquiry.draft.dto;

import java.util.List;
import java.util.UUID;

/**
 * One customer need as the seller reads it on the Case (Inquiry Decision v2).
 *
 * @param status        FULL · CONDITIONAL_ON_CUSTOMER · PARTIAL · NONE · UNKNOWN
 * @param statusKo      the same, in the seller's words
 * @param evidence      what supports it — labels only (a document title, 「옵션 목록」), never the text
 * @param missing       what is still missing, for an uncovered need
 * @param askCustomer   what to ask the customer, for a conditional need
 * @param precedents    REUSABLE past answers proposed for an uncovered need (ids; the text is read again on display)
 * @param acquirable    the listing's detail was never read — reading it is a system step, not the seller's
 */
public record NeedCoverageView(String id, String ask, String type, String status, String statusKo,
                               List<String> evidence, String missing, String askCustomer, List<UUID> precedents,
                               boolean acquirable) {
}
