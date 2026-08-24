package com.sellerops.order.fact;

import java.util.Optional;

/**
 * Can a single, exactly-referenced order be READ live from this channel — under a contract this
 * repository actually holds?
 *
 * <p><b>This class exists to make a negative answer testable.</b> The fact-source priority is
 * (1) a stored canonical order, (2) an exact READ of the referenced order, (3) unavailable. Step (2)
 * is the one that tempts an implementation into inventing a collection strategy: a date sweep that
 * "probably" contains the order, a customer search, a list walk until the id appears. Each of those
 * is a broad history read wearing an exact lookup's name. Declaring the capability — and declaring it
 * ABSENT, with the reason — is what keeps step (2) from quietly becoming step (1) of a crawler.
 *
 * <p><b>What was audited, 2026-08-25, offline, against the vendored contracts only.</b>
 *
 * <ul>
 *   <li><b>NAVER</b> — {@code docs/vendor/naver-commerce-api/get-v1-pay-order-seller-product-orders.md}
 *       is a <em>time-range</em> query and says so in its own first line ("식별자를 모른 채 특정
 *       기간의 … 작업 큐를 만들고 싶을 때"). {@code …/last-changed-statuses} is also time-ranged. No
 *       vendored NAVER contract retrieves an order BY its identifier.</li>
 *   <li><b>Cafe24</b> — the only orders contract this repository implements is the Admin orders LIST
 *       ({@code Cafe24OrdersClient}), bounded by {@code start_date}/{@code end_date} with
 *       {@code date_type=order_date}. {@code docs/vendor/cafe24-admin-api/} holds one document and it
 *       is the board-comment POST. No vendored Cafe24 contract retrieves an order by id.</li>
 *   <li><b>Coupang</b> — no order-detail contract is vendored at all.</li>
 * </ul>
 *
 * <p>An exact single-order endpoint may well exist on one of these platforms. That is precisely why
 * it is recorded as <b>external research required</b> rather than implemented from memory: a lookup
 * built against a remembered URL fails at the worst moment, live, on a seller's real order. Until a
 * contract is vendored, the honest step (2) is "there is no step (2)".
 */
public final class ExactOrderLookupCapability {

    private ExactOrderLookupCapability() {
    }

    /** Why no channel currently offers step (2). Surfaced in the audit, never to a customer. */
    public static final String NO_VENDORED_EXACT_LOOKUP = "NO_VENDORED_EXACT_LOOKUP";

    /**
     * The exact-lookup path for a channel, when one is contracted.
     *
     * <p>Empty for every channel today. The signature returns an {@link Optional} rather than a
     * boolean so that adding a channel means supplying the endpoint, not flipping a flag: a
     * capability that can be asserted without naming a contract is a capability that will be
     * asserted wrongly.
     */
    public static Optional<String> endpointFor(String channelCode) {
        return Optional.empty();
    }

    /** True when an exact single-order READ may even be attempted for this channel. */
    public static boolean isAvailable(String channelCode) {
        return endpointFor(channelCode).isPresent();
    }
}
