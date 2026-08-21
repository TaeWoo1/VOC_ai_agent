package com.sellerops.reviewissue;

import java.util.List;
import java.util.Locale;
import java.util.Optional;
import java.util.Set;

/**
 * What a customer is ASKING — the second half of an inquiry's signature.
 *
 * <p><b>Why a new axis instead of reusing {@link IssueVocabulary}'s problems.</b> That vocabulary is
 * about what went WRONG (파손 · 결함 · 누락), which is the right shape for a review. An inquiry is
 * usually a question, and "교환 가능한가요?" has no problem in it at all. Classifying it as 기타 문제
 * would be a false statement about a customer who is simply asking something.
 *
 * <p><b>The first half is reused, not duplicated.</b> An inquiry signature is
 * {@code <ItemAnalysisCategories value>:<this>} — e.g. {@code 제품정보:규격}, {@code 교환:가능여부}. The
 * topic axis already exists, is already stored on {@code item_analyses.category}, and is already
 * printed on screen; inventing a second topic vocabulary here would give the product two answers to
 * "what is this inquiry about".
 *
 * <p><b>Severity is a fixed property of the ask kind, never a per-inquiry judgement</b> — the rule
 * {@code IssueVocabulary} states for problems, applied here for the same reason: a severity derived
 * per row is a model opinion wearing a schema's clothes. A 하자 report is operationally heavier than a
 * 규격 question regardless of how either was worded.
 */
public enum InquiryAskKind {

    /** 가능한가요 / 되나요 — a yes-no about whether something is allowed or supported. */
    POSSIBILITY("가능여부", IssueSeverity.NORMAL),
    /** 몇 mm · 사이즈 · 규격 — a measurable property of the product. */
    SPECIFICATION("규격", IssueSeverity.NORMAL),
    /** 언제 · 며칠 — timing, delivery windows, processing time. */
    TIMING("기간", IssueSeverity.NORMAL),
    /** 어떻게 — a how-to: installation, usage, procedure. */
    METHOD("방법", IssueSeverity.NORMAL),
    /** 어디까지 왔나요 · 처리됐나요 — the state of a specific order or request. */
    STATUS("상태", IssueSeverity.NORMAL),
    /** 얼마 · 배송비 — a cost question. */
    COST("비용", IssueSeverity.LOW),
    /** 재입고 · 품절 — availability. */
    STOCK("재고", IssueSeverity.NORMAL),
    /** 호환되나요 — fit with something the customer already has. */
    COMPATIBILITY("호환", IssueSeverity.NORMAL),
    /** 불량이에요 · 깨졌어요 — a defect report arriving through the inquiry channel, not a question. */
    DEFECT("하자", IssueSeverity.HIGH);

    private final String labelKo;
    private final IssueSeverity severity;

    InquiryAskKind(String labelKo, IssueSeverity severity) {
        this.labelKo = labelKo;
        this.severity = severity;
    }

    /** The token that appears in a signature key and on screen. */
    public String labelKo() {
        return labelKo;
    }

    public IssueSeverity severity() {
        return severity;
    }

    /** Every label, for a prompt to interpolate rather than restate by hand. */
    public static List<String> labels() {
        return java.util.Arrays.stream(values()).map(InquiryAskKind::labelKo).toList();
    }

    public static Set<String> labelSet() {
        return Set.copyOf(labels());
    }

    /**
     * Resolve a label back to a kind. Off-vocabulary input is {@link Optional#empty()} — never a
     * fallback kind, because a fallback would let an unclassifiable inquiry join a real pattern and
     * become the largest "repeat" a seller is shown. That exact failure was measured on real data with
     * {@code 기타} (1,777 occurrences reported as a pattern) and the fix was to exclude it, not to
     * rename it.
     */
    public static Optional<InquiryAskKind> fromLabel(String label) {
        if (label == null || label.isBlank()) {
            return Optional.empty();
        }
        String token = label.strip().toLowerCase(Locale.ROOT);
        return java.util.Arrays.stream(values())
                .filter(k -> k.labelKo.toLowerCase(Locale.ROOT).equals(token) || k.name().toLowerCase(Locale.ROOT).equals(token))
                .findFirst();
    }
}
