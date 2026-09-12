package com.sellerops.reviewissue;

import com.sellerops.common.SafePreviewResult;
import com.sellerops.common.VocPreviewSanitizer;
import com.sellerops.review.Review;
import java.util.List;

/**
 * The one rule for turning an evidence row back into a sentence a seller may read.
 *
 * <p>It lived as a private method on {@link ReviewIssueQueryService} while that service was the only
 * surface showing 근거 리뷰. The Decision Workspace shows them too — «what else said this» is half of
 * why a seller opens it — and a second copy of a MASKING rule is the copy that is forgotten when the
 * rule changes. So it is one function with two callers rather than two functions that agree today.
 *
 * <p><b>Null is a real answer and must render as nothing.</b> The sanitizer suppresses a unit when too
 * little real text survives redaction, and a stored ordinal stops resolving if the body changed after
 * extraction. In both cases the honest output is no quote — never the whole review, which would show
 * text the issue was never evidence for, and never an empty bubble, which would say the customer
 * wrote nothing.
 */
public final class IssueEvidenceQuote {

    private IssueEvidenceQuote() {
    }

    /** Re-derive one opinion unit and mask it, or null when it cannot be shown honestly. */
    public static String of(Review review, int unitOrdinal) {
        if (review == null) {
            return null;
        }
        List<String> units = OpinionUnitSplitter.split(review.getBody());
        if (unitOrdinal < 0 || unitOrdinal >= units.size()) {
            return null;
        }
        SafePreviewResult preview = VocPreviewSanitizer.sanitize(units.get(unitOrdinal));
        return preview.text();
    }
}
