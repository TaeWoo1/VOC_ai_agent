package com.sellerops.agent.llm.goal;

import com.sellerops.agent.llm.operator.AgentOperatorProperties;
import com.sellerops.inquiry.goal.CustomerGoalPrompt;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/**
 * <b>The fourteenth LLM capability: reading a customer's message into goals.</b>
 *
 * <p>Its payload is the customer's own sentence and nothing else — no order, no product, no knowledge, no
 * resolution state. That is also the narrowest thing this capability could possibly need, because a goal is what
 * the customer asked for and the seller's situation cannot change what was asked.
 *
 * <p>{@link #admitsPolicyWidening()} is <b>false</b>, for the same reason the three retrieval capabilities decline
 * it: connecting a channel is a request to collect, not a request to send customers' sentences to a vendor. This
 * capability admits an organisation only by being named, under every access policy.
 *
 * <p>The property prefix is {@code sellerops.inquiry-goal.} rather than {@code sellerops.inquiry.goal.} because
 * the latter is a substring of this repository's own package name {@code com.sellerops.inquiry.goal.} — the
 * capability-separation guard reads source text, and a prefix that matches an import is a prefix that cannot be
 * told apart from one. The environment variables are unaffected: both spellings map to {@code SELLEROPS_INQUIRY_GOAL_*}.
 *
 * <p>The defaults are the configuration {@code customer-goal-interpreter/v3} was actually measured under — the
 * model, the output budget and the reasoning effort of the frozen holdout. Changing one of them makes this a
 * different arm than the one that produced the evidence, which is why they are written here rather than inherited.
 */
@Component
public class InquiryGoalProperties extends AgentOperatorProperties {

    public InquiryGoalProperties(
            @Value("${sellerops.inquiry-goal.enabled:false}") boolean enabled,
            @Value("${sellerops.inquiry-goal.enabled-org-ids:}") String enabledOrgIds,
            @Value("${sellerops.inquiry-goal.vendor:OPENAI}") String vendor,
            @Value("${sellerops.inquiry-goal.model:gpt-5-2025-08-07}") String model,
            @Value("${sellerops.inquiry-goal.api-key:}") String apiKey,
            @Value("${sellerops.inquiry-goal.max-output-tokens:900}") int maxOutputTokens,
            @Value("${sellerops.inquiry-goal.reasoning-effort:minimal}") String reasoningEffort) {
        super(enabled, enabledOrgIds, vendor, model, apiKey, maxOutputTokens, reasoningEffort);
    }

    @Override
    public String capabilityName() {
        return "SELLEROPS_INQUIRY_GOAL";
    }

    /** A seller connecting a channel did not ask for their customers' sentences to reach a vendor. */
    @Override
    public boolean admitsPolicyWidening() {
        return false;
    }

    /** The contract this capability ships, so a caller never has to name a version string itself. */
    public String promptVersion() {
        return CustomerGoalPrompt.VERSION;
    }
}
