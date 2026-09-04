package com.sellerops.opportunity.dto;

import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

/**
 * One improvement opportunity as the seller sees it: what repeated, why this is suggested, what the
 * evidence is, and what can be done next.
 *
 * <p>Identity is {@code (issueId, kind)} — an opportunity is derived, so it has no id of its own and
 * needs none: the same issue and the same rule always name the same opportunity.
 *
 * @param whyKo fact sentences only — evidence count and span, the issue's own change judgement, the
 *     product, and the knowledge check. Never a cause, never an expected effect.
 * @param recommendationKo the suggestion in the seller's words, phrased as something to REVIEW
 * @param evidenceTo the issue's evidence surface — every quote behind this opportunity lives there
 * @param knowledge null for a product improvement review (no sentence to a customer answers it)
 * @param draft present only while ACCEPTED
 */
public record OpportunityView(UUID issueId, String kind, String kindLabelKo,
                              String status, String statusLabelKo,
                              String issueTitle, String aspect, String problem, String severity,
                              long evidenceCount, LocalDate firstEvidenceOn, LocalDate lastEvidenceOn,
                              List<String> changeLabelsKo,
                              UUID productId, String productName,
                              List<String> whyKo, String recommendationKo,
                              String evidenceTo,
                              OpportunityKnowledgeView knowledge,
                              String nextActionKo,
                              OpportunityDraftView draft,
                              Instant decidedAt) {
}
