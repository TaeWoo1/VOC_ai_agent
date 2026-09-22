package com.sellerops.knowledge;

import java.util.ArrayList;
import java.util.List;
import java.util.OptionalDouble;

/**
 * The one retrieval loop, over any corpus of quotable passages.
 *
 * <p><b>Why this exists at all.</b> The seller's product knowledge, the company's operating policy
 * and the answers the seller has already sent are three stores with three lifecycles — but they are
 * ONE retrieval problem, and the moment they become two implementations they start disagreeing about
 * what "이 질문에 답할 내용이 없다" means. The 2026-08-24 inversion ({@link QueryWords}) was a single
 * scoring defect that turned every answerable question into a zero; a second copy of that scorer
 * would have had to be found and fixed twice. So the gates, the thresholds and the tie-breaks live
 * here and every scope calls in.
 *
 * <p><b>Three gates, in the order they matter.</b> First the question is weighed against the whole
 * corpus once and either the corpus can speak to it or it cannot ({@link #MIN_ASKABLE_RATIO}) —
 * decided for the QUESTION, before any passage is looked at, because a per-passage gate lets the best
 * coincidence through on a question nobody wrote about. Then each passage must share at least
 * {@link #MIN_MATCHED_CHARS} characters of the question's own words, and must cover at least
 * {@link #MIN_TOPIC_COVERAGE} of what the best passage here reaches. Failing any of them drops the
 * passage rather than ranking it: handing back the least-bad paragraph is how a grounded answer
 * quietly becomes a guess with a citation attached.
 *
 * <p><b>Deterministic, and no index.</b> Same corpus and same question give the same passages in the
 * same order, which is the premise under which a citation is evidence rather than decoration. There
 * is no vector store and no approximate nearest neighbour: every corpus reached from here is bounded
 * (one product's notes, one org's policies, one org's past answers), and at that size an ANN index
 * adds operational surface and non-determinism and improves nothing measurable.
 */
public final class KnowledgeRetriever {

    /**
     * How much of the question a passage must cover to be offered as grounding.
     *
     * <p>A RANKING floor, and only that. Its denominator is the same for every passage of one search,
     * so unlike the measure it replaced it cannot admit a passage by shrinking — a corpus that knows
     * less about a question no longer scores higher on it.
     */
    public static final double MIN_TOPIC_COVERAGE = 0.4;

    /**
     * How much of the question's CONTENT words the corpus must have at all before any passage is
     * offered.
     *
     * <p>The absence gate, and the one that makes "우리는 그 내용을 갖고 있지 않습니다" reachable.
     * Measured over content words only — interrogatives and the words for a subject already resolved
     * are removed first ({@link QueryWords}) — so a well-formed Korean question does not fail it for
     * being well formed. What remains in the denominator is the part of the question nobody wrote
     * about, which is exactly what absence means.
     */
    public static final double MIN_ASKABLE_RATIO = 0.35;

    /**
     * The fewest characters of the question's own words a passage must actually share.
     *
     * <p>An absolute floor beside the ratio, because a ratio can be satisfied by one syllable when the
     * question has one content word — "폭" lands inside 폭넓은, 폭염, 폭우. Two characters is the first
     * length at which a Korean match is a word rather than a syllable.
     */
    public static final int MIN_MATCHED_CHARS = 2;

    /**
     * The least a passage may resemble the question at all.
     *
     * <p>A weak absolute guard under the real gate below, so a corpus of near-noise cannot produce a
     * citation by having one passage that is marginally less unrelated than the rest.
     */
    public static final double MIN_SEMANTIC_COSINE = 0.20;

    /**
     * How far the best passage must stand out FROM THE OTHERS to count as evidence.
     *
     * <p><b>The semantic absence gate, and the measurement that chose its shape.</b> An absolute
     * cosine cannot decide absence: on the benchmark corpus a Korean colloquial question and the
     * passage that answers it sit at the same similarity as a compliment and the passage that does
     * not — 「자꾸 들떠요」 reached 0.16 and 「너무 좋아요 만족합니다」 reached 0.18. What separates them is
     * not the height of the best passage but its SHAPE against the corpus: one passage well clear of
     * the others, versus every passage equally mediocre. Leave-one-out, so a two-passage library does
     * not need twice the separation a ten-passage one needs to say the same thing.
     *
     * <p>This is the same argument {@link #MIN_TOPIC_COVERAGE} already makes on the lexical side:
     * divide by what THIS corpus manages, not by a number chosen elsewhere.
     */
    public static final double MIN_SEMANTIC_MARGIN = 0.10;

    /**
     * A corpus of one passage has nothing to stand out from.
     *
     * <p>Named as its own, weaker rule rather than hidden inside the margin: with a single document
     * the only signal left is the absolute similarity, and a seller with one FAQ must still be able
     * to be grounded.
     */
    public static final double SOLO_MIN_SEMANTIC_COSINE = 0.25;

    /**
     * How close two passages' answering sentences must be before the second one stops counting as
     * BACKGROUND for the first.
     *
     * <p><b>The corroboration defect, and why the margin alone could not see it.</b> The background
     * is meant to be what this corpus scores on this question by coincidence. A passage that states
     * the same fact as the best passage is not coincidence — it is a second answer, and averaging it
     * in measures the best answer against another answer. A seller who writes one rule in two places
     * is then told their corpus is silent about it, while a seller whose documents contradict each
     * other is not. Measured on the reference deployment (2026-09-23): one exchange deadline written
     * in a Korean policy page and in an English shipping note scored 0.664 and 0.567 for the
     * customer's question — a margin of 0.097 against a floor of 0.10 — and the two sentences agree
     * with each other at 0.750.
     *
     * <p><b>The value is measured, not picked.</b> Over the benchmark's 1,235 passage pairs where
     * NEITHER passage answers the query — the background this gate is built to keep — agreement runs
     * median 0.254, p99 0.514 and <b>max 0.611</b>; the live corroborating pair sits at 0.750. Any
     * value inside that gap separates them, and 0.70 is above every background pair observed and
     * below the corroboration. The sweep confirms it: from 0.50 to 0.90 the benchmark's recall,
     * wrong-source and no-evidence numbers do not move at all, and the first degradation is at 0.45.
     *
     * <p><b>The benchmark contains no corroboration case at all</b> — not one of its 114 questions is
     * answered by two documents — which is exactly why 114 questions and a 44-question holdout could
     * not see this defect. That absence is the reason the threshold is justified by the background
     * distribution rather than by a score it moves.
     */
    public static final double MIN_SEMANTIC_AGREEMENT = 0.70;

    /** Passages within this share of the best one are offered beside it. */
    public static final double SEMANTIC_BAND = 0.90;

    private KnowledgeRetriever() {
    }

    /**
     * One passage offered to the search: whatever the caller needs to build a citation, plus the
     * already-normalized text it is judged on.
     *
     * @param ref        the caller's own handle on this passage — never read here
     * @param searchable the passage's comparison text, {@link KnowledgeText#normalize}d, including
     *                   whatever heading the caller wants matched with it
     * @param quotable   the same passage as it actually reads — title, spacing and punctuation intact.
     *                   The lexical scorer never looks at it; the semantic lane needs it because a
     *                   vector of text with the spaces removed is a vector of different text. Null
     *                   when the caller has no semantic lane, and then only the lexical gates run.
     */
    public record Candidate<T>(T ref, String searchable, String quotable) {

        public Candidate(T ref, String searchable) {
            this(ref, searchable, null);
        }
    }

    /** A passage that cleared every gate, with the two numbers a caller may report. */
    public record Hit<T>(T ref, double coverage, int matchedChars) {
    }

    /**
     * The passages of this corpus that cover the question, best first.
     *
     * <p>Empty is a real answer and the common one. It means either that the corpus has no words for
     * what was asked (the absence gate) or that nothing in it covers enough of the question — and the
     * caller must be able to tell the difference, which is why {@link #canAnswer} is separate.
     *
     * @param discountedSubject a name the question may repeat that distinguishes no passage in this
     *                          corpus — a product's own name in its own library. Words fully explained
     *                          by it are dropped from the question, so naming the subject cannot admit
     *                          a passage. Pass null or blank when the corpus has no such subject.
     */
    public static <T> List<Hit<T>> rank(String query, List<Candidate<T>> candidates,
                                        String discountedSubject) {
        if (candidates.isEmpty()) {
            return List.of();
        }
        KnowledgeText.Weighing weighing = weigh(query, candidates, discountedSubject);
        if (!weighing.askable(MIN_ASKABLE_RATIO)) {
            return List.of();
        }
        List<Hit<T>> hits = new ArrayList<>();
        for (Candidate<T> candidate : candidates) {
            KnowledgeText.Assessment assessment = weighing.assess(candidate.searchable());
            if (assessment.matchedChars() < MIN_MATCHED_CHARS
                    || assessment.coverage() < MIN_TOPIC_COVERAGE) {
                continue;
            }
            hits.add(new Hit<>(candidate.ref(), assessment.coverage(), assessment.matchedChars()));
        }
        // Ranked here, tie-broken by the caller: coverage is the only ordering this class can know,
        // and every caller has a stable secondary key (document order, recency, strength) that this
        // one does not. A sort that is stable in Java keeps the caller's incoming order for ties.
        hits.sort((a, b) -> Double.compare(b.coverage(), a.coverage()));
        return List.copyOf(hits);
    }

    /**
     * The passages of this corpus that are ABOUT the question, best first — or the lexical answer when
     * the semantic lane cannot see the whole corpus.
     *
     * <p><b>The semantic lane decides absence and the lexical lane does not get a second vote.</b>
     * That order is measured, not preferred: on the benchmark every error the lexical scorer made was
     * an ADMISSION — 배송 found inside a return policy, 교환 offered for a question about 환불 — so a
     * union of the two lanes reproduced all of them (wrong-source 11.1%) while adding no answer the
     * semantic lane did not already have (recall identical at 88.9%). What the lexical lane is for
     * now is the case it is uniquely good at: being available. With the capability off, an unindexed
     * passage, or a vendor that did not answer, {@code semantics} sees an incomplete corpus and this
     * returns exactly what it returned before this package existed.
     */
    public static <T> List<Hit<T>> rank(String query, List<Candidate<T>> candidates,
                                        String discountedSubject, KnowledgeSemantics semantics) {
        if (semantics == null) {
            return rank(query, candidates, discountedSubject);
        }
        List<Candidate<T>> scored = new ArrayList<>(candidates.size());
        List<Double> similarities = new ArrayList<>(candidates.size());
        for (Candidate<T> candidate : candidates) {
            OptionalDouble similarity = candidate.quotable() == null
                    ? OptionalDouble.empty() : semantics.similarityOf(candidate.quotable());
            if (similarity.isEmpty()) {
                // Not seen, not judged. A lane that has not read every passage cannot say the corpus
                // is silent, so the whole search reverts to the scorer that has read all of them.
                return rank(query, candidates, discountedSubject);
            }
            scored.add(candidate);
            similarities.add(similarity.getAsDouble());
        }
        if (scored.isEmpty()) {
            return List.of();
        }
        List<Integer> order = new ArrayList<>();
        for (int i = 0; i < scored.size(); i++) {
            order.add(i);
        }
        order.sort((a, b) -> Double.compare(similarities.get(b), similarities.get(a)));
        int top = order.get(0);
        double best = similarities.get(top);
        // The background: the rest of the corpus MINUS whatever answered this question the same way
        // the best passage did. A corroborating document is a second answer, not the noise floor.
        double sum = 0;
        int counted = 0;
        for (int i = 1; i < order.size(); i++) {
            int index = order.get(i);
            OptionalDouble agreement =
                    semantics.agreementOf(scored.get(top).quotable(), scored.get(index).quotable());
            if (agreement.isPresent() && agreement.getAsDouble() >= MIN_SEMANTIC_AGREEMENT) {
                continue;
            }
            sum += similarities.get(index);
            counted++;
        }
        boolean admitted;
        if (counted == 0) {
            // Nothing left to stand out from — either a one-passage corpus, or a corpus that agrees
            // with itself about this question. Both are the SOLO case, and both are answerable.
            admitted = best >= SOLO_MIN_SEMANTIC_COSINE;
        } else {
            double rest = sum / counted;
            admitted = best >= MIN_SEMANTIC_COSINE && best - rest >= MIN_SEMANTIC_MARGIN;
        }
        if (!admitted) {
            return List.of();
        }
        List<Hit<T>> ranked = new ArrayList<>(order.size());
        for (int index : order) {
            ranked.add(new Hit<>(scored.get(index).ref(), similarities.get(index), 0));
        }
        List<Hit<T>> hits = new ArrayList<>();
        for (Hit<T> hit : ranked) {
            if (hit.coverage() < best * SEMANTIC_BAND) {
                break;
            }
            hits.add(hit);
        }
        return List.copyOf(hits);
    }

    /**
     * Whether the corpus has words for the question at all, independent of whether any single passage
     * covers enough of it.
     *
     * <p>The distinction is the difference between "저희가 그 내용을 갖고 있지 않습니다" and "관련된
     * 내용은 있지만 이 질문에 답하지는 않습니다", and a seller acts differently on each.
     */
    public static <T> boolean canAnswer(String query, List<Candidate<T>> candidates,
                                        String discountedSubject) {
        return !candidates.isEmpty()
                && weigh(query, candidates, discountedSubject).askable(MIN_ASKABLE_RATIO);
    }

    private static <T> KnowledgeText.Weighing weigh(String query, List<Candidate<T>> candidates,
                                                    String discountedSubject) {
        return KnowledgeText.weigh(query, candidates.stream().map(Candidate::searchable).toList(),
                discountedSubject == null ? "" : discountedSubject);
    }
}
