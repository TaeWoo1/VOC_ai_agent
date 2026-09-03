package com.sellerops.knowledge.bench;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.sellerops.knowledge.KnowledgeText;
import java.io.InputStream;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * The benchmark's corpus and query set, loaded from {@code src/test/resources/retrieval-benchmark}.
 *
 * <p><b>Fixture, not seller data.</b> Three product domains and one company policy set, written for
 * this benchmark. Three domains rather than one because a retrieval result measured on a single
 * vocabulary is a measurement of that vocabulary: the whole point of this package is a rule that
 * works for the next seller.
 *
 * <p>Passages are built exactly the way production builds them — {@link KnowledgeText#chunk} over the
 * body, and the document title prepended to the searchable text, because a seller puts the topic in
 * the title and never repeats it in the body.
 */
public final class BenchmarkFixture {

    /** One searchable passage, carrying the source it belongs to so a hit can be scored right/wrong. */
    public record Passage(String sourceId, String title, String content, String searchable, int ordinal) {
    }

    /** One product's or one company's whole library. */
    public record Corpus(String name, String subject, List<Passage> passages, List<String> titles,
                         Map<String, String> titleOf) {
    }

    /** One question, and the sources that may honestly ground it. Empty expect = the answer is none. */
    public record Query(String id, String category, String corpus, String text, List<String> expect) {

        public boolean answerable() {
            return !expect.isEmpty();
        }
    }

    private BenchmarkFixture() {
    }

    public static Map<String, Corpus> corpora() {
        JsonNode root = read("/retrieval-benchmark/corpus.json").get("corpora");
        Map<String, Corpus> out = new LinkedHashMap<>();
        root.fieldNames().forEachRemaining(name -> {
            JsonNode node = root.get(name);
            List<Passage> passages = new ArrayList<>();
            List<String> titles = new ArrayList<>();
            Map<String, String> titleOf = new LinkedHashMap<>();
            for (JsonNode source : node.get("sources")) {
                String id = source.get("id").asText();
                String title = source.get("title").asText();
                titles.add(title);
                titleOf.put(id, title);
                List<String> parts = KnowledgeText.chunk(source.get("body").asText());
                for (int i = 0; i < parts.size(); i++) {
                    passages.add(new Passage(id, title, parts.get(i),
                            KnowledgeText.normalize(title) + KnowledgeText.normalize(parts.get(i)), i + 1));
                }
            }
            out.put(name, new Corpus(name, node.get("subject").asText(), List.copyOf(passages),
                    List.copyOf(titles), Map.copyOf(titleOf)));
        });
        return out;
    }

    public static List<Query> queries() {
        List<Query> out = new ArrayList<>();
        for (JsonNode node : read("/retrieval-benchmark/queries.json")) {
            List<String> expect = new ArrayList<>();
            node.get("expect").forEach(e -> expect.add(e.asText()));
            out.add(new Query(node.get("id").asText(), node.get("cat").asText(),
                    node.get("corpus").asText(), node.get("text").asText(), List.copyOf(expect)));
        }
        return List.copyOf(out);
    }

    static JsonNode read(String resource) {
        try (InputStream in = BenchmarkFixture.class.getResourceAsStream(resource)) {
            if (in == null) {
                throw new IllegalStateException("missing benchmark resource " + resource);
            }
            return new ObjectMapper().readTree(in);
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }
}
