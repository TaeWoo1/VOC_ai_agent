package com.sellerops.knowledge.semantic;

import com.sellerops.agent.access.AgentCapabilityGate;
import java.util.Arrays;
import java.util.List;
import java.util.UUID;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/**
 * The semantic-retrieval capability's switch — its own flag, its own key, off by default.
 * (Knowledge Retrieval Quality v1, 2026-09-03)
 *
 * <p><b>A separate exposure from the other six, and the difference is worth naming.</b> What this
 * capability sends is two things:
 *
 * <ol>
 *   <li>the seller's own knowledge passages, once each, to be turned into vectors — the same material
 *       the draft capability already quotes into a prompt; and</li>
 *   <li><b>the customer's question, on every search</b> — which is new for the paths that call no
 *       model today. A draft that ends in {@code NO_ANSWER_BASIS} calls no drafter, and a seller's
 *       search box calls nothing at all; with this capability on, both embed the question first.</li>
 * </ol>
 *
 * <p>The second is a widening, so it is a deployment decision rather than a merge: default
 * {@code false}, and with it off every lane behaves byte-for-byte as it did before this package.
 *
 * <p>The key is read from configuration and held in memory only — never logged, never stored, never
 * part of a version string.
 */
@Component
public class KnowledgeEmbeddingProperties implements AgentCapabilityGate {

    private final boolean enabled;
    private final boolean allOrgs;
    private final List<UUID> enabledOrgIds;
    private final String model;
    private final String apiKey;
    private final int dimensions;

    public KnowledgeEmbeddingProperties(
            @Value("${sellerops.knowledge.embedding.enabled:false}") boolean enabled,
            @Value("${sellerops.knowledge.embedding.enabled-org-ids:}") String enabledOrgIds,
            @Value("${sellerops.knowledge.embedding.model:text-embedding-3-large}") String model,
            @Value("${sellerops.knowledge.embedding.api-key:}") String apiKey,
            @Value("${sellerops.knowledge.embedding.dimensions:1024}") int dimensions) {
        this.enabled = enabled;
        this.allOrgs = enabledOrgIds != null && enabledOrgIds.trim().equals("*");
        this.enabledOrgIds = allOrgs ? List.of() : parseIds(enabledOrgIds);
        this.model = model;
        this.apiKey = apiKey;
        this.dimensions = dimensions <= 0 ? 1024 : dimensions;
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
        return "SELLEROPS_KNOWLEDGE_EMBEDDING";
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

    public String model() {
        return model;
    }

    public String apiKey() {
        return apiKey;
    }

    /**
     * How many numbers a vector has.
     *
     * <p>Measured, not assumed: the same model truncated to 256 answered 88.9% of the benchmark's
     * no-evidence questions with a citation, because a shorter vector cannot tell «about this
     * product» from «about this question».
     */
    public int dimensions() {
        return dimensions;
    }
}
