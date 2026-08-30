package com.sellerops.knowledge;

import java.util.ArrayList;
import java.util.List;

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

    private KnowledgeRetriever() {
    }

    /**
     * One passage offered to the search: whatever the caller needs to build a citation, plus the
     * already-normalized text it is judged on.
     *
     * @param ref        the caller's own handle on this passage — never read here
     * @param searchable the passage's comparison text, {@link KnowledgeText#normalize}d, including
     *                   whatever heading the caller wants matched with it
     */
    public record Candidate<T>(T ref, String searchable) {
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
