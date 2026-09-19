package com.sellerops.inquiry.decision;

import com.sellerops.agent.access.AgentCapabilityAccess;
import com.sellerops.agent.llm.AgentLlmTransport;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.function.Supplier;
import org.springframework.stereotype.Service;

/**
 * <b>The door to the Inquiry Decision v2 capability</b>: the organisation gate, the two calls, and a short memo.
 *
 * <p><b>The memo's key is the exact request</b> — model, instruction, message, needs, candidates, past answers — so an
 * answer is reused only when nothing it depended on has changed. The investigation and the draft both assess the same
 * inquiry minutes apart; without it they pay twice and may be told two different things about the same evidence.
 * Five minutes, in memory, bounded; nothing is persisted.
 */
@Service
public class InquiryDecisionService implements InquiryDecisionModel {

    static final long MEMO_MILLIS = 5 * 60 * 1000L;
    static final int MEMO_MAX = 256;

    private final InquiryDecisionProperties properties;
    private final AgentCapabilityAccess access;
    private final InquiryDecisionGenerator generator;
    private final Map<String, Memo> memo = new LinkedHashMap<>(16, 0.75f, true);

    private record Memo(Object value, long at) {
    }

    public InquiryDecisionService(InquiryDecisionProperties properties, AgentCapabilityAccess access,
                                  AgentLlmTransport transport) {
        this.properties = properties;
        this.access = access;
        this.generator = properties == null ? null : new InquiryDecisionGenerator(transport, properties);
    }

    /** A capability that is not present — what a unit test and a context without it get. */
    public static InquiryDecisionService disabled() {
        return new InquiryDecisionService(null, null, null);
    }

    @Override
    public boolean enabledFor(UUID orgId) {
        if (properties == null) {
            return false;
        }
        return access == null ? properties.isEnabledFor(orgId) : access.allows(properties, orgId);
    }

    @Override
    public Answer<List<InquiryNeed>> plan(UUID orgId, String question) {
        if (!enabledFor(orgId) || question == null || question.isBlank()) {
            return Answer.none();
        }
        String body = generator.planBody(question);
        return remembered(body, () -> generator.plan(orgId, body));
    }

    @Override
    public Answer<Map<String, NeedVerdict>> judge(UUID orgId, String question, List<InquiryNeed> needs,
                                                  List<EvidenceCandidate> evidence,
                                                  List<PrecedentCandidate> precedents) {
        if (!enabledFor(orgId) || needs == null || needs.isEmpty()) {
            return Answer.none();
        }
        String body = generator.judgeBody(question, needs, evidence, precedents);
        return remembered(body, () -> generator.judge(orgId, body, needs.stream().map(InquiryNeed::id).toList(),
                evidence.size(), precedents.size()));
    }

    /** A remembered answer costs nothing; a refused one is not remembered, so the next assessment may try again. */
    @SuppressWarnings("unchecked")
    private <T> Answer<T> remembered(String body, Supplier<Answer<T>> call) {
        String key = sha256(body);
        long now = System.currentTimeMillis();
        synchronized (memo) {
            Memo m = memo.get(key);
            if (m != null && now - m.at() < MEMO_MILLIS) {
                return new Answer<>((T) m.value(), CallCost.NONE);
            }
        }
        Answer<T> answer = call.get();
        if (answer.value() != null) {
            synchronized (memo) {
                memo.put(key, new Memo(answer.value(), now));
                while (memo.size() > MEMO_MAX) {
                    memo.remove(memo.keySet().iterator().next());
                }
            }
        }
        return answer;
    }

    private static String sha256(String s) {
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(s.getBytes(StandardCharsets.UTF_8)));
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }

    /** For the payload floor test. */
    InquiryDecisionGenerator generator() {
        return generator;
    }
}
