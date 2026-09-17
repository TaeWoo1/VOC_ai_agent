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
            new SourceSpec("CAFE24", DataType.REVIEW)),
            List.of("CUSTOMER_OPERATIONS_FIXTURE_OBSERVE_V1", "COUPANG_REVIEW_OBSERVE_V1", "NAVER_REVIEW_OBSERVE_V1",
                    "NAVER_PRODUCT_INQUIRY_OBSERVE_V1"));

    /** One required source: a channel's official-API collection of one data type. */
    public record SourceSpec(String channelCode, DataType dataType) {
    }

    private final int version;
    private final String displayName;
    private final List<SourceSpec> sources;
    private final List<String> deviceRecipes;

    ResponsibilityTemplate(int version, String displayName, List<SourceSpec> sources, List<String> deviceRecipes) {
        this.version = version;
        this.displayName = displayName;
        this.sources = List.copyOf(sources);
        this.deviceRecipes = List.copyOf(deviceRecipes);
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

    /**
     * <b>The surfaces an installed helper may observe for this responsibility (Scheduled Aside v1).</b>
     *
     * <p>Deliberately NOT {@link SourceSpec}s. The list above is this responsibility's obligation to the seller —
     * the channels it promises to keep current — and PD-1 is explicit that only official-API Cafe24 sources belong
     * there. A device-carried read is a different kind of thing: it is not a channel the seller is owed, and a run
     * must not fail or report 「확인하지 못함」 about the seller's data because a helper was asleep.
     *
     * <p>Keeping these here rather than in {@code sources()} is what leaves {@code resolve()}, {@code requires()},
     * {@code usesChannel()}, the scope labels and the case processor's candidate scan untouched — none of them
     * can mistake a device read for a required source, because none of them can see it.
     *
     * <p><b>PD-1 is not reversed by the Coupang entry, it is answered.</b> PD-1 excluded Coupang reviews from the
     * obligation because a scheduled promise to keep them current would report 「확인하지 못함」 every window for a
     * reason that is not a failure — the read needed a person. That argument is about {@code sources()}, and it
     * still holds: Coupang is not in the list above, so no run fails, retries or reports a gap because of it.
     * What changed is that the read no longer needs a person, so there is now a truthful way to attempt it —
     * beside the obligation rather than inside it, and only where a deployment has named the organisation and
     * the seller account ({@code AsideMarketplaceAccess}).
     */
    public List<String> deviceRecipes() {
        return deviceRecipes;
    }

    public boolean requires(String channelCode, DataType dataType) {
        return sources.stream().anyMatch(s -> s.channelCode().equals(channelCode) && s.dataType() == dataType);
    }

    public boolean usesChannel(String channelCode) {
        return sources.stream().anyMatch(s -> s.channelCode().equals(channelCode));
    }
}
