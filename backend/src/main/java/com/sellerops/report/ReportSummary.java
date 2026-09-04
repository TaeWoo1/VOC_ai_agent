package com.sellerops.report;

import java.util.List;

/**
 * The deterministic reading of the facts — what the seller sees whether or not the narrative
 * capability is on, and the layer the narrative is validated against.
 *
 * <p>Each line is typed. {@code FACT} restates a value (「리뷰 81건, 이전 기간 65건」);
 * {@code INTERPRETATION} says what is worth looking at without saying why it happened
 * (「'접착' 관련 리뷰 증가를 확인할 필요가 있습니다」); {@code LIMIT} says what the data does not
 * tell (「원인은 리뷰가 말해주지 않습니다」). The boundary the product-owner drew — fact ·
 * interpretation · unsupported cause — is a field, not a tone.
 */
public record ReportSummary(List<Line> lines) {

    public enum Kind { FACT, INTERPRETATION, LIMIT }

    public record Line(String text, Kind kind, List<String> factIds) {
    }
}
