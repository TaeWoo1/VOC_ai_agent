package com.sellerops.knowledge;

import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;

/**
 * Splitting a customer's question into the words that can distinguish one passage from another, and
 * dropping the ones that cannot.
 *
 * <p><b>Why this exists at all.</b> Retrieval used to compare overlapping 2-character shingles of the
 * whole question against the corpus, and decide absence from how much of the question the corpus had
 * words for. A Korean question is mostly grammar — "폭이 몇 mm인가요?" carries seven shingles of which
 * five are interrogative scaffolding — so that measure said "this library cannot answer this" about a
 * document that literally reads 내부 폭은 18mm. Measured live on 2026-08-24, before this class existed:
 *
 * <ul>
 *   <li>"폭이 몇 mm인가요?" against a spec note stating the width → <b>0 passages</b>.</li>
 *   <li>"설치는 어떻게 하나요?" against a description stating 간편하게 설치할 수 있습니다 → <b>0</b>.</li>
 *   <li>"교환 반품 기준 알려줘." → <b>0</b>, while "교환 <b>및</b> 반품 기준 알려줘." → 1. One
 *       conjunction decided it, because shingles straddle the word that was removed.</li>
 *   <li>"선바로 방수 되나요?" and "선바로 가격이 얼마인가요?" → <b>1 passage each, score 1.00</b>, from a
 *       description that mentions neither 방수 nor 가격. The product's own name was a 3-character
 *       verbatim run, which was the escape hatch the gate used.</li>
 * </ul>
 *
 * <p>That is the inversion the seller saw: the questions the library could answer returned nothing,
 * and the questions it could not answer returned a citation with full confidence.
 *
 * <p><b>What is dropped, and on what principle.</b> Not "common Korean words" — a frequency stoplist
 * is wrong for any seller whose products make its common words meaningful, and that objection stands.
 * Two narrow classes are dropped, each for a reason that is structural rather than statistical:
 *
 * <ol>
 *   <li><b>Question scaffolding.</b> Interrogatives and polite endings mark a sentence as a question.
 *       They are a closed grammatical class; no seller's note is <em>about</em> 어떻게 or 인가요.</li>
 *   <li><b>Words for the thing we already resolved.</b> Retrieval is scoped to ONE product before it
 *       begins, so 이/그/해당 and 상품/제품/물건 name the subject the caller already fixed. They cannot
 *       tell that product's 교환 정책 from its 사용법. The product's own NAME is dropped by the same
 *       argument and by the same rule ({@link KnowledgeText.Weighing}) — it just is not knowable from
 *       a static list.</li>
 * </ol>
 *
 * <p>Neither class maps one word onto another. Nothing here decides that 반품 and 환불 are the same
 * thing, or that 방수 implies 생활방수 — that is a synonym ontology, it is a different project, and its
 * absence is why a draft says "확인이 어렵습니다" instead of guessing.
 */
final class QueryWords {

    private QueryWords() {
    }

    /**
     * Words that refer to the subject retrieval already fixed, or that mark the sentence as a
     * question. Written out rather than derived, so the whole list is reviewable in one screen.
     */
    private static final Set<String> FUNCTION = Set.of(
            // Deictics and the generic nouns for "the thing being asked about".
            "이", "그", "저", "것", "거", "수", "때", "점", "해당", "여기", "거기",
            "상품", "제품", "물건", "물품",
            // Interrogatives and quantity words that carry no topic of their own.
            "무엇", "무슨", "뭐", "뭔", "언제", "어디", "어느", "어떤", "어떻게", "어떡", "어떠",
            "얼마", "얼만", "왜", "몇", "혹시", "그리고", "그런데", "근데",
            // Openings and requests. A question that begins 안녕하세요 has not said anything yet.
            "안녕하세요", "안녕하십니까", "감사합니다", "감사해요", "수고하세요",
            "문의", "문의드립니다", "문의합니다", "질문", "질문드립니다",
            "알려주세요", "알려줘", "알려주실래요", "부탁드립니다", "부탁드려요",
            "궁금합니다", "궁금해요", "궁금한데요", "확인부탁드립니다");

    /**
     * Polite / interrogative endings, longest first so 습니다 is stripped before 니다.
     *
     * <p>Used only with the stem test below: an ending is evidence of question-shape, never of
     * meaning, and stripping one is not allowed to change which word a token is.
     */
    private static final List<String> ENDINGS = List.of(
            "습니다", "습니까", "합니다", "합니까", "됩니다", "입니다", "이에요", "예요",
            "니다", "니까", "나요", "가요", "까요", "세요", "어요", "아요", "네요",
            "는지", "은지", "인지", "인가", "런가");

    /**
     * Whether this token is scaffolding rather than topic.
     *
     * <p>The ending rule fires only when what remains is a single syllable — "되나요" is 되 + 나요 and
     * says nothing, while "들어가나요" is 들어가 + 나요 and says exactly what was asked. That one
     * condition is what keeps a closed list of endings from eating the question's verb.
     */
    static boolean isFunctionWord(String word) {
        if (word.isEmpty()) {
            return true;
        }
        if (FUNCTION.contains(word)) {
            return true;
        }
        for (String ending : ENDINGS) {
            if (word.length() > ending.length() && word.endsWith(ending)) {
                return word.length() - ending.length() <= 1;
            }
            if (word.equals(ending)) {
                return true;
            }
        }
        return false;
    }

    /**
     * Tails that may be left over when only the head of a query word is found in a passage.
     *
     * <p>Case particles and the handful of 보조사 that follow a noun — a closed grammatical class. Their
     * job here is narrow and load-bearing: they are what separates 폭+이 (the passage wrote 폭은, and
     * this is the same word) from 방+수 (the passage wrote 방법, and this is a coincidence). Without
     * them any 2-character word matched any passage sharing its first syllable, which is how a
     * question about 방수 came back grounded in a note about 방법.
     */
    private static final Set<String> PARTICLE_TAILS = Set.of(
            "은", "는", "이", "가", "을", "를", "의", "에", "도", "만", "과", "와", "로", "으로",
            "에서", "에도", "에는", "에게", "부터", "까지", "마다", "밖에", "조차", "마저",
            "이나", "나", "이란", "란", "이라", "라", "랑", "이랑", "하고", "보다", "처럼", "만큼",
            "이며", "며", "와의", "과의", "인", "님");

    /** Whether what was left over after a partial match is grammar rather than the rest of a word. */
    static boolean isParticleTail(String tail) {
        return PARTICLE_TAILS.contains(tail);
    }

    /**
     * The question, as words.
     *
     * <p>Split on everything that is not a letter or a digit, and again wherever the script changes —
     * "18mm" is a number and a unit, and a question asking 몇 mm has to be able to reach the second
     * half of it. Case is folded; nothing else is rewritten.
     */
    static List<String> split(String raw) {
        List<String> out = new ArrayList<>();
        if (raw == null || raw.isBlank()) {
            return out;
        }
        StringBuilder current = new StringBuilder();
        int currentClass = -1;
        for (char c : raw.toLowerCase(Locale.ROOT).toCharArray()) {
            if (!Character.isLetterOrDigit(c)) {
                flush(out, current);
                currentClass = -1;
                continue;
            }
            int klass = scriptClass(c);
            if (currentClass != -1 && klass != currentClass) {
                flush(out, current);
            }
            currentClass = klass;
            current.append(c);
        }
        flush(out, current);
        return out;
    }

    /** The words of a question that could distinguish one passage from another, in order, deduped. */
    static List<String> content(String raw) {
        Set<String> seen = new LinkedHashSet<>();
        for (String word : split(raw)) {
            if (!isFunctionWord(word)) {
                seen.add(word);
            }
        }
        return List.copyOf(seen);
    }

    private static void flush(List<String> out, StringBuilder current) {
        if (current.length() > 0) {
            out.add(current.toString());
            current.setLength(0);
        }
    }

    /** 0 = Hangul, 1 = digit, 2 = anything else that is a letter (Latin, kana, CJK ideographs). */
    private static int scriptClass(char c) {
        if (Character.UnicodeScript.of(c) == Character.UnicodeScript.HANGUL) {
            return 0;
        }
        return Character.isDigit(c) ? 1 : 2;
    }
}
