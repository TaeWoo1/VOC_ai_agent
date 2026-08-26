package com.sellerops.knowledge.style;

/**
 * How this company sounds. Three values, and no fourth — a free-text tone field would be a system
 * prompt with a Korean label on it.
 *
 * <p>The Korean sentence is OUR wording, not the seller's. It is what the model is told, and keeping
 * it here rather than in the profile is what makes a tone setting a choice among instructions we
 * wrote instead of an instruction the seller wrote.
 */
public enum AnswerTone {

    /** The default, and what SellerOps already did before this setting existed. */
    POLITE("정중하고 차분한 존댓말로 답변하세요.", "정중하게"),

    /** Warmer, still 존댓말 — a small shop that talks to its customers by name. */
    FRIENDLY("친근하고 따뜻한 존댓말로 답변하세요. 다만 과장된 표현은 쓰지 마세요.", "친근하게"),

    /** Fewer words. Not curt: the courtesy stays, the padding goes. */
    CONCISE("군더더기 없이 간결한 존댓말로 답변하세요. 인사와 마무리는 짧게 유지하세요.", "간결하게");

    private final String instructionKo;
    private final String labelKo;

    AnswerTone(String instructionKo, String labelKo) {
        this.instructionKo = instructionKo;
        this.labelKo = labelKo;
    }

    public String instructionKo() {
        return instructionKo;
    }

    public String labelKo() {
        return labelKo;
    }
}
