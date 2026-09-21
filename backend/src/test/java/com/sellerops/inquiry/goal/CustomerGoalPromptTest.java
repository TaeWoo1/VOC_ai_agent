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
                "requested_outcome", "subject", "basis", "explicit_constraints", "evidence");
        // v2. Required, not optional: a goal the model declined to quote must fail on the wire, not arrive
        // carrying a silent null the way basis used to carry an unbacked assertion.
        List<String> required = new ArrayList<>();
        goal.get("required").forEach(r -> required.add(r.asText()));
        assertThat(required).contains("evidence");
        assertThat(goal.get("additionalProperties").asBoolean()).isFalse();
    }

    @Test
    @DisplayName("the enums are generated from the same declarations the record constructors read")
    void theWireAndTheContractCannotDrift() {
        JsonNode props = CustomerGoalPrompt.schema().get("properties").get("goals").get("items").get("properties");
        assertThat(tokens(props.get("requested_outcome")))
                .containsExactly("ANSWER", "STATE_READ", "ACTION");
        // Three, not four. v3 merged INFORMATION and DECISION (RequestedOutcome), and the schema is where that has
        // to be true: a token the model cannot emit is a distinction it cannot be asked to make.
        assertThat(tokens(props.get("requested_outcome"))).doesNotContain("INFORMATION", "DECISION");
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

    /**
     * <b>The sentence the merge leans on, pinned verbatim.</b>
     *
     * <p>v3 folded {@code INFORMATION} and {@code DECISION} into {@code ANSWER}, which puts every judgment request on
     * the answering side of the only line that separates a question from a side effect. The instruction's whole
     * safety content is the sentence below, and it shipped in v2 in exactly these words. It is asserted rather than
     * described because a merge that quietly softened it would look, from the outside, like a merge that worked: the
     * outcome accuracy would rise, and the leak it guards against would not be in that number.
     */
    @Test
    @DisplayName("the ACTION boundary sentence survived the merge byte for byte")
    void theBoundarySentenceDidNotMove() {
        String system = CustomerGoalPrompt.system();
        assertThat(system).as("the C6 rule: asking whether something may be done is not asking for it to be done")
                .contains("**판단을 요청했다고 해서 그 뒤의 실행을 goal로 만들지 않습니다.** 승인해 줄 수 있는지 물은 고객은 승인을")
                .contains("요청한 것이고, 승인 뒤의 처리는 이 메시지의 요청이 아닙니다.");
        // And the discrimination rule still refuses to be a rule about sentence shape.
        assertThat(system).contains("문장 형태가 아니라 고객이 원한 결과로 가릅니다");
        // The retired tokens are gone from the instruction as well as from the schema: a word a model is told about
        // but cannot emit is an invitation to reach for the nearest thing it can.
        assertThat(system).doesNotContain("INFORMATION").doesNotContain("DECISION");
    }

    /**
     * <b>The comparison arm is the shipped v2, and this is what says so.</b>
     *
     * <p>The holdout of §25.13 asks whether v3 leaks more than v2, which needs both contracts put to the same
     * cases. An arm reconstructed from memory would answer a question about the reconstruction — so the v2
     * instruction and schema are rendered here and hashed against the line in
     * {@code contracts/inquiry-goal/v1/prompt-fingerprint.txt} that <b>already identifies two recorded runs</b>
     * ({@code v35-goal-smoke-35baa4c2-44fc582a} and {@code …-097a53cc-7fdad6fb}).
     *
     * <p>That is the strongest form this check can take: the value it compares against was written down before the
     * merge, for a different purpose, and cannot be adjusted to make this pass without also disowning those runs.
     */
    @Test
    @DisplayName("rendering the v2 arm reproduces the PINNED v2 fingerprint, byte for byte")
    void theComparisonArmIsTheShippedContract() throws Exception {
        String pinned = pinnedFingerprint("customer-goal-interpreter/v2");
        assertThat(CustomerGoalPrompt.Arm.V2.fingerprint())
                .as("the v2 arm no longer renders the contract those runs were runs of")
                .isEqualTo(pinned);

        // And the arms are genuinely different runs, not one contract with two names.
        assertThat(CustomerGoalPrompt.Arm.V3.fingerprint()).isNotEqualTo(pinned);
        assertThat(CustomerGoalPrompt.Arm.V2.system()).isNotEqualTo(CustomerGoalPrompt.Arm.V3.system());
        assertThat(tokens(CustomerGoalPrompt.Arm.V2.schema().get("properties").get("goals").get("items")
                .get("properties").get("requested_outcome")))
                .containsExactly("INFORMATION", "STATE_READ", "DECISION", "ACTION");

        // The current contract is v3 and nothing about adding an arm moved it: the unqualified statics still answer
        // for the shipped one, which is what every production and manifest call site reads.
        assertThat(CustomerGoalPrompt.Arm.current()).isEqualTo(CustomerGoalPrompt.Arm.V3);
        assertThat(CustomerGoalPrompt.system()).isEqualTo(CustomerGoalPrompt.Arm.V3.system());
        assertThat(CustomerGoalPrompt.schema().toString()).isEqualTo(CustomerGoalPrompt.Arm.V3.schema().toString());
        assertThat(CustomerGoalPrompt.fingerprint()).isEqualTo(CustomerGoalPrompt.Arm.V3.fingerprint());
        assertThat(CustomerGoalPrompt.VERSION).isEqualTo("customer-goal-interpreter/v3");

        // An arm nobody named is not defaulted into.
        assertThat(CustomerGoalPrompt.Arm.of("customer-goal-interpreter/v2")).isEqualTo(CustomerGoalPrompt.Arm.V2);
        org.assertj.core.api.Assertions.assertThatThrownBy(() -> CustomerGoalPrompt.Arm.of("v9"))
                .isInstanceOf(IllegalArgumentException.class).hasMessageContaining("unknown prompt arm");
    }

    /** A fingerprint line from the committed file, by version. Comments are the file's own history, not data. */
    private static String pinnedFingerprint(String version) throws Exception {
        return java.nio.file.Files.readAllLines(java.nio.file.Path.of("..", "contracts", "inquiry-goal", "v1",
                        "prompt-fingerprint.txt")).stream()
                .map(String::trim)
                .map(l -> l.startsWith("#") ? l.substring(1).trim() : l)
                .filter(l -> l.startsWith(version + " "))
                .findFirst().orElseThrow(() -> new AssertionError("no pinned fingerprint for " + version));
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
