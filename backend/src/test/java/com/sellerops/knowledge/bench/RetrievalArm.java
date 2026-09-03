package com.sellerops.knowledge.bench;

import com.sellerops.knowledge.KnowledgeRetriever;
import com.sellerops.knowledge.KnowledgeSemantics;
import com.sellerops.knowledge.KnowledgeText;
import com.sellerops.knowledge.KnowledgeTopic;
import com.sellerops.knowledge.bench.BenchmarkFixture.Corpus;
import com.sellerops.knowledge.bench.BenchmarkFixture.Passage;
import com.sellerops.knowledge.bench.BenchmarkFixture.Query;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.OptionalDouble;
import java.util.Set;

/**
 * One exploration arm of Knowledge Retrieval Quality v2 — a variant that differs from the shipped
 * path in exactly one named way, so a difference in the table has exactly one cause.
 *
 * <p><b>Everything except the named change is production.</b> The same
 * {@link KnowledgeRetriever#rank(String, List, String, KnowledgeSemantics)} with the same thresholds,
 * the same {@link KnowledgeTopic} refusals, the same cap. What an arm may change is only which TEXTS
 * are embedded on each side of the comparison, and whether a judgement runs after ranking.
 */
public final class RetrievalArm {

    /** What the question is embedded as. */
    public enum QueryRep {
        /** The customer's own sentence — shipped. */
        RAW,
        /** A model's restatement of what information the sentence needs. */
        INTENT,
        /** Both, scored as whichever comes closer. */
        BOTH
    }

    /** What a passage is embedded as, beside the seller's own sentences. */
    public enum PassageRep {
        /** The seller's sentences, title-prefixed — shipped. */
        SENTENCES,
        /** Plus a model's description of what the passage answers. */
        PLUS_SUMMARY,
        /** Plus the customer phrasings a model expects for it. */
        PLUS_SYNTHETIC,
        PLUS_BOTH
    }

    private RetrievalArm() {
    }

    /** An exploration arm: generated representations from {@code build/bench/}. */
    public static RetrievalVariant of(String label, QueryRep queryRep, PassageRep passageRep,
                                      boolean rerank) {
        return of(label, queryRep, passageRep, rerank, BenchmarkArms.load(),
                BenchmarkVectors.withOverlay(
                        System.getProperty("bench.dir", "build/bench") + "/vectors-arms.json"));
    }

    /**
     * The SHIPPED path: the two arms v2 chose, from the checked-in caches.
     *
     * <p>Not a re-implementation — the same {@code KnowledgeRetriever.rank}, the same thresholds, the
     * same {@link KnowledgeTopic} refusals, the same cap, and the same two extra questions production
     * asks: the customer's sentence restated before embedding, and a refusal-only judgement after
     * ranking. Change a threshold in production and this table moves.
     */
    public static RetrievalVariant shipped() {
        return of("SEMANTIC (shipped)", QueryRep.BOTH, PassageRep.SENTENCES, true,
                BenchmarkArms.shipped(), BenchmarkVectors.shipped());
    }

    public static RetrievalVariant of(String label, QueryRep queryRep, PassageRep passageRep,
                                      boolean rerank, BenchmarkArms arms, BenchmarkVectors vectors) {
        return new RetrievalVariant() {
            @Override
            public String name() {
                return label;
            }

            @Override
            public List<Passage> retrieve(Corpus corpus, Query query) {
                List<String> asked = new ArrayList<>();
                if (queryRep != QueryRep.INTENT) {
                    asked.add(query.text());
                }
                if (queryRep != QueryRep.RAW) {
                    asked.add(arms.intentOf(query.text()));
                }
                List<float[]> askedVectors = new ArrayList<>();
                for (String text : asked) {
                    if (!vectors.has(text)) {
                        return List.of();
                    }
                    askedVectors.add(vectors.of(text));
                }
                Map<String, Passage> byQuotable = new LinkedHashMap<>();
                List<KnowledgeRetriever.Candidate<Passage>> candidates = new ArrayList<>();
                for (Passage passage : corpus.passages()) {
                    String quotable = passage.title() + "\n" + passage.content();
                    byQuotable.put(quotable, passage);
                    candidates.add(new KnowledgeRetriever.Candidate<>(passage, passage.searchable(),
                            quotable));
                }
                KnowledgeSemantics semantics = quotable -> {
                    Passage passage = byQuotable.get(quotable);
                    List<String> units = new ArrayList<>(KnowledgeText.comparableUnits(quotable));
                    if (passage != null) {
                        String key = BenchmarkArms.keyOf(passage);
                        if (passageRep == PassageRep.PLUS_SUMMARY || passageRep == PassageRep.PLUS_BOTH) {
                            String summary = arms.summaryOf(key);
                            if (summary != null) {
                                units.add(summary);
                            }
                        }
                        if (passageRep == PassageRep.PLUS_SYNTHETIC || passageRep == PassageRep.PLUS_BOTH) {
                            units.addAll(arms.syntheticOf(key));
                        }
                    }
                    double best = -1;
                    for (String unit : units) {
                        if (!vectors.has(unit)) {
                            continue;
                        }
                        float[] vector = vectors.of(unit);
                        for (float[] question : askedVectors) {
                            best = Math.max(best, BenchmarkVectors.cosine(question, vector));
                        }
                    }
                    return best < 0 ? OptionalDouble.empty() : OptionalDouble.of(best);
                };
                Set<KnowledgeTopic> topics = KnowledgeTopic.of(query.text());
                List<Passage> found = new ArrayList<>();
                for (KnowledgeRetriever.Hit<Passage> hit
                        : KnowledgeRetriever.rank(query.text(), candidates, corpus.subject(), semantics)) {
                    Passage passage = hit.ref();
                    if (!KnowledgeTopic.applicable(topics, KnowledgeTopic.of(passage.title()))
                            || !KnowledgeTopic.remedyApplicable(query.text(), passage.title())) {
                        continue;
                    }
                    if (rerank && !arms.eligible(query.id(), BenchmarkArms.keyOf(passage))) {
                        continue;
                    }
                    found.add(passage);
                    if (found.size() >= MAX_PASSAGES) {
                        break;
                    }
                }
                return found;
            }
        };
    }
}
