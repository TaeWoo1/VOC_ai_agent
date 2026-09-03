package com.sellerops.knowledge.bench;

import static org.assertj.core.api.Assertions.assertThat;

import com.sellerops.knowledge.bench.BenchmarkFixture.Corpus;
import com.sellerops.knowledge.bench.BenchmarkFixture.Query;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

/**
 * <b>The retrieval benchmark, and the claim this package is allowed to make.</b>
 *
 * <p>Two arms over one fixture: the lexical scorer exactly as it shipped, and the production path
 * exactly as a lane now runs it. It is a regression guard rather than a leaderboard — the sweep that
 * chose the thresholds (six margins, four embedding arms, passage versus sentence units, semantic
 * alone versus a union with lexical) is recorded in {@code docs/knowledge_retrieval_quality_v1.md}
 * and is not re-run here, because a test that calls a vendor is a test that does not run.
 */
class RetrievalBenchmarkTest {

    @Test
    void measure() {
        Map<String, Corpus> corpora = BenchmarkFixture.corpora();
        List<Query> queries = BenchmarkFixture.queries();
        assertThat(queries).hasSizeGreaterThan(30);
        List<String> report = new ArrayList<>();
        for (RetrievalVariant variant : variants()) {
            BenchmarkScore score = BenchmarkScore.of(variant, corpora, queries);
            report.add(score.line());
            report.add("   by category " + BenchmarkScore.byCategory(variant, corpora, queries));
            score.failures().forEach(f -> report.add("   " + f));
            report.add("");
        }
        report.forEach(System.out::println);
        BenchmarkScore lexical = BenchmarkScore.of(RetrievalVariant.lexicalBaseline(), corpora, queries);
        // The lexical baseline is pinned too: if it silently improves, the comparison this package
        // rests on has moved and the document that quotes these numbers is stale.
        assertThat(lexical.recall()).isBetween(0.30, 0.50);
        if (BenchmarkVectors.available()) {
            BenchmarkScore shipped = BenchmarkScore.of(RetrievalVariant.production(), corpora, queries);
            assertThat(shipped.recall())
                    .as("the questions a seller's own knowledge can answer, answered")
                    .isGreaterThanOrEqualTo(0.80);
            assertThat(shipped.anyWrongRate())
                    .as("a passage from a document that does not answer the question is the dangerous "
                            + "failure: it gives the customer a confident wrong number")
                    .isZero();
            assertThat(shipped.noEvidencePrecision())
                    .as("a compliment must not be answered with a citation")
                    .isGreaterThanOrEqualTo(0.85);
            assertThat(shipped.recall() - lexical.recall())
                    .as("the whole reason this package exists")
                    .isGreaterThan(0.30);
        }
        try {
            Path out = Path.of(System.getProperty("bench.out", "build/retrieval-benchmark.txt"));
            Files.createDirectories(out.getParent());
            Files.write(out, report);
        } catch (Exception ignored) {
            // The table is the deliverable; a missing build dir is not a test failure.
        }
    }

    static List<RetrievalVariant> variants() {
        List<RetrievalVariant> out = new ArrayList<>();
        out.add(RetrievalVariant.lexicalBaseline());
        if (BenchmarkVectors.available()) {
            out.add(RetrievalVariant.production());
        }
        return out;
    }
}
