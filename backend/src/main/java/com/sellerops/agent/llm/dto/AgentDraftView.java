package com.sellerops.agent.llm.dto;

/**
 * The generated draft, or an honest absence.
 *
 * <p>{@code available=false} covers every reason there is no model draft — the capability is off for
 * this org, the vendor refused, the answer was off-schema — because the caller does the same thing
 * with all of them: fall back to the deterministic rule drafter. {@code providerVersion} is present
 * whenever the capability is on for the org, so a run can record WHICH model was asked even when the
 * answer was a refusal.
 */
public record AgentDraftView(
        boolean available,
        String category,
        String title,
        String comments,
        String providerVersion) {

    public static AgentDraftView unavailable(String providerVersion) {
        return new AgentDraftView(false, null, null, null, providerVersion);
    }
}
