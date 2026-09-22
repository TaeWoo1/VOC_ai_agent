package com.sellerops.responsibility;

import com.sellerops.connector.DataType;
import java.util.List;

/**
 * The code registry of responsibilities Reviewnary can take on. <b>Not a builder</b> — a template is a closed
 * value in this enum, not a row an operator or a seller edits, and v1 has exactly one.
 *
 * <p><b>{@link #CUSTOMER_OPERATIONS_V1}'s scheduled obligation is every source the product can keep current
 * without a person — and that is a test, not a channel list</b> (product-owner decision 2026-09-22). The test is
 * the Product Truth acquisition axis: a (channel × object) whose acquisition mode is AUTOMATIC belongs in the
 * obligation, and one that is SELLER_GUIDED does not. Today that reads:
 *
 * <ul>
 *   <li>Cafe24 INQUIRY · Cafe24 REVIEW — official board APIs;</li>
 *   <li>NAVER INQUIRY — the two official 문의 resources (상품 문의 · 고객 문의). 톡톡 has no API and is not a
 *       data type of its own, so it is simply absent from what the collection returns;</li>
 *   <li>Coupang INQUIRY — the official {@code onlineInquiries} resource.</li>
 * </ul>
 *
 * <p><b>PD-1 (2026-09-15) said Cafe24 and nothing else. Its argument is kept; its channel list is not.</b> PD-1's
 * reason was that Coupang reviews and NAVER review export are read by a person pressing a button, so a scheduled
 * promise to keep them current would make every window report «확인하지 못함» for something that is not a failure.
 * That argument is about acquisition MODE, and it still decides the list — which is exactly why NAVER REVIEW and
 * Coupang REVIEW are still not here and remain {@link #deviceRecipes()}. What PD-1 additionally did, and what is
 * reversed here, is tie the whole responsibility to one channel: a seller who sells only on NAVER could not start
 * 고객 운영 관리 at all, because the activation precondition asks for a CONNECTED account on a template channel.
 * The rules, the investigation, the draft path and the case workspace were already channel-agnostic; only the
 * scope was not.
 *
 * <p><b>Equal reach is not equal capability.</b> Widening the sources changes what is OBSERVED, and nothing else:
 * what may be drafted, approved, sent and verified for a case still comes from the existing capability truth
 * ({@code InquiryReplyCapabilityRegistry}, {@code ReviewExecutionCapability}, {@code ReviewTriageChannelCapability}),
 * which this enum does not touch and must not be read as overriding. A Coupang inquiry case reaches a draft and
 * stops where Coupang's own answer capability stops.
 */
public enum ResponsibilityTemplate {

    CUSTOMER_OPERATIONS_V1(1, "고객 운영 관리", List.of(
            new SourceSpec("CAFE24", DataType.INQUIRY),
            new SourceSpec("CAFE24", DataType.REVIEW),
            new SourceSpec("NAVER", DataType.INQUIRY),
            new SourceSpec("COUPANG", DataType.INQUIRY)),
            List.of("CUSTOMER_OPERATIONS_FIXTURE_OBSERVE_V1", "COUPANG_REVIEW_OBSERVE_V1", "NAVER_REVIEW_OBSERVE_V1",
                    "NAVER_PRODUCT_INQUIRY_OBSERVE_V1"));

    /**
     * One candidate source: a channel's official-API collection of one data type.
     *
     * <p><b>Candidate, not obligation.</b> A spec becomes a source for an organisation only where that
     * organisation has an API seller account on the channel AND the deployment's collector for that channel does
     * not say it cannot read the type — see {@code ResponsibilitySources.resolve}. A seller who has never
     * connected Coupang is owed nothing about Coupang, and no run reports a gap about it.
     */
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
     * what it promises to keep current without anyone present — and a device-carried read is a different kind of
     * thing: it is not a source the seller is owed, and a run must not fail or report 「확인하지 못함」 about the
     * seller's data because a helper was asleep. This is the same test that decides {@code sources()}, applied to
     * the other answer: SELLER_GUIDED acquisition lives here, AUTOMATIC acquisition lives above.
     *
     * <p>Keeping these here rather than in {@code sources()} is what leaves {@code resolve()}, {@code requires()},
     * {@code usesChannel()}, the scope labels and the case processor's candidate scan untouched — none of them
     * can mistake a device read for a required source, because none of them can see it.
     *
     * <p><b>PD-1 is not reversed by the Coupang entry, it is answered.</b> PD-1 excluded Coupang REVIEWS from the
     * obligation because a scheduled promise to keep them current would report 「확인하지 못함」 every window for a
     * reason that is not a failure — the read needed a person. That argument is about {@code sources()}, and it
     * still holds: <b>Coupang REVIEW is not in the list above</b> (Coupang INQUIRY, which an official API answers,
     * is — the two are different sources and the acquisition mode is what tells them apart), so no run fails,
     * retries or reports a gap because a review page went unread. What changed is that the read no longer needs a
     * person, so there is now a truthful way to attempt it — beside the obligation rather than inside it, and only
     * where a deployment has named the organisation and the seller account ({@code AsideMarketplaceAccess}).
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
