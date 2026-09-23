package com.sellerops.knowledge.teach.dto;

import com.sellerops.inquiry.draft.dto.DraftEvidenceView;
import com.sellerops.inquiry.publish.dto.AnswerDeliveryView;
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
                             List<KnowledgeUsed> knowledgeUsed, Gap gap, Draft draft, String to,
                             List<Media> media) {

    /** The shape every caller before review photos built. */
    public CaseDetailView(UUID caseId, boolean open, String subjectKind, String channelNameKo, String productName,
                          boolean productScopeAvailable, LocalDate receivedOn, Integer rating, String title,
                          String body, String reasonNote, String disposition, String decidedBy, String summary,
                          String recommendedActionType, String recommendedAction, List<String> missingInformation,
                          String whyDecisionNeeded, List<Investigated> investigated,
                          List<KnowledgeUsed> knowledgeUsed, Gap gap, Draft draft, String to) {
        this(caseId, open, subjectKind, channelNameKo, productName, productScopeAvailable, receivedOn, rating, title,
                body, reasonNote, disposition, decidedBy, summary, recommendedActionType, recommendedAction,
                missingInformation, whyDecisionNeeded, investigated, knowledgeUsed, gap, draft, to, List.of());
    }

    /**
     * One photo or video the customer attached to the review, and whether Reviewnary actually looked at it.
     *
     * @param inspected    true only when a vision model looked at the photo; {@code depicts} is null otherwise
     * @param statusKo     the seller's sentence for the state — 「사진을 확인했습니다」, 「사진 확인 기능이 꺼져 있어 보지 않았습니다」…
     * @param imagePath    the same-origin path that serves the photo to this seller, or null for a video
     */
    public record Media(int ordinal, String kind, boolean inspected, String statusKo, String depicts,
                        String problemVisible, String problemDescription, String imagePath) {
    }

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
    public record Gap(String missingSubject, String sentence, String suggestedScope, Prefill prefill,
                      List<NeedLine> needs) {

        public Gap(String missingSubject, String sentence, String suggestedScope) {
            this(missingSubject, sentence, suggestedScope, null, null);
        }

        public Gap(String missingSubject, String sentence, String suggestedScope, Prefill prefill) {
            this(missingSubject, sentence, suggestedScope, prefill, null);
        }
    }

    /**
     * One customer need, as the seller reads it on the Case (Inquiry Decision v2): what is already confirmed and by
     * what, and what is still missing. {@code prefill} is a REUSABLE past answer for this need, re-read and re-fenced
     * now — never an order's or a moment's answer.
     */
    public record NeedLine(String ask, String status, String statusKo, boolean covered, List<String> evidence,
                           String missing, String askCustomer, Prefill prefill, boolean systemWillRead) {
    }

    /**
     * The seller's own past answer, offered as the starting text of their answer to the gap (Past Answer Prefill v1).
     *
     * <p>It is not knowledge yet and the case does not treat it as a basis: it becomes company knowledge only when the
     * seller saves it — as it is or edited — through the same Teach path an empty box uses.
     *
     * @param text       the whole past answer, re-read from its source; never stored on the case
     * @param strengthKo how that answer came to be remembered — 「채널에 등록된 답변」, 「판매자가 승인한 답변」…
     * @param answeredOn when it was remembered, in KST
     */
    public record Prefill(String text, String strengthKo, LocalDate answeredOn) {
    }

    /**
     * The case's prepared answer, and — when one was sent — what became of it.
     *
     * <p>{@code delivery} sits here rather than on the case because a case never claims delivery: its
     * own vocabulary stops at «the seller acted», deliberately. This is the answer's record, quoted
     * from the rows the publish package writes, and an execution cannot exist without the approved
     * draft it was bound to — so there is no state where a delivery would have nowhere to hang.
     * {@code null} means nothing was ever dispatched for this work item.
     */
    public record Draft(int version, String title, String body, String authorKind, String answerBasis,
                        List<DraftEvidenceView> evidence, AnswerDeliveryView delivery) {
    }
}
