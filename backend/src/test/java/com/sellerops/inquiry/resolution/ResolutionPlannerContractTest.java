package com.sellerops.inquiry.resolution;

import static org.assertj.core.api.Assertions.assertThat;

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

    @Test
    @DisplayName("every token in the schema is a registry token, and a capability this deployment cannot use is still offered")
    void registryBound() {
        CapabilitySnapshot snapshot = snapshot("NAVER", "NAVER_PRODUCT_QNA", false, OrderFactLookup.STORED_ONLY);
        JsonNode item = need(ResolutionPlannerPrompt.schema(snapshot)).path("properties");
        JsonNode step = item.path("steps").path("items").path("properties");
        assertThat(enumAt(step, "capability")).isEqualTo(Arrays.stream(CapabilityId.values()).map(CapabilityId::wire).toList());
        assertThat(enumAt(step, "role")).isEqualTo(names(ResolutionPlan.Role.values()));
        assertThat(enumAt(step, "scope")).isEqualTo(names(ResolutionPlan.Scope.values()));
        assertThat(enumAt(step, "effect")).isEqualTo(names(ResolutionPlan.Effect.values()));
        assertThat(enumAt(step.path("fields"), "items")).isEqualTo(names(EntityField.values()));
        assertThat(enumAt(item, "id")).containsExactly("N1", "N2", "N3", "N4", "N5", "N6");
        // this snapshot has no order bound and no executor for a procedure — both are still in the planner's vocabulary
        assertThat(enumAt(step, "capability")).contains("ENTITY.ORDER", "PROCEDURE.ORDER_ACTION");
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
    @DisplayName("the instruction states the two rules the product owner set")
    void instruction() {
        String system = ResolutionPlannerPrompt.system();
        assertThat(system).contains("읽어서 답이 되면 PROCEDURE가 아닙니다");
        assertThat(system).contains("신원 정보는 어떤 경우에도 묻지 않습니다");
        assertThat(system).contains("SELLER가 아니라 KNOWLEDGE입니다");
        assertThat(system).contains("이 배포가 지금 그 권한을 쓸 수 있는지는 고려하지 않습니다");
        assertThat(ResolutionPlannerPrompt.VERSION).isEqualTo("resolution-planner/v1");
    }

    @Test
    @DisplayName("the parser refuses a word it does not know, and a plan survives a round trip")
    void parser() {
        String good = """
                {"needs":[{"id":"N1","ask":"이 주문의 발송 시점","steps":[{"capability":"ENTITY.ORDER","role":"CLOSES",
                "scope":"THIS_ORDER","fields":["ORDER_FULFILLMENT"],"effect":"NONE","depends_on":null}],
                "customer_inputs":["OPTION"]}]}""";
        ResolutionPlan plan = ResolutionPlanParser.parse(good).plan();
        assertThat(plan).isNotNull();
        assertThat(ResolutionPlanParser.parse(ResolutionPlanParser.write(plan)).plan()).isEqualTo(plan);
        assertThat(ResolutionPlanParser.parse(good.replace("ENTITY.ORDER", "ENTITY.SHIPMENT")).failure())
                .isEqualTo("PLAN_SET");
        assertThat(ResolutionPlanParser.parse(good.replace("\"CLOSES\"", "\"ANSWERS\"")).failure()).isEqualTo("PLAN_SET");
        assertThat(ResolutionPlanParser.parse(good.replace("ORDER_FULFILLMENT", "ORDER_ETA")).failure())
                .isEqualTo("PLAN_SET");
        assertThat(ResolutionPlanParser.parse(good.replace("\"OPTION\"", "\"ORDER_NUMBER\"")).plan())
                .as("a token the schema forbids still parses — the validator is what refuses it").isNotNull();
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
        assertThat(strings(v.get("step_effects"))).isEqualTo(names(ResolutionPlan.Effect.values()));
        v.get("scope_by_capability").fields().forEachRemaining(e -> {
            CapabilityId id = CapabilityId.ofWire(e.getKey());
            assertThat(ResolutionPlanValidator.SCOPES.get(id).stream().map(Enum::name).toList())
                    .as(e.getKey()).containsExactlyInAnyOrderElementsOf(strings(e.getValue()));
        });
    }

    static List<String> strings(JsonNode array) {
        List<String> out = new ArrayList<>();
        array.forEach(x -> out.add(x.asText()));
        return out;
    }
}
