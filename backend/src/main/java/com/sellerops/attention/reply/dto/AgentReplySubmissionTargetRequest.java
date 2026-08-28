package com.sellerops.attention.reply.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;

/** The Local Agent spends a guided run's {@code submissionRef}; the ref travels in the body, never the path. */
public record AgentReplySubmissionTargetRequest(
        @NotBlank @Pattern(regexp = "[0-9a-f]{16}") String submissionRef) {
}
