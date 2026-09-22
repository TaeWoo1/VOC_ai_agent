package com.sellerops.collect.dto;

import java.util.List;

/**
 * Operator-facing capability read model for a channel, combining the in-code
 * connector capabilities (the source of truth for API connectors, which are not
 * all seeded into {@code connector_capabilities}) with the connector's honest
 * unsupported-scope boundaries. Channel-generic by design: every API channel
 * answers the same shape, so the UI renders one component for all of them.
 *
 * <p>{@code connectorClass} and each data type's {@code supported}/{@code verificationStatus}
 * reflect the connector actually wired for the channel (e.g. CAFE24 → the Cafe24 connector when its
 * feature flag is on), so the badges never claim more than that connector can serve.
 *
 * <p><b>Two fields deliberately outlive the connector</b>, because the facts they carry are about
 * the CHANNEL and stay true whichever connector answered — both keyed by channel, neither derived
 * from {@code supported}:
 *
 * <ul>
 *   <li>{@code dataTypes[].acquisitionPaths}, from {@code AcquisitionPathRegistry} — how SellerOps
 *       really collects a type when that is not through the connector.
 *   <li>{@code unsupportedScopes}, which merges the connector's own boundaries with the channel-level
 *       gaps in {@code ChannelApiGapRegistry} — what the marketplace never offered.
 * </ul>
 *
 * <p>They are the two halves of one answer, and both have to survive a flagged-off connector. The
 * first arrived without the second, and the badge overclaimed for exactly as long as that lasted.
 *
 * <p><b>{@code backgroundDataTypes} (Product Self-Knowledge Truth Closure v1).</b> The knowledge-layer
 * types — today PRODUCT — computed from the same live connector as {@code dataTypes} but kept in their
 * own list rather than appended to it. The operator badge row is the seller-visible contract of
 * {@code dataTypes} and widening it would change a screen nobody asked to change; the Agent's product
 * truth needs the fact regardless, because PRODUCT is one of the four operating objects and had no
 * per-channel answer anywhere. SALES is deliberately absent: it is not an operating object.
 *
 * <p><b>{@code dataTypes[].declaredSupport} / {@code declaredVerificationStatus}.</b> What the
 * {@code connector_capabilities} reference table says, beside what the live connector says —
 * {@code SUPPORTED} / {@code UNSUPPORTED} / {@code UNDECLARED}, and the table's own verification word.
 * Both are carried, never folded in: the two sources genuinely disagree today, and they disagree on
 * BOTH axes. Coupang PRODUCT is {@code CONFIRMED} in the table and {@code NEEDS_VERIFICATION} in the
 * connector; Coupang INQUIRY is the other way round; NAVER SALES is {@code CONFIRMED} in the table and
 * not served at all by the connector. A reader that silently picked the stronger of two disagreeing
 * sources would state a capability nobody proved. Whoever reads this pair must go the conservative way.
 */
public record ChannelCapabilityOverview(
        String channelCode,
        String channelNameKo,
        String connectorClass,
        boolean autoCollectSupported,
        List<DataTypeCapability> dataTypes,
        List<ScopeNote> unsupportedScopes,
        List<DataTypeCapability> backgroundDataTypes,
        String deploymentAvailability) {

    /**
     * <b>{@code deploymentAvailability} — this deployment, not the channel</b> (Full MVP truth fix, 2026-09-22).
     *
     * <p>{@code autoCollectSupported} is false whenever no pull connector resolved here, and a connector does not
     * resolve when its deployment switch is off. The screen read that one boolean as a statement about the channel
     * and told a seller whose NAVER was connected and collected 「이 채널은 자동 수집을 지원하지 않습니다」 —
     * true of this process, false of NAVER. The two facts are separate fields: {@code autoCollectSupported} is
     * unchanged, and this one says why nothing resolved —
     *
     * <ul>
     *   <li>{@code ON} — a connector resolved in this deployment;</li>
     *   <li>{@code OFF_IN_THIS_DEPLOYMENT} — the product has an official connector for this channel and this
     *       deployment has it switched off;</li>
     *   <li>{@code NO_OFFICIAL_CONNECTOR} — the product has none (file upload, not integrated);</li>
     *   <li>{@code null} — not stated (a reader that was not given the deployment's switches).</li>
     * </ul>
     */
    public ChannelCapabilityOverview(
            String channelCode,
            String channelNameKo,
            String connectorClass,
            boolean autoCollectSupported,
            List<DataTypeCapability> dataTypes,
            List<ScopeNote> unsupportedScopes,
            List<DataTypeCapability> backgroundDataTypes) {
        this(channelCode, channelNameKo, connectorClass, autoCollectSupported, dataTypes, unsupportedScopes,
                backgroundDataTypes, null);
    }

    public ChannelCapabilityOverview withDeploymentAvailability(String availability) {
        return new ChannelCapabilityOverview(channelCode, channelNameKo, connectorClass, autoCollectSupported,
                dataTypes, unsupportedScopes, backgroundDataTypes, availability);
    }

    /**
     * One data type, with the pull connector's answer and — separately — how SellerOps actually
     * acquires it when that is not through the connector.
     *
     * <p>{@code supported} / {@code verificationStatus} are unchanged and still mean exactly one
     * thing: what the resolved pull connector can serve. {@code acquisitionPaths} is the additive
     * axis, empty for every type whose only route is that connector. Read them together — a type can
     * be {@code supported=false} and still be collected, which is precisely the Coupang 상품평 case
     * that a single boolean reported as 미지원.
     */
    public record DataTypeCapability(
            String dataType,
            String label,
            boolean supported,
            String verificationStatus,
            List<AcquisitionPath> acquisitionPaths,
            String declaredSupport,
            String declaredVerificationStatus) {
    }

    /**
     * One way a data type reaches SellerOps outside the pull connector, with the evidence for it.
     *
     * <p>The status rides on the path rather than beside a list of methods: several paths can serve
     * one data type at once, and each is proven on its own. {@code method} is an
     * {@code AcquisitionPathRegistry.Method} name, {@code verificationStatus} a
     * {@code Verification} name, {@code recurrence} a {@code Recurrence} name.
     *
     * <p>{@code recurrence} answers the question the other two cannot: once history is in, does
     * anything NEW arrive by this path, and does it need the seller? A proven path that only ever
     * runs when a seller exports a file is not the same product as an hourly sync, and reporting them
     * identically is how "리뷰 수집됨" came to describe a corpus whose newest row was five weeks old.
     */
    public record AcquisitionPath(String method, String verificationStatus, String recurrence) {
    }

    /** A deliberate boundary the connector does not cover (board, write action, …). */
    public record ScopeNote(String code, String label) {
    }
}
