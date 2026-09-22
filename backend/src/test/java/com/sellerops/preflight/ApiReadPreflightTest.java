package com.sellerops.preflight;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.sellerops.channel.Channel;
import com.sellerops.channel.ChannelRepository;
import com.sellerops.connector.ConnectorCapabilities;
import com.sellerops.connector.ConnectorRegistry;
import com.sellerops.connector.DataType;
import com.sellerops.connector.FetchPage;
import com.sellerops.connector.FetchRequest;
import com.sellerops.connector.PullConnector;
import com.sellerops.responsibility.ResponsibilitySources;
import com.sellerops.selleraccount.SellerAccount;
import com.sellerops.selleraccount.SellerAccountRepository;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import org.junit.jupiter.api.Test;

/**
 * The REAL API read preflight asks, counts and discards — and it never calls what the code does not offer, never
 * mistakes an absent connector for an unsupported type, and never lets a failure's message out.
 */
class ApiReadPreflightTest {

    private static final UUID ORG = UUID.randomUUID();
    private static final Clock CLOCK = Clock.fixed(Instant.parse("2026-09-22T03:00:00Z"), ZoneOffset.UTC);

    private static Channel channel(String code) {
        Channel c = mock(Channel.class);
        when(c.getId()).thenReturn(UUID.randomUUID());
        when(c.getCode()).thenReturn(code);
        return c;
    }

    private static SellerAccount account(Channel channel) {
        UUID channelId = channel.getId();
        SellerAccount a = mock(SellerAccount.class);
        when(a.getId()).thenReturn(UUID.randomUUID());
        when(a.getChannelId()).thenReturn(channelId);
        when(a.isFileUpload()).thenReturn(false);
        return a;
    }

    /** A connector that serves INQUIRY only; `boom` makes it throw a failure carrying a provider-looking message. */
    static final class FakeConnector implements PullConnector {
        final List<FetchRequest> calls = new ArrayList<>();
        RuntimeException boom;

        @Override public String kind() { return "FAKE"; }
        @Override public ConnectorCapabilities capabilities(String channelCode) {
            return new ConnectorCapabilities("FAKE", Set.of(DataType.INQUIRY), Map.of(DataType.INQUIRY, "CONFIRMED"), "");
        }
        @Override public Optional<String> backfillCursor(DataType t, java.time.LocalDate s, java.time.LocalDate e) {
            return Optional.of(s + ".." + e);
        }
        @Override public FetchPage fetch(FetchRequest request) {
            calls.add(request);
            if (boom != null) throw boom;
            return FetchPage.of(request.dataType(), List.of("a", "b", "c"), null, true, "FAKE");
        }
    }

    private record World(ApiReadPreflight preflight, FakeConnector naver) {}

    private static World world() {
        Channel naver = channel("NAVER");
        Channel coupang = channel("COUPANG");
        SellerAccount nv = account(naver);
        SellerAccount cp = account(coupang);
        ChannelRepository channels = mock(ChannelRepository.class);
        when(channels.findAll()).thenReturn(List.of(naver, coupang));
        SellerAccountRepository accounts = mock(SellerAccountRepository.class);
        when(accounts.findAllByOrgId(ORG)).thenReturn(List.of(nv, cp));
        FakeConnector fake = new FakeConnector();
        ConnectorRegistry registry = mock(ConnectorRegistry.class);
        when(registry.resolvePullConnector("NAVER")).thenReturn(Optional.of(fake));
        when(registry.resolvePullConnector("COUPANG")).thenReturn(Optional.empty());
        ResponsibilitySources sources = mock(ResponsibilitySources.class);
        when(sources.resolve(any(), any())).thenReturn(List.of());
        return new World(new ApiReadPreflight(registry, accounts, channels, sources, CLOCK), fake);
    }

    private static ApiReadPreflight.Row row(ApiReadPreflight.Report r, String code, String type) {
        return r.rows().stream().filter(x -> x.channelCode().equals(code) && x.dataType().equals(type)).findFirst().orElseThrow();
    }

    @Test
    void readsOnePageOfWhatTheCodeOffers_countsIt_andAsksForNothingElse() {
        World w = world();
        ApiReadPreflight.Report r = w.preflight().run(ORG, 7, 50);

        ApiReadPreflight.Row inquiry = row(r, "NAVER", "INQUIRY");
        assertThat(inquiry.outcome()).isEqualTo("SUCCESS");
        assertThat(inquiry.records()).isEqualTo(3);
        assertThat(inquiry.window()).isEqualTo("LAST_7_DAYS_KST");
        // One page, the bounded window in KST, the requested limit.
        assertThat(w.naver().calls).singleElement().satisfies(c -> {
            assertThat(c.cursorValue()).isEqualTo("2026-09-16..2026-09-22");
            assertThat(c.limit()).isEqualTo(50);
        });
        // A type the connector does not offer is not called at all.
        assertThat(row(r, "NAVER", "REVIEW").outcome()).isEqualTo("NOT_OFFERED");
    }

    @Test
    void anAbsentConnectorIsASettingNotACapability() {
        ApiReadPreflight.Report r = world().preflight().run(ORG, 7, 50);
        ApiReadPreflight.Row cp = row(r, "COUPANG", "INQUIRY");
        assertThat(cp.outcome()).isEqualTo("CONNECTOR_OFF");
        assertThat(cp.failureCategory()).isEqualTo(ApiReadPreflight.Category.SETTING);
        assertThat(cp.codeSupports()).isFalse();
    }

    @Test
    void aFailureCarriesItsCategoryAndTypeName_neverItsMessage() throws Exception {
        World w = world();
        w.naver().boom = new IllegalStateException("provider said: {\"token\":\"secret-looking\"}");
        ApiReadPreflight.Report r = w.preflight().run(ORG, 7, 50);
        ApiReadPreflight.Row inquiry = row(r, "NAVER", "INQUIRY");
        assertThat(inquiry.outcome()).isEqualTo("FAILED");
        assertThat(inquiry.failureCategory()).isEqualTo(ApiReadPreflight.Category.CODE);
        assertThat(inquiry.failureType()).isEqualTo("IllegalStateException");
        assertThat(new ObjectMapper().writeValueAsString(r)).doesNotContain("secret-looking").doesNotContain("provider said");
    }

    @Test
    void categorizesByWhereTheFailureBelongs() {
        assertThat(ApiReadPreflight.categorize(new com.sellerops.connector.UnsupportedDataTypeException("NAVER", DataType.REVIEW)))
                .isEqualTo(ApiReadPreflight.Category.CAPABILITY);
    }

    @Test
    void theRunnerRefusesWithoutAWellFormedApproval_orWhileASchedulerIsArmed() throws Exception {
        ApiReadPreflight preflight = mock(ApiReadPreflight.class);
        ObjectMapper json = new ObjectMapper();
        String org = ORG.toString();
        new ApiReadPreflightRunner(preflight, null, org, 7, 50, null, false, json).run(null);
        new ApiReadPreflightRunner(preflight, "Seated and ready.", org, 7, 50, null, false, json).run(null);
        new ApiReadPreflightRunner(preflight, "apr-api-read-0a1b2c3d", org, 7, 50, null, true, json).run(null);
        new ApiReadPreflightRunner(preflight, "apr-api-read-0a1b2c3d", org, 7, 500, null, false, json).run(null);
        verify(preflight, never()).run(any(), anyInt(), anyInt());
    }
}
