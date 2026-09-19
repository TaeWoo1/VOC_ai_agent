package com.sellerops.inquiry.decision;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.util.List;

/**
 * The two instructions of Inquiry Decision v2, written once so tests can read them.
 *
 * <p><b>No product vocabulary, no synonym list, no example from a seller's catalogue.</b> Both judgements are about the
 * relation between a customer's message and texts the seller wrote — what the customer needs, and whether a text
 * answers it — and neither is a question about any domain. The only closed words are the eight need types and the
 * four statuses the code aggregates.
 */
public final class InquiryDecisionPrompt {

    public static final String VERSION = "inquiry-decision/v1";
    private static final ObjectMapper MAPPER = new ObjectMapper();

    private InquiryDecisionPrompt() {
    }

    static String planSystem() {
        return """
                당신은 고객이 판매자에게 보낸 문의 하나를 읽고, 답변에 포함되지 않으면 고객의 요청이 해결되지 않는 독립적인 정보·행동 단위(need)로 나눕니다.
                규칙:
                - 고객이 실제로 묻거나 요청한 것만 need입니다. 그 need에 답하는 데 필요한 배경·전제 사실은 need로 만들지 않습니다.
                - 같은 것을 다른 말로 반복한 것은 하나의 need입니다. 인사·감사·감정 표현은 need가 아닙니다.
                - 질문 없이 불만이나 상황만 적혀 있으면, 판매자가 해결해 줘야 하는 것을 need로 씁니다.
                - ask는 판매자가 읽을 짧은 한국어 문장(120자 이하)입니다. 이름·주소·전화번호·주문번호·송장번호 같은 개인정보를 넣지 않습니다.
                - search는 판매자 자료에서 이 need의 답을 찾을 짧은 검색 문구입니다.
                - type은 다음 중 하나입니다: PRODUCT_SPEC(치수·재질·구성 등 상품 사실), PRODUCT_USAGE(설치·사용·분리·관리 방법), PRODUCT_COMPATIBILITY(다른 물건·용도와 맞는지, 어떤 규격을 골라야 하는지), CATALOGUE_AVAILABILITY(판매 여부·옵션·재고·재입고), POLICY(배송·교환·반품·결제·증빙 등 운영 기준), ORDER_STATE(이 고객 주문의 상태), ORDER_ACTION(이 고객 주문에 대한 조치 요청), SELLER_DECISION(예외·보상·할인·추천처럼 판매자가 정해야 하는 것).
                출력은 {"needs":[{"id":"N1","ask":"...","type":"...","search":"..."}]} 형식의 JSON만.""";
    }

    static String planUser(String question) {
        ObjectNode root = MAPPER.createObjectNode();
        root.put("customer", question);
        return root.toString();
    }

    static String judgeSystem() {
        return """
                당신은 고객 문의, 그 문의의 need 목록, 판매자가 가진 현재 근거 후보(E…), 판매자가 예전에 쓴 답변(P…)을 받습니다. need마다, 현재 근거만으로 그 need를 이 고객에게 실제로 답할 수 있는지 판정합니다.
                status:
                - FULL: 근거만으로 이 need에 대해 고객에게 필요한 답을 끝까지 말할 수 있습니다.
                - CONDITIONAL_ON_CUSTOMER: 근거에 답이 있지만 고객이 아직 밝히지 않은 정보(규격·옵션·사용 환경 등)에 따라 달라지므로, 그 정보를 고객에게 물어야 답이 정해집니다.
                - PARTIAL: 근거가 이 need의 일부만 답합니다.
                - NONE: 근거가 이 need를 답하지 못합니다.
                규칙:
                - 주제가 관련 있다는 것만으로는 FULL이 아닙니다. 이 고객에게 이 need의 답을 말할 수 있어야 FULL입니다.
                - 근거에 없는 내용을 추측하거나 보충하지 않습니다.
                - 일반 기준이 있어도, 이 고객의 개별 주문 상태나 판매자의 판단이 있어야 답이 되는 need는 FULL이 아닙니다.
                - 예전 답변(P…)은 근거가 아닙니다. evidence에 P를 넣지 않습니다.
                - evidence: 판정을 지지하는 E id 목록. FULL·CONDITIONAL_ON_CUSTOMER·PARTIAL이면 하나 이상이어야 합니다.
                - missing: PARTIAL이나 NONE일 때, 무엇이 부족한지 판매자가 읽을 한 문장.
                - ask_customer: CONDITIONAL_ON_CUSTOMER일 때 고객에게 물을 한 문장.
                - precedents: need가 FULL이나 CONDITIONAL_ON_CUSTOMER가 아닐 때, 예전 답변 중 이 need에 다시 써도 되는 일반적인 답의 P id. 특정 주문·특정 시점·그 대화에만 해당하는 답(그 주문을 발송했다, 그 주소로 바꿨다, 그때 재고가 없었다 등)은 넣지 않습니다.
                출력은 {"verdicts":[{"need":"N1","status":"...","evidence":["E1"],"missing":"...","ask_customer":"...","precedents":["P1"]}]} 형식의 JSON만.""";
    }

    /** Needs, evidence and past answers by POSITION — no database id, no organisation, no customer identifier. */
    static String judgeUser(String question, List<InquiryNeed> needs, List<EvidenceCandidate> evidence,
                            List<PrecedentCandidate> precedents) {
        ObjectNode root = MAPPER.createObjectNode();
        root.put("customer", question);
        ArrayNode n = root.putArray("needs");
        for (InquiryNeed need : needs) {
            n.addObject().put("id", need.id()).put("ask", need.ask()).put("type", need.type().name());
        }
        ArrayNode e = root.putArray("evidence");
        for (EvidenceCandidate c : evidence) {
            e.addObject().put("id", c.id()).put("source", c.kind().scopeLabelKo()).put("title", c.label())
                    .put("text", c.text());
        }
        ArrayNode p = root.putArray("precedents");
        for (PrecedentCandidate c : precedents) {
            p.addObject().put("id", c.id()).put("text", c.text());
        }
        return root.toString();
    }
}
