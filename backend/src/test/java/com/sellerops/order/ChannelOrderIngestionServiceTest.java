package com.sellerops.order;

import static org.assertj.core.api.Assertions.assertThat;

import com.sellerops.ingest.IngestOutcome;
import com.sellerops.ingest.canonical.CanonicalOrder;
import java.lang.reflect.Field;
import java.lang.reflect.RecordComponent;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Locale;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.jdbc.AutoConfigureTestDatabase;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.transaction.PlatformTransactionManager;

/**
 * Per-order acquisition foundation — the idempotent upsert + append-only status history, over a real
 * (H2) DB. Covers the service-level offline E2E scenarios: new ingest, rerun dedup, status change →
 * history, unchanged → no history, org/account isolation, in-page dedup, zero-count, fail-closed,
 * no-PII, and restart idempotency.
 */
@DataJpaTest
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@ActiveProfiles("test")
class ChannelOrderIngestionServiceTest {

    @Autowired ChannelOrderRepository orders;
    @Autowired ChannelOrderStatusEventRepository statusEvents;
    @Autowired PlatformTransactionManager txManager;

    private ChannelOrderIngestionService service;
    private final UUID org = UUID.randomUUID();
    private final UUID channel = UUID.randomUUID();
    private final UUID account = UUID.randomUUID();

    @BeforeEach
    void setUp() {
        service = new ChannelOrderIngestionService(orders, statusEvents, txManager);
    }

    private static Instant at(String date) {
        return LocalDate.parse(date).atStartOfDay(ZoneOffset.UTC).toInstant();
    }

    private static CanonicalOrder order(String extId, String parentId, String status, long amount,
                                        String date, int row) {
        return new CanonicalOrder(extId, parentId, status, amount, LocalDate.parse(date),
                at(date), at(date), row);
    }

    // 1 — several new orders land as rows plus an initial (null → raw) status event each.
    @Test
    void ingestsNewOrdersWithInitialStatusEvent() {
        IngestOutcome outcome = service.ingest(org, channel, account, List.of(
                order("PO1", "O1", "PAYED", 12000, "2026-06-11", 1),
                order("PO2", "O1", "PAYED", 8000, "2026-06-11", 2)));

        assertThat(outcome.success()).isEqualTo(2);
        assertThat(outcome.skipped()).isZero();
        assertThat(orders.findAllByOrgIdAndSellerAccountId(org, account)).hasSize(2);

        ChannelOrder po1 = orders.findByOrgIdAndSellerAccountIdAndExternalOrderId(org, account, "PO1").orElseThrow();
        assertThat(po1.getNormalizedStatus()).isEqualTo(NormalizedOrderStatus.PAID);
        assertThat(po1.getRawStatusCode()).isEqualTo("PAYED");
        assertThat(po1.getPaymentAmount()).isEqualTo(12000L);
        assertThat(po1.getParentOrderId()).isEqualTo("O1");
        List<ChannelOrderStatusEvent> events = statusEvents.findAllByOrgIdAndChannelOrderIdOrderByRecordedAtAsc(org, po1.getId());
        assertThat(events).hasSize(1);
        assertThat(events.get(0).getFromStatusCode()).isNull();
        assertThat(events.get(0).getToStatusCode()).isEqualTo("PAYED");
    }

    // 2 — re-collecting the same orders creates no duplicate rows and no new history.
    @Test
    void rerunSameOrdersIsIdempotent() {
        List<CanonicalOrder> page = List.of(order("PO1", "O1", "PAYED", 12000, "2026-06-11", 1));
        service.ingest(org, channel, account, page);

        IngestOutcome rerun = service.ingest(org, channel, account, page);

        assertThat(rerun.success()).isZero();
        assertThat(rerun.skipped()).isEqualTo(1);
        assertThat(orders.findAllByOrgIdAndSellerAccountId(org, account)).hasSize(1);
        ChannelOrder po1 = orders.findByOrgIdAndSellerAccountIdAndExternalOrderId(org, account, "PO1").orElseThrow();
        assertThat(statusEvents.countByOrgIdAndChannelOrderId(org, po1.getId())).isEqualTo(1);
    }

    // 3 — a raw-status change updates the current row and appends one history event.
    @Test
    void statusChangeUpdatesCurrentAndAppendsHistory() {
        service.ingest(org, channel, account, List.of(order("PO1", "O1", "PAYED", 12000, "2026-06-11", 1)));

        IngestOutcome changed = service.ingest(org, channel, account,
                List.of(order("PO1", "O1", "DELIVERED", 12000, "2026-06-11", 1)));

        assertThat(changed.success()).isEqualTo(1);
        ChannelOrder po1 = orders.findByOrgIdAndSellerAccountIdAndExternalOrderId(org, account, "PO1").orElseThrow();
        assertThat(po1.getRawStatusCode()).isEqualTo("DELIVERED");
        // An unobserved code normalizes to UNKNOWN — never guessed as a lifecycle we cannot confirm.
        assertThat(po1.getNormalizedStatus()).isEqualTo(NormalizedOrderStatus.UNKNOWN);
        List<ChannelOrderStatusEvent> events = statusEvents.findAllByOrgIdAndChannelOrderIdOrderByRecordedAtAsc(org, po1.getId());
        assertThat(events).hasSize(2);
        assertThat(events.get(1).getFromStatusCode()).isEqualTo("PAYED");
        assertThat(events.get(1).getToStatusCode()).isEqualTo("DELIVERED");
    }

    // 4 — an unchanged re-observation appends no history event.
    @Test
    void unchangedReobservationAppendsNoHistory() {
        service.ingest(org, channel, account, List.of(order("PO1", "O1", "PAYED", 12000, "2026-06-11", 1)));

        service.ingest(org, channel, account, List.of(order("PO1", "O1", "PAYED", 12000, "2026-06-11", 1)));

        ChannelOrder po1 = orders.findByOrgIdAndSellerAccountIdAndExternalOrderId(org, account, "PO1").orElseThrow();
        assertThat(statusEvents.countByOrgIdAndChannelOrderId(org, po1.getId())).isEqualTo(1);
    }

    // 5 — the same product-order id under a different org/account is a distinct, isolated row.
    @Test
    void sameOrderIdUnderDifferentAccountOrOrgIsIsolated() {
        UUID otherAccount = UUID.randomUUID();
        UUID otherOrg = UUID.randomUUID();
        service.ingest(org, channel, account, List.of(order("PO1", "O1", "PAYED", 12000, "2026-06-11", 1)));
        service.ingest(org, channel, otherAccount, List.of(order("PO1", "O1", "DELIVERED", 9000, "2026-06-11", 1)));
        service.ingest(otherOrg, channel, account, List.of(order("PO1", "O1", "CANCELED", 7000, "2026-06-11", 1)));

        assertThat(orders.findAllByOrgIdAndSellerAccountId(org, account)).hasSize(1);
        assertThat(orders.findByOrgIdAndSellerAccountIdAndExternalOrderId(org, account, "PO1").orElseThrow()
                .getRawStatusCode()).isEqualTo("PAYED");
        assertThat(orders.findByOrgIdAndSellerAccountIdAndExternalOrderId(org, otherAccount, "PO1").orElseThrow()
                .getPaymentAmount()).isEqualTo(9000L);
        assertThat(orders.findByOrgIdAndSellerAccountIdAndExternalOrderId(otherOrg, account, "PO1").orElseThrow()
                .getPaymentAmount()).isEqualTo(7000L);
    }

    // 6 — the same id twice within one page is deduped.
    @Test
    void duplicateWithinOnePageIsDeduped() {
        IngestOutcome outcome = service.ingest(org, channel, account, List.of(
                order("PO1", "O1", "PAYED", 12000, "2026-06-11", 1),
                order("PO1", "O1", "PAYED", 12000, "2026-06-11", 2)));

        assertThat(outcome.success()).isEqualTo(1);
        assertThat(outcome.skipped()).isEqualTo(1);
        assertThat(orders.findAllByOrgIdAndSellerAccountId(org, account)).hasSize(1);
    }

    // 7 — zero orders is a clean success, no rows.
    @Test
    void zeroOrdersIsCleanSuccess() {
        IngestOutcome outcome = service.ingest(org, channel, account, List.of());

        assertThat(outcome.success()).isZero();
        assertThat(outcome.skipped()).isZero();
        assertThat(outcome.failed()).isZero();
        assertThat(orders.findAllByOrgIdAndSellerAccountId(org, account)).isEmpty();
    }

    // 8 — a per-order row has no home without the exact connection: fail closed, persist nothing.
    @Test
    void nullSellerAccountFailsClosedAndPersistsNothing() {
        IngestOutcome outcome = service.ingest(org, channel, null,
                List.of(order("PO1", "O1", "PAYED", 12000, "2026-06-11", 1)));

        assertThat(outcome.failed()).isEqualTo(1);
        assertThat(outcome.success()).isZero();
        assertThat(orders.count()).isZero();
    }

    // 10 — neither the canonical record nor the entity carries a buyer-PII field.
    @Test
    void noBuyerPiiFieldOnCanonicalRecordOrEntity() {
        String[] forbidden = {"buyer", "author", "name", "phone", "tel", "mobile", "address", "addr",
                "recipient", "receiver", "memo", "email", "zipcode", "postcode"};
        for (RecordComponent c : CanonicalOrder.class.getRecordComponents()) {
            assertThat(containsAny(c.getName(), forbidden))
                    .as("CanonicalOrder.%s must not be buyer PII", c.getName()).isFalse();
        }
        for (Field f : ChannelOrder.class.getDeclaredFields()) {
            assertThat(containsAny(f.getName(), forbidden))
                    .as("ChannelOrder.%s must not be buyer PII", f.getName()).isFalse();
        }
    }

    // 11 — durable state survives a "restart" (fresh service instance) and stays idempotent.
    @Test
    void restartKeepsStateAndStaysIdempotent() {
        service.ingest(org, channel, account, List.of(order("PO1", "O1", "PAYED", 12000, "2026-06-11", 1)));

        ChannelOrderIngestionService afterRestart =
                new ChannelOrderIngestionService(orders, statusEvents, txManager);
        IngestOutcome rerun = afterRestart.ingest(org, channel, account,
                List.of(order("PO1", "O1", "PAYED", 12000, "2026-06-11", 1)));

        assertThat(rerun.skipped()).isEqualTo(1);
        ChannelOrder po1 = orders.findByOrgIdAndSellerAccountIdAndExternalOrderId(org, account, "PO1").orElseThrow();
        assertThat(po1.getRawStatusCode()).isEqualTo("PAYED");
        assertThat(statusEvents.countByOrgIdAndChannelOrderId(org, po1.getId())).isEqualTo(1);
    }

    private static boolean containsAny(String field, String[] needles) {
        String lower = field.toLowerCase(Locale.ROOT);
        for (String needle : needles) {
            if (lower.contains(needle)) {
                return true;
            }
        }
        return false;
    }
}
