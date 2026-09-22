package com.sellerops.preflight;

import com.sellerops.channel.Channel;
import com.sellerops.channel.ChannelRepository;
import com.sellerops.connector.ConnectorRegistry;
import com.sellerops.connector.DataType;
import com.sellerops.connector.FetchPage;
import com.sellerops.connector.FetchRequest;
import com.sellerops.connector.PullConnector;
import com.sellerops.connector.UnsupportedDataTypeException;
import com.sellerops.responsibility.ResponsibilitySources;
import com.sellerops.responsibility.ResponsibilityTemplate;
import com.sellerops.selleraccount.SellerAccount;
import com.sellerops.selleraccount.SellerAccountRepository;
import java.time.Clock;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.stream.Collectors;

/**
 * <b>REAL API read preflight</b> (Full MVP E2E, 2026-09-22) — does each connected channel's official API answer a
 * READ in THIS environment, and what does the customer-operations responsibility resolve to here?
 *
 * <p><b>A preflight, not a run.</b> For each API seller account on NAVER / CAFE24 / COUPANG and each of INQUIRY and
 * REVIEW it asks the resolved pull connector for <i>one</i> page and counts what came back. The page is discarded:
 * nothing is ingested, no cursor advances, no sync job or run row is written. The one write it cannot avoid is the
 * connector's own — a channel whose access token has expired refreshes it through the vault, exactly as any read
 * would — and the manifest says so.
 *
 * <p><b>Two questions, kept apart.</b> {@code codeSupports} is what the resolved connector says it can read;
 * {@code outcome} is what the marketplace answered this time. A type the connector does not offer is never
 * called (outcome {@code NOT_OFFERED}); an absent connector is never mistaken for an unsupported type
 * ({@code CONNECTOR_OFF}).
 *
 * <p><b>Sanitized.</b> A failure is reported as a category and the exception's simple class name — never its
 * message, which may carry a provider body. Counts only; no record content leaves this class.
 */
public class ApiReadPreflight {

    static final List<String> CHANNELS = List.of("NAVER", "CAFE24", "COUPANG");
    static final List<DataType> TYPES = List.of(DataType.INQUIRY, DataType.REVIEW);
    private static final ZoneId KST = ZoneId.of("Asia/Seoul");

    public enum Category { AUTH, SETTING, CAPABILITY, TRANSIENT, CODE }

    public record Row(
            String channelCode,
            UUID sellerAccountId,
            String dataType,
            boolean connectorResolved,
            boolean codeSupports,
            String window,
            String outcome,
            Integer records,
            Boolean hasMore,
            Category failureCategory,
            String failureType,
            long elapsedMs) {
    }

    public record Report(List<Row> rows, List<String> responsibilitySources) {
    }

    private final ConnectorRegistry registry;
    private final SellerAccountRepository accounts;
    private final ChannelRepository channels;
    private final ResponsibilitySources sources;
    private final Clock clock;

    public ApiReadPreflight(ConnectorRegistry registry, SellerAccountRepository accounts, ChannelRepository channels,
                            ResponsibilitySources sources, Clock clock) {
        this.registry = registry;
        this.accounts = accounts;
        this.channels = channels;
        this.sources = sources;
        this.clock = clock;
    }

    public Report run(UUID orgId, int days, int limit) {
        Map<UUID, String> codeByChannel = channels.findAll().stream()
                .collect(Collectors.toMap(Channel::getId, Channel::getCode, (a, b) -> a));
        List<Row> rows = new ArrayList<>();
        for (SellerAccount account : accounts.findAllByOrgId(orgId)) {
            String code = codeByChannel.get(account.getChannelId());
            if (account.isFileUpload() || !CHANNELS.contains(code)) continue;
            Optional<PullConnector> connector = registry.resolvePullConnector(code);
            for (DataType type : TYPES) {
                rows.add(probe(orgId, account.getId(), code, type, connector, days, limit));
            }
        }
        List<String> resolved = sources.resolve(orgId, ResponsibilityTemplate.CUSTOMER_OPERATIONS_V1).stream()
                .map(s -> s.channelCode() + ":" + s.dataType().name())
                .toList();
        return new Report(List.copyOf(rows), resolved);
    }

    private Row probe(UUID orgId, UUID accountId, String code, DataType type, Optional<PullConnector> connector,
                      int days, int limit) {
        if (connector.isEmpty()) {
            return new Row(code, accountId, type.name(), false, false, null, "CONNECTOR_OFF", null, null,
                    Category.SETTING, null, 0);
        }
        PullConnector c = connector.get();
        boolean supports = c.capabilities(code).supports(type);
        if (!supports) {
            return new Row(code, accountId, type.name(), true, false, null, "NOT_OFFERED", null, null,
                    Category.CAPABILITY, null, 0);
        }
        LocalDate end = LocalDate.now(clock.withZone(KST));
        Optional<String> bounded = c.backfillCursor(type, end.minusDays(days - 1L), end);
        String window = bounded.isPresent() ? "LAST_" + days + "_DAYS_KST" : "CONNECTOR_DEFAULT";
        long started = clock.millis();
        try {
            FetchPage page = c.fetch(new FetchRequest(orgId, accountId, code, type, bounded.orElse(null), limit));
            long elapsed = clock.millis() - started;
            if (page.rateLimited()) {
                return new Row(code, accountId, type.name(), true, true, window, "RATE_LIMITED", 0, true,
                        Category.TRANSIENT, null, elapsed);
            }
            return new Row(code, accountId, type.name(), true, true, window, "SUCCESS", page.records().size(),
                    page.hasMore(), null, null, elapsed);
        } catch (RuntimeException e) {
            return new Row(code, accountId, type.name(), true, true, window, "FAILED", null, null,
                    categorize(e), e.getClass().getSimpleName(), clock.millis() - started);
        }
    }

    /**
     * Where a failure belongs. By type name, so this class depends on no channel package: authentication (the
     * credential or the marketplace refused who we are), setting (this environment is not allowed to make the
     * call — an unarmed approval gate, an unregistered egress IP), capability (the connector declined the type
     * after all), transient (time or rate), and everything else is a defect until shown otherwise.
     */
    static Category categorize(RuntimeException e) {
        String name = e.getClass().getSimpleName();
        if (e instanceof UnsupportedDataTypeException) return Category.CAPABILITY;
        if (name.equals("CredentialUnavailableException") || name.equals("ConnectorAuthException")) return Category.AUTH;
        if (name.equals("CoupangLiveApprovalRequiredException") || name.equals("NaverEnvironmentRefusedException")
                || name.equals("NaverProductPermissionException")) return Category.SETTING;
        if (name.contains("Timeout") || name.contains("RateLimited") || name.contains("TransportAmbiguity")) {
            return Category.TRANSIENT;
        }
        return Category.CODE;
    }
}
