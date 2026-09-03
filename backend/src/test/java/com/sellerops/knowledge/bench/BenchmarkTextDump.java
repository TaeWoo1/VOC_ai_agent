package com.sellerops.knowledge.bench;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.sellerops.knowledge.bench.BenchmarkFixture.Corpus;
import com.sellerops.knowledge.bench.BenchmarkFixture.Passage;
import com.sellerops.knowledge.bench.BenchmarkFixture.Query;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;
import org.junit.jupiter.api.Test;

/**
 * Writes every text the semantic variants need a vector for, so the cache can be built once and
 * checked in. Not a measurement — a build step for {@link BenchmarkVectors}.
 */
class BenchmarkTextDump {

    @Test
    void dump() throws Exception {
        Set<String> texts = new LinkedHashSet<>();
        for (Corpus corpus : BenchmarkFixture.corpora().values()) {
            for (Passage passage : corpus.passages()) {
                texts.addAll(BenchmarkVectors.sentencesOf(passage));
            }
        }
        for (Query query : BenchmarkFixture.queries()) {
            texts.add(query.text());
        }
        Path out = Path.of(System.getProperty("bench.texts", "build/bench-texts.json"));
        Files.createDirectories(out.getParent());
        Files.writeString(out, new ObjectMapper().writeValueAsString(new ArrayList<>(texts)));
        System.out.println("texts " + texts.size());
    }
}
