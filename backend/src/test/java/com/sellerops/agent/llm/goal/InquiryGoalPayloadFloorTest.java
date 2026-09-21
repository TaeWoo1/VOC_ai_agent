package com.sellerops.agent.llm.goal;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.sellerops.agent.access.AgentCapabilityAccess;
import com.sellerops.agent.llm.AgentLlmTransport;
import com.sellerops.agent.llm.operator.AgentLlmWireFormat;
import com.sellerops.inquiry.goal.CustomerGoalPrompt;
import com.sellerops.selleraccount.SellerAccountRepository;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.regex.Pattern;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * <b>What the goal interpreter is allowed to send.</b>
 *
 * <p>The decision this pins is the narrowest payload of the fourteen capabilities: <b>the customer's own sentence,
 * and nothing about this seller.</b> Not the order the channel named, not the bound product, not what the
 * knowledge library holds, not what a previous resolution concluded. A goal is what the customer asked for, and
 * none of those facts can change what was asked — so sending them would buy nothing and widen everything.
 */
class InquiryGoalPayloadFloorTest {

    private static final Pattern UUID_SHAPE =
            Pattern.compile("[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}");
    private static final ObjectMapper MAPPER = new ObjectMapper();

    private final UUID org = UUID.randomUUID();
    private final List<String> sentBodies = new ArrayList<>();

    private AgentLlmTransport transport(String content) {
        return (uri, headers, body) -> {
            sentBodies.add(body);
            String envelope = "{\"choices\":[{\"message\":{\"content\":" + MAPPER.valueToTree(content)
                    + "},\"finish_reason\":\"stop\"}],\"usage\":{\"prompt_tokens\":400,"
                    + "\"completion_tokens\":80,\"completion_tokens_details\":{\"reasoning_tokens\":0}}}";
            return new AgentLlmTransport.Response(200, envelope, 1234);
        };
    }

    private InquiryGoalGenerator generator() {
        return new InquiryGoalGenerator(transport("{}"), AgentLlmWireFormat.Vendor.OPENAI, "gpt-test",
                "sk-secret-test", 900, "minimal");
    }

    @Test
    @DisplayName("the request carries the customer's sentence and NOTHING about this seller")
    void theRequestCarriesOnlyTheCustomersSentence() throws Exception {
        String message = "제 주문 언제 발송되나요? 안 되면 취소해 주세요";
        String body = generator().requestBody(message);

        JsonNode root = MAPPER.readTree(body);
        JsonNode user = MAPPER.readTree(root.path("messages").get(1).path("content").asText());
        assertThat(user.path("customer").asText()).isEqualTo(message);
        // Two constants, not this seller's situation: a null snapshot renders the same two values for every
        // organisation, and it is what the frozen holdout measured.
        assertThat(user.path("context").path("surface").asText()).isEqualTo("PUBLIC_QNA");
        assertThat(user.path("context").path("listing_resolved").asBoolean()).isFalse();
        assertThat(user.fieldNames()).toIterable().containsExactlyInAnyOrder("customer", "context");

        // The floor is about the VARIABLE half. The system turn and the schema are the frozen contract and do
        // contain the closed vocabulary (CURRENT_ORDER is a referent kind, not this seller's order) — asserting
        // they are free of the word «order» would be asserting the contract away.
        String variable = root.path("messages").get(1).path("content").asText();
        assertThat(variable).doesNotContain("ORDER").doesNotContain("product").doesNotContain("knowledge")
                .doesNotContain("RESOLVED").doesNotContain("CAPABILITY");
        assertThat(body).doesNotContain("sk-secret-test");
        assertThat(UUID_SHAPE.matcher(body).find()).as("no identifier of any kind leaves").isFalse();
    }

    @Test
    @DisplayName("the answer is constrained by the frozen schema, as strict Structured Outputs")
    void theContractTravelsWithTheRequest() throws Exception {
        JsonNode root = MAPPER.readTree(generator().requestBody("가능한가요?"));
        JsonNode format = root.path("response_format");
        assertThat(format.path("type").asText()).isEqualTo("json_schema");
        assertThat(format.path("json_schema").path("strict").asBoolean()).isTrue();
        assertThat(format.path("json_schema").path("schema")).isEqualTo(CustomerGoalPrompt.schema());
        // The one vocabulary the model may answer in — the merge this contract shipped, and no PROCEDURE.
        assertThat(format.toString()).contains("ANSWER").contains("STATE_READ").contains("ACTION")
                .doesNotContain("INFORMATION").doesNotContain("DECISION");
    }

    @Test
    @DisplayName("the shipped request is the arm the holdout measured")
    void theShippedArmIsTheMeasuredOne() throws Exception {
        JsonNode root = MAPPER.readTree(generator().requestBody("가능한가요?"));
        assertThat(root.path("messages").get(0).path("content").asText()).isEqualTo(CustomerGoalPrompt.system());
        assertThat(root.path("max_completion_tokens").asInt()).isEqualTo(CustomerGoalPrompt.MAX_OUTPUT_TOKENS);
        assertThat(new InquiryGoalProperties(false, "", "OPENAI", "gpt-5-2025-08-07", "", 900, "minimal")
                .promptVersion()).isEqualTo("customer-goal-interpreter/v3");
    }

    @Test
    @DisplayName("with the capability off, no request is made at all")
    void offMeansNoRequest() {
        InquiryGoalProperties off = new InquiryGoalProperties(false, org.toString(), "OPENAI", "gpt-test",
                "sk-secret-test", 900, "minimal");
        InquiryGoalService service = new InquiryGoalService(off, transport("{}"),
                new AgentCapabilityAccess("ALLOW_LIST", mock(SellerAccountRepository.class)));

        assertThat(service.isEnabledFor(org)).isFalse();
        assertThat(sentBodies).isEmpty();
    }

    @Test
    @DisplayName("the access policy cannot widen this capability to an org nobody named")
    void connectingAChannelIsNotConsentToSendCustomerSentences() {
        SellerAccountRepository accounts = mock(SellerAccountRepository.class);
        when(accounts.hasConnectedApiAccount(org)).thenReturn(true);
        InquiryGoalProperties keyed = new InquiryGoalProperties(true, "", "OPENAI", "gpt-test",
                "sk-secret-test", 900, "minimal");

        assertThat(new AgentCapabilityAccess("CONNECTED_SELLERS", accounts).allows(keyed, org))
                .as("a seller who connected a channel asked to collect, not to send their customers' words")
                .isFalse();
        assertThat(new AgentCapabilityAccess("ALL_ORGS", accounts).allows(keyed, org)).isFalse();
        // Named explicitly, it is admitted — that is the only door.
        InquiryGoalProperties named = new InquiryGoalProperties(true, org.toString(), "OPENAI", "gpt-test",
                "sk-secret-test", 900, "minimal");
        assertThat(new AgentCapabilityAccess("ALLOW_LIST", accounts).allows(named, org)).isTrue();
    }

    @Test
    @DisplayName("an answer that does not satisfy the contract is a refusal, with its own token")
    void theContractIsReadStrictly() {
        assertThat(read("not json").reason()).isEqualTo("GOAL_UNPARSEABLE");
        assertThat(read("{\"goals\":[{\"id\":\"g1\",\"explicit_request\":\"요청\","
                + "\"requested_outcome\":\"PROCEDURE\",\"subject\":\"CURRENT_ORDER\",\"basis\":\"STATED\","
                + "\"explicit_constraints\":[],\"evidence\":\"취소\"}],\"relations\":[]}").reason())
                .as("a token outside the vocabulary is not a goal").isEqualTo("GOAL_CONTRACT");
        assertThat(read("{\"goals\":[{\"id\":\"g1\",\"explicit_request\":\"요청\","
                + "\"requested_outcome\":\"ACTION\",\"subject\":\"CURRENT_ORDER\",\"basis\":\"STATED\","
                + "\"explicit_constraints\":[],\"evidence\":\"환불해 주세요\"}],\"relations\":[]}").reason())
                .as("a quote the customer did not write is invention").isEqualTo("GOAL_EVIDENCE");

        InquiryGoalGenerator.Result ok = read("{\"goals\":[{\"id\":\"g1\",\"explicit_request\":\"주문 취소\","
                + "\"requested_outcome\":\"ACTION\",\"subject\":\"CURRENT_ORDER\",\"basis\":\"STATED\","
                + "\"explicit_constraints\":[],\"evidence\":\"취소해 주세요\"}],\"relations\":[]}");
        assertThat(ok.reason()).isEqualTo("ok");
        assertThat(ok.parsed().orElseThrow().set().goals()).hasSize(1);
    }

    private InquiryGoalGenerator.Result read(String content) {
        return new InquiryGoalGenerator(transport(content), AgentLlmWireFormat.Vendor.OPENAI, "gpt-test",
                "sk-secret-test", 900, "minimal").generate("취소해 주세요");
    }
}
