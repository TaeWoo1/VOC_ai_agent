package com.sellerops.product.library;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

/**
 * Splitting a document into quotable passages, and scoring a passage against a question.
 *
 * <p><b>Pure, and therefore checkable.</b> Retrieval that lives in a database function or an external
 * index is retrieval nobody can unit-test and nobody can replay; an answer's evidence has to be
 * reproducible from the same corpus and the same question, or "근거" is a decoration. Everything here
 * is a static function of its inputs.
 *
 * <p><b>Words, matched by prefix, and no morphological analyzer.</b> Korean attaches particles to
 * nouns — 사용법, 사용법을, 사용법은 are one word to a reader and three tokens to any whitespace
 * tokenizer — so a query word matches a passage through the longest PREFIX of it the passage
 * contains. The corpus decides where the stem ends, which needs no dictionary and no extension, and
 * unlike the 2-character shingles this replaced it cannot match a word by straddling the gap between
 * two others. It is a lexical matcher and it is described as one: it finds passages that share
 * wording, and it does not understand them.
 *
 * <p><b>Ranking and absence are different questions.</b> {@link Weighing#askableRatio} answers "can
 * this library speak to this question at all"; {@link Assessment#coverage} answers "which passage
 * covers it best". Collapsing them into one number is what produced the 2026-08-24 inversion recorded
 * on {@link QueryWords}, where every answerable question returned nothing and every unanswerable one
 * returned a citation scored 1.00.
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


    /**
     * How much of {@code word} the text contains, counted from the word's first character.
     *
     * <p><b>The corpus decides where the stem ends, and a particle decides where it may end.</b>
     * Korean attaches particles to the tail of a noun — 폭이, 폭은, 폭의 are one word to a reader — so
     * the part of a query word that can match is a PREFIX of it. Rather than strip a suffix with a
     * morphological guess, this asks the text how much of the word it has. But a prefix alone is not
     * enough: 방수 shares its first syllable with 방법, and counting that is how a molding note came
     * back as evidence about waterproofing. So a PARTIAL match counts only when what was left over is
     * a particle — 폭+이 counts, 설치+는 counts, 방+수 does not.
     *
     * <p>Substring containment, not word-boundary matching, because the passage side is stored without
     * spacing ({@link #normalize}) and because Korean compounds are written closed — a note about
     * 재부착 answers a question about 부착, which is a whole-word match.
     *
     * @return the length of the longest usable prefix of {@code word} in {@code text}; 0 for none
     */
    static int prefixMatch(String word, String text) {
        if (word.isEmpty() || text.isEmpty()) {
            return 0;
        }
        for (int length = Math.min(word.length(), text.length()); length >= 1; length--) {
            if ((length == word.length() || QueryWords.isParticleTail(word.substring(length)))
                    && text.contains(word.substring(0, length))) {
                return length;
            }
        }
        return 0;
    }

    /**
     * The question, weighed against what this product's library actually says.
     *
     * <p><b>Two questions, and they are measured in different units on purpose.</b> The failure this
     * replaced came from making one number answer both "which passage is best" and "is this question
     * answerable here". The second is a threshold, and a threshold on a ratio moves whenever its
     * denominator moves. It did move: the denominator was the part of the question the corpus had
     * words for, so a library that knew LESS about a question produced a HIGHER score for the same
     * passage, and a question naming the product scored 1.00 against a description answering none
     * of it.
     *
     * <ul>
     *   <li><b>Absence</b> — {@link Weighing#askableRatio} — is counted in CHARACTERS of the question's
     *       own content words: how much of what was asked does this library have any words for. No
     *       rarity weighting, because rarity is a statement about which passage, and absence is a
     *       statement about the question. "방수 되나요?" against a molding library is 0.0 whether the
     *       library holds one note or ten.</li>
     *   <li><b>Ranking</b> — {@link Assessment#coverage} — is rarity-weighted, and divides by what the
     *       BEST passage of this library manages for each word rather than by the raw question. A
     *       passage that covers everything reachable scores 1.0; the denominator is identical for
     *       every passage of one search, so no passage can ever be admitted by shrinking it.</li>
     * </ul>
     *
     * <p><b>What a word is worth for ranking.</b> {@code ln((N + 1) / (df + 0.5))} over this product's
     * own passages: a word in every passage distinguishes nothing and is worth almost nothing, a word
     * in one passage is worth the most. Words no passage has are not weighted at all — they have no
     * passage to be matched in, and their whole contribution is to the absence count above.
     *
     * @param query            the customer's question, raw
     * @param normalizedCorpus every passage's searchable text, {@link #normalize}d
     * @param productName      this product's name — dropped from the question for the same reason
     *                         {@code 상품} is, and unknowable from a static list
     */
    public static Weighing weigh(String query, List<String> normalizedCorpus, String productName) {
        String normalizedName = normalize(productName);
        List<Term> terms = new ArrayList<>();
        double askableWeight = 0.0;
        int matchableChars = 0;
        int reachableChars = 0;
        int passages = normalizedCorpus.size();
        for (String word : QueryWords.content(query)) {
            int nameCover = prefixMatch(word, normalizedName);
            if (nameCover >= word.length()) {
                // The question named the product. Retrieval was already scoped to it, so this word
                // separates nothing — and letting it count is what returned a 1.00 citation for
                // "선바로 방수 되나요?" from a description that never mentions 방수.
                continue;
            }
            int documentFrequency = 0;
            int best = 0;
            for (String text : normalizedCorpus) {
                int matched = prefixMatch(word, text) - nameCover;
                if (matched > 0) {
                    documentFrequency++;
                    best = Math.max(best, matched);
                }
            }
            double weight = Math.log((passages + 1.0) / (documentFrequency + 0.5));
            matchableChars += word.length() - nameCover;
            reachableChars += best;
            askableWeight += weight * best;
            terms.add(new Term(word, nameCover, best, weight));
        }
        return new Weighing(List.copyOf(terms), askableWeight,
                matchableChars == 0 ? 0.0 : (double) reachableChars / matchableChars);
    }

    /**
     * One content word of a question, and what this product's library has to say about it.
     *
     * @param word      the word, normalized and lower-cased
     * @param nameCover how much of it the product's own name already explains — never counted as a hit
     * @param best      the most any one passage matches of it, once the name is discounted; 0 means
     *                  nobody wrote this word and no passage can earn anything for it
     * @param weight    its rarity across this product's passages
     */
    record Term(String word, int nameCover, int best, double weight) {

        /** Whether any passage has words for this one at all. */
        boolean askable() {
            return best > 0;
        }
    }

    /**
     * One question, weighed.
     *
     * @param terms         its content words, in order
     * @param askableWeight the mass of what the best passages reach — {@link Assessment#coverage}'s
     *                      denominator, identical for every passage of this search
     * @param askableRatio  the share of the question's content CHARACTERS this library has any words
     *                      for, in [0,1]. The absence signal, and the only place the unanswerable part
     *                      of a question is allowed to count
     */
    public record Weighing(List<Term> terms, double askableWeight, double askableRatio) {

        /** How well one passage answers the reachable part of the question. */
        public Assessment assess(String normalizedContent) {
            if (terms.isEmpty() || askableWeight == 0.0) {
                return new Assessment(0.0, 0);
            }
            double hit = 0.0;
            int matchedChars = 0;
            for (Term term : terms) {
                if (!term.askable()) {
                    continue;
                }
                int matched = Math.min(term.best(),
                        Math.max(0, prefixMatch(term.word(), normalizedContent) - term.nameCover()));
                if (matched == 0) {
                    continue;
                }
                matchedChars += matched;
                hit += term.weight() * matched;
            }
            return new Assessment(hit / askableWeight, matchedChars);
        }
    }

    /**
     * What one passage is worth to one question.
     *
     * @param coverage     the share of the reachable question this passage covers, in [0,1] — ranking
     * @param matchedChars how many characters of the question's own words it actually shares. An
     *                     absolute count, so a one-syllable coincidence cannot become a citation just
     *                     because the rest of the question was thrown away
     */
    public record Assessment(double coverage, int matchedChars) {
    }
}
