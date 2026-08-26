package com.sellerops.knowledge.style;

/**
 * How long a reply should be.
 *
 * <p>Stated as a sentence range rather than a character count on purpose: a character budget makes a
 * model truncate a fact to fit, and the one thing a length preference must never do is decide which
 * facts survive.
 */
public enum AnswerLength {

    SHORT("2문장 이내로 짧게 답변하세요.", "짧게"),
    NORMAL("2~4문장으로 답변하세요.", "보통"),
    DETAILED("4~6문장으로, 필요한 설명을 덧붙여 답변하세요. 근거에 없는 내용을 채워 넣지는 마세요.", "자세히");

    private final String instructionKo;
    private final String labelKo;

    AnswerLength(String instructionKo, String labelKo) {
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
