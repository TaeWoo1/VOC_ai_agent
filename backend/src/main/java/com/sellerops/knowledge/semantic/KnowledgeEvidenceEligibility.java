package com.sellerops.knowledge.semantic;

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
 * nothing here writes anything: the verdict is a boolean that lives for the length of one search.
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
    private final KnowledgeEligibilityGenerator generator;

    public KnowledgeEvidenceEligibility(KnowledgeEligibilityProperties properties,
                                        AgentLlmTransport transport) {
        this.properties = properties;
        this.generator = new KnowledgeEligibilityGenerator(transport, properties);
    }

    /** A capability that is not present — what a unit test and a context without it get. */
    public static KnowledgeEvidenceEligibility disabled() {
        return new KnowledgeEvidenceEligibility(null, null);
    }

    public boolean enabledFor(UUID orgId) {
        return properties != null && properties.isEnabledFor(orgId);
    }

    /**
     * These passages, minus the ones the judge says do not carry a fact for this question.
     *
     * <p>The list is returned unchanged whenever there is no opinion to be had — the capability is
     * off, the vendor refused, or there are more passages than {@link #MAX_JUDGED}. Callers do not
     * branch on that, which is the point: a judge that did not answer must leave the search exactly
     * as the scorer left it.
     *
     * @param quotableOf how a passage reads — what would be quoted, so what is judged
     */
    public <T> List<T> filter(UUID orgId, String question, List<T> hits,
                              java.util.function.Function<T, String> quotableOf) {
        if (hits.isEmpty()) {
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
        Map<Integer, Boolean> verdicts = generator.judge(question, asked);
        if (verdicts.isEmpty()) {
            return null;
        }
        Map<String, Boolean> byText = new HashMap<>();
        for (Map.Entry<Integer, Boolean> verdict : verdicts.entrySet()) {
            byText.put(asked.get(verdict.getKey()), verdict.getValue());
        }
        return quotable -> byText.getOrDefault(quotable, Boolean.TRUE);
    }
}
