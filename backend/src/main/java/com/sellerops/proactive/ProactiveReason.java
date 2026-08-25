package com.sellerops.proactive;

/**
 * Why this case is on the seller's screen — the operational fact behind it, not a judgement.
 *
 * <p><b>Every value here is decided before any model runs.</b> The candidate gate is deterministic
 * ({@link ProactiveCandidates}): an inquiry is a candidate because the channel says it is unanswered,
 * a review because the existing triage rule already ranks it 확인 필요. The investigation that follows
 * may fail, may find nothing, may be skipped entirely — and the reason stays true, because it was
 * never the model's to decide. That ordering is the point: the LLM does not invent "there is work
 * here"; it investigates work the operational data already established.
 *
 * <p>{@link #priority()} is the whole of the priority decision (v1 §8) and it is a lookup, not a
 * score.
 */
public enum ProactiveReason {

    /** The channel reports this inquiry as unanswered and the seller has not opened it. */
    UNANSWERED_INQUIRY(ProactivePriority.HIGH,
            "고객이 답변을 기다리고 있습니다."),

    /**
     * A 1점 review with something written in it. Split from {@link #NEGATIVE_REVIEW} because the
     * seller's own next action differs: the worst rating is where a reply, a refund, or a listing fix
     * is usually already overdue.
     */
    SEVERE_NEGATIVE_REVIEW(ProactivePriority.HIGH,
            "가장 낮은 평점의 리뷰입니다."),

    /**
     * A 확인 필요 review whose product already carries a repeated issue in the review issue memory.
     * The repetition is read from {@code review_issue_evidence}; it is not inferred from this review.
     */
    REPEAT_ISSUE_REVIEW(ProactivePriority.HIGH,
            "같은 문제가 이 상품에서 반복되고 있습니다."),

    /** A 1–2점 review with text — the existing triage tier NEEDS_ATTENTION, unchanged. */
    NEGATIVE_REVIEW(ProactivePriority.NORMAL,
            "낮은 평점의 리뷰이고, 읽을 내용이 있습니다.");

    private final ProactivePriority priority;
    private final String noteKo;

    ProactiveReason(ProactivePriority priority, String noteKo) {
        this.priority = priority;
        this.noteKo = noteKo;
    }

    /** The priority this reason carries. The only input to a case's priority. */
    public ProactivePriority priority() {
        return priority;
    }

    /** The first line of the card — what happened, in the seller's language. */
    public String noteKo() {
        return noteKo;
    }

    /** Whether this reason can only be produced for one subject kind. Pinned by the fence test. */
    public ProactiveSubjectKind subjectKind() {
        return this == UNANSWERED_INQUIRY ? ProactiveSubjectKind.INQUIRY : ProactiveSubjectKind.REVIEW;
    }
}
