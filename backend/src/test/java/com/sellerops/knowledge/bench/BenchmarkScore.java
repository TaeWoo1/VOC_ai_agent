package com.sellerops.knowledge.bench;

import com.sellerops.knowledge.bench.BenchmarkFixture.Corpus;
import com.sellerops.knowledge.bench.BenchmarkFixture.Passage;
import com.sellerops.knowledge.bench.BenchmarkFixture.Query;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * What a retrieval variant is worth, in the three numbers a decision needs.
 *
 * <p><b>Recall alone would choose the worst variant.</b> A retriever that returns every passage for
 * every question has perfect recall and is useless — worse than useless, because a passage handed to
 * the drafter is a fact the seller's customer may be told. So recall is read beside the two ways of
 * being wrong: quoting a document that does not answer the question, and quoting anything at all when
 * the honest answer is that nothing here does.
 */
public record BenchmarkScore(String variant, int answerable, int recallHits, int top1Wrong,
                             int anyWrong, int noEvidence, int noEvidenceClean,
                             List<String> failures) {

    public double recall() {
        return answerable == 0 ? 0 : (double) recallHits / answerable;
    }

    /** Answerable questions whose BEST passage was from a document that does not answer them. */
    public double top1WrongRate() {
        return answerable == 0 ? 0 : (double) top1Wrong / answerable;
    }

    /** Answerable questions where any returned passage was from an unexpected document. */
    public double anyWrongRate() {
        return answerable == 0 ? 0 : (double) anyWrong / answerable;
    }

    /** Questions whose honest answer is «nothing here» and that got nothing. */
    public double noEvidencePrecision() {
        return noEvidence == 0 ? 1 : (double) noEvidenceClean / noEvidence;
    }

    public static BenchmarkScore of(RetrievalVariant variant, Map<String, Corpus> corpora,
                                    List<Query> queries) {
        int answerable = 0;
        int recallHits = 0;
        int top1Wrong = 0;
        int anyWrong = 0;
        int noEvidence = 0;
        int noEvidenceClean = 0;
        List<String> failures = new ArrayList<>();
        for (Query query : queries) {
            Corpus corpus = corpora.get(query.corpus());
            List<Passage> got = variant.retrieve(corpus, query);
            List<String> sources = got.stream().map(Passage::sourceId).distinct().toList();
            if (query.answerable()) {
                answerable++;
                boolean hit = sources.stream().anyMatch(query.expect()::contains);
                if (hit) {
                    recallHits++;
                } else {
                    failures.add(query.id() + " MISS got=" + sources);
                }
                if (!sources.isEmpty() && !query.expect().contains(sources.get(0))) {
                    top1Wrong++;
                    if (hit) {
                        failures.add(query.id() + " TOP1-WRONG got=" + sources);
                    }
                }
                if (sources.stream().anyMatch(s -> !query.expect().contains(s))) {
                    anyWrong++;
                }
            } else {
                noEvidence++;
                if (sources.isEmpty()) {
                    noEvidenceClean++;
                } else {
                    failures.add(query.id() + " FALSE-EVIDENCE got=" + sources);
                }
            }
        }
        return new BenchmarkScore(variant.name(), answerable, recallHits, top1Wrong, anyWrong,
                noEvidence, noEvidenceClean, List.copyOf(failures));
    }

    /** Recall by category, so a variant that helps one class and breaks another cannot hide. */
    public static Map<String, String> byCategory(RetrievalVariant variant, Map<String, Corpus> corpora,
                                                 List<Query> queries) {
        Map<String, int[]> tally = new LinkedHashMap<>();
        for (Query query : queries) {
            List<String> sources = variant.retrieve(corpora.get(query.corpus()), query).stream()
                    .map(Passage::sourceId).distinct().toList();
            boolean ok = query.answerable()
                    ? sources.stream().anyMatch(query.expect()::contains)
                    : sources.isEmpty();
            int[] cell = tally.computeIfAbsent(query.category(), k -> new int[2]);
            cell[1]++;
            if (ok) {
                cell[0]++;
            }
        }
        Map<String, String> out = new LinkedHashMap<>();
        tally.forEach((k, v) -> out.put(k, v[0] + "/" + v[1]));
        return out;
    }

    public String line() {
        return String.format("%-26s recall %4.1f%% (%2d/%2d)  top1-wrong %4.1f%%  any-wrong %4.1f%%  no-evidence %4.1f%% (%d/%d)",
                variant, recall() * 100, recallHits, answerable, top1WrongRate() * 100,
                anyWrongRate() * 100, noEvidencePrecision() * 100, noEvidenceClean, noEvidence);
    }
}
