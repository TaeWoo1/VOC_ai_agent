package com.sellerops.knowledge.memory;

/**
 * <b>How far one past answer may travel</b> — a fact about the answer's provenance, declared by a person, never
 * inferred (Inquiry Decision v2.1).
 *
 * <p>The first real-model run of Inquiry Decision v2 found the coverage judge proposing past answers that belonged to
 * one order or one conversation (「그 주문은 발송했습니다」) as a prefill for a different customer — the judge was
 * asked, every time, to guess from the text whether an answer was general. That is not a semantic question the judge
 * should keep answering: whether an answer was about THIS order is known when it is written. So it is stored, and the
 * runtime reads it ({@code PrecedentReuse}):
 * <ul>
 *   <li>{@link #REUSABLE} — a general answer; any Case may start from it.</li>
 *   <li>{@link #ORDER_ONLY} — true of one order; only a Case about the same order.</li>
 *   <li>{@link #CASE_ONLY} — true of one conversation; only that Case.</li>
 *   <li>{@link #UNKNOWN} — nobody said. <b>The default, and it never crosses to another Case.</b> Rows written before
 *       this column existed are UNKNOWN and are not backfilled: an inferred REUSABLE is the exact guess this replaces.</li>
 * </ul>
 * This is a provenance invariant, not a domain rule — it reads no word of the answer.
 */
public enum AnswerMemoryReuseScope {
    REUSABLE, ORDER_ONLY, CASE_ONLY, UNKNOWN;

    public static AnswerMemoryReuseScope parse(String s) {
        if (s == null) {
            return null;
        }
        for (AnswerMemoryReuseScope v : values()) {
            if (v.name().equals(s.trim())) {
                return v;
            }
        }
        return null;
    }

    public String labelKo() {
        return switch (this) {
            case REUSABLE -> "다른 문의에도 쓸 수 있는 답변";
            case ORDER_ONLY -> "그 주문에만 해당하는 답변";
            case CASE_ONLY -> "그 문의에만 해당하는 답변";
            case UNKNOWN -> "재사용 범위 미정";
        };
    }
}
