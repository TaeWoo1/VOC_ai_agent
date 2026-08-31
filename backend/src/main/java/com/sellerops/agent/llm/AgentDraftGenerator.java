package com.sellerops.agent.llm;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.net.URI;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.List;
import java.util.Optional;

/**
 * The inquiry reply-draft generator: one API call per inquiry, over {@link AgentLlmTransport}.
 *
 * <p><b>This is the LLM behind the LangGraph model seam.</b> `agent-runtime`'s
 * {@code DraftModelSeam} is a pluggable provider whose only implementation was a Korean template
 * table, and the ADR that recorded the graph/LLM split named two reasons it stayed that way: the
 * privacy decision about inquiry content, and the fact that {@code agent-runtime} holds no
 * credential of any kind. Both are answered HERE rather than there — the runtime calls this endpoint
 * with the operator's own bearer token and never sees a vendor key, so the backend remains the only
 * LLM egress in the repository and there is still exactly one place a key lives.
 *
 * <p><b>The payload floor lives here.</b> {@link #requestBody} is the only place a request is built,
 * it reads exactly two values off {@link Input}, and {@code AgentDraftPayloadFloorTest} asserts the
 * serialized bytes rather than this method's intent.
 *
 * <p><b>Every failure is {@code Optional.empty()}.</b> Disabled, unkeyed, refused, timed out,
 * rate-limited, budget-exhausted, malformed — the caller has exactly one response to all of them
 * (report "no model draft"; the graph falls back to its deterministic rule drafter), and a generator
 * that distinguished them would hand the caller reasons it has no use for. The coarse reason is
 * returned separately for the operator-facing log line and never contains vendor body text: an error
 * body can quote the request, and the request contains the seller's inquiry.
 *
 * <p>The API key is read once at construction and never logged, never echoed in a reason, and never
 * placed anywhere a {@link Result} can reach.
 */
public class AgentDraftGenerator {

    /** Which wire format to speak. Nothing else differs between them. */
    public enum Vendor {
        ANTHROPIC(URI.create("https://api.anthropic.com/v1/messages")),
        OPENAI(URI.create("https://api.openai.com/v1/chat/completions"));

        private final URI endpoint;

        Vendor(URI endpoint) {
            this.endpoint = endpoint;
        }
    }

    private static final ObjectMapper MAPPER = new ObjectMapper();

    private final AgentLlmTransport http;
    private final Vendor vendor;
    private final String modelId;
    private final String apiKey;
    private final int maxOutputTokens;
    private final String reasoningEffort;
    private final String version;

    public AgentDraftGenerator(AgentLlmTransport http, Vendor vendor, String modelId, String apiKey,
                               int maxOutputTokens, String reasoningEffort) {
        this.http = http;
        this.vendor = vendor;
        this.modelId = modelId;
        this.apiKey = apiKey;
        this.maxOutputTokens = maxOutputTokens;
        this.reasoningEffort = reasoningEffort;
        // Everything that decides what a draft is, in one string, so a recorded run can be read back without
        // consulting anything else — the same discipline the triage classifier's version string carries.
        this.version = "agent-draft/v1+" + vendor.name().toLowerCase() + ":" + modelId
                + "+" + AgentDraftPrompt.PROMPT_VERSION + "+schema/v1+out" + maxOutputTokens
                + (reasoningEffort == null ? "" : "+effort:" + reasoningEffort);
    }

    public String version() {
        return version;
    }

    /**
     * The seller's own inquiry, and — since Inquiry Draft v1 — the seller's own product knowledge.
     * Exactly the three things that may leave; see {@link AgentDraftPrompt#user}.
     *
     * <p>{@code knowledge} is what the seller typed into 상품 지식 for the resolved product, retrieved
     * for this question. It widens the payload floor deliberately: a draft that must not invent facts
     * has to be given the facts, and the alternative — retrieving evidence and then not showing it to
     * the drafter — produces a draft grounded in nothing while carrying citations that suggest
     * otherwise. It is the seller's own writing, which is a strictly narrower class than the customer
     * text already in {@code details}.
     *
     * <p>Empty when no product resolved, no library exists, or nothing matched. Empty is a real state
     * the prompt is told about, not a silent absence.
     *
     * <p><b>{@code style} is the fourth and last thing that may leave</b> (Organization Answer Style
     * v1): the org's own wording preferences, rendered into prompt text by
     * {@code AnswerStyleInstruction} — never the seller's raw setting concatenated into a system
     * turn. It names no customer, no order, no product and no identifier, and it is the only field
     * here whose absence is rendered as nothing at all.
     */
    public record Input(String title, String details, List<Passage> knowledge, String orderState,
                        String specScope, String style, String companyContext) {

        public Input(String title, String details) {
            this(title, details, List.of(), null, null, null, null);
        }

        public Input(String title, String details, List<Passage> knowledge) {
            this(title, details, knowledge, null, null, null, null);
        }

        public Input(String title, String details, List<Passage> knowledge, String orderState) {
            this(title, details, knowledge, orderState, null, null, null);
        }

        public Input(String title, String details, List<Passage> knowledge, String orderState,
                     String specScope) {
            this(title, details, knowledge, orderState, specScope, null, null);
        }

        /**
         * {@code companyContext} (Seller Context v1-B) is the fifth and last class of content: the
         * seller's own description of their company, quoted as data. Context for wording, never
         * evidence — the prompt says so under it, and no basis verdict reads it.
         */
        public Input(String title, String details, List<Passage> knowledge, String orderState,
                     String specScope, String style) {
            this(title, details, knowledge, orderState, specScope, style, null);
        }

        public Input {
            knowledge = knowledge == null ? List.of() : List.copyOf(knowledge);
        }
    }

    /**
     * One piece of seller-authored evidence, as it goes to the model: which KIND of evidence it is,
     * a heading, and the text. No id, no product id, no author, no timestamp, no score — the model
     * does not need them and the floor test asserts they are absent. The citation is reassembled
     * from the retrieval result on the way back, where the ids never left the backend.
     *
     * <p>{@code scopeLabel} is one of a closed set of constants ("상품 정보", "운영 정책", "과거 답변")
     * and carries nothing about this seller or this customer. It is on the wire because the model has
     * to be told that a shipping policy is not a product specification: a drafter that reads all
     * evidence as one undifferentiated block will answer a spec question out of a return policy.
     */
    public record Passage(String scopeLabel, String heading, String text) {

        /** Evidence with no scope stated — the shape callers used before there were three lanes. */
        public Passage(String heading, String text) {
            this(null, heading, text);
        }
    }

    /**
     * A generated draft, or a coarse reason there is none.
     *
     * @param draft  the validated candidate, or empty
     * @param reason a sanitized enum-ish marker for the log line; never vendor body text
     * @param metrics what the call cost in time and tokens — reported on every path, failures included
     */
    public record Result(Optional<AgentDraftResponseParser.ParsedDraft> draft, String reason, String version,
                         AgentLlmCallMetrics metrics) {

        static Result failed(String version, String reason, AgentLlmCallMetrics metrics) {
            return new Result(Optional.empty(), reason, version, metrics);
        }
    }

    public Result generate(Input input) {
        String body = requestBody(input);
        AgentLlmTransport.Response response = http.post(vendor.endpoint, headers(), body);
        AgentLlmCallMetrics metrics = AgentLlmCallMetrics.of(response);
        if (response.status() == 0) {
            // Transport-level: connect failure, timeout, interruption. The marker is the exception TYPE.
            return Result.failed(version, "transport:" + response.body(), metrics);
        }
        if (!response.ok()) {
            // The status only. A vendor error body can quote the request, and the request contains the inquiry.
            return Result.failed(version, "http:" + response.status(), metrics);
        }
        JsonNode envelope;
        try {
            envelope = MAPPER.readTree(response.body());
        } catch (Exception e) {
            return Result.failed(version, "unreadable_envelope", metrics);
        }
        String stop = stopReason(envelope);
        if ("length".equals(stop) || "max_tokens".equals(stop)) {
            // Named rather than left to surface as "empty response": on a reasoning model the output budget is
            // shared with internal reasoning, so this is the difference between "the model cannot do this" and
            // "the budget was too small" — and one of those is fixable by raising max-output-tokens.
            return Result.failed(version, "budget_exhausted", metrics);
        }
        Optional<String> text = AgentDraftResponseParser.assistantText(response.body());
        if (text.isEmpty()) {
            return Result.failed(version, "no_message_text", metrics);
        }
        Optional<AgentDraftResponseParser.ParsedDraft> parsed = AgentDraftResponseParser.parse(text.get());
        if (parsed.isEmpty()) {
            // Off-schema, unknown category, blank field, or over-long. No repair pass and no second call: a
            // malformed answer is a refusal, and a partial candidate reaching a human as a reviewed draft is
            // worse than none.
            return Result.failed(version, "off_schema", metrics);
        }
        return new Result(parsed, "ok", version, metrics);
    }

    private Map<String, String> headers() {
        Map<String, String> headers = new LinkedHashMap<>();
        if (vendor == Vendor.ANTHROPIC) {
            headers.put("x-api-key", apiKey);
            headers.put("anthropic-version", "2023-06-01");
        } else {
            headers.put("Authorization", "Bearer " + apiKey);
        }
        return headers;
    }

    /**
     * The whole outgoing payload, built from an inquiry title, its body, and the seller's own
     * retrieved product knowledge — and nothing else.
     *
     * <p>Package-private so {@code AgentDraftPayloadFloorTest} can assert the exact string. A check on
     * what this method <i>meant</i> to send would keep passing after someone added the work-item id
     * "for correlation".
     */
    String requestBody(Input input) {
        ObjectNode root = MAPPER.createObjectNode();
        root.put("model", modelId);
        ArrayNode messages = root.putArray("messages");
        ObjectNode user = messages.addObject();
        user.put("role", "user");
        user.put("content", AgentDraftPrompt.user(input.title(), input.details(), input.knowledge(),
                input.orderState(), input.specScope(), input.style(), input.companyContext()));
        if (vendor == Vendor.ANTHROPIC) {
            root.put("max_tokens", maxOutputTokens);
            root.put("system", AgentDraftPrompt.system());
        } else {
            root.put("max_completion_tokens", maxOutputTokens);
            // The structured-output contract, stated to the vendor as well as in the prompt. The parser still
            // validates every field: `json_object` guarantees syntax, not the schema this graph needs.
            root.putObject("response_format").put("type", "json_object");
            if (reasoningEffort != null) {
                root.put("reasoning_effort", reasoningEffort);
            }
            ObjectNode system = messages.insertObject(0);
            system.put("role", "system");
            system.put("content", AgentDraftPrompt.system());
        }
        return root.toString();
    }

    /** Why the model stopped, from whichever field the vendor calls it. A vendor-controlled enum, not free text. */
    private String stopReason(JsonNode envelope) {
        return vendor == Vendor.ANTHROPIC
                ? envelope.path("stop_reason").asText(null)
                : envelope.path("choices").path(0).path("finish_reason").asText(null);
    }
}
