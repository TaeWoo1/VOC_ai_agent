package com.sellerops.inquiry.decision;

/**
 * How far the evidence this system holds closes ONE customer need (Inquiry Decision v2).
 *
 * <p>{@code FULL}, {@code CONDITIONAL_ON_CUSTOMER}, {@code PARTIAL} and {@code NONE} are the coverage judge's words.
 * <b>{@code UNKNOWN} is never the judge's</b>: it is set by code when the judge found the readable evidence short AND a
 * source this system cannot read exists for the listing (an image-only 상세페이지, a Cafe24 detail nothing collects).
 * The model is never asked to guess what a picture says; the difference between 「not written anywhere」 and 「written
 * somewhere we cannot read」 is a fact about our capability, so code owns it.
 */
public enum NeedStatus {
    FULL, CONDITIONAL_ON_CUSTOMER, PARTIAL, NONE, UNKNOWN;

    public static NeedStatus parseJudge(String s) {
        if (s == null) {
            return null;
        }
        return switch (s.trim()) {
            case "FULL" -> FULL;
            case "CONDITIONAL_ON_CUSTOMER", "CONDITIONAL" -> CONDITIONAL_ON_CUSTOMER;
            case "PARTIAL" -> PARTIAL;
            case "NONE" -> NONE;
            default -> null; // UNKNOWN is not the judge's word
        };
    }

    /** Covered: nothing more is needed from the seller for this need. */
    public boolean covered() {
        return this == FULL || this == CONDITIONAL_ON_CUSTOMER;
    }

    public String labelKo() {
        return switch (this) {
            case FULL -> "확인됨";
            case CONDITIONAL_ON_CUSTOMER -> "고객 확인 필요";
            case PARTIAL -> "일부만 있음";
            case NONE -> "기준 없음";
            case UNKNOWN -> "읽지 못한 자료에 있을 수 있음";
        };
    }
}
