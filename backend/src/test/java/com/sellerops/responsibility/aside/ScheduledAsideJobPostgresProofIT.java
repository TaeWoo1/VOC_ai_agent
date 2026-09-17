package com.sellerops.responsibility.aside;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.sellerops.auth.device.HelperDevice;
import com.sellerops.auth.device.HelperDeviceRepository;
import com.sellerops.organization.Organization;
import com.sellerops.organization.OrganizationRepository;
import com.sellerops.user.User;
import com.sellerops.user.UserRepository;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

/**
 * <b>The unattended job's safety rules, as the database enforces them.</b>
 *
 * <p>{@code ScheduledAsideJobServiceTest} proves the service refuses these things. This proves the schema does
 * too — and the difference matters, because the service is one caller and a table outlives its callers. On H2
 * the schema comes from Hibernate, so V108's constraints do not exist there and a test relying on them would be
 * green exactly where it proves nothing. Here real Flyway applies V1..V108 and the constraints under test are
 * the migration's own:
 *
 * <ul>
 *   <li>a recipe outside the published allow-list cannot be stored at all;</li>
 *   <li>one device holds at most one live job (partial unique index);</li>
 *   <li>an outcome that observed nothing cannot carry a number;</li>
 *   <li>a CLAIMED row without a claim time or lease, and a SETTLED row without an outcome, are both refused.</li>
 * </ul>
 *
 * <p><b>Opt-in only.</b> Gated by {@code SELLEROPS_PG_PROOF=1}; point it at a throwaway database with
 * {@code SELLEROPS_PG_URL} — never a real one.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.MOCK)
@EnabledIfEnvironmentVariable(named = "SELLEROPS_PG_PROOF", matches = "1")
class ScheduledAsideJobPostgresProofIT {

    @DynamicPropertySource
    static void datasource(DynamicPropertyRegistry registry) {
        String url = System.getenv()
                .getOrDefault("SELLEROPS_PG_URL", "jdbc:postgresql://localhost:5432/sellerops_aside_proof");
        registry.add("spring.datasource.url", () -> url);
        registry.add("spring.datasource.username",
                () -> System.getenv().getOrDefault("SELLEROPS_PG_USER", "sellerops"));
        registry.add("spring.datasource.password",
                () -> System.getenv().getOrDefault("SELLEROPS_PG_PASSWORD", "sellerops_local_pw"));
        registry.add("spring.flyway.enabled", () -> "true");
        registry.add("spring.jpa.hibernate.ddl-auto", () -> "none");
        registry.add("sellerops.seed.enabled", () -> "false");
    }

    @Autowired ScheduledAsideJobRepository jobs;
    @Autowired HelperDeviceRepository devices;
    @Autowired OrganizationRepository organizations;
    @Autowired UserRepository users;
    @Autowired JdbcTemplate jdbc;

    /** A real user row: {@code helper_devices.user_id} is a foreign key, and a device belongs to a person. */
    private UUID user(UUID orgId) {
        User user = new User();
        user.setOrgId(orgId);
        // Unique per call: this proof database persists between runs, and `users_email_key` is a real constraint.
        user.setEmail("aside-proof-" + UUID.randomUUID() + "@example.invalid");
        user.setName("Aside Proof");
        user.setRole("OWNER");
        return users.saveAndFlush(user).getId();
    }

    private UUID device(UUID orgId) {
        HelperDevice device = new HelperDevice();
        device.setOrgId(orgId);
        device.setUserId(user(orgId));
        device.setTokenHash(UUID.randomUUID().toString().replace("-", "") + UUID.randomUUID().toString().replace("-", ""));
        device.setDeviceName("proof-" + UUID.randomUUID());
        device.setExpiresAt(Instant.now().plus(180, ChronoUnit.DAYS));
        return devices.saveAndFlush(device).getId();
    }

    private UUID org() {
        Organization organization = new Organization();
        organization.setName("aside-proof-" + UUID.randomUUID());
        return organizations.saveAndFlush(organization).getId();
    }

    /** Raw insert: the point is what the TABLE refuses, so nothing here goes through the entity's own guards. */
    private void insert(UUID orgId, UUID deviceId, String clientJobId, String recipe, String status,
                        String outcome, Integer count) {
        jdbc.update("""
                insert into scheduled_aside_job
                    (id, org_id, device_id, client_job_id, recipe, status, expires_at, claimed_at, lease_until,
                     settled_at, outcome, observed_count, created_at, updated_at)
                values (?, ?, ?, ?, ?, ?, now() + interval '10 minutes',
                        case when ?::text = 'CLAIMED' then now() end,
                        case when ?::text = 'CLAIMED' then now() + interval '5 minutes' end,
                        case when ?::text = 'SETTLED' then now() end,
                        ?, ?, now(), now())
                """, UUID.randomUUID(), orgId, deviceId, clientJobId, recipe, status, status, status, status,
                outcome, count);
    }

    @Test
    void aRecipeOutsideTheAllowListCannotBeStored() {
        UUID orgId = org();
        UUID deviceId = device(orgId);

        assertThatThrownBy(() -> insert(orgId, deviceId, "j1", "SCRAPE_COUPANG_WING_V1", "QUEUED", null, null))
                .as("an unattended job naming something we never published is impossible, not merely unhandled")
                .hasMessageContaining("chk_scheduled_aside_job_recipe");

        insert(orgId, deviceId, "j2", AsideRecipe.CUSTOMER_OPERATIONS_FIXTURE_OBSERVE_V1.name(), "QUEUED", null, null);
        assertThat(jobs.claimableFor(deviceId, Instant.now())).hasSize(1);
    }

    @Test
    void oneDeviceHoldsAtMostOneLiveJob() {
        UUID orgId = org();
        UUID deviceId = device(orgId);
        String recipe = AsideRecipe.CUSTOMER_OPERATIONS_FIXTURE_OBSERVE_V1.name();
        insert(orgId, deviceId, "j1", recipe, "QUEUED", null, null);

        assertThatThrownBy(() -> insert(orgId, deviceId, "j2", recipe, "QUEUED", null, null))
                .as("a queue of browser jobs for someone's machine is what this index refuses to allow")
                .hasMessageContaining("uq_scheduled_aside_job_active");

        // A settled job is not live work: the next one is admitted.
        jdbc.update("update scheduled_aside_job set status = 'SETTLED', settled_at = now(), outcome = 'OBSERVED' "
                + "where device_id = ?", deviceId);
        insert(orgId, deviceId, "j3", recipe, "QUEUED", null, null);
        assertThat(jobs.claimableFor(deviceId, Instant.now())).hasSize(1);
    }

    @Test
    void onlyAnObservationMayCarryANumber() {
        UUID orgId = org();
        UUID deviceId = device(orgId);
        String recipe = AsideRecipe.CUSTOMER_OPERATIONS_FIXTURE_OBSERVE_V1.name();

        assertThatThrownBy(() ->
                insert(orgId, deviceId, "j1", recipe, "SETTLED", AsideJobOutcome.EXECUTOR_UNAVAILABLE.name(), 7))
                .as("«the helper never answered» is not a reading of zero, or of seven")
                .hasMessageContaining("chk_scheduled_aside_job_count");

        insert(orgId, deviceId, "j2", recipe, "SETTLED", AsideJobOutcome.OBSERVED.name(), 0);
        // Scoped by device: this proof database persists between runs, so a client job id alone names many rows.
        assertThat(jdbc.queryForObject(
                "select observed_count from scheduled_aside_job where device_id = ? and client_job_id = 'j2'",
                Integer.class, deviceId))
                .as("a surface that really is empty is an observation of zero").isZero();
    }

    @Test
    void aClaimedRowStatesItsClaimAndASettledRowStatesItsOutcome() {
        UUID orgId = org();
        UUID deviceId = device(orgId);
        String recipe = AsideRecipe.CUSTOMER_OPERATIONS_FIXTURE_OBSERVE_V1.name();

        assertThatThrownBy(() -> jdbc.update("""
                insert into scheduled_aside_job
                    (id, org_id, device_id, client_job_id, recipe, status, expires_at, created_at, updated_at)
                values (?, ?, ?, 'j1', ?, 'CLAIMED', now() + interval '10 minutes', now(), now())
                """, UUID.randomUUID(), orgId, deviceId, recipe))
                .as("a claim with no claim time and no lease is not a claim")
                .hasMessageContaining("chk_scheduled_aside_job_claimed");

        assertThatThrownBy(() -> jdbc.update("""
                insert into scheduled_aside_job
                    (id, org_id, device_id, client_job_id, recipe, status, expires_at, created_at, updated_at)
                values (?, ?, ?, 'j2', ?, 'SETTLED', now() + interval '10 minutes', now(), now())
                """, UUID.randomUUID(), orgId, deviceId, recipe))
                .as("a settled job that says nothing about what it came to is not settled")
                .hasMessageContaining("chk_scheduled_aside_job_settled");
    }

    @Test
    void theTableCarriesNoTargetAtAll() {
        // The strongest property of this design, asserted on the schema: there is no column through which a
        // marketplace URL, a prompt, a script or a credential could reach a helper running unattended.
        assertThat(jdbc.queryForList(
                "select column_name from information_schema.columns where table_name = 'scheduled_aside_job'",
                String.class))
                .doesNotContain("url", "target", "entry_url", "prompt", "script", "command", "token", "credential",
                        "password", "payload");
    }
}
