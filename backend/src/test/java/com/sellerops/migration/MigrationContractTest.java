package com.sellerops.migration;

import static org.assertj.core.api.Assertions.assertThat;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.TreeSet;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.stream.Stream;
import org.junit.jupiter.api.Test;

/**
 * The schema's forward-only contract, read off the migration files themselves (Pilot Launch Readiness,
 * 2026-09-13 product-owner decision).
 *
 * <p>Three rules, and each exists because the failure it prevents is silent rather than loud.
 *
 * <p><b>1. Forward-only, and no undo script written after the fact.</b> This repository has never had an
 * undo migration and does not gain one retroactively; rollback is {@code pg_dump} + restore
 * ({@code deploy/pilot/backup.sh}, {@code restore.sh}, runbook in {@code docs/pilot_launch_readiness_v1.md}).
 * A stray {@code U<n>__} file would be read by a later operator as "this is reversible" — and Flyway
 * Community cannot run one, so the promise would be unkeepable as well as untrue.
 *
 * <p><b>2. A burned version number is never reused.</b> V29 and V35 were taken and released before they
 * ever reached a database. Flyway runs in-order by default, so a file that reappears at a version BELOW
 * the newest one already applied is not applied — it is reported by {@code validate} as resolved-but-not-
 * applied, i.e. the deploy fails on a host that is otherwise fine, and it fails on the PRODUCTION host
 * rather than on the developer's empty database. The next migration takes {@code max + 1}.
 *
 * <p><b>3. A destructive step names the expand that preceded it.</b> Dropping or renaming a column or
 * table breaks the running old code the instant it commits, and during a deploy the old code IS running.
 * The decision is expand → migrate → contract: add the new shape, move the data and the readers, and only
 * then — in a LATER migration, after the readers have shipped — remove the old one. No test can see
 * whether that happened three releases ago, so what is enforced is the one thing a file can carry: the
 * contraction must cite the expand migration by version, and that version must exist and be older. It
 * converts "we agreed to do expand/migrate/contract" into "a drop cannot land without someone writing
 * down which expand it completes".
 *
 * <p>Measured baseline at the time this was written: <b>97 migrations, zero destructive statements</b>.
 * The guard is green on the entire history, so the first file it ever fails is a new one.
 */
class MigrationContractTest {

    private static final Path DIR = Path.of("src/main/resources/db/migration");

    /** Versions that were taken and released before reaching any database. Never reuse one. */
    private static final List<Integer> BURNED = List.of(29, 35);

    private static final Pattern FILE = Pattern.compile("^V(\\d+)__[a-z0-9_]+\\.sql$");

    /**
     * Statements that break a reader that is still running. Deliberately NOT in this list:
     * {@code alter column ... type} widening (varchar(120) → varchar(200) in V81) and
     * {@code set not null} on a column the same migration just created — both are expands.
     */
    private static final Pattern DESTRUCTIVE = Pattern.compile(
            "\\b(drop\\s+table|drop\\s+column|drop\\s+(materialized\\s+)?view|"
                    + "alter\\s+table\\s+\\S+\\s+rename|rename\\s+column|drop\\s+type)\\b");

    /** The marker a contraction must carry, e.g. {@code -- contract: V42}. */
    private static final Pattern CONTRACT_MARKER = Pattern.compile("--\\s*contract:\\s*V(\\d+)\\b");

    private static Map<Integer, Path> migrations() throws IOException {
        Map<Integer, Path> byVersion = new LinkedHashMap<>();
        try (Stream<Path> files = Files.list(DIR)) {
            files.sorted().forEach(p -> {
                Matcher m = FILE.matcher(p.getFileName().toString());
                if (m.matches()) {
                    byVersion.put(Integer.parseInt(m.group(1)), p);
                }
            });
        }
        return byVersion;
    }

    // 1 — every file is a versioned, forward migration with a well-formed name.
    @Test
    void everyMigrationFileIsAVersionedForwardMigration() throws IOException {
        List<String> names;
        try (Stream<Path> files = Files.list(DIR)) {
            names = files.map(p -> p.getFileName().toString()).sorted().toList();
        }
        assertThat(names).isNotEmpty();
        assertThat(names)
                .as("only V<n>__lower_snake.sql — a repeatable (R__) or undo (U__) script is a different "
                        + "contract than the one this schema keeps")
                .allMatch(n -> FILE.matcher(n).matches(), "V<n>__name.sql");
    }

    // 2 — versions are unique, and the burned ones stay burned.
    @Test
    void versionsAreUniqueAndBurnedVersionsAreNotReused() throws IOException {
        List<Integer> versions = new ArrayList<>();
        try (Stream<Path> files = Files.list(DIR)) {
            files.forEach(p -> {
                Matcher m = FILE.matcher(p.getFileName().toString());
                if (m.matches()) versions.add(Integer.parseInt(m.group(1)));
            });
        }
        assertThat(new TreeSet<>(versions)).as("two files at one version").hasSize(versions.size());
        assertThat(versions)
                .as("V29 and V35 are burned: an out-of-order file fails validate on the deployed host")
                .doesNotContainAnyElementsOf(BURNED);
    }

    // 3 — a destructive statement cites the expand migration it completes.
    @Test
    void aDestructiveStatementNamesTheExpandItContracts() throws IOException {
        Map<Integer, Path> byVersion = migrations();
        List<String> unexplained = new ArrayList<>();

        for (Map.Entry<Integer, Path> e : byVersion.entrySet()) {
            String sql = Files.readString(e.getValue()).toLowerCase(Locale.ROOT);
            // Comment lines carry prose — including the word "drop" in an explanation. Only statements count.
            String statements = sql.lines()
                    .map(line -> line.replaceFirst("--.*$", ""))
                    .reduce("", (a, b) -> a + "\n" + b);
            if (!DESTRUCTIVE.matcher(statements).find()) continue;

            Matcher marker = CONTRACT_MARKER.matcher(sql);
            if (!marker.find()) {
                unexplained.add(e.getValue().getFileName() + " (no `-- contract: V<n>` marker)");
                continue;
            }
            int expand = Integer.parseInt(marker.group(1));
            if (!byVersion.containsKey(expand)) {
                unexplained.add(e.getValue().getFileName() + " cites V" + expand + ", which does not exist");
            } else if (expand >= e.getKey()) {
                unexplained.add(e.getValue().getFileName() + " cites V" + expand + ", which is not older");
            }
        }

        assertThat(unexplained)
                .as("expand → migrate → contract: a drop/rename must name the earlier migration that "
                        + "added the replacement, so the deploy that removes the old shape is one that a "
                        + "human decided was safe rather than one nobody noticed")
                .isEmpty();
    }

    // 4 — the shipped default refuses to baseline a schema it did not build.
    @Test
    void baselineOnMigrateIsOffByDefault() throws IOException {
        String yml = Files.readString(Path.of("src/main/resources/application.yml"));
        assertThat(yml)
                .as("a non-empty schema with no flyway history must FAIL the boot, not silently skip "
                        + "every migration and report success — the shape a partial restore leaves behind")
                .contains("baseline-on-migrate: ${SELLEROPS_FLYWAY_BASELINE_ON_MIGRATE:false}");
        assertThat(yml).contains("validate-on-migrate: true");
        assertThat(yml).contains("out-of-order: false");
    }

    // 5 — the measured baseline, so a future reader knows rule 3 has never had to make an exception.
    @Test
    void theHistoryHasNoDestructiveStatementAtAll() throws IOException {
        List<String> destructive = new ArrayList<>();
        for (Map.Entry<Integer, Path> e : migrations().entrySet()) {
            String statements = Files.readString(e.getValue()).toLowerCase(Locale.ROOT).lines()
                    .map(line -> line.replaceFirst("--.*$", ""))
                    .reduce("", (a, b) -> a + "\n" + b);
            if (DESTRUCTIVE.matcher(statements).find()) destructive.add(e.getValue().getFileName().toString());
        }
        // Not a rule — a record. If this ever fails, rule 3 above is the one that matters; update this
        // list rather than weakening it, so the exception is written down instead of absorbed.
        assertThat(destructive)
                .as("every migration in this schema is additive; the first destructive one will be new")
                .isEmpty();
    }
}
