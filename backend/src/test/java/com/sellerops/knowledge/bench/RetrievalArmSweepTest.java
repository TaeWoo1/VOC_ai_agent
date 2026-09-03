package com.sellerops.knowledge.bench;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.sellerops.knowledge.bench.BenchmarkFixture.Corpus;
import com.sellerops.knowledge.bench.BenchmarkFixture.Passage;
import com.sellerops.knowledge.bench.BenchmarkFixture.Query;
import com.sellerops.knowledge.bench.RetrievalArm.PassageRep;
import com.sellerops.knowledge.bench.RetrievalArm.QueryRep;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.junit.jupiter.api.Assumptions;
import org.junit.jupiter.api.Test;

/**
 * The v2 sweep: query representation, passage representation, synthetic questions and an eligibility
 * judgement, each measured on its own before any of them is allowed near production.
 *
 * <p><b>Skipped unless the generated caches exist.</b> Every arm here is a model's output, and the
 * decision this package has to make is whether that output is worth its cost — so it is generated
 * deliberately by {@code tools/dev/bench-representations.py} into {@code build/bench/} and never
 * checked in. Without those files the sweep has nothing to compare and says so instead of failing.
 *
 * <p>It also writes {@code eligibility-todo.json}: the (question, passage) pairs the other arms
 * actually returned, which is the bounded set the judge arm needs an opinion on. Judging every pair
 * of every corpus would measure the same thing at ten times the cost.
 */
class RetrievalArmSweepTest {

    @Test
    void sweep() throws Exception {
        BenchmarkArms arms = BenchmarkArms.load();
        Assumptions.assumeTrue(BenchmarkVectors.available(), "no embedding cache");
        Map<String, Corpus> corpora = BenchmarkFixture.corpora();
        List<Query> queries = BenchmarkFixture.queries();

        List<RetrievalVariant> variants = new ArrayList<>();
        variants.add(RetrievalVariant.lexicalBaseline());
        variants.add(RetrievalVariant.production());
        variants.add(RetrievalArm.of("A  semantic v1 (control)", QueryRep.RAW, PassageRep.SENTENCES, false));
        if (arms.hasSummary()) {
            variants.add(RetrievalArm.of("B  + passage summary", QueryRep.RAW, PassageRep.PLUS_SUMMARY, false));
        }
        if (arms.hasIntent()) {
            variants.add(RetrievalArm.of("C1 query intent only", QueryRep.INTENT, PassageRep.SENTENCES, false));
            variants.add(RetrievalArm.of("C2 raw + query intent", QueryRep.BOTH, PassageRep.SENTENCES, false));
        }
        if (arms.hasSynthetic()) {
            variants.add(RetrievalArm.of("D  + synthetic questions", QueryRep.RAW, PassageRep.PLUS_SYNTHETIC, false));
        }
        if (arms.hasIntent() && arms.hasSynthetic()) {
            variants.add(RetrievalArm.of("F1 intent + synthetic", QueryRep.BOTH, PassageRep.PLUS_SYNTHETIC, false));
        }
        if (arms.hasSynthetic() && arms.hasSummary()) {
            variants.add(RetrievalArm.of("F2 synthetic + summary", QueryRep.RAW, PassageRep.PLUS_BOTH, false));
        }
        if (arms.hasEligibility()) {
            variants.add(RetrievalArm.of("E  v1 + eligibility", QueryRep.RAW, PassageRep.SENTENCES, true));
            if (arms.hasIntent()) {
                variants.add(RetrievalArm.of("F5 raw+intent + eligibility", QueryRep.BOTH, PassageRep.SENTENCES, true));
                variants.add(RetrievalArm.of("F6 intent-only + eligibility", QueryRep.INTENT, PassageRep.SENTENCES, true));
            }
        }

        List<String> report = new ArrayList<>();
        Map<String, Set<String>> todo = new LinkedHashMap<>();
        for (RetrievalVariant variant : variants) {
            BenchmarkScore score = BenchmarkScore.of(variant, corpora, queries);
            report.add(score.line());
            report.add("   by category " + BenchmarkScore.byCategory(variant, corpora, queries));
            score.failures().forEach(f -> report.add("   " + f));
            report.add("");
            for (Query query : queries) {
                for (Passage passage : variant.retrieve(corpora.get(query.corpus()), query)) {
                    todo.computeIfAbsent(query.id(), k -> new LinkedHashSet<>())
                            .add(BenchmarkArms.keyOf(passage));
                }
            }
        }
        report.forEach(System.out::println);
        Path dir = Path.of(System.getProperty("bench.dir", "build/bench"));
        Files.createDirectories(dir);
        Files.write(Path.of(System.getProperty("bench.arms.out", "build/retrieval-arms.txt")), report);
        Files.writeString(dir.resolve("eligibility-todo.json"),
                new ObjectMapper().writeValueAsString(todo));
    }
}
