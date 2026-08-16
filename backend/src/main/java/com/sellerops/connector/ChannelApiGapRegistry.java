package com.sellerops.connector;

import java.util.List;
import java.util.Map;

/**
 * What a <b>marketplace</b> does not publish — a fact about the channel itself, true no matter which
 * connector happens to answer for it.
 *
 * <p><b>Why this exists.</b> "쿠팡은 판매자 리뷰 API를 제공하지 않는다" was written down in exactly one
 * place: {@link com.sellerops.connector.coupang.CoupangApiConnector}'s own
 * {@link PullConnector#unsupportedScopes} list. That connector is behind a feature flag that is off
 * by default, so on every default environment {@link ConnectorRegistry} resolves the generic
 * {@link MockApiConnector} instead — which declares no scopes — and the operator screen simply
 * stopped mentioning the missing API. The counterweight to the acquisition axis disappeared with the
 * connector, even though the marketplace fact had not changed.
 *
 * <p><b>What it deliberately is not.</b> It is not derived from {@code supported == false}. That
 * boolean answers "can the resolved pull connector serve this type", and a connector can decline a
 * type for reasons that have nothing to do with an API existing: {@code CoupangApiConnector} serves
 * only {@code ORDER_SUMMARY} and {@code INQUIRY}, so Coupang PRODUCT and SALES read
 * {@code supported=false} while Coupang documents an API for both — its own notes call them
 * "deferred", which is a roadmap fact, not a marketplace one. Reading an absent API out of a false
 * boolean would manufacture three claims about Coupang out of one connector's scope. Each entry here
 * is its own asserted, evidenced fact.
 *
 * <p><b>Nor is it the acquisition axis.</b> {@code AcquisitionPathRegistry} says how SellerOps DOES
 * get a data type; this says what the channel never offered. They are the two halves the operator
 * screen shows side by side — 상품평 수집 경로 확인됨 · Action Window, and 리뷰 API 없음 — and folding
 * either into the other is what produced the contradiction in the first place.
 *
 * <p>Deliberately narrow. NAVER's missing review API is just as real (the official maintainer said
 * so on 2024-08-30, recorded in {@code V3__scheduled_collection.sql}'s seed), and it is not listed
 * here: adding a channel changes that channel's operator screen and belongs to that channel's own
 * unit, with its own regression. An entry appears when someone has looked.
 */
public final class ChannelApiGapRegistry {

    /**
     * The whole registry. {@code REVIEW_API} for Coupang: the documentation catalogue was counted in
     * full on 2026-08-14 (11 categories, no review endpoint), so this is "not in the list" rather
     * than "not found" — see {@code docs/coupang_review_feasibility_v1.md}.
     *
     * <p>The label is the one {@code CoupangApiConnector} has always shown; it is defined here so the
     * two surfaces cannot drift apart into two slightly different sentences about one fact.
     */
    private static final Map<String, List<UnsupportedScope>> GAPS = Map.of(
            "COUPANG", List.of(new UnsupportedScope("REVIEW_API", "리뷰 API 없음 (쿠팡 미제공)")));

    private ChannelApiGapRegistry() {
    }

    /**
     * The official-API gaps this channel has, whoever is connected. Empty is the honest default: a
     * channel with no entry is one nobody has audited, not one that publishes everything.
     */
    public static List<UnsupportedScope> gapsFor(String channelCode) {
        if (channelCode == null) {
            return List.of();
        }
        return GAPS.getOrDefault(channelCode, List.of());
    }
}
