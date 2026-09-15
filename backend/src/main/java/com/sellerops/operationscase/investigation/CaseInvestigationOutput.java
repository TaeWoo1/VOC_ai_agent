package com.sellerops.operationscase.investigation;

import com.sellerops.operationscase.CaseConfidence;
import com.sellerops.operationscase.CaseDisposition;
import com.sellerops.operationscase.OperationsCaseKind;
import com.sellerops.operationscase.RecommendedActionType;
import java.util.List;

/**
 * The strict output of one investigation. Every field is required and every token is closed; a response missing
 * any of them is not an investigation, it is an off-schema failure, and the case stays with the seller.
 */
public record CaseInvestigationOutput(
        OperationsCaseKind caseKind,
        CaseDisposition disposition,
        String summary,
        RecommendedActionType recommendedActionType,
        String recommendedAction,
        List<String> missingInformation,
        List<String> evidenceRefs,
        CaseConfidence confidence) {

    public CaseInvestigationOutput {
        missingInformation = missingInformation == null ? List.of() : List.copyOf(missingInformation);
        evidenceRefs = evidenceRefs == null ? List.of() : List.copyOf(evidenceRefs);
    }

    CaseInvestigationOutput withEvidenceRefs(List<String> refs) {
        return new CaseInvestigationOutput(caseKind, disposition, summary, recommendedActionType,
                recommendedAction, missingInformation, refs, confidence);
    }
}
