package com.sellerops.knowledge;

import java.util.List;
import java.util.Set;

/**
 * Which of a question's words are ABOUT something, and which are addressed to the reader or name the
 * artefact being asked about (Retrieval Query Selection v1, 2026-08-30).
 *
 * <p><b>The defect this closes.</b> The same stored document — 「교환 및 반품 안내」 — was FOUND for the
 * seller's 「반품 조건」 and missed for the planner's 「‘QA 전선몰딩’의 상품 설명/FAQ/정책 문서 중
 * 반품(교환·반품·환불) 조건이 명시된 문장이 있는가」. Traced through the unchanged scorer, the first
 * divergence is the SUBJECT candidate: the seller's subject is 반품 조건 (askable 0.80), the planner's
 * keeps 설명·faq·문서·문장·작성·상품의 as if they were topic words (askable 0.31, 0.14) — and the
 * 8-word cap, taken from the front, then drops 조건 to make room for them. Nothing about 반품 changed;
 * the planner's <em>way of asking</em> was being scored as the question's content.
 *
 * <p><b>Two closed classes, one rule each — not one more stop word per sentence.</b>
 * <ol>
 *   <li><b>INSTRUCTION</b> — verbs and scaffolding addressed to us: 확인·찾아·알려·명시·적혀·있(는지)·
 *       가능·여부·필요. A closed set of STEMS, and a token is an instruction when it is a stem followed
 *       only by grammar: a particle tail ({@link QueryWords#isParticleTail}) or a chain of the closed
 *       verbal endings in {@link #ENDING_PIECES} (돼·되어·있는지·해줘·주세요·한다…). So 명시돼 · 명시된 ·
 *       명시되어 · 명시돼있는지 · 확인해주세요 · 찾아봐줘 are all one stem each and none needs its own
 *       entry — while 확인서 and 설명서, whose remainder is not grammar, stay the nouns they are.</li>
 *   <li><b>META</b> — nouns for the artefact or the party, not the topic: 문서·문장·설명·FAQ·정책·
 *       기준·내용·정보·판매자·회사·작성·등록. A closed set of NOUNS, matched exact or followed by the
 *       same grammar (상품의·문서의·판매자가·작성한·등록된·답변했는지).</li>
 * </ol>
 * Everything else is TOPIC-bearing and is what a candidate is built from. No stem is a prefix rule:
 * a remainder that is not in the closed grammar keeps the token as TOPIC, which is why this cannot eat
 * a customer's noun that happens to start like an instruction.
 *
 * <p><b>What this is not.</b> Not a synonym table (반품 and 환불 stay different words), not a threshold
 * change (every candidate meets the unchanged gates), not a classifier of the question's topic
 * ({@link KnowledgeTopic} does that, and only from the question's own words). It decides which words of
 * a sentence are allowed to count as its question — the same decision {@code QueryWords.FUNCTION}
 * makes for interrogatives, extended to the two classes a planner writes and a customer does not.
 */
final class QueryTokens {

    private QueryTokens() {
    }

    /** What a token is for retrieval. */
    enum Kind { INSTRUCTION, META, TOPIC }

    /**
     * Stems of words addressed to the reader. Requests, confirmations, existence and possibility
     * scaffolding. Matched as stem + grammar only — see {@link #classify}.
     */
    static final Set<String> INSTRUCTION_STEMS = Set.of(
            // Requests.
            "확인", "찾아", "찾", "알려", "알아", "말해", "조회", "검색", "체크", "점검", "파악", "살펴", "보여",
            "봐", "해줘", "주세요", "부탁", "정리", "요약", "보내", "보낸", "보냈",
            // What we said before — the memory lane's own phrasing, asked as a verb.
            "답했", "답한", "했",
            // Being written down.
            "명시", "적혀", "적힌", "나와", "나온", "기재", "기술", "서술", "언급", "표기", "표시", "포함",
            // Existence and possibility.
            "있", "없", "여부", "가능", "필요", "되", "존재");

    /**
     * The grammar a stem may be followed by. Verbal endings, connectives and the existence auxiliary
     * — closed, and combinable: 명시돼있는지 is 명시 + 돼 + 있는지. Never a lone syllable that also forms
     * nouns (서·문·증·용), so 확인서 and 설명서 are not stem + grammar; 해서 and 하고 are pieces, 서 and 고 are not.
     */
    static final List<String> ENDING_PIECES = List.of(
            "돼", "되어", "되", "된", "됐", "되나", "되는", "될",
            "해", "했", "한", "할", "하", "함", "음", "하여", "해서", "하고", "하며", "하면", "하는", "한다",
            "해줘", "해줄래", "해주세요", "해봐", "해야", "줘", "주세요", "줄래", "봐", "봐요", "보기", "본다",
            "는지", "은지", "나요", "는가", "은가", "인가", "인지", "가요", "까요", "니까", "습니까", "습니다", "니다",
            "있는지", "있나요", "있는가", "있는", "있음", "있다", "있어", "있어요", "없는지", "없나요", "없는", "없음",
            "어", "어요", "었", "았", "요", "다", "죠", "지", "라고", "라도", "며", "면", "지만");

    /**
     * Nouns for the artefact being asked about, its author, or the relation — not what it is about.
     * Matched exact, with a particle tail, or with an adjectival ending for the verbal nouns.
     */
    static final Set<String> META_NOUNS = Set.of(
            // The artefact.
            "문서", "문장", "문구", "문안", "글", "설명", "설명문", "안내", "안내문", "faq", "가이드", "매뉴얼",
            "정책", "규정", "기준", "조항", "항목", "내용", "정보", "자료", "근거", "사항", "부분", "대목", "핵심",
            "답변", "질문", "요청",
            // The parties and the subject already fixed.
            "판매자", "고객", "우리", "회사", "상품", "제품", "물건", "물품",
            // Verbal nouns about the artefact.
            "등록", "작성", "관련", "해당",
            // Relations, and the "before" and "what" of a what-did-we-say question — the record, not the topic.
            "대해", "대한", "대하여", "관해", "관한", "통해", "위해", "경우", "때문",
            "예전", "이전", "과거", "전에", "뭐라고", "뭐라", "뭐래", "문의", "리뷰", "사례", "참고");

    /** Which class this (already lower-cased, letter/digit-only) token belongs to. */
    static Kind classify(String word) {
        if (word == null || word.isEmpty()) {
            return Kind.TOPIC;
        }
        for (String stem : INSTRUCTION_STEMS) {
            if (word.startsWith(stem) && isGrammar(word.substring(stem.length()))) {
                return Kind.INSTRUCTION;
            }
        }
        for (String noun : META_NOUNS) {
            if (word.startsWith(noun)) {
                String rest = word.substring(noun.length());
                // A verbal META noun takes the same grammar an instruction does: 작성한 · 등록된 · 답변했는지.
                if (isGrammar(rest)) {
                    return Kind.META;
                }
            }
        }
        return Kind.TOPIC;
    }

    /** Whether this token may carry the question's topic: a TOPIC token of at least two characters. */
    static boolean isTopicBearing(String word) {
        return word != null && word.length() >= 2 && classify(word) == Kind.TOPIC;
    }

    /**
     * Whether {@code rest} is nothing but grammar: empty, a particle tail, or a chain of ending pieces
     * (optionally closed by a particle tail). A small segmentation over a closed list — the only
     * place inflection is handled, so no inflected form ever needs its own entry.
     */
    static boolean isGrammar(String rest) {
        if (rest.isEmpty() || QueryWords.isParticleTail(rest)) {
            return true;
        }
        boolean[] reachable = new boolean[rest.length() + 1];
        reachable[0] = true;
        for (int i = 0; i < rest.length(); i++) {
            if (!reachable[i]) {
                continue;
            }
            for (String piece : ENDING_PIECES) {
                if (rest.startsWith(piece, i)) {
                    reachable[i + piece.length()] = true;
                }
            }
            if (QueryWords.isParticleTail(rest.substring(i))) {
                reachable[rest.length()] = true;
            }
        }
        return reachable[rest.length()];
    }
}
