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
        // v2 widened this from 46 to 114 across seven libraries. The size is pinned because the v1
        // numbers were measured on the set that helped choose them, and read 6 points high.
        assertThat(queries).hasSizeGreaterThanOrEqualTo(110);
        List<String> report = new ArrayList<>();
        for (RetrievalVariant variant : variants()) {
            BenchmarkScore score = BenchmarkScore.of(variant, corpora, queries);
            report.add(score.line());
            report.add("   by category " + BenchmarkScore.byCategory(variant, corpora, queries));
            score.failures().forEach(f -> report.add("   " + f));
            report.add("");
        }
        report.forEach(System.out::println);
        // Written BEFORE the assertions: the table is what a person reads to find out WHY a threshold
        // moved, and a failing assertion is exactly when it is wanted.
        try {
            Path out = Path.of(System.getProperty("bench.out", "build/retrieval-benchmark.txt"));
            Files.createDirectories(out.getParent());
            Files.write(out, report);
        } catch (Exception ignored) {
            // The table is a convenience; a missing build dir is not a test failure.
        }
        BenchmarkScore lexical = BenchmarkScore.of(RetrievalVariant.lexicalBaseline(), corpora, queries);
        // The lexical baseline is pinned too: if it silently improves, the comparison this package
        // rests on has moved and the document that quotes these numbers is stale.
        assertThat(lexical.recall()).isBetween(0.30, 0.50);
        if (BenchmarkVectors.available()) {
            BenchmarkScore shipped = BenchmarkScore.of(RetrievalVariant.production(), corpora, queries);
            assertThat(shipped.recall())
                    .as("the questions a seller's own knowledge can answer, answered")
                    .isGreaterThanOrEqualTo(0.90);
            assertThat(shipped.anyWrongRate())
                    .as("a passage from a document that does not answer the question is the dangerous "
                            + "failure: it gives the customer a confident wrong number")
                    .isZero();
            assertThat(shipped.noEvidencePrecision())
                    .as("a compliment must not be answered with a citation")
                    .isEqualTo(1.0);
            assertThat(shipped.recall() - lexical.recall())
                    .as("the whole reason this package exists")
                    .isGreaterThan(0.45);
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
