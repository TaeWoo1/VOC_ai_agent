package com.sellerops.report;

/**
 * The two cadences an operating report has. One model, two calendars: a monthly report is not a
 * different report with more sections, it is the same facts over a longer completed period.
 */
public enum ReportKind {
    WEEKLY("주간"),
    MONTHLY("월간");

    private final String labelKo;

    ReportKind(String labelKo) {
        this.labelKo = labelKo;
    }

    public String labelKo() {
        return labelKo;
    }

    /** Parse a client value; unknown → bad request. */
    public static ReportKind parse(String raw) {
        for (ReportKind kind : values()) {
            if (kind.name().equalsIgnoreCase(raw)) {
                return kind;
            }
        }
        throw com.sellerops.common.ApiException.badRequest("알 수 없는 리포트 종류입니다: " + raw);
    }
}
