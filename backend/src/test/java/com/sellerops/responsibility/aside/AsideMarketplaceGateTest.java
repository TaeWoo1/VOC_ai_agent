package com.sellerops.responsibility.aside;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.sellerops.common.ApiException;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.jdbc.AutoConfigureTestDatabase;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.TestPropertySource;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

/**
 * <b>What it takes before a browser on someone's desk may open a real store, and what happens when it is not
 * all there.</b>
 *
 * <p>The loopback recipe's own rules are asserted next door in {@link ScheduledAsideJobServiceTest}; nothing
 * here weakens them, and the first test says so — a deployment with the marketplace lane off queues loopback
 * work exactly as it always did.
 *
 * <p>The choke point under test is {@code enqueue}, because every job in this system is created there. Gating
 * at that one place is what makes «code that forgot to ask» unable to queue a marketplace job anyway — the same
 * reason the recipe allow-list is a schema CHECK rather than a convention.
 */
@DataJpaTest
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.ANY)
@ActiveProfiles("test")
@Transactional(propagation = Propagation.NOT_SUPPORTED)
@TestPropertySource(properties =
        "spring.datasource.url=jdbc:h2:mem:aside_market;MODE=PostgreSQL;DATABASE_TO_LOWER=TRUE;DB_CLOSE_DELAY=-1")
class AsideMarketplaceGateTest {

    @Autowired ScheduledAsideJobRepository repository;

    private static final Instant T0 = Instant.parse("2026-09-17T01:00:00Z");

    private UUID org;
    private UUID device;
    private UUID account;

    @BeforeEach
    void setUp() {
        repository.deleteAll();
        org = UUID.randomUUID();
        device = UUID.randomUUID();
        account = UUID.randomUUID();
    }

    private ScheduledAsideJobService serviceWith(AsideMarketplaceAccess access, AsideMarketplaceTarget targets) {
        return new ScheduledAsideJobService(repository, Clock.fixed(T0, ZoneOffset.UTC), access, targets);
    }

    private AsideMarketplaceAccess open() {
        return new AsideMarketplaceAccess(true, Set.of(org), Set.of(account));
    }

    /** A resolver that always names this test's account. Stands in for the real store lookup. */
    private AsideMarketplaceTarget resolverNaming(UUID sellerAccountId) {
        return (orgId, recipe) -> Optional.of(
                new AsideMarketplaceTarget.Target(sellerAccountId, "slot-1", "digest-of-vendor-code"));
    }

    @Test
    @DisplayName("with the lane off, the loopback recipe is untouched and the marketplace recipe cannot be queued")
    void offIsOffAndChangesNothingElse() {
        ScheduledAsideJobService service =
                serviceWith(new AsideMarketplaceAccess(false, Set.of(), Set.of()), resolverNaming(account));

        assertThat(service.enqueue(org, device, null, "job-fx",
                AsideRecipe.CUSTOMER_OPERATIONS_FIXTURE_OBSERVE_V1)).isNotNull();

        assertThatThrownBy(() -> service.enqueue(org, UUID.randomUUID(), null, "job-cp",
                AsideRecipe.COUPANG_REVIEW_OBSERVE_V1))
                .as("a build containing this recipe runs it on nobody's machine by default")
                .isInstanceOf(ApiException.class);
        assertThat(repository.findAll()).hasSize(1);
    }

    @Test
    @DisplayName("naming the organisation is not enough on its own to queue work — but it is what this gate asks")
    void anUnnamedOrganisationIsRefused() {
        ScheduledAsideJobService service = serviceWith(
                new AsideMarketplaceAccess(true, Set.of(UUID.randomUUID()), Set.of(account)), resolverNaming(account));

        assertThatThrownBy(() -> service.enqueue(org, device, null, "job-cp", AsideRecipe.COUPANG_REVIEW_OBSERVE_V1))
                .isInstanceOf(ApiException.class);
        assertThat(repository.findAll()).isEmpty();
    }

    @Test
    @DisplayName("a named organisation queues the job, and the claim carries the store it may read")
    void anOpenLaneQueuesAndCarriesItsTarget() {
        ScheduledAsideJobService service = serviceWith(open(), resolverNaming(account));
        service.enqueue(org, device, null, "job-cp", AsideRecipe.COUPANG_REVIEW_OBSERVE_V1);

        Optional<ScheduledAsideJobService.ClaimedJob> claimed = service.claim(org, device);

        assertThat(claimed).isPresent();
        assertThat(claimed.orElseThrow().recipe()).isEqualTo(AsideRecipe.COUPANG_REVIEW_OBSERVE_V1);
        assertThat(claimed.orElseThrow().target()).isNotNull();
        assertThat(claimed.orElseThrow().target().sellerAccountId()).isEqualTo(account);
        assertThat(claimed.orElseThrow().target().accountSlot()).isEqualTo("slot-1");
    }

    @Test
    @DisplayName("a loopback claim carries no store — the two extra fields exist only for the lane that needs them")
    void aLoopbackClaimCarriesNoTarget() {
        ScheduledAsideJobService service = serviceWith(open(), resolverNaming(account));
        service.enqueue(org, device, null, "job-fx", AsideRecipe.CUSTOMER_OPERATIONS_FIXTURE_OBSERVE_V1);

        assertThat(service.claim(org, device).orElseThrow().target())
                .as("a surface we serve ourselves has no store to prove").isNull();
    }

    @Test
    @DisplayName("an open lane with nothing to resolve reads nothing — a null target is not a pass")
    void anUnresolvableStoreLeavesNoTarget() {
        ScheduledAsideJobService service = serviceWith(open(), (orgId, recipe) -> Optional.empty());
        service.enqueue(org, device, null, "job-cp", AsideRecipe.COUPANG_REVIEW_OBSERVE_V1);

        // The helper is handed no slot and no expectation, and refuses to read rather than reading a store
        // nobody could name (`coupang-observe-guard.test.ts` asserts that half).
        assertThat(service.claim(org, device).orElseThrow().target()).isNull();
    }

    @Test
    @DisplayName("two recipes in one run are two jobs — the ids cannot collide on an idempotent hand-out")
    void eachRecipeGetsItsOwnJobId() {
        assertThat(AsideRecipe.CUSTOMER_OPERATIONS_FIXTURE_OBSERVE_V1.jobTag())
                .isNotEqualTo(AsideRecipe.COUPANG_REVIEW_OBSERVE_V1.jobTag());
        UUID runId = UUID.randomUUID();
        String fixtureId = "rr-run:" + runId + ":" + AsideRecipe.CUSTOMER_OPERATIONS_FIXTURE_OBSERVE_V1.jobTag();
        String coupangId = "rr-run:" + runId + ":" + AsideRecipe.COUPANG_REVIEW_OBSERVE_V1.jobTag();
        assertThat(fixtureId).isNotEqualTo(coupangId);
        // The column is varchar(64) and the service refuses anything longer, so the tag has to keep it inside.
        assertThat(coupangId.length()).isLessThanOrEqualTo(64);
    }

    @Test
    @DisplayName("only a recipe that reads a marketplace consults this gate at all")
    void theGateHasNoOpinionAboutLoopback() {
        AsideMarketplaceAccess closed = new AsideMarketplaceAccess(false, Set.of(), Set.of());
        assertThat(closed.allows(AsideRecipe.CUSTOMER_OPERATIONS_FIXTURE_OBSERVE_V1, org)).isTrue();
        assertThat(closed.allows(AsideRecipe.COUPANG_REVIEW_OBSERVE_V1, org)).isFalse();
        assertThat(open().allows(AsideRecipe.COUPANG_REVIEW_OBSERVE_V1, org)).isTrue();
        assertThat(open().allows(AsideRecipe.COUPANG_REVIEW_OBSERVE_V1, UUID.randomUUID())).isFalse();
        assertThat(open().allowsAccount(account)).isTrue();
        assertThat(open().allowsAccount(UUID.randomUUID())).isFalse();
    }

    @Test
    @DisplayName("there is no wildcard, and a typo fails at boot rather than quietly becoming «nobody»")
    void thereIsNoWayToWidenThisByConfiguration() {
        assertThatThrownBy(() -> new AsideMarketplaceAccess(true, "*", ""))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("와일드카드");
        assertThatThrownBy(() -> new AsideMarketplaceAccess(true, "", "*"))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("와일드카드");
        assertThatThrownBy(() -> new AsideMarketplaceAccess(true, "not-a-uuid", ""))
                .as("«off» and «misconfigured» must not look the same")
                .isInstanceOf(IllegalStateException.class);
        // Blank is nobody, and that is a legal, shipped state rather than an error.
        AsideMarketplaceAccess blank = new AsideMarketplaceAccess(true, "", "");
        assertThat(blank.allows(AsideRecipe.COUPANG_REVIEW_OBSERVE_V1, org)).isFalse();
    }
}
