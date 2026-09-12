package com.sellerops.collect.dto;

/**
 * What the failure route did: the id of the run row it wrote, or {@code null} when the write itself failed.
 *
 * <p>It reports nothing about the failure it recorded. The runtime already knows why its own run ended; what
 * it cannot know without being told is whether the seller will be able to read that later.
 */
public record AgentReviewAcquisitionFailureResultView(String importId) {
}
