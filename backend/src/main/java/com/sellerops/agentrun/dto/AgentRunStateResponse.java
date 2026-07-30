package com.sellerops.agentrun.dto;

import com.fasterxml.jackson.databind.JsonNode;

/** The stored run state as returned by GET and PUT. Carries the current optimistic-lock version. */
public record AgentRunStateResponse(
        String threadId,
        String domain,
        String status,
        long version,
        JsonNode snapshot) {}
