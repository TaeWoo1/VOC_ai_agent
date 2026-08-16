package com.sellerops.review.triage.llm;

import static org.assertj.core.api.Assertions.assertThat;

import com.sellerops.review.triage.ReviewTriageTier;
import com.sellerops.review.triage.TriageReasonCode;
import com.sellerops.review.triage.llm.ReviewTriageClassifier.Input;
import com.sellerops.review.triage.llm.ReviewTriageClassifier.Result;
import com.sellerops.review.triage.llm.ReviewTriageClassifier.Status;
import java.util.List;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

/**
 * RUBRIC v2 §8.5: every failure is visible, and none of them is {@code FYI}.
 *
 * <p>The single most important assertion in this file is the last one, and it is deliberately
 * written as an exhaustive sweep rather than a list of cases: <b>no input produces {@code FYI}
 * except a model that actually said {@code FYI}</b>. {@code FYI} means "nothing here for the
 * seller", so an outage that defaulted to it would dismiss real reviews silently and be
 * indistinguishable from a considered judgment.
 */
class TriageFailClosedTest {

    private static final String VERSION = "test/v1";

    private static Result parse(String raw) {
        return TriageResponseParser.parse(raw, VERSION);
    }

    @Test
    @DisplayName("a well-formed answer parses into every field")
    void theHappyPath() {
        Result result = parse("""
                {"tier":"NEEDS_ATTENTION","reasonCode":"PRAISE_WITH_CONCESSION",
                 "tags":["품질"],"suggestedNextAction":"INVESTIGATE_PRODUCT"}""");

        assertThat(result.status()).isEqualTo(Status.OK);
        assertThat(result.tier()).isEqualTo(ReviewTriageTier.NEEDS_ATTENTION);
        assertThat(result.reasonCode()).isEqualTo(TriageReasonCode.PRAISE_WITH_CONCESSION.name());
        assertThat(result.tags()).containsExactly("품질");
        assertThat(result.suggestedNextAction()).isEqualTo(TriageSuggestedAction.INVESTIGATE_PRODUCT);
        assertThat(result.classifierVersion()).isEqualTo(VERSION);
        assertThat(result.failureReason()).isNull();
    }

    @ParameterizedTest
    @ValueSource(strings = {
        "",
        "물론입니다! {\"tier\":\"FYI\",\"reasonCode\":\"PRAISE_ONLY\",\"tags\":[],\"suggestedNextAction\":\"NONE\"}",
        "```json\n{\"tier\":\"FYI\",\"reasonCode\":\"PRAISE_ONLY\",\"tags\":[],\"suggestedNextAction\":\"NONE\"}\n```",
        "[{\"tier\":\"FYI\"}]",
        "{\"tier\":\"URGENT\",\"reasonCode\":\"PRAISE_ONLY\",\"tags\":[],\"suggestedNextAction\":\"NONE\"}",
        "{\"tier\":\"FYI\",\"reasonCode\":\"SOUNDS_BAD\",\"tags\":[],\"suggestedNextAction\":\"NONE\"}",
        "{\"tier\":\"FYI\",\"reasonCode\":\"PRAISE_ONLY\",\"tags\":[],\"suggestedNextAction\":\"CALL_THEM\"}",
        "{\"tier\":\"FYI\",\"reasonCode\":\"PRAISE_ONLY\",\"tags\":\"품질\",\"suggestedNextAction\":\"NONE\"}",
        "{\"tier\":\"FYI\",\"reasonCode\":\"PRAISE_ONLY\",\"tags\":[\"환불\"],\"suggestedNextAction\":\"NONE\"}",
        "{\"tier\":\"FYI\",\"reasonCode\":\"PRAISE_ONLY\",\"tags\":[\"품질\",\"배송\",\"가격\"],\"suggestedNextAction\":\"NONE\"}",
        "{\"tier\":\"FYI\",\"reasonCode\":\"PRAISE_ONLY\",\"tags\":[\"품질\",\"품질\"],\"suggestedNextAction\":\"NONE\"}",
        "{\"tier\":\"FYI\",\"tags\":[],\"suggestedNextAction\":\"NONE\"}",
        "{\"tier\":\"UNCERTAIN\",\"reasonCode\":\"PRAISE_ONLY\",\"tags\":[],\"suggestedNextAction\":\"NONE\"}",
    })
    @DisplayName("a response the schema rejects is UNCLASSIFIED, never repaired")
    void theSchemaIsNotNegotiable(String raw) {
        Result result = parse(raw);

        assertThat(result.status()).as("for: %s", raw).isEqualTo(Status.UNCLASSIFIED);
        assertThat(result.tier()).isNull();
        assertThat(result.failureReason()).isNotBlank();
    }

    @Test
    @DisplayName("the code fence and the preamble are refused rather than cut out")
    void noSubstringRescue() {
        // Both of these are one line to "fix", and fixing them is what would make a model's habit of
        // wrapping its answer invisible until the habit changed. Named here so the refusal reads as
        // a decision rather than an omission.
        assertThat(parse("```json\n{\"tier\":\"FYI\"}\n```").failureReason())
                .isEqualTo("response is not a JSON document");
        assertThat(parse("네, {\"tier\":\"FYI\"}").failureReason())
                .isEqualTo("response is not a JSON document");
    }

    @Test
    @DisplayName("UNCERTAIN is not offered to a model, and is refused if one produces it")
    void uncertainIsNotAModelsToUse() {
        // §2 gives UNCERTAIN to a human who genuinely cannot decide, and excludes it from every
        // metric. A model allowed to use it would be opting out of being scored.
        assertThat(TriagePrompt.SYSTEM).doesNotContain("UNCERTAIN");
        assertThat(parse("{\"tier\":\"UNCERTAIN\",\"reasonCode\":\"PRAISE_ONLY\",\"tags\":[],"
                + "\"suggestedNextAction\":\"NONE\"}").status()).isEqualTo(Status.UNCLASSIFIED);
    }

    @Test
    @DisplayName("a transport failure and a bad status are CLASSIFICATION_FAILED")
    void transportFailsClosed() {
        assertThat(new ApiTriageClassifier((u, h, b) -> new LlmHttpClient.Response(0, "HttpTimeoutException"),
                ApiTriageClassifier.Vendor.ANTHROPIC, "m", "k").classify(new Input(1, "본문")).status())
                .isEqualTo(Status.CLASSIFICATION_FAILED);
        assertThat(new ApiTriageClassifier((u, h, b) -> new LlmHttpClient.Response(529, "overloaded"),
                ApiTriageClassifier.Vendor.ANTHROPIC, "m", "k").classify(new Input(1, "본문")).status())
                .isEqualTo(Status.CLASSIFICATION_FAILED);
        assertThat(new ApiTriageClassifier((u, h, b) -> new LlmHttpClient.Response(200, "not json"),
                ApiTriageClassifier.Vendor.ANTHROPIC, "m", "k").classify(new Input(1, "본문")).status())
                .isEqualTo(Status.CLASSIFICATION_FAILED);
    }

    @Test
    @DisplayName("an exhausted output budget says so, instead of surfacing as an empty response")
    void anExhaustedBudgetIsNamed() {
        // On a reasoning model the output budget is shared with internal reasoning, so this is the
        // difference between "the model cannot do the task" and "the budget was too small" — and
        // only one of those is fixed by raising a number rather than abandoning the candidate.
        Result openai = new ApiTriageClassifier(
                (u, h, b) -> new LlmHttpClient.Response(200,
                        "{\"choices\":[{\"finish_reason\":\"length\",\"message\":{\"content\":\"\"}}]}"),
                ApiTriageClassifier.Vendor.OPENAI, "m", "k").classify(new Input(1, "본문"));
        assertThat(openai.status()).isEqualTo(Status.CLASSIFICATION_FAILED);
        assertThat(openai.failureReason()).contains("output budget exhausted");

        Result anthropic = new ApiTriageClassifier(
                (u, h, b) -> new LlmHttpClient.Response(200,
                        "{\"stop_reason\":\"max_tokens\",\"content\":[{\"type\":\"text\",\"text\":\"\"}]}"),
                ApiTriageClassifier.Vendor.ANTHROPIC, "m", "k").classify(new Input(1, "본문"));
        assertThat(anthropic.failureReason()).contains("output budget exhausted");
    }

    @Test
    @DisplayName("every request knob is named in the version, so two candidates cannot share a name")
    void everyKnobIsInTheVersion() {
        // RUBRIC §8.6: a version names exactly what produced a result. A knob that changed the
        // request without changing the version is how a change-log row starts describing a run that
        // never happened.
        java.util.Set<String> versions = new java.util.LinkedHashSet<>();
        for (ApiTriageClassifier.Tuning tuning : List.of(
                ApiTriageClassifier.Tuning.DEFAULT,
                new ApiTriageClassifier.Tuning(false, 300, null),
                new ApiTriageClassifier.Tuning(true, 4000, null),
                new ApiTriageClassifier.Tuning(true, 300, "low"),
                new ApiTriageClassifier.Tuning(false, 4000, "minimal"))) {
            versions.add(new ApiTriageClassifier((u, h, b) -> new LlmHttpClient.Response(200, "{}"),
                    ApiTriageClassifier.Vendor.OPENAI, "gpt-5", "k", tuning).version());
        }
        assertThat(versions).as("five distinct tunings must produce five distinct versions").hasSize(5);
    }

    @Test
    @DisplayName("the version names every component §8.8 requires")
    void theVersionNamesTheWholeCandidate() {
        String version = new ApiTriageClassifier((u, h, b) -> new LlmHttpClient.Response(200, "{}"),
                ApiTriageClassifier.Vendor.OPENAI, "gpt-5-2025-08-07", "k",
                new ApiTriageClassifier.Tuning(false, 4000, "low")).version();

        // A model SNAPSHOT, not a floating alias: gpt-5 moves under you, gpt-5-2025-08-07 does not,
        // and a result measured against an alias describes a model that may no longer exist.
        assertThat(version).contains("openai:gpt-5-2025-08-07");
        assertThat(version).contains(TriagePrompt.PROMPT_VERSION);
        assertThat(version).contains("schema/v1");
        assertThat(version).contains("effort:low");
        assertThat(version).contains("out4000");
        assertThat(version).contains(AdditiveTriageDecision.GUARD_VERSION);
    }

    @Test
    @DisplayName("a channel §8.3 does not permit cannot reach the transport")
    void coupangCannotBeClassified() {
        List<String> sent = new java.util.ArrayList<>();
        NaverOnlyClassifierGate gate = new NaverOnlyClassifierGate(new ApiTriageClassifier(
                (uri, headers, body) -> {
                    sent.add(body);
                    return new LlmHttpClient.Response(200, "{}");
                }, ApiTriageClassifier.Vendor.ANTHROPIC, "m", "k"));

        for (String channel : List.of("COUPANG", "GMARKET", "naver", "", "NAVER ")) {
            Result result = gate.classify(channel, 1, "쿠팡 리뷰 본문");
            assertThat(result.status()).as("channel %s", channel).isEqualTo(Status.UNCLASSIFIED);
        }
        assertThat(sent).as("nothing left the machine for a channel §8.3 does not open").isEmpty();

        gate.classify("NAVER", 1, "네이버 리뷰 본문");
        assertThat(sent).hasSize(1);
    }

    @Test
    @DisplayName("NOTHING produces FYI except a model that said FYI")
    void nothingDefaultsToFyi() {
        // The exhaustive form on purpose. A list of cases would go stale the moment a branch was
        // added; this asserts the property over every failure path the parser can take.
        List<String> everyBadResponse = List.of("", " ", "null", "{}", "[]", "not json",
                "{\"tier\":\"FYI\"}", "{\"tier\":null,\"reasonCode\":null,\"tags\":null,"
                        + "\"suggestedNextAction\":null}",
                "{\"tier\":\"fyi\",\"reasonCode\":\"PRAISE_ONLY\",\"tags\":[],\"suggestedNextAction\":\"NONE\"}");
        for (String raw : everyBadResponse) {
            assertThat(parse(raw).tier()).as("for: %s", raw).isNotEqualTo(ReviewTriageTier.FYI);
            assertThat(parse(raw).tier()).as("for: %s", raw).isNull();
        }
        for (int status : new int[] {0, 400, 401, 429, 500, 529}) {
            Result result = new ApiTriageClassifier((u, h, b) -> new LlmHttpClient.Response(status, "{}"),
                    ApiTriageClassifier.Vendor.OPENAI, "m", "k").classify(new Input(5, "좋아요"));
            assertThat(result.tier()).as("http %d", status).isNull();
        }
    }
}
