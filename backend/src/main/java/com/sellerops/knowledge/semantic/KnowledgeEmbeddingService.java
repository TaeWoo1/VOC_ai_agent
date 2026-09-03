package com.sellerops.knowledge.semantic;

import com.sellerops.agent.access.AgentCapabilityAccess;
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
 * <p><b>Passage vectors are cached by CONTENT in the database; question vectors only in memory.</b>
 * A passage is embedded once per organisation and reused forever. A customer's question is never
 * written down — a table of customer questions would be a second copy of customer wording, which
 * this repository refuses everywhere else and would have no reader here — but it IS remembered for
 * the length of one unit of work ({@link SearchMemo}), because one draft searches three lanes with
 * one question and, since v2, with two phrasings of it. Retrieval Runtime Closure v1 §3 measured
 * that: the same sentence was leaving as SIX identical embedding requests per grounded draft.
 *
 * <p><b>Writes happen in their own transaction.</b> Caching a vector during a read-only search must
 * not enlist in the caller's transaction, and a vendor failure must not roll back a seller's search.
 */
@Service
public class KnowledgeEmbeddingService {

    private final KnowledgeEmbeddingProperties properties;
    private final KnowledgeEmbeddingRepository repository;
    private final AgentCapabilityAccess access;
    private final KnowledgeEmbeddingGenerator generator;
    private final SearchMemo<float[]> questions = new SearchMemo<>();

    public KnowledgeEmbeddingService(KnowledgeEmbeddingProperties properties,
                                     KnowledgeEmbeddingRepository repository,
                                     AgentCapabilityAccess access,
                                     AgentLlmTransport transport) {
        this.properties = properties;
        this.repository = repository;
        this.access = access;
        this.generator = new KnowledgeEmbeddingGenerator(transport, properties);
    }

    /**
     * Whether this organisation may use semantic retrieval at all.
     *
     * <p>The organisation question is answered by the deployment's one access policy (Retrieval
     * Runtime Closure v1 §5); the flag, the key and the explicit list stay this capability's own.
     */
    public boolean enabledFor(UUID orgId) {
        return access == null ? properties.isEnabledFor(orgId) : access.allows(properties, orgId);
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
            List<float[]> vectors = generator.embed(orgId,
                    KnowledgeEmbeddingGenerator.Kind.PASSAGE, batch);
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
     * The vector for one customer question. Embedded, used, and never written down.
     *
     * <p>Remembered in memory for the unit of work, keyed by the model, the dimension count and the
     * sentence — the three things the answer depends on. A failure is remembered too: three lanes
     * asking a vendor that just refused would be three refusals for one question.
     *
     * @return null when the capability is off or the vendor did not answer
     */
    public float[] questionVector(UUID orgId, String question) {
        if (!enabledFor(orgId) || question == null || question.isBlank()) {
            return null;
        }
        String key = Vectors.sha256(orgId + "\n" + properties.model() + "\n"
                + properties.dimensions() + "\n" + question);
        return questions.get(key, () -> {
            List<float[]> vectors = generator.embed(orgId,
                    KnowledgeEmbeddingGenerator.Kind.QUESTION, List.of(question));
            return vectors.size() == 1 ? vectors.get(0) : null;
        });
    }
}
