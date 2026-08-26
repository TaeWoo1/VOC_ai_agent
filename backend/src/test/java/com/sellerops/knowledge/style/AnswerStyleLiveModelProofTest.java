package com.sellerops.knowledge.style;

import static org.assertj.core.api.Assertions.assertThat;

import com.sellerops.agent.llm.AgentDraftGenerator;
import com.sellerops.agent.llm.AgentDraftPrompt;
import com.sellerops.agent.llm.AgentDraftResponseParser;
import com.sellerops.agent.llm.JdkAgentLlmTransport;
import java.util.List;
import java.util.Optional;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;

/**
 * <b>Bounded live model proof</b> — Core Daily Loop UX Integration v1 §8. Opt-in, and normally skipped.
 *
 * <p>Every other test in this package asserts what the model was TOLD. That is deliberate and it
 * stays deliberate: the sentence a vendor writes is not a deterministic function of anything in this
 * repository, so a test that asserted "친근하게 답했는가" would be asserting the vendor's mood. But a
 * setting nobody has ever seen move is a setting nobody should ship, and this runs the two calls
 * ONCE, by hand, so a person can read the difference.
 *
 * <p><b>What it is allowed to touch.</b> Two model calls. No marketplace, no database, no Spring
 * context, no seller row: the question, the passage and the profile below are written for this file.
 * The only assertion that gates the build is the one that is deterministic — the factual half of the
 * two payloads is byte-identical and the style section is appended after it.
 *
 * <p>Run:
 * <pre>
 *   set -a; . backend/.env.local; set +a
 *   SELLEROPS_STYLE_PROOF=1 ./gradlew test \
 *     --tests 'com.sellerops.knowledge.style.AnswerStyleLiveModelProofTest' -i
 * </pre>
 */
@EnabledIfEnvironmentVariable(named = "SELLEROPS_STYLE_PROOF", matches = "1")
class AnswerStyleLiveModelProofTest {

    /** Synthetic. Not a seller's product, not a customer's message, not a stored row. */
    private static final String TITLE = "몰딩 색상이 몇 가지인가요?";
    private static final String DETAILS = "거실에 쓰려고 하는데 색이 어떤 것들이 있는지 궁금합니다.";
    private static final List<AgentDraftGenerator.Passage> KNOWLEDGE = List.of(
            new AgentDraftGenerator.Passage("상품 정보", "색상 안내",
                    "테스트몰딩은 화이트와 아이보리 두 가지 색상으로만 판매합니다."));
    private static final String ORDER_STATE = "이 문의에는 주문 번호가 함께 오지 않아 주문 상태를 확인할 수 없습니다.";
    private static final String SPEC_SCOPE = "(해당 없음)";

    private static AnswerStyleProfile customStyle() {
        return new AnswerStyleProfile(AnswerTone.FRIENDLY, AnswerLength.SHORT, EmojiPolicy.NONE,
                "안녕하세요, 테스트몰딩입니다.", "좋은 하루 보내세요.", "고객님",
                List.of(), List.of(), null, 7);
    }

    @Test
    @DisplayName("§8 — one default-style draft and one custom-style draft, over the same evidence")
    void twoDraftsOverOneSetOfFacts() {
        String plainTurn = AgentDraftPrompt.user(TITLE, DETAILS, KNOWLEDGE, ORDER_STATE, SPEC_SCOPE, null);
        String styleSection = AnswerStyleInstruction.of(customStyle());
        String styledTurn =
                AgentDraftPrompt.user(TITLE, DETAILS, KNOWLEDGE, ORDER_STATE, SPEC_SCOPE, styleSection);

        // The half of the proof that does NOT depend on a vendor: the facts a drafter is handed are
        // identical, byte for byte, and the wording preferences are appended after them.
        assertThat(styledTurn).startsWith(plainTurn);
        assertThat(plainTurn).doesNotContain(AnswerStyleInstruction.SECTION_TITLE);

        AgentDraftGenerator generator = new AgentDraftGenerator(new JdkAgentLlmTransport(),
                AgentDraftGenerator.Vendor.OPENAI, model(), key(), 4000, "low");

        AgentDraftGenerator.Result plain = generator.generate(new AgentDraftGenerator.Input(
                TITLE, DETAILS, KNOWLEDGE, ORDER_STATE, SPEC_SCOPE, null));
        AgentDraftGenerator.Result styled = generator.generate(new AgentDraftGenerator.Input(
                TITLE, DETAILS, KNOWLEDGE, ORDER_STATE, SPEC_SCOPE, styleSection));

        report("DEFAULT_STYLE", plain);
        report("style/v" + customStyle().version() + "@" + customStyle().digest(), styled);

        // Both calls landed. What they SAY is for a person to read in the output above — this file
        // does not turn a vendor's prose into a build gate.
        assertThat(plain.draft()).as("default-style call").isPresent();
        assertThat(styled.draft()).as("custom-style call").isPresent();
    }

    private static void report(String label, AgentDraftGenerator.Result result) {
        Optional<AgentDraftResponseParser.ParsedDraft> draft = result.draft();
        System.out.println("---- " + label + " reason=" + result.reason());
        System.out.println("title: " + draft.map(AgentDraftResponseParser.ParsedDraft::title).orElse("(none)"));
        System.out.println("body : " + draft.map(AgentDraftResponseParser.ParsedDraft::comments).orElse("(none)"));
    }

    private static String key() {
        String value = System.getenv("SELLEROPS_AGENT_DRAFT_API_KEY");
        assertThat(value).as("SELLEROPS_AGENT_DRAFT_API_KEY").isNotBlank();
        return value;
    }

    private static String model() {
        String value = System.getenv("SELLEROPS_AGENT_DRAFT_MODEL");
        return value == null || value.isBlank() ? "gpt-5-2025-08-07" : value;
    }
}
