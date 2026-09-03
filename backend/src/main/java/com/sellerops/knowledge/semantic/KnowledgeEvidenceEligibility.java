package com.sellerops.knowledge.semantic;

import com.sellerops.agent.access.AgentCapabilityAccess;
import com.sellerops.agent.llm.AgentLlmTransport;
import com.sellerops.knowledge.KnowledgeEligibility;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.stereotype.Service;

/**
 * The door to the evidence-eligibility capability: the organisation gate, one bounded call, and
 * nothing else.
 *
 * <p><b>It runs after ranking, on the passages that would have been shown.</b> Not on the corpus —
 * judging every passage of every library would ask the same question at ten times the price and
 * change nothing, because a passage the scorer already dropped is not going to be quoted. So the
 * cost of this capability is bounded by {@link #MAX_JUDGED} passages per search, and searches that
 * found nothing pay nothing at all.
 *
 * <p><b>It can only refuse.</b> Off, unreachable, over the bound, or silent about a passage — every
 * one of those leaves the result exactly as the scorer left it. Nothing here can add a passage, and
 * nothing here writes anything: the verdict is a boolean, and the only place it is remembered is a
 * bounded in-memory {@link SearchMemo}.
 *
 * <p><b>The memo's key is the question AND the passages as they read</b> (Retrieval Runtime Closure
 * v1 §3), which is exactly the condition under which the verdict cannot have changed: an edited
 * document, a retired source and a new source all change the passage list, and a changed question
 * changes the question. So a seller who presses 「다시 준비하기」 without changing anything pays for
 * the drafter and not for this — and gets the SAME passages, which is the property the holdout
 * measurement found missing (a model called afresh on every search wobbles at the borderline).
 *
 * <p><b>The organisation question is asked once, by the policy</b> — see the note on
 * {@link KnowledgeQuestionIntent}. Flag, key and explicit list stay this capability's own.
 */
@Service
public class KnowledgeEvidenceEligibility {

    /**
     * The most passages one judgement looks at.
     *
     * <p>Above it the search keeps every passage: a judge shown more than it was designed for is a
     * judge whose refusals are worth less than the certainty of the scorer's ranking.
     */
    static final int MAX_JUDGED = 6;

    private final KnowledgeEligibilityProperties properties;
    private final AgentCapabilityAccess access;
    private final KnowledgeEligibilityGenerator generator;
    private final SearchMemo<Map<Integer, Boolean>> memo = new SearchMemo<>();

    public KnowledgeEvidenceEligibility(KnowledgeEligibilityProperties properties,
                                        AgentCapabilityAccess access,
                                        AgentLlmTransport transport) {
        this.properties = properties;
        this.access = access;
        this.generator = new KnowledgeEligibilityGenerator(transport, properties);
    }

    /** A capability that is not present — what a unit test and a context without it get. */
    public static KnowledgeEvidenceEligibility disabled() {
        return new KnowledgeEvidenceEligibility(null, null, null);
    }

    public boolean enabledFor(UUID orgId) {
        if (properties == null) {
            return false;
        }
        return access == null ? properties.isEnabledFor(orgId) : access.allows(properties, orgId);
    }

    /**
     * These passages, minus the ones the judge says do not carry a fact for this question.
     *
     * <p>The list is returned unchanged whenever there is no opinion to be had — the capability is
     * off, the vendor refused, or there are more passages than {@link #MAX_JUDGED}. Callers do not
     * branch on that, which is the point: a judge that did not answer must leave the search exactly
     * as the scorer left it.
     *
     * @param customerWritten whether a CUSTOMER wrote this question — see
     *                        {@code RetrievalQuery#customerWritten()}. <b>Only their questions are
     *                        judged</b> (Retrieval Runtime Closure v1 §4): when a seller types
     *                        「반품 조건」 into their own knowledge library, or the Agent looks up this
     *                        company's own policy for them, the passages are the seller's own
     *                        documents and they asked to see them. A refusal-only model standing
     *                        between a seller and their own library hides what they wrote from the
     *                        person who wrote it — a different failure from the wrong-source citation
     *                        this capability was measured against, and one it cannot help with.
     * @param quotableOf how a passage reads — what would be quoted, so what is judged
     */
    public <T> List<T> filter(UUID orgId, String question, boolean customerWritten, List<T> hits,
                              java.util.function.Function<T, String> quotableOf) {
        if (hits.isEmpty() || !customerWritten) {
            return hits;
        }
        List<String> quotables = new ArrayList<>(hits.size());
        for (T hit : hits) {
            quotables.add(quotableOf.apply(hit));
        }
        KnowledgeEligibility opinion = forQuestion(orgId, question, quotables);
        if (opinion == null) {
            return hits;
        }
        List<T> kept = new ArrayList<>(hits.size());
        for (int i = 0; i < hits.size(); i++) {
            if (opinion.supports(quotables.get(i))) {
                kept.add(hits.get(i));
            }
        }
        return kept;
    }

    /**
     * An opinion on these passages, or null when there is none to be had.
     *
     * @param quotables the passages as they read, in ranked order — the same strings the seller would
     *                  be shown, because what is judged has to be what is quoted
     */
    public KnowledgeEligibility forQuestion(UUID orgId, String question, List<String> quotables) {
        if (!enabledFor(orgId) || question == null || question.isBlank() || quotables.isEmpty()
                || quotables.size() > MAX_JUDGED) {
            return null;
        }
        List<String> asked = new ArrayList<>(new LinkedHashSet<>(quotables));
        Map<Integer, Boolean> verdicts = memo.get(keyFor(question, asked),
                () -> generator.judge(orgId, question, asked));
        if (verdicts.isEmpty()) {
            return null;
        }
        Map<String, Boolean> byText = new HashMap<>();
        for (Map.Entry<Integer, Boolean> verdict : verdicts.entrySet()) {
            byText.put(asked.get(verdict.getKey()), verdict.getValue());
        }
        return quotable -> byText.getOrDefault(quotable, Boolean.TRUE);
    }

    /**
     * What this verdict depends on: the judge model, the question, and the passages as they read.
     *
     * <p>The passage TEXT rather than an id or a version, for the same reason the vector cache is
     * content-addressed: an edited document is a different passage, and a version column would have
     * to be kept in step by hand across two chunk tables and the answer-memory rows.
     */
    private String keyFor(String question, List<String> asked) {
        StringBuilder material = new StringBuilder(properties.model()).append('\n').append(question);
        for (String passage : asked) {
            material.append('\u0000').append(passage);
        }
        return Vectors.sha256(material.toString());
    }

    /** Whether this exact judgement is already paid for — asserted by the reuse test. */
    boolean remembers(String question, List<String> asked) {
        return properties != null && memo.holds(keyFor(question, asked));
    }
}
