package com.sellerops.knowledge.semantic;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.sellerops.agent.llm.AgentLlmCallMetrics;
import com.sellerops.agent.llm.AgentLlmTransport;
import java.net.URI;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * The one call the semantic-retrieval capability makes.
 *
 * <p><b>The payload floor is the narrowest of the seven.</b> Three fields leave: the model, the
 * dimension count, and the texts to embed. No organisation, no product, no identifier, no customer
 * name, no order, no instruction — an embedding request has nowhere to put them and this class does
 * not invent a place. {@code KnowledgeEmbeddingPayloadFloorTest} asserts the serialized bytes.
 *
 * <p>One door, in the shape {@code AgentDraftBoundaryTest} fixes for every capability: this is the
 * only class that may hold the transport for this capability, and {@link KnowledgeEmbeddingService}
 * is the only class that may construct it — so the organisation gate is checked at the door and a
 * caller holding a generator would be an allow-list nobody runs.
 */
public class KnowledgeEmbeddingGenerator {

    /** The most texts one request carries. A whole product library is far below it. */
    static final int MAX_BATCH = 64;

    /**
     * What was embedded — for the log line, and for nothing else.
     *
     * <p>It does not reach the request: the payload floor is the model, the dimension count and the
     * texts, and this would be a fourth field. It reports which of the capability's two economics a
     * call belongs to.
     */
    enum Kind {
        /** A seller's own knowledge sentence. Cached by content in {@code knowledge_embedding}. */
        PASSAGE,
        /** A customer's question, or the restatement of one. Never written down. */
        QUESTION
    }

    private static final URI ENDPOINT = URI.create("https://api.openai.com/v1/embeddings");
    private static final ObjectMapper MAPPER = new ObjectMapper();
    private static final Logger log = LoggerFactory.getLogger(KnowledgeEmbeddingGenerator.class);

    private final AgentLlmTransport transport;
    private final KnowledgeEmbeddingProperties properties;

    KnowledgeEmbeddingGenerator(AgentLlmTransport transport, KnowledgeEmbeddingProperties properties) {
        this.transport = transport;
        this.properties = properties;
    }

    /**
     * The vectors for these texts, in the same order.
     *
     * @return one vector per input, or an empty list when the vendor refused or answered a shape this
     *         does not recognise. <b>Empty is a real answer</b>: the caller falls back to the lexical
     *         scorer rather than reporting an absence it could not measure.
     */
    List<float[]> embed(UUID orgId, Kind kind, List<String> texts) {
        if (texts.isEmpty() || texts.size() > MAX_BATCH) {
            return List.of();
        }
        AgentLlmTransport.Response response = transport.post(ENDPOINT,
                Map.of("Authorization", "Bearer " + properties.apiKey()), requestBody(texts));
        // Metadata only — see the note in KnowledgeQuestionIntentGenerator. The two kinds are
        // reported apart because they are different exposures with different economics: a passage is
        // embedded once per organisation and cached in the database forever, a question is embedded
        // for one search and never written down. A cost report that added them would be answering
        // neither "what did this library cost to index" nor "what does a search cost".
        log.info("knowledge_embedding orgId={} kind={} texts={} answered={} {}", orgId, kind,
                texts.size(), response.ok(), AgentLlmCallMetrics.of(response).toLogFields());
        if (!response.ok()) {
            return List.of();
        }
        try {
            JsonNode data = MAPPER.readTree(response.body()).path("data");
            float[][] out = new float[texts.size()][];
            for (JsonNode item : data) {
                int index = item.path("index").asInt(-1);
                JsonNode vector = item.path("embedding");
                if (index < 0 || index >= texts.size() || !vector.isArray()) {
                    return List.of();
                }
                float[] values = new float[vector.size()];
                for (int i = 0; i < values.length; i++) {
                    values[i] = (float) vector.get(i).asDouble();
                }
                out[index] = values;
            }
            List<float[]> vectors = new ArrayList<>(texts.size());
            for (float[] vector : out) {
                if (vector == null) {
                    return List.of();
                }
                vectors.add(vector);
            }
            return vectors;
        } catch (Exception e) {
            return List.of();
        }
    }

    /** Package-visible so the payload floor test can assert the exact bytes that leave. */
    String requestBody(List<String> texts) {
        ObjectNode body = MAPPER.createObjectNode();
        body.put("model", properties.model());
        body.put("dimensions", properties.dimensions());
        ArrayNode input = body.putArray("input");
        texts.forEach(input::add);
        return body.toString();
    }
}
