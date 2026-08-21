package com.sellerops.inquirysignal;

import java.util.Optional;
import java.util.UUID;

/**
 * The seam between "an inquiry's text" and "an inquiry signature".
 *
 * <p><b>A port, for the reason {@code IssueSignatureExtractor} is one</b> — and this is its
 * inquiry-axis sibling. The deterministic review extractor produced signatures for 0 of 3,220 real
 * inquiries (measured 2026-08-21), and {@code contracts/review-eval/naver/v1/RUBRIC.md} diagnosed why:
 * surface-form rigidity, not vocabulary breadth. A keyword list would not fix that. What sits behind
 * this port is a semantic classifier; what sits in FRONT of it is unchanged aggregation, windows,
 * repeat detection and read model.
 *
 * <p><b>Absence is not a fallback.</b> {@link Optional#empty()} means "not classified", and callers
 * store null rather than a default topic. A classifier failure that produced a guess would let every
 * unclassifiable inquiry pool into one bucket and be reported to a seller as a pattern — the exact
 * failure {@code 기타} caused on real data.
 */
public interface InquirySignatureClassifier {

    /** Provenance kind stored on the index row, e.g. {@code SEMANTIC}. */
    String kind();

    /** Provenance version stored beside it. Bumped whenever the labels could change. */
    String version();

    /** Whether this classifier will actually classify for this org. False = the capability is off. */
    boolean isEnabledFor(UUID orgId);

    /**
     * Classify one inquiry's text.
     *
     * @param text title and body joined by the caller; never logged, never stored by an implementation
     * @return the signature, or empty when the capability is off, the model declined, or the answer was
     *     off-vocabulary
     */
    Optional<Classification> classify(UUID orgId, String text);

    /** The labels that came back, plus which model said so. No customer text. */
    record Classification(InquirySignature signature, String providerVersion) {
    }
}
