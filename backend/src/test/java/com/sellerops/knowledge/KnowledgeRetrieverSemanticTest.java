package com.sellerops.knowledge;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.OptionalDouble;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * The semantic gates, on numbers.
 *
 * <p>No vendor, no cache, no embedding model: {@link KnowledgeSemantics} is a port precisely so the
 * rules that decide «this library has nothing about that» can be read and tested as arithmetic.
 */
class KnowledgeRetrieverSemanticTest {

    private static KnowledgeRetriever.Candidate<String> passage(String name) {
        return new KnowledgeRetriever.Candidate<>(name, KnowledgeText.normalize(name), name);
    }

    private static KnowledgeSemantics similarities(Map<String, Double> table) {
        return quotable -> {
            Double value = table.get(quotable);
            return value == null ? OptionalDouble.empty() : OptionalDouble.of(value);
        };
    }

    @Test
    @DisplayName("one passage well clear of the others is evidence")
    void aPassageThatStandsOutIsOffered() {
        Map<String, Double> table = new LinkedHashMap<>();
        table.put("a", 0.52);
        table.put("b", 0.30);
        table.put("c", 0.28);
        List<KnowledgeRetriever.Hit<String>> hits = KnowledgeRetriever.rank("질문",
                List.of(passage("a"), passage("b"), passage("c")), null, similarities(table));
        assertThat(hits).extracting(KnowledgeRetriever.Hit::ref).containsExactly("a");
    }

    @Test
    @DisplayName("every passage equally mediocre is an absence, however high the best one is")
    void aFlatCorpusAnswersNothing() {
        Map<String, Double> table = new LinkedHashMap<>();
        // Well above MIN_SEMANTIC_COSINE, and still nothing: a library where every paragraph is
        // equally close to the question has not been written about the question.
        table.put("a", 0.61);
        table.put("b", 0.58);
        table.put("c", 0.57);
        assertThat(KnowledgeRetriever.rank("질문",
                List.of(passage("a"), passage("b"), passage("c")), null, similarities(table)))
                .isEmpty();
    }

    @Test
    @DisplayName("a passage close behind the best one is offered beside it")
    void theBandKeepsARunnerUp() {
        Map<String, Double> table = new LinkedHashMap<>();
        table.put("a", 0.50);
        table.put("b", 0.47);
        table.put("c", 0.10);
        assertThat(KnowledgeRetriever.rank("질문",
                List.of(passage("a"), passage("b"), passage("c")), null, similarities(table)))
                .extracting(KnowledgeRetriever.Hit::ref).containsExactly("a", "b");
    }

    @Test
    @DisplayName("a library of one document can still ground an answer, on the weaker rule")
    void oneDocumentHasNothingToStandOutFrom() {
        assertThat(KnowledgeRetriever.rank("질문", List.of(passage("a")), null,
                similarities(Map.of("a", 0.40))))
                .extracting(KnowledgeRetriever.Hit::ref).containsExactly("a");
        assertThat(KnowledgeRetriever.rank("질문", List.of(passage("a")), null,
                similarities(Map.of("a", 0.10))))
                .isEmpty();
    }

    @Test
    @DisplayName("a passage nobody could see sends the whole search back to the lexical scorer")
    void anIncompleteViewIsNotAnAbsence() {
        KnowledgeRetriever.Candidate<String> seen =
                new KnowledgeRetriever.Candidate<>("두께 안내", KnowledgeText.normalize("두께 안내"), "두께 안내");
        KnowledgeRetriever.Candidate<String> unseen =
                new KnowledgeRetriever.Candidate<>("색상 안내", KnowledgeText.normalize("색상 안내"), "색상 안내");
        // The semantic lane can score the first and not the second. It must not conclude anything —
        // an absence decided from half a corpus is an absence about half a corpus.
        List<KnowledgeRetriever.Hit<String>> hits = KnowledgeRetriever.rank("두께",
                List.of(seen, unseen), null, similarities(Map.of("두께 안내", 0.9)));
        assertThat(hits).extracting(KnowledgeRetriever.Hit::ref).containsExactly("두께 안내");
        // …and what it returned is what the lexical scorer returns for the same question.
        assertThat(hits).isEqualTo(KnowledgeRetriever.rank("두께", List.of(seen, unseen), null));
    }

    /** Similarities as above, plus a table of how much two passages agree with one another. */
    private static KnowledgeSemantics agreeing(Map<String, Double> table,
                                               Map<String, Double> agreement) {
        return new KnowledgeSemantics() {
            @Override
            public OptionalDouble similarityOf(String quotable) {
                Double value = table.get(quotable);
                return value == null ? OptionalDouble.empty() : OptionalDouble.of(value);
            }

            @Override
            public OptionalDouble agreementOf(String a, String b) {
                Double value = agreement.get(a + "|" + b);
                if (value == null) {
                    value = agreement.get(b + "|" + a);
                }
                return value == null ? OptionalDouble.empty() : OptionalDouble.of(value);
            }
        };
    }

    @Test
    @DisplayName("a second document saying the same thing is a second answer, not the background")
    void corroborationIsNotSilence() {
        Map<String, Double> table = new LinkedHashMap<>();
        // The shape that shipped as an absence: two documents stating one rule, and a third that is
        // about something else but not miles away. Nothing stands out, because the runner-up IS the
        // answer again — and the further the corroborator lifts the background, the more certainly
        // the corpus is called silent about a fact it states twice.
        table.put("policy", 0.61);
        table.put("shipping note", 0.60);
        table.put("colour chart", 0.48);
        assertThat(KnowledgeRetriever.rank("질문",
                List.of(passage("policy"), passage("shipping note"), passage("colour chart")), null,
                similarities(table)))
                .as("without the agreement measure this is the defect, and it stays reproducible")
                .isEmpty();
        // Told that those two answered with sentences that say the same thing, the background is the
        // colour chart alone — and the seller's own rule is found.
        assertThat(KnowledgeRetriever.rank("질문",
                List.of(passage("policy"), passage("shipping note"), passage("colour chart")), null,
                agreeing(table, Map.of("policy|shipping note", 0.75))))
                .extracting(KnowledgeRetriever.Hit::ref)
                .containsExactly("policy", "shipping note");
    }

    @Test
    @DisplayName("passages that merely share a subject are still the background")
    void agreementBelowTheFloorChangesNothing() {
        Map<String, Double> table = new LinkedHashMap<>();
        table.put("a", 0.61);
        table.put("b", 0.58);
        table.put("c", 0.57);
        // The benchmark's background pairs top out at 0.611. One product's notes are all about one
        // product, and a corpus must not become a corpus of one answer because of it.
        assertThat(KnowledgeRetriever.rank("질문",
                List.of(passage("a"), passage("b"), passage("c")), null,
                agreeing(table, Map.of("a|b", 0.61, "a|c", 0.60))))
                .isEmpty();
    }

    @Test
    @DisplayName("a corpus that agrees with itself end to end is the one-document rule")
    void everythingAgreeingFallsBackToTheSoloRule() {
        Map<String, Double> table = new LinkedHashMap<>();
        // The live shape (2026-09-23): a library of two documents that both state the exchange
        // deadline. Scored 0.611 and 0.606 for the customer's question — margin 0.005 — and the
        // seller was told their own rule was not written down.
        table.put("a", 0.61);
        table.put("b", 0.60);
        assertThat(KnowledgeRetriever.rank("질문", List.of(passage("a"), passage("b")), null,
                agreeing(table, Map.of("a|b", 0.90))))
                .extracting(KnowledgeRetriever.Hit::ref).containsExactly("a", "b");
        // …and the weaker rule is still a rule: two passages that agree about nothing relevant are
        // not grounding, however much they agree with each other.
        Map<String, Double> faint = new LinkedHashMap<>();
        faint.put("a", 0.18);
        faint.put("b", 0.17);
        assertThat(KnowledgeRetriever.rank("질문", List.of(passage("a"), passage("b")), null,
                agreeing(faint, Map.of("a|b", 0.90))))
                .isEmpty();
    }

    @Test
    @DisplayName("a lane that cannot compare passages gets the gate that shipped")
    void unmeasuredAgreementIsNotAgreement() {
        Map<String, Double> table = new LinkedHashMap<>();
        table.put("a", 0.61);
        table.put("b", 0.60);
        table.put("c", 0.30);
        // The default KnowledgeSemantics#agreementOf answers «not measured», and what comes back is
        // the pre-existing behaviour exactly.
        assertThat(KnowledgeRetriever.rank("질문",
                List.of(passage("a"), passage("b"), passage("c")), null, similarities(table)))
                .isEqualTo(KnowledgeRetriever.rank("질문",
                        List.of(passage("a"), passage("b"), passage("c")), null,
                        agreeing(table, Map.of())));
    }

    @Test
    @DisplayName("no semantic lane at all is the shipped lexical behaviour, unchanged")
    void noSemanticsIsTheOldPath() {
        List<KnowledgeRetriever.Candidate<String>> corpus =
                List.of(passage("두께 안내 내부 두께는 1.6mm입니다"), passage("색상 안내 화이트와 우드가 있습니다"));
        assertThat(KnowledgeRetriever.rank("두께", corpus, null, null))
                .isEqualTo(KnowledgeRetriever.rank("두께", corpus, null));
    }
}
