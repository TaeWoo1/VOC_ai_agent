package com.sellerops.operationscase;

/**
 * Why a case exists, as the fact behind it — decided before any model runs.
 *
 * <p>{@link #noteKo()} is the first line a seller reads. Each sentence says what was observed and, where the rule
 * concluded something, what Reviewnary did with it; none says a customer was answered or anything was sent.
 */
public enum CaseReason {
    UNANSWERED_INQUIRY("고객이 답변을 기다리는 새 문의입니다.", null),
    INQUIRY_ALREADY_ANSWERED("이미 답변된 문의로 확인되어 따로 할 일이 없습니다.", "이미 답변된 문의입니다."),
    INQUIRY_THREAD_REPLY("새 문의가 아니라 기존 문의에 달린 답글이라 따로 할 일이 없습니다.", "기존 문의에 달린 답글입니다."),
    INQUIRY_NOT_OPERATIONAL("판매자님이 제외한 문의라 따로 할 일이 없습니다.", "판매자님이 제외한 문의입니다."),
    REVIEW_NEEDS_ATTENTION("낮은 별점에 내용이 있는 새 리뷰입니다.", null),
    REVIEW_WATCH("지켜볼 리뷰입니다. 같은 이야기가 쌓이면 반복 문제로 모입니다.", "별점 3점이거나 글이 없는 낮은 별점의 새 리뷰입니다."),
    REVIEW_WATCH_PROBLEM("별점 3점 리뷰에 불편을 말하는 내용이 있어 살펴봅니다.", "별점 3점 리뷰에 불편을 말하는 내용이 있습니다."),
    REVIEW_HIGH_RATING_PROBLEM("별점은 높지만 불편을 말하는 내용이 있어 살펴봅니다.", "별점은 높지만 불편을 말하는 내용이 있습니다."),
    REVIEW_HIGH_RATING_WITH_TEXT("별점은 높지만 글이 있어 바로 닫지 않고 지켜봅니다.", "별점이 높고 글이 있는 새 리뷰입니다."),
    REVIEW_ROUTINE("글 없이 별점 4~5점만 남긴 리뷰라 따로 대응할 일이 없습니다.", "글 없이 별점 4~5점만 남긴 리뷰입니다."),
    REVIEW_ALREADY_ANSWERED("이미 답글이 달린 리뷰라 따로 할 일이 없습니다.", "이미 답글이 달린 리뷰입니다."),
    SOURCE_AUTH_REQUIRED("연결이 만료되어 확인하지 못했습니다. 다시 연결해 주세요.", null),
    SOURCE_NOT_CONNECTED("연결이 끊겨 확인하지 못했습니다. 다시 연결해 주세요.", null);

    private final String noteKo;
    /** The same fact without the rule's conclusion, or null when the note states no conclusion to outlive. */
    private final String factKo;

    CaseReason(String noteKo, String factKo) {
        this.noteKo = noteKo;
        this.factKo = factKo;
    }

    /**
     * The sentence for a case whose conclusion was reached by someone other than the rule — the agent, or the seller.
     * The rule's note says what the rule decided («지켜봅니다», «따로 할 일이 없습니다»); once a later decision replaced
     * it, only the fact behind the case may still stand, or the screen shows two conclusions that disagree.
     */
    public String factKo() {
        return factKo == null ? noteKo : factKo;
    }

    /** The note a case should show now: the rule's sentence while the rule's conclusion stands, else the fact. */
    public static String noteFor(OperationsCase c) {
        if (c.getReason() == null) {
            return c.getReasonNote();
        }
        return c.getDecidedBy() == null || c.getDecidedBy() == CaseDecider.RULE
                ? c.getReason().noteKo() : c.getReason().factKo();
    }

    public String noteKo() {
        return noteKo;
    }
}
