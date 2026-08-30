package com.sellerops.inquiry.draft;

import com.sellerops.knowledge.KnowledgeTopic;
import com.sellerops.knowledge.RetrievalOutcome;

/**
 * <b>Whether this question can be answered at all, and if not, what is missing.</b>
 *
 * <p><b>It is a projection, not a classifier.</b> Every value is a pure function of two things that
 * already existed — {@link DraftKnowledgeState}, which says what the library could offer, and
 * {@link SpecApplicability.Applicability}, which says whether the answer moves with the option
 * chosen. Nothing here reads the customer's text, nothing calls a model, and no third input is
 * consulted. That is deliberate (product-owner, 2026-08-26): the two signals were already computed on
 * every draft and were being used for two different sentences, and the state a seller needs is the
 * combination of them, not a new judgement about the same words.
 *
 * <p><b>The operational consequence is {@link #NO_ANSWER_BASIS}.</b> In that state SellerOps makes no
 * model call and writes no draft. A model handed no evidence produces a plausible, fluent, polite
 * paragraph committing to nothing — 「확인 후 안내드리겠습니다」 — and that paragraph is worse than an
 * empty box, because it looks like work was done. The seller writes their own reply, and the screen
 * says which basis is missing.
 *
 * <p>{@link #NEEDS_CLARIFICATION} is the opposite case and it is a real answer: there IS evidence,
 * and the one thing standing between it and a correct reply is a fact only the customer has. Asking
 * for it is the whole reply, and it invents nothing.
 */
public enum AnswerBasisState {

    /** Current evidence exists and applies to this question as asked. */
    GROUNDED,

    /**
     * Evidence exists, but a fact the customer has not given decides which part of it applies.
     *
     * <p>Today that fact is always the 규격·옵션. A reply in this state asks for exactly that and
     * states nothing else — no policy, no figure, no promise.
     */
    NEEDS_CLARIFICATION,

    /** No current evidence. Nothing is generated; the seller writes the reply. */
    NO_ANSWER_BASIS;

    /**
     * The projection.
     *
     * <p>Order matters and it is the honest one: the absence of evidence beats everything, because a
     * clarification question asked with nothing behind it is still a reply with no basis. A past
     * answer alone never reaches {@link #GROUNDED} here for the same reason it never reaches
     * {@link DraftKnowledgeState#GROUNDED} — that verdict is earned by current evidence and this
     * reads it rather than re-deciding it.
     */
    public static AnswerBasisState of(DraftKnowledgeState knowledge,
                                      SpecApplicability.Applicability applicability) {
        if (knowledge == null || !knowledge.grounded()) {
            return NO_ANSWER_BASIS;
        }
        return applicability == SpecApplicability.Applicability.VARIANT_UNRESOLVED
                ? NEEDS_CLARIFICATION : GROUNDED;
    }

    /** Whether a model may be asked to write this draft at all. */
    public boolean mayGenerate() {
        return this != NO_ANSWER_BASIS;
    }

    /** The sentence shown above the draft area. States what is missing; promises nothing. */
    public String messageKo() {
        return switch (this) {
            case GROUNDED -> "답변에 필요한 정보를 확인했습니다.";
            case NEEDS_CLARIFICATION -> "정확한 답변을 위해 고객에게 확인할 내용이 있습니다.";
            case NO_ANSWER_BASIS -> "답변 기준이 필요합니다.";
        };
    }

    /**
     * What is missing, in one line, for the two states where something is — or null for GROUNDED.
     *
     * <p>Deliberately not a fallback sentence for the customer. Until Organization Answer Style v1
     * gives this seller an approved template of their own, SellerOps does not compose a reply it has
     * no basis for, and it does not paper over that with 「담당자 확인 후 연락드리겠습니다」 either.
     */
    public String actionKo(DraftKnowledgeState knowledge) {
        return actionKo(knowledge, null, SpecApplicability.Applicability.NOT_VARIANT_SENSITIVE);
    }

    /**
     * The same line, naming what is missing when the question named it.
     *
     * <p><b>Both additions are quoted, not inferred.</b> {@code topicWord} is a word the customer
     * wrote, matched against the list {@link SpecApplicability} already scans; the 규격 sentence is
     * added on exactly the verdict that class already returned. No model is asked what the seller
     * should write, and no new classification of the question happens here — 「이 상품에서 규격별
     * 수용 가능한 전선 개수 정보가 필요합니다」 is a sentence we would have to invent the noun for,
     * and the honest version of it is the customer's own noun handed back.
     *
     * <p>When the question named no property the line is the general one, unchanged. A vaguer
     * sentence is the correct outcome of a vaguer question.
     */
    public String actionKo(DraftKnowledgeState knowledge, String topicWord,
                           SpecApplicability.Applicability applicability) {
        return actionKo(knowledge, topicWord, applicability, null, null, null);
    }

    /**
     * The same line, told what each lane actually established (Retrieval &amp; Grounding
     * Correctness v1). The action must match the retrieval: a rule that EXISTS and does not apply is
     * not fixed by registering it again, and a product-knowledge miss is not fixed by linking a
     * product. {@code asked} is the operating topic the customer's words name, or null.
     */
    public String actionKo(DraftKnowledgeState knowledge, String topicWord,
                           SpecApplicability.Applicability applicability,
                           RetrievalOutcome productOutcome, RetrievalOutcome policyOutcome,
                           KnowledgeTopic asked) {
        return actionKo(knowledge, topicWord, applicability, productOutcome, policyOutcome, asked, false);
    }

    /**
     * @param topicDeclared whether ANY registered rule declares itself about {@code asked}. Rules that
     *                      exist but say nothing about the asked topic are, for that topic, absence.
     */
    public String actionKo(DraftKnowledgeState knowledge, String topicWord,
                           SpecApplicability.Applicability applicability,
                           RetrievalOutcome productOutcome, RetrievalOutcome policyOutcome,
                           KnowledgeTopic asked, boolean topicDeclared) {
        if (this == NEEDS_CLARIFICATION) {
            // What is missing, and nothing else. The customer has not said which 규격 they mean, so
            // the reply asks — and this line exists so the seller reads that BEFORE the draft and does
            // not mistake a question for an incomplete answer. It states no policy and no figure,
            // which is the same rule the draft itself is under in this state.
            return "고객이 어떤 규격·옵션인지 밝히지 않았습니다. 아래 초안은 그 내용을 되묻습니다.";
        }
        if (this != NO_ANSWER_BASIS || knowledge == null) {
            return null;
        }
        String topic = topicWord == null || topicWord.isBlank() ? null : "「" + topicWord + "」";
        String perVariant = applicability == null
                || applicability == SpecApplicability.Applicability.NOT_VARIANT_SENSITIVE
                ? "" : " 규격에 따라 답이 달라진다면 규격별로 등록할 수 있습니다.";
        // What the rules lane established decides the sentence before the product lane does: a
        // question the customer asked in policy words is answered from the rules, product or not.
        if (policyOutcome == RetrievalOutcome.NOT_APPLICABLE) {
            String rule = asked == null ? "운영 기준" : asked.labelKo() + " 기준";
            return rule + "은 등록되어 있지만, 이 문의에 적용할 근거로 확인되지는 않았습니다.";
        }
        if (asked != null && (policyOutcome == RetrievalOutcome.ABSENT
                || (policyOutcome == RetrievalOutcome.NO_RELEVANT_EVIDENCE && !topicDeclared))) {
            return "등록된 " + asked.labelKo() + " 기준이 아직 없습니다. 기준을 등록하면 근거가 생깁니다.";
        }
        if (policyOutcome == RetrievalOutcome.NO_RELEVANT_EVIDENCE && asked != null
                && (knowledge == DraftKnowledgeState.NO_PRODUCT || productOutcome == RetrievalOutcome.ABSENT)) {
            return "등록된 운영 기준에서 이 질문에 해당하는 근거를 찾지 못했습니다.";
        }
        if (productOutcome == RetrievalOutcome.NOT_APPLICABLE) {
            return "관련 상품 지식은 등록되어 있지만, 이 질문에 적용할 근거로 확인되지는 않았습니다.";
        }
        if (productOutcome == RetrievalOutcome.NO_RELEVANT_EVIDENCE) {
            return (topic == null
                    ? "등록된 상품 정보에서 이 질문에 해당하는 근거를 찾지 못했습니다."
                    : "등록된 상품 정보에서 " + topic + " 관련 근거를 찾지 못했습니다.") + perVariant;
        }
        return switch (knowledge) {
            case NO_PRODUCT -> "이 문의가 어떤 상품에 대한 것인지 연결하면 근거를 찾을 수 있습니다.";
            case NO_LIBRARY -> (topic == null
                    ? "이 상품에 등록된 지식이 없습니다. 상품 지식을 등록하면 근거가 생깁니다."
                    : "이 상품에 등록된 지식이 없습니다. " + topic + " 관련 답변 기준을 등록하면 "
                            + "근거가 생깁니다.") + perVariant;
            case NO_MATCH -> (topic == null
                    ? "등록된 상품 지식·운영 정책에 이 질문에 해당하는 내용이 없습니다."
                    : "등록된 상품 지식·운영 정책에 " + topic + " 관련 내용이 없습니다.") + perVariant;
            case GROUNDED -> null;
        };
    }
}
