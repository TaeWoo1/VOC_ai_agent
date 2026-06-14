package com.sellerops.itemanalysis.dto;

import com.sellerops.itemanalysis.ItemAnalysis;
import java.time.Instant;
import java.util.UUID;

/**
 * Read-side view of a stored analysis. Carries only derived metadata — no raw
 * inquiry/review body — so the endpoint never re-exposes customer text.
 */
public record ItemAnalysisView(
        String sourceType,
        UUID sourceId,
        String summary,
        String category,
        String sentiment,
        String urgency,
        String recommendedAction,
        String analyzerKind,
        String analyzerName,
        String analyzerVersion,
        Instant createdAt) {

    public static ItemAnalysisView of(ItemAnalysis a) {
        return new ItemAnalysisView(
                a.getSourceType(),
                a.getSourceId(),
                a.getSummary(),
                a.getCategory(),
                a.getSentiment(),
                a.getUrgency(),
                a.getRecommendedAction(),
                a.getAnalyzerKind(),
                a.getAnalyzerName(),
                a.getAnalyzerVersion(),
                a.getCreatedAt());
    }
}
