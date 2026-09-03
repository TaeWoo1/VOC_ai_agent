package com.sellerops.knowledge;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Set;

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

    /** Below this a fragment is not a claim of its own; it is folded into its neighbour. */
    static final int MIN_SENTENCE_CHARS = 12;

    /**
     * The units a TITLED passage is compared in: its title, carried on each of its sentences.
     *
     * <p>The passage arrives as its document's title, a newline, then the passage — the form the
     * lanes hand over. The title is prefixed to every unit for the same reason the lexical scorer
     * matches it with the passage: a seller writes the topic in the title (「규격 안내」) and never
     * repeats it in the body, so a sentence compared without it is a sentence about nothing in
     * particular. Measured: 「두께가 생각보다 얇아 아쉬웠습니다」 finds the spec note when its sentences
     * carry 「규격 안내」 and misses it when they do not.
     */
    public static List<String> comparableUnits(String titledPassage) {
        if (titledPassage == null || titledPassage.isBlank()) {
            return List.of();
        }
        int newline = titledPassage.indexOf('\n');
        if (newline < 0) {
            return sentences(titledPassage);
        }
        String title = titledPassage.substring(0, newline).strip();
        String body = titledPassage.substring(newline + 1);
        List<String> out = new ArrayList<>();
        for (String sentence : sentences(body)) {
            out.add(title.isEmpty() ? sentence : title + "\n" + sentence);
        }
        return out.isEmpty() ? List.of(titledPassage.strip()) : List.copyOf(out);
    }

    /**
     * One passage, as the units it is COMPARED in.
     *
     * <p><b>A quotable passage and a comparable unit are different sizes.</b> A passage is sized for a
     * seller to read as evidence — a FAQ question with its answer, a policy paragraph. Embedded whole,
     * a 400-character paragraph gives one vector for four claims, and a short question about one of
     * them is compared against the average of all four. Measured on the benchmark corpus: 「두께」
     * against a paragraph stating three thicknesses scored 0.310, and against the colour note beside
     * it 0.306 — the same number, because to a whole-paragraph vector both are «a paragraph about this
     * molding». Split into sentences the same question separates them, and the passage the seller is
     * shown does not change: a passage scores what its best sentence scores.
     *
     * <p>Never empty for a non-blank passage, so a caller can always ask.
     */
    public static List<String> sentences(String passage) {
        List<String> out = new ArrayList<>();
        if (passage == null || passage.isBlank()) {
            return out;
        }
        StringBuilder current = new StringBuilder();
        for (String raw : passage.split("(?<=[.!?])\\s+|\\n+")) {
            String piece = raw.strip();
            if (piece.isEmpty()) {
                continue;
            }
            if (current.length() > 0 && current.length() < MIN_SENTENCE_CHARS) {
                current.append(' ').append(piece);
                continue;
            }
            if (current.length() > 0) {
                out.add(current.toString());
                current.setLength(0);
            }
            current.append(piece);
        }
        if (current.length() > 0) {
            if (current.length() < MIN_SENTENCE_CHARS && !out.isEmpty()) {
                out.set(out.size() - 1, out.get(out.size() - 1) + " " + current);
            } else {
                out.add(current.toString());
            }
        }
        return out.isEmpty() ? List.of(passage.strip()) : List.copyOf(out);
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
            String tail = word.substring(length);
            boolean ending = length >= 2 && QueryWords.isEndingTail(tail);
            if ((length == word.length() || QueryWords.isParticleTail(tail) || ending)
                    && text.contains(word.substring(0, length))) {
                return length;
            }
            // The formal ending: a vowel-final stem takes ㅂ as its batchim before 니다 (들어가 → 들어갑니다,
            // 걸리 → 걸립니다). One closed conjugation rule of Hangul arithmetic, so the customer's
            // 「들어가나요」 meets the seller's 「들어갑니다」 the way 폭+이 meets 폭은.
            if (ending && text.contains(withBieupBatchim(word.substring(0, length)) + "니다")) {
                return length;
            }
        }
        return 0;
    }

    /** The stem with ㅂ added as the final consonant of its last syllable; unchanged when that syllable already has one. */
    private static String withBieupBatchim(String stem) {
        char last = stem.charAt(stem.length() - 1);
        if (last < 0xAC00 || last > 0xD7A3 || (last - 0xAC00) % 28 != 0) {
            return stem;
        }
        return stem.substring(0, stem.length() - 1) + (char) (last + 17);
    }

    /**
     * The topic-alias match (Captured Knowledge Reuse Robustness v1): a query word that IS a word of the
     * question's one operating topic (배송) meets a passage that states the same topic in a sibling
     * word (출고 · 발송 · 택배). Closed on both sides — the word must be exactly a {@link KnowledgeTopic}
     * vocabulary entry once its particle is removed, and {@code topic} is passed only when the question
     * names exactly one topic — so 「반품 배송비」 (two topics) expands nothing, and 배송비 (not a
     * vocabulary word) expands nothing.
     *
     * @return the stem's length when the alias applies; 0 otherwise
     */
    static int aliasMatch(String word, String normalizedText, KnowledgeTopic topic) {
        if (topic == null || word.isEmpty()) {
            return 0;
        }
        for (int length = word.length(); length >= 2; length--) {
            if (length != word.length() && !QueryWords.isParticleTail(word.substring(length))) {
                continue;
            }
            String stem = word.substring(0, length);
            if (KnowledgeTopic.ofWord(stem) == topic) {
                return topic.mentionedIn(normalizedText) ? length : 0;
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
        int conceptChars = 0;
        int passages = normalizedCorpus.size();
        // Captured Knowledge Reuse Robustness v1: a topic alias applies only when the question names
        // exactly ONE operating topic — a question about 반품 배송비 is not about shipping alone.
        Set<KnowledgeTopic> asked = KnowledgeTopic.of(query);
        KnowledgeTopic aliasTopic = asked.size() == 1 ? asked.iterator().next() : null;
        List<Set<String>> statedUnits = normalizedCorpus.stream().map(QuantityTokens::statedUnits).toList();
        for (String word : QueryWords.content(query)) {
            int nameCover = prefixMatch(word, normalizedName);
            if (nameCover >= word.length()
                    || (nameCover > 0 && QueryWords.isParticleTail(word.substring(nameCover)))) {
                // The question named the product (전선몰딩, or 전선이 with its particle). Retrieval was
                // already scoped to it, so this word separates nothing — and letting it count is what
                // returned a 1.00 citation for "선바로 방수 되나요?" from a description that never
                // mentions 방수; letting its PARTICLE stay in the denominator is what sank 「몰딩 안에
                // 전선이 몇 가닥」 to 0.33 against the note that answers it.
                continue;
            }
            String unit = QuantityTokens.unitOf(word);
            if (unit != null) {
                // A quantity CONCEPT (며칠 · mm · 가닥까지): reachable wherever a passage states a
                // figure in that unit, and counted only beside a real match (see Weighing).
                int documentFrequency = 0;
                for (Set<String> units : statedUnits) {
                    if (units.contains(unit)) {
                        documentFrequency++;
                    }
                }
                int best = documentFrequency > 0 ? word.length() : 0;
                double weight = Math.log((passages + 1.0) / (documentFrequency + 0.5));
                matchableChars += word.length();
                conceptChars += best;
                askableWeight += weight * best;
                terms.add(new Term(word, 0, best, weight, unit));
                continue;
            }
            int documentFrequency = 0;
            int best = 0;
            for (String text : normalizedCorpus) {
                int matched = Math.max(prefixMatch(word, text), aliasMatch(word, text, aliasTopic)) - nameCover;
                if (matched > 0) {
                    documentFrequency++;
                    best = Math.max(best, matched);
                }
            }
            double weight = Math.log((passages + 1.0) / (documentFrequency + 0.5));
            matchableChars += word.length() - nameCover;
            reachableChars += best;
            askableWeight += weight * best;
            terms.add(new Term(word, nameCover, best, weight, null));
        }
        // Concept matches are supplementary: they raise the ratio only when the corpus already has a
        // real word for the question. A corpus whose only overlap is a unit has no words for it.
        int reached = reachableChars + (reachableChars > 0 ? conceptChars : 0);
        // 「몇 가닥」 is a quantity question about 가닥; a passage that states 3가닥 answers it whatever else
        // the question said around it (안에 · 들어가나요). The noun itself is still a real term above, so a
        // passage without it scores nothing; this only says the corpus HAS the asked fact.
        boolean figureAnswered = false;
        for (String noun : QuantityTokens.countedNouns(query)) {
            for (String text : normalizedCorpus) {
                if (QuantityTokens.statesFigureOf(text, noun)) {
                    figureAnswered = true;
                }
            }
        }
        return new Weighing(List.copyOf(terms), askableWeight, aliasTopic, figureAnswered,
                matchableChars == 0 ? 0.0 : (double) reached / matchableChars);
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
    record Term(String word, int nameCover, int best, double weight, String unit) {

        /** Whether any passage has words for this one at all. */
        boolean askable() {
            return best > 0;
        }

        /** A quantity concept (며칠 · mm · 가닥까지) rather than a lexical word — supplementary only. */
        boolean concept() {
            return unit != null;
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
    public record Weighing(List<Term> terms, double askableWeight, KnowledgeTopic aliasTopic,
                           boolean figureAnswered, double askableRatio) {

        /**
         * Whether the corpus has words for the question: the character ratio over its content words, or a
         * stated figure of the count noun it asked 몇 of (Captured Knowledge Reuse Robustness v1).
         */
        public boolean askable(double minRatio) {
            return figureAnswered || askableRatio >= minRatio;
        }

        /** How well one passage answers the reachable part of the question. */
        public Assessment assess(String normalizedContent) {
            if (terms.isEmpty() || askableWeight == 0.0) {
                return new Assessment(0.0, 0);
            }
            double hit = 0.0;
            int matchedChars = 0;
            // Real words first; a concept (며칠 · mm) counts for THIS passage only when the passage
            // already matched a real word — a figure in the right unit is not, alone, an answer.
            for (Term term : terms) {
                if (!term.askable() || term.concept()) {
                    continue;
                }
                int matched = Math.min(term.best(), Math.max(0,
                        Math.max(prefixMatch(term.word(), normalizedContent),
                                aliasMatch(term.word(), normalizedContent, aliasTopic)) - term.nameCover()));
                if (matched == 0) {
                    continue;
                }
                matchedChars += matched;
                hit += term.weight() * matched;
            }
            if (matchedChars > 0) {
                Set<String> units = null;
                for (Term term : terms) {
                    if (!term.askable() || !term.concept()) {
                        continue;
                    }
                    if (units == null) {
                        units = QuantityTokens.statedUnits(normalizedContent);
                    }
                    if (units.contains(term.unit())) {
                        matchedChars += term.best();
                        hit += term.weight() * term.best();
                    }
                }
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
