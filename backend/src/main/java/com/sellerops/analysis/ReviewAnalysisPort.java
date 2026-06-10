package com.sellerops.analysis;

import java.util.List;
import java.util.UUID;

/**
 * Seam for the future bridge to the Python review-ops analysis engine
 * (repeated-issue discovery + review Q&A).
 *
 * <p>Phase 1 ships only {@link MockAnalysisAdapter}. A future
 * {@code PythonReviewOpsAdapter} will HTTP-call the existing Python service so
 * the 상품 이슈 / AI 검색 menus use real analysis. No real analysis is wired this
 * phase; this interface exists so that swap is an adapter change, not a rewrite.
 */
public interface ReviewAnalysisPort {

    List<RepeatedIssue> discoverRepeatedIssues(UUID orgId);

    ReviewSearchResult searchReviews(UUID orgId, String query);

    record RepeatedIssue(String title, String summary, long mentionCount, String priority) {
    }

    record ReviewSearchHit(String snippet, String channelNameKo, Integer rating) {
    }

    record ReviewSearchResult(String answer, List<ReviewSearchHit> hits) {
    }
}
