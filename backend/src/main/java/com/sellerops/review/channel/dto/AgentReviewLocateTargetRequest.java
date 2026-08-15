package com.sellerops.review.channel.dto;

import jakarta.validation.constraints.NotBlank;

/**
 * What the Local Agent sends to spend a locate binding: the opaque token, and nothing else.
 *
 * <p>A body rather than a path segment because the token is a single-use secret — a path is logged verbatim
 * by every proxy it crosses. Same shape and same reasoning as the reply path's {@code submissionRef}.
 */
public record AgentReviewLocateTargetRequest(@NotBlank String locateRef) {
}
