package com.sellerops.inquiry.decision;

import com.sellerops.agent.access.AgentCapabilityGate;
import java.util.Arrays;
import java.util.List;
import java.util.UUID;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/**
 * The Inquiry Decision v2 capability's switch — its own flag, its own key, its own explicit org list, off by default.
 *
 * <p><b>Why its own capability.</b> It sends the customer's inquiry to a vendor on the assessment path — the one the
 * investigation and the draft both read — together with the seller's candidate evidence and past answers. That is a
 * different exposure from the draft (which already sends both, but only when a seller asked for a draft) and from the
 * retrieval capabilities (which never send a past answer). So it is admitted by
 * {@code SELLEROPS_INQUIRY_DECISION_ORG_IDS} and by nothing else, like the retrieval capabilities.
 *
 * <p>Off, the assessment is exactly what it was before this capability existed.
 */
@Component
public class InquiryDecisionProperties implements AgentCapabilityGate {

    private final boolean enabled;
    private final boolean allOrgs;
    private final List<UUID> enabledOrgIds;
    private final String model;
    private final String apiKey;
    private final int planMaxOutputTokens;
    private final int judgeMaxOutputTokens;
    private final String reasoningEffort;
    private final String judgePrompt;
    private final String judgeReasoningEffort;

    /** Plan and judge at the same effort, the current judge instruction — what a test or a short config means. */
    public InquiryDecisionProperties(boolean enabled, String enabledOrgIds, String model, String apiKey,
                                     int planMaxOutputTokens, int judgeMaxOutputTokens, String reasoningEffort) {
        this(enabled, enabledOrgIds, model, apiKey, planMaxOutputTokens, judgeMaxOutputTokens, reasoningEffort,
                InquiryDecisionPrompt.JUDGE_V2, "");
    }

    @org.springframework.beans.factory.annotation.Autowired
    public InquiryDecisionProperties(
            @Value("${sellerops.inquiry-decision.enabled:false}") boolean enabled,
            @Value("${sellerops.inquiry-decision.enabled-org-ids:}") String enabledOrgIds,
            @Value("${sellerops.inquiry-decision.model:gpt-5-2025-08-07}") String model,
            @Value("${sellerops.inquiry-decision.api-key:}") String apiKey,
            @Value("${sellerops.inquiry-decision.plan-max-output-tokens:800}") int planMaxOutputTokens,
            @Value("${sellerops.inquiry-decision.judge-max-output-tokens:2400}") int judgeMaxOutputTokens,
            @Value("${sellerops.inquiry-decision.reasoning-effort:minimal}") String reasoningEffort,
            @Value("${sellerops.inquiry-decision.judge-prompt:coverage-judge/v2}") String judgePrompt,
            @Value("${sellerops.inquiry-decision.judge-reasoning-effort:}") String judgeReasoningEffort) {
        this.enabled = enabled;
        this.allOrgs = enabledOrgIds != null && enabledOrgIds.trim().equals("*");
        this.enabledOrgIds = allOrgs ? List.of() : parseIds(enabledOrgIds);
        this.model = model;
        this.apiKey = apiKey;
        this.planMaxOutputTokens = planMaxOutputTokens <= 0 ? 800 : planMaxOutputTokens;
        this.judgeMaxOutputTokens = judgeMaxOutputTokens <= 0 ? 2400 : judgeMaxOutputTokens;
        this.reasoningEffort = reasoningEffort == null || reasoningEffort.isBlank() ? null : reasoningEffort;
        if (judgePrompt != null && !judgePrompt.isBlank() && !InquiryDecisionPrompt.JUDGE_V1.equals(judgePrompt.trim())
                && !InquiryDecisionPrompt.JUDGE_V2.equals(judgePrompt.trim())) {
            // An unknown instruction name is a refusal to boot, not a silent fallback: an eval arm label must describe
            // the instruction the process actually sent.
            throw new IllegalArgumentException("sellerops.inquiry-decision.judge-prompt: unknown " + judgePrompt);
        }
        this.judgePrompt = judgePrompt == null || judgePrompt.isBlank() ? InquiryDecisionPrompt.JUDGE_V2
                : judgePrompt.trim();
        // The judge's effort defaults to the plan's: one knob, unless an evaluation separates them.
        this.judgeReasoningEffort = judgeReasoningEffort == null || judgeReasoningEffort.isBlank()
                ? this.reasoningEffort : judgeReasoningEffort.trim();
    }

    private static List<UUID> parseIds(String csv) {
        if (csv == null || csv.isBlank()) {
            return List.of();
        }
        return Arrays.stream(csv.split(",")).map(String::trim).filter(s -> !s.isEmpty()).map(UUID::fromString)
                .toList();
    }

    @Override
    public String capabilityName() {
        return "SELLEROPS_INQUIRY_DECISION";
    }

    @Override
    public boolean isEnabled() {
        return enabled;
    }

    @Override
    public boolean isDeployed() {
        return enabled && apiKey != null && !apiKey.isBlank();
    }

    @Override
    public boolean namesAnyOrg() {
        return allOrgs || !enabledOrgIds.isEmpty();
    }

    @Override
    public boolean isConfiguredFor(UUID orgId) {
        return orgId != null && (allOrgs || enabledOrgIds.contains(orgId));
    }

    /** No deployment-wide policy widens it: connecting a channel is a request to collect, not to send inquiries. */
    @Override
    public boolean admitsPolicyWidening() {
        return false;
    }

    public String model() {
        return model;
    }

    public String apiKey() {
        return apiKey;
    }

    public int planMaxOutputTokens() {
        return planMaxOutputTokens;
    }

    public int judgeMaxOutputTokens() {
        return judgeMaxOutputTokens;
    }

    public String reasoningEffort() {
        return reasoningEffort;
    }

    public String judgePrompt() {
        return judgePrompt;
    }

    public String judgeReasoningEffort() {
        return judgeReasoningEffort;
    }
}
