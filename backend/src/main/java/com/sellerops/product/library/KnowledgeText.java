package com.sellerops.product.library;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

/**
 * Splitting a document into quotable passages, and scoring a passage against a question.
 *
 * <p><b>Pure, and therefore checkable.</b> Retrieval that lives in a database function or an external
 * index is retrieval nobody can unit-test and nobody can replay; an answer's evidence has to be
 * reproducible from the same corpus and the same question, or "근거" is a decoration. Everything here
 * is a static function of its inputs.
 *
 * <p><b>Why character bigrams and not a word index.</b> Korean attaches particles to nouns — 사용법,
 * 사용법을, 사용법은 are one word to a reader and three tokens to any whitespace tokenizer, so a
 * word-boundary match answers "사용법을 알려줘" with nothing. Overlapping 2-character shingles match
 * across the particle without needing a morphological analyzer, a dictionary, or an extension. It is
 * a lexical matcher and it is described as one: it finds passages that share wording, and it does not
 * understand them.
 *
 * <p><b>Why no vector store.</b> Retrieval here is always scoped to ONE product, whose corpus is a
 * handful of documents. At that size an approximate-nearest-neighbour index adds operational surface
 * and non-determinism and improves nothing that can be measured. If a corpus ever outgrows this, the
 * replacement is a change to this one class ({@code docs/demo_core_experience_v1.md} §6).
 */
public final class KnowledgeText {

    /**
     * The passage size retrieval aims for.
     *
     * <p>Small enough that a quote is checkable at a glance, large enough that a FAQ question and its
     * answer stay together — splitting those apart is how a retrieval layer returns the question and
     * calls it the answer.
     */
    static final int TARGET_CHARS = 420;

    /** Never emit a passage this short on its own; it is folded into its neighbour instead. */
    static final int MIN_CHARS = 60;

    /** A hard stop, so one unbroken wall of text cannot become one unquotable chunk. */
    static final int MAX_CHARS = 900;

    private KnowledgeText() {
    }

    /**
     * Split a document into passages, preferring blank-line boundaries, then sentence ends.
     *
     * <p>A seller's note is already structured by the way they typed it — a blank line between the
     * shipping policy and the return policy is an authored boundary, and honouring it costs nothing.
     * Only when a block is still too long does this fall back to sentence ends, and only then to a
     * hard cut.
     */
    public static List<String> chunk(String body) {
        List<String> out = new ArrayList<>();
        if (body == null || body.isBlank()) {
            return out;
        }
        StringBuilder current = new StringBuilder();
        for (String block : body.strip().split("\\n\\s*\\n")) {
            String trimmed = block.strip();
            if (trimmed.isEmpty()) {
                continue;
            }
            if (current.length() > 0 && current.length() + trimmed.length() + 1 > TARGET_CHARS) {
                out.add(current.toString());
                current.setLength(0);
            }
            if (current.length() > 0) {
                current.append('\n');
            }
            current.append(trimmed);
            while (current.length() > MAX_CHARS) {
                int cut = sentenceCut(current, MAX_CHARS);
                out.add(current.substring(0, cut).strip());
                current.delete(0, cut);
            }
        }
        if (current.length() > 0) {
            String tail = current.toString().strip();
            // A stray trailing line is appended to the previous passage rather than published as its
            // own: a two-word chunk wins on nothing and loses its context.
            if (tail.length() < MIN_CHARS && !out.isEmpty()) {
                out.set(out.size() - 1, out.get(out.size() - 1) + "\n" + tail);
            } else if (!tail.isEmpty()) {
                out.add(tail);
            }
        }
        return out;
    }

    /** The last sentence end at or before {@code limit}; the limit itself when there is none. */
    private static int sentenceCut(CharSequence text, int limit) {
        for (int i = Math.min(limit, text.length()) - 1; i > MIN_CHARS; i--) {
            char c = text.charAt(i);
            if (c == '.' || c == '!' || c == '?' || c == '\n' || c == '다' || c == '요') {
                return i + 1;
            }
        }
        return Math.min(limit, text.length());
    }

    /**
     * The stored comparison form: lower-cased, with everything that is not a letter or digit removed.
     *
     * <p>Punctuation and spacing are how the same sentence is written two ways; removing them is what
     * makes "사용 방법" and "사용방법" the same evidence.
     */
    public static String normalize(String text) {
        if (text == null) {
            return "";
        }
        StringBuilder sb = new StringBuilder(text.length());
        for (char c : text.toLowerCase(Locale.ROOT).toCharArray()) {
            if (Character.isLetterOrDigit(c)) {
                sb.append(c);
            }
        }
        return sb.toString();
    }

    /** Overlapping 2-character shingles of a normalized string. A 1-character input yields itself. */
    static Set<String> bigrams(String normalized) {
        Set<String> grams = new LinkedHashSet<>();
        if (normalized.isEmpty()) {
            return grams;
        }
        if (normalized.length() == 1) {
            grams.add(normalized);
            return grams;
        }
        for (int i = 0; i + 2 <= normalized.length(); i++) {
            grams.add(normalized.substring(i, i + 2));
        }
        return grams;
    }

    /**
     * How much of the QUESTION this passage covers, in [0,1] — unweighted.
     *
     * <p>Asymmetric on purpose. Jaccard would punish a long, correct passage for containing more than
     * the question asked, which is what a good answer does; the useful measure is "how much of what
     * was asked appears here". A passage that covers every shingle of the question scores 1 whether
     * it is two lines or ten.
     *
     * <p><b>Kept, but not what retrieval uses.</b> Plain coverage lets the filler of a Korean question
     * outvote its topic — see {@link #weightsFor}. It remains here because it is the definition the
     * weighted form specialises, and testing both is how the difference stays visible.
     */
    public static double score(String normalizedQuery, String normalizedContent) {
        Set<String> queryGrams = bigrams(normalizedQuery);
        if (queryGrams.isEmpty()) {
            return 0.0;
        }
        Set<String> contentGrams = bigrams(normalizedContent);
        int hits = 0;
        for (String gram : queryGrams) {
            if (contentGrams.contains(gram)) {
                hits++;
            }
        }
        return (double) hits / queryGrams.size();
    }

    /**
     * The question, weighed against what this product's library actually says.
     *
     * <p><b>One question, two things to measure, and they are not the same.</b> Ranking asks "which
     * passage best covers the topic"; absence asks "is this question even about something written
     * here". A single number cannot answer both, and every attempt to make it try failed on a live
     * read:
     *
     * <ul>
     *   <li><b>Plain coverage ranks by filler.</b> Asked "이 상품 사용 방법을 고객에게 어떻게 설명하면
     *       되나요", it put the 교환/반품 정책 above the 사용법 note (0.24 vs 0.14) — "상품", "고객"
     *       and "방법" are in both, and a Korean question is mostly grammar.</li>
     *   <li><b>Weighting by rarity and dropping the unwritten shingles</b> fixed the ranking and broke
     *       absence: "이 상품 배터리 충전 시간" scored 0.5 against a cable-molding note, because with
     *       배터리 and 충전 dropped, all that was left to measure was 상품 and 시간 — and the note
     *       happens to say "24시간".</li>
     *   <li><b>Keeping them in the denominator</b> fixed absence and broke recall: a real question
     *       carries nine or ten shingles of pure grammar, so every honest question also fell under the
     *       floor.</li>
     * </ul>
     *
     * <p>So both are reported. {@link Weighing#topicCoverage} ranks over the ASKABLE part of the
     * question — the shingles the library has words for at all — and {@link Weighing#askableRatio}
     * says how much of the question that part was. A question the library does not cover has a low
     * askable ratio no matter which passage it is compared to, which is exactly the property absence
     * detection needs and ranking must not have.
     *
     * <p>Rarity is {@code ln(1 + N/(df + 0.5))} over this product's own passages — ordinary inverse
     * document frequency, over a corpus small enough to compute exactly. The alternative was a Korean
     * stopword list: a lexicon to maintain, and wrong for any seller whose products make its "common"
     * words meaningful.
     *
     * <p><b>What this is not.</b> A lexical matcher finds passages that share wording. It does not
     * understand the question, and a question phrased entirely in words the seller never used will not
     * reach a passage that answers it. That limit is why the caller names WHICH document it is
     * quoting instead of absorbing the text into its own voice.
     */
    public static Weighing weigh(String normalizedQuery, List<String> normalizedCorpus) {
        Set<String> queryGrams = bigrams(normalizedQuery);
        Map<String, Double> weights = new HashMap<>();
        if (queryGrams.isEmpty() || normalizedCorpus.isEmpty()) {
            return new Weighing(weights, 0.0, 0.0);
        }
        List<Set<String>> corpusGrams = new ArrayList<>(normalizedCorpus.size());
        for (String text : normalizedCorpus) {
            corpusGrams.add(bigrams(text));
        }
        int total = corpusGrams.size();
        double askableWeight = 0.0;
        double totalWeight = 0.0;
        for (String gram : queryGrams) {
            int documentFrequency = 0;
            for (Set<String> grams : corpusGrams) {
                if (grams.contains(gram)) {
                    documentFrequency++;
                }
            }
            // +0.5 rather than +1, so df=0 stays strictly the heaviest: "nobody wrote this" is the
            // strongest thing a shingle can say, and it is what the askable ratio is measuring.
            double weight = Math.log(1.0 + total / (documentFrequency + 0.5));
            totalWeight += weight;
            if (documentFrequency > 0) {
                weights.put(gram, weight);
                askableWeight += weight;
            }
        }
        return new Weighing(weights, askableWeight,
                totalWeight == 0.0 ? 0.0 : askableWeight / totalWeight);
    }

    /**
     * The longest run of characters the question and this text share, verbatim.
     *
     * <p><b>The signal a bag of shingles cannot carry: that the seller wrote these words TOGETHER.</b>
     * "사용방법" shares a four-character run with a note titled 사용 방법; "배터리충전" shares nothing
     * with a cable-molding library longer than an accidental 시간. Scattered two-character overlaps are
     * what Korean grammar produces against any text at all, and a run is how they are told apart from a
     * phrase the seller actually used.
     *
     * <p>Quadratic in the two lengths, which is fine and only fine because the corpus is one product's
     * own documents — the same bound that lets this whole layer skip an index.
     */
    public static int longestSharedRun(String normalizedQuery, String normalizedContent) {
        if (normalizedQuery.isEmpty() || normalizedContent.isEmpty()) {
            return 0;
        }
        int[] previous = new int[normalizedContent.length() + 1];
        int[] current = new int[normalizedContent.length() + 1];
        int best = 0;
        for (int i = 1; i <= normalizedQuery.length(); i++) {
            for (int j = 1; j <= normalizedContent.length(); j++) {
                current[j] = normalizedQuery.charAt(i - 1) == normalizedContent.charAt(j - 1)
                        ? previous[j - 1] + 1
                        : 0;
                if (current[j] > best) {
                    best = current[j];
                }
            }
            int[] swap = previous;
            previous = current;
            current = swap;
            java.util.Arrays.fill(current, 0);
        }
        return best;
    }

    /**
     * One question, weighed.
     *
     * @param weights       per askable query shingle — the ones this corpus has words for
     * @param askableWeight their total, the denominator {@link #topicCoverage} divides by
     * @param askableRatio  how much of the WHOLE question was askable, in [0,1]. The absence signal:
     *                      low means the question is about something this library does not discuss,
     *                      and no passage should be offered however well it matches the remainder
     */
    public record Weighing(Map<String, Double> weights, double askableWeight, double askableRatio) {

        /** How much of the askable question this passage covers, in [0,1]. The ranking number. */
        public double topicCoverage(String normalizedContent) {
            if (weights.isEmpty() || askableWeight == 0.0) {
                return 0.0;
            }
            Set<String> contentGrams = bigrams(normalizedContent);
            double hit = 0.0;
            for (Map.Entry<String, Double> entry : weights.entrySet()) {
                if (contentGrams.contains(entry.getKey())) {
                    hit += entry.getValue();
                }
            }
            return hit / askableWeight;
        }
    }
}
