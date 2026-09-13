package com.sellerops.review;

import static org.assertj.core.api.Assertions.assertThat;

import com.sellerops.ingest.canonical.CanonicalReview;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * <b>Media Semantics Closeout v1 — a counted zero and a silence are different facts.</b>
 *
 * <p>`reviews.media_count` was `int not null` meaning «0 when unreported», so one value carried
 * «this review has no photo» and «nobody counted». Measured 2026-09-13: `media_count > 0` on 0 of
 * 4,832 rows, of which 4,800 zeros were the column default. Every media decision after that would
 * have rested on a number that could not say which it was.
 *
 * <p>What these tests pin is the RULE, not a screen: three states, carried rather than derived, and
 * a default that under-claims. There is deliberately no assertion about any surface — no product
 * surface reads the field yet, and the first reader is whatever consumes media.
 */
class MediaObservationSemanticsTest {

    private static CanonicalReview row(String body) {
        return new CanonicalReview("상품", "SKU-1", 3, body, Instant.parse("2026-09-01T00:00:00Z"),
                "EXT-1", 1);
    }

    @Test
    @DisplayName("a source that was never asked about media reports UNKNOWN, not «none»")
    void theDefaultIsUnknown() {
        CanonicalReview upload = row("본문");

        assertThat(upload.mediaCount()).isZero();
        assertThat(upload.mediaObserved())
                .as("false is UNKNOWN — the file-upload path has no media column to read")
                .isFalse();
    }

    @Test
    @DisplayName("the reply-state overload — every pre-WING source — is also UNKNOWN")
    void theReplyStateOverloadIsAlsoUnknown() {
        CanonicalReview row = new CanonicalReview("상품", "SKU-1", 3, "본문",
                Instant.parse("2026-09-01T00:00:00Z"), "EXT-1", 1, ReviewReplyState.ANSWERED, null);

        assertThat(row.mediaObserved()).isFalse();
    }

    @Test
    @DisplayName("a source that counted reports observed — including when it counted zero")
    void aCountedZeroIsAnObservation() {
        CanonicalReview none = new CanonicalReview("상품", "SKU-1", 3, "본문",
                Instant.parse("2026-09-01T00:00:00Z"), null, 1, ReviewReplyState.UNKNOWN, null,
                "OPT-1", 0);
        CanonicalReview some = new CanonicalReview("상품", "SKU-1", 3, "본문",
                Instant.parse("2026-09-01T00:00:00Z"), null, 1, ReviewReplyState.UNKNOWN, null,
                "OPT-1", 2);

        assertThat(none.mediaObserved()).isTrue();
        assertThat(none.mediaCount()).isZero();
        assertThat(some.mediaObserved()).isTrue();
        assertThat(some.mediaCount()).isEqualTo(2);
    }

    @Test
    @DisplayName("observation is CARRIED, never derived from the count — deriving it is the defect")
    void observationIsNotDerivedFromTheCount() throws Exception {
        String canonical = Files.readString(
                Path.of("src/main/java/com/sellerops/ingest/canonical/CanonicalReview.java"))
                .replaceAll("(?s)/\\*.*?\\*/", "").replaceAll("(?m)//.*$", "");
        String ingestion = Files.readString(
                Path.of("src/main/java/com/sellerops/ingest/IngestionService.java"))
                .replaceAll("(?s)/\\*.*?\\*/", "").replaceAll("(?m)//.*$", "");

        // Nobody may write `mediaCount > 0` into the flag: that expression is exactly the conflation
        // this package removes, and a zero would become a silence again the moment it appeared.
        assertThat(canonical).doesNotContain("mediaCount > 0").doesNotContain("mediaCount() > 0");
        assertThat(ingestion).doesNotContain("mediaCount() > 0");
        assertThat(ingestion).contains("entity.setMediaCountObserved(row.mediaObserved())");
    }

    @Test
    @DisplayName("V101 backfills every existing row to UNKNOWN, and stores no reference of any kind")
    void theMigrationUnderClaimsAndStoresNoReference() throws Exception {
        String sql = Files.readString(
                Path.of("src/main/resources/db/migration/V101__review_media_observed.sql"));

        assertThat(sql).contains("add column media_count_observed boolean not null default false");
        // The conservative backfill is the whole point: `false` for every row that already exists,
        // including the 32 a counter did produce. No `update ... set media_count_observed = true`.
        assertThat(sql.toLowerCase()).doesNotContain("set media_count_observed = true");

        // And no media reference enters the schema here — asserted on the DDL, not on the file, because
        // this migration's own comment explains that it stores no url. A guard that fails because of
        // its subject's explanation is not fixed, it is deleted.
        java.util.regex.Matcher added = java.util.regex.Pattern
                .compile("(?i)add\\s+column\\s+(\\S+)\\s+([a-z]+)").matcher(sql);
        java.util.List<String> columns = new java.util.ArrayList<>();
        while (added.find()) {
            columns.add(added.group(1) + " " + added.group(2));
        }
        assertThat(columns)
                .as("exactly one column, and it is a boolean — nothing here can hold a reference")
                .containsExactly("media_count_observed boolean");
    }
}
