package com.sellerops.order.fact;

import java.util.Map;
import java.util.Optional;

/**
 * Can a single, exactly-referenced order be READ live from this channel — under a contract this
 * repository actually holds?
 *
 * <p><b>This class exists to make the answer testable in both directions.</b> The fact-source
 * priority is (1) a stored canonical order, (2) an exact READ of the referenced order, (3)
 * unavailable. Step (2) is the one that tempts an implementation into inventing a collection
 * strategy: a date sweep that "probably" contains the order, a customer search, a list walk until
 * the id appears. Each of those is a broad history read wearing an exact lookup's name. Declaring
 * the capability — and naming the vendored document that justifies it — is what keeps step (2) from
 * quietly becoming step (1) of a crawler.
 *
 * <p><b>The 2026-08-25 correction.</b> This class previously declared that NO channel had an exact
 * lookup, and classified one as <em>external research required</em>. That declaration was accurate
 * about {@code docs/vendor/} and wrong about the world: Cafe24 publishes
 * {@code GET /api/v2/admin/orders/{order_id}} under {@code mall.read_order} and always has. The
 * research was done and the contract transcribed
 * ({@code docs/vendor/cafe24-admin-api/get-orders-order-id.md}); the capability moves because a
 * document exists, not because anyone remembered a URL. That is exactly the order this class was
 * built to enforce — a capability that can be asserted without naming a contract is a capability
 * that will be asserted wrongly.
 *
 * <p><b>What is still absent, 2026-08-25.</b>
 *
 * <ul>
 *   <li><b>NAVER</b> — {@code docs/vendor/naver-commerce-api/get-v1-pay-order-seller-product-orders.md}
 *       is a <em>time-range</em> query and says so in its own first line ("식별자를 모른 채 특정
 *       기간의 … 작업 큐를 만들고 싶을 때"). {@code …/last-changed-statuses} is also time-ranged. No
 *       vendored NAVER contract retrieves an order BY its identifier. There may well be one;
 *       until it is transcribed, NAVER has no step (2).</li>
 *   <li><b>Coupang</b> — no order-detail contract is vendored at all.</li>
 * </ul>
 */
public final class ExactOrderLookupCapability {

    private ExactOrderLookupCapability() {
    }

    /** Why a channel has no step (2). Surfaced in the audit, never to a customer. */
    public static final String NO_VENDORED_EXACT_LOOKUP = "NO_VENDORED_EXACT_LOOKUP";

    /**
     * Channel → the endpoint path its vendored contract publishes for a single-order read.
     *
     * <p>A path, not a boolean, so that adding a channel means supplying the endpoint.
     */
    private static final Map<String, String> ENDPOINTS = Map.of(
            "CAFE24", "GET /api/v2/admin/orders/{order_id}");

    /**
     * Channel → the vendored document that justifies its entry in {@link #ENDPOINTS}.
     *
     * <p>Repo-relative, and a test asserts the file is on disk. A declaration whose evidence has been
     * deleted or was never written is the failure mode this map exists to catch: the endpoint string
     * would still look authoritative long after nothing supported it.
     */
    private static final Map<String, String> CONTRACT_DOCS = Map.of(
            "CAFE24", "docs/vendor/cafe24-admin-api/get-orders-order-id.md");

    /** The OAuth scope each contract requires, as the vendored document states it. */
    private static final Map<String, String> SCOPES = Map.of(
            "CAFE24", "mall.read_order");

    /** The exact-lookup path for a channel, when one is contracted. */
    public static Optional<String> endpointFor(String channelCode) {
        return Optional.ofNullable(ENDPOINTS.get(channelCode));
    }

    /** The vendored document backing this channel's declaration. */
    public static Optional<String> contractDocFor(String channelCode) {
        return Optional.ofNullable(CONTRACT_DOCS.get(channelCode));
    }

    /** The scope the contract requires, so a grant can be checked before a call is attempted. */
    public static Optional<String> scopeFor(String channelCode) {
        return Optional.ofNullable(SCOPES.get(channelCode));
    }

    /** Every channel that currently declares an exact single-order READ. */
    public static java.util.Set<String> declaredChannels() {
        return ENDPOINTS.keySet();
    }

    /** True when an exact single-order READ may even be attempted for this channel. */
    public static boolean isAvailable(String channelCode) {
        return ENDPOINTS.containsKey(channelCode);
    }

    /** The audit's one-word answer for a channel. */
    public static String describe(String channelCode) {
        return endpointFor(channelCode).orElse(NO_VENDORED_EXACT_LOOKUP);
    }
}
