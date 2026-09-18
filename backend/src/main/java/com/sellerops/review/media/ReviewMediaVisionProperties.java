package com.sellerops.review.media;

import java.util.Arrays;
import java.util.List;
import java.util.UUID;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/**
 * The review-photo vision capability's own switch, key and model — the twelfth LLM capability.
 *
 * <p><b>What leaves:</b> one customer's review photo (its bytes, fetched by this backend under the image fetch
 * policy), that review's star rating and its own text — the current case input, which the Knowledge Spine vendor
 * decision (product-owner, 2026-09-18) already sends — and a constant instruction. No product name, no order, no
 * buyer identifier, no other review. The photo is the widest thing any capability here sends: a customer took it,
 * and nobody has looked at it before it leaves. That is why it has its own flag, off by default, and its own org
 * list.
 *
 * <p><b>Its own model,</b> as the image-knowledge lane has: the text capabilities' default snapshot is not a
 * vision model decision this lane should inherit.
 */
@Component
public class ReviewMediaVisionProperties {

    /** Photos inspected per review at most, whatever the review attached. */
    public static final int MAX_IMAGES_PER_REVIEW = 3;

    private final boolean enabled;
    private final boolean allOrgs;
    private final List<UUID> enabledOrgIds;
    private final String model;
    private final String apiKey;
    private final int maxOutputTokens;
    private final String reasoningEffort;

    public ReviewMediaVisionProperties(
            @Value("${sellerops.review.media-vision.enabled:false}") boolean enabled,
            @Value("${sellerops.review.media-vision.enabled-org-ids:}") String enabledOrgIds,
            @Value("${sellerops.review.media-vision.model:gpt-5.6-terra}") String model,
            @Value("${sellerops.review.media-vision.api-key:}") String apiKey,
            @Value("${sellerops.review.media-vision.max-output-tokens:600}") int maxOutputTokens,
            @Value("${sellerops.review.media-vision.reasoning-effort:none}") String reasoningEffort) {
        this.enabled = enabled;
        this.allOrgs = enabledOrgIds != null && enabledOrgIds.trim().equals("*");
        this.enabledOrgIds = allOrgs ? List.of() : parseIds(enabledOrgIds);
        this.model = model;
        this.apiKey = apiKey;
        this.maxOutputTokens = maxOutputTokens <= 0 ? 600 : maxOutputTokens;
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
