package com.sellerops.knowledge.teach.dto;

import com.sellerops.inquiry.draft.dto.DraftEvidenceView;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

/**
 * One customer-operations case, as the seller reads it: what happened, what Reviewnary looked at, which company
 * knowledge it used, what it recommends, why the seller is needed — and, when knowledge is missing, exactly what.
 *
 * @param body the customer's words, sanitized (contacts, order numbers masked) — the seller's own screen, as on the
 *             inquiry screen; never stored on the case
 */
public record CaseDetailView(UUID caseId, boolean open, String subjectKind, String channelNameKo, String productName,
                             boolean productScopeAvailable, LocalDate receivedOn, Integer rating, String title,
                             String body, String reasonNote, String disposition, String decidedBy, String summary,
                             String recommendedActionType, String recommendedAction, List<String> missingInformation,
                             String whyDecisionNeeded, List<Investigated> investigated,
                             List<KnowledgeUsed> knowledgeUsed, Gap gap, Draft draft, String to) {

    /** One thing Reviewnary read, in the seller's words, with how much it found. */
    public record Investigated(String label, int results) {
    }

    /**
     * Company knowledge the investigation or the draft used, with its authority and provenance.
     *
     * @param pastAnswer   an answer or reply the seller actually gave before — precedent, never a current basis alone
     * @param reusableText the whole of that past answer, so the seller can confirm it as today's basis in one step;
     *                     null for every other kind of knowledge (it already is a basis, or is not the seller's words)
     */
    public record KnowledgeUsed(String authority, String provenance, String title, String excerpt,
                                LocalDate capturedOn, boolean cited, String scope, boolean pastAnswer,
                                String reusableText) {
    }

    /**
     * What the seller can supply so this case can be answered.
     *
     * @param sentence the one line the screen shows: 「방수」에 대해 고객에게 안내할 기준이 없습니다.
     */
    public record Gap(String missingSubject, String sentence, String suggestedScope) {
    }

    public record Draft(int version, String title, String body, String authorKind, String answerBasis,
                        List<DraftEvidenceView> evidence) {
    }
}
