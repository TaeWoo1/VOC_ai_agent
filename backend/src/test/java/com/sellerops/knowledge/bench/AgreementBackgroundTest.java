package com.sellerops.knowledge.bench;

import static org.assertj.core.api.Assertions.assertThat;

import com.sellerops.knowledge.KnowledgeRetriever;
import com.sellerops.knowledge.KnowledgeText;
import com.sellerops.knowledge.bench.BenchmarkFixture.Corpus;
import com.sellerops.knowledge.bench.BenchmarkFixture.Passage;
import com.sellerops.knowledge.bench.BenchmarkFixture.Query;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

/**
 * <b>Where {@link KnowledgeRetriever#MIN_SEMANTIC_AGREEMENT} is allowed to sit.</b>
 *
 * <p>That threshold decides when a second passage stops counting as the background the absence gate
 * measures against. Set too low it empties the background of every search and the absence gate stops
 * existing; the benchmark's own three numbers cannot catch that, because <b>not one of its 114
 * questions is answered by two documents</b> — the corroboration case the threshold exists for is
 * absent from the corpus that would otherwise guard it.
 *
 * <p>So this pins the other side: over every passage pair where NEITHER passage answers the query —
 * the background itself — how much do they agree? Measured 2026-09-23 across the seven libraries:
 * n=1,235, median 0.254, p95 0.448, p99 0.514, <b>max 0.611</b>. The live corroborating pair that
 * this package was opened for sits at 0.750. The threshold must stay in that gap, and lowering it
 * into the background distribution fails here with the distribution printed.
 */
class AgreementBackgroundTest {

    @Test
    void theThresholdStaysAboveTheBackground() {
        if (!BenchmarkVectors.available()) {
            return;
        }
        BenchmarkVectors vectors = BenchmarkVectors.shipped();
        BenchmarkArms arms = BenchmarkArms.shipped();
        Map<String, Corpus> corpora = BenchmarkFixture.corpora();
        List<Double> background = new ArrayList<>();

        for (Query query : BenchmarkFixture.queries()) {
            if (!query.answerable()) {
                continue;
            }
            List<float[]> asked = new ArrayList<>();
            for (String text : List.of(query.text(), arms.intentOf(query.text()))) {
                if (vectors.has(text)) {
                    asked.add(vectors.of(text));
                }
            }
            if (asked.isEmpty()) {
                continue;
            }
            List<Passage> passages = corpora.get(query.corpus()).passages();
            // The sentence each passage answered THIS query with — production's own rule.
            List<String> answeredWith = new ArrayList<>();
            for (Passage p : passages) {
                double best = -1;
                String unit = null;
                for (String sentence : KnowledgeText.comparableUnits(p.title() + "\n" + p.content())) {
                    if (!vectors.has(sentence)) {
                        continue;
                    }
                    for (float[] question : asked) {
                        double score = BenchmarkVectors.cosine(question, vectors.of(sentence));
                        if (score > best) {
                            best = score;
                            unit = sentence;
                        }
                    }
                }
                answeredWith.add(unit);
            }
            for (int i = 0; i < passages.size(); i++) {
                for (int j = i + 1; j < passages.size(); j++) {
                    if (answeredWith.get(i) == null || answeredWith.get(j) == null
                            || query.expect().contains(passages.get(i).sourceId())
                            || query.expect().contains(passages.get(j).sourceId())) {
                        continue;
                    }
                    background.add(BenchmarkVectors.cosine(vectors.of(answeredWith.get(i)),
                            vectors.of(answeredWith.get(j))));
                }
            }
        }
        Collections.sort(background);
        double max = background.get(background.size() - 1);
        System.out.printf("background agreement  n=%d  median=%.3f  p95=%.3f  p99=%.3f  max=%.3f%n",
                background.size(), at(background, 0.50), at(background, 0.95), at(background, 0.99),
                max);
        assertThat(background).hasSizeGreaterThan(1000);
        assertThat(KnowledgeRetriever.MIN_SEMANTIC_AGREEMENT)
                .as("two passages that do not answer the question must never be read as agreeing "
                        + "about it — that would empty the background the absence gate measures")
                .isGreaterThan(max);
    }

    private static double at(List<Double> sorted, double p) {
        return sorted.get(Math.min(sorted.size() - 1, (int) Math.floor(p * sorted.size())));
    }
}
