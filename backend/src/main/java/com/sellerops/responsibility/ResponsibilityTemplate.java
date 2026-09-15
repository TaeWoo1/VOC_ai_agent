package com.sellerops.responsibility;

import com.sellerops.connector.DataType;
import java.util.List;

/**
 * The code registry of responsibilities Reviewnary can take on. <b>Not a builder</b> — a template is a closed
 * value in this enum, not a row an operator or a seller edits, and v1 has exactly one.
 *
 * <p>{@link #CUSTOMER_OPERATIONS_V1}'s scheduled obligation is the two official-API Cafe24 sources and nothing
 * else (product-owner decision PD-1, 2026-09-15). Coupang reviews and NAVER guided acquisition are read by a
 * person pressing a button; putting them in a scheduled obligation would make every run report them as
 * «확인하지 못함» for a reason that is not a failure, and that is the wrong product meaning.
 */
public enum ResponsibilityTemplate {

    CUSTOMER_OPERATIONS_V1(1, "고객 운영 관리", List.of(
            new SourceSpec("CAFE24", DataType.INQUIRY),
            new SourceSpec("CAFE24", DataType.REVIEW)));

    /** One required source: a channel's official-API collection of one data type. */
    public record SourceSpec(String channelCode, DataType dataType) {
    }

    private final int version;
    private final String displayName;
    private final List<SourceSpec> sources;

    ResponsibilityTemplate(int version, String displayName, List<SourceSpec> sources) {
        this.version = version;
        this.displayName = displayName;
        this.sources = List.copyOf(sources);
    }

    public int version() {
        return version;
    }

    /** The seller-facing name. */
    public String displayName() {
        return displayName;
    }

    /** Required sources, in the order a run observes them. */
    public List<SourceSpec> sources() {
        return sources;
    }

    public boolean requires(String channelCode, DataType dataType) {
        return sources.stream().anyMatch(s -> s.channelCode().equals(channelCode) && s.dataType() == dataType);
    }

    public boolean usesChannel(String channelCode) {
        return sources.stream().anyMatch(s -> s.channelCode().equals(channelCode));
    }
}
