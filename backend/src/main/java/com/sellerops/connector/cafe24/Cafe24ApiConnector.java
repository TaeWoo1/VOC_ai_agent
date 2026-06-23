package com.sellerops.connector.cafe24;

import com.sellerops.connector.ConnectorCapabilities;
import com.sellerops.connector.DataType;
import com.sellerops.connector.FetchPage;
import com.sellerops.connector.FetchRequest;
import com.sellerops.connector.PullConnector;
import com.sellerops.connector.UnsupportedDataTypeException;
import com.sellerops.credential.CredentialVault;
import com.sellerops.credential.DecryptedCredential;
import com.sellerops.ingest.canonical.CanonicalOrderSummary;
import java.time.Clock;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * The real Cafe24 Admin API connector. It collects {@code ORDER_SUMMARY}: a
 * refresh-token grant yields an access token, the Admin orders list is paged
 * over a trailing window, and the orders are folded into per-day
 * {@link CanonicalOrderSummary} ({@code payment_amount} summed by
 * {@code order_date}, in KST). The bean exists only behind
 * {@code sellerops.connector.cafe24.enabled=true}
 * ({@link Cafe24ConnectorConfiguration}); with the flag off, CAFE24 keeps
 * resolving to the mock connector and runtime behavior is unchanged.
 *
 * <p>Fail-closed ordering inside {@code fetch} (the Phase 3C Slice 1a
 * convention): data-type gate → vault open (missing credential / missing
 * master key throw here) → secret-shape check → refresh-token grant (proving
 * the credential chain) → <b>immediate rotation write-back</b> → orders pull +
 * per-day aggregation. The write-back ordering is an invariant, not a
 * convenience: Cafe24 refresh tokens are single-use, so the moment the provider
 * answers, the stored token is dead — persisting the replacement before
 * anything else (the orders call) can fail is what keeps the credential usable.
 * A failed refresh never writes back (the exception fires first), so the stored
 * credential is untouched on failure.
 *
 * <p>The whole window is aggregated in-memory and returned as a <b>single</b>
 * {@link FetchPage} (each date exactly once, {@code hasMore=false}), because
 * {@code ingestOrderSummaries} upserts last-wins per day — emitting partial
 * per-day rows across pages would undercount. A mid-window 429 discards the
 * partial aggregate and leaves the cursor unchanged, so the next run re-collects
 * the window cleanly.
 *
 * <p>The initial refresh token enters through the credential intake API after
 * the operator completes Cafe24's interactive authorization-code consent —
 * that flow is manual setup, not connector code.
 *
 * <p><b>Storage invariant:</b> the {@code secrets} map is the single
 * authoritative location for the Cafe24 refresh token (key
 * {@code refresh_token}); the vault row's separate refresh-token slot is NOT
 * read by this connector and is never written by rotation. A credential whose
 * token lives only in that slot fails the shape check closed, with a message
 * naming the missing key — reading both locations was deliberately rejected,
 * because after a rotation the slot would hold a dead token while the secrets
 * map holds the live one, and a dual-path reader could resurrect the dead one.
 */
public class Cafe24ApiConnector implements PullConnector {

    public static final String KIND = "CAFE24_API";
    public static final String CONNECTOR_CLASS = "API";
    public static final String CHANNEL_CODE = "CAFE24";

    /**
     * 429 hint when the official X-Cafe24-Call-Remain header is absent. One
     * second is the smallest honest hint (the bucket drains 2/sec); the
     * scheduled runner clamps rate-limit waits to ≥1 minute anyway.
     */
    static final int FALLBACK_RETRY_AFTER_SECONDS = 1;

    /**
     * Cafe24 is a Korean platform: order dates and the {@code date_type} window
     * are KST. This is the explicit per-platform timezone policy — "today" and
     * the per-day bucketing are both computed in this zone, never an implicit
     * assumption elsewhere.
     */
    static final ZoneId KST = ZoneId.of("Asia/Seoul");

    /** v1 collects a fixed trailing window; re-collection upserts (idempotent). */
    static final int LOOKBACK_DAYS = 14;
    /** Cafe24's max page size; the connector pages internally to cover the window. */
    static final int ORDER_PAGE_LIMIT = 1000;
    /** Safety bound on internal pages (200k orders) — caps a runaway loop. */
    static final int MAX_ORDER_PAGES = 200;

    private final Cafe24TokenClient tokenClient;
    private final CredentialVault vault;
    private final Cafe24OrdersClient ordersClient;
    private final Clock clock;

    public Cafe24ApiConnector(Cafe24TokenClient tokenClient, CredentialVault vault,
                              Cafe24OrdersClient ordersClient, Clock clock) {
        this.tokenClient = tokenClient;
        this.vault = vault;
        this.ordersClient = ordersClient;
        this.clock = clock;
    }

    @Override
    public String kind() {
        return KIND;
    }

    @Override
    public Set<String> dedicatedChannels() {
        return Set.of(CHANNEL_CODE);
    }

    @Override
    public ConnectorCapabilities capabilities(String channelCode) {
        return new ConnectorCapabilities(
                CONNECTOR_CLASS,
                Set.of(DataType.ORDER_SUMMARY),
                Map.of(DataType.ORDER_SUMMARY, "NEEDS_VERIFICATION"),
                "Cafe24 Admin orders → daily ORDER_SUMMARY (payment_amount summed by order_date, KST)."
                        + " Field names / range caps / paging are doc-asserted — NEEDS_VERIFICATION"
                        + " until a gated live run. Product/review/inquiry remain deferred.");
    }

    @Override
    public FetchPage fetch(FetchRequest request) {
        if (!CHANNEL_CODE.equals(request.channelCode()) || request.dataType() != DataType.ORDER_SUMMARY) {
            throw new UnsupportedDataTypeException(request.channelCode(), request.dataType());
        }

        // Fail closed before any HTTP: vault.open throws when no credential row
        // exists (org-scoped) or the vault master key is not configured.
        DecryptedCredential credential = vault.open(request.orgId(), request.sellerAccountId());
        String mallId = credential.secrets().get("mall_id");
        String clientId = credential.secrets().get("client_id");
        String clientSecret = credential.secrets().get("client_secret");
        String refreshToken = credential.secrets().get("refresh_token");
        if (isBlank(mallId) || isBlank(clientId) || isBlank(clientSecret) || isBlank(refreshToken)) {
            throw new IllegalStateException(
                    "카페24 자격 증명에 mall_id, client_id, client_secret 또는 refresh_token이 없습니다.");
        }

        Cafe24TokenResult token;
        try {
            token = tokenClient.refresh(mallId, clientId, clientSecret, refreshToken);
        } catch (Cafe24RateLimitedException e) {
            int retryAfter = e.retryAfterSeconds() != null ? e.retryAfterSeconds() : FALLBACK_RETRY_AFTER_SECONDS;
            // Cursor unchanged — a throttled attempt must re-request the same position.
            return FetchPage.rateLimited(request.dataType(), request.cursorValue(), retryAfter, KIND);
        }

        // Single-use rotation: persist the replacement before anything else can
        // fail. rotateSecrets re-encrypts the payload only — connector class,
        // auth type, creator, and the separate refresh-token slot are preserved.
        if (token.rotatedFrom(refreshToken)) {
            Map<String, String> rotated = new LinkedHashMap<>(credential.secrets());
            rotated.put("refresh_token", token.refreshToken());
            vault.rotateSecrets(request.orgId(), request.sellerAccountId(), rotated);
        }

        // Fixed trailing window in the explicit Cafe24 zone. Re-collecting the
        // same window each run and upserting (last-wins per day) is idempotent
        // and self-healing for late orders / cancellations.
        LocalDate endDate = LocalDate.now(clock.withZone(KST));
        LocalDate startDate = endDate.minusDays(LOOKBACK_DAYS);

        List<Cafe24OrderRow> orders = new ArrayList<>();
        try {
            int offset = 0;
            for (int page = 0; page < MAX_ORDER_PAGES; page++) {
                List<Cafe24OrderRow> batch = ordersClient.fetchPage(
                        token.accessToken(), mallId, startDate, endDate, ORDER_PAGE_LIMIT, offset);
                orders.addAll(batch);
                if (batch.size() < ORDER_PAGE_LIMIT) {
                    break;
                }
                offset += ORDER_PAGE_LIMIT;
            }
        } catch (Cafe24RateLimitedException e) {
            // Discard the partial aggregate: a half-collected window must not
            // overwrite earlier days with undercounts. Cursor unchanged → the
            // next run re-collects the whole window.
            int retryAfter = e.retryAfterSeconds() != null ? e.retryAfterSeconds() : FALLBACK_RETRY_AFTER_SECONDS;
            return FetchPage.rateLimited(request.dataType(), request.cursorValue(), retryAfter, KIND);
        }

        // One page of per-day summaries (each date exactly once) — the executor
        // ingests it in a single upsert batch. hasMore=false: one window per run.
        List<CanonicalOrderSummary> summaries = Cafe24OrderAggregator.aggregate(orders, KST);
        return FetchPage.of(DataType.ORDER_SUMMARY, summaries, endDate.toString(), false, KIND);
    }

    private static boolean isBlank(String value) {
        return value == null || value.isBlank();
    }
}
