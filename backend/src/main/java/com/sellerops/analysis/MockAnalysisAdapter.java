package com.sellerops.analysis;

import java.util.List;
import java.util.UUID;
import org.springframework.stereotype.Component;

/**
 * Placeholder analysis adapter for Phase 1. Returns canned data only — there is
 * NO real repeated-issue discovery or review Q&A here. Replaced later by a
 * {@code PythonReviewOpsAdapter} that calls the existing Python review-ops engine.
 */
@Component
public class MockAnalysisAdapter implements ReviewAnalysisPort {

    @Override
    public List<RepeatedIssue> discoverRepeatedIssues(UUID orgId) {
        return List.of(
                new RepeatedIssue("접착력 부족", "부착 후 시간이 지나면 떨어진다는 의견이 반복됩니다. (예시 데이터)", 0, "준비 중"),
                new RepeatedIssue("절단 시 깨짐", "재단·시공 중 깨짐을 언급하는 의견이 보입니다. (예시 데이터)", 0, "준비 중"));
    }

    @Override
    public ReviewSearchResult searchReviews(UUID orgId, String query) {
        return new ReviewSearchResult(
                "AI 검색은 다음 단계에서 연결될 예정입니다. 지금은 예시 응답을 보여드립니다.",
                List.of());
    }
}
