package com.sellerops.knowledge.semantic;

import com.sellerops.agent.llm.AgentLlmTransport;
import java.time.Duration;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;
import org.springframework.stereotype.Service;

/**
 * The door to the retrieval-intent capability: the organisation gate, one short-lived memo, and
 * nothing else.
 *
 * <p><b>Nothing is stored.</b> The intent is a restatement of a customer's sentence, which makes it
 * a derived copy of customer wording — and this repository keeps exactly one copy of that, in the
 * row the channel wrote. So there is no table here and no column: the memo lives in memory for
 * {@link #TTL}, which exists for one reason that has nothing to do with speed of a second visit —
 * one draft searches THREE lanes (product knowledge, operating policy, past answers) with the same
 * question, and paying a vendor three times for the same sentence would be a defect, not a price.
 *
 * <p>Bounded on both axes: {@link #MAX_ENTRIES} sentences and {@link #TTL}. A process restart loses
 * it and costs one call.
 */
@Service
public class KnowledgeQuestionIntent {

    /** Long enough to cover one seller's draft across its three lanes, short enough to forget. */
    static final Duration TTL = Duration.ofMinutes(5);

    /** How many sentences the memo holds before the oldest is dropped. */
    static final int MAX_ENTRIES = 200;

    private final KnowledgeQuestionIntentProperties properties;
    private final KnowledgeQuestionIntentGenerator generator;
    private final Map<String, Memo> memo = new LinkedHashMap<>();

    private record Memo(String intent, Instant at) {
    }

    public KnowledgeQuestionIntent(KnowledgeQuestionIntentProperties properties,
                                   AgentLlmTransport transport) {
        this.properties = properties;
        this.generator = new KnowledgeQuestionIntentGenerator(transport, properties);
    }

    /** A capability that is not present — what a unit test and a context without it get. */
    public static KnowledgeQuestionIntent disabled() {
        return new KnowledgeQuestionIntent(null, null);
    }

    public boolean enabledFor(UUID orgId) {
        return properties != null && properties.isEnabledFor(orgId);
    }

    /**
     * What this customer sentence needs answered, or null.
     *
     * <p>Null covers every reason there is no restatement — the capability is off for this
     * organisation, the sentence asks for nothing, the vendor refused — because the caller does the
     * same thing in all of them: search the customer's own words, exactly as before.
     */
    public String intentOf(UUID orgId, String question) {
        if (!enabledFor(orgId) || question == null || question.isBlank()) {
            return null;
        }
        String key = Vectors.sha256(question);
        Instant now = Instant.now();
        synchronized (memo) {
            Memo hit = memo.get(key);
            if (hit != null && Duration.between(hit.at(), now).compareTo(TTL) < 0) {
                return hit.intent();
            }
        }
        String intent = generator.intentOf(question);
        synchronized (memo) {
            memo.remove(key);
            memo.put(key, new Memo(intent, now));
            while (memo.size() > MAX_ENTRIES) {
                memo.remove(memo.keySet().iterator().next());
            }
        }
        return intent;
    }
}
