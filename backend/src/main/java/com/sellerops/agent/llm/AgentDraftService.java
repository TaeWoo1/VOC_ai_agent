package com.sellerops.agent.llm;

import com.sellerops.agent.access.AgentCapabilityAccess;
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
    /** Who may use this capability — the deployment's named policy, not a written-down list. */
    private final AgentCapabilityAccess access;

    public AgentDraftService(AgentDraftProperties properties, AgentLlmTransport transport,
                                   AgentCapabilityAccess access) {
        this.properties = properties;
        this.transport = transport;
        this.access = access;
    }

    /** Whether this org may reach the model at all — the honest capability answer for a UI. */
    public boolean isEnabledFor(UUID orgId) {
        return access.allows(properties, orgId);
    }

    /** The version string a run records, or null when the capability is off for this org. */
    public String versionFor(UUID orgId) {
        return access.allows(properties, orgId) ? generator().version() : null;
    }

    /**
     * Generate a draft for one inquiry from its title, body and the seller's own retrieved knowledge,
     * or nothing.
     *
     * <p>There is no title-and-body-only form any more (Knowledge Context v1-A closure, 2026-08-30):
     * the {@code /api/agent/inquiry-draft} endpoint that offered one wrote replies grounded in nothing,
     * and every caller now comes through {@code InquiryDraftComposer}, which decides what the model may
     * see. A caller with no knowledge passes an empty list and the composer's answer-basis rules decide
     * whether the call happens at all.
     *
     * <p>The log line is coarse by construction: an org id, a boolean and a reason marker. The title,
     * the body, the generated draft, and any vendor text are never logged — this is the one method in
     * the backend that holds all of them at once. The passage count is logged and the passage TEXT is
     * not: knowing that a run was grounded in two passages is an operational fact; knowing what they
     * said is the seller's business.
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
        return draft(orgId, title, details, knowledge, orderState, specScope, style, null);
    }

    /**
     * The grounded form, plus the seller's own description of their company (Seller Context v1-B).
     *
     * <p>{@code companyContext} arrives as the seller's text and leaves as quoted data on a labelled
     * user-turn line — never the system turn, for the reason the style never reaches it. It is
     * context for wording; whether a draft may be written at all was decided before this call by the
     * evidence rules, which do not read it.
     */
    public Optional<AgentDraftResponseParser.ParsedDraft> draft(
            UUID orgId, String title, String details, List<AgentDraftGenerator.Passage> knowledge,
            String orderState, String specScope, String style, String companyContext) {
        return draft(orgId, title, details, knowledge, orderState, specScope, style, companyContext, null);
    }

    /** The grounded form, plus the need list the coverage gate settled (Inquiry Decision v2). */
    public Optional<AgentDraftResponseParser.ParsedDraft> draft(
            UUID orgId, String title, String details, List<AgentDraftGenerator.Passage> knowledge,
            String orderState, String specScope, String style, String companyContext, String answerScope) {
        if (!access.allows(properties, orgId)) {
            return Optional.empty();
        }
        AgentDraftGenerator.Result result = generator().generate(new AgentDraftGenerator.Input(
                title, details, knowledge, orderState, specScope, style, companyContext, answerScope));
        log.info("agent_draft orgId={} drafted={} grounded={} styled={} company={} reason={} {}",
                orgId, result.draft().isPresent(), knowledge == null ? 0 : knowledge.size(),
                style != null && !style.isBlank(), companyContext != null && !companyContext.isBlank(),
                result.reason(), result.metrics().toLogFields());
        return result.draft();
    }

    /**
     * <b>Write one public review reply</b> (Grounded Review Drafting v1).
     *
     * <p>The same capability — the same flag, the same key, the same model, the same org access
     * check — and its own prompt, its own parser and its own narrower payload. It is not a second AI
     * capability: drafting a reply a seller will read, edit and send is one job, and giving reviews
     * their own key and flag would mean a deployment could have the review lane on while the inquiry
     * lane is off, which nobody wants and which doubles the surface a reviewer has to check.
     *
     * <p>Returns the body alone. There is no title and no category to return: a review reply has no
     * subject line, and which wording the org uses was decided by the template key before this call.
     */
    public Optional<String> draftReviewReply(UUID orgId, String reviewBody,
                                             List<AgentDraftGenerator.Passage> knowledge, String style) {
        if (!access.allows(properties, orgId)) {
            return Optional.empty();
        }
        AgentDraftGenerator.Result result = generator().generateReview(
                new AgentDraftGenerator.ReviewInput(reviewBody, knowledge, style));
        Optional<String> written = result.draft().map(AgentDraftResponseParser.ParsedDraft::comments);
        log.info("agent_review_draft orgId={} drafted={} grounded={} styled={} reason={} {}",
                orgId, written.isPresent(), knowledge == null ? 0 : knowledge.size(),
                style != null && !style.isBlank(), result.reason(), result.metrics().toLogFields());
        return written;
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
