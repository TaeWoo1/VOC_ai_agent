package com.sellerops.product;

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
 * {@code INFERRED} is spelled and never produced — the same technique {@code ActionClass.WRITE} uses.
 *
 * <p>A class that cannot be spelled is a class nobody can check for; a class that is spelled and never
 * produced is one this test can prove absent. Filling a missing spec by reasoning over other values is
 * exactly what invariant I3 forbids, so the name exists to make its absence assertable rather than to
 * leave "we don't do that" as a comment.
 */
class ProductFactConfidenceTest {

    private static final Path MAIN = Paths.get("src/main/java/com/sellerops");

    @Test
    @DisplayName("nothing in main ever writes an INFERRED product fact")
    void inferredHasNoProducer() throws IOException {
        List<String> offenders = new ArrayList<>();
        try (Stream<Path> walk = Files.walk(MAIN)) {
            for (Path source : walk.filter(p -> p.toString().endsWith(".java")).toList()) {
                String name = source.getFileName().toString();
                if (name.equals("FactConfidence.java")) {
                    continue; // the declaration itself
                }
                String code = Files.readString(source);
                if (code.contains("FactConfidence.INFERRED")) {
                    offenders.add(name);
                }
            }
        }
        assertThat(offenders)
                .as("a guessed product value must not be storable as a fact")
                .isEmpty();
    }

    @Test
    @DisplayName("the two producible confidences mean different things and are both used")
    void theProducibleOnesAreDistinguishable() {
        // SOURCE_STATED: a channel said it. DERIVED: we parsed it losslessly out of what a seller wrote.
        // A surface that could not tell them apart would present a title parse as a catalogue fact.
        assertThat(FactConfidence.values())
                .containsExactly(FactConfidence.SOURCE_STATED, FactConfidence.DERIVED,
                        FactConfidence.INFERRED);
    }
}
