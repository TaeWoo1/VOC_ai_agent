package com.sellerops.inquiry.publish;

import java.util.UUID;

/**
 * <b>The answer lifecycle for one work item moved.</b> Published after a confirm, a verify or a
 * resume has finished writing, so a surface that DERIVES from that record can re-derive now instead
 * of at its next scheduled pass.
 *
 * <p>It carries three identifiers and nothing else — no phase, no execution status, no category, no
 * draft text. A listener that needs to know what happened reads it from the rows, through
 * {@link AnswerDeliveryTruthReader}; an event that carried the conclusion would be a second copy of
 * it, free to disagree with the table the moment anything else wrote there.
 *
 * <p><b>It is a notification, not a command.</b> Nothing a listener does may change what this package
 * decided, and no listener's failure may change it either — the publish path has already committed by
 * the time this is raised.
 *
 * @param orgId      the organisation the work item belongs to; every listener stays org-scoped
 * @param inquiryId  the subject a case is keyed by
 * @param workItemId the record whose lifecycle moved
 */
public record InquiryAnswerSettledEvent(UUID orgId, UUID inquiryId, UUID workItemId) {
}
