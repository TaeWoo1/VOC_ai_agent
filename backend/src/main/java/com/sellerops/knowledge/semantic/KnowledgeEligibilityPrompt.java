package com.sellerops.knowledge.semantic;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.util.List;

/**
 * The two turns the evidence judge is sent, written once so a test can read them.
 *
 * <p><b>The rule that had to be measured before it could be written.</b> The first version of this
 * instruction said that if the customer asked no question, no passage supports an answer. It protects
 * compliments and it is wrong about the class this product exists for: 「배송이 너무 느려서
 * 실망했습니다」 asks nothing and the shipping policy is exactly what the seller answers with. On the
 * benchmark that one clause cost three complaint questions and three ordinary ones (recall 92.5% →
 * 84.9%). What replaced it asks whether there is something to tell this customer.
 *
 * <p>No product vocabulary, no seller example, no synonym list — the judgement is about whether a
 * fact is present, which is a question about these two texts and not about any domain.
 */
final class KnowledgeEligibilityPrompt {

    private static final ObjectMapper MAPPER = new ObjectMapper();

    private KnowledgeEligibilityPrompt() {
    }

    static String system() {
        return """
                당신은 고객의 문장 하나와 후보 문단 여러 개를 받고, 각 문단이 그 문장에 답할 때 판매자가 인용할 사실을 실제로 담고 있는지 판정합니다.
                규칙:
                - 주제가 가깝다는 것만으로는 참이 아닙니다. 고객이 말한 바로 그 일에 대한 사실이 문단 안에 있어야 참입니다.
                - 고객이 질문하지 않고 불만이나 상황만 말했더라도, 그 일에 대해 안내할 사실이 문단에 있으면 참입니다.
                - 고객이 칭찬이나 인사만 남겨서 안내할 것이 없다면 거짓입니다.
                - 문단을 고쳐 쓰거나 답변을 작성하지 않습니다. 판정만 합니다.
                출력은 {"verdicts":[{"i":정수,"supports":true|false}]} 형식의 JSON만.""";
    }

    /** The customer's sentence and the passages, by position — no identifiers of any kind. */
    static String user(String question, List<String> passages) {
        ObjectNode root = MAPPER.createObjectNode();
        root.put("customer", question);
        ArrayNode array = root.putArray("passages");
        for (int i = 0; i < passages.size(); i++) {
            ObjectNode item = array.addObject();
            item.put("i", i);
            item.put("text", passages.get(i));
        }
        return root.toString();
    }
}
