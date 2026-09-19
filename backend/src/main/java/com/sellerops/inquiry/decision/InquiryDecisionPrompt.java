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
    /** The coverage judge's instruction, selectable so the calibration can compare v1 and v2 on identical inputs. */
    public static final String JUDGE_V1 = "coverage-judge/v1";
    public static final String JUDGE_V2 = "coverage-judge/v2";
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

    static String judgeSystem(String version) {
        return JUDGE_V1.equals(version) ? judgeSystem() : judgeSystemV2();
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

    /**
     * <b>CoverageJudge v2</b> (Inquiry Decision v2.1). The first real-model run found the v1 judge promoting evidence
     * that was RELATED to FULL — inferring past the text, and answering values that depend on a variant nobody named.
     * v2 separates 「관련 있다」 from 「추가 가정 없이 답이 정해진다」 and makes the judge SAY what it leaned on, as lists
     * code can check ({@link NeedAggregation#enforce}). Still no product vocabulary: what can vary is named by kind
     * (규격·옵션·수량·사용 환경·주문 상태), never by an example from a catalogue.
     */
    static String judgeSystemV2() {
        return """
                당신은 판매자가 가진 근거가 고객 문의의 need 하나하나를 "추가 가정 없이" 답하기에 충분한지 판정하는 심사자입니다. 근거가 need와 관련 있는지가 아니라, 근거만으로 이 고객에게 줄 답이 하나로 정해지는지를 판정합니다.
                입력: 고객 문의, need 목록(N…), 판매자의 현재 근거 후보(E…), 판매자가 예전에 쓴 답변(P…).
                status (need마다 하나):
                - FULL: E만으로 이 need의 답을 추가 가정 없이 확정적으로 말할 수 있습니다. 근거가 답을 직접 말하거나, 답을 정하는 모든 전제가 근거에 명시되어 있어 논리적으로 하나로 정해질 때만 FULL입니다.
                - CONDITIONAL_ON_CUSTOMER: 근거에 답이 들어 있지만, 고객만 아는 값(규격·옵션·수량·사용 환경 등)이 정해져야 답이 하나로 정해집니다. 그 값만 받으면 E로 답할 수 있어야 합니다.
                - PARTIAL: 관련 근거는 있지만, 답을 정하는 데 필요한 정보가 하나 이상 근거에 없습니다.
                - NONE: 이 need를 실질적으로 뒷받침하는 근거가 없습니다.
                지켜야 할 것:
                - 상식, 업계의 일반 지식, 비슷한 상품에 대한 짐작으로 근거의 빈칸을 채우지 않습니다.
                - 목록의 일부 항목에서 전체를, 한 경우에서 다른 경우를 추론하지 않습니다.
                - 답이 규격·옵션·수량·주문 상태에 따라 달라지는데 그 값이 문의에도 근거에도 확정되어 있지 않으면 FULL이 아닙니다.
                - 근거가 다른 상품이나 다른 판매 페이지에 대한 것이면 이 상품의 근거로 쓰지 않습니다.
                - 이 고객의 개별 주문 상태나 판매자의 판단이 있어야 답이 되는 need는, 일반 기준이 있어도 FULL이 아닙니다.
                - 예전 답변(P…)은 근거가 아닙니다. evidence에 P를 넣지 않고, P만 보고 FULL이나 CONDITIONAL_ON_CUSTOMER를 주지 않습니다.
                - 확신이 없으면 FULL이 아니라 PARTIAL이나 NONE을 고릅니다.
                need마다 쓸 것:
                - evidence: 판정을 직접 뒷받침하는 E id 목록. NONE이 아니면 하나 이상.
                - missing: 답을 정하는 데 필요하지만 근거에 없는 정보. 짧은 구절의 목록. PARTIAL·NONE이면 하나 이상, FULL이면 비어 있습니다.
                - customer_input: 답을 정하려면 고객에게서 받아야 하는 값. 짧은 구절의 목록. CONDITIONAL_ON_CUSTOMER이면 하나 이상.
                - assumptions: 이 판정이 근거에 쓰여 있지 않은 내용에 기대고 있다면 그 내용. 짧은 구절의 목록. FULL이면 비어 있어야 합니다.
                - ask_customer: CONDITIONAL_ON_CUSTOMER일 때 고객에게 물을 한 문장.
                - precedents: need가 FULL이나 CONDITIONAL_ON_CUSTOMER가 아닐 때, 예전 답변 중 이 need에 대한 일반적인 답으로 다시 쓸 수 있는 P id. 특정 주문·특정 시점·그 대화에만 해당하는 답은 넣지 않습니다.
                출력은 {"verdicts":[{"need":"N1","status":"...","evidence":["E1"],"missing":[],"customer_input":[],"assumptions":[],"ask_customer":"...","precedents":["P1"]}]} 형식의 JSON만.""";
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
