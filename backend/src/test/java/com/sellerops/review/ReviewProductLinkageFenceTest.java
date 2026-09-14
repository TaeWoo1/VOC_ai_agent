package com.sellerops.review;

import static org.assertj.core.api.Assertions.assertThat;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.ArrayList;
import java.util.List;
import java.util.stream.Stream;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * <b>What the channel's own product identity may and may not do.</b>
 *
 * <p>V105 stores two source facts on a review: the id the channel published and the name it printed. They
 * exist so that a review whose product this org does not hold is still a review — stored, named, readable,
 * decidable. What would make them dangerous is exactly one thing: letting them stand in for a product.
 *
 * <ul>
 *   <li><b>The label never attributes.</b> Nothing resolves a product by the channel's name, and nothing
 *       counts by it. Every per-product figure in this repository keys on {@code product_id}, which is the
 *       correct arithmetic — an unlinked review is not evidence about a product we cannot name — and the
 *       fence is that the name has exactly one reader.</li>
 *   <li><b>No shared bucket.</b> Two unresolved reviews naming different products are two different things.
 *       Structurally they must be, because nothing is created for either; the behavioural proof is in
 *       {@code CatalogueIndependentReviewIngestTest}.</li>
 * </ul>
 */
class ReviewProductLinkageFenceTest {

    private static final Path MAIN = Paths.get("src/main/java/com/sellerops");

    @Test
    @DisplayName("the channel's product NAME has exactly one reader — the label — so nothing can resolve or count by it")
    void theSourceNameIsOnlyEverALabel() throws IOException {
        List<String> readers = filesContaining("getSourceProductName()");
        assertThat(readers)
                .as("a second reader is how a display label becomes an attribution")
                .containsExactly("review/ReviewProductLabel.java");
    }

    @Test
    @DisplayName("the channel's product ID is written by ingest and read by nothing yet — the reconcile key is a key, not a resolver")
    void theSourceRefHasNoProductionResolver() throws IOException {
        List<String> readers = filesContaining("getSourceProductRef()");
        assertThat(readers)
                .as("when a reconcile arrives it joins channel_products on this column; until then nothing reads it")
                .isEmpty();
    }

    @Test
    @DisplayName("the per-product review counts still require a product — an unlinked review is in no product's denominator")
    void everyPerProductCountKeysOnTheProductId() throws IOException {
        String repository = Files.readString(MAIN.resolve("review/ReviewRepository.java"));
        // The catalogue-wide figure the 상품 screen ranks by. Its predicate is the statement.
        assertThat(repository).contains("and r.productId is not null");
        // And no count anywhere reaches for the source columns to make up a group.
        assertThat(repository).doesNotContain("sourceProductRef");
        assertThat(repository).doesNotContain("sourceProductName");
    }

    /**
     * Every file under {@code com/sellerops} that mentions {@code needle}, as repo-relative paths —
     * excluding the inquiry package, whose {@code Inquiry} entity has a getter of the SAME NAME for its
     * own source ref. That column is the sibling this one was modelled on; a scan by method name cannot
     * tell the two apart, and pretending it can would make this fence report the wrong thing.
     */
    private static List<String> filesContaining(String needle) throws IOException {
        List<String> out = new ArrayList<>();
        try (Stream<Path> files = Files.walk(MAIN)) {
            for (Path p : files.filter(f -> f.toString().endsWith(".java")).toList()) {
                String rel = MAIN.relativize(p).toString();
                if (rel.startsWith("inquiry/")) {
                    continue;
                }
                if (Files.readString(p).contains(needle)) {
                    out.add(rel);
                }
            }
        }
        return out;
    }
}
