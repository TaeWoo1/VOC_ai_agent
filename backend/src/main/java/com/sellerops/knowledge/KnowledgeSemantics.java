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
}
