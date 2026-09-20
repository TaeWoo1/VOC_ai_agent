package com.sellerops.inquiry.resolution;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.sellerops.inquiry.authority.CapabilityId;
import com.sellerops.inquiry.authority.CapabilityRegistry;
import com.sellerops.inquiry.authority.CapabilitySnapshot;
import com.sellerops.inquiry.authority.CustomerInput;
import com.sellerops.inquiry.authority.EntityField;
import com.sellerops.inquiry.authority.InquirySurface;
import com.sellerops.inquiry.decision.DetailCapability;
import com.sellerops.order.fact.OrderFactLookup;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * The planner's contract with the vendor and with the registry: a strict schema whose every token comes from the
 * registry, a payload that carries no identifier and no availability, and a parser that refuses a word it does not know.
 *
 * <p><b>WP-3:</b> the step schema is a union of one branch per capability, so most of what this test used to assert
 * about a universal step is now asserted about <i>absence</i> — the branch for a capability with one instance has no
 * {@code scope} property to get wrong, and only the two entity branches have {@code fields}.
 */
class ResolutionPlannerContractTest {

    static final ObjectMapper JSON = new ObjectMapper();
    static final UUID PRODUCT = UUID.randomUUID();

    static CapabilitySnapshot snapshot(String channel, String subtype, boolean bound, OrderFactLookup lookup) {
        return CapabilityRegistry.derive(new CapabilityRegistry.Inputs(channel, subtype, bound, lookup, PRODUCT,
                DetailCapability.READABLE, true, 5));
    }

    static List<String> enumAt(JsonNode schema, String... path) {
        JsonNode n = schema;
        for (String p : path) {
            n = n.path(p);
        }
        List<String> out = new ArrayList<>();
        n.path("enum").forEach(x -> out.add(x.asText()));
        return out;
    }

    static JsonNode need(JsonNode format) {
        return format.path("json_schema").path("schema").path("properties").path("needs").path("items");
    }

    @Test
    @DisplayName("strict Structured Outputs: every object closed, every property required")
    void strict() {
        JsonNode format = ResolutionPlannerPrompt.schema(snapshot("NAVER", "NAVER_PRODUCT_QNA", false,
                OrderFactLookup.STORED_ONLY));
        assertThat(format.path("json_schema").path("strict").asBoolean()).isTrue();
        assertObjectsClosed(format.path("json_schema").path("schema"));
    }

    static void assertObjectsClosed(JsonNode node) {
        if (node.isObject() && "object".equals(node.path("type").asText())) {
            assertThat(node.path("additionalProperties").asBoolean(true)).as("additionalProperties").isFalse();
            List<String> props = new ArrayList<>();
            node.path("properties").fieldNames().forEachRemaining(props::add);
            List<String> required = new ArrayList<>();
            node.path("required").forEach(x -> required.add(x.asText()));
            assertThat(required).as("required == properties").containsExactlyInAnyOrderElementsOf(props);
        }
        node.forEach(ResolutionPlannerContractTest::assertObjectsClosed);
    }

    static JsonNode branch(JsonNode format, CapabilityId capability) {
        for (JsonNode b : need(format).path("properties").path("steps").path("items").path("anyOf")) {
            if (enumAt(b.path("properties"), "capability").equals(List.of(capability.wire()))) {
                return b;
            }
        }
        throw new AssertionError("no branch for " + capability.wire());
    }

    static List<String> propertiesOf(JsonNode object) {
        List<String> out = new ArrayList<>();
        object.path("properties").fieldNames().forEachRemaining(out::add);
        return out;
    }

    @Test
    @DisplayName("every token in the schema is a registry token, and a capability this deployment cannot use is still offered")
    void registryBound() {
        CapabilitySnapshot snapshot = snapshot("NAVER", "NAVER_PRODUCT_QNA", false, OrderFactLookup.STORED_ONLY);
        JsonNode format = ResolutionPlannerPrompt.schema(snapshot);
        JsonNode item = need(format).path("properties");
        assertThat(item.path("steps").path("items").path("anyOf")).as("one branch per capability")
                .hasSize(CapabilityId.values().length);
        for (CapabilityId capability : CapabilityId.values()) {
            JsonNode b = branch(format, capability);
            assertThat(enumAt(b.path("properties"), "role")).as(capability.wire())
                    .isEqualTo(names(ResolutionPlan.Role.values()));
        }
        assertThat(enumAt(item, "id")).containsExactly("N1", "N2", "N3", "N4", "N5", "N6");
        // this snapshot has no order bound and no executor for a procedure — both are still in the planner's vocabulary
        assertThat(need(format).path("properties").path("steps").path("items").path("anyOf").toString())
                .contains("ENTITY.ORDER", "PROCEDURE.ORDER_ACTION");
    }

    /**
     * The WP-3 guarantee, read off the schema the vendor is actually sent: a slot exists only where its capability has a
     * choice to make. Every combination listed here is one the 201-call shadow produced at least once.
     */
    @Test
    @DisplayName("a step cannot carry what its own capability has no use for")
    void shapePerCapability() {
        JsonNode format = ResolutionPlannerPrompt.schema(snapshot("NAVER", "NAVER_PRODUCT_QNA", false,
                OrderFactLookup.STORED_ONLY));
        for (CapabilityId capability : CapabilityId.values()) {
            List<String> props = propertiesOf(branch(format, capability));
            assertThat(props).as(capability.wire() + " never declares an effect").doesNotContain("effect");
            assertThat(props).as(capability.wire() + " never declares a dependency index")
                    .doesNotContain("depends_on");
            boolean entity = capability.authority() == com.sellerops.inquiry.authority.Authority.ENTITY_STATE;
            if (entity) {
                assertThat(props).as(capability.wire()).contains("fields");
                assertThat(enumAt(branch(format, capability).path("properties").path("fields"), "items"))
                        .as(capability.wire() + " reads only its own fields")
                        .isEqualTo(Arrays.stream(EntityField.values()).filter(f -> f.capability() == capability)
                                .map(Enum::name).toList());
            } else {
                assertThat(props).as(capability.wire() + " has no fields to fill").doesNotContain("fields");
            }
            if (ResolutionPlan.SCOPES.get(capability).size() > 1) {
                assertThat(enumAt(branch(format, capability).path("properties"), "scope")).as(capability.wire())
                        .containsExactlyInAnyOrderElementsOf(ResolutionPlan.SCOPES.get(capability).stream()
                                .map(Enum::name).toList());
            } else {
                assertThat(props).as(capability.wire() + " is about one instance, so it names none")
                        .doesNotContain("scope");
            }
        }
        // the dominant shadow failure and the SELLER scope failure, checked by name
        assertThat(propertiesOf(branch(format, CapabilityId.KNOWLEDGE_CATALOGUE))).doesNotContain("fields");
        assertThat(propertiesOf(branch(format, CapabilityId.SELLER))).containsExactly("capability", "role");
    }

    /** The same rule in the domain: the object cannot be built, which is why the validator has no code for it. */
    @Test
    @DisplayName("a wrong-shaped step cannot be constructed either")
    void shapeInTheRecord() {
        assertThatThrownBy(() -> new ResolutionPlan.Knowledge(CapabilityId.KNOWLEDGE_ORG, ResolutionPlan.Role.CLOSES,
                ResolutionPlan.Scope.THIS_ORDER)).isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> new ResolutionPlan.Entity(CapabilityId.ENTITY_ORDER, ResolutionPlan.Role.CLOSES,
                List.of())).isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> new ResolutionPlan.Entity(CapabilityId.ENTITY_ORDER, ResolutionPlan.Role.CLOSES,
                List.of(EntityField.LISTING_SALE_STATUS))).isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> new ResolutionPlan.Knowledge(CapabilityId.SELLER, ResolutionPlan.Role.CLOSES,
                ResolutionPlan.Scope.NONE)).isInstanceOf(IllegalArgumentException.class);
        // and what a plan may say, it says: a seller step is always about nothing, a procedure always about this order
        assertThat(new ResolutionPlan.Seller(ResolutionPlan.Role.CLOSES).scope()).isEqualTo(ResolutionPlan.Scope.NONE);
        assertThat(new ResolutionPlan.Procedure(ResolutionPlan.Role.CLOSES).scope())
                .isEqualTo(ResolutionPlan.Scope.THIS_ORDER);
        assertThat(new ResolutionPlan.Seller(ResolutionPlan.Role.CLOSES).fields()).isEmpty();
    }

    @Test
    @DisplayName("identity is not even expressible: the customer-input enum holds product context only, on every surface")
    void identityNotExpressible() {
        for (String subtype : new String[]{"NAVER_PRODUCT_QNA", "NAVER_CUSTOMER_INQUIRY", null}) {
            CapabilitySnapshot s = snapshot("NAVER", subtype, true, OrderFactLookup.STORED_ONLY);
            List<String> inputs = enumAt(need(ResolutionPlannerPrompt.schema(s)).path("properties")
                    .path("customer_inputs"), "items");
            assertThat(inputs).as(String.valueOf(subtype)).doesNotContain("ORDER_NUMBER", "PHONE", "ADDRESS", "EMAIL",
                    "NAME", "UNNAMED_PRODUCT_CONTEXT");
            assertThat(inputs).contains("OPTION", "SIZE", "MEASUREMENT");
            assertThat(ResolutionPlannerPrompt.askableInputs(s))
                    .allMatch(i -> i.kind() == CustomerInput.Kind.PRODUCT_CONTEXT);
        }
    }

    @Test
    @DisplayName("the payload carries the message and four situation facts — no identifier, and no availability")
    void payloadFloor() throws Exception {
        CapabilitySnapshot bound = snapshot("CAFE24", null, true, OrderFactLookup.EXACT_ALLOWED);
        String user = ResolutionPlannerPrompt.user("이 주문 언제 나가나요?", bound);
        JsonNode node = JSON.readTree(user);
        List<String> keys = new ArrayList<>();
        node.fieldNames().forEachRemaining(keys::add);
        assertThat(keys).containsExactly("customer", "context");
        List<String> context = new ArrayList<>();
        node.path("context").fieldNames().forEachRemaining(context::add);
        assertThat(context).containsExactly("surface", "listing_resolved", "listing_option_count",
                "askable_customer_inputs");
        assertThat(user).doesNotContain(PRODUCT.toString());
        for (String availability : new String[]{"AVAILABLE", "NOT_SUPPORTED", "DECLARED_NO_EXECUTOR", "orderBound",
                "order_bound", "DISABLED", "CAFE24"}) {
            assertThat(user).as("availability never reaches the planner: " + availability).doesNotContain(availability);
        }
        // Same message, same surface, a deployment that can do none of it: byte for byte the same payload. Availability
        // is not a fact about the customer's question, and the planner is never told it.
        CapabilitySnapshot poor = CapabilityRegistry.derive(new CapabilityRegistry.Inputs("COUPANG", null, false,
                OrderFactLookup.STORED_ONLY, PRODUCT, DetailCapability.IMAGE_ONLY, false, 5));
        assertThat(ResolutionPlannerPrompt.user("이 주문 언제 나가나요?", poor)).isEqualTo(user);
        assertThat(poor.surface()).isEqualTo(bound.surface()).isEqualTo(InquirySurface.PUBLIC_QNA);
    }

    @Test
    @DisplayName("the instruction states the rules the product owner set, and no longer the ones the shape enforces")
    void instruction() {
        String system = ResolutionPlannerPrompt.system();
        assertThat(system).contains("읽어서 답이 되면 PROCEDURE가 아닙니다");
        assertThat(system).contains("신원 정보는 어떤 경우에도 묻지 않습니다");
        assertThat(system).contains("SELLER가 아니라 KNOWLEDGE입니다");
        assertThat(system).contains("이 배포가 지금 그 권한을 쓸 수 있는지는 고려하지 않습니다");
        // WP-3: the one rule added — exactly one authority ends a need (MULTIPLE_CLOSING_AUTHORITIES)
        assertThat(system).contains("need를 닫는 권한은 **정확히 하나**입니다");
        assertThat(system).contains("혹시 몰라 SELLER를 덧붙이지 않습니다");
        // WP-3: order is the dependency, restated where the depends_on rule used to be
        assertThat(system).contains("step은 **실행 순서대로** 적습니다");
        // WP-3: what the shape now enforces, the instruction stops explaining
        assertThat(system).as("no prose about leaving fields empty").doesNotContain("빈 배열");
        assertThat(system).doesNotContain("depends_on");
        assertThat(system).as("effect is the registry's word now").doesNotContain("effect=");
        assertThat(system).doesNotContain("BOUNDED_WORKFLOW").doesNotContain("EXTERNAL_STATE_CHANGE");
        assertThat(ResolutionPlannerPrompt.VERSION).isEqualTo("resolution-planner/v3");
    }

    @Test
    @DisplayName("the parser refuses a word it does not know, and a shape that cannot exist, and round-trips the rest")
    void parser() {
        String good = """
                {"needs":[{"id":"N1","ask":"이 주문의 발송 시점","steps":[{"capability":"ENTITY.ORDER","role":"CLOSES",
                "fields":["ORDER_FULFILLMENT"]}],"customer_inputs":["OPTION"]}]}""";
        ResolutionPlan plan = ResolutionPlanParser.parse(good).plan();
        assertThat(plan).isNotNull();
        assertThat(ResolutionPlanParser.parse(ResolutionPlanParser.write(plan)).plan()).isEqualTo(plan);
        // unknown words
        assertThat(ResolutionPlanParser.parse(good.replace("ENTITY.ORDER", "ENTITY.SHIPMENT")).failure())
                .isEqualTo("PLAN_SET");
        assertThat(ResolutionPlanParser.parse(good.replace("\"CLOSES\"", "\"ANSWERS\"")).failure()).isEqualTo("PLAN_SET");
        assertThat(ResolutionPlanParser.parse(good.replace("ORDER_FULFILLMENT", "ORDER_ETA")).failure())
                .isEqualTo("PLAN_SET");
        // known words, impossible object — reported apart so a run artifact says which kind of failure it was
        assertThat(ResolutionPlanParser.parse(good.replace("ORDER_FULFILLMENT", "LISTING_SALE_STATUS")).failure())
                .isEqualTo("PLAN_SHAPE");
        assertThat(ResolutionPlanParser.parse(good.replace("\"fields\":[\"ORDER_FULFILLMENT\"]", "\"fields\":[]"))
                .failure()).isEqualTo("PLAN_SHAPE");
        assertThat(ResolutionPlanParser.parse(good.replace("\"fields\":[\"ORDER_FULFILLMENT\"]",
                "\"fields\":[\"ORDER_FULFILLMENT\"],\"effect\":\"NONE\"")).failure()).isEqualTo("PLAN_SHAPE");
        assertThat(ResolutionPlanParser.parse(good.replace("\"fields\":[\"ORDER_FULFILLMENT\"]",
                "\"fields\":[\"ORDER_FULFILLMENT\"],\"depends_on\":0")).failure()).isEqualTo("PLAN_SHAPE");
        assertThat(ResolutionPlanParser.parse(good.replace("\"fields\":[\"ORDER_FULFILLMENT\"]",
                "\"fields\":[\"ORDER_FULFILLMENT\"],\"scope\":\"THIS_ORDER\"")).failure()).isEqualTo("PLAN_SHAPE");
        // a token the schema forbids but the vocabulary knows still parses — the validator is what refuses it
        assertThat(ResolutionPlanParser.parse(good.replace("\"OPTION\"", "\"ORDER_NUMBER\"")).plan()).isNotNull();
        assertThat(ResolutionPlanParser.parse("{\"needs\":[]}").failure()).isEqualTo("UNPARSEABLE");
        assertThat(ResolutionPlanParser.parse("not json").failure()).isEqualTo("UNPARSEABLE");
        assertThat(ResolutionPlanParser.parse(null).failure()).isEqualTo("EMPTY");
    }

    static List<String> names(Enum<?>[] values) {
        return Arrays.stream(values).map(Enum::name).toList();
    }

    @Test
    @DisplayName("the vocabulary file and the plan enums are one list")
    void vocabulary() throws Exception {
        JsonNode v = JSON.readTree(Path.of("..", "contracts", "inquiry-authority", "v1", "vocabulary.json").toFile());
        assertThat(strings(v.get("step_roles"))).isEqualTo(names(ResolutionPlan.Role.values()));
        assertThat(strings(v.get("step_scopes"))).isEqualTo(names(ResolutionPlan.Scope.values()));
        assertThat(strings(v.get("execution_effects")))
                .isEqualTo(names(com.sellerops.inquiry.authority.ExecutionEffect.values()));
        v.get("scope_by_capability").fields().forEachRemaining(e -> {
            CapabilityId id = CapabilityId.ofWire(e.getKey());
            assertThat(ResolutionPlan.SCOPES.get(id).stream().map(Enum::name).toList())
                    .as(e.getKey()).containsExactlyInAnyOrderElementsOf(strings(e.getValue()));
        });
        v.get("capabilities").forEach(c -> assertThat(CapabilityId.ofWire(c.get("id").asText()).effect().name())
                .as(c.get("id").asText() + ": the registry declares the effect, not the plan")
                .isEqualTo(c.get("effect").asText()));
    }

    static List<String> strings(JsonNode array) {
        List<String> out = new ArrayList<>();
        array.forEach(x -> out.add(x.asText()));
        return out;
    }
}
