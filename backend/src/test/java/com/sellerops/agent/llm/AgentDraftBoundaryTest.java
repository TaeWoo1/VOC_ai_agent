package com.sellerops.agent.llm;

import static org.assertj.core.api.Assertions.assertThat;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.stream.Stream;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * The agent-draft twin of {@code ClassifierBoundaryTest}: boundaries that are true today by
 * construction, asserted so they stay true after the next edit.
 *
 * <p>Comments are stripped before scanning, because these files legitimately <i>discuss</i> the thing
 * they must not do, and a guard that failed on its own explanation gets deleted rather than fixed.
 */
class AgentDraftBoundaryTest {

    private static final Path MAIN = Path.of("src", "main", "java", "com", "sellerops");

    private static String stripComments(String source) {
        return source.replaceAll("(?s)/\\*.*?\\*/", "").replaceAll("(?m)//.*$", "");
    }

    /**
     * Every LLM capability has exactly ONE door, and nothing reaches a vendor around it.
     *
     * <p><b>Generalized 2026-08-21 (Operator Graph v1), and widened rather than weakened.</b> This test
     * used to assert one pair — {@code AgentDraftService} is the only class that may construct
     * {@code AgentDraftGenerator}. The Operator adds two more capabilities with the same shape (plan,
     * judge), each with its own flag, key, prompt and payload floor, so the assertion became a TABLE of
     * (generator, door) pairs. It now checks three doors instead of one; nothing it used to forbid is
     * allowed now.
     *
     * <p>The property in each row is the same one: the org allow-list is checked at the door, so a
     * future service holding a generator directly would be an allow-list nobody runs.
     */
    private static final List<String[]> CAPABILITIES = List.of(
            new String[] {"AgentDraftGenerator", "AgentDraftService.java", "AgentDraftGenerator.java"},
            new String[] {"AgentPlanGenerator", "AgentPlanService.java", "AgentPlanGenerator.java"},
            new String[] {"AgentJudgeGenerator", "AgentJudgeService.java", "AgentJudgeGenerator.java"},
            // The fourth capability (Operator Graph v2): it sends ONE CUSTOMER'S OWN inquiry text and
            // receives two closed-vocabulary labels. Heaviest of the four exposures, so it gets the same
            // one-door treatment rather than riding on the draft capability's door.
            new String[] {"InquirySignalGenerator", "LlmInquirySignatureClassifier.java",
                    "InquirySignalGenerator.java"},
            // The fifth generator (Image Product Knowledge v1, 2026-08-27) and the heaviest exposure
            // yet: the payload is not a sentence SellerOps composed but the seller's own picture,
            // whose contents nobody has read before it leaves. Same one-door treatment, its own flag,
            // its own key, and — uniquely — its own model.
            new String[] {"ImageFactExtractionGenerator", "ImageFactExtractionService.java",
                    "ImageFactExtractionGenerator.java"},
            // The sixth generator (Knowledge Retrieval Quality v1, 2026-09-03). Its payload is the
            // narrowest of them all — a model name, a dimension count and texts — but it is the only
            // one that sends something on every SEARCH, so it gets the same one door.
            new String[] {"KnowledgeEmbeddingGenerator", "KnowledgeEmbeddingService.java",
                    "KnowledgeEmbeddingGenerator.java"},
            // The seventh (Knowledge Retrieval Quality v2, 2026-09-03): ONE customer sentence leaves
            // and comes back restated as what it needs answered. Narrower than the sixth — no passage,
            // no identifier — and still its own door, because the day it shares one it shares a flag.
            new String[] {"KnowledgeQuestionIntentGenerator", "KnowledgeQuestionIntent.java",
                    "KnowledgeQuestionIntentGenerator.java"},
            // The eighth, and the widest payload of the three retrieval capabilities: the customer's
            // sentence AND the seller's candidate passages in ONE request. It can only refuse a
            // passage the scorer already admitted, which is a property of the caller — the door is
            // here so the org gate cannot be walked around.
            new String[] {"KnowledgeEligibilityGenerator", "KnowledgeEvidenceEligibility.java",
                    "KnowledgeEligibilityGenerator.java"},
            // The ninth (Agentic Report v1, 2026-09-04): the report's facts snapshot leaves — counts,
            // dates, vocabulary titles, the seller's product names — and no customer text. Its own
            // door, because a report narrative is a different exposure from a plan or a draft.
            new String[] {"AgentReportNarrativeGenerator", "AgentReportNarrativeService.java",
                    "AgentReportNarrativeGenerator.java"},
            // The tenth (Grounded Conversation Lane v1, 2026-09-07): the seller's own sentence, the
            // sentences WE wrote earlier in the same thread, and this deployment's fact sheet about
            // itself. No customer content — and its own door, because it is the only capability whose
            // output is prose a seller reads rather than a token the runtime routes on.
            new String[] {"AgentConverseGenerator", "AgentConverseService.java",
                    "AgentConverseGenerator.java"},
            // The eleventh (Responsibility Runtime v1 Package B, 2026-09-16): ONE redacted customer inquiry or
            // review plus closed facts and short excerpts of the seller's own knowledge, sent while nobody is
            // looking, for a case the rules could not settle. Its own door, because it is the only capability a
            // scheduled run reaches without a seller in the loop.
            new String[] {"CaseInvestigationGenerator", "CaseInvestigationService.java",
                    "CaseInvestigationGenerator.java"},
            // The twelfth (Customer Ops Demo Closure v1, 2026-09-18) and the widest exposure: a customer's own review
            // photo, with that review's rating and words. Its own door, flag, key and model.
            new String[] {"ReviewMediaVisionGenerator", "ReviewMediaInspector.java",
                    "ReviewMediaVisionGenerator.java"},
            // The thirteenth (Inquiry Decision v2, 2026-09-19): the customer's inquiry, the seller's candidate evidence
            // and past answers, by position, on the assessment path — planning and judging needs. Its own door, flag,
            // key and org list, because it is the only capability whose output decides whether a Case may be
            // completed at all.
            new String[] {"InquiryDecisionGenerator", "InquiryDecisionService.java",
                    "InquiryDecisionGenerator.java"});

    /**
     * The classes allowed to name {@code AgentLlmTransport} beside a {@code .post(} call: the three
     * generators (each makes the one call its capability needs), the JDK implementation, and the
     * {@code @Bean} factory. Everything else that does both is reaching the vendor directly.
     */
    private static final List<String> TRANSPORT_HOLDERS = List.of(
            "AgentDraftGenerator.java", "AgentPlanGenerator.java", "AgentJudgeGenerator.java",
            "InquirySignalGenerator.java", "ImageFactExtractionGenerator.java",
            "KnowledgeEmbeddingGenerator.java", "KnowledgeQuestionIntentGenerator.java",
            "KnowledgeEligibilityGenerator.java", "AgentReportNarrativeGenerator.java",
            "AgentConverseGenerator.java", "CaseInvestigationGenerator.java", "ReviewMediaVisionGenerator.java",
            "InquiryDecisionGenerator.java",
            "JdkAgentLlmTransport.java", "AgentLlmConfiguration.java");

    @Test
    @DisplayName("each capability's service is the only door to its generator, and only generators post")
    void theServiceIsTheOnlyDoor() throws IOException {
        List<String> offenders = new ArrayList<>();
        try (Stream<Path> walk = Files.walk(MAIN)) {
            for (Path source : walk.filter(p -> p.toString().endsWith(".java")).toList()) {
                String name = source.getFileName().toString();
                String code = stripComments(Files.readString(source));
                for (String[] capability : CAPABILITIES) {
                    String generator = capability[0];
                    if (name.equals(capability[1]) || name.equals(capability[2])) {
                        continue;
                    }
                    if (code.contains("new " + generator + "(") || code.contains(generator + "::new")) {
                        offenders.add(name + " (constructs " + generator + ")");
                    }
                }
                // The transport may be DECLARED (the @Bean factory) but only a generator may call it.
                if (!TRANSPORT_HOLDERS.contains(name)
                        && code.contains("AgentLlmTransport") && code.contains(".post(")) {
                    offenders.add(name + " (calls the transport directly)");
                }
            }
        }
        assertThat(offenders)
                .as("a caller holding a generator directly would be an allow-list nobody runs")
                .isEmpty();
    }

    /**
     * The three capabilities stay separable — no one flag turns on another's exposure.
     *
     * <p>They send different things: a review's rating and body (triage), an inquiry's title and body
     * (draft), an operator's own sentence (plan), a SellerOps-composed claim plus metadata (judge), and
     * one customer inquiry's text for classification (inquiry signature). A deployment must be able to
     * run any subset, which is only true while no file reads another capability's property key — and the
     * fifth one matters most: a deployment that wanted goal interpretation must not thereby be sending
     * customer questions to a vendor.
     */
    @Test
    @DisplayName("no LLM capability reads another capability's flag")
    void theCapabilitiesStaySeparable() throws IOException {
        List<String> offenders = new ArrayList<>();
        List<String[]> flags = List.of(
                new String[] {"sellerops.agent.draft.", "AgentDraftProperties.java"},
                new String[] {"sellerops.agent.plan.", "AgentPlanProperties.java"},
                new String[] {"sellerops.agent.judge.", "AgentJudgeProperties.java"},
                new String[] {"sellerops.triage.ai-pilot", "AiTriagePilotProperties.java"},
                new String[] {"sellerops.inquiry.signature.", "InquirySignalProperties.java"},
                new String[] {"sellerops.product.image-knowledge.", "ImageKnowledgeProperties.java"},
                // The three retrieval capabilities. They must stay separable for a reason the others
                // do not have: a deployment may want the cheap one (embedding) without paying two
                // more vendor round trips per search, or may want the refusal-only judge without
                // paying for restatements. One file reading two of these keys would end that.
                new String[] {"sellerops.knowledge.embedding.", "KnowledgeEmbeddingProperties.java"},
                new String[] {"sellerops.knowledge.intent.", "KnowledgeQuestionIntentProperties.java"},
                new String[] {"sellerops.knowledge.eligibility.", "KnowledgeEligibilityProperties.java"},
                new String[] {"sellerops.agent.report.", "AgentReportProperties.java"},
                new String[] {"sellerops.responsibility.investigation.", "CaseInvestigationProperties.java"},
                new String[] {"sellerops.review.media-vision.", "ReviewMediaVisionProperties.java"},
                new String[] {"sellerops.inquiry-decision.", "InquiryDecisionProperties.java"});
        try (Stream<Path> walk = Files.walk(MAIN)) {
            for (Path source : walk.filter(p -> p.toString().endsWith(".java")).toList()) {
                String name = source.getFileName().toString();
                String code = stripComments(Files.readString(source));
                for (String[] flag : flags) {
                    if (!name.equals(flag[1]) && code.contains(flag[0])) {
                        offenders.add(name + " reads " + flag[0]);
                    }
                }
            }
        }
        assertThat(offenders)
                .as("one file reading two capabilities' flags is how two exposures become indivisible")
                .isEmpty();
    }

    /**
     * The two LLM capabilities stay separable.
     *
     * <p>They are different exposures — a review's rating and body vs an inquiry's title and body —
     * and the whole reason this package has its own transport, its own prompt, its own flag and its
     * own key is that a deployment must be able to run either without the other. A file that read the
     * triage key or the triage flag here would quietly re-merge them.
     */
    @Test
    @DisplayName("the draft capability never reads the triage pilot's key or flag")
    void theTwoCapabilitiesStaySeparable() throws IOException {
        Path dir = MAIN.resolve("agent").resolve("llm");
        try (Stream<Path> walk = Files.walk(dir)) {
            for (Path source : walk.filter(p -> p.toString().endsWith(".java")).toList()) {
                String code = stripComments(Files.readString(source));
                assertThat(code).as("%s reads the triage flag", source.getFileName())
                        .doesNotContain("sellerops.triage.ai-pilot");
                assertThat(code).as("%s reads the triage transport", source.getFileName())
                        .doesNotContain("LlmHttpClient");
                assertThat(code).as("%s reads the triage classifier", source.getFileName())
                        .doesNotContain("ApiTriageClassifier");
            }
        }
    }

    /**
     * The capability is OFF unless a deployment turns it on, and it is off in three independent ways.
     *
     * <p>Asserted on the properties rather than on a comment, because "off by default" is the sentence
     * every unreviewed default is written under.
     */
    @Test
    @DisplayName("no flag, no key, or no org — all three mean off")
    void offByDefaultThreeWays() {
        java.util.UUID org = java.util.UUID.randomUUID();
        assertThat(props(false, org.toString(), "sk-key").isEnabledFor(org)).as("flag off").isFalse();
        assertThat(props(true, org.toString(), "").isEnabledFor(org)).as("no key").isFalse();
        assertThat(props(true, "", "sk-key").isEnabledFor(org)).as("org not listed").isFalse();
        assertThat(props(true, java.util.UUID.randomUUID().toString(), "sk-key").isEnabledFor(org))
                .as("a DIFFERENT org listed").isFalse();
        assertThat(props(true, org.toString(), "sk-key").isEnabledFor(org)).as("all three").isTrue();
        assertThat(props(true, "*", "sk-key").isEnabledFor(org)).as("the local single-user wildcard").isTrue();
        assertThat(props(true, "*", "sk-key").isEnabledFor(null)).as("but never for no org at all").isFalse();
    }

    private static AgentDraftProperties props(boolean enabled, String orgIds, String key) {
        return new AgentDraftProperties(enabled, orgIds, "OPENAI", "m", key, 4000, "low");
    }
}
