package com.sellerops.inquiry.goal;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.sellerops.inquiry.authority.CapabilitySnapshot;
import com.sellerops.inquiry.authority.InquirySurface;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.HexFormat;

/**
 * <b>The Customer Goal Interpreter's instruction, payload and strict schema</b> (Inquiry v3.5).
 *
 * <p>This replaces {@code ResolutionPlannerPrompt}, and almost everything about it is smaller. The planner's
 * instruction had to teach seven capabilities, a closing authority, execution order, entity fields, customer inputs
 * and a procedure rule, because it was asked to compose a workflow. <b>This one teaches four words and a boundary</b>,
 * because the only question it asks is what the customer requested.
 *
 * <h2>What is deliberately absent from the instruction</h2>
 *
 * <p>There is nothing here about capabilities, authorities, steps, entity fields, execution order, procedures, search
 * scope or what this deployment can do. Not as an omission — <b>the schema has no slot for any of them</b>, so the
 * instruction has nothing to say about them. Every one of those was a measured planner failure, and a model that
 * cannot express a thing cannot be told to be careful with it.
 *
 * <h2>The payload floor</h2>
 *
 * <p>The customer's message, and <b>two</b> facts: the surface, and whether a listing is resolved. The planner sent
 * four; this drops the option count and the askable customer inputs, because a goal never names an option and never
 * asks for anything — the resolvers own both. No identifier of any kind, no seller text, no past answer, and no
 * availability. Availability is out for the same reason it was out of the planner: told what this deployment can do,
 * a model quietly rewrites what the customer asked for, and {@code S:N2} — "please issue a tax invoice", which this
 * registry has no procedure for at all — is the row where that temptation is strongest and most forbidden.
 *
 * <h2>The one thing that is new</h2>
 *
 * <p>A message may carry a <b>customer-stated fallback</b>: "send just the nozzle; if that is impossible, refund me."
 * The instruction says that such a relationship may be emitted <b>only by quoting the clause that states it</b>, and
 * the schema requires that quote, so a fallback with no sentence behind it cannot be produced. See
 * {@link GoalRelation}.
 */
public final class CustomerGoalPrompt {

    public static final String VERSION = "customer-goal-interpreter/v1";

    /** Three goals of short closed tokens, plus the requests. Measured shapes sit far below this. */
    public static final int MAX_OUTPUT_TOKENS = 700;

    private static final ObjectMapper MAPPER = new ObjectMapper();

    private CustomerGoalPrompt() {
    }

    public static String system() {
        return """
                당신은 고객이 판매자에게 보낸 문의 하나를 읽고, **고객이 이 메시지로 무엇을 얻고자 했는지**만 적습니다.
                어떻게 처리할지, 무엇을 먼저 확인할지, 누가 답할지는 적지 않습니다. 답을 쓰지도 않습니다.
                goal 나누기:
                - 고객이 **실제로 묻거나 요청한 것**만 goal입니다. 답을 만들기 위해 먼저 확인해야 하는 것은 goal이 아닙니다.
                - 같은 것을 다른 말로 반복한 것은 하나의 goal입니다. 인사·감사·감정 표현은 goal이 아닙니다.
                - 요청이 하나도 없으면 goals를 빈 배열로 둡니다. 없는 요청을 만들지 않습니다.
                - explicit_request는 고객의 표현을 그대로 짧게 옮긴 한국어 문장(140자 이하)입니다. 이름·주소·전화번호·주문번호를 넣지 않습니다.
                requested_outcome — 이 네 값만 씁니다:
                - INFORMATION: 사실을 알려 달라(치수·재질·구성·사용법·호환·차이·추천).
                - STATE_READ: 이 주문이나 이 상품의 **지금 상태**를 알려 달라(어디까지 왔는지·발송했는지·품절인지).
                - DECISION: 해 줄 수 있는지 **판단해 달라**(가능한가요·해 주실 수 있나요·다시 들어오나요·할인되나요).
                - ACTION: 실제로 **해 달라**(취소해 주세요·환불해 주세요·다시 보내 주세요·변경해 주세요).
                규칙:
                - **DECISION과 ACTION은 문장 형태가 아니라 고객이 원한 결과로 가릅니다.** 「~할 수 있나요?」가 판단을 묻는
                  것이면 DECISION이고, 실제 수행을 요청하는 것이면 ACTION입니다. 둘 다 요청했으면 goal 둘을 적습니다.
                - **판단을 요청했다고 해서 그 뒤의 실행을 goal로 만들지 않습니다.** 승인해 줄 수 있는지 물은 고객은 승인을
                  요청한 것이고, 승인 뒤의 처리는 이 메시지의 요청이 아닙니다.
                - **지금 이 시스템이 그것을 할 수 있는지는 고려하지 않습니다.** 고객이 요청한 그대로 적습니다.
                - subject: 이 요청이 무엇에 대한 것인지 하나 고릅니다.
                  CURRENT_LISTING(이 상품) · SELLER_CATALOGUE(판매자가 파는 다른 상품이나 상품들) ·
                  CURRENT_ORDER(이 고객의 주문) · ORGANIZATION(회사 운영 전반) · UNRESOLVED(이 중 어느 것도 아님).
                - basis: 고객이 말로 요청했으면 STATED, 말하지는 않았지만 그 문장이 곧 그 요청이면 DIRECTLY_IMPLIED입니다.
                  추측해야 알 수 있는 것은 goal이 아닙니다.
                - explicit_constraints: **고객이 실제로 말한 값**만 적습니다(규격·색상·수량 등, 각 40자 이하).
                  고객이 말하지 않은 값은 적지 않습니다. 없으면 빈 배열입니다.
                - relations: 고객이 **「A가 안 되면 B」처럼 두 요청 사이의 조건을 직접 말했을 때만** 적습니다.
                  stated_condition에는 그 조건을 말한 **고객의 표현을 그대로** 옮깁니다(60자 이하). 고객이 조건을 말하지
                  않았으면 relations는 빈 배열입니다. 순서·절차·선후 관계를 나타내는 용도가 아닙니다.
                출력은 스키마에 맞는 JSON만.""";
    }

    /** The customer's message and two situation facts — narrower than the planner's payload, never wider. */
    public static String user(String question, CapabilitySnapshot snapshot) {
        ObjectNode root = MAPPER.createObjectNode();
        root.put("customer", question);
        ObjectNode context = root.putObject("context");
        context.put("surface", snapshot == null ? InquirySurface.PUBLIC_QNA.name() : snapshot.surface().name());
        context.put("listing_resolved", snapshot != null
                && snapshot.status(com.sellerops.inquiry.authority.CapabilityId.KNOWLEDGE_PRODUCT)
                == com.sellerops.inquiry.authority.CapabilityStatus.AVAILABLE);
        return root.toString();
    }

    /**
     * Strict Structured Outputs: every object closed, every property required, every token an enum. The enums are
     * generated from {@link RequestedOutcome}, {@link Referent}, {@link RequestBasis} and
     * {@link GoalRelation.Kind}, which are the same declarations the record constructors read, so the wire and the
     * contract cannot drift.
     *
     * <p><b>What this guarantees and what it does not.</b> Strict mode honours {@code enum},
     * {@code additionalProperties: false} and {@code required}; it is documented as ignoring {@code maxLength}. So
     * "a goal has no procedure field" and "an outcome is one of four" are structural, while the length limits are
     * declared for a reader and actually enforced by {@link CustomerGoal}'s and {@link GoalRelation}'s constructors.
     * The distinction is stated rather than assumed because it is what decides whether a contract failure is
     * impossible or merely unlikely.
     */
    public static ObjectNode schema() {
        ObjectNode goal = MAPPER.createObjectNode();
        goal.put("type", "object").put("additionalProperties", false);
        ObjectNode gp = goal.putObject("properties");
        gp.putObject("id").put("type", "string");
        gp.putObject("explicit_request").put("type", "string").put("maxLength", CustomerGoal.MAX_REQUEST);
        enumOf(gp.putObject("requested_outcome"), names(RequestedOutcome.values()));
        enumOf(gp.putObject("subject"), names(Referent.values()));
        enumOf(gp.putObject("basis"), names(RequestBasis.values()));
        ObjectNode constraints = gp.putObject("explicit_constraints");
        constraints.put("type", "array").putObject("items").put("type", "string")
                .put("maxLength", CustomerGoal.MAX_CONSTRAINT);
        required(goal, "id", "explicit_request", "requested_outcome", "subject", "basis", "explicit_constraints");

        ObjectNode relation = MAPPER.createObjectNode();
        relation.put("type", "object").put("additionalProperties", false);
        ObjectNode rp = relation.putObject("properties");
        enumOf(rp.putObject("kind"), names(GoalRelation.Kind.values()));
        rp.putObject("primary_goal_id").put("type", "string");
        rp.putObject("fallback_goal_id").put("type", "string");
        rp.putObject("stated_condition").put("type", "string").put("maxLength", GoalRelation.MAX_CONDITION);
        required(relation, "kind", "primary_goal_id", "fallback_goal_id", "stated_condition");

        ObjectNode root = MAPPER.createObjectNode();
        root.put("type", "object").put("additionalProperties", false);
        ObjectNode p = root.putObject("properties");
        p.putObject("goals").put("type", "array").set("items", goal);
        p.putObject("relations").put("type", "array").set("items", relation);
        required(root, "goals", "relations");
        return root;
    }

    /** What a run recorded against this prompt is a run OF. Both halves, so neither can move unnoticed. */
    public static String fingerprint() {
        return VERSION + " system=" + sha256(system()) + " schema=" + sha256(schema().toString());
    }

    public static String sha256(String s) {
        try {
            byte[] digest = MessageDigest.getInstance("SHA-256").digest(s.getBytes(StandardCharsets.UTF_8));
            return HexFormat.of().formatHex(digest);
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }

    private static void enumOf(ObjectNode node, String[] values) {
        node.put("type", "string");
        ArrayNode allowed = node.putArray("enum");
        for (String v : values) {
            allowed.add(v);
        }
    }

    private static void required(ObjectNode object, String... keys) {
        ArrayNode required = object.putArray("required");
        for (String k : keys) {
            required.add(k);
        }
    }

    private static String[] names(Enum<?>[] values) {
        String[] out = new String[values.length];
        for (int i = 0; i < values.length; i++) {
            out[i] = values[i].name();
        }
        return out;
    }
}
