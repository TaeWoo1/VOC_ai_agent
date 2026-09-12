package com.sellerops.usage;

import static org.assertj.core.api.Assertions.assertThat;

import jakarta.persistence.Column;
import java.io.IOException;
import java.lang.reflect.Field;
import java.lang.reflect.Modifier;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.stream.Stream;
import org.junit.jupiter.api.Test;

/**
 * <b>The privacy promise of the return-visit signal, enforced rather than documented.</b>
 * (Pilot Launch Readiness §2, product-owner decision 2026-09-13.)
 *
 * <p>The decision was specific about what this measurement must not hold: no user id, no IP, no user
 * agent, no clickstream, no review content. Those are easy to honour on the day and easy to lose
 * later — a field added for one good reason, in a change nobody read closely, and the table quietly
 * becomes a different table. So the shape is a test: the entity has two fields, the migration creates
 * two columns, and the package does not so much as name the things it promised not to store.
 *
 * <p>The last check is the one that would actually catch the drift. A column named {@code user_id}
 * would be noticed in review; a {@code lastPath} added to "help debugging" would not.
 */
class HomeOpenDayShapeTest {

    private static final Path MIGRATION =
            Path.of("src/main/resources/db/migration/V100__home_open_day.sql");
    private static final Path PACKAGE = Path.of("src/main/java/com/sellerops/usage");

    /** Words that would each turn a usage-day counter into a record about a person or their content. */
    private static final List<String> FORBIDDEN = List.of(
            "userid", "user_id", "useragent", "user_agent", "ipaddress", "ip_address", "remoteaddr",
            "session", "referrer", "referer", "clickstream", "url", "email", "devicefingerprint",
            "reviewbody", "review_body", "snippet", "subject", "customer");

    // 1 — the entity has exactly the two columns that are the key, and nothing else is persisted.
    @Test
    void theEntityHasExactlyTwoPersistentFields() {
        List<String> columns = new ArrayList<>();
        for (Field f : HomeOpenDay.class.getDeclaredFields()) {
            if (Modifier.isStatic(f.getModifiers()) || f.isSynthetic()) continue;
            Column column = f.getAnnotation(Column.class);
            columns.add(column != null && !column.name().isBlank() ? column.name() : f.getName());
        }
        assertThat(columns)
                .as("a third column is a different table with a different privacy story")
                .containsExactlyInAnyOrder("org_id", "opened_on");
    }

    // 2 — and so does the table the migration creates.
    @Test
    void theMigrationCreatesExactlyThoseTwoColumns() throws IOException {
        String sql = Files.readString(MIGRATION).toLowerCase(Locale.ROOT);
        String body = sql.substring(sql.indexOf("create table home_open_day"));
        body = body.substring(body.indexOf('('), body.indexOf(");") + 1);

        assertThat(body).contains("org_id").contains("opened_on");
        assertThat(body)
                .as("both columns are the key: a nine-open Tuesday is one row because the DATABASE "
                        + "says so, not because a query remembered to be careful")
                .contains("primary key (org_id, opened_on)");

        long declarations = body.lines()
                .map(String::trim)
                .filter(l -> !l.isBlank() && !l.startsWith("--") && !l.startsWith("primary key")
                        && !l.equals("(") && !l.equals(")") && !l.equals(");"))
                .count();
        assertThat(declarations).as("column declarations in home_open_day").isEqualTo(2);
    }

    // 3 — nothing in the package even names what it promised not to keep.
    @Test
    void thePackageDoesNotNameAnythingItPromisedNotToStore() throws IOException {
        List<String> found = new ArrayList<>();
        try (Stream<Path> files = Files.walk(PACKAGE)) {
            for (Path file : files.filter(p -> p.toString().endsWith(".java")).toList()) {
                // Comments explain what is NOT stored, and must be allowed to use the words.
                String code = Files.readString(file).lines()
                        .map(l -> l.replaceFirst("//.*$", ""))
                        .filter(l -> !l.trim().startsWith("*") && !l.trim().startsWith("/*"))
                        .reduce("", (a, b) -> a + "\n" + b)
                        .toLowerCase(Locale.ROOT);
                for (String word : FORBIDDEN) {
                    if (code.contains(word)) found.add(file.getFileName() + " names '" + word + "'");
                }
            }
        }
        assertThat(found)
                .as("this package counts days an organisation came back; it holds nothing about a "
                        + "person, a session, or anything a person wrote")
                .isEmpty();
    }

    // 4 — one writer, and it is not a GET.
    @Test
    void thereIsExactlyOneWriterAndItIsAPost() throws IOException {
        String controller = Files.readString(PACKAGE.resolve("UsageSignalController.java"));
        assertThat(controller).contains("@PostMapping(\"/home-opened\")");
        assertThat(controller)
                .as("a GET that writes is also written by every health check, prefetch and smoke script")
                .doesNotContain("@GetMapping");
        assertThat(controller)
                .as("no request body: the organisation is the token's and the day is the server's, so "
                        + "a request cannot carry a claim about who or when")
                .doesNotContain("@RequestBody");
    }
}
