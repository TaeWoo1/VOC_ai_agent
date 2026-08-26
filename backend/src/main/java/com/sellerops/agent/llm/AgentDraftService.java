package com.sellerops.agent.llm;

import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

/**
 * The ONE door to the draft model — the {@code ReviewTriageChannelGate} of this capability.
 *
 * <p>The org check sits at the boundary rather than in a caller's memory, and
 * {@code AgentDraftBoundaryTest} asserts that nothing else in {@code main} constructs an
 * {@link AgentDraftGenerator} or holds an {@link AgentLlmTransport}. That is the same mechanism the
 * triage package uses and it is protecting the same thing: a future service that held the generator
 * directly would be an allow-list nobody runs, and the seller's inquiry body would leave for an org
 * that never opted in.
 *
 * <p><b>Off is not an error.</b> A disabled deployment, an org outside the allow-list, and a missing
 * key all return {@link Optional#empty()}, and the caller renders the deterministic rule draft. The
 * capability degrading into the shipped behaviour is the design, not a fault to report.
 */
@Service
public class AgentDraftService {

    private static final Logger log = LoggerFactory.getLogger(AgentDraftService.class);

    private final AgentDraftProperties properties;
    private final AgentLlmTransport transport;

    public AgentDraftService(AgentDraftProperties properties, AgentLlmTransport transport) {
        this.properties = properties;
        this.transport = transport;
    }

    /** Whether this org may reach the model at all — the honest capability answer for a UI. */
    public boolean isEnabledFor(UUID orgId) {
        return properties.isEnabledFor(orgId);
    }

    /** The version string a run records, or null when the capability is off for this org. */
    public String versionFor(UUID orgId) {
        return properties.isEnabledFor(orgId) ? generator().version() : null;
    }

    /**
     * Generate a starter draft for one inquiry, or nothing.
     *
     * <p>The log line is coarse by construction: an org id, a boolean and a reason marker. The title,
     * the body, the generated draft, and any vendor text are never logged — this is the one method in
     * the backend that holds all of them at once.
     */
    public Optional<AgentDraftResponseParser.ParsedDraft> draft(UUID orgId, String title, String details) {
        return draft(orgId, title, details, List.of());
    }

    /**
     * The grounded form: the same call, plus the seller's own retrieved product knowledge.
     *
     * <p>The passage count is logged and the passage TEXT is not — the same rule the title and body
     * have always been under. Knowing that a run was grounded in two passages is an operational fact;
     * knowing what they said is the seller's business.
     */
    public Optional<AgentDraftResponseParser.ParsedDraft> draft(
            UUID orgId, String title, String details, List<AgentDraftGenerator.Passage> knowledge) {
        return draft(orgId, title, details, knowledge, null);
    }

    /**
     * The grounded form, plus the one sentence that says what is known about the order.
     *
     * <p>{@code orderState} is a product constant — a confirmed state or the reason there is none —
     * and never an order id. It is passed because a drafter that is told nothing about the order
     * infers it may reason about one from the customer's message, which is how "곧 발송됩니다"
     * appears in a reply written from no order data at all.
     */
    public Optional<AgentDraftResponseParser.ParsedDraft> draft(
            UUID orgId, String title, String details, List<AgentDraftGenerator.Passage> knowledge,
            String orderState) {
        return draft(orgId, title, details, knowledge, orderState, null);
    }

    /**
     * The grounded form, plus the one sentence that says whether a retrieved figure may be closed with.
     *
     * <p>{@code specScope} is a product constant from
     * {@link com.sellerops.inquiry.draft.SpecApplicability} — whether this question's answer can move
     * with the 규격·옵션 chosen and whether one is determined — and it never names an option. It is
     * passed for the reason {@code orderState} is: a drafter told only that a passage matched will
     * state that passage's number as this customer's fact, which is how a product-level FAQ figure
     * became an answer about a listing that sells several 규격.
     */
    public Optional<AgentDraftResponseParser.ParsedDraft> draft(
            UUID orgId, String title, String details, List<AgentDraftGenerator.Passage> knowledge,
            String orderState, String specScope) {
        return draft(orgId, title, details, knowledge, orderState, specScope, null);
    }

    /**
     * The grounded form, plus this organization's own wording preferences.
     *
     * <p>{@code style} is already prompt text — {@code AnswerStyleInstruction} turned the profile
     * into our sentences plus the seller's strings as quoted data. It arrives rendered rather than as
     * a profile so that this package, which is the LLM boundary, keeps knowing nothing about the
     * style domain: the door checks what leaves, not what it means.
     *
     * <p><b>Style never reaches the system turn.</b> That is the whole shape of the defence — a
     * seller-typed string placed among the fixed rules would let one company edit the safety rules
     * that write every other company's drafts, and no phrase check recovers from that.
     */
    public Optional<AgentDraftResponseParser.ParsedDraft> draft(
            UUID orgId, String title, String details, List<AgentDraftGenerator.Passage> knowledge,
            String orderState, String specScope, String style) {
        if (!properties.isEnabledFor(orgId)) {
            return Optional.empty();
        }
        AgentDraftGenerator.Result result = generator().generate(new AgentDraftGenerator.Input(
                title, details, knowledge, orderState, specScope, style));
        log.info("agent_draft orgId={} drafted={} grounded={} styled={} reason={}",
                orgId, result.draft().isPresent(), knowledge == null ? 0 : knowledge.size(),
                style != null && !style.isBlank(), result.reason());
        return result.draft();
    }

    /**
     * Built per call rather than held as a bean.
     *
     * <p>It costs nothing (the transport is the shared bean; this object is six fields) and it buys
     * the property that matters: a deployment that turns the capability on, changes a model, or
     * rotates a key does not need a restart to stop using the previous one, and no long-lived object
     * anywhere holds the API key beyond the life of a request.
     */
    private AgentDraftGenerator generator() {
        AgentDraftGenerator.Vendor vendor = "ANTHROPIC".equalsIgnoreCase(properties.vendor())
                ? AgentDraftGenerator.Vendor.ANTHROPIC
                : AgentDraftGenerator.Vendor.OPENAI;
        return new AgentDraftGenerator(transport, vendor, properties.model(), properties.apiKey(),
                properties.maxOutputTokens(), properties.reasoningEffort());
    }
}
