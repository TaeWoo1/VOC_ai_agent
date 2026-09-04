package com.sellerops.report;

import java.util.List;

/**
 * What the narrative model wrote, AFTER validation: a headline (or null) and lines that each cite at
 * least one fact id that exists and contain no causal or outcome vocabulary. What it wrote before
 * validation is never stored — a refused sentence is dropped, counted, and gone.
 */
public record ReportNarrative(String headline, List<Line> lines) {

    public record Line(String text, List<String> factIds) {
    }
}
