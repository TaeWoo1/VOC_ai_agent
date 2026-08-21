package com.sellerops.inquirysignal;

import com.sellerops.itemanalysis.ItemAnalysisCategories;
import com.sellerops.reviewissue.InquiryAskKind;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

/**
 * A test double at the CLASSIFIER port — never a second production implementation.
 *
 * <p><b>Why this is legitimate where a keyword PLANNER would not be.</b> The planner fence exists
 * because a deterministic planner in the process could answer for the LLM one and nobody would notice;
 * that is a property of the planner's position, not of test doubles in general.
 * {@link InquirySignatureClassifier} is a port whose whole purpose is substitution
 * ({@code IssueSignatureExtractor} states the same intent), and this class lives in {@code test/} where
 * `InquirySignatureClassifierFenceTest` proves no sibling exists in {@code main}.
 *
 * <p>It classifies by exact text lookup, seeded per test. There is deliberately no keyword matching and
 * no default: an unseeded text returns empty, which is exactly what the real classifier does when it
 * cannot place an inquiry — so a test can never accidentally rely on a fallback the product does not
 * have.
 */
public class StubInquirySignatureClassifier implements InquirySignatureClassifier {

    private final Map<String, InquirySignature> byText = new LinkedHashMap<>();
    private boolean enabled = true;
    private int calls;

    /** Seed one exact text. Matching is on the trimmed text, so a caller's join spacing does not matter. */
    public StubInquirySignatureClassifier answering(String text, String topic, InquiryAskKind ask) {
        byText.put(text.trim(), new InquirySignature(topic, ask));
        return this;
    }

    /** Seed a text that contains this fragment — the ONE convenience, and it is exact-substring. */
    public StubInquirySignatureClassifier answeringContains(String fragment, String topic, InquiryAskKind ask) {
        byText.put("~" + fragment, new InquirySignature(topic, ask));
        return this;
    }

    public StubInquirySignatureClassifier disabled() {
        this.enabled = false;
        return this;
    }

    public int calls() {
        return calls;
    }

    @Override
    public String kind() {
        return "SEMANTIC";
    }

    @Override
    public String version() {
        return "inquiry-semantic/stub";
    }

    @Override
    public boolean isEnabledFor(UUID orgId) {
        return enabled;
    }

    @Override
    public Optional<Classification> classify(UUID orgId, String text) {
        calls++;
        if (!enabled || text == null) {
            return Optional.empty();
        }
        String trimmed = text.trim();
        InquirySignature exact = byText.get(trimmed);
        if (exact != null) {
            return Optional.of(new Classification(exact, "stub/v1"));
        }
        for (Map.Entry<String, InquirySignature> entry : byText.entrySet()) {
            if (entry.getKey().startsWith("~") && trimmed.contains(entry.getKey().substring(1))) {
                return Optional.of(new Classification(entry.getValue(), "stub/v1"));
            }
        }
        // No fallback, on purpose. A default topic here would let every unclassifiable inquiry pool into
        // one bucket — the failure 기타 caused on real data with 1,777 occurrences.
        return Optional.empty();
    }

    /** The category vocabulary a caller should seed with, so a stub cannot invent one. */
    public static String topic(String category) {
        if (!ItemAnalysisCategories.SUPPORTED.contains(category)) {
            throw new IllegalArgumentException("closed vocabulary only: " + category);
        }
        return category;
    }
}
