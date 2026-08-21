package com.sellerops.channelknowledge;

import java.util.List;

/**
 * What SellerOps can do with one data type on one channel — assembled from the CODE registries, with
 * knowledge entries attached as explanation.
 *
 * <p>The split is the whole design. {@code supported}, {@code verificationStatus} and
 * {@code acquisitionPaths} are computed from {@code ConnectorCapabilities},
 * {@code AcquisitionPathRegistry} and {@code ChannelApiGapRegistry} — never restated in a YAML file —
 * so this answer cannot drift from what the product actually does. The pack contributes the part code
 * cannot express: why it is that way, and what the seller should do about it.
 *
 * <p>Two representations of one fact drift; one representation with an explanation attached does not.
 *
 * @param channel            channel code
 * @param dataType           data type
 * @param supported          whether the pull connector itself can serve this type
 * @param verificationStatus the connector's own verification status, or null when it does not serve it
 * @param acquisitionPaths   proven non-connector routes, each with its own evidence and recurrence
 * @param apiGaps            channel-level facts about missing official APIs
 * @param knowledge          entries explaining this cell
 */
public record ChannelCapabilityAnswer(
        String channel,
        String dataType,
        boolean supported,
        String verificationStatus,
        List<AcquisitionPathView> acquisitionPaths,
        List<String> apiGaps,
        List<ChannelKnowledgeEntry> knowledge) {

    /** A non-connector route: how, how well proven, and whether anything new arrives by itself. */
    public record AcquisitionPathView(String method, String verificationStatus, String recurrence) {
    }

    /**
     * Whether new data can arrive at all — by connector or by any registered path.
     *
     * <p>Deliberately not called "complete". A channel that has no API and a proven seller-repeated
     * export is fully served BY ITS OWN RULES, and a bar of "unattended schedule or nothing" would
     * mark it permanently incomplete while an unproven connector scored better.
     */
    public boolean acquirable() {
        return supported || !acquisitionPaths.isEmpty();
    }

    /** Whether anything arrives without a person doing something. */
    public boolean unattended() {
        return supported;
    }
}
