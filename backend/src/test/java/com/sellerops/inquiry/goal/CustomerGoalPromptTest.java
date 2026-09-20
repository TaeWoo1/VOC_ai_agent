package com.sellerops.inquiry.goal;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * <b>What leaves for the model, and what the model cannot say back</b> (Inquiry v3.5).
 *
 * <p>Two floors, asserted on bytes rather than argued. The payload floor says the vendor sees the customer's message
 * and two facts about the situation — narrower than the planner's payload, and never wider. The schema floor says
 * every slot a plan had is <b>absent from the wire</b>, so the forbidden outputs cannot be produced rather than
 * merely refused after the fact.
 */
class CustomerGoalPromptTest {

    private static final ObjectMapper JSON = new ObjectMapper();

    @Test
    @DisplayName("the payload is the message and two facts — no identifier, no seller text, no availability")
    void payloadFloor() throws Exception {
        JsonNode payload = JSON.readTree(CustomerGoalPrompt.user("주문 취소 가능한가요?", null));
        assertThat(fieldNames(payload)).containsExactlyInAnyOrder("customer", "context");
        assertThat(fieldNames(payload.get("context")))
                .as("the planner sent four facts; a goal needs neither the option count nor the askable inputs")
                .containsExactlyInAnyOrder("surface", "listing_resolved");
        assertThat(payload.get("customer").asText()).isEqualTo("주문 취소 가능한가요?");

        String bytes = payload.toString().toLowerCase();
        for (String forbidden : List.of("order_id", "orderid", "product_id", "productid", "org", "customer_id",
                "capability", "available", "gap", "answer", "seller_text", "phone", "address")) {
            assertThat(bytes).as("%s reached the vendor", forbidden).doesNotContain(forbidden);
        }
    }

    @Test
    @DisplayName("availability is not in the payload, and the instruction says to ignore it")
    void availabilityNeverReachesTheModel() {
        // Told what this deployment can do, a model quietly rewrites what the customer asked for. S:N2 — "please
        // issue a tax invoice", which this registry has no procedure for at all — is where that is most tempting.
        assertThat(CustomerGoalPrompt.user("세금계산서 발행해 주세요", null)).doesNotContain("PROCEDURE", "SELLER");
        assertThat(CustomerGoalPrompt.system()).contains("지금 이 시스템이 그것을 할 수 있는지는 고려하지 않습니다");
    }

    @Test
    @DisplayName("the schema has no slot for a plan — every retired field is absent from the wire")
    void schemaFloor() {
        String schema = CustomerGoalPrompt.schema().toString();
        for (String retired : List.of("closing_authority", "steps", "capability", "capabilities", "fields",
                "customer_inputs", "procedure", "availability", "effect", "scope", "role", "depends_on",
                "prerequisite", "handoff", "sequence", "order", "trigger")) {
            assertThat(schema).as("%s is expressible on the wire", retired).doesNotContain("\"" + retired + "\"");
        }
        JsonNode goal = CustomerGoalPrompt.schema().get("properties").get("goals").get("items");
        assertThat(fieldNames(goal.get("properties"))).containsExactlyInAnyOrder("id", "explicit_request",
                "requested_outcome", "subject", "basis", "explicit_constraints");
        assertThat(goal.get("additionalProperties").asBoolean()).isFalse();
    }

    @Test
    @DisplayName("the enums are generated from the same declarations the record constructors read")
    void theWireAndTheContractCannotDrift() {
        JsonNode props = CustomerGoalPrompt.schema().get("properties").get("goals").get("items").get("properties");
        assertThat(tokens(props.get("requested_outcome")))
                .containsExactly("INFORMATION", "STATE_READ", "DECISION", "ACTION");
        assertThat(tokens(props.get("subject"))).hasSameElementsAs(names(Referent.values()));
        assertThat(tokens(props.get("basis"))).containsExactly("STATED", "DIRECTLY_IMPLIED");
        // No third basis, and the reason is in RequestBasis: "no goal" is the third state and is observable as a
        // count of zero, not as a word a model may reach for when it is unsure.
        assertThat(tokens(props.get("basis"))).hasSize(2);
    }

    @Test
    @DisplayName("a fallback cannot be emitted without the clause that states it")
    void aRelationMustQuoteTheCustomer() {
        JsonNode relation = CustomerGoalPrompt.schema().get("properties").get("relations").get("items");
        assertThat(tokens(relation.get("properties").get("kind"))).containsExactly("FALLBACK");
        List<String> required = new ArrayList<>();
        relation.get("required").forEach(r -> required.add(r.asText()));
        assertThat(required).as("the quote is required on the wire, not encouraged in prose")
                .contains("stated_condition");
        assertThat(relation.get("properties").get("stated_condition").get("maxLength").asInt())
                .isEqualTo(GoalRelation.MAX_CONDITION);
        assertThat(CustomerGoalPrompt.system()).contains("고객이 조건을 말하지");
    }

    @Test
    @DisplayName("the fingerprint covers both halves, and matches the one the smoke manifest quotes")
    void fingerprintCoversBoth() throws Exception {
        String fingerprint = CustomerGoalPrompt.fingerprint();
        assertThat(fingerprint).startsWith(CustomerGoalPrompt.VERSION)
                .contains("system=" + CustomerGoalPrompt.sha256(CustomerGoalPrompt.system()))
                .contains("schema=" + CustomerGoalPrompt.sha256(CustomerGoalPrompt.schema().toString()));
        assertThat(CustomerGoalPrompt.sha256("a")).isNotEqualTo(CustomerGoalPrompt.sha256("b"));

        // A recorded run is a run OF this prompt and this schema. Either half moving silently would leave a manifest
        // pointing at an experiment that no longer exists, so the value lives in the repository and is compared here.
        List<String> lines = java.nio.file.Files.readAllLines(java.nio.file.Path.of("..", "contracts",
                "inquiry-goal", "v1", "prompt-fingerprint.txt"));
        String pinned = lines.stream().filter(l -> !l.startsWith("#") && !l.isBlank()).reduce((a, b) -> b)
                .orElseThrow();
        assertThat(pinned.trim()).as("the prompt or the schema changed; regenerate the fingerprint deliberately")
                .isEqualTo(fingerprint);
    }

    private static List<String> fieldNames(JsonNode node) {
        List<String> names = new ArrayList<>();
        node.fieldNames().forEachRemaining(names::add);
        return names;
    }

    private static List<String> tokens(JsonNode node) {
        List<String> out = new ArrayList<>();
        node.get("enum").forEach(t -> out.add(t.asText()));
        return out;
    }

    private static List<String> names(Enum<?>[] values) {
        List<String> out = new ArrayList<>();
        for (Enum<?> v : values) {
            out.add(v.name());
        }
        return out;
    }
}
