package com.sellerops.knowledge.semantic;

import com.sellerops.agent.llm.AgentLlmTransport;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

/**
 * The door to the semantic-retrieval capability: the organisation gate, the cache, and nothing else.
 *
 * <p><b>Vectors are cached by CONTENT, and questions are not cached at all.</b> A passage is embedded
 * once per organisation and reused forever; a customer's question is embedded for the search and
 * dropped. That asymmetry is deliberate — a table of customer questions would be a second copy of
 * customer wording, which this repository refuses everywhere else and would have no reader here.
 *
 * <p><b>Writes happen in their own transaction.</b> Caching a vector during a read-only search must
 * not enlist in the caller's transaction, and a vendor failure must not roll back a seller's search.
 */
@Service
public class KnowledgeEmbeddingService {

    private final KnowledgeEmbeddingProperties properties;
    private final KnowledgeEmbeddingRepository repository;
    private final KnowledgeEmbeddingGenerator generator;

    public KnowledgeEmbeddingService(KnowledgeEmbeddingProperties properties,
                                     KnowledgeEmbeddingRepository repository,
                                     AgentLlmTransport transport) {
        this.properties = properties;
        this.repository = repository;
        this.generator = new KnowledgeEmbeddingGenerator(transport, properties);
    }

    /** Whether this organisation may use semantic retrieval at all. */
    public boolean enabledFor(UUID orgId) {
        return properties.isEnabledFor(orgId);
    }

    /**
     * The vectors for these passage texts, embedding and caching whatever is missing.
     *
     * @return a map from text to vector; a text missing from it could not be embedded, and the caller
     *         must treat the corpus as incompletely seen rather than judge absence from a hole
     */
    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public Map<String, float[]> vectorsFor(UUID orgId, List<String> texts) {
        if (!enabledFor(orgId) || texts.isEmpty()) {
            return Map.of();
        }
        Map<String, String> hashOf = new LinkedHashMap<>();
        for (String text : texts) {
            hashOf.put(text, Vectors.sha256(text));
        }
        Map<String, float[]> byHash = new HashMap<>();
        for (KnowledgeEmbedding row : repository.findAllByOrgIdAndModelAndDimensionsAndContentSha256In(
                orgId, properties.model(), properties.dimensions(),
                new LinkedHashSet<>(hashOf.values()))) {
            byHash.put(row.getContentSha256(), Vectors.decode(row.getVector()));
        }
        List<String> missing = new ArrayList<>();
        Set<String> seen = new LinkedHashSet<>();
        for (Map.Entry<String, String> entry : hashOf.entrySet()) {
            if (!byHash.containsKey(entry.getValue()) && seen.add(entry.getValue())) {
                missing.add(entry.getKey());
            }
        }
        for (int i = 0; i < missing.size(); i += KnowledgeEmbeddingGenerator.MAX_BATCH) {
            List<String> batch = missing.subList(i,
                    Math.min(missing.size(), i + KnowledgeEmbeddingGenerator.MAX_BATCH));
            List<float[]> vectors = generator.embed(batch);
            if (vectors.size() != batch.size()) {
                // The vendor refused or answered a shape we do not recognise. What was already cached
                // still stands; the rest stays missing and the caller falls back.
                break;
            }
            List<KnowledgeEmbedding> rows = new ArrayList<>(batch.size());
            for (int j = 0; j < batch.size(); j++) {
                String hash = hashOf.get(batch.get(j));
                byHash.put(hash, vectors.get(j));
                KnowledgeEmbedding row = new KnowledgeEmbedding();
                row.setOrgId(orgId);
                row.setContentSha256(hash);
                row.setModel(properties.model());
                row.setDimensions(properties.dimensions());
                row.setVector(Vectors.encode(vectors.get(j)));
                rows.add(row);
            }
            repository.saveAll(rows);
        }
        Map<String, float[]> out = new LinkedHashMap<>();
        hashOf.forEach((text, hash) -> {
            float[] vector = byHash.get(hash);
            if (vector != null) {
                out.put(text, vector);
            }
        });
        return out;
    }

    /**
     * The vector for one customer question. Embedded, used, and not stored.
     *
     * @return null when the capability is off or the vendor did not answer
     */
    public float[] questionVector(UUID orgId, String question) {
        if (!enabledFor(orgId) || question == null || question.isBlank()) {
            return null;
        }
        List<float[]> vectors = generator.embed(List.of(question));
        return vectors.size() == 1 ? vectors.get(0) : null;
    }
}
