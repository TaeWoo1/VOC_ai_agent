package com.sellerops.reviewissue.dto;

import java.time.LocalDate;
import java.util.UUID;

/**
 * One issue as an operator sees it in a list.
 *
 * <p>Framed as an 이슈 후보 / 운영 신호, never a diagnosis, and it carries no cause: the product may
 * say "문제가 이 상품에 집중되고 있습니다 — …를 먼저 확인해 보세요" and may never say "…가 원인입니다".
 * That is not a copy preference; the extractor's accuracy is unmeasured (the review-eval label seed
 * is empty), so a causal claim would be an assertion with nothing behind it.
 *
 * @param evidenceCount total evidence ever attached, so a small issue reads as small
 * @param dominantProductName the product carrying most evidence over the concentration window, or
 *     null when nothing is attributable — never a fabricated "기타"
 * @param extractorKind provenance, so a surface can say 규칙 기반 honestly
 */
public record ReviewIssueView(UUID id, String title, String aspect, String problem,
                              String severity, String lifecycleState, String lifecycleLabelKo,
                              long evidenceCount, LocalDate firstEvidenceOn,
                              LocalDate lastEvidenceOn, UUID dominantProductId,
                              String dominantProductName, boolean dismissed,
                              String extractorKind, IssueChangeView change) {
}
