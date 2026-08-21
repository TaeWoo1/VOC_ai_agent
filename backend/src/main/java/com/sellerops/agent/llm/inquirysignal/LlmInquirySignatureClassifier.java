package com.sellerops.agent.llm.inquirysignal;

import com.sellerops.agent.llm.AgentLlmTransport;
import com.sellerops.agent.llm.operator.AgentLlmWireFormat;
import com.sellerops.inquirysignal.InquirySignatureClassifier;
import java.util.Optional;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

/**
 * The ONE door to the inquiry-classification model.
 *
 * <p>The org check sits at the boundary rather than in a caller's memory, and
 * {@code AgentLlmBoundaryTest} asserts that nothing else in {@code main} constructs an
 * {@link InquirySignalGenerator} or holds an {@link AgentLlmTransport} it calls — the mechanism
 * {@code AgentDraftService}, {@code AgentPlanService} and {@code ReviewTriageChannelGate} already use.
 * A future service holding the generator directly would be an allow-list nobody runs.
 *
 * <p><b>Off is not an error.</b> A disabled deployment, an org outside the allow-list, and a missing key
 * all answer "not classified", and the caller stores null rather than a guess. The capability degrading
 * into "we have no semantic signature for this inquiry" is the design; degrading into a default topic
 * would manufacture patterns out of a classification gap.
 *
 * <p>The log line is an org id, a boolean and a reason marker. The inquiry text is NOT logged: it is a
 * customer's own words, and a log line is the easiest place for text to outlive the decision to send it.
 */
@Service
public class LlmInquirySignatureClassifier implements InquirySignatureClassifier {

    private static final Logger log = LoggerFactory.getLogger(LlmInquirySignatureClassifier.class);

    /** Stored on every row this classifier produces, so its rows and the rule extractor's coexist. */
    public static final String KIND = "SEMANTIC";
    public static final String VERSION = "inquiry-semantic/v1";

    private final InquirySignalProperties properties;
    private final AgentLlmTransport transport;

    public LlmInquirySignatureClassifier(InquirySignalProperties properties, AgentLlmTransport transport) {
        this.properties = properties;
        this.transport = transport;
    }

    @Override
    public String kind() {
        return KIND;
    }

    @Override
    public String version() {
        return VERSION;
    }

    @Override
    public boolean isEnabledFor(UUID orgId) {
        return properties.isEnabledFor(orgId);
    }

    @Override
    public Optional<Classification> classify(UUID orgId, String text) {
        if (!properties.isEnabledFor(orgId)) {
            return Optional.empty();
        }
        InquirySignalGenerator generator = generator();
        InquirySignalGenerator.Result result = generator.generate(text);
        log.info("inquiry_signal orgId={} classified={} reason={}",
                orgId, result.signature().isPresent(), result.reason());
        return result.signature().map(s -> new Classification(s, result.version()));
    }

    /**
     * Built per call rather than held as a bean, for {@code AgentDraftService}'s reason: it costs
     * nothing, and a deployment that rotates a key or changes a model does not need a restart to stop
     * using the previous one. No long-lived object holds the API key beyond one request.
     */
    private InquirySignalGenerator generator() {
        return new InquirySignalGenerator(transport, AgentLlmWireFormat.Vendor.of(properties.vendor()),
                properties.model(), properties.apiKey(), properties.maxOutputTokens(),
                properties.reasoningEffort(), properties.maxTextChars());
    }
}
