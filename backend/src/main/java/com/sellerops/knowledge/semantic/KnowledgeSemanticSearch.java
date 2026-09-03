package com.sellerops.knowledge.semantic;

import com.sellerops.knowledge.KnowledgeRetriever;
import com.sellerops.knowledge.KnowledgeSemantics;
import com.sellerops.knowledge.KnowledgeText;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.OptionalDouble;
import java.util.UUID;
import org.springframework.stereotype.Component;

/**
 * Builds the semantic view of ONE search: this question against exactly the passages this lane has
 * already decided the seller may be shown.
 *
 * <p><b>It reads the lane's own candidate list, and that is the whole scope story.</b> Product scope,
 * organisation scope, variant applicability, retired documents, the reading filters — all of them run
 * before this is called and none of them are re-decided here. A retired manual is not in the list, so
 * it has no vector looked up and cannot be found however close it is; another company's passage was
 * never in the list at all. Semantic similarity gets a vote on which of the seller's admissible
 * passages answers the question, and no vote on which passages are admissible.
 *
 * <p><b>All or nothing.</b> If any candidate has no usable vector, this returns null and the lane
 * falls back to the lexical scorer — a lane that has not read every passage may not conclude that
 * the corpus is silent.
 */
@Component
public class KnowledgeSemanticSearch {

    /**
     * The most sentences one search will embed.
     *
     * <p>A bound on what one seller's question can cost, not a quality parameter. The reference
     * deployment's largest library is far below it; a corpus above it falls back to the lexical
     * scorer rather than turning one search into a bulk upload.
     */
    static final int MAX_SENTENCES = 64;

    private final KnowledgeEmbeddingService embeddings;

    public KnowledgeSemanticSearch(KnowledgeEmbeddingService embeddings) {
        this.embeddings = embeddings;
    }

    /**
     * A search with no semantic lane — what a unit test and a context without the capability get.
     *
     * <p>Named rather than left to a null field: «this lane is not present» is a state the retriever
     * already handles, and a service that has to remember to null-check it is a service that will
     * forget once.
     */
    public static KnowledgeSemanticSearch disabled() {
        return new KnowledgeSemanticSearch(null);
    }

    public boolean enabledFor(UUID orgId) {
        return embeddings != null && embeddings.enabledFor(orgId);
    }

    /**
     * @param question   the question as the person wrote it. <b>Not the candidate ladder</b>: the four
     *                   shortened forms exist because the lexical absence ratio is diluted by words the
     *                   corpus lacks, and a vector has no such denominator — shortening the question
     *                   only removes what it means, and would cost one vendor call per form.
     * @return null when the capability is off for this org, when the corpus is too large to embed in
     *         one search, or when any passage or the question itself could not be embedded
     */
    public <T> KnowledgeSemantics forQuestion(UUID orgId, String question,
                                              List<KnowledgeRetriever.Candidate<T>> candidates) {
        if (candidates.isEmpty() || question == null || question.isBlank() || !enabledFor(orgId)) {
            return null;
        }
        Map<String, List<String>> sentencesOf = new HashMap<>();
        LinkedHashSet<String> all = new LinkedHashSet<>();
        for (KnowledgeRetriever.Candidate<T> candidate : candidates) {
            String quotable = candidate.quotable();
            if (quotable == null || quotable.isBlank()) {
                return null;
            }
            List<String> sentences = KnowledgeText.comparableUnits(quotable);
            sentencesOf.put(quotable, sentences);
            all.addAll(sentences);
            if (all.size() > MAX_SENTENCES) {
                return null;
            }
        }
        Map<String, float[]> vectors = embeddings.vectorsFor(orgId, new ArrayList<>(all));
        for (String sentence : all) {
            if (!vectors.containsKey(sentence)) {
                return null;
            }
        }
        float[] asked = embeddings.questionVector(orgId, question);
        if (asked == null) {
            return null;
        }
        Map<String, Double> best = new HashMap<>();
        sentencesOf.forEach((quotable, sentences) -> {
            double top = -1;
            for (String sentence : sentences) {
                top = Math.max(top, Vectors.cosine(asked, vectors.get(sentence)));
            }
            best.put(quotable, top);
        });
        return quotable -> {
            Double value = best.get(quotable);
            return value == null ? OptionalDouble.empty() : OptionalDouble.of(value);
        };
    }
}
