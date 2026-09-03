package com.sellerops.knowledge.bench;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.sellerops.knowledge.KnowledgeText;
import com.sellerops.knowledge.bench.BenchmarkFixture.Passage;
import java.util.List;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.util.Base64;
import java.util.HashMap;
import java.util.Map;

/**
 * One embedding cache the benchmark can measure.
 *
 * <p><b>Checked in, so the benchmark is reproducible and CI calls no vendor.</b> A benchmark whose
 * numbers move when a vendor reweights a model is not a benchmark, and a test suite that needs an API
 * key is a test suite that does not run. The shipped cache is built once by
 * {@code tools/dev/bench-embed.py} from the texts {@link BenchmarkTextDump} emits; the model
 * comparison arms are built to {@code build/bench/} and are not checked in.
 */
public final class BenchmarkVectors {

    private static final String RESOURCE = "/retrieval-benchmark/vectors.json";
    private static BenchmarkVectors shipped;

    private final String label;
    private final Map<String, float[]> cache;

    private BenchmarkVectors(String label, Map<String, float[]> cache) {
        this.label = label;
        this.cache = cache;
    }

    /**
     * The units a passage is embedded as — production's own splitter over production's own quotable
     * text, so the cache cannot drift from what the lanes actually ask for.
     */
    public static List<String> sentencesOf(Passage passage) {
        return KnowledgeText.comparableUnits(passage.title() + "\n" + passage.content());
    }

    /** Whether the checked-in cache exists — semantic variants are skipped without it. */
    public static boolean available() {
        return BenchmarkVectors.class.getResource(RESOURCE) != null;
    }

    public static BenchmarkVectors shipped() {
        if (shipped == null) {
            shipped = new BenchmarkVectors("shipped", load(BenchmarkFixture.read(RESOURCE)));
        }
        return shipped;
    }

    /**
     * The shipped cache with an exploration arm's generated texts laid over it.
     *
     * <p>The overlay never replaces a shipped vector — it only adds the texts the arms invented, so
     * every arm judges the seller's own passages by exactly the same numbers.
     */
    public static BenchmarkVectors withOverlay(String path) {
        Map<String, float[]> merged = new HashMap<>(shipped().cache);
        try {
            Path p = Path.of(path);
            if (Files.exists(p)) {
                load(new ObjectMapper().readTree(p.toFile()))
                        .forEach(merged::putIfAbsent);
            }
        } catch (Exception ignored) {
            // An arm without its cache simply cannot run; the caller checks.
        }
        return new BenchmarkVectors("overlay", merged);
    }

    /** Whether a text has a vector at all — an arm skips itself rather than throwing. */
    public boolean has(String text) {
        return cache.containsKey(key(text));
    }

    /** A comparison arm from {@code build/bench/}; null when it was never generated. */
    public static BenchmarkVectors file(String label, String path) {
        try {
            Path p = Path.of(path);
            if (!Files.exists(p)) {
                return null;
            }
            return new BenchmarkVectors(label, load(new ObjectMapper().readTree(p.toFile())));
        } catch (Exception e) {
            return null;
        }
    }

    public String label() {
        return label;
    }

    public float[] of(String text) {
        float[] vector = cache.get(key(text));
        if (vector == null) {
            throw new IllegalStateException("no cached vector for: "
                    + text.substring(0, Math.min(30, text.length())));
        }
        return vector;
    }

    public static double cosine(float[] a, float[] b) {
        double dot = 0;
        double na = 0;
        double nb = 0;
        for (int i = 0; i < a.length; i++) {
            dot += a[i] * b[i];
            na += a[i] * a[i];
            nb += b[i] * b[i];
        }
        return na == 0 || nb == 0 ? 0 : dot / (Math.sqrt(na) * Math.sqrt(nb));
    }

    private static Map<String, float[]> load(JsonNode root) {
        Map<String, float[]> out = new HashMap<>();
        root.fields().forEachRemaining(e -> out.put(e.getKey(), decode(e.getValue().asText())));
        return out;
    }

    static float[] decode(String base64) {
        byte[] bytes = Base64.getDecoder().decode(base64);
        ByteBuffer buffer = ByteBuffer.wrap(bytes).order(ByteOrder.LITTLE_ENDIAN);
        float[] out = new float[bytes.length / 4];
        for (int i = 0; i < out.length; i++) {
            out[i] = buffer.getFloat();
        }
        return out;
    }

    static String key(String text) {
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
}
