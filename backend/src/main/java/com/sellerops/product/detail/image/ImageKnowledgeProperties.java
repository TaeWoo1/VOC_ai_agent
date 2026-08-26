package com.sellerops.product.detail.image;

import java.util.Arrays;
import java.util.List;
import java.util.UUID;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/**
 * The image-knowledge capability's own switch, key and MODEL — the sixth LLM capability, and the
 * first one whose payload is not text SellerOps chose.
 *
 * <p><b>Its own model property, deliberately</b> (product-owner, 2026-08-27). Every other capability
 * here defaults to {@code gpt-5-2025-08-07}, which the vendor's own documentation marks deprecated
 * and scheduled for shutdown. Migrating all six is a decision this package is not allowed to make —
 * but inheriting a shutdown-scheduled snapshot into a brand new lane would be the worst of both, so
 * this capability names its model and touches nobody else's.
 *
 * <p><b>Off by default and org-scoped</b>, in the shape the draft capability established. The key is
 * held in memory only: never logged, never stored, never part of a version string.
 */
@Component
public class ImageKnowledgeProperties {

    /**
     * {@code high} rather than {@code auto}.
     *
     * <p>Not a quality preference — a COST FENCE. The vendor documents {@code auto} on this model as
     * behaving like {@code original}: up to 65,535 px with <b>no patch-budget limit</b>. One unusually
     * tall 상세페이지 strip would then cost whatever it costs, which is not a number this package can
     * put on an approval manifest. {@code high} fits the image within 2048×2048 <i>and</i> 2,500
     * patches, which makes the per-image ceiling arithmetic rather than hope.
     */
    public static final String DETAIL = "high";

    /** The vendor's patch multiplier for this model family, used only to state the ceiling. */
    public static final double PATCH_MULTIPLIER = 1.2;

    /** The vendor's patch budget at {@code detail=high}. The ceiling is this times the multiplier. */
    public static final int MAX_PATCHES_AT_HIGH = 2_500;

    private final boolean enabled;
    private final boolean allOrgs;
    private final List<UUID> enabledOrgIds;
    private final String vendor;
    private final String model;
    private final String apiKey;
    private final int maxOutputTokens;
    private final String reasoningEffort;

    public ImageKnowledgeProperties(
            @Value("${sellerops.product.image-knowledge.enabled:false}") boolean enabled,
            @Value("${sellerops.product.image-knowledge.enabled-org-ids:}") String enabledOrgIds,
            @Value("${sellerops.product.image-knowledge.vendor:OPENAI}") String vendor,
            @Value("${sellerops.product.image-knowledge.model:gpt-5.6-terra}") String model,
            @Value("${sellerops.product.image-knowledge.api-key:}") String apiKey,
            @Value("${sellerops.product.image-knowledge.max-output-tokens:1200}") int maxOutputTokens,
            @Value("${sellerops.product.image-knowledge.reasoning-effort:none}") String reasoningEffort) {
        this.enabled = enabled;
        this.allOrgs = enabledOrgIds != null && enabledOrgIds.trim().equals("*");
        this.enabledOrgIds = allOrgs ? List.of() : parseIds(enabledOrgIds);
        this.vendor = vendor;
        this.model = model;
        this.apiKey = apiKey;
        // 1,200 rather than the 4,000 every other capability uses. The answer is a bounded list of
        // triples, not prose, and on a reasoning model this budget is SHARED with reasoning — which is
        // exactly why the effort is `none`. A generic ceiling here would buy nothing and cost 3.3×.
        this.maxOutputTokens = maxOutputTokens <= 0 ? 1200 : maxOutputTokens;
        this.reasoningEffort = reasoningEffort == null || reasoningEffort.isBlank() ? null : reasoningEffort;
    }

    private static List<UUID> parseIds(String csv) {
        if (csv == null || csv.isBlank()) {
            return List.of();
        }
        return Arrays.stream(csv.split(",")).map(String::trim).filter(s -> !s.isEmpty())
                .map(UUID::fromString).toList();
    }

    /** On only when the switch is on AND a key is present AND this org is listed. */
    public boolean isEnabledFor(UUID orgId) {
        return enabled && apiKey != null && !apiKey.isBlank() && orgId != null
                && (allOrgs || enabledOrgIds.contains(orgId));
    }

    public String vendor() {
        return vendor;
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
