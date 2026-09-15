package com.sellerops.operationscase.investigation;

import static org.assertj.core.api.Assertions.assertThat;

import com.sellerops.operationscase.CaseConfidence;
import com.sellerops.operationscase.CaseDisposition;
import com.sellerops.operationscase.OperationsCaseKind;
import com.sellerops.operationscase.RecommendedActionType;
import com.sellerops.operationscase.RequiredAuthority;
import java.util.List;
import org.junit.jupiter.api.Test;

/** The model proposes; the guard decides what stands — and it only ever moves a case toward the seller. */
class CaseDecisionGuardTest {

    private static CaseInvestigationOutput out(CaseDisposition d, RecommendedActionType a, CaseConfidence c,
                                               String summary) {
        return new CaseInvestigationOutput(OperationsCaseKind.CUSTOMER_WORK, d, summary, a, "다음 한 걸음입니다.",
                List.of(), List.of("subject"), c);
    }

    @Test
    void anActionThatNeedsTheSellerCannotBeResolvedOrParked() {
        for (RecommendedActionType action : RecommendedActionType.values()) {
            if (action.authority() != RequiredAuthority.HUMAN) {
                continue;
            }
            for (CaseDisposition d : List.of(CaseDisposition.AUTO_RESOLVED, CaseDisposition.MONITORING)) {
                CaseDecisionGuard.Applied applied =
                        CaseDecisionGuard.apply(out(d, action, CaseConfidence.HIGH, "요약"), false);
                assertThat(applied.disposition()).as("%s/%s", action, d).isEqualTo(CaseDisposition.NEEDS_DECISION);
                assertThat(applied.authority()).isEqualTo(RequiredAuthority.HUMAN);
                assertThat(applied.guards()).contains("HUMAN_AUTHORITY");
            }
        }
    }

    @Test
    void lowConfidenceAndAWaitingCustomerStayWithTheSeller() {
        assertThat(CaseDecisionGuard.apply(out(CaseDisposition.AUTO_RESOLVED, RecommendedActionType.NO_ACTION,
                CaseConfidence.LOW, "요약"), false).disposition()).isEqualTo(CaseDisposition.NEEDS_DECISION);
        assertThat(CaseDecisionGuard.apply(out(CaseDisposition.MONITORING, RecommendedActionType.MONITOR_REPEAT_ISSUE,
                CaseConfidence.HIGH, "요약"), true).guards()).containsExactly("CUSTOMER_WAITING");
    }

    @Test
    void resolvingRequiresRecommendingNothing() {
        CaseDecisionGuard.Applied applied = CaseDecisionGuard.apply(out(CaseDisposition.AUTO_RESOLVED,
                RecommendedActionType.MONITOR_REPEAT_ISSUE, CaseConfidence.HIGH, "요약"), false);
        assertThat(applied.disposition()).isEqualTo(CaseDisposition.NEEDS_DECISION);
        assertThat(applied.guards()).containsExactly("RESOLVE_REQUIRES_NO_ACTION");
    }

    @Test
    void aSafeAutomaticConclusionStands() {
        CaseDecisionGuard.Applied resolved = CaseDecisionGuard.apply(out(CaseDisposition.AUTO_RESOLVED,
                RecommendedActionType.NO_ACTION, CaseConfidence.HIGH, "칭찬 리뷰입니다."), false);
        assertThat(resolved.disposition()).isEqualTo(CaseDisposition.AUTO_RESOLVED);
        assertThat(resolved.authority()).isEqualTo(RequiredAuthority.AUTO);
        assertThat(resolved.guards()).isEmpty();
        CaseDecisionGuard.Applied watched = CaseDecisionGuard.apply(out(CaseDisposition.MONITORING,
                RecommendedActionType.MONITOR_REPEAT_ISSUE, CaseConfidence.MEDIUM, "요약"), false);
        assertThat(watched.disposition()).isEqualTo(CaseDisposition.MONITORING);
    }

    @Test
    void aSentenceThatClaimsSomethingWasDoneNeverReachesTheScreen() {
        CaseDecisionGuard.Applied applied = CaseDecisionGuard.apply(out(CaseDisposition.NEEDS_DECISION,
                RecommendedActionType.REPLY_TO_CUSTOMER, CaseConfidence.MEDIUM, "고객에게 답변을 보냈습니다."), false);
        assertThat(applied.summary()).isNull();
        assertThat(applied.guards()).contains("COMPLETION_CLAIM_SUMMARY");
        assertThat(CaseDecisionGuard.claimsCompletion("환불 처리했습니다")).isTrue();
        assertThat(CaseDecisionGuard.claimsCompletion("환불 여부를 판단해 주세요.")).isFalse();
    }
}
