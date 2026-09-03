package com.sellerops.knowledge.semantic;

import com.sellerops.agent.access.AgentCapabilityAccess;
import com.sellerops.agent.llm.AgentLlmTransport;
import java.util.UUID;
import org.springframework.stereotype.Service;

/**
 * The door to the retrieval-intent capability: the organisation gate, one memo, and nothing else.
 *
 * <p><b>Nothing is stored.</b> The intent is a restatement of a customer's sentence, which makes it
 * a derived copy of customer wording — and this repository keeps exactly one copy of that, in the
 * row the channel wrote. So there is no table here and no column: the memo is
 * {@link SearchMemo}, keyed by the model and the sentence, bounded on both axes.
 *
 * <p><b>Why the memo exists, and what it is not.</b> One draft searches THREE lanes (product
 * knowledge, operating policy, past answers) with the same question, and paying a vendor three times
 * for the same sentence is a defect rather than a price. It is NOT where the product's consistency
 * comes from — a saved draft version's evidence is fixed because it is written down beside that
 * version and read back on reopen ({@code docs/retrieval_runtime_closure_v1.md} §1).
 *
 * <p><b>The organisation question is asked once, by the policy.</b> Retrieval Runtime Closure v1 §5:
 * this used to read its own allow-list directly, so a pilot host running
 * {@code SELLEROPS_AGENT_ACCESS_SCOPE=CONNECTED_SELLERS} could have this capability's flag and key
 * set and reach no organisation at all — a switch that did nothing and said nothing. The flag, the
 * key and the explicit list stay this capability's own; only "is this organisation part of this
 * deployment's audience" is answered in one place.
 */
@Service
public class KnowledgeQuestionIntent {

    private final KnowledgeQuestionIntentProperties properties;
    private final AgentCapabilityAccess access;
    private final KnowledgeQuestionIntentGenerator generator;
    private final SearchMemo<String> memo = new SearchMemo<>();

    public KnowledgeQuestionIntent(KnowledgeQuestionIntentProperties properties,
                                   AgentCapabilityAccess access, AgentLlmTransport transport) {
        this.properties = properties;
        this.access = access;
        this.generator = new KnowledgeQuestionIntentGenerator(transport, properties);
    }

    /** A capability that is not present — what a unit test and a context without it get. */
    public static KnowledgeQuestionIntent disabled() {
        return new KnowledgeQuestionIntent(null, null, null);
    }

    public boolean enabledFor(UUID orgId) {
        if (properties == null) {
            return false;
        }
        return access == null ? properties.isEnabledFor(orgId) : access.allows(properties, orgId);
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
        // The model is part of the key: an operator who changes it is asking for a different answer.
        String key = Vectors.sha256(properties.model() + "\n" + question);
        return memo.get(key, () -> generator.intentOf(orgId, question));
    }

    /** Whether this sentence's restatement is already paid for — asserted by the reuse test. */
    boolean remembers(String question) {
        return properties != null
                && memo.holds(Vectors.sha256(properties.model() + "\n" + question));
    }
}
