package com.sellerops.agent.llm.inquirysignal;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.sellerops.agent.llm.AgentLlmTransport;
import com.sellerops.agent.llm.operator.AgentLlmWireFormat;
import com.sellerops.agent.llm.operator.AgentOperatorResponseParser;
import com.sellerops.inquirysignal.InquirySignature;
import com.sellerops.itemanalysis.ItemAnalysisCategories;
import com.sellerops.reviewissue.InquiryAskKind;
import java.util.Optional;

/**
 * The inquiry-classification call: one request per distinct inquiry text.
 *
 * <p><b>Its own generator, for the reason the plan and judge generators are separate from each
 * other.</b> Different exposure (a customer's own sentence), different payload floor, different flag —
 * and the standing rule in this repository is that a distinct exposure gets its own byte-asserted
 * request body. One shared "operator LLM" class would put three floors in one method and leave one test
 * standing in front of three contracts.
 *
 * <p><b>Off-vocabulary is a failure, not a nearest match.</b> The parser accepts only exact labels from
 * {@link ItemAnalysisCategories} and {@link InquiryAskKind}; anything else — including {@code 기타},
 * which means "the analyzer found nothing" and must never become a pattern — returns empty and is
 * cached as a miss.
 */
public class InquirySignalGenerator {

    private static final ObjectMapper MAPPER = new ObjectMapper();

    private final AgentLlmTransport http;
    private final AgentLlmWireFormat.Vendor vendor;
    private final String modelId;
    private final String apiKey;
    private final int maxOutputTokens;
    private final String reasoningEffort;
    private final int maxTextChars;
    private final String version;

    public InquirySignalGenerator(AgentLlmTransport http, AgentLlmWireFormat.Vendor vendor, String modelId,
                                  String apiKey, int maxOutputTokens, String reasoningEffort,
                                  int maxTextChars) {
        this.http = http;
        this.vendor = vendor;
        this.modelId = modelId;
        this.apiKey = apiKey;
        this.maxOutputTokens = maxOutputTokens;
        this.reasoningEffort = reasoningEffort;
        this.maxTextChars = maxTextChars;
        this.version = "inquiry-signal/v1+" + vendor.name().toLowerCase() + ":" + modelId
                + "+" + InquirySignalPrompt.PROMPT_VERSION + "+schema/v1+out" + maxOutputTokens
                + (reasoningEffort == null ? "" : "+effort:" + reasoningEffort);
    }

    public String version() {
        return version;
    }

    /** The signature, or empty with a sanitized reason. The reason NEVER carries the text. */
    public Result generate(String inquiryText) {
        AgentLlmTransport.Response response =
                http.post(vendor.endpoint(), AgentLlmWireFormat.headers(vendor, apiKey), requestBody(inquiryText));
        if (response.status() == 0) {
            return Result.failed(version, "transport");
        }
        if (!response.ok()) {
            return Result.failed(version, "http:" + response.status());
        }
        JsonNode envelope;
        try {
            envelope = MAPPER.readTree(response.body());
        } catch (Exception e) {
            return Result.failed(version, "unreadable_envelope");
        }
        if (isBudgetExhausted(envelope)) {
            return Result.failed(version, "budget_exhausted");
        }
        Optional<String> text = AgentOperatorResponseParser.assistantText(response.body());
        if (text.isEmpty()) {
            return Result.failed(version, "no_message_text");
        }
        // Three different outcomes, three different reasons — a single "off_schema" conflates "the model
        // declined this one" with "the model answered outside the vocabulary", and those have opposite
        // remedies: the first is the corpus, the second is the prompt. Measured need: 181 of 186 real
        // classifications reported off_schema and the label could not say which kind.
        Outcome outcome = classify(text.get());
        return outcome.signature()
                .map(signature -> new Result(Optional.of(signature), "ok", version))
                .orElseGet(() -> Result.failed(version, outcome.reason()));
    }

    /**
     * Two labels, both exact, or nothing.
     *
     * <p>{@code 기타} is rejected explicitly rather than falling out of the vocabulary check, because it
     * IS in {@link ItemAnalysisCategories} — it is the analyzer's "we looked and it fits nothing". A
     * signature built on it would let every unclassifiable inquiry pool into one bucket and be shown to
     * a seller as their largest repeated question, which is what happened on real data.
     */
    static Optional<InquirySignature> parse(String raw) {
        return classify(raw).signature();
    }

    /** The parse, with WHY it failed kept — see {@link #generate}. */
    static Outcome classify(String raw) {
        JsonNode node;
        try {
            node = MAPPER.readTree(AgentOperatorResponseParser.stripFence(raw));
        } catch (Exception e) {
            return Outcome.failed("unparseable_answer");
        }
        String topic = node.path("topic").asText("").strip();
        String ask = node.path("ask").asText("").strip();
        if (topic.isEmpty() && ask.isEmpty()) {
            // The prompt's own escape hatch: "애매하면 억지로 고르지 말고 빈 문자열로 두세요." A decline is
            // the model working correctly, and counting it as a schema violation hides that.
            return Outcome.failed("model_declined");
        }
        if (topic.isEmpty() || ask.isEmpty()) {
            return Outcome.failed("half_answer");
        }
        if (ItemAnalysisCategories.FALLBACK.equals(topic)) {
            return Outcome.failed("fallback_topic");
        }
        if (!ItemAnalysisCategories.SUPPORTED.contains(topic)) {
            return Outcome.failed("off_vocabulary_topic");
        }
        return InquiryAskKind.fromLabel(ask)
                .map(kind -> Outcome.of(new InquirySignature(topic, kind)))
                .orElseGet(() -> Outcome.failed("off_vocabulary_ask"));
    }

    /** A classification attempt: the signature, or the reason there is none. Never carries the text. */
    record Outcome(Optional<InquirySignature> signature, String reason) {

        static Outcome of(InquirySignature signature) {
            return new Outcome(Optional.of(signature), "ok");
        }

        static Outcome failed(String reason) {
            return new Outcome(Optional.empty(), reason);
        }
    }

    /** The whole outgoing payload. Package-private so the payload-floor test asserts the exact string. */
    String requestBody(String inquiryText) {
        return AgentLlmWireFormat.body(vendor, modelId, InquirySignalPrompt.system(),
                InquirySignalPrompt.user(truncate(inquiryText)), maxOutputTokens, reasoningEffort);
    }

    /**
     * A long inquiry is truncated rather than split.
     *
     * <p>Splitting would mean two egresses for one customer sentence, and the classification a second
     * half produces is not a second fact — it is the same question read twice. The topic and ask of a
     * Korean inquiry are almost always stated in its opening; the tail is context.
     */
    private String truncate(String text) {
        if (text == null) {
            return "";
        }
        String trimmed = text.strip();
        return trimmed.length() <= maxTextChars ? trimmed : trimmed.substring(0, maxTextChars);
    }

    private boolean isBudgetExhausted(JsonNode envelope) {
        String stop = vendor == AgentLlmWireFormat.Vendor.ANTHROPIC
                ? envelope.path("stop_reason").asText(null)
                : envelope.path("choices").path(0).path("finish_reason").asText(null);
        return "length".equals(stop) || "max_tokens".equals(stop);
    }

    public record Result(Optional<InquirySignature> signature, String reason, String version) {

        static Result failed(String version, String reason) {
            return new Result(Optional.empty(), reason, version);
        }
    }
}
