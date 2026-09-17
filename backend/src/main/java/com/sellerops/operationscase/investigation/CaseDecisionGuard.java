package com.sellerops.operationscase.investigation;

import com.sellerops.operationscase.CaseConfidence;
import com.sellerops.operationscase.CaseDisposition;
import com.sellerops.operationscase.RecommendedActionType;
import com.sellerops.operationscase.RequiredAuthority;
import java.util.ArrayList;
import java.util.List;

/**
 * <b>What a model's conclusion is allowed to change.</b> The model proposes; this decides what stands.
 *
 * <ul>
 *   <li>A recommendation that needs human authority (a customer message, money, a cancellation, a knowledge or
 *   listing change) keeps the case with the seller — it cannot be AUTO_RESOLVED or MONITORING.</li>
 *   <li>LOW confidence never closes or parks anything: an uncertain judgement is the seller's.</li>
 *   <li>A customer still waiting for an answer (an UNANSWERED inquiry) is always the seller's decision.</li>
 *   <li>AUTO_RESOLVED must recommend NO_ACTION; MONITORING must recommend watching or nothing.</li>
 *   <li>A sentence that claims something was done («보냈습니다», «환불했습니다») never reaches a screen — nothing
 *   here does anything, so the sentence would be false.</li>
 * </ul>
 *
 * <p>Every rule only moves a case TOWARD the seller. None can move a case away from them.
 */
public final class CaseDecisionGuard {

    static final List<String> COMPLETION_CLAIMS = List.of(
            "보냈습니다", "보내드렸습니다", "전송했습니다", "발송했습니다", "환불했습니다", "환불해 드렸습니다",
            "환불해드렸습니다", "처리했습니다", "처리 완료", "처리완료", "답변했습니다", "답변을 드렸습니다",
            "답변드렸습니다", "취소했습니다", "교환해 드렸습니다", "교환해드렸습니다", "보상했습니다", "해결했습니다");

    private CaseDecisionGuard() {
    }

    public record Applied(CaseDisposition disposition, RequiredAuthority authority, String summary,
                          String recommendedAction, List<String> guards) {
    }

    public static Applied apply(CaseInvestigationOutput output, boolean customerWaiting) {
        return apply(output, customerWaiting, false);
    }

    /**
     * @param knowledgeConflict the company's own knowledge states different figures about this case's topic. Which
     *                          one is right is the seller's to say, so nothing is closed or parked on it.
     */
    public static Applied apply(CaseInvestigationOutput output, boolean customerWaiting, boolean knowledgeConflict) {
        List<String> guards = new ArrayList<>();
        CaseDisposition disposition = output.disposition();
        RecommendedActionType action = output.recommendedActionType();
        if (disposition != CaseDisposition.NEEDS_DECISION) {
            if (action.authority() == RequiredAuthority.HUMAN) {
                guards.add("HUMAN_AUTHORITY");
            } else if (output.confidence() == CaseConfidence.LOW) {
                guards.add("LOW_CONFIDENCE");
            } else if (customerWaiting) {
                guards.add("CUSTOMER_WAITING");
            } else if (disposition == CaseDisposition.AUTO_RESOLVED && action != RecommendedActionType.NO_ACTION) {
                guards.add("RESOLVE_REQUIRES_NO_ACTION");
            } else if (knowledgeConflict) {
                guards.add("KNOWLEDGE_CONFLICT");
            }
            if (!guards.isEmpty()) {
                disposition = CaseDisposition.NEEDS_DECISION;
            }
        }
        String summary = output.summary();
        String recommended = output.recommendedAction();
        if (claimsCompletion(summary)) {
            summary = null;
            guards.add("COMPLETION_CLAIM_SUMMARY");
        }
        if (claimsCompletion(recommended)) {
            recommended = null;
            guards.add("COMPLETION_CLAIM_ACTION");
        }
        RequiredAuthority authority = disposition == CaseDisposition.NEEDS_DECISION
                ? RequiredAuthority.HUMAN : RequiredAuthority.AUTO;
        return new Applied(disposition, authority, summary, recommended, List.copyOf(guards));
    }

    static boolean claimsCompletion(String text) {
        if (text == null) {
            return false;
        }
        String flat = text.replaceAll("\\s+", " ");
        return COMPLETION_CLAIMS.stream().anyMatch(flat::contains);
    }
}
