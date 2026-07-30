package com.sellerops.agentrun.dto;

import com.fasterxml.jackson.databind.JsonNode;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;

/**
 * Upsert body for {@code PUT /api/agent-run-store/{threadId}}.
 *
 * <p>{@code version} is the optimistic-lock expectation: {@code null} means "insert this as a new run"
 * (fails with 409 if the thread already exists in this org); a number means "update only if the stored
 * version still equals this" (a stale value fails closed with 409). {@code snapshot} is the sanitized
 * run snapshot as a JSON object — the service rejects it if it carries a raw-content key.
 */
public record AgentRunStateRequest(
        @NotBlank String domain,
        @NotBlank String status,
        Long version,
        @NotNull JsonNode snapshot) {}
