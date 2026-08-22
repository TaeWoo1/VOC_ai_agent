package com.sellerops.ingest.parse;

/**
 * The uploaded bytes are not a supported export — not an OOXML workbook, not delimited UTF-8 text.
 *
 * <p><b>An outcome, not a malformed request.</b> A run that could not read its file has to end as a
 * recorded FAILED attempt carrying a reason, because the alternative is the thing
 * {@code ReviewAcquisitionSpineTest} exists to forbid: a parse failure and an empty export both land with
 * zero rows, and "we could not read it" must never be reported as "there was nothing in it". Raising a
 * plain 400 would leave a toast and no attempt row for the seller to see or retry.
 *
 * <p>Distinct from {@code ApiException} for exactly that reason — {@link
 * com.sellerops.connector.FileUploadConnector} finishes the run FAILED and returns it rather than
 * rethrowing.
 */
public class UnsupportedUploadFormatException extends RuntimeException {

    public UnsupportedUploadFormatException(String message) {
        super(message);
    }
}
