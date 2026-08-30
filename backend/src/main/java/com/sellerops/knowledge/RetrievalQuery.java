package com.sellerops.knowledge;

import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;

/**
 * The bounded set of query candidates one question is searched as — shared by the product library,
 * the operating rules and the answer memory (Retrieval &amp; Grounding Correctness v1, 2026-08-30).
 *
 * <p><b>Why candidates, not one string.</b> {@link KnowledgeRetriever}'s absence gate is a ratio over
 * the question's content words: how many characters of what was asked does the corpus have any word
 * for. It is the right gate for a customer's question — 「방수 되나요?」 against a molding library is
 * rightly 0.0 — and the wrong input is a sentence that is mostly not the question: a title glued to a
 * body glued to a planner's instruction (「…명시돼 있는지 확인해줘」) carries a dozen content words no
 * note contains, and the ratio sinks under them although the two words that matter are right there.
 * Live (2026-08-29): 「반품 조건」 found the product's own 「교환 및 반품 안내」 at 1.0, and the planner's
 * sentence about the same document found nothing. Lowering the ratio would admit every coincidence;
 * the fix is to ask the SAME question in shorter forms and let the same gates judge each.
 *
 * <p><b>The candidates, in the order they are tried.</b>
 * <ol>
 *   <li>{@code TOPIC} — a structured topic the caller already resolved (a plan filter, a routed noun).
 *       The narrowest statement of what is asked; nothing to normalize.</li>
 *   <li>{@code TITLE} — the inquiry's subject line. A seller-facing field that is usually the
 *       question itself, without the greeting and the thread.</li>
 *   <li>{@code SUBJECT} — the head of the question with its scaffolding removed: function words,
 *       polite endings ({@link QueryWords}) and, new here, the closed list of INSTRUCTION words a
 *       seller or a planner addresses to us rather than to the topic (「확인해줘」, 「명시돼 있는지」,
 *       「가능한」). At most {@link #SUBJECT_WORDS} words, taken from the front, where the question is.</li>
 *   <li>{@code FULL} — the title and the head of the body as one string, bounded to
 *       {@link #FULL_CHARS}. The form the retriever was always given; kept last so a short question the
 *       subject rule over-trimmed is still asked whole.</li>
 * </ol>
 * Identical texts collapse, blanks are skipped, and there are never more than four. Every candidate
 * goes through the unchanged gates; a candidate cannot lower a threshold, only phrase the question
 * the way the corpus could have been written about.
 *
 * <p>No model is asked for keywords and no morphological service is called: {@link #SUBJECT_STOP}
 * is a reviewable list, like {@code QueryWords.FUNCTION} beside it.
 */
public final class RetrievalQuery {

    /** How much of title+body the FULL candidate carries. Same bound the draft lane always used. */
    public static final int FULL_CHARS = 400;
    /** How many content words the SUBJECT candidate keeps, from the front of the question. */
    public static final int SUBJECT_WORDS = 8;
    /** The most candidates one question is searched as. */
    public static final int MAX_CANDIDATES = 4;

    /** Where a candidate came from — reported with the outcome so a hit can say which form found it. */
    public enum Origin { TOPIC, TITLE, SUBJECT, FULL }

    /** One form of the question. */
    public record Candidate(String text, Origin origin) {
    }

    /**
     * Words addressed to the reader rather than to the topic. Removing them from the SUBJECT
     * candidate cannot change what the question is about; keeping them is what made a planner's
     * sentence about a return policy fail the absence gate on 확인·명시·가능·있는지.
     */
    static final Set<String> SUBJECT_STOP = Set.of(
            // Requests and confirmations.
            "확인", "확인해줘", "확인해", "확인해주세요", "확인부탁", "체크", "알려", "알려줘", "말해", "말해줘",
            "찾아", "찾아줘", "찾아봐", "조회", "검색", "봐줘", "봐", "해줘", "해주세요", "주세요", "부탁",
            // Existence and possibility scaffolding.
            "있는지", "없는지", "있나요", "없나요", "있는", "없는", "여부", "가능", "가능한", "가능한지",
            "명시", "명시돼", "명시된", "적혀", "나와", "나오는", "되는지", "되나요", "인지", "필요", "필요한",
            // Meta nouns for the artefact being asked about, not its topic.
            "내용", "정보", "관련", "답변", "질문", "기준", "정책", "규정", "안내", "판매자", "고객", "우리",
            "회사", "등록", "등록된");

    private final List<Candidate> candidates;

    private RetrievalQuery(List<Candidate> candidates) {
        this.candidates = List.copyOf(candidates);
    }

    /** The candidates, in the order they are to be tried. Never empty for a non-blank question. */
    public List<Candidate> candidates() {
        return candidates;
    }

    /** The FULL form — what a response echoes as {@code query} when no candidate matched. */
    public String full() {
        for (Candidate c : candidates) {
            if (c.origin() == Origin.FULL) {
                return c.text();
            }
        }
        return candidates.isEmpty() ? "" : candidates.get(candidates.size() - 1).text();
    }

    /** The question as one string, for the caller that needs to classify or log it. */
    public String text() {
        return full();
    }

    /**
     * The candidates for an inquiry: an optional resolved topic, the title, the subject, the whole.
     *
     * @param topic  a structured topic already resolved by the caller, or null
     * @param title  the inquiry's subject line, or null
     * @param body   the inquiry's body (plain text), or null
     */
    public static RetrievalQuery of(String topic, String title, String body) {
        List<Candidate> out = new ArrayList<>();
        Set<String> seen = new LinkedHashSet<>();
        String cleanTitle = clean(title);
        String cleanBody = clean(body);
        String full = bound((cleanTitle + " " + cleanBody).strip(), FULL_CHARS);
        add(out, seen, clean(topic), Origin.TOPIC);
        add(out, seen, bound(cleanTitle, 120), Origin.TITLE);
        add(out, seen, subjectOf(full), Origin.SUBJECT);
        add(out, seen, full, Origin.FULL);
        return new RetrievalQuery(out);
    }

    /** The candidates for free text — a planner's need sentence, a screen's search box. */
    public static RetrievalQuery ofText(String text) {
        return of(null, null, text);
    }

    /** A single form, tried as itself — for callers that already hold the exact query. */
    public static RetrievalQuery exact(String text) {
        List<Candidate> out = new ArrayList<>();
        add(out, new LinkedHashSet<>(), clean(text), Origin.FULL);
        return new RetrievalQuery(out);
    }

    /**
     * The head of the question as topic words only.
     *
     * <p>Package-visible so the tests can pin the rule on sentences; not an API.
     */
    static String subjectOf(String text) {
        List<String> words = new ArrayList<>();
        for (String word : QueryWords.content(text)) {
            if (SUBJECT_STOP.contains(word) || word.length() < 2) {
                continue;
            }
            words.add(word);
            if (words.size() >= SUBJECT_WORDS) {
                break;
            }
        }
        return String.join(" ", words);
    }

    /**
     * The words of a question that are about a TOPIC once the subject the caller already fixed (a
     * product's name) and the closed phrasing of a "what did we say before" request are removed.
     *
     * <p>Empty means the question named no topic — 「이 상품에 예전에 뭐라고 답했어」 — and a store that
     * is anchored on the subject may answer it by listing rather than by matching. Non-empty means the
     * question IS about something, and a lexical miss on it stays a miss.
     */
    public static List<String> residualTopicWords(String text, String discountedSubject, Set<String> extraStop) {
        String subject = KnowledgeText.normalize(discountedSubject == null ? "" : discountedSubject);
        List<String> out = new ArrayList<>();
        for (String word : QueryWords.content(text)) {
            if (SUBJECT_STOP.contains(word) || word.length() < 2) {
                continue;
            }
            if (extraStop != null && extraStop.stream().anyMatch(word::startsWith)) {
                continue;
            }
            if (!subject.isEmpty() && KnowledgeText.prefixMatch(word, subject) >= word.length()) {
                continue;
            }
            out.add(word);
        }
        return List.copyOf(out);
    }

    private static void add(List<Candidate> out, Set<String> seen, String text, Origin origin) {
        if (text == null || text.isBlank() || out.size() >= MAX_CANDIDATES) {
            return;
        }
        String key = KnowledgeText.normalize(text);
        if (key.isBlank() || !seen.add(key)) {
            return;
        }
        out.add(new Candidate(text, origin));
    }

    private static String clean(String text) {
        return text == null ? "" : text.replaceAll("\\s+", " ").strip();
    }

    private static String bound(String text, int max) {
        return text.length() > max ? text.substring(0, max) : text;
    }
}
