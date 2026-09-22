package com.sellerops.knowledge;

import java.util.OptionalDouble;

/**
 * What one question means to one corpus, as a number per passage.
 *
 * <p>A port, so {@link KnowledgeRetriever} keeps every gate and threshold and knows nothing about
 * vendors, vectors or caches — and so the gates can be tested on numbers rather than on an API key.
 */
public interface KnowledgeSemantics {

    /**
     * How close this passage is to the question, in [-1, 1].
     *
     * <p><b>Empty means «not seen», never «not close».</b> A passage whose vector is missing has not
     * been judged, and a lane that cannot see every passage may not conclude that the corpus is
     * silent — {@link KnowledgeRetriever} falls back to the lexical scorer instead.
     *
     * @param quotable the passage's original text, title included, exactly as it was embedded
     */
    OptionalDouble similarityOf(String quotable);

    /**
     * How much two passages AGREE — how close the sentences with which they each answered THIS
     * question are to one another, in [-1, 1].
     *
     * <p><b>Why the retriever needs it.</b> {@link KnowledgeRetriever#MIN_SEMANTIC_MARGIN} decides
     * absence from the SHAPE of the corpus: one passage well clear of the rest, versus every passage
     * equally mediocre. That rests on the rest being coincidence, and they are not always. A seller
     * who states one rule in two documents — a policy page and a shipping note — puts a SECOND
     * ANSWER into the background, and the best passage cannot stand out from it. The gate then reads
     * a corroborated fact as a silent corpus, and the more consistent the seller's own documents are
     * the more certainly it does.
     *
     * <p>Comparing the sentences the two passages ANSWERED WITH, rather than the documents as
     * wholes, is what keeps this from becoming a topic test: two documents that both talk about
     * shipping but say different things about it still differ here.
     *
     * <p><b>Empty means «not measured», never «they disagree»</b> — a lane with no way to compare
     * passages gets exactly the gate that shipped before this method existed.
     */
    default OptionalDouble agreementOf(String quotableA, String quotableB) {
        return OptionalDouble.empty();
    }
}
