package com.sellerops.product.detail.image;

import java.util.UUID;
import org.springframework.stereotype.Service;

/**
 * The image-knowledge capability's one door.
 *
 * <p>Same shape as every other LLM capability here, for the same reason: the org allow-list is
 * checked HERE, so a caller that held {@link ImageFactExtractionGenerator} directly would be an
 * allow-list nobody runs. {@code AgentDraftBoundaryTest} enforces that this is the only class in
 * {@code main} that may construct one.
 *
 * <p>The generator is null when the capability is off — there is nothing to construct without a key,
 * and a live object behind a disabled flag is one refactor away from being called.
 */
@Service
public class ImageFactExtractionService {

    private final ImageKnowledgeProperties properties;
    private final ImageFactExtractionGenerator generator;

    public ImageFactExtractionService(ImageKnowledgeProperties properties,
                                      com.sellerops.agent.llm.AgentLlmTransport transport) {
        this.properties = properties;
        this.generator = properties.apiKey() == null || properties.apiKey().isBlank() ? null
                : new ImageFactExtractionGenerator(transport,
                        ImageFactExtractionGenerator.Vendor.of(properties.vendor()),
                        properties.model(), properties.apiKey(), properties.maxOutputTokens(),
                        properties.reasoningEffort());
    }

    public boolean isEnabledFor(UUID orgId) {
        return generator != null && properties.isEnabledFor(orgId);
    }

    /** What produced a stored receipt. Part of its identity, so an upgrade re-reads. */
    public String extractorVersion() {
        return generator == null ? ImageFactExtractionGenerator.EXTRACTOR_VERSION : generator.version();
    }

    /** The model identity, stored separately so a model change alone invalidates a reading. */
    public String modelVersion() {
        return generator == null ? "none" : generator.modelVersion();
    }

    /**
     * Read one picture. Every failure is a {@link ImageFactExtractionGenerator.Result} with no facts
     * and a sanitized reason; nothing throws at the caller.
     */
    public ImageFactExtractionGenerator.Result read(UUID orgId, byte[] imageBytes, String contentType) {
        if (!isEnabledFor(orgId)) {
            return ImageFactExtractionGenerator.Result.failed("disabled");
        }
        try {
            return generator.generate(imageBytes, contentType);
        } catch (RuntimeException e) {
            // The class only. A vendor exception message can quote the request, and the request is
            // the seller's own picture.
            return ImageFactExtractionGenerator.Result.failed("threw:" + e.getClass().getSimpleName());
        }
    }
}
