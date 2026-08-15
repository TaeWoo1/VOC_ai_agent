package com.sellerops.collect;

import com.sellerops.collect.dto.ChannelCapabilityOverview.AcquisitionPath;
import com.sellerops.connector.DataType;
import java.util.List;
import java.util.Map;

/**
 * How SellerOps actually acquires a data type, when that is NOT through the channel's pull connector.
 *
 * <p><b>Why this exists.</b> {@code ConnectorCapabilities.supports(dataType)} answers one question —
 * can the resolved {@link com.sellerops.connector.PullConnector} serve this type — and the capability
 * badge rendered that single answer as the whole truth. On Coupang 상품평 the two diverge: the pull
 * connector cannot serve REVIEW (Coupang publishes no seller review API), while SellerOps holds a real
 * review record collected through the operator-confirmed Action Window. The badge said 리뷰 미지원 over
 * a panel counting 22 collected 상품평, and both statements were true.
 *
 * <p><b>What it deliberately does not do.</b> It does not restate the pull connector's own answer:
 * there is no {@code API} entry here for a type the connector already supports, because two
 * representations of one fact drift. {@code supported} / {@code verificationStatus} keep exactly the
 * meaning they had, nothing here gates collection or scheduling, and the
 * {@code connector_capabilities} table is untouched — this is an additive axis read only by the
 * operator-facing overview.
 *
 * <p><b>Why paths carry their own status.</b> One data type can eventually have several acquisition
 * paths at once — an official API for new rows, an Action Window for history, an export for a backfill
 * — and each is proven separately. A flat list of methods beside one shared status could not say which
 * of them was the proven one.
 *
 * <p>Code-level and deliberately narrow: an entry belongs here only once a path is real, and its
 * status names the evidence. {@code LIVE_PROVEN} means a live sitting on a real seller account, on the
 * merged code, is written down — and it must be the sitting that proves THIS claim. For Coupang REVIEW
 * the claim is acquisition, so the evidence is {@code docs/coupang_review_acquisition_v1.md} §6.6
 * (2026-08-15, at {@code 533cafc2}: 3 pages / 24 rows / 22 stored into an empty database, then a
 * same-range re-sync storing 0 and skipping 22). The locate re-proof in
 * {@code docs/coupang_review_locate_ux_v1.md} §5.1 stored nothing by design and proves a different
 * claim — that a stored review can be found again on the seller's screen.
 */
public final class AcquisitionPathRegistry {

    /** How a data type reaches SellerOps. */
    public enum Method {
        /** The channel's official API, through a pull connector. */
        API,
        /** The seller's own confirmed action on the marketplace screen, read by the Local Agent. */
        ACTION_WINDOW,
        /** A file the channel exports and the seller hands over. */
        EXPORT,
        /** Entered or uploaded by hand. */
        MANUAL,
    }

    /** What backs the claim that a path works. Never optimistic: absence of proof is not proof. */
    public enum Verification {
        /** The path exists in code but no live sitting has confirmed it end to end. */
        NEEDS_VERIFICATION,
        /** A live run on a real account, on merged code, is recorded in docs. */
        LIVE_PROVEN,
    }

    /**
     * The whole registry. One entry today, and that is the point: it lists what has been proven, not
     * what is planned.
     */
    private static final Map<String, List<AcquisitionPath>> PATHS = Map.of(
            key("COUPANG", DataType.REVIEW),
            List.of(new AcquisitionPath(Method.ACTION_WINDOW.name(), Verification.LIVE_PROVEN.name())));

    private AcquisitionPathRegistry() {
    }

    /**
     * The non-pull acquisition paths for this channel and data type, newest evidence first. Empty is
     * the honest default: a channel/type with no entry has no acquisition path outside its connector,
     * and the caller must not invent one.
     */
    public static List<AcquisitionPath> pathsFor(String channelCode, DataType dataType) {
        if (channelCode == null || dataType == null) {
            return List.of();
        }
        return PATHS.getOrDefault(key(channelCode, dataType), List.of());
    }

    private static String key(String channelCode, DataType dataType) {
        return channelCode + "/" + dataType.name();
    }
}
