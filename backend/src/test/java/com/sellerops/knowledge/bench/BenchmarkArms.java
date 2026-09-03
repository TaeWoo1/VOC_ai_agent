package com.sellerops.knowledge.bench;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.sellerops.knowledge.bench.BenchmarkFixture.Passage;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * The generated representations the v2 arms are measured with, loaded from {@code build/bench/}.
 *
 * <p><b>Never checked in, never read by production.</b> These files are the OUTPUT of a model, and
 * the whole question this package asks is whether a model-written stand-in for the seller's text
 * earns its cost. Keeping them out of {@code src/} keeps that question answerable: the shipped
 * benchmark measures what the product actually does, and an arm that is not chosen leaves nothing
 * behind. Absent files simply skip their arms.
 */
public final class BenchmarkArms {

    private final Map<String, String> intent;
    private final Map<String, List<String>> synthetic;
    private final Map<String, String> summary;
    private final Map<String, Boolean> eligibility;

    private static BenchmarkArms loaded;
    private static BenchmarkArms shipped;

    private BenchmarkArms(Map<String, String> intent, Map<String, List<String>> synthetic,
                          Map<String, String> summary, Map<String, Boolean> eligibility) {
        this.intent = intent;
        this.synthetic = synthetic;
        this.summary = summary;
        this.eligibility = eligibility;
    }

    /** A passage's identity: its own text, so one document shared by two corpora is generated once. */
    public static String keyOf(Passage passage) {
        return sha(passage.title() + "\n" + passage.content());
    }

    /**
     * The representations the SHIPPED path uses, from {@code src/test/resources}.
     *
     * <p>Checked in for the same reason the vectors are: a benchmark whose numbers move when a
     * vendor reweights a model is not a benchmark, and a suite that needs an API key is a suite that
     * does not run. Only the two arms that were CHOSEN are here — the rejected ones (synthetic
     * questions, passage summaries) leave nothing behind, which is what rejecting them means.
     */
    public static BenchmarkArms shipped() {
        if (shipped == null) {
            shipped = new BenchmarkArms(
                    stringsResource("/retrieval-benchmark/intent.json"), Map.of(), Map.of(),
                    booleansResource("/retrieval-benchmark/eligibility.json"));
        }
        return shipped;
    }

    public static BenchmarkArms load() {
        if (loaded == null) {
            Path dir = Path.of(System.getProperty("bench.dir", "build/bench"));
            loaded = new BenchmarkArms(strings(dir.resolve("intent.json")),
                    lists(dir.resolve("synthetic.json")), strings(dir.resolve("summary.json")),
                    booleans(dir.resolve("eligibility.json")));
        }
        return loaded;
    }

    public boolean hasIntent() {
        return !intent.isEmpty();
    }

    public boolean hasSynthetic() {
        return !synthetic.isEmpty();
    }

    public boolean hasSummary() {
        return !summary.isEmpty();
    }

    public boolean hasEligibility() {
        return !eligibility.isEmpty();
    }

    /** The retrieval-intent rewrite of a customer's sentence, or the sentence itself. */
    public String intentOf(String question) {
        return intent.getOrDefault(question, question);
    }

    public List<String> syntheticOf(String key) {
        return synthetic.getOrDefault(key, List.of());
    }

    public String summaryOf(String key) {
        return summary.get(key);
    }

    /** Whether the judge said this passage supports answering this question. Unknown = keep. */
    public boolean eligible(String queryId, String key) {
        return eligibility.getOrDefault(queryId + "|" + key, Boolean.TRUE);
    }

    static String sha(String text) {
        try {
            byte[] digest = MessageDigest.getInstance("SHA-256")
                    .digest(text.getBytes(StandardCharsets.UTF_8));
            StringBuilder sb = new StringBuilder();
            for (int i = 0; i < 12; i++) {
                sb.append(String.format("%02x", digest[i]));
            }
            return sb.toString();
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }

    private static Map<String, String> stringsResource(String resource) {
        Map<String, String> out = new HashMap<>();
        BenchmarkFixture.read(resource).fields()
                .forEachRemaining(e -> out.put(e.getKey(), e.getValue().asText()));
        return out;
    }

    private static Map<String, Boolean> booleansResource(String resource) {
        Map<String, Boolean> out = new HashMap<>();
        BenchmarkFixture.read(resource).fields()
                .forEachRemaining(e -> out.put(e.getKey(), e.getValue().asBoolean()));
        return out;
    }

    private static JsonNode read(Path path) {
        try {
            return Files.exists(path) ? new ObjectMapper().readTree(path.toFile()) : null;
        } catch (Exception e) {
            return null;
        }
    }

    private static Map<String, String> strings(Path path) {
        Map<String, String> out = new HashMap<>();
        JsonNode root = read(path);
        if (root != null) {
            root.fields().forEachRemaining(e -> out.put(e.getKey(), e.getValue().asText()));
        }
        return out;
    }

    private static Map<String, List<String>> lists(Path path) {
        Map<String, List<String>> out = new HashMap<>();
        JsonNode root = read(path);
        if (root != null) {
            root.fields().forEachRemaining(e -> {
                List<String> values = new ArrayList<>();
                e.getValue().forEach(v -> values.add(v.asText()));
                out.put(e.getKey(), List.copyOf(values));
            });
        }
        return out;
    }

    private static Map<String, Boolean> booleans(Path path) {
        Map<String, Boolean> out = new HashMap<>();
        JsonNode root = read(path);
        if (root != null) {
            root.fields().forEachRemaining(e -> out.put(e.getKey(), e.getValue().asBoolean()));
        }
        return out;
    }
}
