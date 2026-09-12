package com.sellerops.agent.llm.converse;

import com.sellerops.agent.access.AgentCapabilityAccess;
import com.sellerops.agent.llm.AgentLlmTransport;
import com.sellerops.agent.llm.operator.AgentLlmWireFormat;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

/**
 * The ONE door to the conversation model — and the last gate on what may be said to it.
 *
 * <p>Beyond the org policy this door carries {@link ConverseRequestFloor}, for the reason the judge's
 * door carries {@code EvidenceDigestFloor}: this capability's input is assembled by a caller holding a
 * whole turn's state, and "assembled by a caller" is exactly how a customer's sentence ends up
 * somewhere it was never meant to be. A request that fails the floor is REFUSED here — not truncated,
 * not masked — and the deterministic composer answers instead.
 *
 * <p>It reads nothing and writes nothing: no work item is looked up, no state moves, nothing is stored.
 */
@Service
public class AgentConverseService {

    private static final Logger log = LoggerFactory.getLogger(AgentConverseService.class);

    private final AgentConverseProperties properties;
    private final AgentLlmTransport transport;
    private final AgentCapabilityAccess access;

    public AgentConverseService(AgentConverseProperties properties, AgentLlmTransport transport,
                                AgentCapabilityAccess access) {
        this.properties = properties;
        this.transport = transport;
        this.access = access;
    }

    public String versionFor(UUID orgId) {
        return access.allows(properties, orgId) ? generator().version() : null;
    }

    /**
     * <b>Why there is no answer, as a closed token beside the answer itself.</b>
     *
     * The caller used to get {@code Optional.empty()} for every one of these and composed the same
     * fallback for all of them — which is correct for four of the five and wrong for the fifth. A model
     * that read the whole fact sheet and returned {@code answered:false} has said something a seller
     * needs to hear: the product facts we hold do not answer this. A capability that is off has said
     * nothing at all. Merging them made the second look like the first, so 「직원이랑 같이 써도 돼?」 was
     * answered with a summary of what the product does.
     */
    public enum Reason {
        /** The answer is present. */
        OK,
        /** Not configured for this organisation — the caller composes its own answer, as before. */
        NOT_ENABLED,
        /** The request was not the shape this capability may send. Ours to fix, never the seller's. */
        REQUEST_REFUSED,
        /** The model read the facts and said they do not answer the question. */
        NO_BASIS,
        /** The vendor could not be reached, or answered something unusable. */
        UNAVAILABLE,
    }

    /** One turn's outcome: the answer when there is one, and always the reason. */
    public record Outcome(Optional<String> answer, Reason reason) {
        static Outcome of(Reason reason) {
            return new Outcome(Optional.empty(), reason);
        }
    }

    /** Answer one conversational turn from the facts given, or say why not. */
    public Outcome converse(UUID orgId, String question, List<String> facts,
                            List<String> context, List<String> recentTurns) {
        if (!access.allows(properties, orgId)) {
            return Outcome.of(Reason.NOT_ENABLED);
        }
        if (!ConverseRequestFloor.isSafe(question, facts, context, recentTurns)) {
            // Counted and named, never quoted — the refused payload is the one thing that must not be logged.
            log.warn("agent_converse orgId={} answered=false reason=request_floor_refused", orgId);
            return Outcome.of(Reason.REQUEST_REFUSED);
        }
        AgentConverseGenerator.Result result = generator().generate(
                new AgentConverseGenerator.Input(facts, context, recentTurns, question));
        // Metadata only — never the question, never the answer, never a fact line.
        log.info("agent_converse orgId={} answered={} reason={} facts={} turns={} ms={} promptTokens={} "
                        + "completionTokens={} reasoningTokens={}", orgId,
                result.answer().isPresent(), result.reason(), facts.size(), recentTurns.size(),
                result.metrics().elapsedMs(), result.metrics().promptTokens(),
                result.metrics().completionTokens(), result.metrics().reasoningTokens());
        // `not_answered` and `empty_answer` are the model's own refusal over a full sheet; everything
        // else on this path is a vendor or parsing failure, which is not a fact about the product.
        return result.answer()
                .map(a -> new Outcome(Optional.of(a.text()), Reason.OK))
                .orElseGet(() -> Outcome.of(
                        "not_answered".equals(result.reason()) || "empty_answer".equals(result.reason())
                                ? Reason.NO_BASIS : Reason.UNAVAILABLE));
    }

    private AgentConverseGenerator generator() {
        return new AgentConverseGenerator(transport, AgentLlmWireFormat.Vendor.of(properties.vendor()),
                properties.model(), properties.apiKey(), properties.maxOutputTokens(),
                properties.reasoningEffort());
    }
}
