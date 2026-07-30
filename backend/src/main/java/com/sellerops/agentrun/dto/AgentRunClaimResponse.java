package com.sellerops.agentrun.dto;

import com.fasterxml.jackson.databind.JsonNode;

/**
 * Outcome of a claim attempt (HTTP 200 in every case below; genuine absence is a 404):
 *
 * <ul>
 *   <li>{@code CLAIMED} — this caller won the AWAITING→owned transition and may mutate exactly once;
 *   <li>{@code ALREADY_DONE} — the run already finished; the caller replays the recorded outcome
 *       ({@code snapshot} carries the DONE state so a double resume is idempotent);
 *   <li>{@code CONFLICT} — the run is still awaiting but at a different version: a concurrent resume is
 *       in flight, so this caller fails closed.
 * </ul>
 */
public record AgentRunClaimResponse(String outcome, long version, JsonNode snapshot) {}
