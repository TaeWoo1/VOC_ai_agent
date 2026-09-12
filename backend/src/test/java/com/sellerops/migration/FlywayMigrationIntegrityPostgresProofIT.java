package com.sellerops.migration;

import static org.assertj.core.api.Assertions.assertThat;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Map;
import java.util.stream.Stream;
import org.flywaydb.core.Flyway;
import org.flywaydb.core.api.MigrationInfo;
import org.flywaydb.core.api.MigrationState;
import org.flywaydb.core.api.output.ValidateResult;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

/**
 * <b>Empty PostgreSQL → every migration → {@code validate}.</b> The one thing CI could not say about
 * this schema (Pilot Launch Readiness, 2026-09-13).
 *
 * <p>The normal suite is H2 with Flyway disabled, which is the right trade for 4,000 fast tests and
 * the wrong one for the schema itself: it meant that until this class ran in CI, <b>no automated run
 * had ever applied these migrations to the database engine they were written for</b>. A syntax error
 * that H2 would never see, a constraint Postgres rejects, an index on a column a later migration
 * renamed — all of it was discovered by a human running the stack, or by the deploy.
 *
 * <p>What is asserted is deliberately not "the schema looks right" — that is what the other Postgres
 * proofs do for their own tables. It is the four properties a deploy depends on:
 *
 * <ol>
 *   <li><b>Every resolved migration is APPLIED and successful</b> — nothing pending, nothing failed,
 *       nothing ignored. An IGNORED entry is the out-of-order failure: a file whose version is below
 *       the newest already applied, which is why {@code MigrationContractTest} keeps V29/V35 burned.</li>
 *   <li><b>{@code validate} passes</b> — the checksum of every applied migration still matches the file.
 *       This is the check that catches an EDITED migration, the mistake whose symptom on a seller's host
 *       is a schema that silently differs from the one the code was written against.</li>
 *   <li><b>No baseline row</b> — the history starts at the first real migration, so this run genuinely
 *       built the schema instead of being told to assume it. With {@code baseline-on-migrate: false}
 *       (the shipped default) that is also the only way it CAN start.</li>
 *   <li><b>The configuration under test is the production one</b> — baseline off, validate on, in-order.
 *       A proof run with more forgiving settings than the deploy proves the wrong deploy.</li>
 * </ol>
 *
 * <p><b>Opt-in, like every other Postgres proof:</b> gated on {@code SELLEROPS_PG_PROOF=1} with
 * {@code SELLEROPS_PG_URL} pointing at a throwaway database — never a real one; the context boots with
 * Flyway ON and will migrate whatever it is aimed at. In CI that database is a fresh service container,
 * so "empty" is a property of the runner rather than a promise this class makes.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.MOCK)
@EnabledIfEnvironmentVariable(named = "SELLEROPS_PG_PROOF", matches = "1")
class FlywayMigrationIntegrityPostgresProofIT {

    @DynamicPropertySource
    static void datasource(DynamicPropertyRegistry registry) {
        String url = System.getenv().getOrDefault("SELLEROPS_PG_URL",
                "jdbc:postgresql://localhost:55432/sellerops");
        registry.add("spring.datasource.url", () -> url);
        registry.add("spring.datasource.username",
                () -> System.getenv().getOrDefault("SELLEROPS_PG_USER", "sellerops"));
        registry.add("spring.datasource.password",
                () -> System.getenv().getOrDefault("SELLEROPS_PG_PASSWORD", "sellerops_local_pw"));
        registry.add("spring.flyway.enabled", () -> "true");
        registry.add("spring.jpa.hibernate.ddl-auto", () -> "none");
        // Nothing in this class is about rows, and a demo organisation would be the one thing on a
        // "migrate an empty database" proof that the empty database did not contain.
        registry.add("sellerops.seed.enabled", () -> "false");
        registry.add("sellerops.seed.channel-catalogue", () -> "false");
    }

    @Autowired Flyway flyway;
    @Autowired JdbcTemplate jdbc;

    // 1 — the configuration that ran is the configuration the pilot host runs.
    @Test
    void theProvenConfigurationIsTheDeployedOne() {
        assertThat(flyway.getConfiguration().isBaselineOnMigrate())
                .as("baseline-on-migrate must be off, or a non-empty schema is assumed rather than built")
                .isFalse();
        assertThat(flyway.getConfiguration().isValidateOnMigrate()).isTrue();
        assertThat(flyway.getConfiguration().isOutOfOrder()).isFalse();
    }

    // 2 — every migration on disk reached the database, and none of them failed or was skipped.
    @Test
    void everyResolvedMigrationIsAppliedAndSuccessful() throws IOException {
        MigrationInfo[] all = flyway.info().all();
        assertThat(all).isNotEmpty();

        List<String> notApplied = Stream.of(all)
                .filter(i -> i.getState() != MigrationState.SUCCESS)
                .map(i -> i.getVersion() + " " + i.getState())
                .toList();
        assertThat(notApplied)
                .as("pending / failed / ignored migrations after a full migrate")
                .isEmpty();

        long onDisk;
        try (Stream<Path> files = Files.list(Path.of("src/main/resources/db/migration"))) {
            onDisk = files.filter(p -> p.getFileName().toString().endsWith(".sql")).count();
        }
        assertThat(all.length)
                .as("every file on disk is one row in the history")
                .isEqualTo((int) onDisk);

        Integer failed = jdbc.queryForObject(
                "select count(*) from flyway_schema_history where not success", Integer.class);
        assertThat(failed).isZero();
    }

    // 3 — checksums still match: no migration was edited after it shipped.
    @Test
    void validatePasses() {
        ValidateResult result = flyway.validateWithResult();
        assertThat(result.invalidMigrations)
                .as(result.errorDetails == null ? "" : String.valueOf(result.errorDetails.errorMessage))
                .isEmpty();
        assertThat(result.validationSuccessful).isTrue();
    }

    // 4 — the history was built, not assumed, and it was built in order.
    @Test
    void theSchemaWasBuiltFromTheFirstMigrationInVersionOrder() {
        Integer baselines = jdbc.queryForObject(
                "select count(*) from flyway_schema_history where type = 'BASELINE'", Integer.class);
        assertThat(baselines)
                .as("a baseline row means the migrations before it were never run here")
                .isZero();

        List<Map<String, Object>> rows = jdbc.queryForList(
                "select installed_rank, cast(version as integer) as v from flyway_schema_history "
                        + "where version is not null order by installed_rank");
        assertThat(rows).isNotEmpty();
        int previous = 0;
        for (Map<String, Object> row : rows) {
            int version = ((Number) row.get("v")).intValue();
            assertThat(version)
                    .as("applied out of version order — installed_rank " + row.get("installed_rank"))
                    .isGreaterThan(previous);
            previous = version;
        }
    }
}
