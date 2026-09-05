package com.sellerops.knowledge.semantic;

import com.sellerops.agent.access.AgentCapabilityGate;
import java.util.Arrays;
import java.util.List;
import java.util.UUID;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/**
 * The retrieval-intent capability's switch — its own flag, its own key, off by default.
 * (Knowledge Retrieval Quality v2, 2026-09-03)
 *
 * <p><b>What this one is for, in one sentence.</b> A customer writes 「자꾸 붕 뜨는데요」 and the seller
 * wrote 「접착면이 들뜰 수 있습니다」; the two sentences are about the same thing and no amount of
 * scoring on the seller's side can be told so. Measured on the v2 benchmark, restating the question
 * as what information it needs — before embedding it — moved recall from 79.6% to 93.5% and moved
 * <b>no-evidence precision up as well</b>, which is the combination every cheaper idea failed.
 *
 * <p><b>The exposure is narrower than the sixth capability's, not wider.</b> One customer sentence
 * leaves, and nothing else: no passage, no product, no organisation, no identifier. The seller's
 * knowledge is not in this request — {@link KnowledgeEmbeddingGenerator} already carries that, and
 * this adds no second copy of it. What it does add is a second vendor round trip on a search, which
 * is a latency and cost decision rather than a privacy one, and therefore still a deployment
 * decision: default {@code false}, and off it the lane behaves exactly as v1 shipped.
 *
 * <p>It is also gated to questions a CUSTOMER wrote ({@code RetrievalQuery#customerWritten}). A
 * seller typing 「반품 조건」 into their own library is already using their own vocabulary, which is
 * the entire problem this capability solves, so it does not pay for the call.
 */
@Component
public class KnowledgeQuestionIntentProperties implements AgentCapabilityGate {

    private final boolean enabled;
    private final boolean allOrgs;
    private final List<UUID> enabledOrgIds;
    private final String model;
    private final String apiKey;
    private final int maxOutputTokens;
    private final String reasoningEffort;

    public KnowledgeQuestionIntentProperties(
            @Value("${sellerops.knowledge.intent.enabled:false}") boolean enabled,
            @Value("${sellerops.knowledge.intent.enabled-org-ids:}") String enabledOrgIds,
            @Value("${sellerops.knowledge.intent.model:gpt-5-2025-08-07}") String model,
            @Value("${sellerops.knowledge.intent.api-key:}") String apiKey,
            @Value("${sellerops.knowledge.intent.max-output-tokens:400}") int maxOutputTokens,
            @Value("${sellerops.knowledge.intent.reasoning-effort:minimal}") String reasoningEffort) {
        this.enabled = enabled;
        this.allOrgs = enabledOrgIds != null && enabledOrgIds.trim().equals("*");
        this.enabledOrgIds = allOrgs ? List.of() : parseIds(enabledOrgIds);
        this.model = model;
        this.apiKey = apiKey;
        this.maxOutputTokens = maxOutputTokens <= 0 ? 400 : maxOutputTokens;
        this.reasoningEffort = reasoningEffort == null || reasoningEffort.isBlank()
                ? null : reasoningEffort;
    }

    private static List<UUID> parseIds(String csv) {
        if (csv == null || csv.isBlank()) {
            return List.of();
        }
        return Arrays.stream(csv.split(",")).map(String::trim).filter(s -> !s.isEmpty())
                .map(UUID::fromString).toList();
    }

    @Override
    public String capabilityName() {
        return "SELLEROPS_KNOWLEDGE_INTENT";
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

    /**
     * <b>No deployment-wide policy widens this capability.</b> Pilot Release Closure v1 §2: the
     * pilot host runs {@code SELLEROPS_AGENT_ACCESS_SCOPE=CONNECTED_SELLERS} so that a seller who
     * connects a channel can use the Agent without an env edit and a restart. That sentence is right
     * for the Agent and wrong here — this capability sends the CUSTOMER'S question to a vendor on
     * paths that call no model today, and a seller who connected a channel asked for collection, not
     * for that. So it is admitted by {@code SELLEROPS_KNOWLEDGE_INTENT_ORG_IDS} and by nothing else.
     */
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

    public int maxOutputTokens() {
        return maxOutputTokens;
    }

    public String reasoningEffort() {
        return reasoningEffort;
    }
}
