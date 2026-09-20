package com.sellerops.inquiry.resolution;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.sellerops.inquiry.authority.Authority;
import com.sellerops.inquiry.authority.CapabilityId;
import com.sellerops.inquiry.authority.CapabilitySnapshot;
import com.sellerops.inquiry.authority.CustomerInput;
import com.sellerops.inquiry.authority.EntityField;
import com.sellerops.inquiry.authority.InquirySurface;
import java.util.List;

/**
 * <b>The Resolution Planner's instruction, payload and strict schema</b> (Inquiry v3 WP-2; per-capability step shapes
 * in WP-3; the declared closing authority in WP-3.1).
 *
 * <p><b>The payload floor.</b> What leaves for the model is the customer's message and four facts about the situation —
 * the surface (public Q&A or a message attached to an order), whether a listing is resolved, how many options that listing
 * is sold in, and which product-context values may be asked for here. No identifier of any kind: no order, product,
 * organisation, source or customer id; no seller text; no past answer. {@code ResolutionPlannerPayloadFloorTest} asserts
 * the bytes. <b>WP-3 did not widen it</b> — {@link #user} is unchanged to the byte.
 *
 * <p><b>Availability is not in the payload</b>, deliberately. A plan states what the need REQUIRES; if the planner were
 * told what this deployment can do, an order question would quietly become a policy question whenever the connector is
 * missing — the {@code 4181864b} failure. The validator records the gap afterwards ({@link ResolutionPlanValidator}).
 *
 * <p><b>The model cannot invent a capability, and now cannot mis-shape a step either.</b> {@link #schema} emits one
 * closed object per capability — the branch for {@code KNOWLEDGE.ORG} has no {@code fields} property to fill and no
 * {@code scope} to get wrong, because that capability has exactly one instance — so the combinations that produced 35 of
 * the 201-call shadow's 39 contract violations are not expressible rather than merely refused. Each branch is generated
 * from {@link ResolutionPlan#SCOPES} and {@link EntityField#capability()}, the same declarations the domain record and
 * the validator read, so schema and contract cannot drift.
 *
 * <p><b>What changed in WP-3.1.</b> The step no longer carries a {@code role}, and the need carries
 * {@code closing_authority}. Under v3 the instruction had to say "exactly one authority closes a need" and "a
 * PRECONDITION comes before the CLOSES step it enables" — two rules which together meant the last step written was the
 * closer, and the 67-call shadow showed the model's ordering habit deciding the ending in five goals. Asking for the
 * ending directly removes the inference: <b>a plan that reorders its steps cannot change what resolves the need</b>,
 * because nothing derives the closer from position. The field is declared before {@code steps} on the same reasoning —
 * a left-to-right decoder states the ending before it lists what the ending requires. That ordering is a design
 * hypothesis the targeted smoke tests; the structural part (position carries no meaning) holds either way.
 *
 * <p><b>What the instruction lost in WP-3, and why.</b> Three sentences described rules the shape now enforces (fields
 * belong to entity steps, fields belong to their own capability, a scope must be one the capability allows) and two
 * parentheticals named the {@code effect} tokens, which left the wire for the registry
 * ({@link com.sellerops.inquiry.authority.ExecutionEffect}); all five are gone. One sentence was <b>replaced, not
 * removed</b>: the {@code depends_on} index is now step order, so the rule it carried is restated as order. One sentence
 * was <b>added</b>, and it is the only new instruction in this package — the WP-3 contract that exactly one authority
 * closes a need ({@link ResolutionPlanValidator.Code#MULTIPLE_CLOSING_AUTHORITIES}), which the model cannot follow
 * without being told. Nothing about splitting a message into needs, and nothing about customer inputs, was touched — the
 * two behaviours WP-3's new scorer measures against the frozen shadow.
 */
public final class ResolutionPlannerPrompt {

    public static final String VERSION = "resolution-planner/v4";
    /** Six needs × three steps of closed tokens, plus the asks. Measured shapes sit far below this. */
    public static final int MAX_OUTPUT_TOKENS = 1600;
    static final int MAX_ASK = 120;

    private static final ObjectMapper MAPPER = new ObjectMapper();

    private ResolutionPlannerPrompt() {
    }

    public static String system() {
        return """
                당신은 고객이 판매자에게 보낸 문의 하나를 읽고, (1) 답변에 포함되지 않으면 요청이 해결되지 않는 독립적인 need로 나누고,
                (2) need마다 **누가 그것을 최종적으로 해결하는지**를 먼저 정하고, 그 해결에 필요한 권한을 순서대로 적습니다.
                답을 쓰지 않고, 무엇이 필요한지만 계획합니다.
                need 나누기:
                - 고객이 실제로 묻거나 요청한 것만 need입니다. 답에 필요한 배경·전제는 need가 아니라 step입니다.
                - 같은 것을 다른 말로 반복한 것은 하나의 need입니다. 인사·감사·감정 표현은 need가 아닙니다.
                - 질문 없이 불만·상황만 있으면 판매자가 해결해 줘야 하는 것을 need로 씁니다.
                - ask는 판매자가 읽을 짧은 한국어 문장(120자 이하)입니다. 이름·주소·전화번호·주문번호를 넣지 않습니다.
                capability(권한) — 이 값들만 씁니다:
                - KNOWLEDGE.PRODUCT: 이 상품에 대해 판매자가 적어 둔/가르친 사실(치수·재질·사용법·호환).
                - KNOWLEDGE.CATALOGUE: 판매자의 등록 정보 — 이 상품의 옵션·구성(THIS_LISTING), 또는 판매자가 그런 상품을 파는지(SELLER_CATALOGUE).
                - KNOWLEDGE.ORG: 회사 운영 기준(배송·교환·반품·결제·증빙 등).
                - ENTITY.ORDER: 이 고객 주문의 **지금 상태**(결제·취소·발송·송장). 회사 기준은 이 답이 될 수 없습니다.
                - ENTITY.LISTING: 이 상품·옵션의 **지금 판매 상태**(판매중·품절).
                - PROCEDURE.ORDER_ACTION: 주문에 **변경을 가하거나** 정해진 업무 절차를 수행해야 하는 요청(취소·반품·교환·환불·재발송·주소 변경 등).
                - SELLER: 위 어디에도 없고 판매자가 **새로 판단**해야 하는 것.
                규칙:
                - **읽어서 답이 되면 PROCEDURE가 아닙니다.** 주문 상태나 송장 번호를 알려 달라는 요청은 ENTITY.ORDER로 끝냅니다.
                  PROCEDURE는 외부 상태 변경이나 정해진 업무 절차가 필요할 때만 씁니다.
                  closing_authority가 PROCEDURE이면 그 주문을 읽는 ENTITY.ORDER step을 함께 적습니다.
                - **판매자가 한 번 정해서 알려 주면 다음 고객에게도 쓸 수 있는 답**(운영 기준·상품 사실·상품 비교)은 SELLER가 아니라 KNOWLEDGE입니다.
                  SELLER는 이 주문·이 시점에만 해당하는 판단(예외 처리, 재입고 시점)일 때만 씁니다.
                - closing_authority: **이 need를 최종적으로 해결하는 권한 하나**를 먼저 정해서 적습니다(KNOWLEDGE · ENTITY_STATE · PROCEDURE · SELLER).
                  steps에는 그 해결에 **필요한 capability**를 적습니다. 어떤 step이 need를 닫는지는 steps의 순서나 위치가 아니라
                  closing_authority가 정합니다.
                - closing_authority와 같은 권한의 capability를 steps에 **반드시 하나 이상** 적습니다. 같은 권한의 capability 둘이
                  함께 답을 만들어야 하면 둘 다 적습니다(예: 이 상품의 스펙과 판매자 카탈로그를 같이 봐야 답이 되는 질문).
                - SELLER는 **판매자가 새로 판단해야 해서** 그 판단 자체가 답일 때만 closing_authority가 됩니다. 아는 것이 없거나,
                  연동이 없거나, 확신이 없어서 판매자에게 넘기는 것은 closing_authority가 아닙니다 — 그것은 시스템이 나중에 기록합니다.
                  혹시 몰라 SELLER를 덧붙이지 않습니다.
                - step은 **실행 순서대로** 적습니다(주문을 바꾸기 전에 그 주문을 먼저 읽습니다). 순서는 실행 순서일 뿐입니다.
                - ENTITY step은 읽을 필드를 하나 이상 적습니다.
                - customer_inputs: 고객이 아직 밝히지 않아 답이 달라지는 **상품 맥락 값**만 적습니다(규격·크기·모델·수량·사용 환경·치수).
                  이름·주문번호·연락처·주소 같은 신원 정보는 어떤 경우에도 묻지 않습니다.
                - 과거에 판매자가 쓴 답변은 근거가 아니므로 step이 되지 않습니다.
                - **이 배포가 지금 그 권한을 쓸 수 있는지는 고려하지 않습니다.** 의미상 필요하면 그대로 적습니다.
                출력은 스키마에 맞는 JSON만.""";
    }

    /** The customer's message and the four situation facts — nothing else. Unchanged since WP-2. */
    public static String user(String question, CapabilitySnapshot snapshot) {
        ObjectNode root = MAPPER.createObjectNode();
        root.put("customer", question);
        ObjectNode context = root.putObject("context");
        context.put("surface", snapshot == null ? InquirySurface.PUBLIC_QNA.name() : snapshot.surface().name());
        context.put("listing_resolved", snapshot != null && snapshot.variantCount() >= 0 && listing(snapshot));
        context.put("listing_option_count", snapshot == null ? 0 : snapshot.variantCount());
        ArrayNode askable = context.putArray("askable_customer_inputs");
        askableInputs(snapshot).forEach(i -> askable.add(i.name()));
        return root.toString();
    }

    private static boolean listing(CapabilitySnapshot snapshot) {
        return snapshot.status(CapabilityId.KNOWLEDGE_PRODUCT) == com.sellerops.inquiry.authority.CapabilityStatus.AVAILABLE;
    }

    /** Product-context values only, and never the v2 bridge's placeholder. */
    public static List<CustomerInput> askableInputs(CapabilitySnapshot snapshot) {
        InquirySurface surface = snapshot == null ? InquirySurface.PUBLIC_QNA : snapshot.surface();
        return java.util.Arrays.stream(CustomerInput.values())
                .filter(i -> i != CustomerInput.UNNAMED_PRODUCT_CONTEXT && i.askableOn(surface)).toList();
    }

    /**
     * Strict Structured Outputs: every object closed, every property required, every token an enum — and one branch per
     * capability, so a step can only carry what its own capability has a choice about.
     *
     * <p><b>What this schema guarantees and what it does not.</b> Strict mode honours {@code enum},
     * {@code additionalProperties: false} and {@code required}; it is documented as ignoring {@code minItems},
     * {@code maxItems} and {@code maxLength}. So "a knowledge step has no fields" and "an org step is never about a
     * listing" are structural, while "an entity step reads at least one field" and "an ask is at most 120 characters"
     * are declared here for a reader's benefit and actually enforced by {@link ResolutionPlan.Entity}'s constructor and
     * the parser's truncation. The counts are stated rather than assumed because this difference is exactly what
     * decides whether a contract failure is impossible or merely unlikely.
     */
    public static ObjectNode schema(CapabilitySnapshot snapshot) {
        ArrayNode branches = MAPPER.createArrayNode();
        for (CapabilityId capability : CapabilityId.values()) {
            branches.add(branch(capability));
        }
        ObjectNode step = MAPPER.createObjectNode();
        step.set("anyOf", branches);

        ObjectNode need = object();
        ObjectNode needProps = need.putObject("properties");
        enumOf(needProps.putObject("id"), ids(ResolutionPlanValidator.MAX_NEEDS));
        needProps.putObject("ask").put("type", "string").put("maxLength", MAX_ASK);
        // WP-3.1: the ending is a property, and it stands BEFORE the steps. Strict Structured Outputs generates
        // properties in declaration order, so the model commits to who resolves the need before it writes what the
        // resolution requires — the opposite of the order that let the last step written become the closer.
        enumOf(needProps.putObject("closing_authority"), names(Authority.values()));
        ObjectNode steps = needProps.putObject("steps").put("type", "array")
                .put("minItems", 1).put("maxItems", ResolutionPlanValidator.MAX_STEPS);
        steps.set("items", step);
        ObjectNode inputs = needProps.putObject("customer_inputs").put("type", "array");
        enumOf(inputs.putObject("items"), askableInputs(snapshot).stream().map(Enum::name).toList());
        require(need);

        ObjectNode root = object();
        ObjectNode needs = root.putObject("properties").putObject("needs").put("type", "array")
                .put("minItems", 1).put("maxItems", ResolutionPlanValidator.MAX_NEEDS);
        needs.set("items", need);
        require(root);

        ObjectNode format = MAPPER.createObjectNode();
        format.put("type", "json_schema");
        ObjectNode js = format.putObject("json_schema");
        js.put("name", "resolution_plan").put("strict", true);
        js.set("schema", root);
        return format;
    }

    /**
     * One capability's step shape. {@code capability} is a one-value enum, which is what discriminates the branch;
     * {@code scope} appears only where the capability is about more than one kind of instance; {@code fields} only where
     * there is state to read, and then only that capability's own fields.
     */
    private static ObjectNode branch(CapabilityId capability) {
        ObjectNode branch = object();
        ObjectNode props = branch.putObject("properties");
        enumOf(props.putObject("capability"), List.of(capability.wire()));
        List<String> scopes = ResolutionPlan.SCOPES.get(capability).stream().map(Enum::name).sorted().toList();
        if (scopes.size() > 1) {
            enumOf(props.putObject("scope"), scopes);
        }
        if (capability.authority() == Authority.ENTITY_STATE) {
            ObjectNode fields = props.putObject("fields").put("type", "array").put("minItems", 1);
            enumOf(fields.putObject("items"), java.util.Arrays.stream(EntityField.values())
                    .filter(f -> f.capability() == capability).map(Enum::name).toList());
        }
        require(branch);
        return branch;
    }

    private static ObjectNode object() {
        return MAPPER.createObjectNode().put("type", "object").put("additionalProperties", false);
    }

    private static void require(ObjectNode object) {
        ArrayNode required = object.putArray("required");
        object.path("properties").fieldNames().forEachRemaining(required::add);
    }

    private static void enumOf(ObjectNode node, List<String> values) {
        node.put("type", "string");
        ArrayNode e = node.putArray("enum");
        values.forEach(e::add);
    }

    private static List<String> names(Enum<?>[] values) {
        return java.util.Arrays.stream(values).map(Enum::name).toList();
    }

    private static List<String> ids(int max) {
        return java.util.stream.IntStream.rangeClosed(1, max).mapToObj(i -> "N" + i).toList();
    }
}
