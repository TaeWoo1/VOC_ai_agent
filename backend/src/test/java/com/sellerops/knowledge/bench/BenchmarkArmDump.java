package com.sellerops.knowledge.bench;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.sellerops.knowledge.bench.BenchmarkFixture.Corpus;
import com.sellerops.knowledge.bench.BenchmarkFixture.Passage;
import com.sellerops.knowledge.bench.BenchmarkFixture.Query;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

/**
 * Writes the passages and questions the v2 exploration arms need representations for.
 *
 * <p>Not a measurement — the build step in front of {@code tools/dev/bench-representations.py}. A
 * passage is keyed by its own text so the same document appearing in two corpora (the 「종합몰」 arm
 * reuses every other library's documents) is generated and embedded once.
 */
class BenchmarkArmDump {

    @Test
    void dump() throws Exception {
        Map<String, Object> passages = new LinkedHashMap<>();
        for (Corpus corpus : BenchmarkFixture.corpora().values()) {
            for (Passage passage : corpus.passages()) {
                passages.putIfAbsent(BenchmarkArms.keyOf(passage), Map.of(
                        "title", passage.title(),
                        "content", passage.content(),
                        "sentences", BenchmarkVectors.sentencesOf(passage)));
            }
        }
        List<Map<String, String>> queries = new ArrayList<>();
        for (Query query : BenchmarkFixture.queries()) {
            queries.add(Map.of("id", query.id(), "text", query.text()));
        }
        Path dir = Path.of(System.getProperty("bench.dir", "build/bench"));
        Files.createDirectories(dir);
        ObjectMapper mapper = new ObjectMapper();
        Files.writeString(dir.resolve("passages.json"), mapper.writeValueAsString(passages));
        Files.writeString(dir.resolve("queries.json"), mapper.writeValueAsString(queries));
        System.out.println("passages " + passages.size() + " queries " + queries.size());
    }
}
