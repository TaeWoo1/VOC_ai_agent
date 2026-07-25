package com.sellerops.reviewissue;

/**
 * What one opinion unit says is wrong: an aspect (부품·속성), a problem, and the severity that the
 * problem vocabulary fixes for it.
 *
 * <p>{@link #signatureKey()} is the issue's identity — {@code uq_review_issues_signature} makes two
 * units with the same key attach to the same {@code review_issues} row, which is what makes
 * "search the issue memory" an indexed lookup instead of a similarity search. No vector extension,
 * no external call, and re-running extraction over an already-processed review is idempotent.
 *
 * <p><b>The key is readable, not hashed, on purpose.</b> Both components come from a closed
 * vocabulary and carry no customer content, so hashing would buy no privacy while making the unique
 * index, a failing test, and a support question all harder to read. Contrast
 * {@code ReviewIdFingerprint}, which hashes because its input IS channel data.
 *
 * <p><b>No unit text is carried here.</b> Extraction is where customer text stops: the evidence
 * table stores {@code review_id + unit_ordinal}, and 대표 고객 표현 is re-derived at read time
 * through the existing masking path. A {@code text} field on this record would be copied into
 * every caller and eventually into a log.
 */
public record IssueSignature(String aspect, String problem, IssueSeverity severity) {

    public IssueSignature {
        if (aspect == null || aspect.isBlank()) {
            throw new IllegalArgumentException("aspect는 비어 있을 수 없습니다.");
        }
        if (problem == null || problem.isBlank()) {
            throw new IllegalArgumentException("problem은 비어 있을 수 없습니다.");
        }
        if (severity == null) {
            throw new IllegalArgumentException("severity는 비어 있을 수 없습니다.");
        }
    }

    /** Build from the vocabulary, so severity can never disagree with the problem. */
    public static IssueSignature of(String aspect, String problem) {
        return new IssueSignature(aspect, problem, IssueVocabulary.severityOf(problem));
    }

    /** Stable issue identity, e.g. {@code 배송:지연}. Fits {@code varchar(64)} by vocabulary. */
    public String signatureKey() {
        return aspect + ":" + problem;
    }

    /** Operator-facing label, e.g. {@code 배송 지연}. Derived from vocabulary only, never from a body. */
    public String titleKo() {
        return aspect + " " + problem;
    }
}
