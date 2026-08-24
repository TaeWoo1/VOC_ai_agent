package com.sellerops.knowledge.memory;

/**
 * How much of the seller's own judgement is behind a remembered answer.
 *
 * <p><b>Not a confidence score — a record of what a person actually did.</b> Each value is a
 * different act, and they are ordered by how hard that act is to have happened by accident. An
 * answer the channel says the seller published is the seller's answer. An answer the seller read,
 * edited and approved in SellerOps is that plus a decision made here. An answer that was then
 * delivered and confirmed by re-reading the channel is that plus proof it is what the customer
 * actually received.
 *
 * <p><b>What is deliberately absent.</b> There is no value for an AI draft, and none for a draft a
 * person was editing but has not approved. A model that may read its own unapproved output back as
 * precedent is a model that agrees with itself more every week; the loop is the failure, not the
 * quality of any one draft. A half-edited sentence is also not what its author meant to say yet.
 *
 * <p><b>Ordering is for conflict, not display.</b> When two remembered answers say different things
 * about the same topic — "교환 가능합니다" and "제품 확인 후 교환 여부를 안내합니다" — the stronger and
 * then the more recent one is what the seller is currently doing. The weaker one is not deleted and
 * not used; it is suppressed for that answer and stays in the record.
 */
public enum AnswerMemoryStrength {

    /** 마켓플레이스에서 수집된, 판매자가 그 채널에 실제로 등록한 답변. */
    IMPORTED_SELLER_ANSWER(1, "채널에 등록된 답변"),

    /** SellerOps에서 판매자가 읽고 확정한 답변. */
    USER_APPROVED(2, "판매자가 승인한 답변"),

    /** 전송된 뒤 채널을 다시 읽어 확인된 답변. */
    EXECUTOR_SENT_VERIFIED(3, "전송이 확인된 답변");

    private final int rank;
    private final String labelKo;

    AnswerMemoryStrength(int rank, String labelKo) {
        this.rank = rank;
        this.labelKo = labelKo;
    }

    /** Higher wins a conflict. Compared, never displayed. */
    public int rank() {
        return rank;
    }

    /** The seller-facing name of this provenance. */
    public String labelKo() {
        return labelKo;
    }

    /** The stored value, or null when it is absent or no longer recognized. */
    public static AnswerMemoryStrength parse(String raw) {
        if (raw == null) {
            return null;
        }
        for (AnswerMemoryStrength value : values()) {
            if (value.name().equals(raw)) {
                return value;
            }
        }
        return null;
    }
}
