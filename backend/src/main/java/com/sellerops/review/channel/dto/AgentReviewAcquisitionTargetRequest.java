package com.sellerops.review.channel.dto;

import jakarta.validation.constraints.NotBlank;

/** What the Local Agent sends to spend an acquisition binding: the opaque token, in the BODY. */
public record AgentReviewAcquisitionTargetRequest(@NotBlank String acquisitionRef) {
}
