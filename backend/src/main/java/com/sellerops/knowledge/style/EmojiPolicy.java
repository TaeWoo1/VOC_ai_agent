package com.sellerops.knowledge.style;

/**
 * Whether a reply may carry emoji. Two values: none, or a little.
 *
 * <p>There is no "많이". A reply to a customer complaint is not improved by a third emoji, and an
 * option nobody should pick is an option that exists to be picked once by accident.
 */
public enum EmojiPolicy {

    NONE("이모지를 사용하지 마세요.", "사용하지 않음"),
    LIMITED("이모지는 꼭 필요할 때 한 개까지만 사용하세요.", "가끔 한 개");

    private final String instructionKo;
    private final String labelKo;

    EmojiPolicy(String instructionKo, String labelKo) {
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
